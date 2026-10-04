/**
 * @file apps/sovra-app/src/hooks/useAccountLifecycle.ts
 * Client Hook: Zero-Password Biometric Onboarding, Quick Lock, Remote Logout & Wipe Lifecycle.
 *
 * Implements:
 * 1. 3-Step TouchID/FaceID Passkey Onboarding (@handle -> Biometric -> Ready <5s).
 * 2. Session Quick-Lock (Soft Logout: RAM purge, biometrics required to restore).
 * 3. Complete Wipe & Logout (Hard Logout: irreversible key erasure & network revocation).
 * 4. Remote Logout & Revocation (1-Click remote wipe of lost/stolen phone from secondary device).
 * 5. Inbound Network Revocation Handler (Emergency auto-wipe if current device was revoked).
 * 6. Cross-Device QR Pairing Payload generator (<2s device sync).
 * 7. Social Guardian Recovery setup (M-of-N friend consensus).
 */

import {
  AccountLifecycleEngine,
  type UserAccountProfile,
  type AccountCreationResult,
  type QrPairingPayload,
  type GuardianConfig,
  type RecoveryPlan,
  type AuthorizedDevice,
  type RemoteRevocationOutcome,
  type RevocationAssertion,
  type RevocationReason,
} from '@sovra/identity';
import type { Result } from '@sovra/shared';

export interface UseAccountLifecycleReturn {
  readonly profile: UserAccountProfile | null;
  readonly isLocked: boolean;
  readonly recoveryPlan: RecoveryPlan | null;
  readonly authorizedDevices: readonly AuthorizedDevice[];
  createAccount(
    handle: string,
    displayName: string,
    platform?: 'android' | 'ios' | 'web',
  ): Promise<Result<AccountCreationResult>>;
  lockSession(): void;
  unlockWithBiometrics(credentialId?: string): Result<UserAccountProfile>;
  restoreAccountWithBiometrics(credentialId?: string): Result<UserAccountProfile>;
  logoutAndWipeDevice(): Result<{ deviceRevoked: boolean }>;
  listAuthorizedDevices(): readonly AuthorizedDevice[];
  registerAuthorizedDevice(device: AuthorizedDevice): Result<void>;
  remoteRevokeDevice(
    targetPublicKeyHex: string,
    reason?: RevocationReason,
  ): Result<RevocationAssertion>;
  processIncomingRevocation(assertion: RevocationAssertion): Result<RemoteRevocationOutcome>;
  generateQrPairingPayload(
    targetDevicePublicKeyHex: string,
    expiresInSeconds?: number,
  ): Result<QrPairingPayload>;
  setupGuardianRecovery(config: GuardianConfig): Result<RecoveryPlan>;
}

export function createAccountLifecycleManager(): UseAccountLifecycleReturn {
  const engine = new AccountLifecycleEngine();

  return {
    get profile() {
      return engine.profile;
    },
    get isLocked() {
      return engine.isLocked;
    },
    get recoveryPlan() {
      return engine.recoveryPlan;
    },
    get authorizedDevices() {
      return engine.listAuthorizedDevices();
    },
    async createAccount(handle: string, displayName: string, platform = 'android') {
      return engine.createAccount(handle, displayName, platform);
    },
    lockSession() {
      engine.lockSession();
    },
    unlockWithBiometrics(credentialId?: string) {
      return engine.unlockWithBiometrics(credentialId);
    },
    restoreAccountWithBiometrics(credentialId?: string) {
      return engine.restoreAccountWithBiometrics(credentialId);
    },
    logoutAndWipeDevice() {
      return engine.logoutAndWipeDevice();
    },
    listAuthorizedDevices() {
      return engine.listAuthorizedDevices();
    },
    registerAuthorizedDevice(device: AuthorizedDevice) {
      return engine.registerAuthorizedDevice(device);
    },
    remoteRevokeDevice(targetPublicKeyHex: string, reason: RevocationReason = 'device_lost') {
      return engine.remoteRevokeDevice(targetPublicKeyHex, reason);
    },
    processIncomingRevocation(assertion: RevocationAssertion) {
      return engine.processIncomingRevocation(assertion);
    },
    generateQrPairingPayload(targetDevicePublicKeyHex: string, expiresInSeconds = 300) {
      return engine.generateQrPairingPayload(targetDevicePublicKeyHex, expiresInSeconds);
    },
    setupGuardianRecovery(config: GuardianConfig) {
      return engine.setupGuardianRecovery(config);
    },
  };
}
