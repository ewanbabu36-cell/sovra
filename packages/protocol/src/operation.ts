/**
 * @file packages/protocol/src/operation.ts
 * Cryptographically Signed Operations & Semantic Authorization Pipeline.
 */

import {
  sha256,
  bytesToHex,
  hexToBytes,
  signEd25519,
  verifyEd25519,
} from '@sovra/crypto';
import {
  AuthenticatedPrincipal,
  PrincipalCapability,
  hasCapability,
  DeviceDelegationAssertion,
  verifyDeviceDelegation,
} from '@sovra/identity';
import { canonicalizeJson } from './serialization.js';
import { DurableReplayStore } from './replay.js';

export type OperationType =
  | 'FEED_POST_CREATE'
  | 'FEED_POST_DELETE'
  | 'FEED_POST_LIKE'
  | 'FEED_COMMENT_CREATE'
  | 'CHAT_MESSAGE_SEND'
  | 'FRIEND_REQUEST'
  | 'FRIEND_RESPOND'
  | 'FRIEND_REMOVE'
  | 'YOUTUBE_TIP'
  | 'ADMIN_PANIC'
  | 'ADMIN_CONFIG'
  | 'KNOWLEDGE_QUESTION_CREATE'
  | 'KNOWLEDGE_ANSWER_CREATE'
  | 'KNOWLEDGE_CLAIM_CREATE'
  | 'KNOWLEDGE_EVIDENCE_ATTACH'
  | 'KNOWLEDGE_COUNTERARGUMENT_SUBMIT'
  | 'COMMUNITY_GOVERNANCE_ACTION'
  | 'REPUTATION_ASSERTION_ISSUE';

export interface UnsignedOperation<T = unknown> {
  readonly issuerDid: string;
  readonly deviceId: string;
  readonly operationType: OperationType;
  readonly payload: T;
  readonly nonce: string;
  readonly sequence?: number | undefined;
  readonly timestamp: number;
  readonly prevEventRef?: string | undefined;
  readonly expiresAt?: number | undefined;
}

export interface SignedOperation<T = unknown> extends UnsignedOperation<T> {
  readonly eventId: string;
  readonly signature: string; // Ed25519 signature in hex
}

export interface OperationValidationResult {
  readonly valid: boolean;
  readonly error?: string | undefined;
}

export interface TargetObjectDescriptor {
  readonly id: string;
  readonly ownerDid: string;
  readonly isDeleted?: boolean | undefined;
  readonly tombstone?: boolean | undefined;
}

export interface OperationAuthorizationContext {
  readonly principal?: AuthenticatedPrincipal | undefined;
  readonly targetObject?: TargetObjectDescriptor | null | undefined;
  readonly delegation?: DeviceDelegationAssertion | undefined;
  readonly maxAgeSeconds?: number | undefined;
  readonly nowSeconds?: number | undefined;
}

/**
 * Resolves required capability for each mutation operation.
 */
export function getRequiredCapabilityForOperation(type: OperationType): PrincipalCapability {
  switch (type) {
    case 'FEED_POST_CREATE':
    case 'FEED_POST_LIKE':
    case 'FEED_COMMENT_CREATE':
    case 'FRIEND_REQUEST':
    case 'FRIEND_RESPOND':
      return 'social:write';
    case 'FEED_POST_DELETE':
    case 'FRIEND_REMOVE':
      return 'social:delete';
    case 'KNOWLEDGE_QUESTION_CREATE':
    case 'KNOWLEDGE_ANSWER_CREATE':
    case 'KNOWLEDGE_CLAIM_CREATE':
    case 'KNOWLEDGE_EVIDENCE_ATTACH':
    case 'KNOWLEDGE_COUNTERARGUMENT_SUBMIT':
    case 'REPUTATION_ASSERTION_ISSUE':
      return 'knowledge:write';
    case 'COMMUNITY_GOVERNANCE_ACTION':
      return 'admin:moderate';
    case 'CHAT_MESSAGE_SEND':
      return 'chat:send';
    case 'YOUTUBE_TIP':
      return 'financial:transfer';
    case 'ADMIN_PANIC':
      return 'admin:panic';
    case 'ADMIN_CONFIG':
      return 'admin:super';
    default:
      return 'social:write';
  }
}

/**
 * Computes deterministic RFC 8785 SHA-256 hash for an operation.
 */
export function computeOperationId<T>(op: UnsignedOperation<T>): string {
  const canonical = canonicalizeJson({
    deviceId: op.deviceId,
    issuerDid: op.issuerDid,
    nonce: op.nonce,
    operationType: op.operationType,
    payload: op.payload,
    prevEventRef: op.prevEventRef ?? null,
    sequence: op.sequence ?? null,
    timestamp: op.timestamp,
    expiresAt: op.expiresAt ?? null,
  });
  return bytesToHex(sha256(new TextEncoder().encode(canonical)));
}

/**
 * Signs an unsigned operation with author's Ed25519 private key.
 */
export function signOperation<T>(
  op: UnsignedOperation<T>,
  privateKey: Uint8Array,
): SignedOperation<T> {
  const eventId = computeOperationId(op);
  const sigBytes = signEd25519(privateKey, new TextEncoder().encode(eventId));
  return {
    ...op,
    eventId,
    signature: bytesToHex(sigBytes),
  };
}

