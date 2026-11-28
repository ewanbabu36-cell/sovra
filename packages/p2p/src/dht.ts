import { Result, ok } from '@sovra/shared';
import { sha256, verifyEd25519, hexToBytes, bytesToHex } from '@sovra/crypto';
import { BootstrapConfig, DHTRecord, DHTService, PeerInfo } from './types.js';
import { extractPublicKeyFromPeerId } from './identity.js';

export const K_BUCKET_SIZE = 20;
export const HASH_BITS = 256;
export const ALPHA_CONCURRENCY = 3;
export const MAX_RECORDS_COUNT = 10000;
export const MAX_PROVIDERS_PER_KEY = 50;
export const DEFAULT_PROVIDER_TTL_SECONDS = 86400; // 24 hours
export const MAX_DHT_FUTURE_SKEW_SECONDS = 300;
export const MAX_PEER_MULTIADDRS = 16;

export interface ProviderRecord {
  readonly peerId: string;
  readonly addresses: readonly string[];
  readonly registeredAt: number;
  readonly expiresAt: number;
  readonly signature?: string | undefined;
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
export const MAX_ONION_PEERS_TOTAL = 8;

export function extractSubnetPrefix(addr: string): string | null {
  const ip4Match = addr.match(/\/ip4\/(\d+\.\d+\.\d+)\.\d+/);
  if (ip4Match && ip4Match[1]) {
    if (ip4Match[1] === '127.0.0') return null; // Exclude localhost from quota in local tests
    return `ip4:${ip4Match[1]}`;
  }
  const ip6Match = addr.match(/\/ip6\/([0-9a-fA-F:]+)/);
  if (ip6Match && ip6Match[1]) {
    const raw6 = ip6Match[1].toLowerCase();
    if (raw6 === '::1') return null;
    const parts = raw6.split(':');
    return `ip6:${parts.slice(0, 3).join(':')}`;
  }
  return null;
}

function isOnionAddr(addr: string): boolean {
  const lower = addr.toLowerCase();
  return lower.includes('/onion/') || lower.includes('/onion3/');
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
const textEncoder = new TextEncoder();

function coerceUint8Array(val: unknown): Uint8Array {
  if (val instanceof Uint8Array) return val;
  if (Array.isArray(val)) return Uint8Array.from(val);
  if (val && typeof val === 'object') {
    if (Array.isArray((val as any).__u8)) {
      return Uint8Array.from((val as any).__u8);
    }
    const obj = val as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length > 0 && keys.every((k, i) => k === String(i) && typeof obj[k] === 'number')) {
      return Uint8Array.from(keys.map(k => obj[k] as number));
    }
  }
  return new Uint8Array(0);
}

export function buildDhtRecordSignableBytes(
  record: Pick<DHTRecord, 'key' | 'value' | 'authorPeerId' | 'sequenceNumber' | 'timestamp' | 'expiresAt'>,
): Uint8Array {
  const valBytes = coerceUint8Array(record.value);
  const valHashHex = bytesToHex(sha256(valBytes));
  const canonical = JSON.stringify({
    tag: 'SOVRA-DHT-REC-v1',
    key: record.key,
    authorPeerId: record.authorPeerId,
    sequenceNumber: record.sequenceNumber.toString(),
    timestamp: record.timestamp,
    expiresAt: record.expiresAt ?? 0,
    valueSha256Hex: valHashHex,
  });
  return sha256(textEncoder.encode(canonical));
}

export function buildProviderRecordSignableBytes(
  targetKey: string,
  provider: Pick<ProviderRecord, 'peerId' | 'addresses' | 'registeredAt' | 'expiresAt'>,
): Uint8Array {
  const canonical = JSON.stringify({
    tag: 'SOVRA-DHT-PROV-v1',
    targetKey,
    peerId: provider.peerId,
    addresses: [...provider.addresses],
    registeredAt: provider.registeredAt,
    expiresAt: provider.expiresAt,
  });
  return sha256(textEncoder.encode(canonical));
}

export interface KademliaDhtSecurityOptions {
  readonly requireSignedRecords?: boolean;
  readonly signDigest?: (digest: Uint8Array) => Uint8Array;
}

export class KademliaDHT implements DHTService {
  private localKeyBytes: Uint8Array;
  private buckets: KademliaBucket[];
  private records = new Map<string, DHTRecord>();
  private providers = new Map<string, Map<string, ProviderRecord>>(); // key -> Map<peerId, ProviderRecord>
  private localAddresses: string[] = [];
  private readonly requireSignedRecords: boolean;
  private readonly signDigest?: ((digest: Uint8Array) => Uint8Array) | undefined;
  public readonly bootstrapConfig: BootstrapConfig;

