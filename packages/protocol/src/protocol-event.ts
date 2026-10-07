/**
 * @file packages/protocol/src/protocol-event.ts
 * Single Core Canonical Protocol Event Contract for Sovra.
 *
 * Implements:
 * 1. Unified event model across all subsystems.
 * 2. Deterministic RFC 8785 canonical serialization.
 * 3. Cryptographic Event ID generation (sha256 of canonical unsigned event).
 * 4. Deterministic Ed25519 digital signature model.
 * 5. Protocol versioning with major/minor compatibility rules.
 */

import { Result, ok, err } from '@sovra/shared';
import {
  sha256,
  bytesToHex,
  hexToBytes,
  signEd25519,
  verifyEd25519,
} from '@sovra/crypto';
import { canonicalizeJson } from './serialization.js';
import {
  ProtocolError,
  InvalidEventError,
  SignatureVerificationFailedError,
} from './errors.js';
import { SovraEvent, EventKind } from './events.js';

export const CURRENT_PROTOCOL_VERSION: ProtocolVersion = {
  major: 1,
  minor: 0,
};

export interface ProtocolVersion {
  readonly major: number;
  readonly minor: number;
}

export interface EventAuthor {
  readonly did: string; // W3C did:key:z...
  readonly deviceId?: string | undefined; // Physical device ID
  readonly pubkeyHex: string; // 64-char hex Ed25519 public key
}

export interface TargetObject {
  readonly id: string; // Target object identifier (e.g. post ID, profile DID, claim ID)
  readonly type: string; // 'profile' | 'post' | 'comment' | 'media' | 'community' | 'message' | 'knowledge' | 'device'
  readonly ownerDid?: string | undefined; // Expected owner DID of target object
}

export interface LogicalClock {
  readonly sequence: number; // Monotonically increasing sequence per (authorDid, deviceId)
  readonly lamport?: number | undefined; // Lamport logical timestamp
}

export interface UnsignedProtocolEvent<T = unknown> {
  readonly protocolVersion: ProtocolVersion;
  readonly eventType: string;
  readonly author: EventAuthor;
  readonly object?: TargetObject | undefined;
  readonly parents: readonly string[]; // Causal predecessor event IDs
  readonly logicalClock: LogicalClock;
  readonly nonce: string;
  readonly createdAt: number; // Unix seconds
  readonly expiresAt?: number | undefined; // Unix seconds (optional expiration)
  readonly payload: T;
  readonly capability?: string | undefined; // Required capability for sensitive mutation
}

export interface SovraProtocolEvent<T = unknown> extends UnsignedProtocolEvent<T> {
  readonly eventId: string; // Deterministic SHA-256 of RFC 8785 canonical unsigned event
  readonly signature: string; // Hex-encoded Ed25519 signature covering eventId
}

/**
 * Computes deterministic RFC 8785 canonical bytes for an unsigned event.
 */
export function canonicalizeUnsignedProtocolEvent<T>(event: UnsignedProtocolEvent<T>): string {
  return canonicalizeJson({
    author: {
      deviceId: event.author.deviceId ?? null,
      did: event.author.did,
      pubkeyHex: event.author.pubkeyHex.toLowerCase(),
    },
    capability: event.capability ?? null,
    createdAt: event.createdAt,
    eventType: event.eventType,
    expiresAt: event.expiresAt ?? null,
    logicalClock: {
      lamport: event.logicalClock.lamport ?? null,
      sequence: event.logicalClock.sequence,
    },
    nonce: event.nonce,
    object: event.object
      ? {
          id: event.object.id,
          ownerDid: event.object.ownerDid ?? null,
          type: event.object.type,
        }
      : null,
    parents: [...event.parents].sort(),
    payload: event.payload,
    protocolVersion: {
      major: event.protocolVersion.major,
      minor: event.protocolVersion.minor,
    },
  });
}

/**
 * Computes deterministic cryptographic eventId from canonical event content.
 */
export function computeProtocolEventId<T>(event: UnsignedProtocolEvent<T>): string {
  const canonical = canonicalizeUnsignedProtocolEvent(event);
  const hash = sha256(new TextEncoder().encode(canonical));
  return bytesToHex(hash);
}

/**
 * Signs an unsigned protocol event with author's Ed25519 private key.
 */
