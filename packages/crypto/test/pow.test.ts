import { describe, it, expect } from 'vitest';
import {
  computeProofOfWork,
  verifyProofOfWork,
  countLeadingZeroBits,
} from '../src/index.js';

describe('Proof of Work (PoW) Anti-Sybil Suite', () => {
  it('correctly counts leading zero bits', () => {
    expect(countLeadingZeroBits(new Uint8Array([0x00, 0x00, 0x0f]))).toBe(20);
    expect(countLeadingZeroBits(new Uint8Array([0x00, 0x80]))).toBe(8);
    expect(countLeadingZeroBits(new Uint8Array([0x40]))).toBe(1);
    expect(countLeadingZeroBits(new Uint8Array([0x01]))).toBe(7);
    expect(countLeadingZeroBits(new Uint8Array([0xff]))).toBe(0);
  });

  it('computes and verifies Hashcash PoW for given difficulty targets', () => {
    const payload = new TextEncoder().encode('did:sovra:alice_registration_challenge');

    // Test with difficulty = 10 bits (~1,024 iterations average)
    const result10 = computeProofOfWork(payload, 10);
    expect(result10.nonce).toBeGreaterThanOrEqual(0n);
    expect(result10.iterations).toBeGreaterThan(0);

    const isValid = verifyProofOfWork(payload, result10.nonce, 10);
    expect(isValid).toBe(true);

    // Should fail if nonce is tampered
    const isTamperedValid = verifyProofOfWork(payload, result10.nonce + 1n, 10);
    expect(isTamperedValid).toBe(false);
  });

  it('rejects verification if difficulty requirement is not met', () => {
    const payload = new TextEncoder().encode('test_payload');
    const result = computeProofOfWork(payload, 8);

    expect(verifyProofOfWork(payload, result.nonce, 8)).toBe(true);
    // Verifying with higher difficulty than what was solved must return false
    expect(verifyProofOfWork(payload, result.nonce, 30)).toBe(false);
  });
});
