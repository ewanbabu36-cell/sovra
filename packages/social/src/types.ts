import { Result } from '@sovra/shared';
import { SovraEvent } from '@sovra/protocol';

export interface FollowPayload {
  readonly targetPubkey: string;
  readonly isUnfollow: boolean;
  readonly relayHints?: readonly string[] | undefined;
}

export interface BlockPayload {
  readonly targetPubkey: string;
  readonly reason?: string | undefined;
  readonly isUnblock: boolean;
}

export interface MutePayload {
  readonly targetPubkey: string;
  readonly durationSeconds?: number | undefined; // 0 or undefined for indefinite
  readonly isUnmute: boolean;
}

export interface ReactionPayload {
  readonly targetEventId: string;
  readonly emoji: string; // e.g. "❤️", "👍", "🔥"
  readonly isRetraction: boolean;
}

export interface RepostPayload {
  readonly originalEventId: string;
  readonly originalAuthorPubkey: string;
  readonly commentary?: string | undefined;
}

export interface CommunityMembershipPayload {
  readonly communityId: string;
  readonly role: 'member' | 'moderator' | 'admin';
  readonly isLeave: boolean;
}

export interface FriendRequestPayload {
  readonly targetPubkey: string;
  readonly action: 'send' | 'accept' | 'decline' | 'cancel' | 'remove';
}

export interface RestrictPayload {
  readonly targetPubkey: string;
  readonly isUnrestrict: boolean;
}

export interface ChannelRoleAssignment {
  readonly pubkey: string;
  readonly role: 'owner' | 'editor' | 'moderator';
}

export interface ChannelMetadata {
  readonly id: string;
  readonly ownerPubkey: string;
  readonly handle: string; // e.g. "@tech_insider"
  readonly name: string;
  readonly description: string;
  readonly category: 'tech' | 'gaming' | 'news' | 'comedy' | 'education' | 'lifestyle' | 'music' | 'other';
  readonly avatarUrl?: string | undefined;
  readonly bannerUrl?: string | undefined;
  readonly type: 'broadcast' | 'community';
  readonly roles: readonly ChannelRoleAssignment[];
  readonly subscriberCount: number;
  readonly createdAt: number;
}

export interface PageRoleAssignment {
  readonly pubkey: string;
  readonly role: 'owner' | 'editor' | 'moderator';
}

export interface PageReview {
  readonly reviewerPubkey: string;
  readonly rating: number; // 1-5
  readonly comment: string;
  readonly createdAt: number;
}

export interface PageMetadata {
  readonly id: string;
  readonly ownerPubkey: string;
  readonly handle: string; // e.g. "@blue_cafe"
  readonly name: string;
  readonly category: 'business' | 'creator' | 'brand' | 'ngo' | 'community';
  readonly bio: string;
  readonly avatarUrl?: string | undefined;
  readonly bannerUrl?: string | undefined;
  readonly websiteUrl?: string | undefined;
  readonly ctaType: 'message' | 'website' | 'call' | 'book' | 'tip';
  readonly ctaLink?: string | undefined;
  readonly roles: readonly PageRoleAssignment[];
  readonly reviews: readonly PageReview[];
  readonly followerCount: number;
  readonly createdAt: number;
}

export type SearchTab = 'all' | 'people' | 'channels' | 'pages' | 'media' | 'hashtags' | 'audio';

export interface SearchResultItem {
  readonly id: string;
  readonly type: 'person' | 'channel' | 'page' | 'post' | 'hashtag' | 'audio';
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly handle?: string | undefined;
  readonly avatarUrl?: string | undefined;
  readonly category?: string | undefined;
  readonly count?: number | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface SocialGraphState {
  readonly pubkey: string;
  readonly followingSet: ReadonlySet<string>;
  readonly friendsSet: ReadonlySet<string>;
  readonly pendingFriendRequests: ReadonlySet<string>;
  readonly sentFriendRequests: ReadonlySet<string>;
  readonly blockedSet: ReadonlySet<string>;
  readonly restrictedSet: ReadonlySet<string>;
  readonly mutedSet: ReadonlySet<string>;
  readonly joinedCommunities: ReadonlySet<string>;
}

export interface SocialGraphEngine {
  processEvent(event: SovraEvent): Promise<Result<void>>;
  isFollowing(followerPubkey: string, targetPubkey: string): boolean;
  isBlocked(userPubkey: string, targetPubkey: string): boolean;
  isRestricted(userPubkey: string, targetPubkey: string): boolean;
  isMuted(userPubkey: string, targetPubkey: string): boolean;
  isFriend(userPubkey: string, targetPubkey: string): boolean;
  hasPendingFriendRequestFrom(userPubkey: string, requesterPubkey: string): boolean;
  getFollowing(userPubkey: string): readonly string[];
  getFriends(userPubkey: string): readonly string[];
  getPendingFriendRequests(userPubkey: string): readonly string[];
  getSentFriendRequests(userPubkey: string): readonly string[];
  getMutedUsers(userPubkey: string): readonly string[];
  getBlockedUsers(userPubkey: string): readonly string[];
  getRestrictedUsers(userPubkey: string): readonly string[];
  getState(userPubkey: string): SocialGraphState;
}

export interface LocalFeedEngine {
  appendEvent(event: SovraEvent): void;
  getChronologicalFeed(
    userPubkey: string,
    limit: number,
    beforeTimestamp?: number,
  ): readonly SovraEvent[];
  getGlobalFeed(
    userPubkey: string,
    limit: number,
    beforeTimestamp?: number,
  ): readonly SovraEvent[];
  getRankedDiscoveryFeed(
    userPubkey: string,
    limit?: number,
    beforeTimestamp?: number,
    authorReputations?: Readonly<Record<string, number>>,
  ): readonly SovraEvent[];
  filterSuppressedEvents(
    events: readonly SovraEvent[],
    graphState: SocialGraphState,
  ): readonly SovraEvent[];
}
