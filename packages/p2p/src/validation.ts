import { hexToBytes, verifyEd25519, sha256, bytesToHex } from '@sovra/crypto';
import { RevocationRegistry, verifyDeviceDelegation, DeviceDelegation } from '@sovra/identity';
import { SovraEvent, serializeCanonicalJson } from '@sovra/protocol';
import { EventValidationResult } from './types.js';

export interface ValidationContext {
  readonly topic?: string | undefined;
  readonly maxPayloadBytes?: number | undefined;
  readonly revocationRegistry?: RevocationRegistry | undefined;
  readonly seenEventIds?: Set<string> | undefined;
  readonly maxClockSkewSeconds?: number | undefined;
  readonly maxEventAgeSeconds?: number | undefined;
}

const DEFAULT_MAX_SIZE = 1024 * 1024; // 1MB
const DEFAULT_MAX_SKEW = 300; // 5 minutes
const DEFAULT_MAX_AGE = 86400 * 7; // 7 days

/**
 * 10-Step Protocol Event Validation Pipeline.
 * Enforces strict cryptographic integrity before any event is forwarded or accepted.
 */
export class EventValidationPipeline {
  public static validate(rawBytes: Uint8Array, context?: ValidationContext): EventValidationResult {
    const maxPayload = context?.maxPayloadBytes ?? DEFAULT_MAX_SIZE;
    const maxSkew = context?.maxClockSkewSeconds ?? DEFAULT_MAX_SKEW;
    const maxAge = context?.maxEventAgeSeconds ?? DEFAULT_MAX_AGE;
    const now = Math.floor(Date.now() / 1000);

    // Step 4 (checked early): Validate size limits
    if (rawBytes.length > maxPayload) {
      return {
        isValid: false,
        error: `Payload size (${rawBytes.length} bytes) exceeds maximum limit of ${maxPayload} bytes`,
        errorCode: 'ERR_SIZE_LIMIT_EXCEEDED',
        stepFailed: 4,
      };
    }

    // Step 1: Decode safely
    let parsed: any;
    try {
      const decodedStr = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
      parsed = JSON.parse(decodedStr);
    } catch (err) {
      return {
        isValid: false,
        error: 'Failed to decode JSON payload safely',
        errorCode: 'ERR_MALFORMED_JSON',
        stepFailed: 1,
      };
    }

    // Step 2: Validate schema
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.id !== 'string' ||
      typeof parsed.pubkey !== 'string' ||
      typeof parsed.createdAt !== 'number' ||
      typeof parsed.kind !== 'number' ||
      !Array.isArray(parsed.tags) ||
      parsed.content === undefined ||
      typeof parsed.sig !== 'string'
    ) {
      return {
        isValid: false,
        error: 'Event payload does not conform to required schema',
        errorCode: 'ERR_INVALID_SCHEMA',
        stepFailed: 2,
      };
    }

    const event = parsed as SovraEvent<unknown>;

    // Step 3: Validate protocol version / event kind
    if (event.kind < 0 || event.kind > 1000) {
      return {
        isValid: false,
        error: `Unsupported protocol event kind: ${event.kind}`,
        errorCode: 'ERR_UNSUPPORTED_EVENT_KIND',
        stepFailed: 3,
      };
    }

    // Step 5: Validate author identity (must be 32 bytes hex)
    if (event.pubkey.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(event.pubkey)) {
      return {
        isValid: false,
        error: 'Author public key must be 64-character hexadecimal (32 bytes)',
        errorCode: 'ERR_INVALID_AUTHOR_KEY',
        stepFailed: 5,
      };
    }

