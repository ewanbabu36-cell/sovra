/**
 * @file packages/protocol/src/authorization.ts
 * Reusable Protocol Authorization Engine & Decision Matrix.
 *
 * Evaluates:
 * 1. Principal & Signature integrity.
 * 2. Identity & Device delegation validity.
 * 3. Required Capability possession (least privilege).
 * 4. Object ownership & mutation rights.
 * 5. Current state validity (tombstone/revocation/deletion).
 * 6. Temporal bounds (skew & expiration).
 * 7. Replay / Nonce uniqueness.
 */

import {
  SovraProtocolEvent,
  verifyProtocolEventIntegrity,
} from './protocol-event.js';
import { DurableReplayStore } from './replay.js';

export type AuthorizationDecision =
  | 'AUTHORIZED'
  | 'UNAUTHORIZED'
  | 'INVALID_IDENTITY'
  | 'INVALID_SIGNATURE'
  | 'INVALID_CAPABILITY'
  | 'NOT_OWNER'
  | 'INVALID_STATE'
  | 'REPLAY'
  | 'EXPIRED'
  | 'POLICY_DENIED';

export interface AuthorizationEvaluationResult {
  readonly decision: AuthorizationDecision;
  readonly isAuthorized: boolean;
  readonly reason?: string | undefined;
}

export interface PrincipalAuthorizationContext {
  readonly principalDid: string;
  readonly grantedCapabilities: ReadonlySet<string>;
  readonly roles?: readonly string[] | undefined; // e.g. ['admin', 'moderator', 'member']
  readonly isRevoked?: boolean | undefined;
  readonly revokedDevices?: ReadonlySet<string> | undefined;
}

export interface TargetObjectState {
  readonly id: string;
  readonly type: string;
  readonly ownerDid: string;
  readonly isDeleted?: boolean | undefined;
  readonly isTombstoned?: boolean | undefined;
}

export interface StateProvider {
  getObjectState(id: string): Promise<TargetObjectState | null> | TargetObjectState | null;
  getPrincipal(did: string): Promise<PrincipalAuthorizationContext | null> | PrincipalAuthorizationContext | null;
  isDeviceRevoked(authorDid: string, deviceId: string): Promise<boolean> | boolean;
}

/**
 * Standard Capability mappings for event types.
 */
export const EVENT_REQUIRED_CAPABILITIES: Readonly<Record<string, string>> = {
  'profile.update': 'profile.write',
  'profile:update': 'profile.write',
  'post.create': 'post.create',
  'post:create': 'post.create',
  'post.edit': 'post.edit',
  'post:edit': 'post.edit',
  'post.delete': 'post.delete',
  'post:delete': 'post.delete',
  'comment.create': 'comment.create',
  'comment:create': 'comment.create',
  'reaction.create': 'reaction.create',
  'reaction.add': 'reaction.create',
  'reaction:add': 'reaction.create',
  'social.follow': 'social.follow',
  'social:follow': 'social.follow',
  'social.unfollow': 'social.follow',
  'social:unfollow': 'social.follow',
  'social.block': 'social.block',
  'social:block': 'social.block',
  'social.unblock': 'social.block',
  'social:unblock': 'social.block',
  'social.mute': 'social.follow',
  'social:mute': 'social.follow',
  'social.unmute': 'social.follow',
  'social:unmute': 'social.follow',
  'friend.request': 'social.follow',
  'friend:request': 'social.follow',
  'friend.respond': 'social.follow',
  'friend:respond': 'social.follow',
  'friend.remove': 'social.follow',
  'friend:remove': 'social.follow',
  'message.send': 'message.send',
  'message:send': 'message.send',
  'community.manage': 'community.manage',
  'community:create': 'community.manage',
  'community:member_join': 'community.manage',
  'membership.manage': 'membership.manage',
  'media.publish': 'media.publish',
  'knowledge.question': 'knowledge.write',
  'knowledge:question_create': 'knowledge.write',
  'knowledge.answer': 'knowledge.write',
  'knowledge.claim': 'knowledge.write',
  'knowledge:claim_create': 'knowledge.write',
  'knowledge.evidence': 'knowledge.write',
  'knowledge:evidence_attach': 'knowledge.write',
  'knowledge.counterargument': 'knowledge.write',
  'community.governance': 'admin.moderate',
  'admin.panic': 'admin.manage',
};

export class ProtocolAuthorizationEngine {
  private readonly replayStore: DurableReplayStore;
  private readonly stateProvider?: StateProvider | undefined;
  private readonly maxClockDriftSeconds: number;