export function createSignedProtocolEvent<T>(
  unsigned: UnsignedProtocolEvent<T>,
  privateKey: Uint8Array,
): SovraProtocolEvent<T> {
  const eventId = computeProtocolEventId(unsigned);
  const signatureBytes = signEd25519(privateKey, new TextEncoder().encode(eventId));

  return {
    ...unsigned,
    eventId,
    signature: bytesToHex(signatureBytes),
  };
}

/**
 * Validates cryptographic integrity of a SovraProtocolEvent.
 * 1. Verifies eventId matches canonical hash of content.
 * 2. Verifies Ed25519 signature over eventId.
 */
export function verifyProtocolEventIntegrity<T>(
  event: SovraProtocolEvent<T>,
): Result<boolean, ProtocolError> {
  // 1. Recompute canonical event ID
  const expectedId = computeProtocolEventId(event);
  if (expectedId !== event.eventId) {
    return err(
      new InvalidEventError(
        `Event ID mismatch: computed '${expectedId}' does not match provided '${event.eventId}'`,
        { computedId: expectedId, providedId: event.eventId },
      ),
    );
  }

  // 2. Verify Ed25519 digital signature
  let pubkeyBytes: Uint8Array;
  try {
    pubkeyBytes = hexToBytes(event.author.pubkeyHex);
    if (pubkeyBytes.length !== 32) {
      return err(
        new InvalidEventError(`Author pubkeyHex must be 32 bytes (got ${pubkeyBytes.length})`),
      );
    }
  } catch (e) {
    return err(new InvalidEventError(`Invalid author pubkeyHex format: ${String(e)}`));
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = hexToBytes(event.signature);
    if (sigBytes.length !== 64) {
      return err(new SignatureVerificationFailedError(`Signature must be 64 bytes (got ${sigBytes.length})`));
    }
  } catch (e) {
    return err(new SignatureVerificationFailedError(`Invalid signature hex format: ${String(e)}`));
  }

  const isValid = verifyEd25519(pubkeyBytes, new TextEncoder().encode(event.eventId), sigBytes);
  if (!isValid) {
    return err(new SignatureVerificationFailedError('Digital signature verification failed for event ID'));
  }

  return ok(true);
}

/**
 * Protocol version compatibility checker.
 * Requires identical major version; accepts equal or lesser minor version.
 */
export function isProtocolVersionSupported(version: ProtocolVersion): boolean {
  if (version.major !== CURRENT_PROTOCOL_VERSION.major) {
    return false;
  }
  return version.minor <= CURRENT_PROTOCOL_VERSION.minor;
}

// =========================================================================
// INTEROPERABILITY ADAPTERS WITH LEGACY NOSTR-STYLE SovraEvent
// =========================================================================

export function toLegacySovraEvent<T>(event: SovraProtocolEvent<T>): SovraEvent {
  const tags: Array<readonly [string, ...string[]]> = [];

  if (event.object) {
    tags.push(['o', event.object.id, event.object.type]);
  }
  for (const parent of event.parents) {
    tags.push(['e', parent]);
  }
  if (event.author.deviceId) {
    tags.push(['device', event.author.deviceId]);
  }
  if (event.capability) {
    tags.push(['capability', event.capability]);
  }
  tags.push(['nonce', event.nonce]);
  tags.push(['seq', String(event.logicalClock.sequence)]);

  let kind = EventKind.ShortPost;
  if (event.eventType === 'profile.update') kind = EventKind.Metadata;
  else if (event.eventType === 'social.follow') kind = EventKind.Follow;
  else if (event.eventType === 'social.block') kind = EventKind.Block;
  else if (event.eventType === 'social.mute') kind = EventKind.Mute;
  else if (event.eventType === 'knowledge.question') kind = EventKind.Question;
  else if (event.eventType === 'knowledge.answer') kind = EventKind.Answer;
  else if (event.eventType === 'knowledge.claim') kind = EventKind.Claim;
  else if (event.eventType === 'knowledge.evidence') kind = EventKind.Evidence;
  else if (event.eventType === 'knowledge.counterargument') kind = EventKind.Counterargument;
  else if (event.eventType === 'community.governance') kind = EventKind.CommunityGovernance;

  return {
    id: event.eventId,
    pubkey: event.author.pubkeyHex,
    createdAt: event.createdAt,
    kind,
    tags,
    content: typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload),
    sig: event.signature,
  };
}
