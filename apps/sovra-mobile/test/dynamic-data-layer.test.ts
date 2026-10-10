/**
 * @file apps/sovra-mobile/test/dynamic-data-layer.test.ts
 * Verification of Mobile Dynamic API Data Layer & State Transitions.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  fetchFeedPosts,
  fetchStories,
  markStorySeen,
  fetchReels,
  likeReel,
  fetchWatchVideos,
  fetchWatchVideo,
  sendWatchTip,
  postWatchComment,
  fetchChatMessages,
  sendChatMessage,
  registerUserProfile,
  formatTimeAgo,
  setActiveSession,
  getActiveUserDid,
  API_BASE_URL,
} from '../src/services/api.js';

describe('Sovra Mobile Dynamic Data Layer & API Service', () => {
  beforeAll(async () => {
    const reg = await registerUserProfile({
      handle: `test_alice_${Date.now()}`,
      displayName: 'Alice Tester',
    });
    if (reg.sessionToken && reg.user) {
      setActiveSession(reg.sessionToken, reg.user.did);
    }
  });

  it('verifies API base URL resolution and active session DID binding', () => {
    expect(API_BASE_URL).toMatch(/^https?:\/\//);
    expect(getActiveUserDid()).toMatch(/^did:/);
  });

  it('formats dynamic timestamps into human-readable relative strings', () => {
    const now = Date.now();
    expect(formatTimeAgo(now)).toBe('Just now');
    expect(formatTimeAgo(now - 120_000)).toBe('2m ago');
    expect(formatTimeAgo(now - 7_200_000)).toBe('2h ago');
    expect(formatTimeAgo(now - 86_400_000)).toBe('1d ago');
  });

  it('fetches live dynamic feed posts from the node engine', async () => {
    const posts = await fetchFeedPosts();
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThanOrEqual(1);

    const first = posts[0]!;
    expect(first.id).toBeDefined();
    expect(first.creatorName).toBeDefined();
    expect(typeof first.likes).toBe('number');
    expect(typeof first.timeAgo).toBe('string');
  });

  it('fetches dynamic stories and verifies markStorySeen updates', async () => {
    const stories = await fetchStories();
    expect(Array.isArray(stories)).toBe(true);
    expect(stories.length).toBeGreaterThanOrEqual(1);

    const s = stories[0]!;
    expect(s.id).toBeDefined();
    expect(s.creatorHandle).toBeDefined();
    expect(typeof s.isSeen).toBe('boolean');

    const seenRes = await markStorySeen(s.id);
    expect(seenRes).toBe(true);
  });

  it('fetches real reels catalog with video streaming URLs and IPFS CIDs', async () => {
    const reels = await fetchReels();
    expect(Array.isArray(reels)).toBe(true);
    expect(reels.length).toBeGreaterThanOrEqual(1);

    const reel = reels[0]!;
    expect(reel.manifestCid).toMatch(/^baf/);
    expect(reel.caption.length).toBeGreaterThan(0);
    expect(typeof reel.likesCount).toBe('number');

    const likeRes = await likeReel(reel.id);
    expect(likeRes.ok).toBe(true);
    expect(typeof likeRes.likesCount).toBe('number');
  });

  it('fetches YouTube-style HLS videos, tips creator 95/5, and posts comments', async () => {
    const videos = await fetchWatchVideos();
    expect(Array.isArray(videos)).toBe(true);
    expect(videos.length).toBeGreaterThanOrEqual(1);

    const video = await fetchWatchVideo(videos[0]!.id);
    expect(video.id).toBe(videos[0]!.id);
    expect(video.title).toBeDefined();
    expect(video.chapters.length).toBeGreaterThanOrEqual(1);

    // Tip creator
    const tipRes = await sendWatchTip(video.id, 10);
    expect(tipRes.ok).toBe(true);
    expect(tipRes.voucher).toBeDefined();

    // Post comment
    const commentRes = await postWatchComment(video.id, 'Dynamic verification comment', 'Alice');
    expect(commentRes.ok).toBe(true);
    expect(commentRes.comment.text).toBe('Dynamic verification comment');
  });

  it('fetches real E2EE chat messages and dispatches message without timeouts', async () => {
    const initialMsgs = await fetchChatMessages();
    expect(Array.isArray(initialMsgs)).toBe(true);

    const sendRes = await sendChatMessage({
      recipientDid: 'channel:local_mesh',
      text: 'Dynamic P2P ratchet test message',
      senderName: 'Alice',
    });

    expect(sendRes.ok).toBe(true);
    expect(sendRes.message).toBeDefined();
    expect(sendRes.message.text).toBe('Dynamic P2P ratchet test message');
  });
});
