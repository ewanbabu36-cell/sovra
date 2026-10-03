import { VerificationKey, KeyAgreementPublicKey } from '@sovra/crypto';

/**
 * Key Distinctions in Sovra:
 *
 * 1. Identity Key:
 *    Root asymmetric Ed25519 keypair identifying the persona/user. Controller of DID.
 *
 * 2. Device Key:
 *    Local device keypair delegated by Identity Key for signing actions from a specific physical device.
 *
 * 3. Session Key:
 *    Ephemeral ratchet / transport key used for short-lived messaging or transport sessions.
 *
 * 4. Encryption Key:
 *    X25519 or symmetric key used for confidentiality (encrypting message payloads or blobs).
 *
 * 5. Signing Key:
 *    Ed25519 key used for digital signatures and authentication proofs.
 */

export type KeyRole = 'identity' | 'device' | 'session' | 'encryption' | 'signing';

export interface BaseSovraKey {
  readonly id: string;
  readonly role: KeyRole;
  readonly createdAt: number;
}

export interface IdentityKey extends BaseSovraKey {
  readonly role: 'identity';
  readonly did: string;
  readonly publicKey: VerificationKey;
}

export interface DeviceKey extends BaseSovraKey {
  readonly role: 'device';
  readonly deviceId: string;
  readonly parentDid: string;
  readonly publicKey: VerificationKey;
  readonly expiresAt: number;
  readonly delegationSignature: Uint8Array;
}

export interface SessionKey extends BaseSovraKey {
  readonly role: 'session';
  readonly sessionId: string;
  readonly rawKey: Uint8Array;
  readonly expiresAt: number;
}

export interface EncryptionKey extends BaseSovraKey {
  readonly role: 'encryption';
  readonly publicKey: KeyAgreementPublicKey;
}

export interface SigningKey extends BaseSovraKey {
  readonly role: 'signing';
  readonly publicKey: VerificationKey;
}
