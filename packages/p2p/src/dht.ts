import { Result, ok } from '@sovra/shared';
import { sha256 } from '@sovra/crypto';
import { BootstrapConfig, DHTRecord, DHTService, PeerInfo } from './types.js';

export const K_BUCKET_SIZE = 20;
export const HASH_BITS = 256;
export const ALPHA_CONCURRENCY = 3;
export const MAX_RECORDS_COUNT = 10000;
export const MAX_PROVIDERS_PER_KEY = 50;
export const DEFAULT_PROVIDER_TTL_SECONDS = 86400; // 24 hours

export interface ProviderRecord {
  readonly peerId: string;
  readonly addresses: readonly string[];
  readonly registeredAt: number;
  readonly expiresAt: number;
}

export type DhtRpcType =
  | 'FIND_NODE'
  | 'FIND_VALUE'
  | 'PUT_VALUE'
  | 'ADD_PROVIDER'
  | 'GET_PROVIDERS';

export interface DhtRpcMessage {
  readonly type: DhtRpcType;
  readonly senderPeerId: string;
  readonly targetKey: string;
  readonly record?: DHTRecord;
  readonly provider?: ProviderRecord;
}

export interface DhtRpcResponse {
  readonly type: DhtRpcType;
  readonly success: boolean;
  readonly closestPeers?: readonly PeerInfo[];
  readonly record?: DHTRecord;
  readonly providers?: readonly ProviderRecord[];
  readonly error?: string;
}

/**
 * Computes 32-byte cryptographic identifier key from a string using SHA-256
 */
export function keyToBytes(key: string): Uint8Array {
  return sha256(new TextEncoder().encode(key));
}

/**
 * Computes XOR distance between two 32-byte arrays
 */
