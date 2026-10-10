/**
 * @file tests/e2e/sovra-media-phase5.test.ts
 * SOVRA PHASE 5: MEDIA EXPERIENCE VERIFICATION SUITE
 *
 * Verifies:
 * 1. Watch catalog & metadata (/api/youtube/videos, /api/youtube/video, /api/youtube/subscribe, comments)
 * 2. Real HTTP Range streaming pipeline (HTTP 200, 206 Partial Content, 416 invalid ranges, seek verification)
 * 3. Video Access Control & BOLA/IDOR protection (only_me/private/friends-only video authorization)
 * 4. Reels / Shorts feed, minimal floating actions, likes, comments, and bounded streaming
 * 5. Playlists lifecycle & server-side RBAC (create, add, reorder, remove, view, delete, unauthorized rejection)
 * 6. Live Sessions State Machine & Moderated Live Chat (SCHEDULED -> STARTING -> LIVE -> ENDING -> ENDED -> REPLAY)
 * 7. Watch History Pipeline (ignoring < 5s hovers, recording >= 5s views, retrieval, clearing)
 * 8. Saved Media / Collections (saving, duplicate prevention, verification, unsaving)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('SOVRA Phase 5: Media Experience Verification Suite', () => {
  const ts = Date.now();
  let userA: { did: string; handle: string; sessionToken: string };
  let userB: { did: string; handle: string; sessionToken: string };
  let sampleVideoCid: string;
  let privateVideoCid: string;
  let privatePostId: string;
  const videoPayloadSize = 16384; // 16 KB binary buffer
  const sampleVideoBuffer = crypto.randomBytes(videoPayloadSize);

  beforeAll(async () => {
    // 1. Register User A (Creator / Owner)
    const resA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@creator_${ts}`,
        name: 'Media Creator Alice',
        bio: 'Sovereign video producer and live broadcaster',
      }),
    });
    expect(resA.status).toBe(200);
    const dataA = await resA.json();
    expect(dataA.ok).toBe(true);
    userA = {
      did: dataA.user.did,
      handle: dataA.user.handle,
      sessionToken: dataA.sessionToken,
    };

    // 2. Register User B (Peer / Viewer)
    const resB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@viewer_${ts}`,
        name: 'Viewer Bob',
        bio: 'Decentralized media enthusiast',
      }),
    });
    expect(resB.status).toBe(200);
    const dataB = await resB.json();
    expect(dataB.ok).toBe(true);
    userB = {
      did: dataB.user.did,
      handle: dataB.user.handle,
      sessionToken: dataB.sessionToken,
    };

    // 3. Upload a sample public video buffer for range tests
    const uploadRes = await fetch(`${BASE_URL}/api/media/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.sessionToken}`,
      },
      body: JSON.stringify({
        mediaBase64: sampleVideoBuffer.toString('base64'),
        mimeType: 'video/mp4',
      }),
    });
    expect(uploadRes.status).toBe(200);
    const uploadData = await uploadRes.json();
    expect(uploadData.ok).toBe(true);
    sampleVideoCid = uploadData.cid;
  });

  // ==========================================================================
  // 1. WATCH CATALOG & VIDEO METADATA
  // ==========================================================================
  describe('1. Watch Surface & Video Catalog', () => {
    let testVideoId: string;

    it('returns a populated catalog of real videos with complete metadata', async () => {
      const res = await fetch(`${BASE_URL}/api/youtube/videos`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.videos)).toBe(true);
      expect(data.videos.length).toBeGreaterThan(0);

      const first = data.videos[0];
      expect(first.id).toBeDefined();
      expect(first.title).toBeDefined();
      expect(first.views).toBeDefined();
      expect(first.channelName).toBeDefined();
      expect(first.duration).toBeDefined();
      testVideoId = first.id;
    });

    it('returns single video details with author info and related videos', async () => {
      const res = await fetch(`${BASE_URL}/api/youtube/video?id=${encodeURIComponent(testVideoId)}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.video).toBeDefined();
      expect(data.video.id).toBe(testVideoId);
      expect(Array.isArray(data.comments)).toBe(true);
      expect(Array.isArray(data.recommended)).toBe(true);
    });

    it('allows authenticated users to comment on long-form watch videos', async () => {
      const commentText = `Impressive P2P streaming architecture! ${ts}`;
      const res = await fetch(`${BASE_URL}/api/youtube/comment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userB.sessionToken}`,
        },
        body: JSON.stringify({
          videoId: testVideoId,
          text: commentText,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.comment).toBeDefined();
      expect(data.comment.text).toBe(commentText);
      expect(data.comment.authorDid).toBe(userB.did);
    });

    it('allows channel subscription toggle', async () => {
      const res = await fetch(`${BASE_URL}/api/youtube/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userB.sessionToken}`,
        },
        body: JSON.stringify({
          channelId: 'ch-alpha',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(typeof data.subscribed).toBe('boolean');
      expect(typeof data.subscribersCount).toBe('number');
    });
  });

  // ==========================================================================
  // 2. VIDEO STREAMING PIPELINE & RANGE REQUESTS
  // ==========================================================================
  describe('2. Video Streaming Pipeline & Range Verification', () => {
    it('serves full video with HTTP 200 and Accept-Ranges: bytes when no Range header is sent', async () => {
      const res = await fetch(`${BASE_URL}/api/feed/video/${sampleVideoCid}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('Accept-Ranges')).toBe('bytes');
      expect(res.headers.get('Content-Length')).toBe(String(videoPayloadSize));
      const body = Buffer.from(await res.arrayBuffer());
      expect(body.length).toBe(videoPayloadSize);
      expect(body.equals(sampleVideoBuffer)).toBe(true);
    });

    it('serves initial 0-1023 byte slice with HTTP 206 Partial Content', async () => {
      const res = await fetch(`${BASE_URL}/api/feed/video/${sampleVideoCid}`, {
        headers: { Range: 'bytes=0-1023' },
      });
      expect(res.status).toBe(206);
      expect(res.headers.get('Accept-Ranges')).toBe('bytes');
      expect(res.headers.get('Content-Range')).toBe(`bytes 0-1023/${videoPayloadSize}`);
      expect(res.headers.get('Content-Length')).toBe('1024');
      const chunk = Buffer.from(await res.arrayBuffer());
      expect(chunk.length).toBe(1024);
      expect(chunk.equals(sampleVideoBuffer.subarray(0, 1024))).toBe(true);
    });

    it('serves middle seek range (4096-8191) with HTTP 206 Partial Content', async () => {
      const res = await fetch(`${BASE_URL}/api/feed/video/${sampleVideoCid}`, {
        headers: { Range: 'bytes=4096-8191' },
      });
      expect(res.status).toBe(206);
      expect(res.headers.get('Accept-Ranges')).toBe('bytes');
      expect(res.headers.get('Content-Range')).toBe(`bytes 4096-8191/${videoPayloadSize}`);
      expect(res.headers.get('Content-Length')).toBe('4096');
      const chunk = Buffer.from(await res.arrayBuffer());
      expect(chunk.length).toBe(4096);
      expect(chunk.equals(sampleVideoBuffer.subarray(4096, 8192))).toBe(true);
    });

    it('serves tail range (12000-) with HTTP 206 Partial Content to EOF', async () => {
      const res = await fetch(`${BASE_URL}/api/feed/video/${sampleVideoCid}`, {
        headers: { Range: 'bytes=12000-' },
      });
      expect(res.status).toBe(206);
      const expectedLen = videoPayloadSize - 12000;
      expect(res.headers.get('Content-Range')).toBe(`bytes 12000-${videoPayloadSize - 1}/${videoPayloadSize}`);
      expect(res.headers.get('Content-Length')).toBe(String(expectedLen));
      const chunk = Buffer.from(await res.arrayBuffer());
      expect(chunk.length).toBe(expectedLen);
      expect(chunk.equals(sampleVideoBuffer.subarray(12000))).toBe(true);
    });

    it('returns HTTP 416 Range Not Satisfiable when range is beyond EOF', async () => {
      const res = await fetch(`${BASE_URL}/api/feed/video/${sampleVideoCid}`, {
        headers: { Range: 'bytes=9999999-10000000' },
      });
      expect(res.status).toBe(416);
      expect(res.headers.get('Content-Range')).toBe(`bytes */${videoPayloadSize}`);
    });
  });

  // ==========================================================================
  // 3. VIDEO ACCESS CONTROL & BOLA/IDOR DEFENSE
  // ==========================================================================
  describe('3. Video Access Control & BOLA/IDOR Protection', () => {
    it('creates a private post containing video owned by User A', async () => {
      const privateBuffer = crypto.randomBytes(4096);
      const res = await fetch(`${BASE_URL}/api/feed/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userA.sessionToken}`,
        },
        body: JSON.stringify({
          caption: `Confidential footage ${ts}`,
          mediaVideo: `data:video/mp4;base64,${privateBuffer.toString('base64')}`,
          postType: 'video',
          visibility: 'only_me',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.post).toBeDefined();
      expect(data.post.visibility).toBe('only_me');
      expect(data.post.mediaCid).toBeDefined();
      privatePostId = data.post.id;
      privateVideoCid = data.post.mediaCid;
    });

    it('rejects unauthenticated requests to private video with 401 Unauthorized', async () => {
      const res = await fetch(`${BASE_URL}/api/feed/video/${privateVideoCid}?postId=${privatePostId}`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Unauthorized');
    });

    it('denies User B access to User A private video with 403 Forbidden (BOLA/IDOR defense)', async () => {
      const res = await fetch(`${BASE_URL}/api/feed/video/${privateVideoCid}?postId=${privatePostId}`, {
        headers: {
          Authorization: `Bearer ${userB.sessionToken}`,
          'X-Sovra-DID': userB.did,
        },
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Forbidden');
    });

    it('allows User A (author) full access to their private video stream', async () => {
      const res = await fetch(`${BASE_URL}/api/feed/video/${privateVideoCid}?postId=${privatePostId}`, {
        headers: {
          Authorization: `Bearer ${userA.sessionToken}`,
          'X-Sovra-DID': userA.did,
          Range: 'bytes=0-511',
        },
      });
      expect(res.status).toBe(206);
      expect(res.headers.get('Content-Length')).toBe('512');
    });
  });

  // ==========================================================================
  // 4. REELS / SHORTS & MINIMAL FLOATING INTERACTIONS
  // ==========================================================================
  describe('4. Reels / Shorts Surface & Media Actions', () => {
    let testReelId: string;
    let initialLikes: number;

    it('fetches reels list with vertical media format and metadata', async () => {
      const res = await fetch(`${BASE_URL}/api/reels/list`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.reels)).toBe(true);
      expect(data.reels.length).toBeGreaterThan(0);

      const first = data.reels[0];
      expect(first.id).toBeDefined();
      expect(first.title).toBeDefined();
      expect(typeof first.likes).toBe('number');
      testReelId = first.id;
      initialLikes = first.likes;
    });

    it('toggles like on reel and persists without fake counters', async () => {
      const res = await fetch(`${BASE_URL}/api/reels/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userB.sessionToken}`,
        },
        body: JSON.stringify({ reelId: testReelId }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(typeof data.likes).toBe('number');
      expect(data.likes).toBe(initialLikes + 1);
    });

    it('adds comment to reel and retrieves it in reel comments feed', async () => {
      const commentMsg = `Incredible vertical flow on Sovra! ${ts}`;
      const res = await fetch(`${BASE_URL}/api/reels/comment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userB.sessionToken}`,
        },
        body: JSON.stringify({
          reelId: testReelId,
          text: commentMsg,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.comment).toBeDefined();
      expect(data.comment.text).toBe(commentMsg);

      // Verify retrieval
      const getCommentsRes = await fetch(`${BASE_URL}/api/reels/comments?reelId=${encodeURIComponent(testReelId)}`);
      expect(getCommentsRes.status).toBe(200);
      const commentsData = await getCommentsRes.json();
      expect(commentsData.ok).toBe(true);
      const found = commentsData.comments.find((c: any) => c.text === commentMsg);
      expect(found).toBeDefined();
    });
  });

  // ==========================================================================
  // 5. PLAYLISTS LIFECYCLE & SERVER-SIDE RBAC
  // ==========================================================================
  describe('5. Playlists Lifecycle & Server-Side RBAC', () => {
    let playlistId: string;

    it('allows User A to create a new channel playlist', async () => {
      const res = await fetch(`${BASE_URL}/api/playlists/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userA.sessionToken}`,
        },
        body: JSON.stringify({
          channelId: 'ch-alpha',
          title: `Decentralized Video Series ${ts}`,
          description: 'A curated list of peer-to-peer streaming protocols.',
          privacy: 'public',
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.playlist).toBeDefined();
      expect(data.playlist.creatorDid).toBe(userA.did);
      expect(data.playlist.videoIds).toEqual([]);
      playlistId = data.playlist.id;
    });

    it('allows User A to add videos to their playlist', async () => {
      // Add first video
      const add1 = await fetch(`${BASE_URL}/api/playlists/add-video`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userA.sessionToken}`,
        },
        body: JSON.stringify({
          id: playlistId,
          videoId: 'yt-video-1',
        }),
      });
      expect(add1.status).toBe(200);
      const data1 = await add1.json();
      expect(data1.ok).toBe(true);
      expect(data1.playlist.videoIds).toContain('yt-video-1');

      // Add second video
      const add2 = await fetch(`${BASE_URL}/api/playlists/add-video`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userA.sessionToken}`,
        },
        body: JSON.stringify({
          id: playlistId,
          videoId: 'yt-video-2',
        }),
      });
      expect(add2.status).toBe(200);
      const data2 = await add2.json();
      expect(data2.ok).toBe(true);
      expect(data2.playlist.videoIds).toEqual(['yt-video-1', 'yt-video-2']);
    });

    it('allows User A to reorder videos within the playlist', async () => {
      const res = await fetch(`${BASE_URL}/api/playlists/reorder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userA.sessionToken}`,
        },
        body: JSON.stringify({
          id: playlistId,
          videoIds: ['yt-video-2', 'yt-video-1'],
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.playlist.videoIds).toEqual(['yt-video-2', 'yt-video-1']);
    });

    it('rejects unauthorized playlist modification attempts by User B with 403 Forbidden', async () => {
      // 1. User B tries to reorder
      const reorderRes = await fetch(`${BASE_URL}/api/playlists/reorder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userB.sessionToken}`,
        },
        body: JSON.stringify({
          id: playlistId,
          videoIds: ['yt-video-1'],
        }),
      });
      expect(reorderRes.status).toBe(403);

      // 2. User B tries to remove video
      const removeRes = await fetch(`${BASE_URL}/api/playlists/remove-video`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userB.sessionToken}`,
        },
        body: JSON.stringify({
          id: playlistId,
          videoId: 'yt-video-2',
        }),
      });
      expect(removeRes.status).toBe(403);

      // 3. User B tries to delete playlist
      const deleteRes = await fetch(`${BASE_URL}/api/playlists/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userB.sessionToken}`,
        },
        body: JSON.stringify({
          id: playlistId,
        }),
      });
      expect(deleteRes.status).toBe(403);
    });

    it('allows User A to remove a video and view playlist details', async () => {
      const removeRes = await fetch(`${BASE_URL}/api/playlists/remove-video`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userA.sessionToken}`,
        },
        body: JSON.stringify({
          id: playlistId,
          videoId: 'yt-video-1',
        }),
      });
      expect(removeRes.status).toBe(200);
      const remData = await removeRes.json();
      expect(remData.playlist.videoIds).toEqual(['yt-video-2']);

      // View playlist
      const viewRes = await fetch(`${BASE_URL}/api/playlists/view?id=${encodeURIComponent(playlistId)}`);
      expect(viewRes.status).toBe(200);
      const viewData = await viewRes.json();
      expect(viewData.ok).toBe(true);
      expect(viewData.playlist.videoIds).toEqual(['yt-video-2']);
      expect(Array.isArray(viewData.videos)).toBe(true);
    });

    it('allows User A to delete the playlist', async () => {
      const deleteRes = await fetch(`${BASE_URL}/api/playlists/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userA.sessionToken}`,
        },
        body: JSON.stringify({ id: playlistId }),
      });
      expect(deleteRes.status).toBe(200);
      const data = await deleteRes.json();
      expect(data.ok).toBe(true);

      // Verify 404
      const viewRes = await fetch(`${BASE_URL}/api/playlists/view?id=${encodeURIComponent(playlistId)}`);
      expect(viewRes.status).toBe(404);
    });
  });

  // ==========================================================================
  // 6. LIVE SESSIONS STATE MACHINE & MODERATED CHAT
  // ==========================================================================
  describe('6. Live Sessions State Machine & Moderated Live Chat', () => {
    let liveSessionId: string;
    let chatMessageId: string;

    it('creates a new live session with status SCHEDULED', async () => {
      const res = await fetch(`${BASE_URL}/api/live/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userA.sessionToken}`,
        },
        body: JSON.stringify({
          channelId: 'ch-alpha',
          title: `Next-Gen P2P Broadcast ${ts}`,
          description: 'Live test stream verifying live state machine and WebRTC signaling.',
          category: 'tech',
          scheduledStartTime: Date.now() + 3600000,
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.session.status).toBe('SCHEDULED');
      expect(data.session.creatorDid).toBe(userA.did);
      liveSessionId = data.session.id;
    });

    it('advances live state machine: SCHEDULED -> STARTING -> LIVE', async () => {
      // 1. Transition SCHEDULED -> STARTING
      const resStarting = await fetch(`${BASE_URL}/api/live/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userA.sessionToken}`,
        },
        body: JSON.stringify({
          id: liveSessionId,
          status: 'STARTING',
        }),
      });
      expect(resStarting.status).toBe(200);
      const dataStarting = await resStarting.json();
      expect(dataStarting.session.status).toBe('STARTING');

      // 2. Transition STARTING -> LIVE
      const resLive = await fetch(`${BASE_URL}/api/live/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userA.sessionToken}`,
        },
        body: JSON.stringify({
          id: liveSessionId,
          status: 'LIVE',
        }),
      });
      expect(resLive.status).toBe(200);
      const dataLive = await resLive.json();
      expect(dataLive.session.status).toBe('LIVE');
      expect(typeof dataLive.session.actualStartTime).toBe('number');
    });

    it('rejects invalid state transition (LIVE -> SCHEDULED) with 400 Bad Request', async () => {
      const res = await fetch(`${BASE_URL}/api/live/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userA.sessionToken}`,
        },
        body: JSON.stringify({
          id: liveSessionId,
          status: 'SCHEDULED',
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Invalid state transition');
    });

    it('rejects unauthorized state change attempts by User B with 403 Forbidden', async () => {
      const res = await fetch(`${BASE_URL}/api/live/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userB.sessionToken}`,
        },
        body: JSON.stringify({
          id: liveSessionId,
          status: 'ENDED',
        }),
      });
      expect(res.status).toBe(403);
    });

    it('allows peer User B to send a live chat message', async () => {
      const chatText = `Testing live broadcast chat from peer ${ts}`;
      const res = await fetch(`${BASE_URL}/api/live/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userB.sessionToken}`,
        },
        body: JSON.stringify({
          sessionId: liveSessionId,
          text: chatText,
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.message.text).toBe(chatText);
      expect(data.message.senderDid).toBe(userB.did);
      expect(data.message.isModerator).toBe(false);
      chatMessageId = data.message.id;
    });

    it('allows audience to send likes to live session', async () => {
      const res = await fetch(`${BASE_URL}/api/live/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: liveSessionId }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.likesCount).toBeGreaterThanOrEqual(1);
    });

    it('rejects deletion of chat messages by non-moderator peer with 403', async () => {
      // Register a third user User C
      const regC = await fetch(`${BASE_URL}/api/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: `@viewer_charlie_${ts}`,
          name: 'Charlie Viewer',
        }),
      });
      const dataC = await regC.json();
      const userC = { sessionToken: dataC.sessionToken, did: dataC.user.did };

      const res = await fetch(`${BASE_URL}/api/live/chat/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userC.sessionToken}`,
        },
        body: JSON.stringify({
          sessionId: liveSessionId,
          messageId: chatMessageId,
        }),
      });
      expect(res.status).toBe(403);
    });

    it('allows creator/moderator User A to delete inappropriate live chat message', async () => {
      const res = await fetch(`${BASE_URL}/api/live/chat/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userA.sessionToken}`,
        },
        body: JSON.stringify({
          sessionId: liveSessionId,
          messageId: chatMessageId,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      // Verify it was removed
      const listRes = await fetch(`${BASE_URL}/api/live/chat?sessionId=${encodeURIComponent(liveSessionId)}`);
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      const found = listData.messages.find((m: any) => m.id === chatMessageId);
      expect(found).toBeUndefined();
    });

    it('advances live session to ENDING -> ENDED', async () => {
      // 1. LIVE -> ENDING
      const resEnding = await fetch(`${BASE_URL}/api/live/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userA.sessionToken}`,
        },
        body: JSON.stringify({
          id: liveSessionId,
          status: 'ENDING',
        }),
      });
      expect(resEnding.status).toBe(200);

      // 2. ENDING -> ENDED
      const resEnded = await fetch(`${BASE_URL}/api/live/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userA.sessionToken}`,
        },
        body: JSON.stringify({
          id: liveSessionId,
          status: 'ENDED',
        }),
      });
      expect(resEnded.status).toBe(200);
      const dataEnded = await resEnded.json();
      expect(dataEnded.session.status).toBe('ENDED');
    });
  });

  // ==========================================================================
  // 7. WATCH HISTORY (THRESHOLD & PERSISTENCE)
  // ==========================================================================
  describe('7. Watch History Pipeline & Threshold Logic', () => {
    it('ignores watch events shorter than 5 seconds threshold to avoid recording tiny hovers', async () => {
      const res = await fetch(`${BASE_URL}/api/watch/history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userB.sessionToken}`,
        },
        body: JSON.stringify({
          videoId: 'yt-video-1',
          durationWatchedSec: 3, // < 5s threshold
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.ignored).toBe(true);
    });

    it('records watch event when duration watched exceeds 5 seconds threshold', async () => {
      const res = await fetch(`${BASE_URL}/api/watch/history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userB.sessionToken}`,
        },
        body: JSON.stringify({
          videoId: 'yt-video-1',
          durationWatchedSec: 32, // >= 5s threshold
          completed: false,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.history).toBeDefined();
      expect(data.history.videoId).toBe('yt-video-1');
      expect(data.history.durationWatchedSec).toBe(32);
    });

    it('retrieves user watch history with attached video metadata', async () => {
      const res = await fetch(`${BASE_URL}/api/watch/history`, {
        headers: {
          Authorization: `Bearer ${userB.sessionToken}`,
        },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.history)).toBe(true);
      expect(data.history.length).toBeGreaterThanOrEqual(1);
      const item = data.history.find((h: any) => h.videoId === 'yt-video-1');
      expect(item).toBeDefined();
      expect(item.video).toBeDefined();
    });

    it('clears watch history on user request', async () => {
      const clearRes = await fetch(`${BASE_URL}/api/watch/history/clear`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userB.sessionToken}`,
        },
      });
      expect(clearRes.status).toBe(200);
      const clearData = await clearRes.json();
      expect(clearData.ok).toBe(true);

      const getRes = await fetch(`${BASE_URL}/api/watch/history`, {
        headers: {
          Authorization: `Bearer ${userB.sessionToken}`,
        },
      });
      const getData = await getRes.json();
      expect(getData.ok).toBe(true);
      expect(getData.history).toEqual([]);
    });
  });

  // ==========================================================================
  // 8. SAVED MEDIA / COLLECTIONS & DUPLICATE PREVENTION
  // ==========================================================================
  describe('8. Saved Media / Collections & Duplicate Prevention', () => {
    const testMediaId = 'yt-video-3';

    it('saves a video to user personal media collection', async () => {
      const res = await fetch(`${BASE_URL}/api/media/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userB.sessionToken}`,
        },
        body: JSON.stringify({
          mediaId: testMediaId,
          mediaType: 'video',
          title: 'Decentralized P2P Consensus Deep Dive',
          thumbnailUrl: '/assets/icon.svg',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.alreadySaved).toBe(false);
      expect(data.record.mediaId).toBe(testMediaId);
    });

    it('prevents duplicate saved items when saved repeatedly', async () => {
      const res = await fetch(`${BASE_URL}/api/media/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userB.sessionToken}`,
        },
        body: JSON.stringify({
          mediaId: testMediaId,
          mediaType: 'video',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.alreadySaved).toBe(true);
    });

    it('checks saved status and lists saved media', async () => {
      // Check status
      const checkRes = await fetch(`${BASE_URL}/api/media/saved/check?mediaId=${encodeURIComponent(testMediaId)}`, {
        headers: {
          Authorization: `Bearer ${userB.sessionToken}`,
        },
      });
      expect(checkRes.status).toBe(200);
      const checkData = await checkRes.json();
      expect(checkData.ok).toBe(true);
      expect(checkData.isSaved).toBe(true);

      // List saved media
      const listRes = await fetch(`${BASE_URL}/api/media/saved`, {
        headers: {
          Authorization: `Bearer ${userB.sessionToken}`,
        },
      });
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      expect(listData.ok).toBe(true);
      const found = listData.savedMedia.find((m: any) => m.mediaId === testMediaId);
      expect(found).toBeDefined();
    });

    it('allows unsaving media from collections', async () => {
      const res = await fetch(`${BASE_URL}/api/media/unsave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userB.sessionToken}`,
        },
        body: JSON.stringify({
          mediaId: testMediaId,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      // Verify check now returns false
      const checkRes = await fetch(`${BASE_URL}/api/media/saved/check?mediaId=${encodeURIComponent(testMediaId)}`, {
        headers: {
          Authorization: `Bearer ${userB.sessionToken}`,
        },
      });
      const checkData = await checkRes.json();
      expect(checkData.isSaved).toBe(false);
    });
  });
});
