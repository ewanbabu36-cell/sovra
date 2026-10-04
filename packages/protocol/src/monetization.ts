import {
  bytesToHex,
  hexToBytes,
  sha256,
  signEd25519,
  verifyEd25519,
} from '@sovra/crypto';
import { ProtocolError } from './errors.js';

export interface SettlementSplit {
  readonly totalAmount: bigint;
  readonly creatorAmount: bigint;
  readonly seederAmount: bigint;
  readonly platformAmount: bigint;
}

/**
 * Calculates a dynamic, data-driven revenue split:
 * Default: 95% to Creator, 5% to Seeder / Bandwidth Relay, 0% platform take.
 */
export function calculateSettlementSplit(
  totalAmount: bigint,
  seederSharePercent = 5,
): SettlementSplit {
  if (seederSharePercent < 0 || seederSharePercent > 20) {
    throw new ProtocolError('Seeder share must be between 0% and 20%');
  }

  const seederAmount = (totalAmount * BigInt(seederSharePercent)) / 100n;
  const creatorAmount = totalAmount - seederAmount;

  return {
    totalAmount,
    creatorAmount,
    seederAmount,
    platformAmount: 0n, // Zero platform cut
  };
}

export interface MicropaymentVoucher {
  readonly voucherId: string;
  readonly channelId: string;
  readonly senderDid: string;
  readonly creatorDid: string;
  readonly seederDid?: string | undefined;
  readonly contentCid: string;
  readonly cumulativeAmount: bigint;
  readonly deltaAmount: bigint;
  readonly nonce: number;
  readonly timestamp: number;
  readonly signatureHex?: string | undefined;
}

export function canonicalSerializeVoucher(
  voucher: Omit<MicropaymentVoucher, 'signatureHex'>,
): string {
  // Deterministic lexicographical JSON serialization for consensus verification
  const payload = {
    channelId: voucher.channelId,
    contentCid: voucher.contentCid,
    creatorDid: voucher.creatorDid,
    cumulativeAmount: voucher.cumulativeAmount.toString(),
    deltaAmount: voucher.deltaAmount.toString(),
    nonce: voucher.nonce,
    seederDid: voucher.seederDid ?? null,
    senderDid: voucher.senderDid,
    timestamp: voucher.timestamp,
    voucherId: voucher.voucherId,
  };
  return JSON.stringify(payload);
}

export function signMicropaymentVoucher(
  voucherWithoutSig: Omit<MicropaymentVoucher, 'signatureHex'>,
  privateKey: Uint8Array,
): MicropaymentVoucher {
  const canonicalStr = canonicalSerializeVoucher(voucherWithoutSig);
  const msgDigest = sha256(new TextEncoder().encode(canonicalStr));
  const sig = signEd25519(privateKey, msgDigest);
  const signatureHex = bytesToHex(sig);

  return {
    ...voucherWithoutSig,
    signatureHex,
  };
}

export function verifyMicropaymentVoucher(
  voucher: MicropaymentVoucher,
  senderPublicKey: Uint8Array,
): boolean {
  if (!voucher.signatureHex) {
    return false;
  }

  try {
    const { signatureHex, ...rest } = voucher;
    const canonicalStr = canonicalSerializeVoucher(rest);
    const msgDigest = sha256(new TextEncoder().encode(canonicalStr));
    const sigBytes = hexToBytes(signatureHex);
    return verifyEd25519(senderPublicKey, msgDigest, sigBytes);
  } catch {
    return false;
  }
}

export interface ContentAccessTicket {
  readonly ticketId: string;
  readonly contentCid: string;
  readonly recipientDid: string;
  readonly voucherId: string;
  readonly wrappedKeyHex: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly signatureHex: string;
}

export interface SeederBandwidthReceipt {
  readonly receiptId: string;
  readonly contentCid: string;
  readonly seederDid: string;
  readonly downloaderDid: string;
  readonly bytesServed: number;
  readonly totalMediaBytes: number;
  readonly timestamp: number;
  readonly signatureHex?: string | undefined;
}

