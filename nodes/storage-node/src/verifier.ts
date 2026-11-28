import {
  sha256,
  blake3Hash,
  bytesToHex,
  hexToBytes,
  verifyEd25519,
  secureRandomBytes,
  constantTimeEquals,
} from '@sovra/crypto';
import { SovraP2PNode, extractPublicKeyFromPeerId } from '@sovra/p2p';
import { CID, BitSwapEngine, BitSwapBlock, encodeBitSwapMessage } from '@sovra/storage';
import { ContinuousPinningManager } from './pinning.js';
import {
  PinStatus,
  ReplicaVerificationReport,
  ReplicaVerificationItem,
} from './types.js';

export class ReplicaVerificationEngine {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly pinningManager: ContinuousPinningManager,
    private readonly p2pNode?: SovraP2PNode | undefined,
    private readonly bitswapEngine?: BitSwapEngine | undefined,
    private readonly intervalMs: number = 30000,
  ) {}

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    if (this.intervalMs > 0) {
      this.timer = setInterval(() => {
        this.verifyReplicas().catch(() => {});
      }, this.intervalMs);
    }
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Executes a full verification pass across all active pins in the registry.
   * If any pin falls below targetReplicationFactor, genuinely replicates missing DAG blocks
   * to connected peers over BitSwap streams and updates counts only on real delivery.
   */
  public async verifyReplicas(): Promise<ReplicaVerificationReport> {
    const timestamp = Date.now();

    // 1. Sweep expired pin leases first
    const expiredPins = await this.pinningManager.sweepExpiredPins();
    const expiredCount = expiredPins.length;

    const allPins = this.pinningManager.listPins();
    const activePins = allPins.filter(p => p.status !== 'expired');

    let healthyCount = 0;
    let underReplicatedCount = 0;
    let repairsTriggered = 0;
    const items: ReplicaVerificationItem[] = [];

    for (const pin of activePins) {
      let providers: readonly string[] = [];
      let actualReplicas = 1; // Local node holds pin
      let repaired = false;

      if (this.p2pNode) {
        try {
          providers = await this.p2pNode.dht.findProviders(
            pin.cid,
            pin.targetReplicationFactor + 5,
          );
          const uniqueProviders = new Set([this.p2pNode.identity.peerId, ...providers]);
          actualReplicas = Math.max(1, uniqueProviders.size);
        } catch {
          actualReplicas = 1;
        }
      }

      if (actualReplicas < pin.targetReplicationFactor && this.p2pNode && this.bitswapEngine) {
        try {
          await this.p2pNode.dht.provide(pin.cid);
        } catch {}

        const providerSet = new Set(providers);
        const connectedCandidates = this.p2pNode
          .getConnectedPeers()
          .map(p => p.id.peerId)
          .filter(pid => pid !== this.p2pNode!.identity.peerId && !providerSet.has(pid));

        if (connectedCandidates.length > 0) {
          const dagBlocks = await this.collectPinBlocks(pin.cid, pin.childCids);
          const needed = Math.max(1, pin.targetReplicationFactor - actualReplicas);
          const targets = connectedCandidates.slice(0, needed);

          for (const targetPeerId of targets) {
            const pushed = await this.pushBlocksToPeer(targetPeerId, dagBlocks);
            if (pushed) {
              repaired = true;
              actualReplicas++;
            }
          }
        }
      }

      let status: PinStatus;
      if (actualReplicas < pin.targetReplicationFactor) {
        status = 'under_replicated';
        underReplicatedCount++;
      } else {
        status = 'healthy';
        healthyCount++;
      }

      if (repaired) {
        repairsTriggered++;
      }

      this.pinningManager.updatePinVerification(pin.cid, actualReplicas, status);

      items.push({
        cid: pin.cid,
        targetReplicationFactor: pin.targetReplicationFactor,
        actualReplicas,
        status,
        repaired,
      });
    }

    // Persist updated status
    await this.pinningManager.persist();

    return {
      timestamp,
      totalPinsChecked: activePins.length,
      healthyCount,
      underReplicatedCount,
      expiredCount,
      repairsTriggered,
      items,
    };
  }

  private async collectPinBlocks(rootCidStr: string, childCids: readonly string[]): Promise<BitSwapBlock[]> {
    if (!this.bitswapEngine) return [];
    const blocks: BitSwapBlock[] = [];
    const allCids = [rootCidStr, ...childCids];
    for (const cStr of allCids) {
      try {
        const parsed = CID.parse(cStr);
        const bytes = await this.bitswapEngine.blockstore.get(parsed);
        if (bytes) {
          blocks.push({ cid: cStr, data: bytes });
        }
      } catch {}
    }
    return blocks;
  }

  private async pushBlocksToPeer(targetPeerId: string, blocks: readonly BitSwapBlock[]): Promise<boolean> {
    if (!this.p2pNode || blocks.length === 0) return false;
    try {
      const stream = await this.p2pNode.openProtocolStream(targetPeerId, '/sovra/bitswap/1.2.0');
      if (!stream) return false;
      const { LengthPrefixedFrameCodec } = await import('@sovra/p2p');
      const msgBytes = encodeBitSwapMessage({ blocks: [...blocks] });
      await stream.send(LengthPrefixedFrameCodec.encode(msgBytes));
      await stream.close().catch(() => {});
      return true;
    } catch {
      return false;
    }
  }
}

export interface PoRChallenge {
  readonly challengeId: string;
  readonly cid: string;
  readonly blockOffset: number;
  readonly randomNonceHex: string;
  readonly issuedAt: number;
}

export interface PoRProof {
  readonly challengeId: string;
  readonly cid: string;
  readonly blockSampleHashHex: string;
  readonly proofResponseTimeMs: number;
  readonly isValid: boolean;
}

