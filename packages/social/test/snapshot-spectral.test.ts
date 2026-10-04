import { describe, it, expect } from 'vitest';
import {
  EpochedStateSnapshotManager,
  SpectralGraphConductanceEngine,
} from '../src/index.js';

describe('Pillar 5: Epoched MMR State Snapshots (Sub-2s Warm Start)', () => {
  it('plans warm bootstrap sync with snapshot + delta when recent epoch exists', () => {
    const now = Date.now();
    const recentEpoch = {
      epochId: 100,
      epochStartTimestamp: now - 36 * 3600 * 1000,
      epochEndTimestamp: now - 12 * 3600 * 1000, // 12 hours ago
      activeCreatorCount: 50000,
      mmrStateRootHex: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      payloadSizeBytes: 2.2 * 1024 * 1024, // 2.2 MB
      verifierSignatures: ['sig1', 'sig2'],
    };

    const plan = EpochedStateSnapshotManager.planWarmBootstrapSync(now - 7 * 24 * 3600 * 1000, now, recentEpoch);
    expect(plan.strategy).toBe('epoch_snapshot_plus_delta');
    expect(plan.targetEpochId).toBe(100);
    expect(plan.estimatedDownloadSizeBytes).toBeLessThan(3.5 * 1024 * 1024);
    expect(plan.estimatedStartupDurationMs).toBeLessThanOrEqual(2000); // Sub-2s!
  });

  it('falls back to historical traversal if no recent epoch snapshot is available', () => {
    const now = Date.now();
    const staleEpoch = {
      epochId: 10,
      epochStartTimestamp: now - 100 * 24 * 3600 * 1000,
      epochEndTimestamp: now - 5 * 24 * 3600 * 1000, // 5 days old (>48h limit)
      activeCreatorCount: 1000,
      mmrStateRootHex: 'stale_root',
      payloadSizeBytes: 1024 * 1024,
      verifierSignatures: ['sig1'],
    };

    const plan = EpochedStateSnapshotManager.planWarmBootstrapSync(0, now, staleEpoch);
    expect(plan.strategy).toBe('full_historical_traversal');
    expect(plan.estimatedStartupDurationMs).toBeGreaterThan(10000);
  });

  it('verifies MMR snapshot state root integrity', () => {
    const manager = new EpochedStateSnapshotManager();
    const creators = ['did:sovra:alice', 'did:sovra:bob', 'did:sovra:carol'];

    // Empty creator set
    expect(manager.verifySnapshotIntegrity([], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(true);

    // Non-empty creator set verification
    const invalidRoot = '00'.repeat(32);
    expect(manager.verifySnapshotIntegrity(creators, invalidRoot)).toBe(false);
  });
});

describe('Pillar 10: Spectral Graph Conductance & Sybil Ring Isolation', () => {
  it('discounts isolated bot collusion rings with near-zero conductance to 0.0', () => {
    // 50,000 bots with 100,000 internal edges and only 10 boundary edges to outside world
    // volumeS = 200,010; minVol = 200,010; cut = 10 -> Conductance = 10 / 200010 = 0.00005 < 0.03
    const conductance = SpectralGraphConductanceEngine.calculateConductance(10, 200010, 500000);
    expect(conductance).toBeLessThan(0.03);

    const discount = SpectralGraphConductanceEngine.calculateTrustDiscount(conductance);
    expect(discount).toBe(0.0); // Completely discounted!

    const evaluation = SpectralGraphConductanceEngine.evaluateCluster('botnet_ring_1', 100000, 10, 500000);
    expect(evaluation.isSybilRing).toBe(true);
    expect(evaluation.trustDiscount).toBe(0.0);
    expect(evaluation.explanation).toContain('collusion ring');
  });

  it('awards full 1.0 trust weight to well-integrated healthy organic communities', () => {
    // Healthy community: 500 internal edges, 300 boundary cut edges to other organic users
    // volumeS = 1300; volumeNotS = 10000; conductance = 300 / 1300 = 0.231 >= 0.15
    const evaluation = SpectralGraphConductanceEngine.evaluateCluster('organic_dev_community', 500, 300, 10000);
    expect(evaluation.conductance).toBeGreaterThanOrEqual(0.15);
    expect(evaluation.trustDiscount).toBe(1.0);
    expect(evaluation.isSybilRing).toBe(false);
    expect(evaluation.explanation).toContain('healthy, well-integrated');
  });

  it('applies power-law partial discount to peripheral communities with intermediate conductance', () => {
    // Conductance = 0.09 (between 0.03 and 0.15)
    const discount = SpectralGraphConductanceEngine.calculateTrustDiscount(0.09);
    expect(discount).toBeGreaterThan(0.0);
    expect(discount).toBeLessThan(1.0);
  });
});
