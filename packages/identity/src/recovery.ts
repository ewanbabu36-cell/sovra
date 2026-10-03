import { verifyEd25519, hexToBytes, bytesToHex } from '@sovra/crypto';
import { Result, ok, err, ValidationError } from '@sovra/shared';
import { SovraIdentityKey } from './keypair.js';
import { decodeEd25519DidKey, encodeEd25519DidKey } from './did.js';
import { canonicalizeToBytes } from './canonical.js';

/**
 * 1. Recovery Plan Declaration
 * Established by the legitimate identity owner.
 * Declares the threshold, guardian DIDs, and timelock window.
 */
export interface UnsignedRecoveryPlan {
  readonly version: number;
  readonly targetDid: string;
  readonly requiredThreshold: number; // M
  readonly totalGuardians: number; // N
  readonly guardianDids: readonly string[];
  readonly timelockSeconds: number; // E.g. 259200 (72 hours)
  readonly planSequence: number;
  readonly timestamp: number;
}

export interface RecoveryPlan extends UnsignedRecoveryPlan {
  readonly signature: string;
}

export function createRecoveryPlan(
  identityKey: SovraIdentityKey,
  requiredThreshold: number,
  guardianDids: readonly string[],
  timelockSeconds = 259200,
  planSequence = 1,
): RecoveryPlan {
  if (requiredThreshold <= 0 || requiredThreshold > guardianDids.length) {
    throw new ValidationError(
      `Threshold must be between 1 and total guardians (${guardianDids.length})`,
      {
        requiredThreshold,
        totalGuardians: guardianDids.length,
      },
    );
  }

  // Ensure guardians are unique and don't include the target itself
  const uniqueGuardians = new Set(guardianDids);
  if (uniqueGuardians.size !== guardianDids.length) {
    throw new ValidationError('Guardian DIDs must be unique');
  }
  if (uniqueGuardians.has(identityKey.did)) {
    throw new ValidationError('Identity cannot name itself as its own recovery guardian');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const unsignedPayload: UnsignedRecoveryPlan = {
    version: 1,
    targetDid: identityKey.did,
    requiredThreshold,
    totalGuardians: guardianDids.length,
    guardianDids: [...guardianDids].sort(),
    timelockSeconds,
    planSequence,
    timestamp,
  };

  const canonicalBytes = canonicalizeToBytes(unsignedPayload);
  const signature = identityKey.signHex(canonicalBytes);

  return {
    ...unsignedPayload,
    signature,
  };
}

export function verifyRecoveryPlan(plan: RecoveryPlan): boolean {
  if (plan.version !== 1) return false;
  if (plan.requiredThreshold <= 0 || plan.requiredThreshold > plan.guardianDids.length)
    return false;

  try {
    const targetPublicKey = decodeEd25519DidKey(plan.targetDid);
    const signatureBytes = hexToBytes(plan.signature);

    const unsignedPayload: UnsignedRecoveryPlan = {
      version: plan.version,
      targetDid: plan.targetDid,
      requiredThreshold: plan.requiredThreshold,
      totalGuardians: plan.totalGuardians,
      guardianDids: plan.guardianDids,
      timelockSeconds: plan.timelockSeconds,
      planSequence: plan.planSequence,
      timestamp: plan.timestamp,
    };

    const canonicalBytes = canonicalizeToBytes(unsignedPayload);
    return verifyEd25519(targetPublicKey, canonicalBytes, signatureBytes);
  } catch {
    return false;
  }
}

/**
 * 2. Guardian Authorization Token
 * Signed by an individual guardian after out-of-band verification.
 * Does NOT contain or expose any private keys.
 */
export interface UnsignedGuardianAuthorization {
  readonly version: number;
  readonly targetDid: string;
  readonly newPublicKeyHex: string;
  readonly newDid: string;
  readonly guardianDid: string;
  readonly nonce: string;
  readonly timestamp: number;
  readonly validUntil: number;
}

export interface GuardianAuthorization extends UnsignedGuardianAuthorization {
  readonly guardianSignature: string;
}

export function createGuardianAuthorization(
  guardianKey: SovraIdentityKey,
  targetDid: string,
  newPublicKeyBytes: Uint8Array,
  nonce: string,
  validUntilSeconds: number,
): GuardianAuthorization {
  const timestamp = Math.floor(Date.now() / 1000);
  const newPublicKeyHex = bytesToHex(newPublicKeyBytes);
  const newDid = encodeEd25519DidKey(newPublicKeyBytes);

  const unsignedPayload: UnsignedGuardianAuthorization = {
    version: 1,
    targetDid,
    newPublicKeyHex,
    newDid,
    guardianDid: guardianKey.did,
    nonce,
    timestamp,
    validUntil: validUntilSeconds,
  };

  const canonicalBytes = canonicalizeToBytes(unsignedPayload);
  const guardianSignature = guardianKey.signHex(canonicalBytes);

  return {
    ...unsignedPayload,
    guardianSignature,
  };
}

export function verifyGuardianAuthorization(
  auth: GuardianAuthorization,
  plan: RecoveryPlan,
  currentTimestampSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (auth.version !== 1) return false;
  if (auth.targetDid !== plan.targetDid) return false;
  if (!plan.guardianDids.includes(auth.guardianDid)) return false;
  if (currentTimestampSeconds > auth.validUntil) return false;

  try {
    const guardianPublicKey = decodeEd25519DidKey(auth.guardianDid);
    const signatureBytes = hexToBytes(auth.guardianSignature);

    const unsignedPayload: UnsignedGuardianAuthorization = {
      version: auth.version,
      targetDid: auth.targetDid,
      newPublicKeyHex: auth.newPublicKeyHex,
      newDid: auth.newDid,
      guardianDid: auth.guardianDid,
      nonce: auth.nonce,
      timestamp: auth.timestamp,
      validUntil: auth.validUntil,
    };

    const canonicalBytes = canonicalizeToBytes(unsignedPayload);
    return verifyEd25519(guardianPublicKey, canonicalBytes, signatureBytes);
  } catch {
    return false;
  }
}

/**
 * 3. Threshold Recovery Proof
 * Assembled with M distinct guardian authorizations and co-signed by new identity key.
 */
export interface UnsignedThresholdRecoveryProof {
  readonly version: number;
  readonly targetDid: string;
  readonly newPublicKeyHex: string;
  readonly newDid: string;
  readonly nonce: string;
  readonly authorizations: readonly GuardianAuthorization[];
  readonly claimTimestamp: number;
}

export interface ThresholdRecoveryProof extends UnsignedThresholdRecoveryProof {
  readonly newKeySignature: string;
}

export function createThresholdRecoveryProof(
  newIdentityKey: SovraIdentityKey,
  targetDid: string,
  nonce: string,
  authorizations: readonly GuardianAuthorization[],
): ThresholdRecoveryProof {
  const claimTimestamp = Math.floor(Date.now() / 1000);

  const unsignedPayload: UnsignedThresholdRecoveryProof = {
    version: 1,
    targetDid,
    newPublicKeyHex: newIdentityKey.publicKeyHex,
    newDid: newIdentityKey.did,
    nonce,
    authorizations,
    claimTimestamp,
  };

  const canonicalBytes = canonicalizeToBytes(unsignedPayload);
  const newKeySignature = newIdentityKey.signHex(canonicalBytes);

  return {
    ...unsignedPayload,
    newKeySignature,
  };
}

/**
 * 4. Recovery Cancellation (Owner Veto)
 * Signed by the legitimate original identity key during the challenge window.
 */
export interface UnsignedRecoveryCancellation {
  readonly version: number;
  readonly targetDid: string;
  readonly cancelledProofNonce: string;
  readonly timestamp: number;
  readonly reason: string;
}

export interface RecoveryCancellation extends UnsignedRecoveryCancellation {
  readonly signature: string;
}

export function createRecoveryCancellation(
  originalIdentityKey: SovraIdentityKey,
  cancelledProofNonce: string,
  reason = 'unauthorized_takeover_attempt',
): RecoveryCancellation {
  const timestamp = Math.floor(Date.now() / 1000);
  const unsignedPayload: UnsignedRecoveryCancellation = {
    version: 1,
    targetDid: originalIdentityKey.did,
    cancelledProofNonce,
    timestamp,
    reason,
  };

  const canonicalBytes = canonicalizeToBytes(unsignedPayload);
  const signature = originalIdentityKey.signHex(canonicalBytes);

  return {
    ...unsignedPayload,
    signature,
  };
}

export function verifyRecoveryCancellation(cancellation: RecoveryCancellation): boolean {
  if (cancellation.version !== 1) return false;

  try {
    const originalPublicKey = decodeEd25519DidKey(cancellation.targetDid);
    const signatureBytes = hexToBytes(cancellation.signature);

    const unsignedPayload: UnsignedRecoveryCancellation = {
      version: cancellation.version,
      targetDid: cancellation.targetDid,
      cancelledProofNonce: cancellation.cancelledProofNonce,
      timestamp: cancellation.timestamp,
      reason: cancellation.reason,
    };

    const canonicalBytes = canonicalizeToBytes(unsignedPayload);
    return verifyEd25519(originalPublicKey, canonicalBytes, signatureBytes);
  } catch {
    return false;
  }
}

/**
 * Comprehensive Verifier for Threshold Recovery Proofs.
 */
export interface RecoveryVerificationResult {
  readonly isQuorumSatisfied: boolean;
  readonly validGuardianCount: number;
  readonly isTimelockActive: boolean;
  readonly canActivateAt: number;
}

export function verifyThresholdRecoveryProof(
  proof: ThresholdRecoveryProof,
  plan: RecoveryPlan,
  currentTimestampSeconds = Math.floor(Date.now() / 1000),
  isNonceCancelled?: (nonce: string) => boolean,
): Result<RecoveryVerificationResult> {
  // 1. Verify Plan Integrity
  if (!verifyRecoveryPlan(plan)) {
    return err(new ValidationError('Recovery plan signature is invalid'));
  }

  // 2. Target DIDs must match
  if (proof.targetDid !== plan.targetDid) {
    return err(new ValidationError('Recovery proof target DID does not match plan target DID'));
  }

  // 3. Check if owner cancelled this recovery session
  if (isNonceCancelled && isNonceCancelled(proof.nonce)) {
    return err(
      new ValidationError(
        'Recovery proof was explicitly cancelled by the legitimate identity owner',
      ),
    );
  }

  // 4. Verify candidate new key signature
  try {
    const newPublicKey = hexToBytes(proof.newPublicKeyHex);
    const unsignedPayload: UnsignedThresholdRecoveryProof = {
      version: proof.version,
      targetDid: proof.targetDid,
      newPublicKeyHex: proof.newPublicKeyHex,
      newDid: proof.newDid,
      nonce: proof.nonce,
      authorizations: proof.authorizations,
      claimTimestamp: proof.claimTimestamp,
    };
    const canonicalBytes = canonicalizeToBytes(unsignedPayload);
    const newKeySigValid = verifyEd25519(
      newPublicKey,
      canonicalBytes,
      hexToBytes(proof.newKeySignature),
    );
    if (!newKeySigValid) {
      return err(new ValidationError('Candidate new key acceptance signature is invalid'));
    }
  } catch (e) {
    return err(new ValidationError('Failed to verify new key signature'));
  }

  // 5. Verify individual guardian authorizations and count unique valid signers
  const seenGuardians = new Set<string>();
  let validGuardianCount = 0;

  for (const auth of proof.authorizations) {
    // Nonce must match proof session
    if (auth.nonce !== proof.nonce) continue;
    // New public key must match proof candidate
    if (auth.newPublicKeyHex.toLowerCase() !== proof.newPublicKeyHex.toLowerCase()) continue;
    // Must be a unique guardian from the plan
    if (seenGuardians.has(auth.guardianDid)) continue;

    if (verifyGuardianAuthorization(auth, plan, currentTimestampSeconds)) {
      seenGuardians.add(auth.guardianDid);
      validGuardianCount++;
    }
  }

  if (validGuardianCount < plan.requiredThreshold) {
    return err(
      new ValidationError(
        `Insufficient guardian quorum: required ${plan.requiredThreshold}, valid ${validGuardianCount}`,
        { required: plan.requiredThreshold, valid: validGuardianCount },
      ),
    );
  }

  const canActivateAt = proof.claimTimestamp + plan.timelockSeconds;
  const isTimelockActive = currentTimestampSeconds < canActivateAt;

  return ok({
    isQuorumSatisfied: true,
    validGuardianCount,
    isTimelockActive,
    canActivateAt,
  });
}
