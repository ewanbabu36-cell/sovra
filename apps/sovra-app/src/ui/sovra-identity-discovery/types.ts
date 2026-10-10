/**
 * @file apps/sovra-app/src/ui/sovra-identity-discovery/types.ts
 * SOVRA Phase 6: Identity, Search, Social Graph, and Discovery UI Types
 */

export interface UserPrivacySettings {
  profileVisibility: 'public' | 'friends' | 'only_me' | 'private';
  canMessageMe: 'public' | 'friends' | 'none';
  canSendFriendRequests: 'public' | 'friends_of_friends' | 'none';
  showOnlineStatus: boolean;
  showFollowers: boolean;
  postVisibility?: 'public' | 'friends' | 'only_me';
  blockedDids?: string[];
}

export interface PublicUserDTO {
  did: string;
  handle: string;
  displayName: string;
  name?: string;
  avatar: string;
  avatarDataUrl?: string;
  avatarBg: string;
  bio: string;
  website?: string;
  websiteUrl?: string;
  deviceType?: 'Mobile' | 'Desktop';
  balanceSov?: number;
  createdAt?: number;
  privacySettings?: UserPrivacySettings;
}

export interface ProfileStats {
  followersCount: number;
  followingCount: number;
  friendsCount: number;
  mutualFriendsCount: number;
  postsCount: number;
  channelsCount: number;
  pagesCount: number;
  groupsCount: number;
}

export type FriendshipStatus = 'none' | 'pending_sent' | 'pending_received' | 'accepted' | 'rejected' | 'blocked';

export interface ProfileRelationship {
  isSelf: boolean;
  isFollowing: boolean;
  isFollowedBy: boolean;
  areFriends: boolean;
  friendshipStatus: FriendshipStatus;
  isBlocked: boolean;
  hasBlockedMe: boolean;
  canMessage: boolean;
  canSendFriendRequest: boolean;
}

export interface FullProfileResponse {
  ok: boolean;
  isPrivate?: boolean;
  isBlocked?: boolean;
  user?: PublicUserDTO;
  stats?: ProfileStats;
  relationship?: ProfileRelationship;
  posts?: any[];
  channels?: any[];
  pages?: any[];
  groups?: any[];
  error?: string;
}

export type SearchScope = 'all' | 'people' | 'channels' | 'pages' | 'groups' | 'posts' | 'videos' | 'topics';

export interface SearchResultsPayload {
  ok: boolean;
  query: string;
  scope?: SearchScope;
  users: PublicUserDTO[];
  posts: any[];
  channels: any[];
  pages: any[];
  groups: any[];
  videos: any[];
  topics: { tag: string; count: number }[];
  counts?: Record<string, number>;
}

export interface AutocompleteSuggestion {
  type: 'user' | 'channel' | 'page' | 'group' | 'topic';
  title: string;
  subtitle?: string;
  id: string;
  avatar?: string;
}
