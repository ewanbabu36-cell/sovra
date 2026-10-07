import {
  sha256,
  encryptChaCha20Poly1305,
  decryptChaCha20Poly1305,
  secureRandomBytes,
  bytesToHex,
  hexToBytes,
  verifyEd25519,
} from '@sovra/crypto';
import { ValidationError } from '@sovra/shared';

export type PasskeyAttestationFormat =
  | 'apple-secure-enclave'
  | 'android-titan'
  | 'webauthn-fido2';

export interface WebAuthnPasskeyCredential {
  readonly credentialId: string;
  readonly devicePublicKeyHex: string;
  readonly attestationFormat: PasskeyAttestationFormat;
  readonly userHandleDid: string;
  readonly createdAt: number;
  signCounter: number;
}

export interface PasskeyAssertionProof {
  readonly credentialId: string;
  readonly clientDataJson: string;
  readonly authenticatorDataHex: string;
  readonly signatureHex: string;
  readonly newSignCounter: number;
}

export interface EncryptedCloudVault {
  readonly vaultCiphertextHex: string;
  readonly nonceHex: string;
  readonly saltHex: string;
  readonly formatVersion: 1;
}

/**
 * Consumer-Grade Hardware Passkey & Zero-Knowledge Vault Manager.
 * Implements Identity Ergonomics Gap 8:
 * 1. Hardware Secure Enclave (FaceID / TouchID / Android Titan) passkey registration.
 * 2. Zero 24-word seed phrase barrier: users authenticate seamlessly with biometrics.
 * 3. Zero-Knowledge Cloud Backup Vault: allows instant 1-tap restore across device resets.
 */
export class PasskeyManager {
  private readonly credentials = new Map<string, WebAuthnPasskeyCredential>();

  /**
   * Registers a hardware biometric credential bound to a user DID.
   */
  public registerPasskey(
    userHandleDid: string,
    devicePublicKey: Uint8Array | string,
    attestationFormat: PasskeyAttestationFormat = 'apple-secure-enclave',
    customCredentialId?: string,
  ): WebAuthnPasskeyCredential {
    const pubHex = typeof devicePublicKey === 'string' ? devicePublicKey : bytesToHex(devicePublicKey);
    const credId = customCredentialId ?? `cred_${bytesToHex(secureRandomBytes(16))}`;

    const credential: WebAuthnPasskeyCredential = {
      credentialId: credId,
      devicePublicKeyHex: pubHex,
      attestationFormat,
      userHandleDid,
      createdAt: Math.floor(Date.now() / 1000),
      signCounter: 0,
    };

    this.credentials.set(credId, credential);
    return credential;
  }

  public getCredential(credentialId: string): WebAuthnPasskeyCredential | undefined {
    return this.credentials.get(credentialId);
  }

  public listCredentials(): readonly WebAuthnPasskeyCredential[] {
    return Array.from(this.credentials.values());
  }

  public findCredentialByDid(userHandleDid: string): WebAuthnPasskeyCredential | undefined {
    return Array.from(this.credentials.values()).find((c) => c.userHandleDid === userHandleDid);
  }

  /**
   * Verifies hardware biometric assertion proof and increments monotonic replay counter.
   */
  public verifyPasskeyAssertion(
    proof: PasskeyAssertionProof,
    expectedChallengeHex = '',
  ): boolean {
    const cred = this.credentials.get(proof.credentialId);
    if (!cred) return false;

    // 1. Monotonic replay prevention
    if (proof.newSignCounter <= cred.signCounter) {
      return false; // Replay attack detected
    }

    // 2. Challenge presence check
    if (expectedChallengeHex && !proof.clientDataJson.includes(expectedChallengeHex)) {
      return false;
    }

    // 3. Cryptographic signature verification over (authData + sha256(clientDataJSON))
    try {
      const clientHash = sha256(new TextEncoder().encode(proof.clientDataJson));
      const authData = hexToBytes(proof.authenticatorDataHex);
      const signedPayload = new Uint8Array(authData.length + clientHash.length);
      signedPayload.set(authData, 0);
      signedPayload.set(clientHash, authData.length);

      const pubKey = hexToBytes(cred.devicePublicKeyHex);
      const sig = hexToBytes(proof.signatureHex);

      const isValid = verifyEd25519(pubKey, signedPayload, sig);
      if (isValid) {
        cred.signCounter = proof.newSignCounter;
      }
      return isValid;
    } catch {
      return false;
    }
  }

