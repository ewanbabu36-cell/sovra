import { ed25519, x25519 } from '@noble/curves/ed25519';
import { sha256 as nobleSha256 } from '@noble/hashes/sha256';
import { blake3 as nobleBlake3 } from '@noble/hashes/blake3';
import { hkdf as nobleHkdf } from '@noble/hashes/hkdf';
import {
  bytesToHex as nobleBytesToHex,
  hexToBytes as nobleHexToBytes,
  randomBytes as nobleRandomBytes,
} from '@noble/hashes/utils';
import { base58 } from '@scure/base';
import { CryptoError, InvalidSignatureError } from './errors.js';

/**
 * High-performance, audited cryptographic primitives.
 * Strictly wraps @noble/curves, @noble/hashes, and @scure/base.
 * Custom cryptography is strictly forbidden.
 */

// ==========================================
// 1. Randomness & Encoding
// ==========================================

export function secureRandomBytes(length: number): Uint8Array {
  if (length <= 0) {
    throw new CryptoError('Random bytes length must be positive');
  }
  return nobleRandomBytes(length);
}

export function bytesToHex(bytes: Uint8Array): string {
  return nobleBytesToHex(bytes);
}

export function hexToBytes(hex: string): Uint8Array {
  try {
    return nobleHexToBytes(hex);
  } catch (err) {
    throw new CryptoError('Failed to parse hex string', 'ERR_INVALID_HEX', { hex });
  }
}

export function encodeBase58Btc(data: Uint8Array): string {
  return base58.encode(data);
}

export function decodeBase58Btc(str: string): Uint8Array {
  try {
    return base58.decode(str);
  } catch (err) {
    throw new CryptoError('Failed to decode Base58-BTC string', 'ERR_INVALID_BASE58', { str });
  }
}

export function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

// ==========================================
// 2. Hash & Key Derivation Functions
// ==========================================

export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data);
}

export function blake3Hash(data: Uint8Array): Uint8Array {
  return nobleBlake3(data);
}

export function hkdfDerive(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Uint8Array {
  return nobleHkdf(nobleSha256, ikm, salt, info, length);
}

// ==========================================
// 3. Ed25519 Digital Signatures (RFC 8032)
// ==========================================

export interface Ed25519KeyPairBytes {
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
}

export function generateEd25519KeyPair(): Ed25519KeyPairBytes {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { publicKey, privateKey };
}

export function getEd25519PublicKey(privateKey: Uint8Array): Uint8Array {
  if (privateKey.length !== 32) {
    throw new CryptoError('Ed25519 private key must be exactly 32 bytes');
  }
  return ed25519.getPublicKey(privateKey);
}

export function signEd25519(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  if (privateKey.length !== 32) {
    throw new CryptoError('Ed25519 private key must be exactly 32 bytes');
  }
  return ed25519.sign(message, privateKey);
}

export function verifyEd25519(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  if (publicKey.length !== 32) return false;
  if (signature.length !== 64) return false;
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

export function assertValidSignature(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): void {
  if (!verifyEd25519(publicKey, message, signature)) {
    throw new InvalidSignatureError(
      'Cryptographic signature is invalid or does not match public key',
    );
  }
}

// ==========================================
// 4. X25519 Key Agreement (RFC 7748)
// ==========================================

export interface X25519KeyPairBytes {
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
}

export function generateX25519KeyPair(): X25519KeyPairBytes {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { publicKey, privateKey };
}

export function diffieHellmanX25519(
  privateKey: Uint8Array,
  remotePublicKey: Uint8Array,
): Uint8Array {
  if (privateKey.length !== 32 || remotePublicKey.length !== 32) {
    throw new CryptoError('X25519 keys must be exactly 32 bytes');
  }
  return x25519.getSharedSecret(privateKey, remotePublicKey);
}
