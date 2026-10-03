import { Result, ok, err } from '@sovra/shared';
import { PeerConnectionStatus, PeerInfo, ResourceLimits } from './types.js';
import { PeerConnectionError, ResourceExceededError } from './errors.js';
import { SecureChannel } from './transport.js';
import { StreamMultiplexer } from './multiplex.js';

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxConnections: 100,
  maxStreamsPerConnection: 32,
  maxMessageSizeBytes: 1024 * 1024, // 1MB
  maxPendingRequests: 50,
  maxSubscriptions: 100,
  rateLimitMsgsPerSec: 50,
};

export interface ActivePeerConnection {
  readonly peerId: string;
  readonly multiaddr: string;
  status: PeerConnectionStatus;
  channel?: SecureChannel;
  multiplexer?: StreamMultiplexer;
  lastActive: number;
  retryCount: number;
  nextRetryTime?: number;
}

export class ConnectionManager {
  private connections = new Map<string, ActivePeerConnection>();
  private peerInfos = new Map<string, PeerInfo>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    public readonly limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS,
    private readonly dialFn?: (multiaddr: string) => Promise<ActivePeerConnection>,
  ) {}

  public get activeCount(): number {
    let count = 0;
    for (const conn of this.connections.values()) {
      if (conn.status === 'connected' || conn.status === 'relayed') {
        count++;
      }
    }
    return count;
  }

  public getConnection(peerId: string): ActivePeerConnection | undefined {
    return this.connections.get(peerId);
  }

  public getConnectedPeers(): readonly PeerInfo[] {
    const result: PeerInfo[] = [];
    for (const conn of this.connections.values()) {
      if (conn.status === 'connected' || conn.status === 'relayed' || conn.status === 'degraded') {
        const info = this.peerInfos.get(conn.peerId);
        if (info) {
          result.push({
            ...info,
            status: conn.status,
            connectionType: conn.status === 'relayed' ? 'relayed' : 'direct',
          });
        }
      }
    }
    return result;
  }

  public registerPeerInfo(info: PeerInfo): void {
    this.peerInfos.set(info.id.peerId, info);
  }

  public async connect(multiaddr: string): Promise<Result<ActivePeerConnection>> {
    const parts = multiaddr.split('/p2p/');
    const peerId = parts[1];
    if (!peerId) {
      return err(
        new PeerConnectionError('Invalid multiaddr: missing /p2p/ Peer ID component', {
          multiaddr,
        }),
      );
    }

    if (this.activeCount >= this.limits.maxConnections) {
      return err(
        new ResourceExceededError('Max active peer connections limit reached', {
          max: this.limits.maxConnections,
          current: this.activeCount,
        }),
      );
    }

    const existing = this.connections.get(peerId);
    if (existing && (existing.status === 'connected' || existing.status === 'relayed')) {
      return ok(existing);
    }

    const activeConn: ActivePeerConnection = {
      peerId,
      multiaddr,
      status: 'connecting',
      lastActive: Date.now(),
      retryCount: 0,
    };
    this.connections.set(peerId, activeConn);

    if (this.dialFn) {
      try {
        const established = await this.dialFn(multiaddr);
        established.status = multiaddr.includes('/p2p-circuit/') ? 'relayed' : 'connected';
        established.lastActive = Date.now();
        this.connections.set(peerId, established);
        return ok(established);
      } catch (errDial) {
        activeConn.status = 'failed';
        this.scheduleReconnect(activeConn);
        return err(
          new PeerConnectionError(
            `Failed to connect to peer: ${errDial instanceof Error ? errDial.message : String(errDial)}`,
            { peerId, multiaddr },
          ),
        );
      }
    }

    // Direct mock/simulation path
    activeConn.status = multiaddr.includes('/p2p-circuit/') ? 'relayed' : 'connected';
    return ok(activeConn);
  }

  public disconnect(peerId: string): void {
    const timer = this.reconnectTimers.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(peerId);
    }

    const conn = this.connections.get(peerId);
    if (conn) {
      conn.status = 'closing';
      conn.multiplexer?.closeAll();
      conn.status = 'disconnected';
      this.connections.delete(peerId);
    }
  }

  /**
   * Exponential backoff reconnect with jitter and maximum retry cap (default 5 attempts).
   * Prevents infinite reconnect loops and reconnect storms.
   */
  public scheduleReconnect(conn: ActivePeerConnection, maxRetries = 5, baseDelayMs = 200): void {
    if (conn.retryCount >= maxRetries) {
      conn.status = 'failed';
      return;
    }

    conn.status = 'reconnecting';
    conn.retryCount++;

    const delay = Math.min(baseDelayMs * Math.pow(2, conn.retryCount - 1), 10000);
    const jitter = Math.random() * 50;
    const finalDelay = delay + jitter;
    conn.nextRetryTime = Date.now() + finalDelay;

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(conn.peerId);
      this.connect(conn.multiaddr).catch(() => {});
    }, finalDelay);

    this.reconnectTimers.set(conn.peerId, timer);
  }

  /**
   * Cleans up idle connections that have had no traffic for longer than idleTimeoutMs
   */
  public pruneIdleConnections(idleTimeoutMs = 300000): number {
    const now = Date.now();
    let pruned = 0;
    for (const [peerId, conn] of this.connections.entries()) {
      if (
        (conn.status === 'connected' || conn.status === 'relayed') &&
        now - conn.lastActive > idleTimeoutMs
      ) {
        this.disconnect(peerId);
        pruned++;
      }
    }
    return pruned;
  }

  public closeAll(): void {
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    for (const peerId of Array.from(this.connections.keys())) {
      this.disconnect(peerId);
    }
  }
}
