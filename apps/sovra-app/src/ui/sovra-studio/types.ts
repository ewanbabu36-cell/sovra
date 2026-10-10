/**
 * @file apps/sovra-app/src/ui/sovra-studio/types.ts
 * Type definitions for Unified SOVRA Studio (Channel, Page, Group Management)
 */

export type SpaceRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'MODERATOR' | 'MEMBER';
export type SpaceType = 'channel' | 'page' | 'group';

export type SpaceAction =
  | 'VIEW'
  | 'TRANSFER_OWNERSHIP'
  | 'MANAGE_SETTINGS'
  | 'MANAGE_TEAM'
  | 'MANAGE_MEMBERS'
  | 'MANAGE_MODERATION'
  | 'MANAGE_COMMENTS'
  | 'CREATE_CONTENT'
  | 'EDIT_CONTENT'
  | 'DELETE_CONTENT'
  | 'VIEW_ANALYTICS';

export interface SpaceEntitySummary {
  id: string;
  handle: string;
  name: string;
  category: string;
  description?: string;
  bio?: string;
  avatar: string;
  bg?: string;
  count?: number;
  memberCount?: number;
  privacy?: 'public' | 'private' | 'secret';
  ownerDid?: string;
  createdAt: number;
}

export interface SpaceMember {
  id: string;
  spaceId: string;
  spaceType: SpaceType;
  userDid: string;
  handle: string;
  name: string;
  avatar?: string;
  role: SpaceRole;
  joinedAt: number;
  isMuted?: boolean;
  isBanned?: boolean;
}

export interface SpaceRule {
  id: string;
  spaceId: string;
  title: string;
  description: string;
  orderIndex: number;
  createdAt: number;
}

export interface SpaceStudioStats {
  contentCount: number;
  memberCount: number;
  recentActivityCount: number;
}

export interface SpaceStudioData {
  space: SpaceEntitySummary;
  spaceType: SpaceType;
  userRole: SpaceRole | null;
  isManager: boolean;
  stats: SpaceStudioStats;
}
