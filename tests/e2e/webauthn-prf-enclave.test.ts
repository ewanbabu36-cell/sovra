import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  deriveKeyFromWebAuthnPrf,
  signEd25519,
  verifyEd25519,
  hexToBytes,
} from '../../packages/crypto/dist/index.js';

describe('Cycle 6: WebAuthn PRF Hardware Secure Enclave Key Derivation (Seed Phrase Killer)', () => {
  it('deterministically derives identical Ed25519 root master key from identical PRF output', () => {
    const mockPrfOutput = crypto.randomBytes(32);
    const domainSalt = new TextEncoder().encode('sovra:test:enclave:v1');

    const derived1 = deriveKeyFromWebAuthnPrf(mockPrfOutput, domainSalt);
    const derived2 = deriveKeyFromWebAuthnPrf(mockPrfOutput, domainSalt);

    expect(derived1.seedHex).toBe(derived2.seedHex);
    expect(derived1.privateKeyHex).toBe(derived2.privateKeyHex);
    expect(derived1.publicKeyHex).toBe(derived2.publicKeyHex);
    expect(derived1.did).toBe(derived2.did);
    expect(derived1.hardwareEnclaveVerified).toBe(true);
    expect(derived1.did).toMatch(/^did:key:z6Mk/);
  });

  it('generates cryptographically distinct keypairs from different biometric PRF assertions', () => {
    const prfOutputA = crypto.randomBytes(32);
    const prfOutputB = crypto.randomBytes(32);

    const derivedA = deriveKeyFromWebAuthnPrf(prfOutputA);
    const derivedB = deriveKeyFromWebAuthnPrf(prfOutputB);

    expect(derivedA.publicKeyHex).not.toBe(derivedB.publicKeyHex);
    expect(derivedA.did).not.toBe(derivedB.did);
  });

  it('proves derived private key signs messages verifiable by derived public key', async () => {
    const mockPrf = crypto.randomBytes(32);
    const identity = deriveKeyFromWebAuthnPrf(mockPrf);

    const message = new TextEncoder().encode('Sovereign Authentication Challenge: ' + Date.now());
    const privateKey = hexToBytes(identity.privateKeyHex);
    const publicKey = hexToBytes(identity.publicKeyHex);

    const signature = await signEd25519(privateKey, message);
    const isValid = await verifyEd25519(publicKey, message, signature);

    expect(isValid).toBe(true);

    // Tampered message fails verification
    const tampered = new TextEncoder().encode('Tampered Payload');
    const isTamperedValid = await verifyEd25519(publicKey, tampered, signature);
    expect(isTamperedValid).toBe(false);
  });

  it('rejects truncated PRF outputs under 32 bytes', () => {
    const invalidPrf = crypto.randomBytes(16);
    expect(() => deriveKeyFromWebAuthnPrf(invalidPrf)).toThrow(/must be at least 32 bytes/i);
  });

  it('verifies client UI exposes loginWithHardwareEnclavePrf authentication hook', () => {
    const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
    const content = fs.readFileSync(devServerPath, 'utf-8');
    expect(content).toContain('loginWithHardwareEnclavePrf');
    expect(content).toContain('deriveKeyFromWebAuthnPrf');
  });
});