  /**
   * Creates a Zero-Knowledge Cloud Backup Vault encrypting the raw identity key
   * using a key derived from the user's biometric entropy.
   */
  public createEncryptedVault(
    privateKeyBytes: Uint8Array,
    passkeyDerivedSecret: Uint8Array,
  ): EncryptedCloudVault {
    if (passkeyDerivedSecret.length !== 32) {
      throw new ValidationError('Passkey derived secret must be exactly 32 bytes');
    }

    const salt = secureRandomBytes(16);
    const nonce = secureRandomBytes(12);

    // KDF: derive wrapping key via sha256(secret + salt)
    const kdfInput = new Uint8Array(passkeyDerivedSecret.length + salt.length);
    kdfInput.set(passkeyDerivedSecret, 0);
    kdfInput.set(salt, passkeyDerivedSecret.length);
    const wrappingKey = sha256(kdfInput);

    const ciphertext = encryptChaCha20Poly1305(wrappingKey, nonce, privateKeyBytes);

    return {
      vaultCiphertextHex: bytesToHex(ciphertext),
      nonceHex: bytesToHex(nonce),
      saltHex: bytesToHex(salt),
      formatVersion: 1,
    };
  }

  /**
   * Restores identity key from Zero-Knowledge Cloud Backup Vault upon biometric unlock.
   */
  public restoreFromEncryptedVault(
    vault: EncryptedCloudVault,
    passkeyDerivedSecret: Uint8Array,
  ): Uint8Array {
    const salt = hexToBytes(vault.saltHex);
    const nonce = hexToBytes(vault.nonceHex);
    const ciphertext = hexToBytes(vault.vaultCiphertextHex);

    const kdfInput = new Uint8Array(passkeyDerivedSecret.length + salt.length);
    kdfInput.set(passkeyDerivedSecret, 0);
    kdfInput.set(salt, passkeyDerivedSecret.length);
    const wrappingKey = sha256(kdfInput);

    return decryptChaCha20Poly1305(wrappingKey, nonce, ciphertext);
  }
}

// GF(256) tables for polynomial secret sharing (Reed-Solomon field with 0x11d)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_EXP[i + 255] = x;
    GF_LOG[x] = i;
    const hi = x & 128;
    x = ((x << 1) & 0xff) ^ (hi ? 0x1d : 0);
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a]! + GF_LOG[b]!) % 255]!;
}

function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error('GF(256) division by zero');
  if (a === 0) return 0;
  return GF_EXP[(GF_LOG[a]! - GF_LOG[b]! + 255) % 255]!;
}

export interface ShamirShard {
  readonly shardIndex: number; // 1 to 255 (x coordinate)
  readonly shardDataHex: string; // y coordinates
}

/**
 * Pillar 8: Cross-Platform Shamir Secret Sharding Vault.
 * Splits private keys into k-of-n shards (e.g. 2-of-3: Cloud Vault, Secondary Device, Social Guardians).
 * Any k shards can reconstruct the key, overcoming cross-platform Apple/Google password manager isolation.
 */
export class ShamirSecretVault {
  public static splitSecret(
    secret: Uint8Array,
    threshold = 2,
    totalShards = 3,
  ): ShamirShard[] {
    if (threshold < 2 || threshold > totalShards || totalShards > 255) {
      throw new ValidationError('Invalid Shamir threshold parameters');
    }

    const shards: Uint8Array[] = Array.from(
      { length: totalShards },
      () => new Uint8Array(secret.length),
    );

    for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
      const secretByte = secret[byteIdx]!;
      const coeffs = new Uint8Array(threshold);
      coeffs[0] = secretByte;
      const randCoeffs = secureRandomBytes(threshold - 1);
      for (let c = 1; c < threshold; c++) {
        coeffs[c] = randCoeffs[c - 1]!;
      }

      for (let shardIdx = 1; shardIdx <= totalShards; shardIdx++) {
        let y = 0;
        let xPower = 1;
        for (let c = 0; c < threshold; c++) {
          y ^= gfMul(coeffs[c]!, xPower);
          xPower = gfMul(xPower, shardIdx);
        }
        shards[shardIdx - 1]![byteIdx] = y;
      }
    }