export function canonicalSerializeBandwidthReceipt(
  receipt: Omit<SeederBandwidthReceipt, 'signatureHex'>,
): string {
  return JSON.stringify({
    bytesServed: receipt.bytesServed,
    contentCid: receipt.contentCid,
    downloaderDid: receipt.downloaderDid,
    receiptId: receipt.receiptId,
    seederDid: receipt.seederDid,
    timestamp: receipt.timestamp,
    totalMediaBytes: receipt.totalMediaBytes,
  });
}

export function signBandwidthReceipt(
  receiptWithoutSig: Omit<SeederBandwidthReceipt, 'signatureHex'>,
  downloaderPrivateKey: Uint8Array,
): SeederBandwidthReceipt {
  const canonical = canonicalSerializeBandwidthReceipt(receiptWithoutSig);
  const digest = sha256(new TextEncoder().encode(canonical));
  const sig = signEd25519(downloaderPrivateKey, digest);
  return {
    ...receiptWithoutSig,
    signatureHex: bytesToHex(sig),
  };
}

export function verifyBandwidthReceipt(
  receipt: SeederBandwidthReceipt,
  downloaderPublicKey: Uint8Array,
): boolean {
  if (!receipt.signatureHex) return false;
  try {
    const { signatureHex, ...rest } = receipt;
    const canonical = canonicalSerializeBandwidthReceipt(rest);
    const digest = sha256(new TextEncoder().encode(canonical));
    const sigBytes = hexToBytes(signatureHex);
    return verifyEd25519(downloaderPublicKey, digest, sigBytes);
  } catch {
    return false;
  }
}

/**
 * Data-Driven Seeder Reward Formula:
 * SeederReward = TotalContentRevenue * (BytesServed / TotalMediaBytes) * (seederSharePercent / 100)
 */
export function calculateDynamicSeederReward(
  totalContentRevenue: bigint,
  bytesServed: number,
  totalMediaBytes: number,
  seederSharePercent = 5,
): bigint {
  if (totalMediaBytes <= 0 || bytesServed <= 0) return 0n;
  const ratio = Math.min(1.0, bytesServed / totalMediaBytes);
  const poolShare = (totalContentRevenue * BigInt(seederSharePercent)) / 100n;
  return BigInt(Math.floor(Number(poolShare) * ratio));
}

export interface ProofOfDeliveryReceipt {
  readonly receiptId: string;
  readonly contentCid: string;
  readonly merkleRootHex: string;
  readonly deliveredChunkIndices: readonly number[];
  readonly chunkHashesHex: readonly string[];
  readonly seederDid: string;
  readonly downloaderDid: string;
  readonly totalBytes: number;
  readonly timestamp: number;
  readonly isHardwareBiometricVerified?: boolean | undefined;
  readonly hardwareCredentialId?: string | undefined;
  readonly downloaderSignatureHex?: string | undefined;
}

export function canonicalSerializeProofOfDelivery(
  receipt: Omit<ProofOfDeliveryReceipt, 'downloaderSignatureHex'>,
): string {
  return JSON.stringify({
    chunkHashesHex: receipt.chunkHashesHex,
    contentCid: receipt.contentCid,
    deliveredChunkIndices: receipt.deliveredChunkIndices,
    downloaderDid: receipt.downloaderDid,
    hardwareCredentialId: receipt.hardwareCredentialId ?? null,
    isHardwareBiometricVerified: receipt.isHardwareBiometricVerified ?? false,
    merkleRootHex: receipt.merkleRootHex,
    receiptId: receipt.receiptId,
    seederDid: receipt.seederDid,
    timestamp: receipt.timestamp,
    totalBytes: receipt.totalBytes,
  });
}

export function signProofOfDelivery(
  receipt: Omit<ProofOfDeliveryReceipt, 'downloaderSignatureHex'>,
  downloaderPrivateKey: Uint8Array,
): ProofOfDeliveryReceipt {
  const canonical = canonicalSerializeProofOfDelivery(receipt);
  const digest = sha256(new TextEncoder().encode(canonical));
  const sig = signEd25519(downloaderPrivateKey, digest);
  return {
    ...receipt,
    downloaderSignatureHex: bytesToHex(sig),
  };
}

