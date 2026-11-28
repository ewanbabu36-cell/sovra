import { Result, ok } from '@sovra/shared';
import { DiscoveredPeer, DiscoverySourceType, PeerDiscoveryService, PeerInfo } from './types.js';
import { rankMultiaddrsZeroDomainFirst } from './bootstrap-seeds.js';
import { SignedPeerRecord, verifySignedPeerRecord } from './identity.js';
import { decodeAndVerifyPeerQrUri } from './qr-discovery.js';

export interface DiscoverySource {
  readonly type: DiscoverySourceType;
  start(): Promise<void>;
  stop(): Promise<void>;
  onPeerDiscovered(handler: (peer: DiscoveredPeer) => void): void;
}

export interface LocalDiscoveryOptions {
  readonly multicastAddress?: string;
  readonly multicastPort?: number;
  readonly enableUdpMulticast?: boolean;
  readonly beaconIntervalMs?: number;
}

/**
 * Local LAN discovery source (real UDP IPv4 mDNS multicast beacons + signed LAN ads).
 */
export class LocalDiscoverySource implements DiscoverySource {
  public readonly type: DiscoverySourceType = 'local';
  private running = false;
  private handlers: Array<(peer: DiscoveredPeer) => void> = [];
  private udpSocket: any = null;
  private beaconTimer: ReturnType<typeof setInterval> | null = null;
  private localBeacon?: SignedPeerRecord | undefined;
  private localBeaconRefresh?: (() => SignedPeerRecord | undefined) | undefined;
  private readonly seenBeaconNonces = new Set<string>();
  private readonly multicastAddress: string;
  private readonly multicastPort: number;
  private readonly enableUdpMulticast: boolean;
  private readonly beaconIntervalMs: number;

  constructor(options: LocalDiscoveryOptions = {}) {
    this.multicastAddress = options.multicastAddress ?? '224.0.0.251';
    this.multicastPort = options.multicastPort ?? 5353;
    this.enableUdpMulticast = options.enableUdpMulticast ?? false;
    this.beaconIntervalMs = options.beaconIntervalMs ?? 3000;
  }

  public setSignedBeacon(recordOrProvider: SignedPeerRecord | (() => SignedPeerRecord | undefined)): void {
    if (typeof recordOrProvider === 'function') {
      this.localBeaconRefresh = recordOrProvider;
      this.localBeacon = recordOrProvider();
    } else {
      this.localBeacon = recordOrProvider;
      this.localBeaconRefresh = undefined;
    }
    if (this.running && this.udpSocket) {
      this.broadcastBeaconOnce();
    }
  }

  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
    if (!this.enableUdpMulticast || !isNode) return;

