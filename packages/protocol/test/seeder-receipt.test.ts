import { describe, it, expect } from 'vitest';
import { generateEd25519KeyPair } from '@sovra/crypto';
import {
  signBandwidthReceipt,
  verifyBandwidthReceipt,
  calculateDynamicSeederReward,
  SeederBandwidthReceipt,
} from '../src/index.js';

describe('Pillar 5: Seeder Bandwidth Receipts & Dynamic Reward Accounting', () => {
  it('signs and verifies bandwidth receipts with cryptographic tamper protection', () => {
    const downloader = generateEd25519KeyPair();
    const unsigned: Omit<SeederBandwidthReceipt, 'signatureHex'> = {
      receiptId: 'rcpt-101',
      contentCid: 'bafkreibigvideo',
      seederDid: 'did:sovra:seeder-node-9',
      downloaderDid: 'did:sovra:user-alice',
      bytesServed: 5 * 1024 * 1024, // 5MB
      totalMediaBytes: 20 * 1024 * 1024, // 20MB total video
      timestamp: Math.floor(Date.now() / 1000),
    };

    const signed = signBandwidthReceipt(unsigned, downloader.privateKey);
    expect(signed.signatureHex).toBeDefined();

    const isValid = verifyBandwidthReceipt(signed, downloader.publicKey);
    expect(isValid).toBe(true);

    // Tampered bytesServed must fail verification
    const tampered = { ...signed, bytesServed: 10 * 1024 * 1024 };
    expect(verifyBandwidthReceipt(tampered, downloader.publicKey)).toBe(false);
  });

  it('calculates proportional dynamic seeder reward according to bytes served', () => {
    const totalVideoRevenue = 1000n; // 1000 sats/micro-cents
    const totalBytes = 10 * 1024 * 1024; // 10MB
    const servedBytes = 5 * 1024 * 1024; // 5MB served (50% of the video)

    // Total 5% seeder share is 50 sats. Since seeder served 50%, they get 25 sats.
    const reward = calculateDynamicSeederReward(totalVideoRevenue, servedBytes, totalBytes, 5);
    expect(reward).toBe(25n);
  });

  it('signs and verifies cryptographic Proof-of-Delivery receipts with Merkle inclusion', async () => {
    const { signProofOfDelivery, verifyProofOfDelivery } = await import('../src/index.js');
    const downloader = generateEd25519KeyPair();
    const merkleRoot = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const unsignedPod = {
      receiptId: 'pod-999',
      contentCid: 'bafybeicontent999',
      merkleRootHex: merkleRoot,
      deliveredChunkIndices: [0, 1, 2],
      chunkHashesHex: ['hash0', 'hash1', 'hash2'],
      seederDid: 'did:sovra:seeder-bob',
      downloaderDid: 'did:sovra:user-alice',
      totalBytes: 786432,
      timestamp: Date.now(),
    };

    const signedPod = signProofOfDelivery(unsignedPod, downloader.privateKey);
    expect(signedPod.downloaderSignatureHex).toBeDefined();

    const valid = verifyProofOfDelivery(signedPod, downloader.publicKey, merkleRoot);
    expect(valid).toBe(true);

    // Mismatched Merkle root fails
    const invalidRoot = verifyProofOfDelivery(signedPod, downloader.publicKey, 'wrongroot');
    expect(invalidRoot).toBe(false);
  });

  it('detects seeder wash trading when downloads are concentrated in single peer cluster', async () => {
    const { detectSeederWashTrading } = await import('../src/index.js');

    // 10 receipts: 9 from the SAME downloader (collusion), 1 from another
    const collusiveReceipts: SeederBandwidthReceipt[] = [];
    for (let i = 0; i < 9; i++) {
      collusiveReceipts.push({
        receiptId: `r-${i}`,
        contentCid: 'cid1',
        seederDid: 'did:sovra:seeder-fraud',
        downloaderDid: 'did:sovra:colluder-sybil',
        bytesServed: 10 * 1024 * 1024,
        totalMediaBytes: 100 * 1024 * 1024,
        timestamp: Date.now(),
      });
    }
    collusiveReceipts.push({
      receiptId: 'r-9',
      contentCid: 'cid1',
      seederDid: 'did:sovra:seeder-fraud',
      downloaderDid: 'did:sovra:genuine-user',
      bytesServed: 1 * 1024 * 1024,
      totalMediaBytes: 100 * 1024 * 1024,
      timestamp: Date.now(),
    });

    const audit = detectSeederWashTrading(collusiveReceipts);
    expect(audit.isSuspicious).toBe(true);
    expect(audit.topDownloaderSharePercent).toBeGreaterThan(80);
    expect(audit.payoutHold).toBe(true);
    expect(audit.reason).toContain('Downloader collusion detected');
  });

  it('triggers instant payout hold when Z >= 2.5 and single peer share >= 80% in multi-peer swarm', async () => {
    const { detectSeederWashTrading } = await import('../src/index.js');

    // Multi-peer swarm (10 downloaders): 1 collusive peer pulls 90MB, 9 genuine users pull 1MB each
    const receipts: SeederBandwidthReceipt[] = [];
    receipts.push({
      receiptId: 'r-colluder',
      contentCid: 'cid-viral',
      seederDid: 'did:sovra:seeder-evil',
      downloaderDid: 'did:sovra:colluder-bot',
      bytesServed: 90 * 1024 * 1024,
      totalMediaBytes: 100 * 1024 * 1024,
      timestamp: Date.now(),
    });

    for (let i = 0; i < 9; i++) {
      receipts.push({
        receiptId: `r-genuine-${i}`,
        contentCid: 'cid-viral',
        seederDid: 'did:sovra:seeder-evil',
        downloaderDid: `did:sovra:genuine-user-${i}`,
        bytesServed: 1 * 1024 * 1024,
        totalMediaBytes: 100 * 1024 * 1024,
        timestamp: Date.now(),
      });
    }

    const audit = detectSeederWashTrading(receipts);
    expect(audit.zScore).toBeGreaterThanOrEqual(2.5);
    expect(audit.topDownloaderSharePercent).toBeGreaterThanOrEqual(80);
    expect(audit.isSuspicious).toBe(true);
    expect(audit.payoutHold).toBe(true);
    expect(audit.reason).toContain('Payouts held on instant freeze');
  });

  it('verifies hardware biometric-signed proof of delivery', async () => {
    const { signProofOfDelivery, verifyProofOfDelivery } = await import('../src/index.js');
    const downloader = generateEd25519KeyPair();
    const merkleRoot = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const unsignedPod = {
      receiptId: 'pod-hw-1',
      contentCid: 'bafybeicontent999',
      merkleRootHex: merkleRoot,
      deliveredChunkIndices: [0],
      chunkHashesHex: ['hash0'],
      seederDid: 'did:sovra:seeder-bob',
      downloaderDid: 'did:sovra:user-alice',
      totalBytes: 262144,
      timestamp: Date.now(),
      isHardwareBiometricVerified: true,
      hardwareCredentialId: 'cred-touchid-888',
    };

    const signedPod = signProofOfDelivery(unsignedPod, downloader.privateKey);
    // Verified with biometric requirement
    expect(verifyProofOfDelivery(signedPod, downloader.publicKey, merkleRoot, true)).toBe(true);

    // Non-biometric receipt fails when biometric requirement is enforced
    const nonBiometric = { ...signedPod, isHardwareBiometricVerified: false };
    expect(verifyProofOfDelivery(nonBiometric, downloader.publicKey, merkleRoot, true)).toBe(false);
  });

  it('resolves offline state channel disputes to avoid indefinite liquidity lock', async () => {
    const { StateChannelDisputeResolver } = await import('../src/index.js');

    const now = Math.floor(Date.now() / 1000);
    const dispute = {
      channelId: 'chan-offline-1',
      senderDid: 'did:sovra:alice',
      recipientDid: 'did:sovra:creator1',
      highestNonce: 5,
      claimedAmount: 500n,
      challengeWindowSeconds: 86400, // 24h
      disputeOpenedAt: now,
      disputeExpiresAt: now + 86400,
      status: 'open' as const,
    };

    // Before challenge window expires without proof: cannot settle
    const pending = StateChannelDisputeResolver.evaluateDispute(dispute, now + 1800);
    expect(pending.canSettle).toBe(false);

    // After 1 hour with hardware-biometric verified proof of delivery: fast-track optimistic settle
    const hwProof = {
      receiptId: 'pod-hw-fast',
      contentCid: 'cid-paid',
      merkleRootHex: 'root',
      deliveredChunkIndices: [0],
      chunkHashesHex: ['h0'],
      seederDid: 'did:sovra:seeder-1',
      downloaderDid: 'did:sovra:alice',
      totalBytes: 100,
      timestamp: now,
      isHardwareBiometricVerified: true,
    };
    const fastTrack = StateChannelDisputeResolver.evaluateDispute(dispute, now + 3700, undefined, hwProof);
    expect(fastTrack.canSettle).toBe(true);
    expect(fastTrack.status).toBe('resolved_optimistic');
    expect(fastTrack.settledAmount).toBe(500n);

    // Counter-voucher with higher nonce overrides dispute
    const counterVoucher = {
      voucherId: 'v-counter',
      channelId: 'chan-offline-1',
      senderDid: 'did:sovra:alice',
      creatorDid: 'did:sovra:creator1',
      contentCid: 'cid-paid',
      cumulativeAmount: 700n,
      deltaAmount: 200n,
      nonce: 6, // higher than 5
      timestamp: now + 100,
    };
    const counterSettled = StateChannelDisputeResolver.evaluateDispute(dispute, now + 500, counterVoucher);
    expect(counterSettled.canSettle).toBe(true);
    expect(counterSettled.status).toBe('resolved_dispute');
    expect(counterSettled.settledAmount).toBe(700n);

    // After full challenge window (24h): settles optimistically
    const expiredSettled = StateChannelDisputeResolver.evaluateDispute(dispute, now + 86401);
    expect(expiredSettled.canSettle).toBe(true);
    expect(expiredSettled.status).toBe('resolved_optimistic');
    expect(expiredSettled.settledAmount).toBe(500n);
  });

  it('aggregates thousands of off-chain micropayment vouchers into a compressed rollup batch', async () => {
    const { aggregateMicropaymentVouchers } = await import('../src/index.js');

    const vouchers = [
      {
        voucherId: 'v-1',
        channelId: 'chan-1',
        senderDid: 'did:sovra:alice',
        creatorDid: 'did:sovra:creator1',
        contentCid: 'bafk1',
        cumulativeAmount: 100n,
        deltaAmount: 100n,
        nonce: 1,
        timestamp: 1000,
      },
      {
        voucherId: 'v-2',
        channelId: 'chan-2',
        senderDid: 'did:sovra:bob',
        creatorDid: 'did:sovra:creator1',
        contentCid: 'bafk1',
        cumulativeAmount: 200n,
        deltaAmount: 200n,
        nonce: 2,
        timestamp: 1010,
      },
      {
        voucherId: 'v-3',
        channelId: 'chan-3',
        senderDid: 'did:sovra:carol',
        creatorDid: 'did:sovra:creator1',
        contentCid: 'bafk1',
        cumulativeAmount: 300n,
        deltaAmount: 300n,
        nonce: 3,
        timestamp: 1020,
      },
    ];

    const batch = aggregateMicropaymentVouchers(vouchers, 'batch-alpha');
    expect(batch.batchId).toBe('batch-alpha');
    expect(batch.totalVouchers).toBe(3);
    expect(batch.totalAmount).toBe(600n);
    // 95% creator split = 570n, 5% seeder split = 30n
    expect(batch.creatorTotal).toBe(570n);
    expect(batch.seederTotal).toBe(30n);
    expect(batch.merkleRootHex).toBeDefined();
    expect(batch.latestTimestamp).toBe(1020);
  });
});