  constructor(
    public readonly localPeerId: string,
    config?: Partial<BootstrapConfig>,
    private readonly rpcQueryFn?: (
      targetPeer: PeerInfo,
      msg: DhtRpcMessage,
    ) => Promise<DhtRpcResponse>,
    securityOptions: KademliaDhtSecurityOptions = {},
  ) {
    this.localKeyBytes = keyToBytes(localPeerId);
    this.buckets = Array.from({ length: HASH_BITS }, () => new KademliaBucket());
    this.requireSignedRecords = Boolean(securityOptions.requireSignedRecords);
    this.signDigest = securityOptions.signDigest;
    this.bootstrapConfig = {
      bootstrapNodes: config?.bootstrapNodes ?? [],
      communityNodes: config?.communityNodes ?? [],
      userConfiguredNodes: config?.userConfiguredNodes ?? [],
      cachedKnownPeers: config?.cachedKnownPeers ?? [],
    };
  }

  public setLocalAddresses(addrs: readonly string[]): void {
    this.localAddresses = Array.from(new Set(addrs.filter(Boolean))).slice(0, MAX_PEER_MULTIADDRS);
  }

  public get allPeersCount(): number {
    return this.buckets.reduce((acc, b) => acc + b.peers.length, 0);
  }

  private extractPeerQuotas(addresses: readonly string[]): { subnets: Set<string>; hasOnion: boolean } {
    const subnets = new Set<string>();
    let hasOnion = false;
    for (const addr of addresses.slice(0, MAX_PEER_MULTIADDRS)) {
      if (isOnionAddr(addr)) {
        hasOnion = true;
        continue;
      }
      const sub = extractSubnetPrefix(addr);
      if (sub) subnets.add(sub);
    }
    return { subnets, hasOnion };
  }

  private countGlobalPrefixAndOnions(excludePeerId?: string): { subnetCounts: Map<string, number>; onionCount: number } {
    const subnetCounts = new Map<string, number>();
    let onionCount = 0;
    for (const bucket of this.buckets) {
      for (const existing of bucket.peers) {
        if (excludePeerId && existing.id.peerId === excludePeerId) continue;
        const { subnets, hasOnion } = this.extractPeerQuotas(existing.addresses);
        if (hasOnion) onionCount++;
        for (const sub of subnets) {
          subnetCounts.set(sub, (subnetCounts.get(sub) ?? 0) + 1);
        }
      }
    }
    return { subnetCounts, onionCount };
  }

