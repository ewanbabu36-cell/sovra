import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateEd25519KeyPair, bytesToHex } from '@sovra/crypto';
import {
  DefaultSocialGraphEngine,
  DefaultLocalFeedEngine,
  createSignedFollowEvent,
  createSignedBlockEvent,
  createSignedMuteEvent,
  createSignedReactionEvent,
  createSignedShortPost,
} from '../src/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Phase 5: Decentralized Social Graph Protocol & Feed Engine', () => {
  let tempDbDir: string;
  let tempDbPath: string;

  beforeEach(() => {
    tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-social-test-'));
    tempDbPath = path.join(tempDbDir, 'social.sqlite');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDbDir, { recursive: true, force: true });
    } catch {}
  });

  function createTestIdentity() {
    const keyPair = generateEd25519KeyPair();
    const pubkeyHex = bytesToHex(keyPair.publicKey);
    return {
      keyPair,
      pubkey: pubkeyHex,
    };
  }

  describe('Social Graph Engine: Follow / Unfollow & LWW Conflict Resolution', () => {
    it('manages follow relationships with cryptographic signature validation', async () => {
      const alice = createTestIdentity();
      const bob = createTestIdentity();
      const graph = new DefaultSocialGraphEngine();

      // Alice follows Bob
      const followEvent = createSignedFollowEvent(
        alice.pubkey,
        alice.keyPair.privateKey,
        bob.pubkey,
        false,
        ['wss://relay1.sovra.net'],
        1000,
      );

      const res = await graph.processEvent(followEvent);
      expect(res.ok).toBe(true);
      expect(graph.isFollowing(alice.pubkey, bob.pubkey)).toBe(true);
      expect(graph.getFollowing(alice.pubkey)).toEqual([bob.pubkey]);

      // Alice unfollows Bob
      const unfollowEvent = createSignedFollowEvent(
        alice.pubkey,
        alice.keyPair.privateKey,
        bob.pubkey,
        true,
        undefined,
        1050,
      );

      const unres = await graph.processEvent(unfollowEvent);
      expect(unres.ok).toBe(true);
      expect(graph.isFollowing(alice.pubkey, bob.pubkey)).toBe(false);
      expect(graph.getFollowing(alice.pubkey)).toEqual([]);
    });

    it('rejects stale out-of-order events using Last-Write-Wins (LWW)', async () => {
      const alice = createTestIdentity();
      const bob = createTestIdentity();
      const graph = new DefaultSocialGraphEngine();

      // Newer event: Unfollow Bob at timestamp 2000
      const unfollowEvent = createSignedFollowEvent(
        alice.pubkey,
        alice.keyPair.privateKey,
        bob.pubkey,
        true,
        undefined,
        2000,
      );
      await graph.processEvent(unfollowEvent);

      // Older event arrives late: Follow Bob at timestamp 1000
      const staleFollowEvent = createSignedFollowEvent(
        alice.pubkey,
        alice.keyPair.privateKey,
        bob.pubkey,
        false,
        undefined,
        1000,
      );
      await graph.processEvent(staleFollowEvent);

      // The newer unfollow MUST win
      expect(graph.isFollowing(alice.pubkey, bob.pubkey)).toBe(false);
    });

    it('rejects events with forged or invalid signatures', async () => {
      const alice = createTestIdentity();
      const bob = createTestIdentity();
      const eve = createTestIdentity();
      const graph = new DefaultSocialGraphEngine();

      // Eve creates an event claiming to be Alice but signed with Eve's key
      const forgedEvent = createSignedFollowEvent(
        alice.pubkey,
        eve.keyPair.privateKey, // Wrong key!
        bob.pubkey,
        false,
      );

      const res = await graph.processEvent(forgedEvent);
      expect(res.ok).toBe(false);
      expect(graph.isFollowing(alice.pubkey, bob.pubkey)).toBe(false);
    });
  });

  describe('Social Graph Engine: Blocks, Mutes & Reactions', () => {
    it('blocks target user, immediately revoking existing follow and preventing re-follow', async () => {
      const alice = createTestIdentity();
      const bob = createTestIdentity();
      const graph = new DefaultSocialGraphEngine();

      // Alice follows Bob
      const follow = createSignedFollowEvent(
        alice.pubkey,
        alice.keyPair.privateKey,
        bob.pubkey,
        false,
        undefined,
        1000,
      );
      await graph.processEvent(follow);
      expect(graph.isFollowing(alice.pubkey, bob.pubkey)).toBe(true);

      // Alice blocks Bob
      const block = createSignedBlockEvent(
        alice.pubkey,
        alice.keyPair.privateKey,
        bob.pubkey,
        false,
        'Harassment',
        1100,
      );
      await graph.processEvent(block);

      expect(graph.isBlocked(alice.pubkey, bob.pubkey)).toBe(true);
      expect(graph.getBlockedUsers(alice.pubkey)).toContain(bob.pubkey);
      // Follow must be severed
      expect(graph.isFollowing(alice.pubkey, bob.pubkey)).toBe(false);

      // Trying to follow Bob while blocked is prevented
      const followAttempt = createSignedFollowEvent(
        alice.pubkey,
        alice.keyPair.privateKey,
        bob.pubkey,
        false,
        undefined,
        1200,
      );
      await graph.processEvent(followAttempt);
      expect(graph.isFollowing(alice.pubkey, bob.pubkey)).toBe(false);

      // Unblocking restores ability to follow
      const unblock = createSignedBlockEvent(
        alice.pubkey,
        alice.keyPair.privateKey,
        bob.pubkey,
        true,
        undefined,
        1300,
      );
      await graph.processEvent(unblock);
      expect(graph.isBlocked(alice.pubkey, bob.pubkey)).toBe(false);

      const followAgain = createSignedFollowEvent(
        alice.pubkey,
        alice.keyPair.privateKey,
        bob.pubkey,
        false,
        undefined,
        1400,
      );
      await graph.processEvent(followAgain);
      expect(graph.isFollowing(alice.pubkey, bob.pubkey)).toBe(true);
    });

    it('enforces mutes with duration expiration', async () => {
      const alice = createTestIdentity();
      const bob = createTestIdentity();
      const graph = new DefaultSocialGraphEngine();

      const now = Math.floor(Date.now() / 1000);
      // Mute Bob for 3600 seconds
      const mute = createSignedMuteEvent(
        alice.pubkey,
        alice.keyPair.privateKey,
        bob.pubkey,
        false,
        3600,
        now,
      );
      await graph.processEvent(mute);

      expect(graph.isMuted(alice.pubkey, bob.pubkey)).toBe(true);
      expect(graph.getMutedUsers(alice.pubkey)).toContain(bob.pubkey);

      // Expired mute event on charlie (10 seconds duration, set 100 seconds in past)
      const charlie = createTestIdentity();
      const expiredMute = createSignedMuteEvent(
        alice.pubkey,
        alice.keyPair.privateKey,
        charlie.pubkey,
        false,
        10, // 10 seconds duration
        now - 100, // 100 seconds ago -> already expired
      );
      await graph.processEvent(expiredMute);

      expect(graph.isMuted(alice.pubkey, charlie.pubkey)).toBe(false);
      expect(graph.getMutedUsers(alice.pubkey)).not.toContain(charlie.pubkey);

      // Explicitly unmute Bob
      const unmuteBob = createSignedMuteEvent(
        alice.pubkey,
        alice.keyPair.privateKey,
        bob.pubkey,
        true,
        undefined,
        now + 10,
      );
      await graph.processEvent(unmuteBob);
      expect(graph.isMuted(alice.pubkey, bob.pubkey)).toBe(false);
    });

    it('tracks reactions and retractions', async () => {
      const alice = createTestIdentity();
      const targetEventId = 'event_dag_root_001';
      const graph = new DefaultSocialGraphEngine();

      // Alice reacts ❤️
      const reaction = createSignedReactionEvent(
        alice.pubkey,
        alice.keyPair.privateKey,
        targetEventId,
        '❤️',
        false,
        1000,
      );
      await graph.processEvent(reaction);

      let reactions = graph.getReactions(targetEventId);
      expect(reactions.length).toBe(1);
      expect(reactions[0]?.emoji).toBe('❤️');
      expect(reactions[0]?.authorPubkey).toBe(alice.pubkey);

      // Alice retracts reaction
      const retraction = createSignedReactionEvent(
        alice.pubkey,
        alice.keyPair.privateKey,
        targetEventId,
        '❤️',
        true,
        1001,
      );
      await graph.processEvent(retraction);

      reactions = graph.getReactions(targetEventId);
      expect(reactions.length).toBe(0);
    });
  });

  describe('ACID SQLite Persistence & Disaster Recovery', () => {
    it('persists graph edges to SQLite and completely restores them on restart', async () => {
      const alice = createTestIdentity();
      const bob = createTestIdentity();
      const charlie = createTestIdentity();

      // 1. Initialize SQLite-backed engine
      const graph1 = new DefaultSocialGraphEngine({ dbPath: tempDbPath });

      // Alice follows Bob
      await graph1.processEvent(
        createSignedFollowEvent(alice.pubkey, alice.keyPair.privateKey, bob.pubkey, false, undefined, 1000),
      );

      // Alice blocks Charlie
      await graph1.processEvent(
        createSignedBlockEvent(alice.pubkey, alice.keyPair.privateKey, charlie.pubkey, false, 'Spam', 1010),
      );

      // Alice reacts to an event
      await graph1.processEvent(
        createSignedReactionEvent(alice.pubkey, alice.keyPair.privateKey, 'ev_42', '🔥', false, 1020),
      );

      // Close graph engine 1
      graph1.close();

      // Verify file exists
      expect(fs.existsSync(tempDbPath)).toBe(true);

      // 2. Open fresh graph engine from same SQLite database
      const graph2 = new DefaultSocialGraphEngine({ dbPath: tempDbPath });

      expect(graph2.isFollowing(alice.pubkey, bob.pubkey)).toBe(true);
      expect(graph2.isBlocked(alice.pubkey, charlie.pubkey)).toBe(true);
      const reactions = graph2.getReactions('ev_42');
      expect(reactions.length).toBe(1);
      expect(reactions[0]?.emoji).toBe('🔥');

      graph2.close();
    });
  });

  describe('LocalFeedEngine: Algorithmic Neutrality & Local Suppression', () => {
    it('builds strictly chronological timeline with zero central algorithmic bias', () => {
      const alice = createTestIdentity();
      const bob = createTestIdentity();
      const graph = new DefaultSocialGraphEngine();
      const feed = new DefaultLocalFeedEngine(graph);

      // Alice follows Bob
      graph.processEvent(
        createSignedFollowEvent(alice.pubkey, alice.keyPair.privateKey, bob.pubkey, false, undefined, 500),
      );

      const post1 = createSignedShortPost(bob.pubkey, bob.keyPair.privateKey, 'Bob Post 1', undefined, [], 1000);
      const post2 = createSignedShortPost(alice.pubkey, alice.keyPair.privateKey, 'Alice Post 1', undefined, [], 1010);
      const post3 = createSignedShortPost(bob.pubkey, bob.keyPair.privateKey, 'Bob Post 2', undefined, [], 1020);

      // Ingest in random order
      feed.appendEvent(post2);
      feed.appendEvent(post1);
      feed.appendEvent(post3);

      const timeline = feed.getChronologicalFeed(alice.pubkey, 10);
      expect(timeline.length).toBe(3);
      // Strictly newest first (createdAt descending)
      expect(timeline[0]?.id).toBe(post3.id);
      expect(timeline[1]?.id).toBe(post2.id);
      expect(timeline[2]?.id).toBe(post1.id);
    });

    it('enforces client-side edge blocking and muting without network censorship', async () => {
      const alice = createTestIdentity();
      const bob = createTestIdentity();
      const charlie = createTestIdentity();
      const graph = new DefaultSocialGraphEngine();
      const feed = new DefaultLocalFeedEngine(graph);

      // Alice follows Bob and Charlie
      await graph.processEvent(
        createSignedFollowEvent(alice.pubkey, alice.keyPair.privateKey, bob.pubkey, false, undefined, 100),
      );
      await graph.processEvent(
        createSignedFollowEvent(alice.pubkey, alice.keyPair.privateKey, charlie.pubkey, false, undefined, 100),
      );

      const postBob = createSignedShortPost(bob.pubkey, bob.keyPair.privateKey, 'Hello from Bob', undefined, [], 200);
      const postCharlie = createSignedShortPost(charlie.pubkey, charlie.keyPair.privateKey, 'Spam from Charlie', undefined, [], 210);

      feed.appendEvent(postBob);
      feed.appendEvent(postCharlie);

      let timeline = feed.getChronologicalFeed(alice.pubkey);
      expect(timeline.length).toBe(2);

      // Alice blocks Charlie locally
      await graph.processEvent(
        createSignedBlockEvent(alice.pubkey, alice.keyPair.privateKey, charlie.pubkey, false, 'Spam', 300),
      );

      // Charlie's posts are instantly omitted from Alice's feed
      timeline = feed.getChronologicalFeed(alice.pubkey);
      expect(timeline.length).toBe(1);
      expect(timeline[0]?.id).toBe(postBob.id);
    });

    it('supports deterministic pagination with beforeTimestamp and limit', () => {
      const alice = createTestIdentity();
      const graph = new DefaultSocialGraphEngine();
      const feed = new DefaultLocalFeedEngine(graph);

      for (let i = 1; i <= 10; i++) {
        const post = createSignedShortPost(
          alice.pubkey,
          alice.keyPair.privateKey,
          `Post ${i}`,
          undefined,
          [],
          1000 + i * 10,
        );
        feed.appendEvent(post);
      }

      // Page 1: top 3 (timestamps 1100, 1090, 1080)
      const page1 = feed.getChronologicalFeed(alice.pubkey, 3);
      expect(page1.length).toBe(3);
      expect(page1[0]?.content).toBe('Post 10');
      expect(page1[1]?.content).toBe('Post 9');
      expect(page1[2]?.content).toBe('Post 8');

      // Page 2: next 3 before timestamp 1080 (timestamps 1070, 1060, 1050)
      const page2 = feed.getChronologicalFeed(alice.pubkey, 3, page1[2]?.createdAt);
      expect(page2.length).toBe(3);
      expect(page2[0]?.content).toBe('Post 7');
      expect(page2[1]?.content).toBe('Post 6');
      expect(page2[2]?.content).toBe('Post 5');
    });

    it('generates privacy-preserving ranked discovery feed using local reputation and affinity', async () => {
      const alice = createTestIdentity();
      const bob = createTestIdentity();
      const eve = createTestIdentity();

      const graph = new DefaultSocialGraphEngine();
      // Alice follows Bob
      await graph.processEvent(
        createSignedFollowEvent(alice.pubkey, alice.keyPair.privateKey, bob.pubkey, false, 100),
      );

      const feed = new DefaultLocalFeedEngine(graph);
      const now = Math.floor(Date.now() / 1000);

      const postBob = createSignedShortPost(
        bob.pubkey,
        bob.keyPair.privateKey,
        'Bob post',
        undefined,
        [],
        now - 60, // 1 minute ago
      );
      const postEve = createSignedShortPost(
        eve.pubkey,
        eve.keyPair.privateKey,
        'Eve post',
        undefined,
        [],
        now - 300, // 5 minutes ago
      );

      feed.appendEvent(postBob);
      feed.appendEvent(postEve);

      // Ranked feed should elevate Bob due to follow affinity and high reputation
      const ranked = feed.getRankedDiscoveryFeed(alice.pubkey, 10, undefined, {
        [bob.pubkey]: 95,
        [eve.pubkey]: 20,
      });

      expect(ranked.length).toBe(2);
      expect(ranked[0]?.id).toBe(postBob.id);
    });
  });
});
