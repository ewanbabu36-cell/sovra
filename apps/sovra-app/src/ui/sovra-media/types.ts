/**
 * @file apps/sovra-app/src/ui/sovra-media/types.ts
 * Type definitions for SOVRA Phase 5 Media Architecture
 * (Watch + Video Viewer + Reels + Media Viewer + Playlists + Live)
 */

export type WatchCategory = 'all' | 'tech' | 'gaming' | 'decentralized' | 'live';

export interface WatchVideoItem {
  id: string;
  title: string;
  channelName: string;
  channelHandle: string;
  channelAvatar: string;
  channelAvatarBg?: string;
  channelSubscribers?: number;
  channelSubscribersText?: string;
  isSubscribed?: boolean;
  views: number;
  viewsText?: string;
  likes: number;
  dislikes?: number;
  cid?: string;
  duration: string;
  durationSeconds: number;
  publishedAt: string;
  description: string;
  tags: string[];
  thumbnailUrl?: string;
  videoUrl?: string;
  category?: string;
  isLiked?: boolean;
  isSaved?: boolean;
}

export interface MediaViewerItem {
  id: string;
  cid?: string;
  type: 'image' | 'video';
  url: string;
  title?: string;
  caption?: string;
  authorName?: string;
  authorHandle?: string;
  authorAvatar?: string;
  likesCount?: number;
  commentsCount?: number;
  isLiked?: boolean;
  isSaved?: boolean;
  timestamp?: number;
}

export interface PlaylistViewItem {
  id: string;
  channelId?: string;
  creatorDid: string;
  creatorHandle?: string;
  creatorName?: string;
  title: string;
  description: string;
  thumbnailUrl?: string;
  videoIds: string[];
  videos?: WatchVideoItem[];
  videoCount: number;
  privacy: 'public' | 'unlisted' | 'private';
  createdAt: number;
  updatedAt: number;
}

export type LiveSessionStatus = 'SCHEDULED' | 'STARTING' | 'LIVE' | 'ENDING' | 'ENDED' | 'REPLAY';

export interface LiveSessionViewItem {
  id: string;
  channelId?: string;
  creatorDid: string;
  creatorHandle: string;
  creatorName: string;
  creatorAvatar: string;
  title: string;
  description: string;
  streamUrl: string;
  playbackUrl?: string;
  thumbnailUrl?: string;
  status: LiveSessionStatus;
  scheduledStartTime?: number;
  actualStartTime?: number;
  endedAt?: number;
  viewerCount: number;
  likesCount: number;
  category?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LiveChatMessageItem {
  id: string;
  sessionId: string;
  senderDid: string;
  senderHandle: string;
  senderName: string;
  senderAvatar?: string;
  text: string;
  timestamp: number;
  isModerator?: boolean;
}

export interface WatchHistoryItem {
  id: string;
  userDid: string;
  videoId: string;
  durationWatchedSec: number;
  completed: boolean;
  lastWatchedAt: number;
  video?: WatchVideoItem;
}

export interface SavedMediaItem {
  id: string;
  userDid: string;
  mediaId: string;
  mediaType: 'video' | 'reel' | 'post' | 'image';
  title?: string;
  thumbnailUrl?: string;
  savedAt: number;
}
