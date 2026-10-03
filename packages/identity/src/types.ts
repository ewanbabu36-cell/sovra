import { Result } from '@sovra/shared';
import { VerificationKey } from '@sovra/crypto';
import { IdentityKey, DeviceKey } from './keys.js';
import { PublicIdentity } from './model.js';
import { DeviceDelegationAssertion } from './delegation.js';
import { RecoveryPlan } from './recovery.js';

export type { PublicIdentity } from './model.js';
export type { DeviceDelegationAssertion } from './delegation.js';
export type { RecoveryPlan } from './recovery.js';

export interface DeviceRegistrationRequest {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly devicePublicKey: VerificationKey;
  readonly validUntil: number;
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

export interface GuardianRecoveryShare {
  readonly guardianDid: string;
  readonly shareId: string;
  readonly encryptedShareBytes: Uint8Array;
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
