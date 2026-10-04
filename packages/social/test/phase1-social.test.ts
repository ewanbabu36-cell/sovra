import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateEd25519KeyPair, bytesToHex } from '@sovra/crypto';
import {
  DefaultSocialGraphEngine,
  ChannelManager,
  PageManager,
  OmniSearchEngine,
  createSignedFollowEvent,
  createSignedBlockEvent,
  createSignedFriendRequestEvent,
} from '../src/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Phase 1: Social Foundations (Channels, Pages, 2-Tier Graph, Omni-Search)', () => {
  let tempDbDir: string;
  let tempDbPath: string;

  beforeEach(() => {
    tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-phase1-social-test-'));
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

  describe('Two-Tier Social Graph (Public Follow + Bilateral Mutual Friends)', () => {
    it('manages bilateral friend handshake and mutual follow automation', async () => {
      const alice = createTestIdentity();
      const bob = createTestIdentity();
      const graph = new DefaultSocialGraphEngine({ dbPath: tempDbPath });

      // Initially neither are friends nor following
      expect(graph.isFriend(alice.pubkey, bob.pubkey)).toBe(false);
      expect(graph.isFollowing(alice.pubkey, bob.pubkey)).toBe(false);

      // 1. Alice sends friend request to Bob
      const sendReq = createSignedFriendRequestEvent(
        alice.pubkey,
        alice.keyPair.privateKey,
        bob.pubkey,
        'send',
      );
      const res1 = await graph.processEvent(sendReq);
      expect(res1.ok).toBe(true);
      expect(graph.hasPendingFriendRequestFrom(bob.pubkey, alice.pubkey)).toBe(true);
      expect(graph.isFriend(alice.pubkey, bob.pubkey)).toBe(false);

      // 2. Bob accepts Alice's friend request
      const acceptReq = createSignedFriendRequestEvent(
        bob.pubkey,
        bob.keyPair.privateKey,
        alice.pubkey,
        'accept',
      );
      const res2 = await graph.processEvent(acceptReq);
      expect(res2.ok).toBe(true);

      // Both are now confirmed friends
      expect(graph.isFriend(alice.pubkey, bob.pubkey)).toBe(true);
      expect(graph.isFriend(bob.pubkey, alice.pubkey)).toBe(true);
      expect(graph.getFriends(alice.pubkey)).toContain(bob.pubkey);
      expect(graph.getFriends(bob.pubkey)).toContain(alice.pubkey);

      // Mutual friendship automatically established mutual follows
      expect(graph.isFollowing(alice.pubkey, bob.pubkey)).toBe(true);
      expect(graph.isFollowing(bob.pubkey, alice.pubkey)).toBe(true);

      graph.close();
    });

    it('immediately severs friendship and following upon blocking', async () => {
      const alice = createTestIdentity();
      const bob = createTestIdentity();
      const graph = new DefaultSocialGraphEngine({ dbPath: tempDbPath });

      // Establish friendship first
      await graph.processEvent(
        createSignedFriendRequestEvent(alice.pubkey, alice.keyPair.privateKey, bob.pubkey, 'send'),
      );
      await graph.processEvent(
        createSignedFriendRequestEvent(bob.pubkey, bob.keyPair.privateKey, alice.pubkey, 'accept'),
      );
      expect(graph.isFriend(alice.pubkey, bob.pubkey)).toBe(true);

      // Alice blocks Bob
      const blockEvent = createSignedBlockEvent(
        alice.pubkey,
        alice.keyPair.privateKey,
        bob.pubkey,
        false,
        'harassment',
      );
      await graph.processEvent(blockEvent);

      expect(graph.isBlocked(alice.pubkey, bob.pubkey)).toBe(true);
      expect(graph.isFriend(alice.pubkey, bob.pubkey)).toBe(false);
      expect(graph.isFriend(bob.pubkey, alice.pubkey)).toBe(false);
      expect(graph.isFollowing(alice.pubkey, bob.pubkey)).toBe(false);

      graph.close();
    });

    it('enforces Ghost/Restrict mode locally without alerting the target', () => {
      const alice = createTestIdentity();
      const troll = createTestIdentity();
      const graph = new DefaultSocialGraphEngine({ dbPath: tempDbPath });

      expect(graph.isRestricted(alice.pubkey, troll.pubkey)).toBe(false);
      graph.restrictUser(alice.pubkey, troll.pubkey, false);

      expect(graph.isRestricted(alice.pubkey, troll.pubkey)).toBe(true);
      expect(graph.getRestrictedUsers(alice.pubkey)).toContain(troll.pubkey);

      // Unrestrict
      graph.restrictUser(alice.pubkey, troll.pubkey, true);
      expect(graph.isRestricted(alice.pubkey, troll.pubkey)).toBe(false);

      graph.close();
    });
  });

  describe('Sovereign Channel Manager', () => {
    it('creates channel, delegates roles, and tracks subscribers', () => {
      const alice = createTestIdentity();
      const bob = createTestIdentity();
      const charlie = createTestIdentity();
      const channels = new ChannelManager();

      // Alice creates a tech broadcast channel
      const res = channels.createChannel({
        ownerPubkey: alice.pubkey,
        handle: 'sovra_tech',
        name: 'Sovra Tech Radar',
        description: 'Decentralized tech updates',
        category: 'tech',
        type: 'broadcast',
      });

      expect(res.ok).toBe(true);
      const ch = (res as any).value;
      expect(ch.handle).toBe('@sovra_tech');
      expect(ch.roles[0].role).toBe('owner');

      // Alice delegates Editor role to Bob
      const roleRes = channels.assignRole(ch.id, alice.pubkey, bob.pubkey, 'editor');
      expect(roleRes.ok).toBe(true);
      expect((roleRes as any).value.roles.some((r: any) => r.pubkey === bob.pubkey && r.role === 'editor')).toBe(true);

      // Bob updates channel description
      const updateRes = channels.updateChannel(ch.id, bob.pubkey, {
        description: 'Updated tech radar by Bob and Alice',
      });
      expect(updateRes.ok).toBe(true);
      expect((updateRes as any).value.description).toBe('Updated tech radar by Bob and Alice');

      // Charlie attempts to update channel without permission -> fails
      const failUpdate = channels.updateChannel(ch.id, charlie.pubkey, {
        name: 'Hacked Name',
      });
      expect(failUpdate.ok).toBe(false);

      // Charlie and Bob subscribe
      channels.subscribe(ch.id, charlie.pubkey);
      channels.subscribe(ch.id, bob.pubkey);
      expect(channels.isSubscribed(ch.id, charlie.pubkey)).toBe(true);
      expect(channels.getChannel(ch.id)?.subscriberCount).toBe(2);

      // Bob unsubscribes
      channels.unsubscribe(ch.id, bob.pubkey);
      expect(channels.getChannel(ch.id)?.subscriberCount).toBe(1);
    });
  });

  describe('Sovereign Page Manager', () => {
    it('creates business page, handles reviews and CTA configuration', () => {
      const owner = createTestIdentity();
      const customer1 = createTestIdentity();
      const customer2 = createTestIdentity();
      const pages = new PageManager();

      const pageRes = pages.createPage({
        ownerPubkey: owner.pubkey,
        handle: 'cyber_cafe',
        name: 'Cyber Cafe & Lounge',
        category: 'business',
        bio: 'Fresh artisan coffee and gigabit Wi-Fi',
        ctaType: 'book',
        ctaLink: 'https://cybercafe.local/reserve',
      });

      expect(pageRes.ok).toBe(true);
      const page = (pageRes as any).value;
      expect(page.handle).toBe('@cyber_cafe');
      expect(page.ctaType).toBe('book');

      // Customers submit reviews
      pages.addReview(page.id, customer1.pubkey, 5, 'Amazing vibes and fast internet!');
      pages.addReview(page.id, customer2.pubkey, 4, 'Great coffee, slightly crowded.');

      const updatedPage = pages.getPage(page.id);
      expect(updatedPage?.reviews.length).toBe(2);
      expect(pages.getAverageRating(page.id)).toBe(4.5);

      // Follower tracking
      pages.followPage(page.id, customer1.pubkey);
      expect(pages.isFollowing(page.id, customer1.pubkey)).toBe(true);
      expect(pages.getPage(page.id)?.followerCount).toBe(1);
    });
  });

  describe('Omni-Search Engine', () => {
    it('indexes and searches across multiple tabs with zero central tracking', () => {
      const search = new OmniSearchEngine();

      search.indexPerson({
        pubkey: 'did:key:alice123',
        handle: '@alice_crypto',
        displayName: 'Alice Wonderland',
        bio: 'Decentralized systems researcher',
        isVerified: true,
      });

      search.indexChannel({
        id: 'channel-1',
        handle: '@sovra_news',
        name: 'Sovra Global News',
        description: 'P2P broadcast dispatch',
        category: 'news',
        subscriberCount: 15420,
      });

      search.indexPage({
        id: 'page-1',
        handle: '@metropolis_coffee',
        name: 'Metropolis Roastery',
        bio: 'Locally roasted sovereign coffee',
        category: 'business',
        followerCount: 3400,
      });

      search.indexPost({
        id: 'post-1',
        authorName: 'Alice',
        authorHandle: '@alice_crypto',
        title: 'Zero-Knowledge Cryptography in 2026',
        caption: 'Explaining recursive SNARKs and zero-disk state synchronization',
        tags: ['zkp', 'cryptography', 'privacy'],
      });

      search.indexAudio({
        id: 'audio-1',
        title: 'Midnight Ambient Waves',
        artist: 'Synthetic Dawn',
        usageCount: 840,
      });

      // 1. Search 'crypto' in 'all' tab -> finds person and post
      const allResults = search.search('crypto', 'all');
      expect(allResults.length).toBeGreaterThanOrEqual(2);
      expect(allResults.some(r => r.type === 'person' && r.handle === '@alice_crypto')).toBe(true);
      expect(allResults.some(r => r.type === 'post')).toBe(true);

      // 2. Search 'news' in 'channels' tab -> finds channel only
      const channelResults = search.search('news', 'channels');
      expect(channelResults.length).toBe(1);
      expect(channelResults[0].title).toBe('Sovra Global News');

      // 3. Search 'zkp' in 'hashtags' tab -> finds hashtag
      const tagResults = search.search('zkp', 'hashtags');
      expect(tagResults.length).toBe(1);
      expect(tagResults[0].title).toBe('#zkp');

      // 4. Search 'ambient' in 'audio' tab -> finds audio track
      const audioResults = search.search('ambient', 'audio');
      expect(audioResults.length).toBe(1);
      expect(audioResults[0].title).toBe('Midnight Ambient Waves');

      // 5. Recent Search History management
      search.addRecentSearch('privacy');
      search.addRecentSearch('alice');
      expect(search.getRecentSearches()).toEqual(['alice', 'privacy']);
      search.clearRecentSearches();
      expect(search.getRecentSearches()).toEqual([]);
    });
  });
});
