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

export interface SocialGraphState {
  readonly pubkey: string;
  readonly followingSet: ReadonlySet<string>;
  readonly blockedSet: ReadonlySet<string>;
  readonly mutedSet: ReadonlySet<string>;
  readonly joinedCommunities: ReadonlySet<string>;
}

export interface SocialGraphEngine {
  processEvent(event: SovraEvent): Promise<Result<void>>;
  isFollowing(followerPubkey: string, targetPubkey: string): boolean;
  isBlocked(userPubkey: string, targetPubkey: string): boolean;
  isMuted(userPubkey: string, targetPubkey: string): boolean;
  getFollowing(userPubkey: string): readonly string[];
  getMutedUsers(userPubkey: string): readonly string[];
  getBlockedUsers(userPubkey: string): readonly string[];
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