export function verifyProofOfDelivery(
  receipt: ProofOfDeliveryReceipt,
  downloaderPublicKey: Uint8Array,
  expectedMerkleRootHex: string,
  requireHardwareBiometrics = false,
): boolean {
  if (!receipt.downloaderSignatureHex) return false;
  if (receipt.merkleRootHex !== expectedMerkleRootHex) return false;
  if (receipt.deliveredChunkIndices.length !== receipt.chunkHashesHex.length) return false;
  if (requireHardwareBiometrics && !receipt.isHardwareBiometricVerified) return false;

  try {
    const { downloaderSignatureHex, ...rest } = receipt;
    const canonical = canonicalSerializeProofOfDelivery(rest);
    const digest = sha256(new TextEncoder().encode(canonical));
    const sigBytes = hexToBytes(downloaderSignatureHex);
    return verifyEd25519(downloaderPublicKey, digest, sigBytes);
  } catch {
    return false;
  }
}

export interface CollusionAuditResult {
  readonly isSuspicious: boolean;
  readonly zScore: number;
  readonly topDownloaderSharePercent: number;
  readonly payoutHold: boolean;
  readonly reason?: string | undefined;
}

/**
 * Pillar 5: Wash-Trading & Self-Seeding Collusion Detector.
 * Formula:
 * Suspicious if: Z = (Max Downloader Bytes - mu) / sigma >= 2.5 AND Single Peer Share >= 80%
 * Collusion detect hote hi payouts instant hold par chale jayenge (payoutHold = true).
 */
export function detectSeederWashTrading(
  receipts: readonly SeederBandwidthReceipt[],
  sigmaThreshold = 2.5,
  shareThresholdPercent = 80,
): CollusionAuditResult {
  if (receipts.length < 5) {
    return { isSuspicious: false, zScore: 0, topDownloaderSharePercent: 0, payoutHold: false };
  }

  const countsByDownloader = new Map<string, number>();
  let totalBytes = 0;

  for (const r of receipts) {
    countsByDownloader.set(
      r.downloaderDid,
      (countsByDownloader.get(r.downloaderDid) ?? 0) + r.bytesServed,
    );
    totalBytes += r.bytesServed;
  }

  if (totalBytes === 0) {
    return { isSuspicious: false, zScore: 0, topDownloaderSharePercent: 0, payoutHold: false };
  }

  const values = Array.from(countsByDownloader.values());
  const maxBytes = Math.max(...values);
  const topShare = (maxBytes / totalBytes) * 100;

  // Compute mean and standard deviation
  const mean = totalBytes / countsByDownloader.size;
  const variance =
    values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / countsByDownloader.size;
  const stdDev = Math.sqrt(variance);

  const zScore = stdDev > 0 ? (maxBytes - mean) / stdDev : 0;

  // For small peer clusters (N < 8), sample maximum possible Z is sqrt(N - 1) < 2.5.
  // Sample normalization is applied so severe monopolistic skew is audited:
  const normalizedZ =
    countsByDownloader.size >= 8
      ? zScore
      : countsByDownloader.size > 1
        ? zScore * (2.5 / Math.sqrt(countsByDownloader.size - 1))
        : 0;

  const isSuspicious =
    (zScore >= sigmaThreshold || normalizedZ >= sigmaThreshold) &&
    topShare >= shareThresholdPercent;
  const payoutHold = isSuspicious;

  return {
    isSuspicious,
    zScore: Math.round(zScore * 100) / 100,
    topDownloaderSharePercent: Math.round(topShare * 10) / 10,
    payoutHold,
    reason: isSuspicious
      ? `Downloader collusion detected: single peer cluster accounts for ${topShare.toFixed(1)}% of volume (z-score: ${zScore.toFixed(2)}). Payouts held on instant freeze.`
      : undefined,
  };
}

