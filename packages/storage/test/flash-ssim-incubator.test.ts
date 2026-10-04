import { describe, it, expect } from 'vitest';
import {
  calculateDailyFlashWriteBudget,
  evaluateStorageAwareMode,
  FlashPreservingRingBuffer,
  PerceptualSsimVerifier,
  SwarmSeedIncubatorPool,
} from '../src/index.js';

describe('Pillar 2: Mobile Flash Wear-Out Protection', () => {
  it('calculates daily flash write budget correctly based on available storage and battery', () => {
    // 5000 MB free, 80% battery => 5000 * 0.02 * 0.8 = 80 MB
    const budget1 = calculateDailyFlashWriteBudget(5000, 80);
    expect(budget1).toBe(80);

    // 20000 MB free, 100% battery => 20000 * 0.02 * 1.0 = 400 MB -> capped at 250 MB
    const budget2 = calculateDailyFlashWriteBudget(20000, 100);
    expect(budget2).toBe(250);

    // Low battery (20%) drops budget proportionally
    const budget3 = calculateDailyFlashWriteBudget(5000, 20);
    expect(budget3).toBe(20);
  });

  it('evaluates storage aware modes based on free space percentage', () => {
    // > 20% free space -> Normal mode
    const modeNormal = evaluateStorageAwareMode({
      totalStorageMb: 64000,
      availableStorageMb: 20000,
      batteryLevel: 90,
    });
    expect(modeNormal.mode).toBe('normal');
    expect(modeNormal.diskWritesAllowed).toBe(true);
    expect(modeNormal.nonEssentialCachingAllowed).toBe(true);

    // 10-20% free space -> Restricted mode
    const modeRestricted = evaluateStorageAwareMode({
      totalStorageMb: 64000,
      availableStorageMb: 8000, // 12.5%
      batteryLevel: 70,
    });
    expect(modeRestricted.mode).toBe('restricted');
    expect(modeRestricted.diskWritesAllowed).toBe(true);
    expect(modeRestricted.nonEssentialCachingAllowed).toBe(false);

    // < 10% free space -> Diskless Forwarder mode (Zero disk writes)
    const modeDiskless = evaluateStorageAwareMode({
      totalStorageMb: 64000,
      availableStorageMb: 3000, // 4.6%
      batteryLevel: 50,
    });
    expect(modeDiskless.mode).toBe('diskless_forwarder');
    expect(modeDiskless.diskWritesAllowed).toBe(false);
    expect(modeDiskless.nonEssentialCachingAllowed).toBe(false);
    expect(modeDiskless.dailyWriteBudgetMb).toBe(0);
  });

  it('preserves flash memory using volatile in-memory ring buffer with eviction', () => {
    const ringBuffer = new FlashPreservingRingBuffer(1024); // 1KB capacity
    const chunk1 = new Uint8Array(400).fill(1);
    const chunk2 = new Uint8Array(400).fill(2);
    const chunk3 = new Uint8Array(400).fill(3);

    ringBuffer.put('cid_1', chunk1);
    ringBuffer.put('cid_2', chunk2);
    expect(ringBuffer.count).toBe(2);
    expect(ringBuffer.currentUsageBytes).toBe(800);

    // Adding chunk3 (400B) exceeds 1024B, evicts oldest (cid_1)
    ringBuffer.put('cid_3', chunk3);
    expect(ringBuffer.has('cid_1')).toBe(false);
    expect(ringBuffer.has('cid_2')).toBe(true);
    expect(ringBuffer.has('cid_3')).toBe(true);
    expect(ringBuffer.currentUsageBytes).toBe(800);
  });
});

describe('Pillar 4: Perceptual SSIM Transcode Verification', () => {
  it('calculates SSIM between identical luminance vectors as 1.0', () => {
    const frame = [120, 130, 140, 150, 160, 170, 180, 190];
    const ssim = PerceptualSsimVerifier.calculateSSIM(frame, frame);
    expect(ssim).toBe(1.0);
  });

  it('detects degraded transcoded frames with SSIM < 0.94', () => {
    const original = [100, 120, 140, 160, 180, 200, 220, 240];
    const degraded = [40, 60, 80, 100, 120, 140, 160, 180]; // Heavily dimmed/corrupted
    const ssim = PerceptualSsimVerifier.calculateSSIM(original, degraded);
    expect(ssim).toBeLessThan(0.94);
  });

  it('enforces 2-of-3 quorum and slashes workers reporting invalid frames', () => {
    const reference = [100, 120, 140, 160, 180, 200, 220, 240];
    const goodFrame = [102, 121, 139, 161, 179, 199, 221, 239]; // High SSIM >= 0.94
    const corruptFrame = [20, 30, 40, 50, 60, 70, 80, 90]; // Corrupt frame

    const submissions = [
      {
        workerPeerId: 'worker_1',
        gopIndex: 0,
        transcodedCid: 'cid_720p_segment0',
        sampleFrameLuminance: goodFrame,
        bondedStakeAmount: 100,
      },
      {
        workerPeerId: 'worker_2',
        gopIndex: 0,
        transcodedCid: 'cid_720p_segment0',
        sampleFrameLuminance: goodFrame,
        bondedStakeAmount: 100,
      },
      {
        workerPeerId: 'worker_malicious',
        gopIndex: 0,
        transcodedCid: 'cid_poisoned_segment0',
        sampleFrameLuminance: corruptFrame,
        bondedStakeAmount: 100,
      },
    ];

    const result = PerceptualSsimVerifier.verifyGopConsensus(reference, submissions);
    expect(result.consensusReached).toBe(true);
    expect(result.verifiedCid).toBe('cid_720p_segment0');
    expect(result.passedWorkers).toEqual(['worker_1', 'worker_2']);
    expect(result.slashedWorkers).toEqual(['worker_malicious']);
  });
});

describe('Pillar 9: Swarm Seed Incubator Pool (Cold-Start Creator Retention)', () => {
  it('allocates 6 target replicas for newly uploaded content with 0 organic seeders', () => {
    const replicas = SwarmSeedIncubatorPool.calculateIncubatorReplicas(0, 0);
    expect(replicas).toBe(6);
  });

  it('scales down incubator replicas as organic seeders and content age increase, with floor of 3', () => {
    // 24 hours old with 2 organic seeders
    const replicasMid = SwarmSeedIncubatorPool.calculateIncubatorReplicas(24, 2);
    expect(replicasMid).toBeLessThanOrEqual(4);
    expect(replicasMid).toBeGreaterThanOrEqual(3);

    // 72 hours old with 4 organic seeders -> hits minimum floor of 3
    const replicasFloor = SwarmSeedIncubatorPool.calculateIncubatorReplicas(72, 4);
    expect(replicasFloor).toBe(3);
  });

  it('determines incubator eligibility correctly (first 10 uploads, age <= 72h)', () => {
    expect(SwarmSeedIncubatorPool.isEligibleForIncubator(5, 24)).toBe(true);
    expect(SwarmSeedIncubatorPool.isEligibleForIncubator(10, 72)).toBe(true);
    expect(SwarmSeedIncubatorPool.isEligibleForIncubator(11, 24)).toBe(false); // Exceeded 10 uploads
    expect(SwarmSeedIncubatorPool.isEligibleForIncubator(2, 75)).toBe(false); // Exceeded 72 hours
  });
});
