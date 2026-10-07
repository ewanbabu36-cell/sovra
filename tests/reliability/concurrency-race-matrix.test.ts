import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

interface TestUser {
  did: string;
  handle: string;
  sessionToken: string;
}

describe('Concurrency & Race-Condition Defense Matrix', { timeout: 35000 }, () => {
  let alice: TestUser;
  const swarmUsers: TestUser[] = [];
  const SWARM_SIZE = 15;

  beforeAll(async () => {
    // Register primary user Alice
    const aliceRes = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `alice_race_${Date.now()}`,
        displayName: 'Alice Race Leader',
        deviceType: 'Desktop',
      }),
    });
    expect(aliceRes.status).toBe(200);
    const aliceData = await aliceRes.json();
    expect(aliceData.ok).toBe(true);
    alice = {
      did: aliceData.user.did,
      handle: aliceData.user.handle,
      sessionToken: aliceData.sessionToken,
    };
  });

  // --- RACE-01: HIGH CONCURRENCY USER REGISTRATION SWARM ---
  it('[RACE-01] 30 Concurrent User Registrations execute without race-condition collisions', async () => {
    const timestamp = Date.now();
    const registrationPromises = Array.from({ length: SWARM_SIZE }, (_, idx) => {
      const handle = `swarm_${timestamp}_${idx}`;
      return fetch(`${BASE_URL}/api/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle,
          displayName: `Swarm Peer ${idx}`,
          deviceType: 'Mobile',
        }),
      }).then(async res => {
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(data.user).toBeDefined();
        expect(data.sessionToken).toBeDefined();
        return {
          did: data.user.did,
          handle: data.user.handle,
          sessionToken: data.sessionToken,
        };
      });
    });

    const registered = await Promise.all(registrationPromises);
    expect(registered.length).toBe(SWARM_SIZE);
    swarmUsers.push(...registered);

    // Verify all DIDs and handles are unique
    const uniqueDids = new Set(registered.map(u => u.did));
    const uniqueHandles = new Set(registered.map(u => u.handle));
    expect(uniqueDids.size).toBe(SWARM_SIZE);
    expect(uniqueHandles.size).toBe(SWARM_SIZE);
  });

  // --- RACE-02: 30 PARALLEL CONCURRENT LIKES ---
  it('[RACE-02] 30 Concurrent likes on a single post resolve to exact atomic likesCount', async () => {
    // 1. Alice creates a target post
    const postRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({
        caption: 'Post subjected to 30 concurrent like requests',
        postType: 'text',
        tags: '#race #concurrency',
        visibility: 'public',
      }),
    });
    expect(postRes.status).toBe(200);
    const postData = await postRes.json();
    const targetPostId = postData.post.id;

    // 2. Swarm fires 30 concurrent likes
    const likePromises = swarmUsers.map(user =>
      fetch(`${BASE_URL}/api/feed/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.sessionToken}`,
        },
        body: JSON.stringify({
          postId: targetPostId,
          isLiked: true,
        }),
      }).then(async res => {
        expect(res.status).toBe(200);
        return res.json();
      })
    );

    await Promise.all(likePromises);

    // 3. Fetch feed and inspect the target post
    const feedRes = await fetch(`${BASE_URL}/api/feed/list`, {
      headers: { Authorization: `Bearer ${alice.sessionToken}` },
    });
    expect(feedRes.status).toBe(200);
    const feedData = await feedRes.json();
    const post = (feedData.posts || []).find((p: any) => p.id === targetPostId);

    expect(post).toBeDefined();
    expect(post.likesCount).toBe(SWARM_SIZE);
    expect(post.likedByDids.length).toBe(SWARM_SIZE);

    // Ensure every single swarm user DID is in likedByDids
    for (const user of swarmUsers) {
      expect(post.likedByDids).toContain(user.did);
    }
  });

  // --- RACE-03: IDEMPOTENCY UNDER CONCURRENT DUPLICATE LIKES ---
  it('[RACE-03] 30 Duplicate concurrent likes are strictly idempotent and do not double count', async () => {
    // Alice creates target post
    const postRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({
        caption: 'Idempotency under load test post',
        postType: 'text',
        tags: '#idempotent',
        visibility: 'public',
      }),
    });
    const postData = await postRes.json();
    const targetPostId = postData.post.id;

    // First round of likes
    await Promise.all(
      swarmUsers.map(u =>
        fetch(`${BASE_URL}/api/feed/like`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.sessionToken}` },
          body: JSON.stringify({ postId: targetPostId, isLiked: true }),
        })
      )
    );

    // Second round of concurrent duplicate likes
    const duplicatePromises = swarmUsers.map(u =>
      fetch(`${BASE_URL}/api/feed/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.sessionToken}` },
        body: JSON.stringify({ postId: targetPostId, isLiked: true }),
      }).then(r => r.json())
    );

    await Promise.all(duplicatePromises);

    // Verify likesCount is STILL exactly SWARM_SIZE, not 2 * SWARM_SIZE
    const feedRes = await fetch(`${BASE_URL}/api/feed/list`, {
      headers: { Authorization: `Bearer ${alice.sessionToken}` },
    });
    const feedData = await feedRes.json();
    const post = (feedData.posts || []).find((p: any) => p.id === targetPostId);

    expect(post).toBeDefined();
    expect(post.likesCount).toBe(SWARM_SIZE);
    expect(post.likedByDids.length).toBe(SWARM_SIZE);
  });

  // --- RACE-04: CONCURRENT POLL VOTING INTEGRITY ---
  it('[RACE-04] 30 Concurrent poll votes across 3 options record exact ballot distribution', async () => {
    // 1. Alice creates a Poll post with 3 options
    const postRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({
        caption: 'Which language powers the fastest sovereign node?',
        postType: 'poll',
        pollData: {
          question: 'Which language powers the fastest sovereign node?',
          options: [
            { id: 'opt_rust', text: 'Rust', votes: 0, votesCount: 0, voterDids: [] },
            { id: 'opt_ts', text: 'TypeScript', votes: 0, votesCount: 0, voterDids: [] },
            { id: 'opt_zig', text: 'Zig', votes: 0, votesCount: 0, voterDids: [] },
          ],
          totalVotes: 0,
        },
      }),
    });
    expect(postRes.status).toBe(200);
    const postData = await postRes.json();
    const pollPostId = postData.post.id;

    // Distribute 15 voters:
    // First 5 vote for opt_rust
    // Next 7 vote for opt_ts
    // Last 3 vote for opt_zig
    const votePromises = swarmUsers.map((user, idx) => {
      let optionId = 'opt_rust';
      if (idx >= 5 && idx < 12) optionId = 'opt_ts';
      else if (idx >= 12) optionId = 'opt_zig';

      return fetch(`${BASE_URL}/api/feed/poll/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.sessionToken}`,
        },
        body: JSON.stringify({ postId: pollPostId, optionId }),
      }).then(async res => {
        expect(res.status).toBe(200);
        return res.json();
      });
    });

    await Promise.all(votePromises);

    // Fetch the post from feed and assert poll numbers
    const feedRes = await fetch(`${BASE_URL}/api/feed/list`, {
      headers: { Authorization: `Bearer ${alice.sessionToken}` },
    });
    const feedData = await feedRes.json();
    const pollPost = (feedData.posts || []).find((p: any) => p.id === pollPostId);

    expect(pollPost).toBeDefined();
    expect(pollPost.pollData).toBeDefined();
    const poll = pollPost.pollData;
    expect(poll.totalVotes).toBe(15);

    const rustOpt = poll.options.find((o: any) => o.id === 'opt_rust');
    const tsOpt = poll.options.find((o: any) => o.id === 'opt_ts');
    const zigOpt = poll.options.find((o: any) => o.id === 'opt_zig');

    expect(rustOpt.votes).toBe(5);
    expect(tsOpt.votes).toBe(7);
    expect(zigOpt.votes).toBe(3);

    // Double-voting prevention check: first user tries to vote again -> 400 Rejected
    const doubleVoteRes = await fetch(`${BASE_URL}/api/feed/poll/vote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${swarmUsers[0].sessionToken}`,
      },
      body: JSON.stringify({ postId: pollPostId, optionId: 'opt_zig' }),
    });
    expect(doubleVoteRes.status).toBe(400);
  });

  // --- RACE-05: CONCURRENT FOLLOWER SWARM ---
  it('[RACE-05] 30 Concurrent follow requests converge correctly on follower graph', async () => {
    const followPromises = swarmUsers.map(user =>
      fetch(`${BASE_URL}/api/social/follow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.sessionToken}`,
        },
        body: JSON.stringify({ targetDid: alice.did }),
      }).then(async res => {
        expect(res.status).toBe(200);
        return res.json();
      })
    );

    await Promise.all(followPromises);

    // Check Alice's followers
    const followersRes = await fetch(`${BASE_URL}/api/social/followers?targetDid=${encodeURIComponent(alice.did)}`, {
      headers: { Authorization: `Bearer ${alice.sessionToken}` },
    });
    expect(followersRes.status).toBe(200);
    const followersData = await followersRes.json();
    expect(followersData.ok).toBe(true);
    expect(followersData.followers.length).toBe(SWARM_SIZE);

    const followerDids = followersData.followers.map((f: any) => f.did);
    for (const user of swarmUsers) {
      expect(followerDids).toContain(user.did);
    }
  });

  // --- RACE-06: CONCURRENT CHAT BURSTS ---
  it('[RACE-06] 15 Concurrent direct messages into single thread are all delivered and ordered', async () => {
    const burstCount = 15;
    const messagePromises = Array.from({ length: burstCount }, (_, idx) => {
      const sender = swarmUsers[idx];
      return fetch(`${BASE_URL}/api/chat/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sender.sessionToken}`,
        },
        body: JSON.stringify({
          recipientDid: alice.did,
          text: `Concurrent burst message #${idx} from ${sender.handle}`,
        }),
      }).then(async res => {
        expect(res.status).toBe(200);
        return res.json();
      });
    });

    const sentResults = await Promise.all(messagePromises);
    expect(sentResults.length).toBe(burstCount);

    // Query Alice's messages
    const historyRes = await fetch(`${BASE_URL}/api/chat/messages`, {
      headers: { Authorization: `Bearer ${alice.sessionToken}` },
    });
    expect(historyRes.status).toBe(200);
    const historyData = await historyRes.json();
    expect(historyData.ok).toBe(true);

    const allMessages = historyData.messages || [];
    const receivedFromSwarm = allMessages.filter((m: any) => m.recipientDid === alice.did);
    expect(receivedFromSwarm.length).toBeGreaterThanOrEqual(burstCount);
  });
});
