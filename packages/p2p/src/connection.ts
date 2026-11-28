import { Result, ok, err } from '@sovra/shared';
import { PeerConnectionStatus, PeerInfo, ResourceLimits } from './types.js';
import { PeerConnectionError, ResourceExceededError } from './errors.js';
import { SecureChannel } from './transport.js';
import { StreamMultiplexer } from './multiplex.js';
import type { DuplexTransportStream } from './websocket.js';

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
  channel?: SecureChannel | undefined;
  multiplexer?: StreamMultiplexer | undefined;
  socket?: DuplexTransportStream | undefined;
  lastActive: number;
  retryCount: number;
  nextRetryTime?: number;
}

/**
 * Extracts IPv4 /24 or IPv6 /48 subnet prefix from a multiaddr for Sybil/Eclipse diversity enforcement.
 */
function extractIpSubnetPrefix(multiaddr: string): string | null {
  const v4 = multiaddr.match(/\/ip4\/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
  if (v4 && v4[1] && v4[2] && v4[3]) {
    return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  }
  const v6 = multiaddr.match(/\/ip6\/([^/]+)/);
  if (v6 && v6[1]) {
    const raw = v6[1].toLowerCase().replace(/^\[|\]$/g, '');
    if (raw === '::1' || raw === '0:0:0:0:0:0:0:1') return 'ip6-loopback';
    const segs = raw.split(':').filter(Boolean);
    return `ip6:${segs.slice(0, 3).join(':') || raw}::/48`;
  }
  return null;
}

function isLoopbackSubnet(subnet: string | null): boolean {
  return !subnet || subnet.startsWith('127.') || subnet === 'ip6-loopback';
}

export class ConnectionManager {
  private connections = new Map<string, ActivePeerConnection>();
  private peerInfos = new Map<string, PeerInfo>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private subnetCounts = new Map<string, number>();

  constructor(
    public readonly limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS,
    private readonly dialFn?: (multiaddr: string) => Promise<ActivePeerConnection>,
    private readonly maxPerSubnet = 10, // Max connections per /24 IPv4 or /48 IPv6 prefix (mitigates Sybil/Eclipse)
    private readonly reconnectFn?: (multiaddr: string) => Promise<ActivePeerConnection>,
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
          const isRelayed =
            conn.status === 'relayed' ||
            conn.multiaddr.includes('/p2p-circuit/') ||
            info.connectionType === 'relayed';
          const isOnion =
            !isRelayed &&
            (conn.multiaddr.includes('/onion') || info.connectionType === 'tor-onion');
          result.push({
            ...info,
            status: isRelayed ? 'relayed' : conn.status,
            connectionType: isRelayed ? 'relayed' : isOnion ? 'tor-onion' : 'direct',
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

  public getPeerInfo(peerId: string): PeerInfo | undefined {
    return this.peerInfos.get(peerId);
  }

  public async connect(multiaddr: string): Promise<Result<ActivePeerConnection>> {
    const parts = multiaddr.split('/p2p/');
    const peerId = parts[parts.length - 1];
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
    if (!isLoopbackSubnet(subnet) && subnet) {
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
        if (subnet) {
          const count = this.subnetCounts.get(subnet) ?? 1;
          if (count <= 1) this.subnetCounts.delete(subnet);
          else this.subnetCounts.set(subnet, count - 1);
        }
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

  public canAcceptConnection(multiaddr: string): boolean {
    if (this.activeCount >= this.limits.maxConnections) {
      return false;
    }
    const subnet = extractIpSubnetPrefix(multiaddr);
    if (!isLoopbackSubnet(subnet) && subnet) {
      if ((this.subnetCounts.get(subnet) ?? 0) >= this.maxPerSubnet) {
        return false;
      }
    }
    return true;
  }

  public registerEstablishedConnection(conn: ActivePeerConnection): boolean {
    const existing = this.connections.get(conn.peerId);
    if (!existing && !this.canAcceptConnection(conn.multiaddr)) {
      return false;
    }
    this.connections.set(conn.peerId, conn);
    if (!existing) {
      const subnet = extractIpSubnetPrefix(conn.multiaddr);
      if (subnet) {
        this.subnetCounts.set(subnet, (this.subnetCounts.get(subnet) ?? 0) + 1);
      }
    }
    return true;
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
      const runner = this.reconnectFn
        ? this.reconnectFn(conn.multiaddr).catch(() => {
            this.scheduleReconnect(conn, maxRetries, baseDelayMs);
          })
        : this.connect(conn.multiaddr).catch(() => {});
      void runner;
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