    // Step 6: Validate device delegation if present in tags
    let deviceDelegation: DeviceDelegation | undefined;
    for (const tag of event.tags) {
      if (tag[0] === 'delegation' && tag[1]) {
        try {
          deviceDelegation = JSON.parse(tag[1]) as DeviceDelegation;
          const isDelegationValid = verifyDeviceDelegation(deviceDelegation);
          if (!isDelegationValid) {
            return {
              isValid: false,
              error: 'Device delegation signature or validity check failed',
              errorCode: 'ERR_INVALID_DELEGATION',
              stepFailed: 6,
            };
          }
          if (deviceDelegation.devicePublicKeyHex !== event.pubkey) {
            return {
              isValid: false,
              error: 'Delegation device public key does not match event author key',
              errorCode: 'ERR_DELEGATION_KEY_MISMATCH',
              stepFailed: 6,
            };
          }
        } catch {
          return {
            isValid: false,
            error: 'Failed to parse device delegation tag',
            errorCode: 'ERR_DELEGATION_PARSE',
            stepFailed: 6,
          };
        }
      }
    }

    // Step 7: Verify signature
    try {
      const unsignedPayload: Record<string, unknown> = {
        pubkey: event.pubkey,
        createdAt: event.createdAt,
        kind: event.kind,
        tags: event.tags,
        content: event.content,
      };
      if (event.media !== undefined) {
        unsignedPayload.media = event.media;
      }
      const canonicalJson = serializeCanonicalJson(unsignedPayload);
      const computedHash = bytesToHex(sha256(new TextEncoder().encode(canonicalJson)));

      if (computedHash !== event.id) {
        return {
          isValid: false,
          error: `Event ID does not match SHA-256 hash of canonical payload (expected ${computedHash}, got ${event.id})`,
          errorCode: 'ERR_HASH_MISMATCH',
          stepFailed: 7,
        };
      }

      const authorPubBytes = hexToBytes(event.pubkey);
      const sigBytes = hexToBytes(event.sig);
      const isSigValid = verifyEd25519(authorPubBytes, hexToBytes(event.id), sigBytes);
      if (!isSigValid) {
        return {
          isValid: false,
          error: 'Ed25519 digital signature is invalid',
          errorCode: 'ERR_INVALID_SIGNATURE',
          stepFailed: 7,
        };
      }
    } catch (err) {
      return {
        isValid: false,
        error: `Signature verification threw an error: ${err instanceof Error ? err.message : String(err)}`,
        errorCode: 'ERR_SIGNATURE_VERIFICATION_FAILED',
        stepFailed: 7,
      };
    }

    // Step 8: Check revocation
    if (context?.revocationRegistry) {
      if (context.revocationRegistry.isKeyRevoked(event.pubkey)) {
        return {
          isValid: false,
          error: 'Author public key is revoked in registry',
          errorCode: 'ERR_AUTHOR_REVOKED',
          stepFailed: 8,
        };
      }
      if (
        deviceDelegation &&
        context.revocationRegistry.isKeyRevoked(deviceDelegation.devicePublicKeyHex)
      ) {
        return {
          isValid: false,
          error: 'Author device is revoked in registry',
          errorCode: 'ERR_DEVICE_REVOKED',
          stepFailed: 8,
        };
      }
    }

    // Step 9: Check timestamp / replay rules
    if (event.createdAt > now + maxSkew) {
      return {
        isValid: false,
        error: `Event timestamp (${event.createdAt}) is too far in future (current: ${now})`,
        errorCode: 'ERR_TIMESTAMP_FUTURE',
        stepFailed: 9,
      };
    }
    if (event.createdAt < now - maxAge) {
      return {
        isValid: false,
        error: `Event timestamp (${event.createdAt}) is expired / older than ${maxAge} seconds`,
        errorCode: 'ERR_TIMESTAMP_EXPIRED',
        stepFailed: 9,
      };
    }
    if (context?.seenEventIds && context.seenEventIds.has(event.id)) {
      return {
        isValid: false,
        error: `Replay attack detected: event ${event.id} already received`,
        errorCode: 'ERR_REPLAY_DETECTED',
        stepFailed: 9,
      };
    }

    // Step 10: Apply topic-specific policy
    if (context?.topic) {
      if (context.topic.startsWith('/sovra/user/') && !context.topic.includes(event.pubkey)) {
        return {
          isValid: false,
          error: `Event pubkey (${event.pubkey}) does not match topic pubkey (${context.topic})`,
          errorCode: 'ERR_TOPIC_POLICY_VIOLATION',
          stepFailed: 10,
        };
      }
    }

    return {
      isValid: true,
    };
  }
}
