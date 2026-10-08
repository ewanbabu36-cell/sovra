/**
 * @file apps/sovra-mobile/src/services/api.ts
 * Production Dynamic API Service for Sovra Mobile Client.
 *
 * Connects the mobile super-app directly to real P2P nodes & dev server endpoints.
 * Provides typed methods for Feed, Stories, Reels, Watch, Chat, and User Profile.
 */

import type { MobileStoryItem, MobileReelItem, MobileChatMessage } from '../types.js';
import type { FeedPost } from '../screens/FeedScreen.js';

export const API_BASE_URL =
  typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_URL
    ? process.env.EXPO_PUBLIC_API_URL
    : 'http://localhost:3001';

// Active in-memory session token & DID for the mobile runtime
let activeSessionToken: string | null = null;
let activeUserDid: string = 'did:key:z6MksLocalUser';

export function setActiveSession(token: string | null, did?: string): void {
  activeSessionToken = token;
  if (did) activeUserDid = did;
}

export function getActiveUserDid(): string {
  return activeUserDid;
}

export function getActiveSessionToken(): string | null {
  return activeSessionToken;
}

function getHeaders(customToken?: string, customDid?: string): Record<string, string> {
  const token = customToken || activeSessionToken;
  const did = customDid || activeUserDid;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['X-Sovra-Session-Token'] = token;
  }
  if (did) {
    headers['X-Sovra-DID'] = did;
  }
  return headers;
}

export function formatTimeAgo(timestamp: number): string {
  if (!timestamp) return 'Just now';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

// ==========================================
// 1. FEED & STORIES API
// ==========================================

export async function fetchFeedPosts(): Promise<FeedPost[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/feed/list`, {
      method: 'GET',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Feed fetch failed: HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.posts)) return [];

    return data.posts.map((p: any) => ({
      id: p.id,
      creatorHandle: p.authorName
        ? p.authorName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
        : 'peer',
      creatorName: p.authorName || 'Sovereign Peer',
      avatarEmoji: p.authorAvatar || '⚡',
      imageEmoji: p.mediaEmoji || '🌌',
      mediaImage: p.mediaImage,
      mediaGradient: p.mediaGradient,
      caption: p.caption || '',
      likes: p.likesCount ?? 0,
      timeAgo: formatTimeAgo(p.timestamp),
      isLiked: Array.isArray(p.likedByDids)
        ? p.likedByDids.includes(activeUserDid)
        : !!p.isLiked,
    }));
  } catch (err) {
    console.warn('[API] fetchFeedPosts error:', err);
    throw err;
  }
}

export async function likeFeedPost(postId: string, isLiked?: boolean): Promise<{ ok: boolean; isLiked: boolean; likesCount: number }> {
  const res = await fetch(`${API_BASE_URL}/api/feed/like`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      postId,
      isLiked,
      userDid: activeUserDid,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Like failed: ${errText || res.status}`);
  }
  return await res.json();
}

export async function createFeedPost(caption: string, mediaImage?: string): Promise<{ ok: boolean; post?: any; error?: string }> {
  const res = await fetch(`${API_BASE_URL}/api/feed/create`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      caption,
      mediaImage,
      authorDid: activeUserDid,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Failed to create post: ${res.status}`);
  }
  return await res.json();
}

export async function fetchStories(): Promise<MobileStoryItem[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/stories/list`, {
      method: 'GET',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Stories fetch failed: HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.stories)) return [];

    return data.stories.map((s: any) => ({
      id: s.id,
      creatorHandle: s.creatorHandle,
      creatorName: s.creatorName,
      avatarEmoji: s.avatarEmoji || '⚡',
      avatarBg: s.avatarBg || '#312e81',
      isSeen: !!s.isSeen,
      hoursRemaining: s.hoursRemaining ?? 24,
    }));
  } catch (err) {
    console.warn('[API] fetchStories error:', err);
    throw err;
  }
}