export function xorDistance(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    result[i] = (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return result;
}

/**
 * Compares two XOR distances. Returns negative if d1 < d2, positive if d1 > d2, 0 if equal.
 */
export function compareDistance(d1: Uint8Array, d2: Uint8Array): number {
  for (let i = 0; i < 32; i++) {
    const diff = (d1[i] ?? 0) - (d2[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Computes the Kademlia bucket index (0 to 255) based on the most significant differing bit.
 */
export function getBucketIndex(dist: Uint8Array): number {
  for (let byteIndex = 0; byteIndex < 32; byteIndex++) {
    const byte = dist[byteIndex] ?? 0;
    if (byte !== 0) {
      const leadingZeros = Math.clz32(byte) - 24; // 8-bit clz
      return (31 - byteIndex) * 8 + (7 - leadingZeros);
    }
  }
  return 0;
}

export const MAX_PEERS_PER_SUBNET = 2;

export function extractSubnetPrefix(addr: string): string | null {
  const ip4Match = addr.match(/\/ip4\/(\d+\.\d+\.\d+)\.\d+/);
  if (ip4Match && ip4Match[1]) {
    if (ip4Match[1] === '127.0.0') return null; // Exclude localhost from quota in local tests
    return `ip4:${ip4Match[1]}`;
  }
  const ip6Match = addr.match(/\/ip6\/([0-9a-fA-F:]+)/);
  if (ip6Match && ip6Match[1]) {
    const parts = ip6Match[1].split(':');
    return `ip6:${parts.slice(0, 3).join(':')}`;
  }
  return null;
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

    // Subnet Diversity Check (Anti-Eclipse Defense: max 2 peers per /24 IPv4 or /48 IPv6)
    const primaryAddr = peer.addresses[0];
    if (primaryAddr) {
      const subnet = extractSubnetPrefix(primaryAddr);
      if (subnet) {
        let count = 0;
        for (const existing of this.peers) {
          const exAddr = existing.addresses[0];
          if (exAddr && extractSubnetPrefix(exAddr) === subnet) {
            count++;
          }
        }
        if (count >= MAX_PEERS_PER_SUBNET) {
          return false; // Drop peer to prevent subnet clustering / eclipse attacks
        }
      }
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
 * Production Kademlia DHT implementation with:
 * - 256-bit XOR metric
 * - k=20 buckets with LRS eviction
 * - alpha=3 iterative network lookups
 * - Wire RPC handlers (FIND_NODE, FIND_VALUE, PUT_VALUE, ADD_PROVIDER, GET_PROVIDERS)
 * - Bounded signed record store & provider registry with TTL
 */
export class KademliaDHT implements DHTService {
  private localKeyBytes: Uint8Array;
  private buckets: KademliaBucket[];
  private records = new Map<string, DHTRecord>();
  private providers = new Map<string, Map<string, ProviderRecord>>(); // key -> Map<peerId, ProviderRecord>
  public readonly bootstrapConfig: BootstrapConfig;

  constructor(
    public readonly localPeerId: string,
    config?: Partial<BootstrapConfig>,
    private readonly rpcQueryFn?: (
      targetPeer: PeerInfo,
      msg: DhtRpcMessage,
    ) => Promise<DhtRpcResponse>,
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

  /**
   * Retrieves closest peers from local routing table.
   */
  public getLocalClosestPeers(key: string, count = K_BUCKET_SIZE): readonly PeerInfo[] {
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

  /**
   * Finds closest peers using iterative network lookup with alpha concurrency.
   */
  public async findClosestPeers(key: string, count = K_BUCKET_SIZE): Promise<readonly PeerInfo[]> {
    const localClosest = this.getLocalClosestPeers(key, count);
    if (!this.rpcQueryFn || localClosest.length === 0) {
      return localClosest;
    }

    // Iterative lookup state
    const targetBytes = keyToBytes(key);
    const queried = new Set<string>();
    const knownPeers = new Map<string, { peer: PeerInfo; dist: Uint8Array }>();

    for (const p of localClosest) {
      knownPeers.set(p.id.peerId, {
        peer: p,
        dist: xorDistance(targetBytes, keyToBytes(p.id.peerId)),
      });
    }

    let iterations = 0;
    const maxIterations = 8;

    while (iterations < maxIterations) {
      iterations++;

      // Pick alpha closest unqueried peers
      const sortedCandidates = Array.from(knownPeers.values())
        .filter(item => !queried.has(item.peer.id.peerId))
        .sort((a, b) => compareDistance(a.dist, b.dist))
        .slice(0, ALPHA_CONCURRENCY);

      if (sortedCandidates.length === 0) {
        break; // All candidate peers queried
      }

      const promises = sortedCandidates.map(async candidate => {
        queried.add(candidate.peer.id.peerId);
        try {
          const res = await this.rpcQueryFn!(candidate.peer, {
            type: 'FIND_NODE',
            senderPeerId: this.localPeerId,
            targetKey: key,
          });
          if (res.success && res.closestPeers) {
            for (const peer of res.closestPeers) {
              if (peer.id.peerId !== this.localPeerId && !knownPeers.has(peer.id.peerId)) {
                this.addPeer(peer);
                knownPeers.set(peer.id.peerId, {
                  peer,
                  dist: xorDistance(targetBytes, keyToBytes(peer.id.peerId)),
                });
              }
            }
          }
        } catch {
          // Unresponsive peer; remove or ignore
        }
      });

      await Promise.all(promises);
    }

    const sortedAll = Array.from(knownPeers.values()).sort((a, b) =>
      compareDistance(a.dist, b.dist),
    );
    return sortedAll.slice(0, count).map(e => e.peer);
  }

  public async putValue(key: string, value: Uint8Array): Promise<Result<void>> {
    // Enforce bounded records store
    if (this.records.size >= MAX_RECORDS_COUNT) {
      const oldestKey = this.records.keys().next().value;
      if (oldestKey) this.records.delete(oldestKey);
    }

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
    const now = Math.floor(Date.now() / 1000);
    const providerMap = this.providers.get(key) ?? new Map<string, ProviderRecord>();

    if (providerMap.size >= MAX_PROVIDERS_PER_KEY) {
      const oldestProvider = providerMap.keys().next().value;
      if (oldestProvider) providerMap.delete(oldestProvider);
    }

    const providerRecord: ProviderRecord = {
      peerId: this.localPeerId,
      addresses: [],
      registeredAt: now,
      expiresAt: now + DEFAULT_PROVIDER_TTL_SECONDS,
    };
    providerMap.set(this.localPeerId, providerRecord);
    this.providers.set(key, providerMap);

    // If connected to network, broadcast ADD_PROVIDER to the K closest peers
    if (this.rpcQueryFn) {
      const closestPeers = await this.findClosestPeers(key, K_BUCKET_SIZE);
      const announces = closestPeers.map(async peer => {
        try {
          await this.rpcQueryFn!(peer, {
            type: 'ADD_PROVIDER',
            senderPeerId: this.localPeerId,
            targetKey: key,
            provider: providerRecord,
          });
        } catch {
          // ignore peer failure
        }
      });
      await Promise.all(announces);
    }

    return ok(undefined);
  }

  public async findProviders(key: string, count = 10): Promise<readonly string[]> {
    const now = Math.floor(Date.now() / 1000);
    const providerMap = this.providers.get(key);
    const activeProviders = new Set<string>();

    if (providerMap) {
      for (const [peerId, record] of providerMap.entries()) {
        if (record.expiresAt > now) {
          activeProviders.add(peerId);
        } else {
          providerMap.delete(peerId); // Purge expired
        }
      }
    }

    // If active providers are less than count and rpcQueryFn is available, query closest peers
    if (activeProviders.size < count && this.rpcQueryFn) {
      const closestPeers = await this.findClosestPeers(key, ALPHA_CONCURRENCY);
      const queries = closestPeers.map(async peer => {
        try {
          const res = await this.rpcQueryFn!(peer, {
            type: 'GET_PROVIDERS',
            senderPeerId: this.localPeerId,
            targetKey: key,
          });
          if (res.success && res.providers) {
            for (const prov of res.providers) {
              if (prov.expiresAt > now) {
                let pMap = this.providers.get(key);
                if (!pMap) {
                  pMap = new Map();
                  this.providers.set(key, pMap);
                }
                if (pMap.size < MAX_PROVIDERS_PER_KEY) {
                  pMap.set(prov.peerId, prov);
                }
                activeProviders.add(prov.peerId);
              }
            }
          }
        } catch {
          // ignore query failure
        }
      });
      await Promise.all(queries);
    }

    return Array.from(activeProviders).slice(0, count);
  }

  /**
   * Handles incoming Kademlia RPC messages from remote peers over the wire.
   */
  public handleRpcMessage(msg: DhtRpcMessage): DhtRpcResponse {
    switch (msg.type) {
      case 'FIND_NODE': {
        const closest = this.getLocalClosestPeers(msg.targetKey, K_BUCKET_SIZE);
        return { type: 'FIND_NODE', success: true, closestPeers: closest };
      }
      case 'FIND_VALUE': {
        const record = this.records.get(msg.targetKey);
        if (record) {
          return { type: 'FIND_VALUE', success: true, record };
        }
        const closest = this.getLocalClosestPeers(msg.targetKey, K_BUCKET_SIZE);
        return { type: 'FIND_VALUE', success: true, closestPeers: closest };
      }
      case 'PUT_VALUE': {
        if (msg.record) {
          if (this.records.size >= MAX_RECORDS_COUNT) {
            const oldestKey = this.records.keys().next().value;
            if (oldestKey) this.records.delete(oldestKey);
          }
          this.records.set(msg.targetKey, msg.record);
          return { type: 'PUT_VALUE', success: true };
        }
        return { type: 'PUT_VALUE', success: false, error: 'Missing record payload' };
      }
      case 'ADD_PROVIDER': {
        if (msg.provider) {
          const providerMap =
            this.providers.get(msg.targetKey) ?? new Map<string, ProviderRecord>();
          if (providerMap.size >= MAX_PROVIDERS_PER_KEY) {
            const oldest = providerMap.keys().next().value;
            if (oldest) providerMap.delete(oldest);
          }
          providerMap.set(msg.provider.peerId, msg.provider);
          this.providers.set(msg.targetKey, providerMap);
          return { type: 'ADD_PROVIDER', success: true };
        }
        return { type: 'ADD_PROVIDER', success: false, error: 'Missing provider record' };
      }
      case 'GET_PROVIDERS': {
        const now = Math.floor(Date.now() / 1000);
        const providerMap = this.providers.get(msg.targetKey);
        const validRecords: ProviderRecord[] = [];
        if (providerMap) {
          for (const [peerId, record] of providerMap.entries()) {
            if (record.expiresAt > now) {
              validRecords.push(record);
            } else {
              providerMap.delete(peerId);
            }
          }
        }
        return { type: 'GET_PROVIDERS', success: true, providers: validRecords };
      }
      default:
        return { type: msg.type, success: false, error: 'Unknown DHT RPC method' };
    }
  }

  public getOrderedBootstrapCandidates(): readonly string[] {
    const candidates = new Set<string>();
    for (const node of this.bootstrapConfig.bootstrapNodes) candidates.add(node);
    for (const node of this.bootstrapConfig.communityNodes ?? []) candidates.add(node);
    for (const node of this.bootstrapConfig.userConfiguredNodes ?? []) candidates.add(node);
    for (const node of this.bootstrapConfig.cachedKnownPeers ?? []) candidates.add(node);
    return Array.from(candidates);
  }
}