/**
 * Validates cryptographic signature, issuer validity, replay protection,
 * and semantic authorization rules (capabilities, ownership, delegation, tombstones).
 */
export function validateSignedOperation<T>(
  op: SignedOperation<T>,
  publicKeyBytes: Uint8Array,
  replayStore?: DurableReplayStore,
  authContext?: OperationAuthorizationContext,
): OperationValidationResult {
  try {
    const nowSec = authContext?.nowSeconds ?? Math.floor(Date.now() / 1000);
    const opTimeSec = op.timestamp > 1e11 ? Math.floor(op.timestamp / 1000) : op.timestamp;

    // 1. Expiration check
    if (op.expiresAt !== undefined && nowSec > op.expiresAt) {
      return { valid: false, error: `Operation expired: now ${nowSec} > op.expiresAt ${op.expiresAt}` };
    }
    const maxAge = authContext?.maxAgeSeconds ?? 3600;
    if (nowSec - opTimeSec > maxAge) {
      return {
        valid: false,
        error: `Operation expired: operation timestamp ${opTimeSec} exceeds max allowed age (${maxAge}s)`,
      };
    }
    if (opTimeSec > nowSec + 300) {
      return {
        valid: false,
        error: `Operation invalid: operation timestamp ${opTimeSec} is too far in the future`,
      };
    }

    // 2. State transition legality
    if (op.operationType === 'FRIEND_REQUEST') {
      const payloadAny = op.payload as any;
      if (payloadAny && payloadAny.targetDid === op.issuerDid) {
        return { valid: false, error: 'Illegal state transition: Cannot send friend request to oneself' };
      }
    }

    // 3. Verify Event ID matches canonical content
    const expectedId = computeOperationId(op);
    if (expectedId !== op.eventId) {
      return { valid: false, error: 'Operation ID mismatch: canonical hash mismatch' };
    }

    // 4. Verify Cryptographic Signature
    const sigBytes = hexToBytes(op.signature);
    const isValidSig = verifyEd25519(publicKeyBytes, new TextEncoder().encode(op.eventId), sigBytes);
    if (!isValidSig) {
      return { valid: false, error: 'Cryptographic signature verification failed' };
    }

    // 5. Replay protection
    if (replayStore) {
      const replayResult = replayStore.validateAndRecord({
        eventId: op.eventId,
        issuerDid: op.issuerDid,
        deviceId: op.deviceId,
        nonce: op.nonce,
        sequence: op.sequence,
        timestamp: op.timestamp,
      });

      if (!replayResult.accepted) {
        return { valid: false, error: replayResult.error ?? 'Replay check rejected' };
      }
    }

    // 6. Device Delegation chain verification
    if (authContext?.delegation) {
      const isDelValid = verifyDeviceDelegation(authContext.delegation, nowSec);
      if (!isDelValid) {
        return { valid: false, error: 'Device delegation verification failed or delegation has expired' };
      }
      if (authContext.delegation.parentDid !== op.issuerDid) {
        return {
          valid: false,
          error: `Delegation parent mismatch: delegation parent '${authContext.delegation.parentDid}' !== issuer '${op.issuerDid}'`,
        };
      }
      if (authContext.delegation.deviceId !== op.deviceId) {
        return {
          valid: false,
          error: `Delegation deviceId mismatch: delegation device '${authContext.delegation.deviceId}' !== op device '${op.deviceId}'`,
        };
      }
    }

    // 7. Principal Capability verification
    if (authContext?.principal) {
      const requiredCap = getRequiredCapabilityForOperation(op.operationType);
      if (!hasCapability(authContext.principal, requiredCap)) {
        return {
          valid: false,
          error: `Principal capability violation: principal lacks capability '${requiredCap}' for operation '${op.operationType}'`,
        };
      }
    }

    // 8. Target Object existence, state (tombstone), and ownership
    if (authContext && 'targetObject' in authContext) {
      if (authContext.targetObject === null) {
        return { valid: false, error: 'Target object existence violation: referenced target entity does not exist' };
      }

      const target = authContext.targetObject;
      if (target) {
        if (target.isDeleted || target.tombstone) {
          return {
            valid: false,
            error: `Target object state violation: target '${target.id}' is already deleted or tombstoned`,
          };
        }

        if (op.operationType === 'FEED_POST_DELETE' || op.operationType === 'FRIEND_REMOVE') {
          const isOwner = op.issuerDid === target.ownerDid;
          const hasAdminOverride =
            authContext.principal?.role === 'SUPER_ADMIN' ||
            authContext.principal?.role === 'MODERATOR' ||
            Boolean(authContext.principal?.capabilities?.includes('admin:moderate'));

          if (!isOwner && !hasAdminOverride) {
            return {
              valid: false,
              error: `Object ownership violation: issuer '${op.issuerDid}' does not own target '${target.id}' (owned by '${target.ownerDid}')`,
            };
          }
        }
      }
    }

    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: `Validation exception: ${err?.message || String(err)}` };
  }
}