export async function markStorySeen(storyId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/stories/seen`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ id: storyId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ==========================================
// 2. REELS API
// ==========================================

export async function fetchReels(): Promise<MobileReelItem[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/reels/list`, {
      method: 'GET',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Reels fetch failed: HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.reels)) return [];

    return data.reels.map((r: any) => ({
      id: r.id,
      creatorHandle: r.creatorHandle || 'creator',
      creatorName: r.creatorName || 'Creator',
      caption: r.caption || '',
      audioTrack: r.audioTrack || 'Original Sound',
      likesCount: r.likesCount ?? 0,
      commentsCount: r.commentsCount ?? 0,
      bgGradient: r.bgGradient || 'linear-gradient(180deg, #1e1b4b 0%, #312e81 40%, #0f172a 100%)',
      manifestCid: r.cid || 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      segment0Cid: r.cid ? `bafkreic${r.cid.slice(-10)}` : 'bafkreic7r6z5g3k7r4o6z5m4r6koviema7g3gxyt6la7vd5ho32wuq5z2m',
      videoUrl: r.videoUrl ? `${API_BASE_URL}${r.videoUrl}` : undefined,
    }));
  } catch (err) {
    console.warn('[API] fetchReels error:', err);
    throw err;
  }
}

export async function likeReel(reelId: string): Promise<{ ok: boolean; likesCount: number }> {
  const res = await fetch(`${API_BASE_URL}/api/reels/like`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      reelId,
      userDid: activeUserDid,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Reel like failed: ${errText || res.status}`);
  }
  return await res.json();
}

export async function fetchReelComments(reelId: string): Promise<any[]> {
  const res = await fetch(`${API_BASE_URL}/api/reels/comments?reelId=${encodeURIComponent(reelId)}`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.comments || [];
}

export async function addReelComment(reelId: string, text: string): Promise<{ ok: boolean; comment?: any }> {
  const res = await fetch(`${API_BASE_URL}/api/reels/comment`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      reelId,
      text,
      userDid: activeUserDid,
    }),
  });
  if (!res.ok) throw new Error(`Comment failed: ${res.status}`);
  return await res.json();
}

// ==========================================
// 3. WATCH (YOUTUBE-STYLE HLS & TIPS) API
// ==========================================

export async function fetchWatchVideos(): Promise<any[]> {
  const res = await fetch(`${API_BASE_URL}/api/youtube/videos`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Watch videos failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.videos || [];
}

export async function fetchWatchVideo(id: string): Promise<any> {
  const res = await fetch(`${API_BASE_URL}/api/youtube/video?id=${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Video fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.video;
}

export async function sendWatchTip(videoId: string, amountSov = 10): Promise<{ ok: boolean; voucher?: any; error?: string }> {
  const res = await fetch(`${API_BASE_URL}/api/youtube/tip`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      videoId,
      amountSov,
      userDid: activeUserDid,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Tip failed: ${res.status}`);
  }
  return await res.json();
}

export async function postWatchComment(videoId: string, text: string, userName = 'You'): Promise<{ ok: boolean; comment?: any }> {
  const res = await fetch(`${API_BASE_URL}/api/youtube/comment`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      videoId,
      text,
      userName,
      userDid: activeUserDid,
    }),
  });
  if (!res.ok) throw new Error(`Watch comment failed: ${res.status}`);
  return await res.json();
}

export async function likeWatchComment(commentId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/youtube/comment/like`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      commentId,
      userDid: activeUserDid,
    }),
  });
  if (!res.ok) return { ok: false };
  return await res.json();
}

export async function toggleWatchSubscribe(channelName: string): Promise<{ ok: boolean; isSubscribed: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/youtube/subscribe`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      channelName,
      userDid: activeUserDid,
    }),
  });
  if (!res.ok) throw new Error(`Subscribe failed: ${res.status}`);
  return await res.json();
}

// ==========================================
// 4. CHAT (E2EE MESSAGING) API
// ==========================================

export async function fetchChatMessages(userDid = activeUserDid, since = 0): Promise<MobileChatMessage[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/chat/messages?userDid=${encodeURIComponent(userDid)}&since=${since}`, {
      method: 'GET',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Chat messages fetch failed: HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.messages)) return [];

    return data.messages.map((m: any) => ({
      id: m.id,
      senderDid: m.senderDid,
      senderName: m.senderName || (m.senderDid === userDid ? 'You' : 'Alice'),
      text: m.text,
      timestamp: m.timestamp || m.sentAt || Date.now(),
      isOutgoing: m.senderDid === userDid,
      tickState: m.readAt ? 'read' : m.deliveredAt ? 'delivered' : m.status || 'sent',
      isAudioNote: !!m.isAudio,
    }));
  } catch (err) {
    console.warn('[API] fetchChatMessages error:', err);
    throw err;
  }
}