  constructor(options?: {
    replayStore?: DurableReplayStore | undefined;
    stateProvider?: StateProvider | undefined;
    maxClockDriftSeconds?: number | undefined;
    allowOutOfOrderSequences?: boolean | undefined;
  }) {
    this.replayStore =
      options?.replayStore ??
      new DurableReplayStore({
        allowOutOfOrderSequences: options?.allowOutOfOrderSequences ?? true,
        maxClockDriftSeconds: options?.maxClockDriftSeconds,
      });
    this.stateProvider = options?.stateProvider;
    this.maxClockDriftSeconds = options?.maxClockDriftSeconds ?? 300; // 5 minutes tolerance
  }

  /**
   * Evaluates an incoming event through the complete authorization decision pipeline.
   */
  public async authorizeEvent(
    event: SovraProtocolEvent,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): Promise<AuthorizationEvaluationResult> {
    // 1. Signature & Cryptographic Integrity Check
    const integrityRes = verifyProtocolEventIntegrity(event);
    if (!integrityRes.ok) {
      return {
        decision: 'INVALID_SIGNATURE',
        isAuthorized: false,
        reason: integrityRes.error.message,
      };
    }

    // 2. Clock Skew & Expiration Check
    if (Math.abs(nowSeconds - event.createdAt) > this.maxClockDriftSeconds) {
      return {
        decision: 'EXPIRED',
        isAuthorized: false,
        reason: `Timestamp skew exceeded (${Math.abs(nowSeconds - event.createdAt)}s > ${this.maxClockDriftSeconds}s tolerance)`,
      };
    }

    if (event.expiresAt && nowSeconds > event.expiresAt) {
      return {
        decision: 'EXPIRED',
        isAuthorized: false,
        reason: `Operation expired at ${event.expiresAt} (current time: ${nowSeconds})`,
      };
    }

    // 3. Replay Protection & Monotonic Sequence Check
    const replayCheck = this.replayStore.validateAndRecord({
      eventId: event.eventId,
      issuerDid: event.author.did,
      deviceId: event.author.deviceId,
      nonce: event.nonce,
      sequence: event.logicalClock.sequence,
      timestamp: event.createdAt,
      nowSeconds,
    });

    if (!replayCheck.accepted) {
      return {
        decision: 'REPLAY',
        isAuthorized: false,
        reason: replayCheck.error ?? 'Replay detected',
      };
    }

    // 4. Principal & Device Revocation Verification
    if (this.stateProvider) {
      const principal = await this.stateProvider.getPrincipal(event.author.did);
      if (principal?.isRevoked) {
        return {
          decision: 'INVALID_IDENTITY',
          isAuthorized: false,
          reason: `Principal '${event.author.did}' has been revoked`,
        };
      }

      if (event.author.deviceId) {
        const isDevRevoked = await this.stateProvider.isDeviceRevoked(event.author.did, event.author.deviceId);
        if (isDevRevoked) {
          return {
            decision: 'INVALID_IDENTITY',
            isAuthorized: false,
            reason: `Device '${event.author.deviceId}' has been revoked by principal`,
          };
        }
      }

      // 5. Capability Verification
      const requiredCap = EVENT_REQUIRED_CAPABILITIES[event.eventType] ?? event.capability;
      if (requiredCap && principal) {
        const hasDirectCap = principal.grantedCapabilities.has(requiredCap);
        const isAdmin = principal.roles?.includes('admin');
        if (!hasDirectCap && !isAdmin) {
          return {
            decision: 'INVALID_CAPABILITY',
            isAuthorized: false,
            reason: `Principal lacks required capability '${requiredCap}'`,
          };
        }
      }

      // 6. Object Ownership & Mutation Rights
      if (event.object) {
        const targetState = await this.stateProvider.getObjectState(event.object.id);
        if (targetState) {
          // Check Deleted / Tombstoned State
          if (targetState.isDeleted || targetState.isTombstoned) {
            return {
              decision: 'INVALID_STATE',
              isAuthorized: false,
              reason: `Target object '${event.object.id}' is deleted or tombstoned`,
            };
          }

          // Check Ownership
          const isOwner = targetState.ownerDid === event.author.did;
          const isAdmin = principal?.roles?.includes('admin');
          const isMod = principal?.roles?.includes('moderator');
          const isDeleteOrModAction = event.eventType.endsWith('.delete') || event.eventType.startsWith('admin.');

          if (!isOwner && !(isAdmin || (isMod && isDeleteOrModAction))) {
            return {
              decision: 'NOT_OWNER',
              isAuthorized: false,
              reason: `Principal '${event.author.did}' does not own object '${event.object.id}'`,
            };
          }
        }
      }
    }

    // All 7 gates verified successfully
    return {
      decision: 'AUTHORIZED',
      isAuthorized: true,
    };
  }
}
