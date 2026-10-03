/**
 * Standard Cryptographic Interfaces & Types
 * Note: Under the Sovra Cryptography Rule, custom crypto algorithms are strictly forbidden.
 * These interfaces define the contracts that will wrap audited primitives in Phase 2.
 */

export type AlgorithmSuite =
  'Ed25519' | 'X25519' | 'ChaCha20-Poly1305' | 'AES-256-GCM' | 'BLAKE3' | 'SHA-256';

export interface VerificationKey {
  readonly algorithm: 'Ed25519';
  readonly rawBytes: Uint8Array;
  toHex(): string;
  toMultibase(): string;
}

export interface SigningKeyPair {
  readonly algorithm: 'Ed25519';
  readonly publicKey: VerificationKey;
  // Private key is kept non-extractable or securely typed; never exposed in public JSON
  sign(data: Uint8Array): Promise<Uint8Array>;
}

export interface KeyAgreementPublicKey {
  readonly algorithm: 'X25519';
  readonly rawBytes: Uint8Array;
  toHex(): string;
}

export interface KeyAgreementKeyPair {
  readonly algorithm: 'X25519';
  readonly publicKey: KeyAgreementPublicKey;
  diffieHellman(remotePublicKey: KeyAgreementPublicKey): Promise<Uint8Array>;
}

export interface SymmetricKey {
  readonly algorithm: 'ChaCha20-Poly1305' | 'AES-256-GCM';
  readonly keyLength: number; // 256 bits
  encrypt(
    plaintext: Uint8Array,
    additionalData?: Uint8Array,
  ): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array; tag: Uint8Array }>;
  decrypt(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    tag: Uint8Array,
    additionalData?: Uint8Array,
  ): Promise<Uint8Array>;
}

export interface DigestEngine {
  hashSha256(data: Uint8Array): Uint8Array;
  hashBlake3(data: Uint8Array): Uint8Array;
}

export interface KdfEngine {
  deriveKeyArgon2id(password: Uint8Array, salt: Uint8Array, keyLength: number): Promise<Uint8Array>;
  hkdfExtractAndExpand(
    ikm: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
    length: number,
  ): Uint8Array;
}

export interface CryptoProvider {
  generateSigningKeyPair(): Promise<SigningKeyPair>;
  generateKeyAgreementKeyPair(): Promise<KeyAgreementKeyPair>;
  verifySignature(
    publicKey: VerificationKey,
    data: Uint8Array,
    signature: Uint8Array,
  ): Promise<boolean>;
  readonly digest: DigestEngine;
  readonly kdf: KdfEngine;
}
