import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { splitSecretMpc, reconstructSecretMpc } from '../src/mpc.js';

describe('Sovra 2-of-3 MPC Threshold Secret Sharing (TSS)', () => {
  it('should split a 32-byte sovereign private key and reconstruct from any 2 of 3 shares', () => {
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const { shares, threshold, totalShares } = splitSecretMpc(rawSecret);

    expect(shares).toHaveLength(3);
    expect(threshold).toBe(2);
    expect(totalShares).toBe(3);

    // Pair (1, 2)
    const rec12 = reconstructSecretMpc([shares[0], shares[1]]);
    expect(rec12).toBe(rawSecret);

    // Pair (1, 3)
    const rec13 = reconstructSecretMpc([shares[0], shares[2]]);
    expect(rec13).toBe(rawSecret);

    // Pair (2, 3)
    const rec23 = reconstructSecretMpc([shares[1], shares[2]]);
    expect(rec23).toBe(rawSecret);
  });

  it('should split arbitrary ASCII seed phrase and reconstruct identically', () => {
    const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const hex = Buffer.from(phrase, 'utf-8').toString('hex');
    const { shares } = splitSecretMpc(hex);

    const rec = reconstructSecretMpc([shares[1], shares[2]]);
    const recoveredText = Buffer.from(rec, 'hex').toString('utf-8');
    expect(recoveredText).toBe(phrase);
  });

  it('should reject reconstruction when fewer than 2 shares or duplicate share IDs are provided', () => {
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const { shares } = splitSecretMpc(rawSecret);

    expect(() => reconstructSecretMpc([shares[0]])).toThrow();
    expect(() => reconstructSecretMpc([shares[0], shares[0]])).toThrow();
  });
});