  public addPeer(peer: PeerInfo, isPeerResponsiveFn?: (peer: PeerInfo) => boolean): boolean {
    if (!peer?.id?.peerId || peer.id.peerId === this.localPeerId) return false;
    if (!Array.isArray(peer.addresses) || peer.addresses.length > MAX_PEER_MULTIADDRS) return false;
    const { subnets, hasOnion } = this.extractPeerQuotas(peer.addresses);
    if (subnets.size > 0 || hasOnion) {
      const { subnetCounts, onionCount } = this.countGlobalPrefixAndOnions(peer.id.peerId);
      if (hasOnion && onionCount >= MAX_ONION_PEERS_TOTAL) {
        return false; // Bound .onion Sybil flooding globally across routing table
      }
      for (const subnet of subnets) {
        if ((subnetCounts.get(subnet) ?? 0) >= MAX_PEERS_PER_SUBNET) {
          return false; // Global anti-eclipse defense across ALL multiaddrs & ALL buckets
        }
      }
    }
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

  public async putValue(key: string, value: Uint8Array, ttlSeconds?: number): Promise<Result<void>> {
    // Enforce bounded records store
    if (this.records.size >= MAX_RECORDS_COUNT) {
      const oldestKey = this.records.keys().next().value;
      if (oldestKey) this.records.delete(oldestKey);
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const prev = this.records.get(key);
    const baseSeq = BigInt(Date.now());
    const sequenceNumber = prev && prev.sequenceNumber >= baseSeq ? prev.sequenceNumber + 1n : baseSeq;
    const unsignedRecord = {
      key,
      value,
      authorPeerId: this.localPeerId,
      sequenceNumber,
      timestamp: nowSec,
      ...(ttlSeconds !== undefined && ttlSeconds > 0 ? { expiresAt: nowSec + ttlSeconds } : {}),
    };
    const signature = this.signDigest
      ? bytesToHex(this.signDigest(buildDhtRecordSignableBytes(unsignedRecord)))
      : undefined;
    const record: DHTRecord = {
      ...unsignedRecord,
      ...(signature ? { signature } : {}),
    };
    this.records.set(key, record);
    return ok(undefined);
  }

  public async getValue(key: string): Promise<Result<DHTRecord | undefined>> {
    const rec = this.records.get(key);
    const nowSec = Math.floor(Date.now() / 1000);
    if (rec && rec.expiresAt !== undefined && rec.expiresAt <= nowSec) {
      this.records.delete(key);
      return ok(undefined);
    }
    return ok(rec);
  }

  public async provide(key: string): Promise<Result<void>> {
    const now = Math.floor(Date.now() / 1000);
    const providerMap = this.providers.get(key) ?? new Map<string, ProviderRecord>();

    if (providerMap.size >= MAX_PROVIDERS_PER_KEY) {
      const oldestProvider = providerMap.keys().next().value;
      if (oldestProvider) providerMap.delete(oldestProvider);
    }

    const unsignedProvider = {
      peerId: this.localPeerId,
      addresses: [...this.localAddresses],
      registeredAt: now,
      expiresAt: now + DEFAULT_PROVIDER_TTL_SECONDS,
    };
    const signature = this.signDigest
      ? bytesToHex(this.signDigest(buildProviderRecordSignableBytes(key, unsignedProvider)))
      : undefined;
    const providerRecord: ProviderRecord = {
      ...unsignedProvider,
      ...(signature ? { signature } : {}),
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

  private verifyRecordCryptographicAuth(record: DHTRecord): { ok: true; verified: boolean } | { ok: false; error: string } {
    if (!record.signature) {
      return this.requireSignedRecords
        ? { ok: false, error: 'Missing Ed25519 signature on DHT record' }
        : { ok: true, verified: false };
    }
    try {
      const pubBytes = extractPublicKeyFromPeerId(record.authorPeerId);
      const sigBytes = hexToBytes(record.signature);
      if (sigBytes.length !== 64) {
        return { ok: false, error: 'Malformed DHT record signature length' };
      }
      const digest = buildDhtRecordSignableBytes(record);
      if (!verifyEd25519(pubBytes, digest, sigBytes)) {
        return { ok: false, error: 'Invalid Ed25519 signature on DHT record' };
      }
      return { ok: true, verified: true };
    } catch {
      return { ok: false, error: 'Invalid Ed25519 authorPeerId or signature encoding' };
    }
  }

  private verifyProviderCryptographicAuth(
    targetKey: string,
    provider: ProviderRecord,
  ): { ok: true; verified: boolean } | { ok: false; error: string } {
    if (!provider.signature) {
      return this.requireSignedRecords
        ? { ok: false, error: 'Missing Ed25519 signature on provider record' }
        : { ok: true, verified: false };
    }
    try {
      const pubBytes = extractPublicKeyFromPeerId(provider.peerId);
      const sigBytes = hexToBytes(provider.signature);
      if (sigBytes.length !== 64) {
        return { ok: false, error: 'Malformed provider record signature length' };
      }
      const digest = buildProviderRecordSignableBytes(targetKey, provider);
      if (!verifyEd25519(pubBytes, digest, sigBytes)) {
        return { ok: false, error: 'Invalid Ed25519 signature on provider record' };
      }
      return { ok: true, verified: true };
    } catch {
      return { ok: false, error: 'Invalid Ed25519 provider peerId or signature encoding' };
    }
  }

  private validateProviderAddressesOwnership(provider: ProviderRecord): string | null {
    if (!Array.isArray(provider.addresses) || provider.addresses.length > MAX_PEER_MULTIADDRS) {
      return 'Provider addresses missing or exceeds maximum multiaddr limit';
    }
    for (const rawAddr of provider.addresses) {
      if (typeof rawAddr !== 'string' || rawAddr.trim().length === 0) {
        return 'Malformed empty provider multiaddr';
      }
      const p2pMatch = rawAddr.match(/\/p2p\/([^/]+)/);
      if (p2pMatch && p2pMatch[1] && p2pMatch[1] !== provider.peerId) {
        return `Provider multiaddr /p2p/${p2pMatch[1]} does not match claimed peerId ${provider.peerId}`;
      }
    }
    return null;
  }

  /**
   * Handles incoming Kademlia RPC messages from remote peers over the wire.
   * Enforces Noise_XX authenticated sender binding, Ed25519 record signatures,
   * anti-spoofing, sequence monotonicity, replay/expiry checks, and TTL bounds.
   */
  public handleRpcMessage(msg: DhtRpcMessage, authenticatedSenderPeerId?: string): DhtRpcResponse {
    if (authenticatedSenderPeerId && msg.senderPeerId && msg.senderPeerId !== authenticatedSenderPeerId) {
      return { type: msg.type, success: false, error: 'Authenticated senderPeerId mismatch' };
    }
    const effectiveSender = authenticatedSenderPeerId ?? msg.senderPeerId;
    const now = Math.floor(Date.now() / 1000);

    switch (msg.type) {
      case 'FIND_NODE': {
        const closest = this.getLocalClosestPeers(msg.targetKey, K_BUCKET_SIZE);
        return { type: 'FIND_NODE', success: true, closestPeers: closest };
      }
      case 'FIND_VALUE': {
        const record = this.records.get(msg.targetKey);
        if (record) {
          if (record.expiresAt !== undefined && record.expiresAt <= now) {
            this.records.delete(msg.targetKey);
          } else {
            return { type: 'FIND_VALUE', success: true, record };
          }
        }
        const closest = this.getLocalClosestPeers(msg.targetKey, K_BUCKET_SIZE);
        return { type: 'FIND_VALUE', success: true, closestPeers: closest };
      }
      case 'PUT_VALUE': {
        if (!msg.record || !msg.record.authorPeerId) {
          return { type: 'PUT_VALUE', success: false, error: 'Missing record payload or authorPeerId' };
        }
        if (msg.record.key !== msg.targetKey) {
          return { type: 'PUT_VALUE', success: false, error: 'DHT record key mismatches targetKey' };
        }
        if (msg.record.timestamp > now + MAX_DHT_FUTURE_SKEW_SECONDS) {
          return { type: 'PUT_VALUE', success: false, error: 'DHT record future timestamp skew rejected' };
        }
        if (msg.record.expiresAt !== undefined && msg.record.expiresAt <= now) {
          return { type: 'PUT_VALUE', success: false, error: 'Expired DHT record rejected' };
        }
        const authRes = this.verifyRecordCryptographicAuth(msg.record);
        if (!authRes.ok) {
          return { type: 'PUT_VALUE', success: false, error: authRes.error };
        }
        if (effectiveSender && msg.record.authorPeerId !== effectiveSender && !authRes.verified) {
          return { type: 'PUT_VALUE', success: false, error: 'PUT_VALUE authorPeerId does not match authenticated sender' };
        }
        const normalizedRecord: DHTRecord = {
          ...msg.record,
          value: coerceUint8Array(msg.record.value),
          sequenceNumber: BigInt(msg.record.sequenceNumber),
        };
        const existing = this.records.get(msg.targetKey);
        if (existing) {
          if (normalizedRecord.sequenceNumber < existing.sequenceNumber) {
            return { type: 'PUT_VALUE', success: false, error: 'Stale DHT record sequence number rejected' };
          }
          if (normalizedRecord.sequenceNumber === existing.sequenceNumber && normalizedRecord.timestamp <= existing.timestamp) {
            return { type: 'PUT_VALUE', success: false, error: 'Duplicate or stale-timestamp DHT record replay rejected' };
          }
        }
        if (this.records.size >= MAX_RECORDS_COUNT) {
          const oldestKey = this.records.keys().next().value;
          if (oldestKey) this.records.delete(oldestKey);
        }
        this.records.set(msg.targetKey, normalizedRecord);
        return { type: 'PUT_VALUE', success: true };
      }
      case 'ADD_PROVIDER': {
        if (!msg.provider || !msg.provider.peerId) {
          return { type: 'ADD_PROVIDER', success: false, error: 'Missing provider record or peerId' };
        }
        const addrOwnershipErr = this.validateProviderAddressesOwnership(msg.provider);
        if (addrOwnershipErr) {
          return { type: 'ADD_PROVIDER', success: false, error: addrOwnershipErr };
        }
        const provAuth = this.verifyProviderCryptographicAuth(msg.targetKey, msg.provider);
        if (!provAuth.ok) {
          return { type: 'ADD_PROVIDER', success: false, error: provAuth.error };
        }
        if (effectiveSender && msg.provider.peerId !== effectiveSender && !provAuth.verified) {
          return { type: 'ADD_PROVIDER', success: false, error: 'ADD_PROVIDER peerId does not match authenticated sender' };
        }
        if (msg.provider.registeredAt > now + MAX_DHT_FUTURE_SKEW_SECONDS) {
          return { type: 'ADD_PROVIDER', success: false, error: 'Provider record future timestamp skew rejected' };
        }
        if (msg.provider.expiresAt <= now) {
          return { type: 'ADD_PROVIDER', success: false, error: 'Expired provider record rejected' };
        }
        const boundedExpiresAt = provAuth.verified
          ? Math.min(msg.provider.expiresAt, msg.provider.registeredAt + DEFAULT_PROVIDER_TTL_SECONDS)
          : Math.min(msg.provider.expiresAt, now + DEFAULT_PROVIDER_TTL_SECONDS);
        if (boundedExpiresAt <= now) {
          return { type: 'ADD_PROVIDER', success: false, error: 'Expired provider record TTL rejected' };
        }
        const existingMap = this.providers.get(msg.targetKey);
        const existingProv = existingMap?.get(msg.provider.peerId);
        if (existingProv && msg.provider.registeredAt < existingProv.registeredAt) {
          return { type: 'ADD_PROVIDER', success: false, error: 'Stale provider timestamp replay rejected' };
        }
        const normalizedProvider: ProviderRecord = {
          ...msg.provider,
          expiresAt: boundedExpiresAt,
        };
        const providerMap =
          existingMap ?? new Map<string, ProviderRecord>();
        if (providerMap.size >= MAX_PROVIDERS_PER_KEY) {
          const oldest = providerMap.keys().next().value;
          if (oldest) providerMap.delete(oldest);
        }
        providerMap.set(normalizedProvider.peerId, normalizedProvider);
        this.providers.set(msg.targetKey, providerMap);
        return { type: 'ADD_PROVIDER', success: true };
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
