import * as net from 'node:net';
import { Result, ok, err } from '@sovra/shared';
import { PeerConnectionStatus, PeerInfo, ResourceLimits } from './types.js';
import { PeerConnectionError, ResourceExceededError } from './errors.js';
import { SecureChannel } from './transport.js';
import { StreamMultiplexer } from './multiplex.js';

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxConnections: 100,
  maxStreamsPerConnection: 64,
  maxMessageSizeBytes: 1024 * 1024, // 1MB
  maxPendingRequests: 100,
  maxSubscriptions: 100,
  rateLimitMsgsPerSec: 50,
};

export interface ActivePeerConnection {
  readonly peerId: string;
  readonly multiaddr: string;
  status: PeerConnectionStatus;
  channel?: SecureChannel;
  multiplexer?: StreamMultiplexer;
  socket?: net.Socket;
  lastActive: number;
  retryCount: number;
  nextRetryTime?: number;
}

/**
 * Extracts IPv4 subnet /24 prefix from a multiaddr.
 */
function extractIpSubnetPrefix(multiaddr: string): string | null {
  const match = multiaddr.match(/\/ip4\/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
  if (match && match[1] && match[2] && match[3]) {
    return `${match[1]}.${match[2]}.${match[3]}.0/24`;
  }
  return null;
}

export class ConnectionManager {
  private connections = new Map<string, ActivePeerConnection>();
  private peerInfos = new Map<string, PeerInfo>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private subnetCounts = new Map<string, number>();

  constructor(
    public readonly limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS,
    private readonly dialFn?: (multiaddr: string) => Promise<ActivePeerConnection>,
    private readonly maxPerSubnet = 10, // Max connections per /24 prefix (mitigates Sybil/Eclipse)
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

  public getAllConnections(): readonly ActivePeerConnection[] {
    return Array.from(this.connections.values());
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

    // Subnet diversity check for non-localhost addresses
    const subnet = extractIpSubnetPrefix(multiaddr);
    if (subnet && !subnet.startsWith('127.')) {
      const currentInSubnet = this.subnetCounts.get(subnet) ?? 0;
      if (currentInSubnet >= this.maxPerSubnet) {
        return err(
          new ResourceExceededError(
            `Max active connections for IP subnet ${subnet} reached (${this.maxPerSubnet})`,
          ),
        );
      }
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

    if (subnet) {
      this.subnetCounts.set(subnet, (this.subnetCounts.get(subnet) ?? 0) + 1);
    }

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

    activeConn.status = multiaddr.includes('/p2p-circuit/') ? 'relayed' : 'connected';
    return ok(activeConn);
  }

  public registerEstablishedConnection(conn: ActivePeerConnection): void {
    this.connections.set(conn.peerId, conn);
    const subnet = extractIpSubnetPrefix(conn.multiaddr);
    if (subnet) {
      this.subnetCounts.set(subnet, (this.subnetCounts.get(subnet) ?? 0) + 1);
    }
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
      if (conn.socket && !conn.socket.destroyed) {
        conn.socket.destroy();
      }
      conn.status = 'disconnected';
      this.connections.delete(peerId);

      const subnet = extractIpSubnetPrefix(conn.multiaddr);
      if (subnet) {
        const count = this.subnetCounts.get(subnet) ?? 1;
        if (count <= 1) this.subnetCounts.delete(subnet);
        else this.subnetCounts.set(subnet, count - 1);
      }
    }
  }

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

  /**
   * Pillar 1: Zero-Handshake Connection Migration across Wi-Fi and 5G Cellular handoffs.
   */
  public migratePeerConnection(
    peerId: string,
    newMultiaddr: string,
    maxTokenAgeMs = 300000,
    issuedAt = Date.now(),
  ): Result<boolean> {
    const conn = this.connections.get(peerId);
    if (!conn) {
      return err(new PeerConnectionError('Cannot migrate connection: peer not found', { peerId }));
    }
    if (Date.now() - issuedAt > maxTokenAgeMs) {
      return err(new PeerConnectionError('Session migration token expired', { peerId }));
    }

    const oldSubnet = extractIpSubnetPrefix(conn.multiaddr);
    if (oldSubnet) {
      const count = this.subnetCounts.get(oldSubnet) ?? 1;
      if (count <= 1) this.subnetCounts.delete(oldSubnet);
      else this.subnetCounts.set(oldSubnet, count - 1);
    }

    (conn as { multiaddr: string }).multiaddr = newMultiaddr;
    conn.lastActive = Date.now();
    const newSubnet = extractIpSubnetPrefix(newMultiaddr);
    if (newSubnet) {
      this.subnetCounts.set(newSubnet, (this.subnetCounts.get(newSubnet) ?? 0) + 1);
    }

    return ok(true);
  }
}

