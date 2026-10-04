import { describe, it, expect } from 'vitest';
import {
  HybridLogicalClock,
  PNCounterCRDT,
} from '../src/index.js';

describe('Pillar 9: Hybrid Logical Clocks & CRDT PN-Counter State Compaction', () => {
  it('guarantees monotonic causality across independent nodes despite physical clock drift', () => {
    const clockA = new HybridLogicalClock('node-A');
    const clockB = new HybridLogicalClock('node-B');

    const t1 = clockA.now();
    // Simulate peer A sending message to peer B
    const t2 = clockB.update(t1);

    expect(HybridLogicalClock.compare(t2, t1)).toBeGreaterThan(0);

    const t3 = clockB.now();
    expect(HybridLogicalClock.compare(t3, t2)).toBeGreaterThanOrEqual(0);
  });

  it('compacts hundreds of likes/reactions and merges conflict-free across gossip peers', () => {
    const postReactionsA = new PNCounterCRDT();
    const postReactionsB = new PNCounterCRDT();

    // Node A records interactions from user 1 & user 2
    postReactionsA.increment('user-1', 1);
    postReactionsA.increment('user-2', 1);
    // User 1 unlikes
    postReactionsA.decrement('user-1', 1);

    // Node B concurrently records interaction from user 3
    postReactionsB.increment('user-3', 1);

    expect(postReactionsA.value()).toBe(1); // User 2 is net +1
    expect(postReactionsB.value()).toBe(1); // User 3 is net +1

    // Gossip synchronization: merge CRDTs
    postReactionsA.merge(postReactionsB);
    postReactionsB.merge(postReactionsA);

    // Both converge deterministically to net value = 2
    expect(postReactionsA.value()).toBe(2);
    expect(postReactionsB.value()).toBe(2);

    const json = postReactionsA.toJSON();
    expect(json.P['user-2']).toBe(1);
    expect(json.P['user-3']).toBe(1);
    expect(json.N['user-1']).toBe(1);
  });

  it('rejects future timestamps exceeding 60-second drift boundary to prevent feed pinning', async () => {
    const { assertPhysicalClockDriftBound } = await import('../src/index.js');
    const now = 1000000;

    // Normal timestamp (5 seconds ahead) is permitted
    expect(assertPhysicalClockDriftBound(now + 5000, 60000, now)).toBe(true);

    // Attacker timestamp (5 minutes ahead) is strictly rejected
    expect(assertPhysicalClockDriftBound(now + 300000, 60000, now)).toBe(false);
  });

  it('compacts CRDT tombstones when cancelled unlike pairs exceed 40% threshold', async () => {
    const { compactTombstones } = await import('../src/index.js');
    const counter = new PNCounterCRDT();

    // 2 active likes, 3 cancelled likes (P[u] == N[u])
    counter.increment('active-1');
    counter.increment('active-2');

    counter.increment('cancel-1');
    counter.decrement('cancel-1');
    counter.increment('cancel-2');
    counter.decrement('cancel-2');
    counter.increment('cancel-3');
    counter.decrement('cancel-3');

    // Total entries: P=5, N=3 => total=8 entries. Cancelled pairs=3 (6 entries) => 6/8 = 75% tombstone ratio!
    const res = compactTombstones(counter, 0.40);
    expect(res.wasCompacted).toBe(true);
    expect(res.compactedEntries).toBe(3);

    // Net value remains invariant (= 2)
    expect(counter.value()).toBe(2);
  });

  it('computes privacy-preserving on-device feed ranking with time decay and exploration boost', async () => {
    const { computePrivacyPreservingRankScore, ColdStartBloomTree } = await import('../src/index.js');

    // Fresh post (age 0.5 hours) from high-rep author with high local affinity
    const freshScore = computePrivacyPreservingRankScore({
      authorReputation: 90,
      localAffinity: 0.9,
      ageHours: 0.5,
      isExplorationCandidate: false,
    });

    // Old post (age 48 hours) from same author
    const oldScore = computePrivacyPreservingRankScore({
      authorReputation: 90,
      localAffinity: 0.9,
      ageHours: 48,
      isExplorationCandidate: false,
    });
    expect(freshScore).toBeGreaterThan(oldScore);

    // Exploration candidate receives 0.15 boost to break filter bubble
    const exploreScore = computePrivacyPreservingRankScore({
      authorReputation: 50,
      localAffinity: 0.5,
      ageHours: 10,
      isExplorationCandidate: true,
    });
    const nonExploreScore = computePrivacyPreservingRankScore({
      authorReputation: 50,
      localAffinity: 0.5,
      ageHours: 10,
      isExplorationCandidate: false,
    });
    expect(exploreScore - nonExploreScore).toBeCloseTo(0.15, 2);

    // Bloom tree indexing
    const bloom = new ColdStartBloomTree();
    bloom.addTopic('p2p');
    bloom.addTopic('cryptography');
    expect(bloom.hasTopic('p2p')).toBe(true);
    expect(bloom.hasTopic('spam')).toBe(false);
  });
});

