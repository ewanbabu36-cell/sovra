import { Result } from '@sovra/shared';
import { VerificationKey } from '@sovra/crypto';
import { IdentityKey, DeviceKey } from './keys.js';

export interface PublicIdentity {
  readonly did: string;
  readonly primaryPublicKey: VerificationKey;
  readonly activeDevices: readonly DeviceKey[];
  readonly createdAt: number;
  readonly version: number;
}

export interface DeviceRegistrationRequest {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly devicePublicKey: VerificationKey;
  readonly validUntil: number;
}

export interface DeviceDelegationAssertion {
  readonly did: string;
  readonly deviceId: string;
  readonly devicePublicKeyHex: string;
  readonly validUntil: number;
  readonly parentSignature: Uint8Array;
}

export interface KeyRotationRequest {
  readonly oldPublicKeyHex: string;
  readonly newPublicKey: VerificationKey;
  readonly transitionProof: Uint8Array;
}

export interface KeyRevocationAssertion {
  readonly revokedKeyId: string;
  readonly reason: 'compromise' | 'device_lost' | 'routine_rotation';
  readonly timestamp: number;
  readonly signature: Uint8Array;
}

/**
 * Social / Threshold Recovery Strategy Interface.
 * Note: Centralized key escrow is strictly prohibited.
 * Recovery requires M-of-N cryptographic guardian threshold shares.
 */
export interface GuardianRecoveryShare {
  readonly guardianDid: string;
  readonly shareId: string;
  readonly encryptedShareBytes: Uint8Array;
}

export interface RecoveryPlan {
  readonly did: string;
  readonly requiredThreshold: number;
  readonly totalGuardians: number;
  readonly guardianDids: readonly string[];
}

export interface IdentityService {
  createIdentity(): Promise<Result<{ identityKey: IdentityKey; publicIdentity: PublicIdentity }>>;
  exportPublicIdentity(did: string): Promise<Result<PublicIdentity>>;
  signWithIdentity(did: string, payload: Uint8Array): Promise<Result<Uint8Array>>;
  verifyIdentitySignature(
    did: string,
    payload: Uint8Array,
    signature: Uint8Array,
  ): Promise<Result<boolean>>;
}

export interface DeviceManager {
  registerDevice(
    did: string,
    request: DeviceRegistrationRequest,
  ): Promise<Result<DeviceDelegationAssertion>>;
  verifyDeviceDelegation(assertion: DeviceDelegationAssertion): Promise<Result<boolean>>;
  revokeDevice(did: string, deviceId: string): Promise<Result<KeyRevocationAssertion>>;
  listActiveDevices(did: string): Promise<Result<readonly DeviceKey[]>>;
}

export interface KeyRotationManager {
  rotateIdentityKey(did: string, request: KeyRotationRequest): Promise<Result<PublicIdentity>>;
  revokeKey(assertion: KeyRevocationAssertion): Promise<Result<void>>;
}

export interface RecoveryManager {
  setupRecoveryPlan(did: string, plan: RecoveryPlan): Promise<Result<void>>;
  initiateThresholdRecovery(
    did: string,
    collectedShares: readonly GuardianRecoveryShare[],
  ): Promise<Result<{ recoveredPublicKey: VerificationKey }>>;
}
