/**
 * @file apps/sovra-app/src/hooks/useAccountLifecycle.ts
 * Client Hook: Zero-Password Biometric Onboarding, Quick Lock & Wipe Lifecycle.
 *
 * Implements:
 * 1. 3-Step TouchID/FaceID Passkey Onboarding (@handle -> Biometric -> Ready <5s).
 * 2. Session Quick-Lock (Soft Logout: RAM purge, biometrics required to restore).
 * 3. Complete Wipe & Logout (Hard Logout: irreversible key erasure & network revocation).
 * 4. Cross-Device QR Pairing Payload generator (<2s device sync).
 * 5. Social Guardian Recovery setup (M-of-N friend consensus).
 */

import {
  AccountLifecycleEngine,
  type UserAccountProfile,
  type AccountCreationResult,
  type QrPairingPayload,
  type GuardianConfig,
  type RecoveryPlan,
} from '@sovra/identity';
import type { Result } from '@sovra/shared';

export interface UseAccountLifecycleReturn {
  readonly profile: UserAccountProfile | null;
  readonly isLocked: boolean;
  readonly recoveryPlan: RecoveryPlan | null;
  createAccount(
    handle: string,
    displayName: string,
    platform?: 'android' | 'ios' | 'web',
  ): Promise<Result<AccountCreationResult>>;
  lockSession(): void;
  unlockWithBiometrics(credentialId?: string): Result<UserAccountProfile>;
  logoutAndWipeDevice(): Result<{ deviceRevoked: boolean }>;
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
    async createAccount(handle: string, displayName: string, platform = 'android') {
      return engine.createAccount(handle, displayName, platform);
    },
    lockSession() {
      engine.lockSession();
    },
    unlockWithBiometrics(credentialId?: string) {
      return engine.unlockWithBiometrics(credentialId);
    },
    logoutAndWipeDevice() {
      return engine.logoutAndWipeDevice();
    },
    generateQrPairingPayload(targetDevicePublicKeyHex: string, expiresInSeconds = 300) {
      return engine.generateQrPairingPayload(targetDevicePublicKeyHex, expiresInSeconds);
    },
    setupGuardianRecovery(config: GuardianConfig) {
      return engine.setupGuardianRecovery(config);
    },
  };
}
