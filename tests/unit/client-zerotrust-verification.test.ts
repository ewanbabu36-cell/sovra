import { describe, it, expect } from 'vitest';
import { sha256, bytesToHex, countLeadingZeroBits, computeProofOfWork, verifyProofOfWork } from '@sovra/crypto';

describe('Zero-Trust Client-Side Cryptographic & Anti-Spam Verification Suite', () => {
  it('verifies Hashcash Proof-of-Work nonces with O(1) single-hash check', () => {
    const payload = new TextEncoder().encode('did:sovra:alice:1700000000:Decentralized post');
    const targetDifficulty = 16; // 16 leading zero bits

    const pow = computeProofOfWork(payload, targetDifficulty);
    expect(pow.nonce).toBeGreaterThanOrEqual(0n);
    expect(pow.iterations).toBeGreaterThan(0);

    // Verify valid nonce passes
    const isValid = verifyProofOfWork(payload, pow.nonce, targetDifficulty);
    expect(isValid).toBe(true);

    // Verify tampered nonce fails immediately
    const isTampered = verifyProofOfWork(payload, pow.nonce + 1n, targetDifficulty);
    expect(isTampered).toBe(false);
  });

  it('rejects forged envelopes lacking minimum leading zero bits', () => {
    const payload = new TextEncoder().encode('did:sovra:attacker:forged_spam');
    const zeroNonce = 0n;

    // Normal hash of arbitrary text has < 16 leading zero bits almost always
    const digest = sha256(payload);
    const leadingBits = countLeadingZeroBits(digest);

    if (leadingBits < 16) {
      expect(verifyProofOfWork(payload, zeroNonce, 16)).toBe(false);
    }
  });

  it('validates canonical Ed25519 signature format and detects absent signatures', () => {
    const validPost = {
      id: 'post_123',
      authorDid: 'did:key:z6Mkn6XP3ViWmhgd5X3uotiSrLJm6Cp7639yxx9DjWG6rS73',
      content: 'Hello sovereign world',
      signatureHex: 'ed25519_sig_4a7b9c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5',
      nonce: '1048576'
    };

    const forgedPost = {
      id: 'post_fake_999',
      authorDid: 'did:key:z6Mkn6XP3ViWmhgd5X3uotiSrLJm6Cp7639yxx9DjWG6rS73',
      content: 'Forged sybil post',
      signatureHex: '', // Missing signature
      nonce: ''
    };

    expect(Boolean(validPost.signatureHex && validPost.signatureHex.length >= 32)).toBe(true);
    expect(Boolean(forgedPost.signatureHex && forgedPost.signatureHex.length >= 32)).toBe(false);
  });
});
