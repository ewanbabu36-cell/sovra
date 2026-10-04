import { describe, it, expect } from 'vitest';
import { PeerScoringEngine } from '../src/scoring.js';

describe('P2P Defensive Peer Scoring Engine Suite', () => {
  it('tracks positive and negative behavior signals accurately', () => {
    const scoring = new PeerScoringEngine();
    const peerId = '12D3KooWTestPeer';

    expect(scoring.getScore(peerId)).toBe(0);

    // Valid message delivery increases score
    scoring.onValidMessageDelivery(peerId);
    expect(scoring.getScore(peerId)).toBe(1.0);

    // Malformed message reduces score
    scoring.onMalformedMessage(peerId);
    expect(scoring.getScore(peerId)).toBe(-24.0);

    // Invalid signature reduces score heavily
    scoring.onInvalidSignature(peerId);
    expect(scoring.getScore(peerId)).toBe(-74.0);
  });

  it('triggers graylist and blacklist thresholds', () => {
    const scoring = new PeerScoringEngine({
      graylistThreshold: -20,
      blacklistThreshold: -50,
    });
    const peerId = '12D3KooWMalicious';

    // Normal state
    expect(scoring.isGraylisted(peerId)).toBe(false);
    expect(scoring.isBlacklisted(peerId)).toBe(false);

    // Rate limit hit (-10)
    scoring.onRateLimitExceeded(peerId);
    expect(scoring.getScore(peerId)).toBe(-10);
    expect(scoring.isGraylisted(peerId)).toBe(false);

    // Second violation -> -20: Graylisted (drops from mesh)
    scoring.onRateLimitExceeded(peerId);
    expect(scoring.getScore(peerId)).toBe(-20);
    expect(scoring.isGraylisted(peerId)).toBe(true);
    expect(scoring.isBlacklisted(peerId)).toBe(false);

    // Invalid signature (-50) -> -70: Blacklisted (connection terminated)
    scoring.onInvalidSignature(peerId);
    expect(scoring.getScore(peerId)).toBe(-70);
    expect(scoring.isBlacklisted(peerId)).toBe(true);
  });

  it('decays scores towards zero over time', () => {
    const scoring = new PeerScoringEngine();
    const peerId = '12D3KooWRecovering';

    scoring.recordScoreDelta(peerId, -40, 'initial_penalty');
    expect(scoring.getScore(peerId)).toBe(-40);

    // Decay round 1 (0.5 factor)
    scoring.decayScores(0.5);
    expect(scoring.getScore(peerId)).toBe(-20);

    // Decay round 2
    scoring.decayScores(0.5);
    expect(scoring.getScore(peerId)).toBe(-10);
  });

  it('calculates peak-weighted SLA penalizing flapping and lazy nodes', async () => {
    const { calculatePeakWeightedNodeSla, shouldEvictNodeFromSwarm } = await import('../src/scoring.js');

    // 1. High performance node: 99% peak, 98% off-peak, 0% PoR failure
    const reliableSla = calculatePeakWeightedNodeSla({
      peakHoursUptimeRatio: 0.99,
      offPeakHoursUptimeRatio: 0.98,
      auditFailureRate: 0.0,
    });
    // ((0.99*2 + 0.98) / 3) * 100 = (2.96 / 3) * 100 = 98.67 -> 99
    expect(reliableSla).toBeGreaterThanOrEqual(98);
    expect(shouldEvictNodeFromSwarm(reliableSla, 0)).toBe(false);

    // 2. Flapping node gaming off-peak (40% peak uptime, 100% off-peak uptime)
    const flappingSla = calculatePeakWeightedNodeSla({
      peakHoursUptimeRatio: 0.40,
      offPeakHoursUptimeRatio: 1.00,
      auditFailureRate: 0.0,
    });
    // ((0.40*2 + 1.00) / 3) * 100 = 1.80/3 * 100 = 60
    expect(flappingSla).toBe(60);
    expect(flappingSla).toBeLessThan(65);

    // After 3 consecutive cycles below 65, swarm triggers automatic replica eviction
    expect(shouldEvictNodeFromSwarm(flappingSla, 3)).toBe(true);
    // 1 cycle does not trigger immediate premature eviction
    expect(shouldEvictNodeFromSwarm(flappingSla, 1)).toBe(false);

    // 3. Lazy node outsourcing or failing PoR disk audit challenges (25% failure)
    const lazySla = calculatePeakWeightedNodeSla({
      peakHoursUptimeRatio: 0.95,
      offPeakHoursUptimeRatio: 0.95,
      auditFailureRate: 0.25, // 25% failed challenges
    });
    // 100 * 0.95 * (1 - 0.25)^3 = 95 * 0.421875 = 40.07 -> 40
    expect(lazySla).toBeLessThan(50);
    expect(shouldEvictNodeFromSwarm(lazySla, 3)).toBe(true);
  });
});