    try {
      const dgram = await import('node:dgram');
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.udpSocket = sock;

      sock.on('error', () => {
        // Non-fatal in sandboxed or multicast-blocked kernels
      });

      sock.on('message', (msg: Buffer) => {
        try {
          const parsed = JSON.parse(msg.toString('utf8'));
          if (parsed?.kind !== 'sovra-mdns-v1' || !parsed?.record) return;
          const rec = parsed.record as SignedPeerRecord;
          if (this.localBeacon && rec.peerId === this.localBeacon.peerId) return;
          if (!verifySignedPeerRecord(rec, this.seenBeaconNonces)) return;
          if (this.seenBeaconNonces.size > 4096) {
            this.seenBeaconNonces.clear();
          }
          const discovered: DiscoveredPeer = {
            peerId: rec.peerId,
            addresses: [...rec.multiaddrs],
            source: 'local',
            timestamp: rec.issuedAt,
          };
          for (const h of this.handlers) {
            h(discovered);
          }
        } catch {}
      });

      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        sock.once('error', done);
        sock.bind(this.multicastPort, () => {
          try {
            sock.addMembership(this.multicastAddress);
            sock.setMulticastLoopback(true);
            sock.setMulticastTTL(1);
          } catch {}
          done();
        });
      });

      this.broadcastBeaconOnce();
      if (this.beaconIntervalMs > 0) {
        this.beaconTimer = setInterval(() => {
          this.broadcastBeaconOnce();
        }, this.beaconIntervalMs);
      }
    } catch {
      this.udpSocket = null;
    }
  }

  public broadcastBeaconOnce(): void {
    if (!this.running || !this.udpSocket) return;
    if (this.localBeaconRefresh) {
      this.localBeacon = this.localBeaconRefresh();
    }
    if (!this.localBeacon) return;
    try {
      const payload = Buffer.from(
        JSON.stringify({ kind: 'sovra-mdns-v1', record: this.localBeacon }),
        'utf8',
      );
      this.udpSocket.send(payload, 0, payload.length, this.multicastPort, this.multicastAddress);
    } catch {}
  }

  public async stop(): Promise<void> {
    this.running = false;
    if (this.beaconTimer) {
      clearInterval(this.beaconTimer);
      this.beaconTimer = null;
    }
    if (this.udpSocket) {
      const sock = this.udpSocket;
      this.udpSocket = null;
      await new Promise<void>((resolve) => {
        try {
          sock.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }
  }

  public onPeerDiscovered(handler: (peer: DiscoveredPeer) => void): void {
    this.handlers.push(handler);
  }

  public emitLocalPeer(peerId: string, addresses: string[]): void {
    if (!this.running) return;
    const discovered: DiscoveredPeer = {
      peerId,
      addresses,
      source: 'local',
      timestamp: Math.floor(Date.now() / 1000),
    };
    for (const h of this.handlers) {
      h(discovered);
    }
  }
}

/**
 * Static / Configured Peer Discovery Source (bootstrap peers, user-configured peers)
 */
export class StaticDiscoverySource implements DiscoverySource {
  public readonly type: DiscoverySourceType = 'static';
  private running = false;
  private handlers: Array<(peer: DiscoveredPeer) => void> = [];
  private staticPeers: Map<string, string[]> = new Map();

  constructor(initialMultiaddrs: readonly string[] = []) {
    for (const addr of initialMultiaddrs) {
      this.addAddress(addr);
    }
  }

  public addAddress(multiaddr: string): void {
    // Multiaddr format: /ip4/.../tcp/.../p2p/12D3KooW...
    const parts = multiaddr.split('/p2p/');
    const peerId = parts[1];
    if (peerId) {
      const existing = this.staticPeers.get(peerId) ?? [];
      this.staticPeers.set(peerId, [...existing, multiaddr]);
      if (this.running) {
        this.emitPeer(peerId, [multiaddr]);
      }
    }
  }

  public async start(): Promise<void> {
    this.running = true;
    for (const [peerId, addrs] of this.staticPeers.entries()) {
      this.emitPeer(peerId, addrs);
    }
  }

  public async stop(): Promise<void> {
    this.running = false;
  }

  public onPeerDiscovered(handler: (peer: DiscoveredPeer) => void): void {
    this.handlers.push(handler);
  }

  private emitPeer(peerId: string, addresses: string[]): void {
    const discovered: DiscoveredPeer = {
      peerId,
      addresses,
      source: 'static',
      timestamp: Math.floor(Date.now() / 1000),
    };
    for (const h of this.handlers) {
      h(discovered);
    }
  }
}

/**
 * Relay-Assisted Discovery Source (peers advertising presence via shared relays)
 */
export class RelayDiscoverySource implements DiscoverySource {
  public readonly type: DiscoverySourceType = 'relay';
  private running = false;
  private handlers: Array<(peer: DiscoveredPeer) => void> = [];

  public async start(): Promise<void> {
    this.running = true;
  }

  public async stop(): Promise<void> {
    this.running = false;
  }

  public onPeerDiscovered(handler: (peer: DiscoveredPeer) => void): void {
    this.handlers.push(handler);
  }

  public announceRelayedPeer(_relayPeerId: string, targetPeerId: string, relayAddr: string): void {
    if (!this.running) return;
    const relayedAddr = `${relayAddr}/p2p-circuit/p2p/${targetPeerId}`;
    const discovered: DiscoveredPeer = {
      peerId: targetPeerId,
      addresses: [relayedAddr],
      source: 'relay',
      timestamp: Math.floor(Date.now() / 1000),
    };
    for (const h of this.handlers) {
      h(discovered);
    }
  }
}

/**
 * PeerDiscoveryManager coordinating multiple discovery sources without a single point of failure.
 */
export class PeerDiscoveryManager implements PeerDiscoveryService {
  private sources: DiscoverySource[] = [];
  private staticSource: StaticDiscoverySource;
  private localSource: LocalDiscoverySource;
  private relaySource: RelayDiscoverySource;
  private discoveredPeersMap = new Map<string, PeerInfo>();
  private peerLatenciesMs = new Map<string, number>();
  private signedPeerRecordsMap = new Map<string, SignedPeerRecord>();
  private seenRecordNonces = new Set<string>();
  private isDiscovering = false;
  private peerDiscoveredHandlers: Array<(peer: DiscoveredPeer) => void> = [];

  constructor(
    initialBootstrapAddrs: readonly string[] = [],
    localDiscoveryOptions: LocalDiscoveryOptions = {},
  ) {
    this.staticSource = new StaticDiscoverySource(initialBootstrapAddrs);
    this.localSource = new LocalDiscoverySource(localDiscoveryOptions);
    this.relaySource = new RelayDiscoverySource();

    this.addSource(this.staticSource);
    this.addSource(this.localSource);
    this.addSource(this.relaySource);
  }

  public get local(): LocalDiscoverySource {
    return this.localSource;
  }

  public get relay(): RelayDiscoverySource {
    return this.relaySource;
  }

  public onPeerDiscovered(handler: (peer: DiscoveredPeer) => void): void {
    this.peerDiscoveredHandlers.push(handler);
  }

  public addSource(source: DiscoverySource): void {
    this.sources.push(source);
    source.onPeerDiscovered(peer => this.handleDiscoveredPeer(peer));
    if (this.isDiscovering) {
      source.start().catch(() => {});
    }
  }

  public async startDiscovery(): Promise<Result<void>> {
    if (this.isDiscovering) return ok(undefined);
    this.isDiscovering = true;
    for (const source of this.sources) {
      await source.start();
    }
    return ok(undefined);
  }

  public async stopDiscovery(): Promise<Result<void>> {
    if (!this.isDiscovering) return ok(undefined);
    this.isDiscovering = false;
    for (const source of this.sources) {
      await source.stop();
    }
    return ok(undefined);
  }

  public getDiscoveredPeers(): readonly PeerInfo[] {
    return Array.from(this.discoveredPeersMap.values()).sort((a, b) => {
      const latA = this.peerLatenciesMs.get(a.id.peerId) ?? 250;
      const latB = this.peerLatenciesMs.get(b.id.peerId) ?? 250;
      return latA - latB;
    });
  }

  /**
   * Records EWMA RTT latency for a connected peer so subsequent queries hit the hot peer cache first.
   */
  public recordPeerLatency(peerId: string, latencyMs: number): void {
    const bounded = Math.max(1, Math.round(latencyMs));
    const prev = this.peerLatenciesMs.get(peerId);
    const next = prev !== undefined ? Math.round(prev * 0.7 + bounded * 0.3) : bounded;
    this.peerLatenciesMs.set(peerId, next);
  }

  /**
   * Returns top-N lowest-latency discovered peers for instant zero-DHT dial reuse.
   */
  public getFastestPeers(limit = 15): readonly PeerInfo[] {
    return this.getDiscoveredPeers().slice(0, Math.max(1, limit));
  }

  /**
   * Cryptographically verifies and ingests a SignedPeerRecord received via P2P PEX, mDNS, or QR scan.
   * Rejects tampered payloads, forged PeerIDs, expired records, and replayed nonces.
   */
  public ingestSignedPeerRecord(record: SignedPeerRecord): boolean {
    if (!verifySignedPeerRecord(record, this.seenRecordNonces)) {
      return false;
    }
    if (this.seenRecordNonces.size > 4096) {
      this.seenRecordNonces.clear();
    }
    const existingRec = this.signedPeerRecordsMap.get(record.peerId);
    if (!existingRec || record.issuedAt >= existingRec.issuedAt) {
      this.signedPeerRecordsMap.set(record.peerId, record);
    }
    const ranked = rankMultiaddrsZeroDomainFirst(record.multiaddrs);
    this.handleDiscoveredPeer({
      peerId: record.peerId,
      addresses: ranked,
      source: 'relay',
      timestamp: record.issuedAt,
    });
    for (const addr of ranked) {
      this.staticSource.addAddress(addr);
    }
    return true;
  }

  /**
   * Parses, verifies, and registers a scanned offline QR peer discovery URI.
   */
  public ingestQrPeerUri(qrPayload: string): Result<SignedPeerRecord> {
    const decoded = decodeAndVerifyPeerQrUri(qrPayload, this.seenRecordNonces);
    if (!decoded.ok) return decoded;
    this.ingestSignedPeerRecord(decoded.value);
    return decoded;
  }

  /**
   * Returns valid signed peer advertisements for peer exchange (/sovra/pex/1.0.0).
   */
  public getShareableSignedPeerRecords(limit = 32): SignedPeerRecord[] {
    const now = Math.floor(Date.now() / 1000);
    const active: SignedPeerRecord[] = [];
    for (const [peerId, rec] of this.signedPeerRecordsMap.entries()) {
      if (rec.expiresAt <= now) {
        this.signedPeerRecordsMap.delete(peerId);
        continue;
      }
      active.push(rec);
    }
    return active.slice(0, Math.max(1, limit));
  }

  /**
   * Ingests peer multiaddrs learned via Peer Exchange (PEX) without needing central DNS seeds.
   */
  public ingestPeerExchange(multiaddrs: readonly string[]): number {
    let added = 0;
    const nowSec = Math.floor(Date.now() / 1000);
    for (const addr of rankMultiaddrsZeroDomainFirst(multiaddrs)) {
      if (typeof addr !== 'string' || addr.length > 512) continue;
      if (!addr.startsWith('/ip4/') && !addr.startsWith('/ip6/') && !addr.startsWith('/onion') && !addr.startsWith('/dns')) {
        continue;
      }
      const parts = addr.split('/p2p/');
      const peerId = parts[1]?.split('/')[0];
      if (!peerId || peerId.length < 16) continue;
      const existed = this.discoveredPeersMap.has(peerId);
      this.handleDiscoveredPeer({
        peerId,
        addresses: [addr],
        source: 'relay',
        timestamp: nowSec,
      });
      this.staticSource.addAddress(addr);
      if (!existed) added++;
    }
    return added;
  }

  /**
   * Exports a serializable snapshot of known P2P peers + measured latencies (Bitcoin peers.dat equivalent).
   */
  public exportPeerBookSnapshot(): Array<{
    peerId: string;
    addresses: string[];
    latencyMs?: number;
  }> {
    return this.getDiscoveredPeers().map((peer) => {
      const lat = this.peerLatenciesMs.get(peer.id.peerId);
      return {
        peerId: peer.id.peerId,
        addresses: [...peer.addresses],
        ...(lat !== undefined ? { latencyMs: lat } : {}),
      };
    });
  }

  /**
   * Restores a previously saved peer book snapshot so nodes reconnect without bootstrapping from DNS.
   */
  public importPeerBookSnapshot(
    snapshot: ReadonlyArray<{ peerId: string; addresses: readonly string[]; latencyMs?: number }>,
  ): number {
    let restored = 0;
    for (const entry of snapshot) {
      if (!entry.peerId || !Array.isArray(entry.addresses) || entry.addresses.length === 0) continue;
      this.handleDiscoveredPeer({
        peerId: entry.peerId,
        addresses: [...entry.addresses],
        source: 'static',
        timestamp: Math.floor(Date.now() / 1000),
      });
      for (const addr of entry.addresses) {
        this.staticSource.addAddress(addr);
      }
      if (typeof entry.latencyMs === 'number' && entry.latencyMs > 0) {
        this.peerLatenciesMs.set(entry.peerId, entry.latencyMs);
      }
      restored++;
    }
    return restored;
  }

  public addBootstrapNodes(bootstrapMultiaddrs: readonly string[]): void {
    for (const addr of rankMultiaddrsZeroDomainFirst(bootstrapMultiaddrs)) {
      this.staticSource.addAddress(addr);
    }
  }

  private handleDiscoveredPeer(discovered: DiscoveredPeer): void {
    const existing = this.discoveredPeersMap.get(discovered.peerId);
    const mergedAddrs = rankMultiaddrsZeroDomainFirst(
      existing ? [...existing.addresses, ...discovered.addresses] : discovered.addresses,
    );

    const info: PeerInfo = {
      id: {
        peerId: discovered.peerId,
        publicKeyHex: '', // populated upon handshake
      },
      addresses: mergedAddrs,
      status: existing ? existing.status : 'disconnected',
      score: existing ? existing.score : 0,
    };
    this.discoveredPeersMap.set(discovered.peerId, info);
    for (const handler of this.peerDiscoveredHandlers) {
      try {
        handler(discovered);
      } catch {}
    }
  }
}
