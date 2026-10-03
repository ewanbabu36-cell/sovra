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
});
