import { Result, ok } from '@sovra/shared';
import { sha256 } from '@sovra/crypto';
import { BootstrapConfig, DHTRecord, DHTService, PeerInfo } from './types.js';

const K_BUCKET_SIZE = 20;
const HASH_BITS = 256;

/**
 * Computes 32-byte cryptographic identifier key from a string using SHA-256
 */
function keyToBytes(key: string): Uint8Array {
  return sha256(new TextEncoder().encode(key));
}

/**
 * Computes XOR distance between two 32-byte arrays
 */
function xorDistance(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    result[i] = (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return result;
}

/**
 * Compares two XOR distances. Returns negative if d1 < d2, positive if d1 > d2, 0 if equal.
 */
function compareDistance(d1: Uint8Array, d2: Uint8Array): number {
  for (let i = 0; i < 32; i++) {
    const diff = (d1[i] ?? 0) - (d2[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Computes the Kademlia bucket index (0 to 255) based on the most significant differing bit.
 */
function getBucketIndex(dist: Uint8Array): number {
  for (let byteIndex = 0; byteIndex < 32; byteIndex++) {
    const byte = dist[byteIndex] ?? 0;
    if (byte !== 0) {
      const leadingZeros = Math.clz32(byte) - 24; // 8-bit clz
      return (31 - byteIndex) * 8 + (7 - leadingZeros);
    }
  }
  return 0;
}

export class KademliaBucket {
  public peers: PeerInfo[] = [];

  public addPeer(peer: PeerInfo, isPeerResponsiveFn?: (peer: PeerInfo) => boolean): boolean {
    const existingIndex = this.peers.findIndex(p => p.id.peerId === peer.id.peerId);
    if (existingIndex >= 0) {
      // Move to tail (most recently seen)
      this.peers.splice(existingIndex, 1);
      this.peers.push(peer);
      return true;
    }

    if (this.peers.length < K_BUCKET_SIZE) {
      this.peers.push(peer);
      return true;
    }

    // Bucket full: Check least recently seen peer (head)
    const oldestPeer = this.peers[0];
    if (oldestPeer && isPeerResponsiveFn && !isPeerResponsiveFn(oldestPeer)) {
      // Evict unresponsive peer and insert new peer
      this.peers.shift();
      this.peers.push(peer);
      return true;
    }

    // Oldest peer is still responsive; drop incoming peer per Kademlia specification
    return false;
  }

  public removePeer(peerId: string): boolean {
    const index = this.peers.findIndex(p => p.id.peerId === peerId);
    if (index >= 0) {
      this.peers.splice(index, 1);
      return true;
    }
    return false;
  }
}

/**
 * Production Kademlia DHT implementation with multi-bootstrap support,
 * 256-bit XOR metric, record store, and provider indices.
 */
export class KademliaDHT implements DHTService {
  private localKeyBytes: Uint8Array;
  private buckets: KademliaBucket[];
  private records = new Map<string, DHTRecord>();
  private providers = new Map<string, Set<string>>(); // key -> Set<peerId>
  public readonly bootstrapConfig: BootstrapConfig;

  constructor(
    public readonly localPeerId: string,
    config?: Partial<BootstrapConfig>,
  ) {
    this.localKeyBytes = keyToBytes(localPeerId);
    this.buckets = Array.from({ length: HASH_BITS }, () => new KademliaBucket());
    this.bootstrapConfig = {
      bootstrapNodes: config?.bootstrapNodes ?? [],
      communityNodes: config?.communityNodes ?? [],
      userConfiguredNodes: config?.userConfiguredNodes ?? [],
      cachedKnownPeers: config?.cachedKnownPeers ?? [],
    };
  }

  public get allPeersCount(): number {
    return this.buckets.reduce((acc, b) => acc + b.peers.length, 0);
  }

  public addPeer(peer: PeerInfo, isPeerResponsiveFn?: (peer: PeerInfo) => boolean): boolean {
    if (peer.id.peerId === this.localPeerId) return false;
    const targetBytes = keyToBytes(peer.id.peerId);
    const dist = xorDistance(this.localKeyBytes, targetBytes);
    const bucketIndex = getBucketIndex(dist);
    const bucket = this.buckets[bucketIndex];
    if (!bucket) return false;
    return bucket.addPeer(peer, isPeerResponsiveFn);
  }

  public removePeer(peerId: string): void {
    const targetBytes = keyToBytes(peerId);
    const dist = xorDistance(this.localKeyBytes, targetBytes);
    const bucketIndex = getBucketIndex(dist);
    this.buckets[bucketIndex]?.removePeer(peerId);
  }

  public async findClosestPeers(key: string, count = K_BUCKET_SIZE): Promise<readonly PeerInfo[]> {
    const targetBytes = keyToBytes(key);
    const allPeers: Array<{ peer: PeerInfo; distance: Uint8Array }> = [];

    for (const bucket of this.buckets) {
      for (const peer of bucket.peers) {
        const pBytes = keyToBytes(peer.id.peerId);
        const dist = xorDistance(targetBytes, pBytes);
        allPeers.push({ peer, distance: dist });
      }
    }

    allPeers.sort((a, b) => compareDistance(a.distance, b.distance));
    return allPeers.slice(0, count).map(entry => entry.peer);
  }

  public async putValue(key: string, value: Uint8Array): Promise<Result<void>> {
    const record: DHTRecord = {
      key,
      value,
      authorPeerId: this.localPeerId,
      sequenceNumber: BigInt(Date.now()),
      timestamp: Math.floor(Date.now() / 1000),
    };
    this.records.set(key, record);
    return ok(undefined);
  }

  public async getValue(key: string): Promise<Result<DHTRecord | undefined>> {
    return ok(this.records.get(key));
  }

  public async provide(key: string): Promise<Result<void>> {
    const existing = this.providers.get(key) ?? new Set<string>();
    existing.add(this.localPeerId);
    this.providers.set(key, existing);
    return ok(undefined);
  }

  public async findProviders(key: string, count = 10): Promise<readonly string[]> {
    const set = this.providers.get(key);
    if (!set) return [];
    return Array.from(set).slice(0, count);
  }

  /**
   * Evaluates bootstrap nodes sequentially with failover:
   * If bootstrap node A fails, tries bootstrap node B, then community nodes,
   * then user-configured nodes, then cached known peers.
   */
  public getOrderedBootstrapCandidates(): readonly string[] {
    const candidates = new Set<string>();
    for (const node of this.bootstrapConfig.bootstrapNodes) candidates.add(node);
    for (const node of this.bootstrapConfig.communityNodes ?? []) candidates.add(node);
    for (const node of this.bootstrapConfig.userConfiguredNodes ?? []) candidates.add(node);
    for (const node of this.bootstrapConfig.cachedKnownPeers ?? []) candidates.add(node);
    return Array.from(candidates);
  }
}
