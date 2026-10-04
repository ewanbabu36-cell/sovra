import { describe, it, expect } from 'vitest';
import {
  PerceptualHashAuditor,
  MultiSigOracleCompliance,
  MultiSigTakedownOrder,
} from '../src/index.js';

describe('Pillar 6: Decentralized Perceptual Hashing & Multi-Sig Oracle Compliance', () => {
  it('detects near-identical perceptual image/video hashes within Hamming threshold', () => {
    // 64-character hex perceptual hash (PDQ / Neural hash)
    const baseHash = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    // Slightly altered hash (e.g. cropped/filtered video with small distance)
    const alteredHash = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f91';

    const distance = PerceptualHashAuditor.computeHammingDistance(baseHash, alteredHash);
    expect(distance).toBeLessThanOrEqual(5);

    const matches = PerceptualHashAuditor.isPerceptuallyMatching(baseHash, alteredHash, 10);
    expect(matches).toBe(true);

    // Completely distinct image hash
    const distinctHash = '0000000000000000000000000000000000000000000000000000000000000000';
    expect(PerceptualHashAuditor.isPerceptuallyMatching(baseHash, distinctHash, 10)).toBe(false);
  });

  it('verifies multi-sig legal watchdog oracle quorum preventing unilateral censorship', () => {
    const authorized = new Set(['did:sovra:oracle-legal-1', 'did:sovra:oracle-legal-2']);
    const compliance = new MultiSigOracleCompliance(authorized);

    const validOrder: MultiSigTakedownOrder = {
      takedownId: 'take-777',
      contentHash: 'badhash123',
      reason: 'CSAM',
      requiredThreshold: 2,
      signatures: [
        { oracleDid: 'did:sovra:oracle-legal-1', signatureHex: 'a'.repeat(128) },
        { oracleDid: 'did:sovra:oracle-legal-2', signatureHex: 'b'.repeat(128) },
      ],
    };

    expect(compliance.verifyTakedownQuorum(validOrder)).toBe(true);

    // Order with only 1 signature should fail 2-of-2 threshold
    const underSignedOrder: MultiSigTakedownOrder = {
      ...validOrder,
      signatures: [{ oracleDid: 'did:sovra:oracle-legal-1', signatureHex: 'a'.repeat(128) }],
    };
    expect(compliance.verifyTakedownQuorum(underSignedOrder)).toBe(false);

    // Unilateral censorship (threshold < 2) is strictly rejected by consensus
    const unilateralOrder: MultiSigTakedownOrder = {
      ...validOrder,
      requiredThreshold: 1,
      signatures: [{ oracleDid: 'did:sovra:oracle-legal-1', signatureHex: 'a'.repeat(128) }],
    };
    expect(compliance.verifyTakedownQuorum(unilateralOrder)).toBe(false);
  });

  it('defeats image transformation evasion attacks via multi-variant perceptual matching', () => {
    const blacklisted = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    // Attacker applies 2-degree rotation and mirror-flip to create evasion variants
    const rotatedVariant = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f92'; // distance 2
    const flippedVariant = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f98'; // distance 2
    const unrelatedImage = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

    const variants = [rotatedVariant, flippedVariant];
    const isEvasionDetected = PerceptualHashAuditor.matchesWithTransformationVariants(
      variants,
      blacklisted,
      10,
    );
    expect(isEvasionDetected).toBe(true);

    expect(
      PerceptualHashAuditor.matchesWithTransformationVariants([unrelatedImage], blacklisted, 10),
    ).toBe(false);
  });

  it('filters content according to node operator sovereign jurisdiction rulebook', async () => {
    const { JurisdictionRulebookPolicy } = await import('../src/index.js');

    // Global baseline policy: always blocks CSAM, allows regular content
    const globalPolicy = new JurisdictionRulebookPolicy('GLOBAL_CSAM_ONLY');
    expect(globalPolicy.isContentTagBlocked('CSAM')).toBe(true);
    expect(globalPolicy.isContentTagBlocked('DMCA_PIRACY')).toBe(false);

    // US DMCA operator: blocks CSAM and DMCA piracy
    const usPolicy = new JurisdictionRulebookPolicy('US_DMCA_COMPLIANT');
    expect(usPolicy.isContentTagBlocked('CSAM')).toBe(true);
    expect(usPolicy.isContentTagBlocked('DMCA_PIRACY')).toBe(true);

    // EU DSA operator: blocks CSAM, piracy, and DSA illegal content
    const euPolicy = new JurisdictionRulebookPolicy('EU_DSA_STRICT');
    expect(euPolicy.isContentTagBlocked('DSA_ILLEGAL')).toBe(true);

    // India IT Act operator: blocks CSAM, piracy, and IT Act prohibited content
    const inPolicy = new JurisdictionRulebookPolicy('IN_IT_ACT_INTERMEDIARY');
    expect(inPolicy.isContentTagBlocked('CSAM')).toBe(true);
    expect(inPolicy.isContentTagBlocked('IT_ACT_PROHIBITED')).toBe(true);
    expect(inPolicy.isContentTagBlocked('SOVEREIGNTY_THREAT')).toBe(true);
  });

  it('shards data into blind erasure shares guaranteeing safe-harbor plausible deniability', async () => {
    const { BlindErasureShardingEngine } = await import('../src/index.js');
    const originalData = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);

    // Shard into 4 blind slices
    const shards = BlindErasureShardingEngine.shardBlock(originalData, 2, 4);
    expect(shards.length).toBe(4);

    // No single shard equals the original data
    for (const s of shards) {
      expect(s.shardBytes).not.toEqual(originalData);
    }

    // Reconstruction restores exact original data bytes
    const restored = BlindErasureShardingEngine.reconstructBlock(shards, originalData.length);
    expect(restored).toEqual(originalData);

    // Node holding 1 shard out of 4 has zero physical capability to decode (plausible deniability)
    expect(BlindErasureShardingEngine.isPlausiblyDeniable(1, 2)).toBe(true);
    // Node holding 2 or more shards meets or exceeds threshold
    expect(BlindErasureShardingEngine.isPlausiblyDeniable(2, 2)).toBe(false);
  });

  it('generates and verifies cryptographic Proof of Retrievability (PoR) challenges within 150ms SLA', async () => {
    const { ProofOfRetrievabilityEngine } = await import('../src/index.js');
    const blockData = new Uint8Array(256 * 1024); // 256KB block
    blockData.fill(7);

    const challenge = ProofOfRetrievabilityEngine.generateChallenge('bafybeihash123', 0);
    expect(challenge.challengeId).toBeDefined();

    const proof = ProofOfRetrievabilityEngine.verifyProof(challenge, blockData, 150);
    expect(proof.isValid).toBe(true);
    expect(proof.proofResponseTimeMs).toBeLessThanOrEqual(150);
    expect(proof.blockSampleHashHex).toBeDefined();
  });
});

