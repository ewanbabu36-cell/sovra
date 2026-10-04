import type { SovraP2PNode } from '@sovra/p2p';

export type PinStatus = 'active' | 'expired' | 'under_replicated' | 'healthy';

export interface PinRecord {
  readonly cid: string;
  readonly pinnedAt: number;
  expiresAt?: number | undefined;
  creatorDid?: string | undefined;
  targetReplicationFactor: number;
  byteSize: number;
  status: PinStatus;
  replicaCount: number;
  lastVerifiedAt: number;
  childCids: readonly string[];
}

export interface PinOptions {
  readonly expiresAt?: number | undefined;
  readonly ttlMs?: number | undefined;
  readonly creatorDid?: string | undefined;
  readonly targetReplicationFactor?: number | undefined;
  readonly recursive?: boolean | undefined;
}

export interface StorageQuotaConfig {
  readonly maxCapacityBytes: bigint;
  readonly highWatermarkPercent: number; // default: 85
  readonly lowWatermarkPercent: number;  // default: 70
  readonly maxAuthorQuotaBytes?: bigint | undefined;
}

export interface StorageQuotaUsage {
  readonly totalCapacityBytes: bigint;
  readonly usedBytes: bigint;
  readonly pinnedBytes: bigint;
  readonly cachedBytes: bigint;
  readonly usagePercent: number;
  readonly isHighWatermarkExceeded: boolean;
  readonly authorUsage: Readonly<Record<string, bigint>>;
}

export interface GarbageCollectionResult {
  readonly blocksEvicted: number;
  readonly bytesFreed: bigint;
  readonly startingUsedBytes: bigint;
  readonly endingUsedBytes: bigint;
  readonly durationMs: number;
}

export interface ReplicaVerificationItem {
  readonly cid: string;
  readonly targetReplicationFactor: number;
  readonly actualReplicas: number;
  readonly status: PinStatus;
  readonly repaired: boolean;
}

export interface ReplicaVerificationReport {
  readonly timestamp: number;
  readonly totalPinsChecked: number;
  readonly healthyCount: number;
  readonly underReplicatedCount: number;
  readonly expiredCount: number;
  readonly repairsTriggered: number;
  readonly items: readonly ReplicaVerificationItem[];
}

export interface StorageNodeConfig {
  readonly storagePath: string;
  readonly maxCapacityBytes: bigint;
  readonly enableBitswap: boolean;
  readonly memoryCacheBytes?: number | undefined;
  readonly p2pNode?: SovraP2PNode | undefined;
  readonly quotas?: Partial<StorageQuotaConfig> | undefined;
  readonly replicaVerificationIntervalMs?: number | undefined; // 0 = disabled
  readonly pinLeaseSweeperIntervalMs?: number | undefined;       // 0 = disabled
  readonly jurisdictionProfile?: JurisdictionProfile | undefined;
}

export type JurisdictionProfile =
  | 'GLOBAL_CSAM_ONLY'
  | 'US_DMCA_COMPLIANT'
  | 'EU_DSA_STRICT'
  | 'IN_IT_ACT_INTERMEDIARY';

export interface StorageNodeStats {
  readonly totalBlocks: number;
  readonly totalSizeBytes: number;
  readonly maxCapacityBytes: bigint;
  readonly pinnedCount: number;
  readonly activePinsCount: number;
  readonly underReplicatedPinsCount: number;
  readonly isBitswapActive: boolean;
  readonly activeStreamsCount: number;
  readonly totalBlocksSent: number;
  readonly totalBlocksReceived: number;
  readonly totalBytesSent: number;
  readonly totalBytesReceived: number;
  readonly quotaUsage: StorageQuotaUsage;
}

export type ComplianceReason =
  | 'DMCA'
  | 'CSAM'
  | 'LEGAL_TAKEDOWN'
  | 'TERRORISM'
  | 'MALWARE';

export interface DeniedHashRecord {
  readonly contentHash: string; // SHA-256 or BLAKE3 digest in hex
  readonly cid?: string | undefined;
  readonly reason: ComplianceReason;
  readonly takedownNoticeId?: string | undefined;
  readonly addedAt: number;
  readonly addedBy: string;
  readonly notes?: string | undefined;
}

export interface BlindedBlockEnvelope {
  readonly envelopeCid: string;
  readonly byteSize: number;
  readonly isBlinded: true;
  readonly proofOfZeroKnowledge: string;
}