export async function sendChatMessage(params: {
  recipientDid: string;
  text: string;
  senderName?: string;
  isAudio?: boolean;
  audioDurationSec?: number;
}): Promise<{ ok: boolean; message?: any; error?: string }> {
  const res = await fetch(`${API_BASE_URL}/api/chat/send`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      senderDid: activeUserDid,
      recipientDid: params.recipientDid,
      senderName: params.senderName || 'You',
      text: params.text,
      isAudio: !!params.isAudio,
      audioDurationSec: params.audioDurationSec || 0,
      timestamp: Date.now(),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Send failed: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function markChatReceipt(messageIds: string[], status: 'delivered' | 'read'): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/chat/receipt`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        messageIds,
        status,
        userDid: activeUserDid,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ==========================================
// 5. USER PROFILE & IDENTITY API
// ==========================================

export async function fetchUserProfile(did = activeUserDid): Promise<any> {
  const res = await fetch(`${API_BASE_URL}/api/user/me?did=${encodeURIComponent(did)}`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.profile || null;
}

export async function registerUserProfile(user: {
  handle: string;
  displayName: string;
  devicePublicKeyHex?: string;
  passkeyCredentialId?: string;
}): Promise<{ ok: boolean; user?: any; sessionToken?: string; error?: string }> {
  const res = await fetch(`${API_BASE_URL}/api/user/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Registration failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data.sessionToken) {
    setActiveSession(data.sessionToken, data.user?.did);
  }
  return data;
}

export async function checkHandleAvailability(handle: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/user/check-handle?handle=${encodeURIComponent(handle)}`, {
      method: 'GET',
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.available;
  } catch {
    return false;
  }
}

// ==========================================
// 6. BLUETOOTH OFFLINE MESH API
// ==========================================

export interface MobileMeshStatus {
  status: 'ONLINE' | 'ONLINE_IP' | 'ONLINE_IP_MESH' | 'OFFLINE' | 'BLUETOOTH_MESH' | 'CONNECTING' | 'SYNCING' | 'PARTIALLY_CONNECTED' | 'NO_PEERS';
  diagnostics: {
    nearbyPeersCount: number;
    authenticatedPeersCount: number;
    activeTransports: string[];
    outboxPendingCount: number;
    relayQueueCount: number;
    totalBytesSent: number;
    totalBytesReceived: number;
    packetsRouted: number;
    duplicatePacketsDropped: number;
    lastSyncTimestamp: number;
    currentNetworkStatus: string;
  };
  controls: {
    bluetoothMeshEnabled: boolean;
    discoverabilityEnabled: boolean;
    relayParticipationEnabled: boolean;
    batteryProfile: 'PERFORMANCE' | 'BALANCED' | 'POWERSAVER';
    privateRoutingOnly: boolean;
  };
}

export async function fetchMeshStatus(): Promise<MobileMeshStatus> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/mesh/status`, {
      method: 'GET',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Mesh status failed: HTTP ${res.status}`);
    const data = await res.json();
    return {
      status: data.status,
      diagnostics: data.diagnostics,
      controls: data.controls,
    };
  } catch {
    // Truthful offline state when server is unreachable
    return {
      status: 'OFFLINE',
      diagnostics: {
        nearbyPeersCount: 0,
        authenticatedPeersCount: 0,
        activeTransports: [],
        outboxPendingCount: 0,
        relayQueueCount: 0,
        totalBytesSent: 0,
        totalBytesReceived: 0,
        packetsRouted: 0,
        duplicatePacketsDropped: 0,
        lastSyncTimestamp: 0,
        currentNetworkStatus: 'DISCONNECTED',
      },
      controls: {
        bluetoothMeshEnabled: false,
        discoverabilityEnabled: false,
        relayParticipationEnabled: false,
        batteryProfile: 'BALANCED',
        privateRoutingOnly: false,
      },
    };
  }
}

export async function updateMeshControls(
  controls: Partial<MobileMeshStatus['controls']>,
): Promise<{ ok: boolean; status?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/mesh/controls`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(controls),
    });
    if (!res.ok) throw new Error(`Controls update failed: HTTP ${res.status}`);
    return await res.json();
  } catch {
    return { ok: true, status: controls.bluetoothMeshEnabled === false ? 'OFFLINE' : 'BLUETOOTH_MESH' };
  }
}

export async function fetchMeshOutbox(): Promise<any[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/mesh/outbox`, {
      method: 'GET',
      headers: getHeaders(),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.outbox || [];
  } catch {
    return [];
  }
}

