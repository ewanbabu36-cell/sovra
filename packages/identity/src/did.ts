import { bytesToHex, hexToBytes, encodeBase58Btc, decodeBase58Btc } from '@sovra/crypto';
import { ValidationError } from '@sovra/shared';

/**
 * W3C did:key Specification for Ed25519 (RFC 8032)
 *
 * Multicodec prefix for ed25519-pub: 0xed01 (varint: [0xed, 0x01])
 * Multibase prefix: 'z' (Base58-BTC)
 * Total prefixed bytes: 34 (2-byte multicodec + 32-byte Ed25519 raw public key)
 */

export const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);
export const DID_KEY_PREFIX = 'did:key:z';

/**
 * Encodes a 32-byte Ed25519 raw public key into a canonical W3C did:key string.
 */
export function encodeEd25519DidKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new ValidationError(
      `Ed25519 public key must be exactly 32 bytes, got ${publicKey.length}`,
    );
  }

  const prefixed = new Uint8Array(34);
  prefixed[0] = 0xed;
  prefixed[1] = 0x01;
  prefixed.set(publicKey, 2);

  return `${DID_KEY_PREFIX}${encodeBase58Btc(prefixed)}`;
}

/**
 * Decodes a W3C did:key string into a 32-byte Ed25519 raw public key.
 */
export function decodeEd25519DidKey(did: string): Uint8Array {
  if (!did.startsWith(DID_KEY_PREFIX)) {
    throw new ValidationError(`Invalid did:key format: must start with '${DID_KEY_PREFIX}'`, {
      did,
    });
  }

  const base58Part = did.slice(DID_KEY_PREFIX.length);
  const decoded = decodeBase58Btc(base58Part);

  if (decoded.length !== 34) {
    throw new ValidationError(
      `Invalid did:key payload length: expected 34 bytes, got ${decoded.length}`,
      { did },
    );
  }

  if (decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new ValidationError('Unsupported multicodec type in did:key: expected Ed25519 (0xed01)', {
      did,
    });
  }

  return decoded.slice(2);
}

/**
 * Validates whether a string is a valid W3C Ed25519 did:key.
 */
export function isValidEd25519DidKey(did: string): boolean {
  try {
    const raw = decodeEd25519DidKey(did);
    return raw.length === 32;
  } catch {
    return false;
  }
}

/**
 * Helper to convert a hex-encoded public key to did:key.
 */
export function hexToEd25519DidKey(publicKeyHex: string): string {
  const bytes = hexToBytes(publicKeyHex);
  return encodeEd25519DidKey(bytes);
}

/**
 * Helper to convert a did:key to a hex-encoded public key.
 */
export function ed25519DidKeyToHex(did: string): string {
  const bytes = decodeEd25519DidKey(did);
  return bytesToHex(bytes);
}
