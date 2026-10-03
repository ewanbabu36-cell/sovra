import { Result, ok } from '@sovra/shared';
import { DiscoveredPeer, DiscoverySourceType, PeerDiscoveryService, PeerInfo } from './types.js';

export interface DiscoverySource {
  readonly type: DiscoverySourceType;
  start(): Promise<void>;
  stop(): Promise<void>;
  onPeerDiscovered(handler: (peer: DiscoveredPeer) => void): void;
}

/**
 * Local LAN discovery source (mDNS / local broadcast simulation)
 */
export class LocalDiscoverySource implements DiscoverySource {
  public readonly type: DiscoverySourceType = 'local';
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
  private isDiscovering = false;

  constructor(initialBootstrapAddrs: readonly string[] = []) {
    this.staticSource = new StaticDiscoverySource(initialBootstrapAddrs);
    this.localSource = new LocalDiscoverySource();
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
    return Array.from(this.discoveredPeersMap.values());
  }

  public addBootstrapNodes(bootstrapMultiaddrs: readonly string[]): void {
    for (const addr of bootstrapMultiaddrs) {
      this.staticSource.addAddress(addr);
    }
  }

  private handleDiscoveredPeer(discovered: DiscoveredPeer): void {
    const existing = this.discoveredPeersMap.get(discovered.peerId);
    const mergedAddrs = existing
      ? Array.from(new Set([...existing.addresses, ...discovered.addresses]))
      : discovered.addresses;

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
  }
}