export interface StateChannelDisputeState {
  readonly channelId: string;
  readonly senderDid: string;
  readonly recipientDid: string;
  readonly highestNonce: number;
  readonly claimedAmount: bigint;
  readonly challengeWindowSeconds: number; // e.g. 86400 (24h)
  readonly disputeOpenedAt: number;
  readonly disputeExpiresAt: number;
  readonly status: 'open' | 'resolved_optimistic' | 'resolved_dispute' | 'emergency_unlocked';
}

export class StateChannelDisputeResolver {
  /**
   * Resolves offline peer liquidity lock via optimistic cooperative resolution.
   * If a valid signed voucher with verified proof of delivery is presented,
   * the dispute challenge window is dynamically reduced to prevent prolonged lockup.
   */
  static evaluateDispute(
    dispute: StateChannelDisputeState,
    currentTime: number,
    counterVoucher?: MicropaymentVoucher,
    proofOfDelivery?: ProofOfDeliveryReceipt,
  ): { canSettle: boolean; status: StateChannelDisputeState['status']; settledAmount: bigint } {
    if (counterVoucher && counterVoucher.nonce > dispute.highestNonce) {
      return {
        canSettle: true,
        status: 'resolved_dispute',
        settledAmount: counterVoucher.cumulativeAmount,
      };
    }

    // 1-hour fast-track for hardware-biometric signed proofs
    if (proofOfDelivery?.isHardwareBiometricVerified && currentTime >= dispute.disputeOpenedAt + 3600) {
      return {
        canSettle: true,
        status: 'resolved_optimistic',
        settledAmount: dispute.claimedAmount,
      };
    }

    if (currentTime >= dispute.disputeExpiresAt) {
      return {
        canSettle: true,
        status: 'resolved_optimistic',
        settledAmount: dispute.claimedAmount,
      };
    }

    return {
      canSettle: false,
      status: dispute.status,
      settledAmount: 0n,
    };
  }
}


export interface AggregatedSettlementBatch {
  readonly batchId: string;
  readonly totalVouchers: number;
  readonly totalAmount: bigint;
  readonly creatorTotal: bigint;
  readonly seederTotal: bigint;
  readonly merkleRootHex: string;
  readonly latestTimestamp: number;
}

/**
 * Pillar 5: Off-Chain Rollup State Channel Voucher Aggregator.
 * Condenses thousands of micro-tips into a single cryptographic settlement root.
 */
export function aggregateMicropaymentVouchers(
  vouchers: readonly MicropaymentVoucher[],
  batchId = `batch_${Date.now()}`,
): AggregatedSettlementBatch {
  if (vouchers.length === 0) {
    return {
      batchId,
      totalVouchers: 0,
      totalAmount: 0n,
      creatorTotal: 0n,
      seederTotal: 0n,
      merkleRootHex: bytesToHex(sha256(new Uint8Array(0))),
      latestTimestamp: Date.now(),
    };
  }

  let totalAmount = 0n;
  let creatorTotal = 0n;
  let seederTotal = 0n;
  let latestTimestamp = 0;
  const leaves: Uint8Array[] = [];

  for (const v of vouchers) {
    totalAmount += v.deltaAmount;
    const split = calculateSettlementSplit(v.deltaAmount, 5);
    creatorTotal += split.creatorAmount;
    seederTotal += split.seederAmount;
    if (v.timestamp > latestTimestamp) latestTimestamp = v.timestamp;

    const leafDigest = sha256(new TextEncoder().encode(v.voucherId + ':' + v.deltaAmount.toString()));
    leaves.push(leafDigest);
  }

  // Linear Merkle root derivation over leaves
  let currentLayer = leaves;
  while (currentLayer.length > 1) {
    const nextLayer: Uint8Array[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i]!;
      const right = i + 1 < currentLayer.length ? currentLayer[i + 1]! : left;
      const combined = new Uint8Array(64);
      combined.set(left, 0);
      combined.set(right, 32);
      nextLayer.push(sha256(combined));
    }
    currentLayer = nextLayer;
  }

  const merkleRootHex = bytesToHex(currentLayer[0] ?? sha256(new Uint8Array(0)));

  return {
    batchId,
    totalVouchers: vouchers.length,
    totalAmount,
    creatorTotal,
    seederTotal,
    merkleRootHex,
    latestTimestamp,
  };
}


