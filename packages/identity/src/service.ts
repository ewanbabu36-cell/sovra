import { Result, ok, err, ValidationError } from '@sovra/shared';
import { SovraIdentityKey, SovraDeviceKey } from './keypair.js';
import { PublicIdentity, buildPublicIdentity } from './model.js';
import {
  DeviceDelegationAssertion,
  createDeviceDelegation,
  verifyDeviceSignedAction,
} from './delegation.js';
import {
  RevocationAssertion,
  RevocationReason,
  createRevocationAssertion,
  RevocationRegistry,
} from './revocation.js';
import { KeyRotationAssertion, createKeyRotationAssertion, RotationRegistry } from './rotation.js';
import {
  RecoveryPlan,
  createRecoveryPlan,
  GuardianAuthorization,
  ThresholdRecoveryProof,
  createThresholdRecoveryProof,
  RecoveryCancellation,
  createRecoveryCancellation,
  verifyThresholdRecoveryProof,
  RecoveryVerificationResult,
} from './recovery.js';
import { KeyRole } from './keys.js';

export interface CreateIdentityOptions {
  readonly guardianDids?: readonly string[];
  readonly threshold?: number;
  readonly timelockSeconds?: number;
}

export class DecentralizedIdentityService {
  private readonly revocationRegistry = new RevocationRegistry();
  private readonly rotationRegistry = new RotationRegistry();
  private readonly cancelledNonces = new Set<string>();

  /**
   * Generates a brand-new decentralized identity offline.
   * Zero central server communication required.
   */
  public async createIdentity(
    options?: CreateIdentityOptions,
  ): Promise<Result<{ identityKey: SovraIdentityKey; publicIdentity: PublicIdentity }>> {
    const identityKey = SovraIdentityKey.generate();

    let recoveryPlan: RecoveryPlan | undefined;
    if (options?.guardianDids && options.guardianDids.length > 0) {
      const threshold = options.threshold ?? Math.ceil((options.guardianDids.length * 3) / 5);
      recoveryPlan = createRecoveryPlan(
        identityKey,
        threshold,
        options.guardianDids,
        options.timelockSeconds ?? 259200,
        1,
      );
    }

    const publicIdentity = buildPublicIdentity(
      identityKey.did,
      identityKey.publicKeyHex,
      identityKey.createdAt,
      [],
      recoveryPlan,
    );

    return ok({ identityKey, publicIdentity });
  }

  /**
   * Authorizes a physical device on behalf of an identity.
   */
  public authorizeDevice(
    identityKey: SovraIdentityKey,
    deviceId: string,
    deviceName: string,
    validUntilSeconds: number,
  ): Result<{ deviceKey: SovraDeviceKey; delegation: DeviceDelegationAssertion }> {
    const deviceKey = SovraDeviceKey.generate(
      deviceId,
      deviceName,
      identityKey.did,
      validUntilSeconds,
    );
    const delegation = createDeviceDelegation(identityKey, deviceKey, validUntilSeconds);

    return ok({ deviceKey, delegation });
  }

  /**
   * Verifies an action signed by a delegated device offline.
   */
  public verifyDeviceAction(
    parentDid: string,
    delegation: DeviceDelegationAssertion,
    payloadBytes: Uint8Array,
    deviceSignatureHex: string,
  ): boolean {
    return verifyDeviceSignedAction(
      parentDid,
      delegation,
      payloadBytes,
      deviceSignatureHex,
      keyHex => this.revocationRegistry.isKeyRevoked(keyHex),
    );
  }

  /**
   * Revokes a compromised or decommissioned key/device.
   */
  public revokeKey(
    identityKey: SovraIdentityKey,
    revokedKeyHex: string,
    role: KeyRole,
    reason: RevocationReason,
    sequence: number,
  ): Result<RevocationAssertion> {
    const assertion = createRevocationAssertion(identityKey, revokedKeyHex, role, reason, sequence);
    const registered = this.revocationRegistry.registerRevocation(assertion);
    if (!registered) {
      return err(new ValidationError('Failed to register revocation assertion'));
    }
    return ok(assertion);
  }

  public isKeyRevoked(keyHex: string): boolean {
    return this.revocationRegistry.isKeyRevoked(keyHex);
  }

  /**
   * Rotates an identity key forward with dual-signed continuity proof.
   */
  public rotateIdentity(
    oldIdentityKey: SovraIdentityKey,
    newIdentityKey: SovraIdentityKey,
    sequence: number,
  ): Result<KeyRotationAssertion> {
    const assertion = createKeyRotationAssertion(oldIdentityKey, newIdentityKey, sequence);
    const registered = this.rotationRegistry.registerRotation(assertion);
    if (!registered) {
      return err(new ValidationError('Failed to register key rotation continuity proof'));
    }
    return ok(assertion);
  }

  public resolveCurrentDid(did: string): string {
    return this.rotationRegistry.resolveCurrentDid(did);
  }

  /**
   * Assembles and verifies an M-of-N threshold recovery proof.
   */
  public executeThresholdRecovery(
    newIdentityKey: SovraIdentityKey,
    targetDid: string,
    nonce: string,
    authorizations: readonly GuardianAuthorization[],
    plan: RecoveryPlan,
  ): Result<RecoveryVerificationResult> {
    const proof: ThresholdRecoveryProof = createThresholdRecoveryProof(
      newIdentityKey,
      targetDid,
      nonce,
      authorizations,
    );

    return verifyThresholdRecoveryProof(proof, plan, Math.floor(Date.now() / 1000), n =>
      this.cancelledNonces.has(n),
    );
  }

  /**
   * Legitimate owner vetoes a fraudulent or accidental recovery attempt.
   */
  public cancelRecovery(
    originalIdentityKey: SovraIdentityKey,
    proofNonce: string,
    reason?: string,
  ): Result<RecoveryCancellation> {
    const cancellation = createRecoveryCancellation(originalIdentityKey, proofNonce, reason);
    this.cancelledNonces.add(proofNonce);
    return ok(cancellation);
  }
}
