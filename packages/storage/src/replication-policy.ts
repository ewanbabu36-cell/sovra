import { blake3Hash, canonicalCborEncode, hexToBytes, sha256, bytesToHex, signEd25519, verifyEd25519 } from '@sovra/crypto';
import { CID } from './cid.js';
import { Result, err, ok } from '@sovra/shared';

export type ContentImportanceTier =
  | 'temporary_cache'
  | 'ordinary_public'
  | 'important_public'
  | 'critical_release'
  | 'private_encrypted';

export const REPLICATION_TARGETS: Record<ContentImportanceTier, number> = {
  temporary_cache: 1,
  ordinary_public: 3,
  important_public: 5,
  critical_release: 5,
  private_encrypted: 1,
};

export interface ReplicaProviderDescriptor {
  readonly peerId: string;
  readonly operatorId: string;
  readonly networkSubnetOrAsn: string;
  readonly geoRegion?: string | undefined;
  readonly expiresAt?: number | undefined;
}

export interface RetentionPolicy {
  readonly tier: ContentImportanceTier;
  readonly minimumRetentionSeconds: number;
  readonly maxTtlSeconds?: number | undefined;
  readonly pinned: boolean;
}

export interface SignedStorageReceipt {
  readonly version: 1;
  readonly receiptId: string;
  readonly cid: string;
  readonly providerPeerId: string;
  readonly providerPublicKeyHex: string;
  readonly operatorId: string;
  readonly byteLength: number;
  readonly storedAt: number;
  readonly expiresAt: number;
  readonly signatureHex: string;
}

const receiptEncoder = new TextEncoder();

export function createSignedStorageReceipt(
  params: Omit<SignedStorageReceipt, 'version' | 'signatureHex'>,
  providerPrivateKey: Uint8Array,
): SignedStorageReceipt {
  const unsigned = { version: 1 as const, ...params };
  const cbor = canonicalCborEncode(unsigned);
  const tag = receiptEncoder.encode('SOVRA-STORE-RCPT-v1');
  const digest = sha256(new Uint8Array([...tag, ...cbor]));
  return {
    ...unsigned,
    signatureHex: bytesToHex(signEd25519(providerPrivateKey, digest)),
  };
}

/**
 * Verifies a provider's signed storage acceptance receipt.
 * Note per IA-01 Sec 5: a storage receipt or PoR proves capability under the challenge model,
 * NEVER unconditional permanent future availability.
 */
export function verifySignedStorageReceipt(
  receipt: SignedStorageReceipt,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (
    !receipt ||
    receipt.version !== 1 ||
    nowSec > receipt.expiresAt ||
    receipt.storedAt > receipt.expiresAt ||
    receipt.byteLength <= 0 ||
    !receipt.providerPeerId ||
    !receipt.operatorId
  ) {
    return false;
  }
  try {
    CID.parse(receipt.cid);
    const { signatureHex, ...unsigned } = receipt;
    const cbor = canonicalCborEncode(unsigned);
    const tag = receiptEncoder.encode('SOVRA-STORE-RCPT-v1');
    const digest = sha256(new Uint8Array([...tag, ...cbor]));
    return verifyEd25519(hexToBytes(receipt.providerPublicKeyHex), digest, hexToBytes(signatureHex));
  } catch {
    return false;
  }
}

export interface ReplicaDiversityReport {
  readonly totalProviders: number;
  readonly independentFailureDomains: number;
  readonly requiredTarget: number;
  readonly satisfiesTarget: boolean;
  readonly reason: string;
}

/**
 * Counts independent failure domains: multiple nodes controlled by the same operator or same
 * network/ASN count as a SINGLE failure domain (RFC SOVRA-STORE Section 8.3).
 */
export function evaluateReplicationDiversity(
  tier: ContentImportanceTier,
  providers: readonly ReplicaProviderDescriptor[],
): ReplicaDiversityReport {
  const requiredTarget = REPLICATION_TARGETS[tier];
  const uniqueOperators = new Set<string>();
  const uniqueSubnets = new Set<string>();

  for (const p of providers) {
    if (p.operatorId) uniqueOperators.add(p.operatorId.toLowerCase());
    if (p.networkSubnetOrAsn) uniqueSubnets.add(p.networkSubnetOrAsn.toLowerCase());
  }

  // Independent domains bounded by distinct operators and distinct network domains
  const independentFailureDomains = Math.min(uniqueOperators.size, uniqueSubnets.size);
  const satisfiesTarget = independentFailureDomains >= requiredTarget;

  return {
    totalProviders: providers.length,
    independentFailureDomains,
    requiredTarget,
    satisfiesTarget,
    reason: satisfiesTarget
      ? `OK: ${independentFailureDomains} independent failure domains >= ${requiredTarget}`
      : `UNDER_REPLICATED: ${independentFailureDomains} independent failure domains < ${requiredTarget} (raw nodes=${providers.length})`,
  };
}

export interface StorageObjectMetadata {
  readonly cid: string;
  readonly codec: 'raw' | 'dag-pb' | 'dag-cbor';
  readonly expectedByteLength: number;
  readonly expectedSha256Hex?: string | undefined;
  readonly encrypted?: boolean | undefined;
  readonly authorSignatureValid?: boolean | undefined;
}

