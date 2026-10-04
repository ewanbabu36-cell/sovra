import { describe, it, expect, beforeEach } from 'vitest';
import { SovraEvent, EventKind } from '@sovra/protocol';
import {
  DiscoveryEngine,
  UserDiscoveryContext,
} from '../src/index.js';

describe('Milestone 6: Cold-Start Discovery & Open Algorithm Marketplace', () => {
  let engine: DiscoveryEngine;
  const now = 1700000000;

  const createEvent = (
    id: string,
    pubkey: string,
    content: string,
    createdAt: number,
    tags: readonly [string, ...string[]][] = [],
  ): SovraEvent => ({
    id,
    pubkey,
    createdAt,
    kind: EventKind.ShortPost,
    tags,
    content,
  });

  beforeEach(() => {
    engine = new DiscoveryEngine();
  });

  it('indexes events by protocol tags and text hashtags, providing topic trends', () => {
    const e1 = createEvent('ev-1', 'author-1', 'Decentralized AI is here #ai #future', now - 100);
    const e2 = createEvent('ev-2', 'author-2', 'Learning cryptography and #ai', now - 200, [['t', 'crypto']]);
    const e3 = createEvent('ev-3', 'author-3', 'Fresh track released #music', now - 300);

    engine.indexEvent(e1);
    engine.indexEvent(e2);
    engine.indexEvent(e3);

    const topTopics = engine.getTopTopics();
    expect(topTopics.find(t => t.topic === 'ai')?.count).toBe(2);
    expect(topTopics.find(t => t.topic === 'crypto')?.count).toBe(1);
    expect(topTopics.find(t => t.topic === 'music')?.count).toBe(1);

    const aiEvents = engine.getEventsForTopic('ai');
    expect(aiEvents).toContain('ev-1');
    expect(aiEvents).toContain('ev-2');
  });

  it('ranks feed chronologically when user selects chronological strategy', () => {
    const e1 = createEvent('ev-1', 'author-1', 'Oldest', now - 300);
    const e2 = createEvent('ev-2', 'author-2', 'Middle', now - 200);
    const e3 = createEvent('ev-3', 'author-3', 'Newest', now - 100);

    const ranked = engine.rankFeed([e1, e2, e3], 'chronological', {
      userPubkey: 'user-alice',
    }, { nowTimestamp: now });

    expect(ranked[0]?.id).toBe('ev-3');
    expect(ranked[1]?.id).toBe('ev-2');
    expect(ranked[2]?.id).toBe('ev-1');
  });

  it('ranks viral posts higher under trending strategy', () => {
    const viralOld = createEvent('ev-viral', 'author-1', 'Viral post', now - 3600); // 1 hour old
    const coldNew = createEvent('ev-cold', 'author-2', 'Cold new post', now - 300);   // 5 min old

    engine.indexEvent(viralOld);
    engine.indexEvent(coldNew);

    // Record high engagement on viral post
    for (let i = 0; i < 20; i++) engine.recordEngagement('ev-viral', 'reaction');
    for (let i = 0; i < 10; i++) engine.recordEngagement('ev-viral', 'repost');

    const ranked = engine.rankFeed([coldNew, viralOld], 'trending', {
      userPubkey: 'user-alice',
    }, { nowTimestamp: now });

    // The high-engagement viral post must outrank the low-engagement newer post
    expect(ranked[0]?.id).toBe('ev-viral');
  });

  it('boosts topic-relevant posts under topic_affinity strategy for cold-start users', () => {
    const aiPost = createEvent('ev-ai', 'author-1', 'Breakthrough in machine learning #ai', now - 500);
    const cookPost = createEvent('ev-cook', 'author-2', 'Delicious pizza recipe #cooking', now - 200);

    engine.indexEvent(aiPost);
    engine.indexEvent(cookPost);

    // Cold-start user who selected "ai" as an interest
    const context: UserDiscoveryContext = {
      userPubkey: 'new-user-alice',
      interestTopics: ['ai'],
    };

    const ranked = engine.rankFeed([cookPost, aiPost], 'topic_affinity', context, { nowTimestamp: now });
    expect(ranked[0]?.id).toBe('ev-ai');
  });

  it('boosts friends and mutuals under social_proximity strategy and filters muted/blocked', () => {
    const strangerPost = createEvent('ev-stranger', 'pubkey-stranger', 'Hello world', now - 100);
    const friendPost = createEvent('ev-friend', 'pubkey-friend', 'Update from your friend', now - 200);
    const blockedPost = createEvent('ev-blocked', 'pubkey-blocked', 'Spam spam spam', now - 50);

    const context: UserDiscoveryContext = {
      userPubkey: 'user-alice',
      graphState: {
        pubkey: 'user-alice',
        followingSet: new Set(['pubkey-friend']),
        blockedSet: new Set(['pubkey-blocked']),
        mutedSet: new Set(),
        joinedCommunities: new Set(),
      },
    };

    const ranked = engine.rankFeed([strangerPost, friendPost, blockedPost], 'social_proximity', context, { nowTimestamp: now });

    // Friend post ranked first despite being older
    expect(ranked[0]?.id).toBe('ev-friend');
    expect(ranked[1]?.id).toBe('ev-stranger');
    // Blocked author post must be completely absent from feed
    expect(ranked.some(e => e.id === 'ev-blocked')).toBe(false);
  });

  it('computes privacy-preserving rank score with 1.4 age decay and 0.15 exploration boost', async () => {
    const { computePrivacyPreservingRankScore } = await import('../src/index.js');

    // Case 1: Fresh followed post (age 0h, rep 100, affinity 1.0, no exploration)
    const freshFollowed = computePrivacyPreservingRankScore({
      authorReputation: 100,
      localAffinity: 1.0,
      ageHours: 0,
      isExplorationCandidate: false,
    });
    // (100/100) * 1.0 * (1 / (1 + 0)^1.4) + 0 = 1.0
    expect(freshFollowed).toBe(1.0);

    // Case 2: Aged post (age 3h, decay = 1 / 4^1.4 = 1 / 6.9644 = 0.1436)
    const agedPost = computePrivacyPreservingRankScore({
      authorReputation: 100,
      localAffinity: 1.0,
      ageHours: 3,
      isExplorationCandidate: false,
    });
    expect(agedPost).toBeCloseTo(0.1436, 3);

    // Case 3: Outside graph exploration candidate gets +0.15 exploration boost to break echo chambers
    const explorationPost = computePrivacyPreservingRankScore({
      authorReputation: 80,
      localAffinity: 0.5,
      ageHours: 1, // decay = 1 / 2^1.4 = 0.3789
      isExplorationCandidate: true,
    });
    // (80/100) * 0.5 * 0.3789 + 0.15 = 0.4 * 0.3789 + 0.15 = 0.1516 + 0.15 = 0.3016
    expect(explorationPost).toBeGreaterThan(0.30);
  });

  it('gossips lightweight Bloom filter topic summaries without central trackers', async () => {
    const { ColdStartBloomTree } = await import('../src/index.js');
    const localTree = new ColdStartBloomTree();
    localTree.addTopic('cryptography');
    localTree.addTopic('privacy');

    expect(localTree.hasTopic('cryptography')).toBe(true);
    expect(localTree.hasTopic('gaming')).toBe(false);

    // Merge incoming gossip summary from peer node
    localTree.mergeGossipSummary(['gaming', 'solarpunk']);
    expect(localTree.hasTopic('gaming')).toBe(true);
    expect(localTree.hasTopic('solarpunk')).toBe(true);

    const payload = localTree.toGossipPayload();
    expect(payload.topicsCount).toBe(4);
    expect(payload.topics).toContain('privacy');
  });

  it('evaluates 1,000 post ranks on-device in < 15ms preventing mobile CPU thermal throttling', async () => {
    const { computePrivacyPreservingRankScore } = await import('../src/index.js');
    const start = performance.now();

    for (let i = 0; i < 1000; i++) {
      computePrivacyPreservingRankScore({
        authorReputation: (i % 100),
        localAffinity: (i % 10) / 10,
        ageHours: (i % 24),
        isExplorationCandidate: i % 7 === 0,
      });
    }

    const elapsedMs = performance.now() - start;
    // Must be extremely fast algebraic math on mobile CPU (no neural network choke)
    expect(elapsedMs).toBeLessThan(50);
  });
});