    return shards.map((s, idx) => ({
      shardIndex: idx + 1,
      shardDataHex: bytesToHex(s),
    }));
  }

  public static reconstructSecret(shards: readonly ShamirShard[]): Uint8Array {
    if (shards.length < 2) {
      throw new ValidationError('At least 2 shards required for Shamir reconstruction');
    }

    const firstData = hexToBytes(shards[0]!.shardDataHex);
    const secretLength = firstData.length;
    const reconstructed = new Uint8Array(secretLength);

    const xCoords = shards.map(s => s.shardIndex);
    const yArrays = shards.map(s => hexToBytes(s.shardDataHex));

    for (let byteIdx = 0; byteIdx < secretLength; byteIdx++) {
      let secretByte = 0;
      for (let j = 0; j < shards.length; j++) {
        const xj = xCoords[j]!;
        const yj = yArrays[j]![byteIdx]!;

        // Lagrange basis l_j(0) = \prod_{m != j} (xm / (xm ^ xj))
        let basis = 1;
        for (let m = 0; m < shards.length; m++) {
          if (m === j) continue;
          const xm = xCoords[m]!;
          const denom = xm ^ xj;
          basis = gfMul(basis, gfDiv(xm, denom));
        }

        secretByte ^= gfMul(yj, basis);
      }
      reconstructed[byteIdx] = secretByte;
    }

    return reconstructed;
  }
}

/**
 * Pillar 8: Exponential Backoff Lockout Duration Equation:
 * LockoutDuration = 2^(FailedAttempts - 3) * 60 seconds
 */
export function calculateExponentialBackoffLockout(failedAttempts: number): number {
  if (failedAttempts <= 3) return 0;
  const exponent = Math.min(10, failedAttempts - 3); // Cap exponent to prevent overflow
  return Math.pow(2, exponent) * 60;
}

export interface RecoveryAppealState {
  readonly appealId: string;
  readonly userDid: string;
  readonly newDevicePublicKeyHex: string;
  readonly initiatedAt: number; // seconds
  readonly vetoWindowSeconds: number; // 48 hours = 172800s
  readonly expiresAt: number;
  status: 'pending_veto_window' | 'vetoed_by_owner' | 'finalized_recovered';
}

/**
 * Pillar 8: 48-Hour Time-Locked Veto Recovery Appeal.
 * Prevents guardian collusion hijacking by granting the legitimate owner 48 hours to veto any recovery attempt.
 */
export class TimeLockedRecoveryAppealManager {
  public static readonly DEFAULT_VETO_WINDOW_SECONDS = 48 * 3600; // 48 hours = 172,800 seconds

  public static initiateAppeal(
    userDid: string,
    newDevicePublicKeyHex: string,
    currentTime = Math.floor(Date.now() / 1000),
    vetoWindowSeconds = TimeLockedRecoveryAppealManager.DEFAULT_VETO_WINDOW_SECONDS,
  ): RecoveryAppealState {
    return {
      appealId: `appeal_${currentTime}_${userDid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`,
      userDid,
      newDevicePublicKeyHex,
      initiatedAt: currentTime,
      vetoWindowSeconds,
      expiresAt: currentTime + vetoWindowSeconds,
      status: 'pending_veto_window',
    };
  }

  public static vetoAppealByOwner(
    appeal: RecoveryAppealState,
    ownerSignatureValid: boolean,
  ): boolean {
    if (!ownerSignatureValid) return false;
    if (appeal.status !== 'pending_veto_window') return false;
    appeal.status = 'vetoed_by_owner';
    return true;
  }

  public static finalizeRecovery(
    appeal: RecoveryAppealState,
    currentTime = Math.floor(Date.now() / 1000),
  ): boolean {
    if (appeal.status !== 'pending_veto_window') return false;
    if (currentTime < appeal.expiresAt) return false; // Veto window still active
    appeal.status = 'finalized_recovered';
    return true;
  }
}

export interface CrossPlatformShamirTrioShards {
  readonly shard1CloudVault: ShamirShard;
  readonly shard2SecondaryDevice: ShamirShard;
  readonly shard3SocialGuardians: ShamirShard;
}

export class CrossPlatformKeySharding {
  public static splitIntoTrio(secret: Uint8Array): CrossPlatformShamirTrioShards {
    const shards = ShamirSecretVault.splitSecret(secret, 2, 3);
    return {
      shard1CloudVault: shards[0]!,
      shard2SecondaryDevice: shards[1]!,
      shard3SocialGuardians: shards[2]!,
    };
  }

  public static reconstructFromAnyTwo(
    shardA: ShamirShard,
    shardB: ShamirShard,
  ): Uint8Array {
    return ShamirSecretVault.reconstructSecret([shardA, shardB]);
  }
}


