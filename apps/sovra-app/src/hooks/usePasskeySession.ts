/**
 * @file apps/sovra-app/src/hooks/usePasskeySession.ts
 * Client Hook: Consumer-Grade Biometric WebAuthn Passkeys & Hardware TouchID/FaceID Auto-Unlock.
 *
 * Implements:
 * 1. Hardware Secure Enclave (TouchID/FaceID/Android Titan) passkey registration.
 * 2. 1-Tap biometric session unlock (zero 24-word seed phrase friction).
 * 3. Cryptographic challenge assertion verification.
 */

import {
  PasskeyManager,
  type WebAuthnPasskeyCredential,
  type PasskeyAssertionProof,
  type PasskeyAttestationFormat,
} from '@sovra/identity';

export interface UsePasskeySessionReturn {
  readonly isUnlocked: boolean;
  readonly activeCredential: WebAuthnPasskeyCredential | null;
  registerPasskey(userDid: string, devicePublicKey: Uint8Array | string, format?: PasskeyAttestationFormat): WebAuthnPasskeyCredential;
  verifyAssertion(proof: PasskeyAssertionProof): boolean;
  unlockSession(): void;
  lockSession(): void;
}

export function createPasskeySessionManager(): UsePasskeySessionReturn {
  const manager = new PasskeyManager();
  let isUnlocked = false;
  let activeCred: WebAuthnPasskeyCredential | null = null;

  return {
    get isUnlocked() {
      return isUnlocked;
    },
    get activeCredential() {
      return activeCred;
    },
    registerPasskey(userDid: string, devicePublicKey: Uint8Array | string, format: PasskeyAttestationFormat = 'apple-secure-enclave') {
      const cred = manager.registerPasskey(userDid, devicePublicKey, format);
      activeCred = cred;
      isUnlocked = true;
      return cred;
    },
    verifyAssertion(proof: PasskeyAssertionProof, expectedChallengeHex?: string) {
      const verified = manager.verifyPasskeyAssertion(proof, expectedChallengeHex ?? '');
      if (verified) {
        isUnlocked = true;
      }
      return verified;
    },
    unlockSession() {
      isUnlocked = true;
    },
    lockSession() {
      isUnlocked = false;
    },
  };
}
