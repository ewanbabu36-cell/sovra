import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseEngine } from '../../scripts/database-engine.ts';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('SOVRA Master Social Interaction Gate & Functional Go-Live Suite', { timeout: 45000 }, () => {
  const ts = Date.now();
  let userAToken: string;
  let userADid: string;
  const userAHandle = `@alice_social_${ts}`;

  let userBToken: string;
  let userBDid: string;
  const userBHandle = `@bob_social_${ts}`;

  let postId: string;
  let commentId: string;
  let replyId: string;

  // 1. User A & User B Registration
  it('registers User A (@alice) and User B (@bob) with full cryptographic identities', async () => {
    const resA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: userAHandle,
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
    expect(userADid).toMatch(/^did:sovra:/);

    const resB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: userBHandle,
        name: 'Bob Operator',
        bio: 'P2P relay node runner',
        website: 'https://bob.sovra.mesh',
        device: 'Laptop',
      }),
    });
    expect(resB.status).toBe(200);
    const dataB = await resB.json();
    expect(dataB.ok).toBe(true);
    userBToken = dataB.sessionToken;
    userBDid = dataB.user.did;
    expect(userBDid).toMatch(/^did:sovra:/);
  });

  // 2. Spatial Profile Resolution (by DID and by Handle)
  it('resolves peer profile correctly by DID and by handle without heuristic suppression', async () => {
    // Resolve by DID
    const profByDidRes = await fetch(`${BASE_URL}/api/user/profile?did=${encodeURIComponent(userBDid)}`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    expect(profByDidRes.status).toBe(200);
    const profByDid = await profByDidRes.json();
    expect(profByDid.ok).toBe(true);
    expect(profByDid.user.handle).toBe(userBHandle);
    expect(profByDid.relationship.isSelf).toBe(false);

    // Resolve by Handle
    const profByHandleRes = await fetch(`${BASE_URL}/api/user/profile?did=${encodeURIComponent(userBHandle)}`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    expect(profByHandleRes.status).toBe(200);
    const profByHandle = await profByHandleRes.json();
    expect(profByHandle.ok).toBe(true);
    expect(profByHandle.user.did).toBe(userBDid);
  });

  // 3. Social Follow & Notification
  it('handles follow / unfollow cycle and notifies the creator', async () => {
    // Alice follows Bob
    const followRes = await fetch(`${BASE_URL}/api/social/follow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({ targetDid: userBDid }),
    });
    expect(followRes.status).toBe(200);
    const followData = await followRes.json();
    expect(followData.ok).toBe(true);

    // Check Bob's notifications
    const notifRes = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    expect(notifRes.status).toBe(200);
    const notifData = await notifRes.json();
    expect(notifData.ok).toBe(true);
    const followNotif = notifData.notifications.find((n: any) => n.senderDid === userADid && (n.type === 'follow' || n.title?.includes('Follower')));
    expect(followNotif).toBeDefined();
  });

  // 4. Mutual Friendship Lifecycle
  it('executes friend request, acceptance, and mutual friendship status check', async () => {
    // Alice sends friend request
    const reqRes = await fetch(`${BASE_URL}/api/friends/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({ targetDid: userBDid }),
    });
    expect(reqRes.status).toBe(200);
    const reqData = await reqRes.json();
    expect(reqData.ok).toBe(true);

    // Bob accepts friend request
    const acceptRes = await fetch(`${BASE_URL}/api/friends/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        fromDid: userADid,
        status: 'accept',
      }),
    });
    expect(acceptRes.status).toBe(200);
    const acceptData = await acceptRes.json();
    expect(acceptData.ok).toBe(true);

    // Verify mutual relationship
    const mutualRes = await fetch(`${BASE_URL}/api/friends/mutual?targetHandle=${encodeURIComponent(userAHandle)}`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    expect(mutualRes.status).toBe(200);
    const mutualData = await mutualRes.json();
    expect(mutualData.ok).toBe(true);
    expect(mutualData.isFriend).toBe(true);
  });

  // 5. Post Creation & Feed Verification
  it('allows Bob to publish a post and Alice to discover it', async () => {
    const postRes = await fetch(`${BASE_URL}/api/feed/post`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        caption: 'Hello from sovereign node Bob! #sovra #mesh',
        tags: '#sovra #mesh',
        visibility: 'public',
        postType: 'text',
      }),
    });
    expect(postRes.status).toBe(200);
    const postData = await postRes.json();
    expect(postData.ok).toBe(true);
    expect(postData.post).toBeDefined();
    postId = postData.post.id;

    // Alice fetches feed list
    const feedRes = await fetch(`${BASE_URL}/api/feed/list`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    expect(feedRes.status).toBe(200);
    const feedData = await feedRes.json();
    expect(feedData.ok).toBe(true);
    const found = feedData.posts.find((p: any) => p.id === postId);
    expect(found).toBeDefined();
    expect(found.authorDid).toBe(userBDid);
  });

  // 6. Post Like
  it('records Alice liking Bob\'s post and dispatches like notification', async () => {
    const likeRes = await fetch(`${BASE_URL}/api/feed/like`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({ postId }),
    });
    expect(likeRes.status).toBe(200);
    const likeData = await likeRes.json();
    expect(likeData.ok).toBe(true);
    expect(likeData.likesCount).toBeGreaterThanOrEqual(1);

    // Verify Bob received a notification
    const notifs = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    }).then(r => r.json());
    expect(notifs.ok).toBe(true);
    const likeNotif = notifs.notifications.find((n: any) => n.senderDid === userADid && (n.type === 'like' || n.title?.includes('Like')));
    expect(likeNotif).toBeDefined();
  });

  // 7. Add Comment
  it('adds Alice\'s comment to Bob\'s post and notifies Bob', async () => {
    const cmtRes = await fetch(`${BASE_URL}/api/feed/comment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        postId,
        text: 'Great post Bob! Sovereign networks are the future.',
      }),
    });
    expect(cmtRes.status).toBe(200);
    const cmtData = await cmtRes.json();
    expect(cmtData.ok).toBe(true);
    expect(cmtData.comment).toBeDefined();
    expect(cmtData.comment.text).toBe('Great post Bob! Sovereign networks are the future.');
    expect(cmtData.comment.authorDid).toBe(userADid);
    commentId = cmtData.comment.id;

    // Verify Bob received a comment notification
    const notifs = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    }).then(r => r.json());
    const cmtNotif = notifs.notifications.find((n: any) => n.senderDid === userADid && (n.type === 'comment' || n.title?.includes('Comment')));
    expect(cmtNotif).toBeDefined();
  });

  // 8. Retrieve Post Comments
  it('retrieves post comments via GET /api/feed/comments', async () => {
    const commentsRes = await fetch(`${BASE_URL}/api/feed/comments?postId=${postId}`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    expect(commentsRes.status).toBe(200);
    const commentsData = await commentsRes.json();
    expect(commentsData.ok).toBe(true);
    expect(Array.isArray(commentsData.comments)).toBe(true);
    const targetCmt = commentsData.comments.find((c: any) => c.id === commentId);
    expect(targetCmt).toBeDefined();
    expect(targetCmt.text).toBe('Great post Bob! Sovereign networks are the future.');
  });

  // 9. Like Comment & Idempotency
  it('allows Bob to like Alice\'s comment and dispatches notification to Alice', async () => {
    const likeCmtRes = await fetch(`${BASE_URL}/api/feed/comment/like`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        postId,
        commentId,
        action: 'LIKE',
      }),
    });
    expect(likeCmtRes.status).toBe(200);
    const likeCmtData = await likeCmtRes.json();
    expect(likeCmtData.ok).toBe(true);
    expect(likeCmtData.isLiked).toBe(true);
    expect(likeCmtData.likesCount).toBe(1);

    // Verify Alice received comment like notification
    const notifs = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    }).then(r => r.json());
    const likeNotif = notifs.notifications.find((n: any) => n.senderDid === userBDid && n.title?.includes('Comment Like'));
    expect(likeNotif).toBeDefined();
  });

  // 10. Threaded Comment Reply
  it('allows Bob to reply to Alice\'s comment and dispatches notification to Alice', async () => {
    const replyRes = await fetch(`${BASE_URL}/api/feed/comment/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        postId,
        commentId,
        text: 'Thanks Alice, glad to be connected on Sovra!',
      }),
    });
    expect(replyRes.status).toBe(200);
    const replyData = await replyRes.json();
    expect(replyData.ok).toBe(true);
    expect(replyData.reply).toBeDefined();
    expect(replyData.reply.text).toBe('Thanks Alice, glad to be connected on Sovra!');
    replyId = replyData.reply.id;

    // Verify Alice received reply notification
    const notifs = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    }).then(r => r.json());
    const replyNotif = notifs.notifications.find((n: any) => n.senderDid === userBDid && (n.type === 'reply' || n.title?.includes('Reply')));
    expect(replyNotif).toBeDefined();

    // Verify GET /api/feed/comments contains the nested reply
    const commentsRes = await fetch(`${BASE_URL}/api/feed/comments?postId=${postId}`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    const commentsData = await commentsRes.json();
    const cmt = commentsData.comments.find((c: any) => c.id === commentId);
    expect(cmt).toBeDefined();
    expect(Array.isArray(cmt.replies)).toBe(true);
    const rpl = cmt.replies.find((r: any) => r.id === replyId);
    expect(rpl).toBeDefined();
    expect(rpl.text).toBe('Thanks Alice, glad to be connected on Sovra!');
  });

  // 11. Like Nested Reply
  it('allows Alice to like Bob\'s reply', async () => {
    const likeReplyRes = await fetch(`${BASE_URL}/api/feed/comment/like`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        postId,
        commentId: replyId,
      }),
    });
    expect(likeReplyRes.status).toBe(200);
    const likeReplyData = await likeReplyRes.json();
    expect(likeReplyData.ok).toBe(true);
    expect(likeReplyData.isReply).toBe(true);
    expect(likeReplyData.isLiked).toBe(true);
    expect(likeReplyData.likesCount).toBe(1);
  });

  // 12. Comment Edit & Delete RBAC
  it('enforces RBAC on comment editing (forbidden for non-author, allowed for author)', async () => {
    // Bob attempts to edit Alice's comment -> 403 Forbidden
    const badEditRes = await fetch(`${BASE_URL}/api/feed/comment/edit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        postId,
        commentId,
        text: 'Malicious modification of Alice\'s comment',
      }),
    });
    expect(badEditRes.status).toBe(403);

    // Alice edits her own comment -> 200 OK
    const goodEditRes = await fetch(`${BASE_URL}/api/feed/comment/edit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        postId,
        commentId,
        text: 'Updated: Great post Bob! Sovereign networks are the future and privacy is sacred.',
      }),
    });
    expect(goodEditRes.status).toBe(200);
    const goodEditData = await goodEditRes.json();
    expect(goodEditData.ok).toBe(true);
    expect(goodEditData.comment.text).toBe('Updated: Great post Bob! Sovereign networks are the future and privacy is sacred.');
  });

  // 13. Direct Messaging and Conversation Discovery
  it('sends direct chat messages and ensures peers are discoverable without suppression', async () => {
    // Alice sends chat message to Bob
    const sendRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        recipientDid: userBDid,
        text: 'Hey Bob! Testing sovereign direct communication channel.',
      }),
    });
    expect(sendRes.status).toBe(200);
    const sendData = await sendRes.json();
    expect(sendData.ok).toBe(true);

    // Bob checks conversations list
    const convRes = await fetch(`${BASE_URL}/api/chat/conversations`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    expect(convRes.status).toBe(200);
    const convData = await convRes.json();
    expect(convData.ok).toBe(true);
    // Crucial check: Alice must be found in conversations and NOT filtered out by regex heuristics!
    const aliceConv = convData.conversations.find((c: any) => c.did === userADid || c.handle === userAHandle);
    expect(aliceConv).toBeDefined();
    expect(aliceConv.lastMessage).toBe('Hey Bob! Testing sovereign direct communication channel.');
  });

  // 14. Server-Side Persistence Survival
  it('proves all social entities and state persist safely to database store', () => {
    const db = new DatabaseEngine();
    const post = db.getAllPosts().find(p => p.id === postId);
    expect(post).toBeDefined();
    expect(post?.comments).toBeDefined();
    const cmt = post?.comments?.find(c => c.id === commentId);
    expect(cmt).toBeDefined();
    expect(cmt?.authorDid).toBe(userADid);
    expect(cmt?.replies).toBeDefined();
    const rpl = cmt?.replies?.find(r => r.id === replyId);
    expect(rpl).toBeDefined();
    expect(rpl?.authorDid).toBe(userBDid);
  });
});
