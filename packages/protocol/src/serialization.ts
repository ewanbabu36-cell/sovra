import { Result, ok, err } from '@sovra/shared';
import {
  bytesToHex,
  hexToBytes,
  sha256,
  signEd25519,
  verifyEd25519,
  computeProofOfWork,
  verifyProofOfWork,
  verifyMemoryHardPoW,
  calculateWebOfTrustDifficulty,
} from '@sovra/crypto';
import { UnsignedSovraEvent, SovraEvent } from './events.js';
import { InvalidEventError } from './errors.js';

/**
 * Deterministic Canonical JSON Serializer (RFC 8785 Compatible)
 * Guarantees that identical payloads always serialize to identical byte arrays
 * regardless of runtime object key insertion order.
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(item => canonicalizeJson(item)).join(',')}]`;
  }

  const sortedKeys = Object.keys(obj as Record<string, unknown>)
    .filter(key => (obj as Record<string, unknown>)[key] !== undefined)
    .sort();
  const pairs = sortedKeys.map(key => {
    const value = (obj as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalizeJson(value)}`;
  });

  return `{${pairs.join(',')}}`;
}

export { canonicalizeJson as serializeCanonicalJson };

export interface CanonicalSerializer {
  serializeUnsignedEvent(event: UnsignedSovraEvent): string;
  serializeSignedEvent(event: SovraEvent): string;
}

export class DefaultCanonicalSerializer implements CanonicalSerializer {
  serializeUnsignedEvent(event: UnsignedSovraEvent): string {
    return canonicalizeJson({
      content: event.content,
      createdAt: event.createdAt,
      kind: event.kind,
      media: event.media ?? [],
      pubkey: event.pubkey,
      tags: event.tags,
    });
  }

  serializeSignedEvent(event: SovraEvent): string {
    return canonicalizeJson({
      content: event.content,
      createdAt: event.createdAt,
      id: event.id,
      kind: event.kind,
      media: event.media ?? [],
      pubkey: event.pubkey,
      sig: event.sig,
      tags: event.tags,
    });
  }
}

export interface EventValidator {
  validateEventStructure(event: unknown): Result<SovraEvent, InvalidEventError>;
  isTimestampAcceptable(timestampSeconds: number, maxDriftSeconds?: number): boolean;
}

export class DefaultEventValidator implements EventValidator {
  validateEventStructure(event: unknown): Result<SovraEvent, InvalidEventError> {
    if (!event || typeof event !== 'object') {
      return err(new InvalidEventError('Event must be a non-null object'));
    }

    const candidate = event as Record<string, unknown>;
    if (typeof candidate['id'] !== 'string' || candidate['id'].length === 0) {
      return err(new InvalidEventError('Event missing valid id'));
    }
    if (typeof candidate['pubkey'] !== 'string' || candidate['pubkey'].length === 0) {
      return err(new InvalidEventError('Event missing valid pubkey'));
    }
    if (typeof candidate['createdAt'] !== 'number' || candidate['createdAt'] <= 0) {
      return err(new InvalidEventError('Event missing valid createdAt timestamp'));
    }
    if (typeof candidate['kind'] !== 'number') {
      return err(new InvalidEventError('Event missing valid kind'));
    }
    if (!Array.isArray(candidate['tags'])) {
      return err(new InvalidEventError('Event tags must be an array'));
    }
    if (typeof candidate['sig'] !== 'string' || candidate['sig'].length === 0) {
      return err(new InvalidEventError('Event missing valid signature'));
    }

    return ok(event as SovraEvent);
  }

  isTimestampAcceptable(timestampSeconds: number, maxDriftSeconds = 300): boolean {
    const currentSeconds = Math.floor(Date.now() / 1000);
    const diff = Math.abs(currentSeconds - timestampSeconds);
    return diff <= maxDriftSeconds;
  }
}

/**
 * Computes deterministic RFC 8785 SHA-256 event ID.
 */
export function computeEventId(unsignedEvent: UnsignedSovraEvent): string {
  const serializer = new DefaultCanonicalSerializer();
  const canonicalJson = serializer.serializeUnsignedEvent(unsignedEvent);
  const hash = sha256(new TextEncoder().encode(canonicalJson));
  return bytesToHex(hash);
}

/**
 * Signs an unsigned event using author's Ed25519 private key,
 * optionally computing Hashcash Proof-of-Work to thwart Sybil/spam attacks.
 */
export function createSignedSovraEvent(
  unsignedEvent: UnsignedSovraEvent,
  privateKey: Uint8Array,
  difficultyBits = 0,
): SovraEvent {
  const id = computeEventId(unsignedEvent);
  const sigBytes = signEd25519(privateKey, new TextEncoder().encode(id));
  const sig = bytesToHex(sigBytes);

  let powNonce = unsignedEvent.powNonce;
  let powDifficulty = unsignedEvent.powDifficulty;

  if (difficultyBits > 0) {
    const pow = computeProofOfWork(new TextEncoder().encode(id), difficultyBits);
    powNonce = String(pow.nonce);
    powDifficulty = difficultyBits;
  }

  return {
    ...unsignedEvent,
    id,
    sig,
    powNonce,
    powDifficulty,
  };
}

export interface EventVerificationOptions {
  readonly memoryHard?: boolean | undefined;
  readonly webOfTrustReputation?: number | undefined;
  readonly hasHardwarePasskey?: boolean | undefined;
}

/**
 * Cryptographically verifies that the event ID matches canonical serialization,
 * the Ed25519 signature is authentic, and optionally validates PoW difficulty.
 */
export function verifySignedSovraEvent(
  event: SovraEvent,
  minDifficultyBits = 0,
  options?: EventVerificationOptions,
): boolean {
  try {
    const validator = new DefaultEventValidator();
    const valid = validator.validateEventStructure(event);
    if (!valid.ok) return false;

    const expectedId = computeEventId(event);
    if (expectedId !== event.id) return false;

    const pubkeyBytes = hexToBytes(event.pubkey);
    const sigBytes = hexToBytes(event.sig);
    const isSigValid = verifyEd25519(pubkeyBytes, new TextEncoder().encode(event.id), sigBytes);
    if (!isSigValid) return false;

    let targetDifficulty = minDifficultyBits;
    if (
      options?.webOfTrustReputation !== undefined ||
      options?.hasHardwarePasskey !== undefined
    ) {
      targetDifficulty = calculateWebOfTrustDifficulty(
        minDifficultyBits,
        1,
        {
          isPasskeyVerified: options?.hasHardwarePasskey,
          reputationScore:
            options?.webOfTrustReputation !== undefined
              ? options.webOfTrustReputation / 100
              : undefined,
        },
      );
    }

    if (targetDifficulty > 0) {
      if (!event.powNonce || (event.powDifficulty ?? 0) < targetDifficulty) {
        return false;
      }
      if (options?.memoryHard) {
        return verifyMemoryHardPoW(
          new TextEncoder().encode(event.id),
          BigInt(event.powNonce),
          targetDifficulty,
        );
      }
      return verifyProofOfWork(
        new TextEncoder().encode(event.id),
        BigInt(event.powNonce),
        targetDifficulty,
      );
    }

    return true;
  } catch {
    return false;
  }
}