export interface SignedPoRProof extends PoRProof {
  readonly proverPeerId: string;
  readonly respondedAt: number;
  readonly signatureHex: string;
}

function buildCanonicalPoRSignBytes(fields: {
  challengeId: string;
  cid: string;
  randomNonceHex: string;
  blockSampleHashHex: string;
  proverPeerId: string;
  respondedAt: number;
}): Uint8Array {
  return new TextEncoder().encode(
    `${fields.challengeId}:${fields.cid}:${fields.randomNonceHex}:${fields.blockSampleHashHex}:${fields.proverPeerId}:${fields.respondedAt}`,
  );
}

/**
 * Cryptographic Proof of Retrievability (PoR).
 * Audits storage nodes with CSPRNG challenges, CID multihash validation, and Ed25519 peer attestation.
 */
export class ProofOfRetrievabilityEngine {
  public static generateChallenge(cid: string, blockOffset = 0): PoRChallenge {
    const nonceHex = bytesToHex(secureRandomBytes(16));
    return {
      challengeId: `por_${Date.now()}_${nonceHex.slice(0, 10)}`,
      cid,
      blockOffset,
      randomNonceHex: nonceHex,
      issuedAt: Date.now(),
    };
  }

  public static computeChallengeSampleHash(challenge: PoRChallenge, blockData: Uint8Array): string {
    const nonceBytes = new TextEncoder().encode(challenge.randomNonceHex);
    const combined = new Uint8Array(blockData.length + nonceBytes.length);
    combined.set(blockData, 0);
    combined.set(nonceBytes, blockData.length);
    return bytesToHex(sha256(combined));
  }

  public static verifyProof(
    challenge: PoRChallenge,
    blockData: Uint8Array,
    maxResponseTimeMs = 150,
  ): PoRProof {
    const start = Date.now();
    let cidDigestValid = false;
    if (challenge && typeof challenge.cid === 'string' && challenge.cid.length > 0 && blockData && blockData.length > 0) {
      try {
        const parsedCid = CID.parse(challenge.cid);
        const actualDigest = parsedCid.multihashType === 'blake3' ? blake3Hash(blockData) : sha256(blockData);
        cidDigestValid = constantTimeEquals(actualDigest, parsedCid.digest);
      } catch {
        // Fail closed on unparseable or non-multihash CIDs
        cidDigestValid = false;
      }
    }

    const blockSampleHashHex = this.computeChallengeSampleHash(challenge, blockData);
    const duration = Date.now() - start;

    return {
      challengeId: challenge.challengeId,
      cid: challenge.cid,
      blockSampleHashHex,
      proofResponseTimeMs: duration,
      isValid: cidDigestValid && duration <= maxResponseTimeMs,
    };
  }

  public static createSignedProof(
    challenge: PoRChallenge,
    blockData: Uint8Array,
    proverPeerId: string,
    signFn: (bytes: Uint8Array) => Uint8Array,
  ): SignedPoRProof {
    const respondedAt = Date.now();
    const blockSampleHashHex = this.computeChallengeSampleHash(challenge, blockData);
    const signBytes = buildCanonicalPoRSignBytes({
      challengeId: challenge.challengeId,
      cid: challenge.cid,
      randomNonceHex: challenge.randomNonceHex,
      blockSampleHashHex,
      proverPeerId,
      respondedAt,
    });
    const signatureHex = bytesToHex(signFn(signBytes));
    const duration = Math.max(0, respondedAt - challenge.issuedAt);
    return {
      challengeId: challenge.challengeId,
      cid: challenge.cid,
      blockSampleHashHex,
      proofResponseTimeMs: duration,
      isValid: true,
      proverPeerId,
      respondedAt,
      signatureHex,
    };
  }

  public static verifySignedProof(
    challenge: PoRChallenge,
    proof: SignedPoRProof,
    expectedProverPeerId: string,
    expectedBlockData?: Uint8Array,
    maxResponseTimeMs = 5000,
  ): boolean {
    try {
      if (!proof || proof.challengeId !== challenge.challengeId || proof.cid !== challenge.cid) {
        return false;
      }
      if (proof.proverPeerId !== expectedProverPeerId) return false;
      const signedElapsedMs = proof.respondedAt - challenge.issuedAt;
      if (signedElapsedMs < 0 || signedElapsedMs > maxResponseTimeMs || proof.proofResponseTimeMs > maxResponseTimeMs) {
        return false;
      }
      const parsedCid = CID.parse(challenge.cid);
      if (expectedBlockData) {
        if (expectedBlockData.length === 0) return false;
        const actualDigest = parsedCid.multihashType === 'blake3' ? blake3Hash(expectedBlockData) : sha256(expectedBlockData);
        if (!constantTimeEquals(actualDigest, parsedCid.digest)) return false;
        const expectedSample = this.computeChallengeSampleHash(challenge, expectedBlockData);
        if (proof.blockSampleHashHex !== expectedSample) return false;
      }
      const pubBytes = extractPublicKeyFromPeerId(expectedProverPeerId);
      const sigBytes = hexToBytes(proof.signatureHex);
      if (sigBytes.length !== 64) return false;
      const signBytes = buildCanonicalPoRSignBytes({
        challengeId: proof.challengeId,
        cid: proof.cid,
        randomNonceHex: challenge.randomNonceHex,
        blockSampleHashHex: proof.blockSampleHashHex,
        proverPeerId: proof.proverPeerId,
        respondedAt: proof.respondedAt,
      });
      return verifyEd25519(pubBytes, signBytes, sigBytes);
    } catch {
      return false;
    }
  }
}

