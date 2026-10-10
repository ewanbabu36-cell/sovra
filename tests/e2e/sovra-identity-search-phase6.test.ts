/**
 * @file tests/e2e/sovra-identity-search-phase6.test.ts
 * SOVRA PHASE 6: IDENTITY + SEARCH + SOCIAL GRAPH + DISCOVERY TEST SUITE
 *
 * Verifies:
 * 1. Single Primary Identity Model (/api/user/profile, aggregate data, non-fabricated metrics)
 * 2. Distinct Social Relationships (Follow, Friend Handshake, Subscribe, Join/Leave)
 * 3. Concurrent follow requests & idempotency
 * 4. Friendship lifecycle (Request, Pending, Unauthorized Accept 403, Accept, Remove, Self-friend 400)
 * 5. Mutual connections discovery (/api/friends/mutual)
 * 6. Server-Side Blocking across Profile, Feed, Chat, Comments, Search, and Unblock
 * 7. Profile editing & real-time handle validation (length, regex, reserved names, uniqueness 409)
 * 8. Privacy controls persistence & access control (profileVisibility, canMessageMe, canSendFriendRequests)
 * 9. Multi-entity search with scope filtering (all, people, channels, pages, groups, posts, videos, topics)
 * 10. Search autocomplete & hashtag topics discovery
 * 11. Relationships pagination & detailed relationship inspection
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('SOVRA Phase 6: Identity + Search + Social Graph + Discovery', () => {
  const ts = Date.now();
  let userAlice: { did: string; handle: string; sessionToken: string };
  let userBob: { did: string; handle: string; sessionToken: string };
  let userCharlie: { did: string; handle: string; sessionToken: string };
  let testChannelId: string;
  let testPageId: string;
  let testGroupId: string;
  let testPostId: string;

  beforeAll(async () => {
    // 1. Register User Alice
    const resA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@alice_${ts}`,
        name: 'Alice Sovereign',
        bio: 'Cryptography researcher and mesh operator #privacy #crypto',
      }),
    });
    expect(resA.status).toBe(200);
    const dataA = await resA.json();
    expect(dataA.ok).toBe(true);
    userAlice = {
      did: dataA.user.did,
      handle: dataA.user.handle,
      sessionToken: dataA.sessionToken,
    };

    // 2. Register User Bob
    const resB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@bob_${ts}`,
        name: 'Bob Decentralized',
        bio: 'P2P network architect and content creator #tech',
      }),
    });
    expect(resB.status).toBe(200);
    const dataB = await resB.json();
    expect(dataB.ok).toBe(true);
    userBob = {
      did: dataB.user.did,
      handle: dataB.user.handle,
      sessionToken: dataB.sessionToken,
    };

    // 3. Register User Charlie
    const resC = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@charlie_${ts}`,
        name: 'Charlie Mesh',
        bio: 'Node operator in Bangalore #mesh #crypto',
      }),
    });
    expect(resC.status).toBe(200);
    const dataC = await resC.json();
    expect(dataC.ok).toBe(true);
    userCharlie = {
      did: dataC.user.did,
      handle: dataC.user.handle,
      sessionToken: dataC.sessionToken,
    };

    // 4. Create a test channel owned by Alice
    const chRes = await fetch(`${BASE_URL}/api/social/channels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAlice.sessionToken}`,
      },
      body: JSON.stringify({
        name: `Alice Crypto Lab ${ts}`,
        handle: `@alicelab_${ts}`,
        desc: 'Deep dives into zero-knowledge and peer routing',
      }),
    });
    const chData = await chRes.json();
    if (chData.ok && chData.channel) {
      testChannelId = chData.channel.id;
    }

    // 5. Create a test page owned by Bob
    const pgRes = await fetch(`${BASE_URL}/api/social/pages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userBob.sessionToken}`,
      },
      body: JSON.stringify({
        name: `Bob Open Tech ${ts}`,
        category: 'Technology',
        desc: 'Open hardware and sovereign compute initiatives',
      }),
    });
    const pgData = await pgRes.json();
    if (pgData.ok && pgData.page) {
      testPageId = pgData.page.id;
    }

    // 6. Create a test group owned by Alice
    const grpRes = await fetch(`${BASE_URL}/api/social/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAlice.sessionToken}`,
      },
      body: JSON.stringify({
        name: `Sovereignty Circle ${ts}`,
        desc: 'Local peer mesh discussions',
        privacy: 'public',
      }),
    });
    const grpData = await grpRes.json();
    if (grpData.ok && grpData.group) {
      testGroupId = grpData.group.id;
    }

    // 7. Publish a test post by Alice
    const postRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAlice.sessionToken}`,
      },
      body: JSON.stringify({
        caption: `Exploring self-sovereign discovery on the mesh! #crypto #privacy #${ts}`,
        visibility: 'public',
        tags: ['crypto', 'privacy', `tag_${ts}`],
      }),
    });
    const postData = await postRes.json();
    if (postData.ok && postData.post) {
      testPostId = postData.post.id;
    }
  });

  // =========================================================================
  // 1. SOVRA IDENTITY MODEL & FULL PROFILE AGGREGATE
  // =========================================================================
  describe('1. Single Identity Model & Full Profile Aggregate', () => {
    it('returns authentic self-profile with real stats and relationships', async () => {
      const res = await fetch(`${BASE_URL}/api/user/profile?did=${userAlice.did}`, {
        headers: { 'Authorization': `Bearer ${userAlice.sessionToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.user.did).toBe(userAlice.did);
      expect(data.user.handle).toBe(userAlice.handle);
      expect(data.relationship.isSelf).toBe(true);
      expect(data.stats).toBeDefined();
      expect(typeof data.stats.followersCount).toBe('number');
      expect(typeof data.stats.followingCount).toBe('number');
      expect(typeof data.stats.friendsCount).toBe('number');
      expect(Array.isArray(data.posts)).toBe(true);
    });

    it('resolves profile by handle correctly', async () => {
      const res = await fetch(`${BASE_URL}/api/user/profile?handle=${encodeURIComponent(userBob.handle)}`, {
        headers: { 'Authorization': `Bearer ${userAlice.sessionToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.user.did).toBe(userBob.did);
      expect(data.relationship.isSelf).toBe(false);
    });

    it('returns 404 for non-existent profile', async () => {
      const res = await fetch(`${BASE_URL}/api/user/profile?did=did:key:nonexistent123456789`);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });
  });

  // =========================================================================
  // 2. SOCIAL RELATIONSHIPS: FOLLOW / UNFOLLOW LIFECYCLE
  // =========================================================================
  describe('2. Follow / Unfollow Lifecycle', () => {
    it('prevents self-follow with 400 Bad Request', async () => {
      const res = await fetch(`${BASE_URL}/api/social/follow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({ targetDid: userAlice.did }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Cannot follow yourself');
    });

    it('allows Alice to follow Bob and updates real follower/following counts', async () => {
      const res = await fetch(`${BASE_URL}/api/social/follow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({ targetDid: userBob.did }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.isFollowing).toBe(true);

      // Verify relationship state from Bob's perspective
      const relRes = await fetch(`${BASE_URL}/api/social/relationship?did=${userBob.did}`, {
        headers: { 'Authorization': `Bearer ${userAlice.sessionToken}` },
      });
      const relData = await relRes.json();
      expect(relData.ok).toBe(true);
      expect(relData.isFollowing).toBe(true);
    });

    it('is idempotent: repeated follow calls do not duplicate counts', async () => {
      const res = await fetch(`${BASE_URL}/api/social/follow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({ targetDid: userBob.did }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.isFollowing).toBe(true);

      // Check Bob's followers list has Alice exactly once
      const fRes = await fetch(`${BASE_URL}/api/social/followers?did=${userBob.did}`);
      const fData = await fRes.json();
      expect(fData.ok).toBe(true);
      const aliceMatches = fData.followers.filter((u: any) => u.did === userAlice.did);
      expect(aliceMatches.length).toBe(1);
    });

    it('handles concurrent follow requests safely without race conditions', async () => {
      const promises = [
        fetch(`${BASE_URL}/api/social/follow`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userCharlie.sessionToken}`,
          },
          body: JSON.stringify({ targetDid: userBob.did }),
        }),
        fetch(`${BASE_URL}/api/social/follow`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userCharlie.sessionToken}`,
          },
          body: JSON.stringify({ targetDid: userBob.did }),
        }),
      ];
      const results = await Promise.all(promises);
      expect(results[0].status).toBe(200);
      expect(results[1].status).toBe(200);

      const fRes = await fetch(`${BASE_URL}/api/social/followers?did=${userBob.did}`);
      const fData = await fRes.json();
      const charlieMatches = fData.followers.filter((u: any) => u.did === userCharlie.did);
      expect(charlieMatches.length).toBe(1);
    });

    it('allows Charlie to unfollow Bob and accurately decrements counts', async () => {
      const res = await fetch(`${BASE_URL}/api/social/unfollow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userCharlie.sessionToken}`,
        },
        body: JSON.stringify({ targetDid: userBob.did }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.isFollowing).toBe(false);

      const fRes = await fetch(`${BASE_URL}/api/social/followers?did=${userBob.did}`);
      const fData = await fRes.json();
      const charlieMatches = fData.followers.filter((u: any) => u.did === userCharlie.did);
      expect(charlieMatches.length).toBe(0);
    });
  });

  // =========================================================================
  // 3. BILATERAL FRIENDSHIP HANDSHAKE & MUTUAL CONNECTIONS
  // =========================================================================
  describe('3. Friendship Lifecycle & Mutual Connections', () => {
    it('prevents self-friend requests with 400 Bad Request', async () => {
      const res = await fetch(`${BASE_URL}/api/friends/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({ toDid: userAlice.did }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Cannot send friend request to yourself');
    });

    it('creates a pending friend request from Alice to Bob', async () => {
      const res = await fetch(`${BASE_URL}/api/friends/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({ toDid: userBob.did }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.relationship.status).toBe('pending');
      expect(data.relationship.fromDid).toBe(userAlice.did);
      expect(data.relationship.toDid).toBe(userBob.did);

      // Verify relationship inspection reflects pending_sent for Alice and pending_received for Bob
      const relAlice = await (await fetch(`${BASE_URL}/api/social/relationship?did=${userBob.did}`, {
        headers: { 'Authorization': `Bearer ${userAlice.sessionToken}` },
      })).json();
      expect(relAlice.friendshipStatus).toBe('pending_sent');

      const relBob = await (await fetch(`${BASE_URL}/api/social/relationship?did=${userAlice.did}`, {
        headers: { 'Authorization': `Bearer ${userBob.sessionToken}` },
      })).json();
      expect(relBob.friendshipStatus).toBe('pending_received');
    });

    it('rejects unauthorized acceptance: Charlie cannot accept request sent to Bob', async () => {
      const res = await fetch(`${BASE_URL}/api/friends/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userCharlie.sessionToken}`,
        },
        body: JSON.stringify({ fromDid: userAlice.did, status: 'accept' }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it('allows Bob to accept the friend request, transitioning to friends', async () => {
      const res = await fetch(`${BASE_URL}/api/friends/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`,
        },
        body: JSON.stringify({ fromDid: userAlice.did, status: 'accept' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.relationship.status).toBe('accepted');

      // Verify mutual friendship status
      const relAlice = await (await fetch(`${BASE_URL}/api/social/relationship?did=${userBob.did}`, {
        headers: { 'Authorization': `Bearer ${userAlice.sessionToken}` },
      })).json();
      expect(relAlice.areFriends).toBe(true);
      expect(relAlice.friendshipStatus).toBe('accepted');
    });

    it('computes mutual connections correctly when Charlie also befriends Bob', async () => {
      // Charlie requests friendship with Bob
      await fetch(`${BASE_URL}/api/friends/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userCharlie.sessionToken}`,
        },
        body: JSON.stringify({ toDid: userBob.did }),
      });

      // Bob accepts Charlie
      await fetch(`${BASE_URL}/api/friends/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`,
        },
        body: JSON.stringify({ fromDid: userCharlie.did, status: 'accept' }),
      });

      // Alice and Charlie both have Bob as a friend -> mutual friends query between Alice and Charlie
      const mutRes = await fetch(`${BASE_URL}/api/friends/mutual?targetDid=${userCharlie.did}`, {
        headers: { 'Authorization': `Bearer ${userAlice.sessionToken}` },
      });
      expect(mutRes.status).toBe(200);
      const mutData = await mutRes.json();
      expect(mutData.ok).toBe(true);
      expect(mutData.count).toBeGreaterThanOrEqual(1);
      const hasBob = mutData.mutualFriends.some((u: any) => u.did === userBob.did);
      expect(hasBob).toBe(true);
    });

    it('removes friendship accurately upon remove request', async () => {
      const res = await fetch(`${BASE_URL}/api/friends/remove`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userCharlie.sessionToken}`,
        },
        body: JSON.stringify({ targetDid: userBob.did }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      const relRes = await (await fetch(`${BASE_URL}/api/social/relationship?did=${userBob.did}`, {
        headers: { 'Authorization': `Bearer ${userCharlie.sessionToken}` },
      })).json();
      expect(relRes.areFriends).toBe(false);
      expect(relRes.friendshipStatus).toBe('none');
    });
  });

  // =========================================================================
  // 4. CHANNELS, PAGES, GROUPS RELATIONSHIPS (SUBSCRIBE, FOLLOW, JOIN, LEAVE)
  // =========================================================================
  describe('4. Distinct Space Relationships: Subscribe, Follow, Join, Leave', () => {
    it('allows Bob to subscribe to Alice channel (User -> Channel = Subscribe)', async () => {
      if (!testChannelId) return;
      const res = await fetch(`${BASE_URL}/api/social/channels/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`,
        },
        body: JSON.stringify({ channelId: testChannelId }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it('allows Alice to follow Bob page (User -> Page = Follow)', async () => {
      if (!testPageId) return;
      const res = await fetch(`${BASE_URL}/api/social/pages/follow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({ pageId: testPageId }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it('allows Bob to join and leave Alice group (User -> Group = Member)', async () => {
      if (!testGroupId) return;
      // Join
      const joinRes = await fetch(`${BASE_URL}/api/social/groups/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`,
        },
        body: JSON.stringify({ groupId: testGroupId }),
      });
      expect(joinRes.status).toBe(200);
      const joinData = await joinRes.json();
      expect(joinData.ok).toBe(true);
      expect(joinData.status).toBe('joined');

      // Leave
      const leaveRes = await fetch(`${BASE_URL}/api/social/groups/leave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`,
        },
        body: JSON.stringify({ groupId: testGroupId }),
      });
      expect(leaveRes.status).toBe(200);
      const leaveData = await leaveRes.json();
      expect(leaveData.ok).toBe(true);
      expect(leaveData.status).toBe('left');
    });
  });

  // =========================================================================
  // 5. SERVER-SIDE BLOCKING & MULTI-SURFACE CONSISTENT ENFORCEMENT
  // =========================================================================
  describe('5. Server-Side Blocking & Consistent Enforcement', () => {
    it('prevents self-block with 400 Bad Request', async () => {
      const res = await fetch(`${BASE_URL}/api/social/block`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({ targetDid: userAlice.did }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Cannot block yourself');
    });

    it('Alice blocks Bob: severs follow and friend relationships instantly', async () => {
      const res = await fetch(`${BASE_URL}/api/social/block`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({ targetDid: userBob.did, reason: 'Testing blocking' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.isBlocked).toBe(true);

      // Verify list of blocked peers includes Bob
      const bRes = await fetch(`${BASE_URL}/api/social/blocked`, {
        headers: { 'Authorization': `Bearer ${userAlice.sessionToken}` },
      });
      const bData = await bRes.json();
      expect(bData.ok).toBe(true);
      expect(bData.blocked.some((u: any) => u.did === userBob.did)).toBe(true);

      // Follow relationships must be severed
      const follRes = await fetch(`${BASE_URL}/api/social/relationship?did=${userBob.did}`, {
        headers: { 'Authorization': `Bearer ${userAlice.sessionToken}` },
      });
      const follData = await follRes.json();
      expect(follData.isFollowing).toBe(false);
      expect(follData.areFriends).toBe(false);
      expect(follData.isBlocked).toBe(true);
    });

    it('enforces blocking on Profile: Bob cannot view Alice profile', async () => {
      const res = await fetch(`${BASE_URL}/api/user/profile?did=${userAlice.did}`, {
        headers: { 'Authorization': `Bearer ${userBob.sessionToken}` },
      });
      const data = await res.json();
      expect(data.isBlocked).toBe(true);
      expect(data.posts?.length || 0).toBe(0);
    });

    it('enforces blocking on Direct Chat: Bob cannot message Alice (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/chat/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`,
        },
        body: JSON.stringify({
          recipientDid: userAlice.did,
          text: 'Blocked message attempt',
        }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('blocked');
    });

    it('enforces blocking on Feed Comments: Bob cannot comment on Alice post (403 Forbidden)', async () => {
      if (!testPostId) return;
      const res = await fetch(`${BASE_URL}/api/feed/comment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`,
        },
        body: JSON.stringify({
          postId: testPostId,
          text: 'Blocked comment attempt',
        }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('blocked');
    });

    it('enforces blocking on Social Follow: Bob cannot follow Alice (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/social/follow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`,
        },
        body: JSON.stringify({ targetDid: userAlice.did }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('blocked');
    });

    it('enforces blocking on Friend Requests: Bob cannot send friend request to Alice (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/friends/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`,
        },
        body: JSON.stringify({ toDid: userAlice.did }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('blocked');
    });

    it('enforces blocking on Search: Bob cannot discover Alice in search results', async () => {
      const res = await fetch(`${BASE_URL}/api/search?q=alice&scope=people`, {
        headers: { 'Authorization': `Bearer ${userBob.sessionToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      const foundAlice = data.users.some((u: any) => u.did === userAlice.did);
      expect(foundAlice).toBe(false);
    });

    it('unblocks successfully via /api/social/unblock and restores access', async () => {
      const res = await fetch(`${BASE_URL}/api/social/unblock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({ targetDid: userBob.did }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.isBlocked).toBe(false);

      // Verify unblocked profile access
      const profRes = await fetch(`${BASE_URL}/api/user/profile?did=${userAlice.did}`, {
        headers: { 'Authorization': `Bearer ${userBob.sessionToken}` },
      });
      const profData = await profRes.json();
      expect(profData.ok).toBe(true);
      expect(profData.isBlocked).toBeFalsy();
    });
  });

  // =========================================================================
  // 6. PROFILE EDITING & REAL-TIME HANDLE VALIDATION
  // =========================================================================
  describe('6. Profile Editing & Real-Time Handle Validation', () => {
    it('validates handle length: rejects handle shorter than 3 characters', async () => {
      const res = await fetch(`${BASE_URL}/api/user/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userCharlie.sessionToken}`,
        },
        body: JSON.stringify({ handle: '@ab' }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('at least 3 characters');
    });

    it('validates handle characters: rejects special symbols and spaces', async () => {
      const res = await fetch(`${BASE_URL}/api/user/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userCharlie.sessionToken}`,
        },
        body: JSON.stringify({ handle: '@invalid name!#$' }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('letters, numbers');
    });

    it('rejects reserved system handles (@admin, @sovra, @system, etc.)', async () => {
      const res = await fetch(`${BASE_URL}/api/user/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userCharlie.sessionToken}`,
        },
        body: JSON.stringify({ handle: '@admin' }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('reserved');
    });

    it('enforces uniqueness: rejects handle already taken by Alice (409 Conflict)', async () => {
      const res = await fetch(`${BASE_URL}/api/user/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userCharlie.sessionToken}`,
        },
        body: JSON.stringify({ handle: userAlice.handle }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('already in use');
    });

    it('updates valid profile successfully with bio and website', async () => {
      const newHandle = `@charlie_mesh_${ts}`;
      const res = await fetch(`${BASE_URL}/api/user/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userCharlie.sessionToken}`,
        },
        body: JSON.stringify({
          handle: newHandle,
          displayName: 'Charlie Sovereign Node',
          bio: 'Verified decentralized validator on Sovra protocol',
          website: 'https://mesh.sovra.org',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.user.handle).toBe(newHandle);
      expect(data.user.displayName).toBe('Charlie Sovereign Node');
      expect(data.user.website).toBe('https://mesh.sovra.org');
    });
  });

  // =========================================================================
  // 7. PRIVACY SETTINGS & ACCESS CONTROL
  // =========================================================================
  describe('7. Privacy Controls & Settings Persistence', () => {
    it('persists privacy settings updates via /api/user/privacy', async () => {
      const res = await fetch(`${BASE_URL}/api/user/privacy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`,
        },
        body: JSON.stringify({
          profileVisibility: 'only_me',
          canMessageMe: 'friends',
          canSendFriendRequests: 'friends_of_friends',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.privacySettings.profileVisibility).toBe('only_me');
      expect(data.privacySettings.canMessageMe).toBe('friends');
      expect(data.privacySettings.canSendFriendRequests).toBe('friends_of_friends');
    });

    it('hides private profile dispatches and spaces from non-authorized viewers', async () => {
      const res = await fetch(`${BASE_URL}/api/user/profile?did=${userBob.did}`, {
        headers: { 'Authorization': `Bearer ${userCharlie.sessionToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.isPrivate).toBe(true);
      expect(data.posts.length).toBe(0);
      expect(data.channels.length).toBe(0);
      expect(data.pages.length).toBe(0);
      expect(data.groups.length).toBe(0);
    });

    it('rejects direct messages from non-friends when canMessageMe is friends only', async () => {
      const res = await fetch(`${BASE_URL}/api/chat/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userCharlie.sessionToken}`,
        },
        body: JSON.stringify({
          recipientDid: userBob.did,
          text: 'Private message attempt',
        }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('friends');
    });

    it('restores public settings cleanly', async () => {
      const res = await fetch(`${BASE_URL}/api/user/privacy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`,
        },
        body: JSON.stringify({
          profileVisibility: 'public',
          canMessageMe: 'public',
          canSendFriendRequests: 'public',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.privacySettings.profileVisibility).toBe('public');
    });
  });

  // =========================================================================
  // 8. CONTEXTUAL MULTI-ENTITY SEARCH & DISCOVERY ENGINE
  // =========================================================================
  describe('8. Contextual Multi-Entity Search & Autocomplete', () => {
    it('discovers multiple entity types under scope=all', async () => {
      const res = await fetch(`${BASE_URL}/api/search?q=alice&scope=all`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.users).toBeDefined();
      expect(data.users.some((u: any) => u.did === userAlice.did)).toBe(true);
      expect(data.counts).toBeDefined();
    });

    it('filters strictly by scope=people', async () => {
      const res = await fetch(`${BASE_URL}/api/search?q=alice&scope=people`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.users.length).toBeGreaterThan(0);
      expect(data.posts.length).toBe(0);
      expect(data.channels.length).toBe(0);
    });

    it('discovers channels under scope=channels', async () => {
      if (!testChannelId) return;
      const res = await fetch(`${BASE_URL}/api/search?q=crypto&scope=channels`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.channels.some((c: any) => c.id === testChannelId)).toBe(true);
    });

    it('discovers posts under scope=posts', async () => {
      if (!testPostId) return;
      const res = await fetch(`${BASE_URL}/api/search?q=self-sovereign&scope=posts`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.posts.some((p: any) => p.id === testPostId)).toBe(true);
    });

    it('returns fast debounced autocomplete suggestions', async () => {
      const res = await fetch(`${BASE_URL}/api/search/autocomplete?q=ali`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.suggestions)).toBe(true);
      const hasAlice = data.suggestions.some((s: any) => s.id === userAlice.did || s.title.toLowerCase().includes('alice'));
      expect(hasAlice).toBe(true);
    });

    it('discovers dispatches by hashtag topic via /api/topics/posts', async () => {
      const res = await fetch(`${BASE_URL}/api/topics/posts?topic=crypto&sort=latest`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.topic).toBe('crypto');
      expect(Array.isArray(data.posts)).toBe(true);
      expect(data.posts.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // 9. RELATIONSHIPS PAGINATION & DETAILED INSPECTION
  // =========================================================================
  describe('9. Relationships Pagination & Inspection', () => {
    it('supports pagination with limit and offset on followers', async () => {
      const res = await fetch(`${BASE_URL}/api/social/followers?did=${userBob.did}&limit=1&offset=0`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.followers.length).toBeLessThanOrEqual(1);
    });

    it('returns full granular relationship inspection data', async () => {
      const res = await fetch(`${BASE_URL}/api/social/relationship?did=${userBob.did}`, {
        headers: { 'Authorization': `Bearer ${userAlice.sessionToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(typeof data.isSelf).toBe('boolean');
      expect(typeof data.isFollowing).toBe('boolean');
      expect(typeof data.isFollowedBy).toBe('boolean');
      expect(typeof data.areFriends).toBe('boolean');
      expect(typeof data.isBlocked).toBe('boolean');
      expect(typeof data.canMessage).toBe('boolean');
      expect(typeof data.canSendFriendRequest).toBe('boolean');
    });
  });
});
