import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';
const STORAGE_FILE = path.resolve(process.cwd(), '.sovra-storage-dev', 'dynamic-social-state.json');

describe('Sovra Master Two-User & Multi-Format End-to-End Journey', { timeout: 30000 }, () => {
  let userAToken: string;
  let userADid: string;

  let userBToken: string;
  let userBDid: string;

  let userCToken: string;
  let userCDid: string;

  let publicPostId: string;
  let friendsPostId: string;
  let onlyMePostId: string;
  let articlePostId: string;
  let pollPostId: string;
  let qaPostId: string;
  let quizPostId: string;
  let moodPostId: string;
  let eventPostId: string;
  let ideaPostId: string;
  let ratingPostId: string;
  let commentId: string;
  let friendReqId: string;
  let channelId: string;

  // STEP 1: Register User A and User B
  it('registers User A (@alice_master) and User B (@bob_master)', async () => {
    const timestamp = Date.now();
    const resA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@alice_master_${timestamp}`,
        name: 'Alice Sovereign',
        bio: 'Decentralized mesh researcher',
        website: 'https://alice.sovra.mesh',
        device: 'Workstation',
      }),
    });
    expect(resA.status).toBe(200);
    const dataA = await resA.json();
    expect(dataA.ok).toBe(true);
    userAToken = dataA.sessionToken;
    userADid = dataA.user.did;

    const resB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@bob_master_${timestamp}`,
        name: 'Bob Operator',
        bio: 'P2P relay node runner',
        website: 'https://bob.sovra.mesh',
        device: 'Pixel 9',
      }),
    });
    expect(resB.status).toBe(200);
    const dataB = await resB.json();
    expect(dataB.ok).toBe(true);
    userBToken = dataB.sessionToken;
    userBDid = dataB.user.did;
  });

  // STEP 2: User A updates profile and granular privacy settings
  it('updates User A profile with website, cover, and privacy settings', async () => {
    const updateRes = await fetch(`${BASE_URL}/api/user/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        bio: 'Lead Protocol Engineer @ Sovra',
        website: 'https://protocol.sovra.mesh',
        privacySettings: {
          profileVisibility: 'public',
          whoCanMessage: 'everyone',
          whoCanSendFriendRequests: 'everyone',
          whoCanSeeFollowers: 'friends',
          whoCanSeeFollowing: 'friends',
          onlineStatusVisibility: 'public',
        },
      }),
    });
    expect(updateRes.status).toBe(200);
    const updateData = await updateRes.json();
    expect(updateData.ok).toBe(true);
    expect(updateData.user.bio).toBe('Lead Protocol Engineer @ Sovra');
    expect(updateData.user.website).toBe('https://protocol.sovra.mesh');
    expect(updateData.user.privacySettings.whoCanSeeFollowers).toBe('friends');

    // Verify privacy endpoint
    const privRes = await fetch(`${BASE_URL}/api/user/privacy`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    expect(privRes.status).toBe(200);
    const privData = await privRes.json();
    expect(privData.ok).toBe(true);
    expect(privData.privacySettings.whoCanSeeFollowers).toBe('friends');
  });

  // STEP 3: User A publishes various post types with different visibilities
  it('publishes Public, Friends-Only, and Only-Me posts from User A', async () => {
    // 1. Public text post
    const pubRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        caption: 'Public broadcast: Sovra mesh is fully decentralized!',
        tags: '#sovra #decentralized',
        postType: 'text',
        visibility: 'public',
      }),
    });
    expect(pubRes.status).toBe(200);
    const pubData = await pubRes.json();
    expect(pubData.ok).toBe(true);
    publicPostId = pubData.post.id;
    expect(pubData.post.visibility).toBe('public');

    // 2. Friends-Only post
    const friendsRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        caption: 'Friends-Only alpha: Next-gen zero-knowledge state sync!',
        tags: '#friends #alpha',
        postType: 'text',
        visibility: 'friends',
      }),
    });
    expect(friendsRes.status).toBe(200);
    const friendsData = await friendsRes.json();
    expect(friendsData.ok).toBe(true);
    friendsPostId = friendsData.post.id;
    expect(friendsData.post.visibility).toBe('friends');

    // 3. Only-Me post
    const onlyMeRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        caption: 'Private note: Master mnemonic backup verified on air-gapped device',
        tags: '#backup #private',
        postType: 'text',
        visibility: 'only_me',
      }),
    });
    expect(onlyMeRes.status).toBe(200);
    const onlyMeData = await onlyMeRes.json();
    expect(onlyMeData.ok).toBe(true);
    onlyMePostId = onlyMeData.post.id;
    expect(onlyMeData.post.visibility).toBe('only_me');
  });

  // STEP 4: User A publishes interactive types (Article, Poll, QA, Quiz, Mood, Event, Idea, Rating)
  it('publishes Article, Poll, QA, Quiz, Mood, Event, Idea, and Rating posts from User A', async () => {
    // Article post
    const artRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        caption: 'Deep dive into decentralized gossip protocols across mesh nodes.',
        postType: 'article',
        visibility: 'public',
        articleData: {
          title: 'The Architecture of Sovereign Mesh Communications',
          body: '# Introduction\n\nSovra uses Noise_XX cryptographic handshakes and Merkle DAGs for zero-trust delivery.\n\n## Verification\nAll records persist deterministically.',
          readTimeMinutes: 4,
        },
      }),
    });
    const artData = await artRes.json();
    expect(artData.ok).toBe(true);
    articlePostId = artData.post.id;
    expect(artData.post.articleData.title).toBe('The Architecture of Sovereign Mesh Communications');

    // Poll post
    const pollRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        caption: 'Community vote on governance roadmap',
        postType: 'poll',
        visibility: 'public',
        pollData: {
          question: 'Should social feeds be 100% peer-voted?',
          options: [
            { id: 'opt_yes', text: 'Yes, full peer autonomy', votesCount: 0, voterDids: [] },
            { id: 'opt_no', text: 'No, curated relay sets', votesCount: 0, voterDids: [] },
          ],
          totalVotes: 0,
        },
      }),
    });
    const pollData = await pollRes.json();
    expect(pollData.ok).toBe(true);
    pollPostId = pollData.post.id;

    // Q&A post
    const qaRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        caption: 'Technical AMA',
        postType: 'qa',
        visibility: 'public',
        qaData: {
          question: 'How does offline BLE gossip prevent packet replay attacks?',
          answers: [],
        },
      }),
    });
    const qaData = await qaRes.json();
    expect(qaData.ok).toBe(true);
    qaPostId = qaData.post.id;

    // Quiz post
    const quizRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        caption: 'Mesh Knowledge Check',
        postType: 'quiz',
        visibility: 'public',
        quizData: {
          question: 'Which cryptographic scheme does Sovra use for identities?',
          options: ['Ed25519 DID keys', 'MD5 hashes', 'Plain usernames'],
          correctAnswerIndex: 0,
          explanation: 'Sovra generates W3C compliant did:key using Ed25519 curves.',
        },
      }),
    });
    const quizData = await quizRes.json();
    expect(quizData.ok).toBe(true);
    quizPostId = quizData.post.id;

    // Mood post
    const moodRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        caption: 'Building decentralized future',
        postType: 'mood',
        visibility: 'public',
        moodData: {
          emoji: '🚀',
          moodText: 'Shipping Sovereign Mesh',
        },
      }),
    });
    const moodData = await moodRes.json();
    expect(moodData.ok).toBe(true);
    moodPostId = moodData.post.id;

    // Event post
    const eventRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        caption: 'Global Sovereign Mesh Hackathon announcement',
        postType: 'event',
        visibility: 'public',
        eventData: {
          title: 'Decentralized Social Hackathon 2026',
          startDate: '2026-11-01T10:00:00Z',
          location: 'Virtual Mesh Swarm',
          attendeesCount: 1,
          attendeeDids: [userADid],
        },
      }),
    });
    const eventData = await eventRes.json();
    expect(eventData.ok).toBe(true);
    eventPostId = eventData.post.id;

    // Idea post
    const ideaRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        caption: 'RFC: Sybil Resistance on Bluetooth Mesh',
        postType: 'idea',
        visibility: 'public',
        ideaData: {
          title: 'Bluetooth Proximity Proof of Physical Contact',
          description: 'Use ephemeral BLE nonces to attest in-person peer contact without revealing identity.',
          upvotesCount: 0,
          upvoterDids: [],
          status: 'open',
        },
      }),
    });
    const ideaData = await ideaRes.json();
    expect(ideaData.ok).toBe(true);
    ideaPostId = ideaData.post.id;

    // Rating post
    const ratingRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        caption: 'Reviewing Noise_XX handshake protocol',
        postType: 'rating',
        visibility: 'public',
        ratingData: {
          category: 'Cryptographic Transport Protocols',
          averageRating: 5.0,
          ratingsCount: 1,
        },
      }),
    });
    const ratingData = await ratingRes.json();
    expect(ratingData.ok).toBe(true);
    ratingPostId = ratingData.post.id;
  });

  // STEP 5: Verify Authorization Boundaries Before Friending
  it('enforces that User B cannot see Friends-Only or Only-Me posts prior to friending', async () => {
    // In feed list for User B:
    const feedRes = await fetch(`${BASE_URL}/api/feed/list`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    expect(feedRes.status).toBe(200);
    const feedData = await feedRes.json();
    expect(feedData.ok).toBe(true);

    const postIds = feedData.posts.map((p: any) => p.id);
    expect(postIds).toContain(publicPostId);
    expect(postIds).not.toContain(friendsPostId);
    expect(postIds).not.toContain(onlyMePostId);

    // Direct endpoint fetch for Only-Me post by User B -> must be 403 Forbidden!
    const onlyMeDirect = await fetch(`${BASE_URL}/api/feed/get?id=${onlyMePostId}`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    expect(onlyMeDirect.status).toBe(403);
    const onlyMeJson = await onlyMeDirect.json();
    expect(onlyMeJson.ok).toBe(false);
    expect(onlyMeJson.error).toContain('Forbidden');

    // Direct endpoint fetch for Friends-Only post by User B (not friends yet) -> must be 403 Forbidden!
    const friendsDirect = await fetch(`${BASE_URL}/api/feed/get?id=${friendsPostId}`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    expect(friendsDirect.status).toBe(403);
    const friendsJson = await friendsDirect.json();
    expect(friendsJson.ok).toBe(false);
    expect(friendsJson.error).toContain('Forbidden');
  });

  // STEP 6: Friending Lifecycle (Request -> Notification -> Accept -> Mutual Friendship)
  it('establishes mutual friendship between User B and User A and grants Friends-Only access', async () => {
    // User B sends friend request to User A
    const reqRes = await fetch(`${BASE_URL}/api/friends/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({ toDid: userADid }),
    });
    expect(reqRes.status).toBe(200);
    const reqData = await reqRes.json();
    expect(reqData.ok).toBe(true);
    friendReqId = reqData.relationship.id;

    // User A checks notifications and sees the friend request
    const notifRes = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    expect(notifRes.status).toBe(200);
    const notifData = await notifRes.json();
    expect(notifData.ok).toBe(true);
    const friendReqNotif = notifData.notifications.find((n: any) => n.type === 'friend_request');
    expect(friendReqNotif).toBeDefined();

    // User A accepts the friend request
    const acceptRes = await fetch(`${BASE_URL}/api/friends/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        requestId: friendReqId,
        status: 'accept',
      }),
    });
    expect(acceptRes.status).toBe(200);
    const acceptData = await acceptRes.json();
    expect(acceptData.ok).toBe(true);
    expect(acceptData.relationship.status).toBe('accepted');

    // NOW User B fetches the Friends-Only post directly -> must succeed (200 OK)!
    const friendsDirectAfter = await fetch(`${BASE_URL}/api/feed/get?id=${friendsPostId}`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    expect(friendsDirectAfter.status).toBe(200);
    const friendsDirectData = await friendsDirectAfter.json();
    expect(friendsDirectData.ok).toBe(true);
    expect(friendsDirectData.post.id).toBe(friendsPostId);
    expect(friendsDirectData.post.caption).toContain('Friends-Only alpha');

    // User B in feed list now sees Friends-Only post
    const feedResAfter = await fetch(`${BASE_URL}/api/feed/list`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    const feedDataAfter = await feedResAfter.json();
    const postIdsAfter = feedDataAfter.posts.map((p: any) => p.id);
    expect(postIdsAfter).toContain(friendsPostId);
    expect(postIdsAfter).not.toContain(onlyMePostId); // Only-Me post is STILL strictly forbidden
  });

  // STEP 7: Social Interactions on Posts (Like, Comment, Reply, Share, Repost, Save)
  it('executes Like, Comment, Reply, Share, Repost, and Save operations across users', async () => {
    // User B likes User A's Public post
    const likeRes = await fetch(`${BASE_URL}/api/feed/like`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({ postId: publicPostId }),
    });
    expect(likeRes.status).toBe(200);
    const likeData = await likeRes.json();
    expect(likeData.ok).toBe(true);
    expect(likeData.likesCount).toBeGreaterThanOrEqual(1);

    // User B comments on User A's Public post
    const commentRes = await fetch(`${BASE_URL}/api/feed/comment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        postId: publicPostId,
        text: 'Incredible work on the sovereign mesh feed!',
      }),
    });
    expect(commentRes.status).toBe(200);
    const commentData = await commentRes.json();
    expect(commentData.ok).toBe(true);
    expect(commentData.comment.text).toBe('Incredible work on the sovereign mesh feed!');
    commentId = commentData.comment.id;

    // User A replies to User B's comment
    const replyRes = await fetch(`${BASE_URL}/api/feed/comment/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        postId: publicPostId,
        commentId: commentId,
        text: 'Thanks Bob! Decentralization requires every peer node.',
      }),
    });
    expect(replyRes.status).toBe(200);
    const replyData = await replyRes.json();
    expect(replyData.ok).toBe(true);
    expect(replyData.reply.text).toBe('Thanks Bob! Decentralization requires every peer node.');

    // User B shares the post
    const shareRes = await fetch(`${BASE_URL}/api/feed/share`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({ postId: publicPostId }),
    });
    expect(shareRes.status).toBe(200);
    const shareData = await shareRes.json();
    expect(shareData.ok).toBe(true);
    expect(shareData.sharesCount).toBeGreaterThanOrEqual(1);

    // User B reposts the post
    const repostRes = await fetch(`${BASE_URL}/api/feed/repost`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({ postId: publicPostId }),
    });
    expect(repostRes.status).toBe(200);
    const repostData = await repostRes.json();
    expect(repostData.ok).toBe(true);
    expect(repostData.repostsCount).toBeGreaterThanOrEqual(1);

    // User B saves the post
    const saveRes = await fetch(`${BASE_URL}/api/feed/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({ postId: publicPostId }),
    });
    expect(saveRes.status).toBe(200);
    const saveData = await saveRes.json();
    expect(saveData.ok).toBe(true);
    expect(saveData.isSaved).toBe(true);
  });

  // STEP 8: Interactive Features (Poll Voting, QA Answering, Quiz Attempting, Event RSVP, Idea Upvoting, Rating)
  it('executes specialized interactive features across post types', async () => {
    // 1. Poll vote by User B
    const pollVoteRes = await fetch(`${BASE_URL}/api/feed/poll/vote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        postId: pollPostId,
        optionId: 'opt_yes',
      }),
    });
    expect(pollVoteRes.status).toBe(200);
    const pollVoteData = await pollVoteRes.json();
    expect(pollVoteData.ok).toBe(true);
    expect(pollVoteData.pollData.totalVotes).toBe(1);
    expect(pollVoteData.pollData.options[0].votesCount).toBe(1);

    // 2. QA answer by User B and acceptance by User A
    const qaAnsRes = await fetch(`${BASE_URL}/api/feed/qa/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        postId: qaPostId,
        text: 'Packets include cryptographic monotonic sequence numbers and Merkle root proofs.',
        authorName: 'Bob Operator',
      }),
    });
    const qaAnsData = await qaAnsRes.json();
    if (qaAnsRes.status !== 200) {
      console.error('QA Answer Failed with status', qaAnsRes.status, qaAnsData);
    }
    expect(qaAnsRes.status).toBe(200);
    expect(qaAnsData.ok).toBe(true);
    const ansId = qaAnsData.answer.id;

    // User A accepts the answer
    const qaAcceptRes = await fetch(`${BASE_URL}/api/feed/qa/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        postId: qaPostId,
        answerId: ansId,
      }),
    });
    expect(qaAcceptRes.status).toBe(200);
    const qaAcceptData = await qaAcceptRes.json();
    expect(qaAcceptData.ok).toBe(true);
    expect(qaAcceptData.qaData.answers[0].isAccepted).toBe(true);

    // 3. Quiz attempt by User B
    const quizAttRes = await fetch(`${BASE_URL}/api/feed/quiz/attempt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        postId: quizPostId,
        selectedIndex: 0, // Correct answer
      }),
    });
    expect(quizAttRes.status).toBe(200);
    const quizAttData = await quizAttRes.json();
    expect(quizAttData.ok).toBe(true);
    expect(quizAttData.isCorrect).toBe(true);

    // 4. Event RSVP by User B
    const eventRsvpRes = await fetch(`${BASE_URL}/api/feed/event/rsvp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        postId: eventPostId,
        status: 'going',
      }),
    });
    expect(eventRsvpRes.status).toBe(200);
    const eventRsvpData = await eventRsvpRes.json();
    expect(eventRsvpData.ok).toBe(true);
    expect(eventRsvpData.eventData.attendeesCount).toBeGreaterThanOrEqual(2);

    // 5. Idea upvote by User B
    const ideaVoteRes = await fetch(`${BASE_URL}/api/feed/idea/vote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        postId: ideaPostId,
      }),
    });
    expect(ideaVoteRes.status).toBe(200);
    const ideaVoteData = await ideaVoteRes.json();
    expect(ideaVoteData.ok).toBe(true);
    expect(ideaVoteData.ideaData.upvotesCount).toBe(1);

    // 6. Rating submit by User B
    const ratingSubRes = await fetch(`${BASE_URL}/api/feed/rating/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        postId: ratingPostId,
        score: 5,
      }),
    });
    expect(ratingSubRes.status).toBe(200);
    const ratingSubData = await ratingSubRes.json();
    expect(ratingSubData.ok).toBe(true);
    expect(ratingSubData.ratingData.ratingsCount).toBeGreaterThanOrEqual(1);

    // 7. Hide post (User B hides mood post)
    const hideRes = await fetch(`${BASE_URL}/api/feed/hide`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({ postId: moodPostId }),
    });
    expect(hideRes.status).toBe(200);
    const hideData = await hideRes.json();
    expect(hideData.ok).toBe(true);

    // User B feed list omits mood post
    const feedBRes = await fetch(`${BASE_URL}/api/feed/list`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    const feedBData = await feedBRes.json();
    expect(feedBData.posts.map((p: any) => p.id)).not.toContain(moodPostId);

    // User A feed list STILL includes mood post (hide is personal to B)
    const feedARes = await fetch(`${BASE_URL}/api/feed/list`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    const feedAData = await feedARes.json();
    expect(feedAData.posts.map((p: any) => p.id)).toContain(moodPostId);
  });

  // STEP 9: Channels Lifecycle
  it('creates a channel by User A and subscribes User B', async () => {
    const chRes = await fetch(`${BASE_URL}/api/social/channels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        name: 'Sovereign Protocol Core',
        handle: `@meshcore_${Date.now()}`,
        desc: 'Official core developers channel for Sovra protocol',
        category: 'tech',
      }),
    });
    expect(chRes.status).toBe(200);
    const chData = await chRes.json();
    expect(chData.ok).toBe(true);
    channelId = chData.channel.id;
    expect(chData.channel.name).toBe('Sovereign Protocol Core');

    // User B subscribes to the channel
    const subRes = await fetch(`${BASE_URL}/api/social/channels/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        channelId: channelId,
      }),
    });
    expect(subRes.status).toBe(200);
    const subData = await subRes.json();
    expect(subData.ok).toBe(true);
  });

  // STEP 10: Private Chat and Third-Party Isolation (User C)
  it('sends direct messages between A and B, verifies notification, and proves User C cannot access them', async () => {
    // Register User C (@carol_external)
    const resC = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@carol_external_${Date.now()}`,
        name: 'Carol External',
        bio: 'External observer node',
        device: 'Laptop',
      }),
    });
    const dataC = await resC.json();
    expect(dataC.ok).toBe(true);
    userCToken = dataC.sessionToken;
    userCDid = dataC.user.did;

    // User A sends direct message to User B
    const sendRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        recipientDid: userBDid,
        senderName: 'Alice Sovereign',
        text: 'Hello Bob! Here is the encrypted session key for local mesh relay.',
      }),
    });
    expect(sendRes.status).toBe(200);
    const sendData = await sendRes.json();
    expect(sendData.ok).toBe(true);
    expect(sendData.message.recipientDid).toBe(userBDid);

    // User B receives the chat message in chat history
    const bChatRes = await fetch(`${BASE_URL}/api/chat/messages`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    expect(bChatRes.status).toBe(200);
    const bChatData = await bChatRes.json();
    expect(bChatData.ok).toBe(true);
    const receivedMsg = bChatData.messages.find((m: any) => m.senderDid === userADid && m.recipientDid === userBDid);
    expect(receivedMsg).toBeDefined();
    expect(receivedMsg.text).toContain('Here is the encrypted session key');

    // User B receives chat notification
    const bNotifRes = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    expect(bNotifRes.status).toBe(200);
    const bNotifData = await bNotifRes.json();
    expect(bNotifData.ok).toBe(true);
    const chatNotif = bNotifData.notifications.find((n: any) => n.type === 'message' && n.senderDid === userADid);
    expect(chatNotif).toBeDefined();

    // User C (unauthorized) requests messages -> MUST NOT contain A and B's private message!
    const cChatRes = await fetch(`${BASE_URL}/api/chat/messages`, {
      headers: { Authorization: `Bearer ${userCToken}` },
    });
    expect(cChatRes.status).toBe(200);
    const cChatData = await cChatRes.json();
    expect(cChatData.ok).toBe(true);
    const leakedMsg = cChatData.messages.find((m: any) => m.senderDid === userADid && m.recipientDid === userBDid);
    expect(leakedMsg).toBeUndefined(); // Zero data leakage!

    // User C attempts direct fetch on User A's friends-only post -> 403 Forbidden
    const cFriendsDirect = await fetch(`${BASE_URL}/api/feed/get?id=${friendsPostId}`, {
      headers: { Authorization: `Bearer ${userCToken}` },
    });
    expect(cFriendsDirect.status).toBe(403);

    // User C attempts direct fetch on User A's only-me post -> 403 Forbidden
    const cOnlyMeDirect = await fetch(`${BASE_URL}/api/feed/get?id=${onlyMePostId}`, {
      headers: { Authorization: `Bearer ${userCToken}` },
    });
    expect(cOnlyMeDirect.status).toBe(403);
  });

  // STEP 11: Physical Disk Persistence Verification
  it('proves that all users, posts, comments, replies, poll votes, and relations are persisted to disk JSON', async () => {
    expect(fs.existsSync(STORAGE_FILE)).toBe(true);

    let persistedState: any;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const rawContent = fs.readFileSync(STORAGE_FILE, 'utf-8');
        persistedState = JSON.parse(rawContent);
        break;
      } catch (err) {
        if (attempt === 4) throw err;
        await new Promise(r => setTimeout(r, 150));
      }
    }

    // Assert users exist in persisted disk state
    const userADisk = persistedState.users.find((u: any) => u.did === userADid);
    expect(userADisk).toBeDefined();
    expect(userADisk.bio).toBe('Lead Protocol Engineer @ Sovra');
    expect(userADisk.website).toBe('https://protocol.sovra.mesh');

    const userBDisk = persistedState.users.find((u: any) => u.did === userBDid);
    expect(userBDisk).toBeDefined();

    // Assert all post types exist in persisted disk state
    const pubPostDisk = persistedState.posts.find((p: any) => p.id === publicPostId);
    expect(pubPostDisk).toBeDefined();
    expect(pubPostDisk.visibility).toBe('public');
    expect(pubPostDisk.comments.length).toBeGreaterThanOrEqual(1);
    expect(pubPostDisk.comments[0].replies.length).toBeGreaterThanOrEqual(1);

    const friendsPostDisk = persistedState.posts.find((p: any) => p.id === friendsPostId);
    expect(friendsPostDisk).toBeDefined();
    expect(friendsPostDisk.visibility).toBe('friends');

    const onlyMePostDisk = persistedState.posts.find((p: any) => p.id === onlyMePostId);
    expect(onlyMePostDisk).toBeDefined();
    expect(onlyMePostDisk.visibility).toBe('only_me');

    const pollPostDisk = persistedState.posts.find((p: any) => p.id === pollPostId);
    expect(pollPostDisk).toBeDefined();
    expect(pollPostDisk.pollData.totalVotes).toBe(1);

    const qaPostDisk = persistedState.posts.find((p: any) => p.id === qaPostId);
    expect(qaPostDisk).toBeDefined();
    expect(qaPostDisk.qaData.answers[0].isAccepted).toBe(true);

    const quizPostDisk = persistedState.posts.find((p: any) => p.id === quizPostId);
    expect(quizPostDisk).toBeDefined();

    const moodPostDisk = persistedState.posts.find((p: any) => p.id === moodPostId);
    expect(moodPostDisk).toBeDefined();
    expect(moodPostDisk.hiddenByDids).toContain(userBDid);

    // Assert friend relationship is persisted
    const rels = persistedState.friend_relationships || persistedState.friendRelationships || [];
    const relDisk = rels.find((r: any) => r.id === friendReqId);
    expect(relDisk).toBeDefined();
    expect(relDisk.status).toBe('accepted');

    // Assert direct messages are persisted
    const msgDisk = persistedState.chatMessages.find((m: any) => m.senderDid === userADid && m.recipientDid === userBDid);
    expect(msgDisk).toBeDefined();
  }, 25000);
});
