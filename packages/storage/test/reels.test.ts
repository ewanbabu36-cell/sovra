import { describe, it, expect } from 'vitest';
import {
  VerticalReelsEngine,
  HlsPreWarmPool,
  HlsAbrEngine,
  type ReelDescriptor,
} from '../src/index.js';

describe('Step 1: Instagram-Style Vertical Reels Player Engine', () => {
  const sampleReels: ReelDescriptor[] = [
    {
      reelId: 'reel-alpha',
      creatorDid: 'did:sovra:alice_creator',
      creatorHandle: 'alice_creator',
      manifestCid: 'bafybei_manifest_0',
      segment0Cid: 'bafybei_segment_0_alpha',
      caption: 'P2P Reels live on Sovra! #reels #p2p',
      tags: ['#reels', '#p2p'],
      audioTrackTitle: 'Original Audio - alice_creator',
      durationSeconds: 15,
      initialLikesCount: 1200,
      initialCommentsCount: 45,
    },
    {
      reelId: 'reel-beta',
      creatorDid: 'did:sovra:bob_creator',
      creatorHandle: 'bob_live',
      manifestCid: 'bafybei_manifest_1',
      segment0Cid: 'bafybei_segment_0_beta',
      caption: 'Sub-300ms playback with BitSwap pre-warming! 🚀',
      tags: ['#bitswap', '#video'],
      audioTrackTitle: 'Cyber Beat - bob_live',
      durationSeconds: 30,
      initialLikesCount: 890,
      initialCommentsCount: 22,
    },
    {
      reelId: 'reel-gamma',
      creatorDid: 'did:sovra:carol_musician',
      creatorHandle: 'carol_sounds',
      manifestCid: 'bafybei_manifest_2',
      segment0Cid: 'bafybei_segment_0_gamma',
      caption: 'Spatial multi-track audio demo 🎧',
      tags: ['#audio', '#spatial'],
      audioTrackTitle: 'Echoes - Carol',
      durationSeconds: 20,
      initialLikesCount: 3400,
      initialCommentsCount: 110,
    },
  ];

  it('initializes reels playlist and pre-warms Segment 0 of initial and next reels', () => {
    const engine = new VerticalReelsEngine(sampleReels);
    expect(engine.activeIndex).toBe(0);
    expect(engine.currentReel.reelId).toBe('reel-alpha');

    const state = engine.getPlaybackState();
    expect(state.isPreWarmed).toBe(true);
    expect(state.firstFrameDecodeMs).toBeLessThanOrEqual(25); // Instant decode
    expect(state.preWarmedNextReelIds).toContain('reel-alpha');
    expect(state.preWarmedNextReelIds).toContain('reel-beta');
  });

  it('navigates forward and backward with automatic speculative window shift', () => {
    const engine = new VerticalReelsEngine(sampleReels);

    // Swipe up to next reel
    const nextState = engine.nextReel();
    expect(nextState.activeIndex).toBe(1);
    expect(nextState.activeReel.reelId).toBe('reel-beta');
    expect(nextState.isPreWarmed).toBe(true);
    expect(nextState.preWarmedNextReelIds).toContain('reel-gamma');

    // Swipe down back to previous reel
    const prevState = engine.previousReel();
    expect(prevState.activeIndex).toBe(0);
    expect(prevState.activeReel.reelId).toBe('reel-alpha');
  });

  it('detects Instagram double-tap heart gesture within 300ms interval', () => {
    const engine = new VerticalReelsEngine(sampleReels);
    const now = 1000000;

    // First tap
    const tap1 = engine.handleTapGesture(150, 300, now);
    expect(tap1.isHeartSpawned).toBe(false);

    // Second tap 180ms later (double-tap threshold <= 300ms)
    const tap2 = engine.handleTapGesture(150, 300, now + 180);
    expect(tap2.isHeartSpawned).toBe(true);
    expect(tap2.x).toBe(150);
    expect(tap2.y).toBe(300);

    // Third tap 500ms later (too slow, single tap only)
    const tap3 = engine.handleTapGesture(150, 300, now + 680);
    expect(tap3.isHeartSpawned).toBe(false);
  });

  it('creates and manages 24-hour ephemeral stories lifecycle', () => {
    const now = Date.now();
    const story = VerticalReelsEngine.createEphemeralStory(
      'did:sovra:alice_creator',
      'alice_creator',
      'bafybei_story_cid_123',
      now,
    );

    expect(story.creatorHandle).toBe('alice_creator');
    expect(story.expiresAt - story.createdAt).toBe(24 * 3600 * 1000);

    // Fresh story is not expired
    expect(VerticalReelsEngine.isStoryExpired(story, now + 12 * 3600 * 1000)).toBe(false);

    // Story after 24 hours and 1 minute is expired
    expect(VerticalReelsEngine.isStoryExpired(story, now + 24 * 3600 * 1000 + 60000)).toBe(true);
  });

  it('HlsPreWarmPool pre-warms Segment 0 in RAM buffer for i+1, i+2 with <= 250ms SLA', () => {
    const pool = new HlsPreWarmPool(16 * 1024 * 1024);
    const preWarmed = pool.preWarmWindow(0, sampleReels, 2);

    expect(preWarmed.length).toBeGreaterThan(0);
    expect(pool.isPreWarmed('bafybei_segment_0_alpha')).toBe(true);
    expect(pool.isPreWarmed('bafybei_segment_0_beta')).toBe(true);
    expect(pool.getFirstFrameDecodeMs('bafybei_segment_0_alpha')).toBeLessThanOrEqual(25);
    expect(pool.getFirstFrameDecodeMs('unwarmed_cid')).toBeLessThanOrEqual(250);
    expect(pool.ramUsageBytes).toBeGreaterThan(0);
  });

  it('HlsAbrEngine evaluates real-time buffer health B(t) and throughput to dynamically switch quality', () => {
    const abr = new HlsAbrEngine();

    // Critical buffer (< 2.0s): immediate fallback to 360p
    const emergencyDecision = abr.evaluate(1.2, 5_000_000, '720p');
    expect(emergencyDecision.selectedResolution).toBe('360p');
    expect(emergencyDecision.isDowngraded).toBe(true);

    // Moderate buffer (3.5s): 480p
    const recoveringDecision = abr.evaluate(3.5, 2_000_000, '360p');
    expect(recoveringDecision.selectedResolution).toBe('480p');

    // High buffer (> 8.0s) & high throughput: optimal 1080p
    const optimalDecision = abr.evaluate(9.5, 12_000_000, '720p');
    expect(optimalDecision.selectedResolution).toBe('1080p');
    expect(optimalDecision.isUpgraded).toBe(true);
  });
});
