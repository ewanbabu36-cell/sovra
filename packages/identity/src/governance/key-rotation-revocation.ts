/**
 * @file packages/identity/src/governance/key-rotation-revocation.ts
 * SOVRA Key Rotation & Emergency Revocation Engine.
 *
 * Enforces:
 * 1. Dual-signed key rotation assertions (proving possession of old and new keys).
 * 2. Instant blacklisting for compromised or superseded administrative and founder keys.
 * 3. O(1) revocation verification.
 */

import {
  verifyEd25519,
  hexToBytes,
  bytesToHex,
} from '@sovra/crypto';
import { ValidationError } from '@sovra/shared';

export interface DualSignedRotationRecord {
  readonly oldDid: string;
  readonly newDid: string;
  readonly oldPublicKeyHex: string;
  readonly newPublicKeyHex: string;
  readonly rotationSequence: number;
  readonly timestamp: number;
  readonly oldKeySignatureHex: string;
  readonly newKeySignatureHex: string;
}

export interface RevocationRecord {
  readonly targetDid: string;
  readonly targetKeyHex: string;
  readonly reason: 'COMPROMISED' | 'SUPERSEDED' | 'EMERGENCY_DECOMMISSION';
  readonly revokedByDid: string;
  readonly timestamp: number;
  readonly signatureHex: string;
}

export class KeyRotationRevocationEngine {
  private readonly rotations = new Map<string, DualSignedRotationRecord>(); // oldDid -> rotation
  private readonly blacklistedDIDs = new Set<string>();
  private readonly blacklistedKeys = new Set<string>();

  /**
   * Verifies and records a dual-signed key rotation.
   */
  public registerKeyRotation(params: {
    oldDid: string;
    newDid: string;
    oldPublicKeyBytes: Uint8Array;
    newPublicKeyBytes: Uint8Array;
    rotationSequence: number;
    oldKeySignatureHex: string;
    newKeySignatureHex: string;
    timestamp?: number;
  }): DualSignedRotationRecord {
    if (params.oldDid === params.newDid) {
      throw new ValidationError('New DID must be distinct from old DID in rotation');
    }

    if (this.blacklistedDIDs.has(params.oldDid)) {
      throw new ValidationError(`Old DID ${params.oldDid} is blacklisted and cannot be rotated`);
    }

    const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);
    const oldPubKeyHex = bytesToHex(params.oldPublicKeyBytes);
    const newPubKeyHex = bytesToHex(params.newPublicKeyBytes);

    const rotationPayload = `SOVRA_KEY_ROTATION:${params.oldDid}:${params.newDid}:${oldPubKeyHex}:${newPubKeyHex}:${params.rotationSequence}:${timestamp}`;
    const payloadBytes = Buffer.from(rotationPayload, 'utf8');

    // 1. Verify old key signature
    const oldSigBytes = hexToBytes(params.oldKeySignatureHex);
    if (!verifyEd25519(params.oldPublicKeyBytes, payloadBytes, oldSigBytes)) {
      throw new ValidationError('Old key signature verification failed for rotation assertion');
    }

    // 2. Verify new key signature
    const newSigBytes = hexToBytes(params.newKeySignatureHex);
    if (!verifyEd25519(params.newPublicKeyBytes, payloadBytes, newSigBytes)) {
      throw new ValidationError('New key signature verification failed for rotation assertion');
    }

    const record: DualSignedRotationRecord = {
      oldDid: params.oldDid,
      newDid: params.newDid,
      oldPublicKeyHex: oldPubKeyHex,
      newPublicKeyHex: newPubKeyHex,
      rotationSequence: params.rotationSequence,
      timestamp,
      oldKeySignatureHex: params.oldKeySignatureHex,
      newKeySignatureHex: params.newKeySignatureHex,
    };

    this.rotations.set(params.oldDid, record);
    // Mark old key as superseded
    this.blacklistedKeys.add(oldPubKeyHex);

    return record;
  }

  /**
   * Immediately revokes and blacklists a compromised key or DID.
   */
  public emergencyRevokeKey(params: {
    targetDid: string;
    targetKeyHex: string;
    reason: 'COMPROMISED' | 'SUPERSEDED' | 'EMERGENCY_DECOMMISSION';
    revokedByDid: string;
    authorizerPublicKeyBytes: Uint8Array;
    signatureHex: string;
    timestamp?: number;
  }): RevocationRecord {
    const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);
    const payload = `SOVRA_REVOCATION:${params.targetDid}:${params.targetKeyHex}:${params.reason}:${params.revokedByDid}:${timestamp}`;
    const payloadBytes = Buffer.from(payload, 'utf8');
    const sigBytes = hexToBytes(params.signatureHex);

    if (!verifyEd25519(params.authorizerPublicKeyBytes, payloadBytes, sigBytes)) {
      throw new ValidationError('Invalid signature on emergency key revocation');
    }

    this.blacklistedDIDs.add(params.targetDid);
    this.blacklistedKeys.add(params.targetKeyHex.toLowerCase());

    return {
      targetDid: params.targetDid,
      targetKeyHex: params.targetKeyHex,
      reason: params.reason,
      revokedByDid: params.revokedByDid,
      timestamp,
      signatureHex: params.signatureHex,
    };
  }

  public isRevoked(didOrKeyHex: string): boolean {
    return (
      this.blacklistedDIDs.has(didOrKeyHex) ||
      this.blacklistedKeys.has(didOrKeyHex.toLowerCase())
    );
  }
}
