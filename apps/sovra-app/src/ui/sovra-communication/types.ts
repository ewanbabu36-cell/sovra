/**
 * @file apps/sovra-app/src/ui/sovra-communication/types.ts
 * Spatial Communication Layer Type Definitions (Chat, Calls, Notifications, Creation)
 */

export interface ChatContact {
  did: string;
  name: string;
  handle: string;
  avatar?: string;
  role?: string;
  isOnline: boolean;
  isFriend: boolean;
  lastMessage?: string;
  lastMessageTimestamp?: number;
  lastMessageStatus?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | null;
  lastMessageIsOutgoing?: boolean;
  unreadCount: number;
}

export interface ChatAttachment {
  name: string;
  type: string;
  size: number;
  cid: string;
  url: string;
  dataUrl?: string;
}

export interface ChatMessage {
  id: string;
  threadId?: string;
  senderDid: string;
  recipientDid: string;
  text: string;
  timestamp: number;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  attachment?: ChatAttachment;
  isAudio?: boolean;
  audioDurationSec?: number;
  isDisappeared?: boolean;
  reactions?: Array<{ emoji: string; senderDid: string }>;
}

export interface SpatialNotification {
  id: string;
  recipientDid: string;
  senderDid?: string;
  senderName?: string;
  senderAvatar?: string;
  type: 'message' | 'friend_request' | 'like' | 'reaction' | 'comment' | 'follow' | 'channel' | 'page' | 'group' | 'system';
  title?: string;
  body: string;
  content?: string;
  targetId?: string;
  timestamp: number;
  isRead: boolean;
  read?: boolean;
}

export type CallType = 'audio' | 'video';

export type CallState =
  | 'idle'
  | 'requesting_permissions'
  | 'signaling_offer'
  | 'ringing'
  | 'ice_connecting'
  | 'connected'
  | 'ended'
  | 'declined'
  | 'failed';