export function verifyStorageObjectFivePoint(
  data: Uint8Array,
  meta: StorageObjectMetadata,
): Result<true, Error> {
  // 1. CID multihash match
  let parsed: CID;
  try {
    parsed = CID.parse(meta.cid);
  } catch {
    return err(new Error(`Invalid CID '${meta.cid}'`));
  }
  const actualDigest = parsed.multihashType === 'blake3' ? blake3Hash(data) : sha256(data);
  if (bytesToHex(actualDigest) !== bytesToHex(parsed.digest)) {
    return err(new Error(`CID multihash verification failed for '${meta.cid}'`));
  }
  // 2. Object byte length
  if (data.byteLength !== meta.expectedByteLength) {
    return err(
      new Error(`Byte length mismatch: expected ${meta.expectedByteLength}, got ${data.byteLength}`),
    );
  }
  // 3. Codec match
  if (parsed.codec !== meta.codec) {
    return err(new Error(`Codec mismatch: CID specifies '${parsed.codec}', expected '${meta.codec}'`));
  }
  // 4. Optional author signature status
  if (meta.authorSignatureValid === false) {
    return err(new Error('Author signature check failed'));
  }
  // 5. Private encryption metadata check
  if (meta.encrypted && meta.expectedSha256Hex && bytesToHex(sha256(data)) !== meta.expectedSha256Hex) {
    return err(new Error('Encrypted blob digest mismatch'));
  }
  return ok(true);
}

/**
 * Tracks all 10 Section 8.4 storage operations including signed receipts, retention policies,
 * provider expiration pruning, unavailable reports & repair queues.
 */
export class StorageOperationTracker {
  private readonly pinned = new Set<string>();
  private readonly retentionPolicies = new Map<string, RetentionPolicy>();
  private readonly receipts = new Map<string, SignedStorageReceipt[]>();
  private readonly providers = new Map<string, Map<string, ReplicaProviderDescriptor>>();
  private readonly unavailableReports = new Map<string, Set<string>>();
  private readonly repairQueue: Array<{ cid: string; reason: string; queuedAt: number }> = [];

  public pinObject(cid: string, policy?: RetentionPolicy | undefined): void {
    this.pinned.add(cid);
    if (policy) this.retentionPolicies.set(cid, policy);
  }

  public unpinObject(cid: string): void {
    this.pinned.delete(cid);
    this.retentionPolicies.delete(cid);
  }

  public isPinned(cid: string): boolean {
    return this.pinned.has(cid);
  }

  public getRetentionPolicy(cid: string): RetentionPolicy | undefined {
    return this.retentionPolicies.get(cid);
  }

  public recordSignedReceipt(receipt: SignedStorageReceipt, nowSec = Math.floor(Date.now() / 1000)): boolean {
    if (!verifySignedStorageReceipt(receipt, nowSec)) return false;
    const list = this.receipts.get(receipt.cid) ?? [];
    if (list.some((r) => r.receiptId === receipt.receiptId)) return false;
    list.push(receipt);
    this.receipts.set(receipt.cid, list);
    return true;
  }

  public getSignedReceipts(cid: string): readonly SignedStorageReceipt[] {
    return this.receipts.get(cid) ?? [];
  }

  public advertiseProvider(cid: string, provider: ReplicaProviderDescriptor): void {
    let map = this.providers.get(cid);
    if (!map) {
      map = new Map();
      this.providers.set(cid, map);
    }
    map.set(provider.peerId, provider);
  }

  public pruneExpiredProviders(cid: string, nowSec = Math.floor(Date.now() / 1000)): number {
    const map = this.providers.get(cid);
    if (!map) return 0;
    let removed = 0;
    for (const [peerId, p] of map.entries()) {
      if (p.expiresAt !== undefined && nowSec > p.expiresAt) {
        map.delete(peerId);
        removed++;
      }
    }
    return removed;
  }

  public findProviders(cid: string, nowSec = Math.floor(Date.now() / 1000)): ReplicaProviderDescriptor[] {
    const list = [...(this.providers.get(cid)?.values() ?? [])];
    return list.filter((p) => p.expiresAt === undefined || nowSec <= p.expiresAt);
  }

  public reportUnavailable(cid: string, peerId: string): ReplicaDiversityReport {
    this.providers.get(cid)?.delete(peerId);
    let rep = this.unavailableReports.get(cid);
    if (!rep) {
      rep = new Set();
      this.unavailableReports.set(cid, rep);
    }
    rep.add(peerId);
    this.repairQueue.push({ cid, reason: `Peer ${peerId} unavailable`, queuedAt: Math.floor(Date.now() / 1000) });
    return evaluateReplicationDiversity('ordinary_public', this.findProviders(cid));
  }

  public getRepairQueue(): readonly { cid: string; reason: string; queuedAt: number }[] {
    return [...this.repairQueue];
  }

  public repairReplica(cid: string, newProvider: ReplicaProviderDescriptor): ReplicaDiversityReport {
    this.advertiseProvider(cid, newProvider);
    return evaluateReplicationDiversity('ordinary_public', this.findProviders(cid));
  }
}
