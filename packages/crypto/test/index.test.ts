import { describe, it, expect } from 'vitest';
import {
  APPROVED_CRYPTO_LIBRARIES,
  CryptoError,
  InvalidSignatureError,
  generateEd25519KeyPair,
  signEd25519,
  verifyEd25519,
  generateX25519KeyPair,
  diffieHellmanX25519,
  sha256,
  blake3Hash,
  hkdfDerive,
  secureRandomBytes,
  constantTimeEquals,
  bytesToHex,
  hexToBytes,
  encodeBase58Btc,
  decodeBase58Btc,
} from '../src/index.js';

describe('@sovra/crypto Primitives & Vetted Libraries', () => {
  it('registers vetted cryptographic dependencies with strict audit metadata', () => {
    expect(APPROVED_CRYPTO_LIBRARIES.length).toBeGreaterThan(0);
    const nobleCurves = APPROVED_CRYPTO_LIBRARIES.find(lib => lib.library === '@noble/curves');
    expect(nobleCurves).toBeDefined();
    expect(nobleCurves?.maintenanceStatus).toBe('audited');
  });

  it('instantiates cryptographic error hierarchies properly', () => {
    const error = new InvalidSignatureError('Signature does not match payload', {
      algorithm: 'Ed25519',
    });
    expect(error).toBeInstanceOf(CryptoError);
    expect(error.code).toBe('ERR_CRYPTO_INVALID_SIGNATURE');
  });

  it('generates Ed25519 keypairs and executes signature signing and verification', () => {
    const keyPair = generateEd25519KeyPair();
    expect(keyPair.publicKey.length).toBe(32);
    expect(keyPair.privateKey.length).toBe(32);

    const message = new TextEncoder().encode('Decentralized Identity Assertion');
    const signature = signEd25519(keyPair.privateKey, message);
    expect(signature.length).toBe(64);

    const isValid = verifyEd25519(keyPair.publicKey, message, signature);
    expect(isValid).toBe(true);
  });

  it('verifies RFC 8032 standard test vector 1 for Ed25519', () => {
    // RFC 8032 test vector 1 (empty message)
    const privHex = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
    const expectedPubHex = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
    const emptyMsg = new Uint8Array(0);

    const privKey = hexToBytes(privHex);
    const signature = signEd25519(privKey, emptyMsg);
    const expectedPub = hexToBytes(expectedPubHex);

    expect(verifyEd25519(expectedPub, emptyMsg, signature)).toBe(true);
  });

  it('rejects tampered messages or signatures', () => {
    const keyPair = generateEd25519KeyPair();
    const message = new TextEncoder().encode('Authentic payload');
    const signature = signEd25519(keyPair.privateKey, message);

    // Tampered message
    const tamperedMessage = new TextEncoder().encode('Forged payload');
    expect(verifyEd25519(keyPair.publicKey, tamperedMessage, signature)).toBe(false);

    // Tampered signature
    const corruptedSignature = new Uint8Array(signature);
    corruptedSignature[0] = (corruptedSignature[0] ?? 0) ^ 0xff;
    expect(verifyEd25519(keyPair.publicKey, message, corruptedSignature)).toBe(false);

    // Wrong public key
    const differentKeyPair = generateEd25519KeyPair();
    expect(verifyEd25519(differentKeyPair.publicKey, message, signature)).toBe(false);
  });

  it('performs Diffie-Hellman key agreement with mutual symmetry using X25519', () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();

    const sharedSecretAlice = diffieHellmanX25519(alice.privateKey, bob.publicKey);
    const sharedSecretBob = diffieHellmanX25519(bob.privateKey, alice.publicKey);

    expect(sharedSecretAlice.length).toBe(32);
    expect(constantTimeEquals(sharedSecretAlice, sharedSecretBob)).toBe(true);
  });

  it('computes deterministic SHA-256 and BLAKE3 digests', () => {
    const input = new TextEncoder().encode('Sovra Protocol');
    const sha = sha256(input);
    const blake = blake3Hash(input);

    expect(sha.length).toBe(32);
    expect(blake.length).toBe(32);
    expect(bytesToHex(sha)).toBe(
      '480d195ffe76b55ccef9b0a811398b868df309824edd4bf961cbfddd530a204f',
    );
  });

  it('derives cryptographic keys via HKDF (RFC 5869)', () => {
    const ikm = secureRandomBytes(32);
    const salt = secureRandomBytes(16);
    const info = new TextEncoder().encode('sovra:test:v1');

    const key1 = hkdfDerive(ikm, salt, info, 32);
    const key2 = hkdfDerive(ikm, salt, info, 32);

    expect(key1.length).toBe(32);
    expect(constantTimeEquals(key1, key2)).toBe(true);
  });

  it('encodes and decodes Base58-BTC canonically', () => {
    const raw = new Uint8Array([0xed, 0x01, 1, 2, 3, 4, 5]);
    const encoded = encodeBase58Btc(raw);
    const decoded = decodeBase58Btc(encoded);

    expect(constantTimeEquals(raw, decoded)).toBe(true);
  });
});
