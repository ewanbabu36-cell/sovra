import { verifyEd25519, hexToBytes, bytesToHex, secureRandomBytes } from '@sovra/crypto';
import { ValidationError } from '@sovra/shared';
import { SovraIdentityKey } from './keypair.js';
import { decodeEd25519DidKey } from './did.js';
import { canonicalizeToBytes } from './canonical.js';

export interface UnsignedKeyRotation {
  readonly version: number;
  readonly oldDid: string;
  readonly newDid: string;
  readonly oldPublicKeyHex: string;
  readonly newPublicKeyHex: string;
  readonly rotationSequence: number;
  readonly timestamp: number;
  readonly nonce: string;
}

export interface KeyRotationAssertion extends UnsignedKeyRotation {
  readonly oldKeySignature: string;
  readonly newKeySignature: string;
}

/**
 * Creates a dual-signed key rotation assertion.
 * Both old and new keys must sign to prove forward continuity and possession.
 */
export function createKeyRotationAssertion(
  oldIdentityKey: SovraIdentityKey,
  newIdentityKey: SovraIdentityKey,
  rotationSequence: number,
  nonce?: string,
): KeyRotationAssertion {
  if (oldIdentityKey.did === newIdentityKey.did) {
    throw new ValidationError('New identity key must be distinct from old identity key', {
      oldDid: oldIdentityKey.did,
      newDid: newIdentityKey.did,
    });
  }
  if (rotationSequence <= 0) {
    throw new ValidationError('Rotation sequence must be positive', { rotationSequence });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const rotationNonce = nonce ?? bytesToHex(secureRandomBytes(16));

  const unsignedPayload: UnsignedKeyRotation = {
    version: 1,
    oldDid: oldIdentityKey.did,
    newDid: newIdentityKey.did,
    oldPublicKeyHex: oldIdentityKey.publicKeyHex,
    newPublicKeyHex: newIdentityKey.publicKeyHex,
    rotationSequence,
    timestamp,
    nonce: rotationNonce,
  };

  const canonicalBytes = canonicalizeToBytes(unsignedPayload);
  const oldKeySignature = oldIdentityKey.signHex(canonicalBytes);
  const newKeySignature = newIdentityKey.signHex(canonicalBytes);

  return {
    ...unsignedPayload,
    oldKeySignature,
    newKeySignature,
  };
}

/**
 * Verifies a dual-signed key rotation assertion offline.
 */
export function verifyKeyRotationAssertion(assertion: KeyRotationAssertion): boolean {
  if (assertion.version !== 1) return false;
  if (assertion.oldDid === assertion.newDid) return false;
  if (assertion.rotationSequence <= 0) return false;

  try {
    const oldPublicKey = decodeEd25519DidKey(assertion.oldDid);
    const newPublicKey = decodeEd25519DidKey(assertion.newDid);

    const unsignedPayload: UnsignedKeyRotation = {
      version: assertion.version,
      oldDid: assertion.oldDid,
      newDid: assertion.newDid,
      oldPublicKeyHex: assertion.oldPublicKeyHex,
      newPublicKeyHex: assertion.newPublicKeyHex,
      rotationSequence: assertion.rotationSequence,
      timestamp: assertion.timestamp,
      nonce: assertion.nonce,
    };

    const canonicalBytes = canonicalizeToBytes(unsignedPayload);

    const oldSigValid = verifyEd25519(
      oldPublicKey,
      canonicalBytes,
      hexToBytes(assertion.oldKeySignature),
    );
    if (!oldSigValid) return false;

    const newSigValid = verifyEd25519(
      newPublicKey,
      canonicalBytes,
      hexToBytes(assertion.newKeySignature),
    );
    return newSigValid;
  } catch {
    return false;
  }
}

/**
 * Local Key Continuity Registry.
 * Tracks forward rotation chains (e.g. Key 1 -> Key 2 -> Key 3).
 * Rejects operations signed by superseded keys.
 */
export class RotationRegistry {
  private readonly supersededKeys = new Set<string>();
  private readonly rotationChain = new Map<string, string>(); // oldDid -> newDid

  public registerRotation(assertion: KeyRotationAssertion): boolean {
    if (!verifyKeyRotationAssertion(assertion)) {
      return false;
    }

    this.supersededKeys.add(assertion.oldDid);
    this.supersededKeys.add(assertion.oldPublicKeyHex.toLowerCase());
    this.rotationChain.set(assertion.oldDid, assertion.newDid);
    return true;
  }

  public isKeySuperseded(didOrKeyHex: string): boolean {
    return (
      this.supersededKeys.has(didOrKeyHex) || this.supersededKeys.has(didOrKeyHex.toLowerCase())
    );
  }

  public resolveCurrentDid(did: string): string {
    let current = did;
    while (this.rotationChain.has(current)) {
      current = this.rotationChain.get(current)!;
    }
    return current;
  }
}
