import { verifyEd25519, hexToBytes, bytesToHex, secureRandomBytes } from '@sovra/crypto';
import { ValidationError } from '@sovra/shared';
import { SovraIdentityKey } from './keypair.js';
import { decodeEd25519DidKey } from './did.js';
import { KeyRole } from './keys.js';
import { canonicalizeToBytes } from './canonical.js';

export type RevocationReason = 'compromised' | 'device_lost' | 'routine_rotation' | 'superseded';

export interface UnsignedRevocationAssertion {
  readonly version: number;
  readonly targetDid: string;
  readonly revokedKeyHex: string;
  readonly revokedKeyRole: KeyRole;
  readonly reason: RevocationReason;
  readonly revocationSequence: number;
  readonly timestamp: number;
  readonly nonce: string;
}

export interface RevocationAssertion extends UnsignedRevocationAssertion {
  readonly signature: string;
}

/**
 * Creates a signed revocation assertion issued by the root Identity Key.
 */
export function createRevocationAssertion(
  identityKey: SovraIdentityKey,
  revokedKeyHex: string,
  revokedKeyRole: KeyRole,
  reason: RevocationReason,
  revocationSequence: number,
  nonce?: string,
): RevocationAssertion {
  if (revocationSequence <= 0) {
    throw new ValidationError('Revocation sequence must be a positive integer', {
      revocationSequence,
    });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const assertionNonce = nonce ?? bytesToHex(secureRandomBytes(16));

  const unsignedPayload: UnsignedRevocationAssertion = {
    version: 1,
    targetDid: identityKey.did,
    revokedKeyHex,
    revokedKeyRole,
    reason,
    revocationSequence,
    timestamp,
    nonce: assertionNonce,
  };

  const canonicalBytes = canonicalizeToBytes(unsignedPayload);
  const signatureHex = identityKey.signHex(canonicalBytes);

  return {
    ...unsignedPayload,
    signature: signatureHex,
  };
}

/**
 * Verifies a signed revocation assertion offline.
 */
export function verifyRevocationAssertion(assertion: RevocationAssertion): boolean {
  if (assertion.version !== 1) return false;
  if (assertion.revocationSequence <= 0) return false;

  try {
    const parentPublicKey = decodeEd25519DidKey(assertion.targetDid);
    const signatureBytes = hexToBytes(assertion.signature);

    const unsignedPayload: UnsignedRevocationAssertion = {
      version: assertion.version,
      targetDid: assertion.targetDid,
      revokedKeyHex: assertion.revokedKeyHex,
      revokedKeyRole: assertion.revokedKeyRole,
      reason: assertion.reason,
      revocationSequence: assertion.revocationSequence,
      timestamp: assertion.timestamp,
      nonce: assertion.nonce,
    };

    const canonicalBytes = canonicalizeToBytes(unsignedPayload);
    return verifyEd25519(parentPublicKey, canonicalBytes, signatureBytes);
  } catch {
    return false;
  }
}

/**
 * Local Peer Revocation Registry.
 * Maintains local cryptographic verification state of revoked keys per DID.
 * Zero reliance on central servers.
 */
export class RevocationRegistry {
  private readonly revokedKeys = new Set<string>();
  private readonly didMaxSequence = new Map<string, number>();

  public registerRevocation(assertion: RevocationAssertion): boolean {
    if (!verifyRevocationAssertion(assertion)) {
      return false;
    }

    const currentSeq = this.didMaxSequence.get(assertion.targetDid) ?? 0;
    if (assertion.revocationSequence < currentSeq) {
      // Replay of old sequence
      return false;
    }

    this.didMaxSequence.set(assertion.targetDid, assertion.revocationSequence);
    this.revokedKeys.add(assertion.revokedKeyHex.toLowerCase());
    return true;
  }

  public isKeyRevoked(keyHex: string): boolean {
    return this.revokedKeys.has(keyHex.toLowerCase());
  }

  public isRevoked(keyHex: string): boolean {
    return this.isKeyRevoked(keyHex);
  }

  public getLatestSequence(did: string): number {
    return this.didMaxSequence.get(did) ?? 0;
  }

  public clear(): void {
    this.revokedKeys.clear();
    this.didMaxSequence.clear();
  }
}
