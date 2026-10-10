/**
 * @file apps/sovra-mobile/src/types.ts
 * Type definitions for Sovra Mobile App.
 */

export type RootTabParamList = {
  Feed: undefined;
  Reels: undefined;
  Watch: undefined;
  Chats: undefined;
  Me: undefined;
};

export interface MobileReelItem {
  id: string;
  creatorHandle: string;
  creatorName: string;
  caption: string;
  audioTrack: string;
  likesCount: number;
  commentsCount: number;
  bgGradient: string;
  manifestCid: string;
  segment0Cid: string;
  videoUrl?: string | undefined;
  isLiked?: boolean | undefined;
}

export interface MobileStoryItem {
  id: string;
  creatorHandle: string;
  creatorName: string;
  avatarEmoji: string;
  avatarBg: string;
  isSeen: boolean;
  hoursRemaining: number;
}

export interface MobileChatMessage {
  id: string;
  senderDid: string;
  senderName: string;
  text: string;
  timestamp: number;
  isOutgoing: boolean;
  tickState: 'sending' | 'sent' | 'delivered' | 'read';
  isAudioNote?: boolean | undefined;
  isBitChat?: boolean | undefined;
  hopCount?: number | undefined;
}
