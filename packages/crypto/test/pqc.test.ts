import { describe, it, expect } from 'vitest';
import {
  generateMlKem768KeyPair,
  mlKem768Encapsulate,
  mlKem768Decapsulate,
  generateHybridKEMKeyPair,
  hybridEncapsulate,
  hybridDecapsulate,
  generateMlDsa65KeyPair,
  mlDsa65Sign,
  mlDsa65Verify,
  generateHybridSignKeyPair,
  signHybrid,
  verifyHybrid,
} from '../src/pqc.js';

describe('🚀 Sovra Post-Quantum Cryptography Enclave (NIST FIPS 203 & 204)', () => {
  describe('1. ML-KEM-768 (Kyber768) Lattice Key Encapsulation', () => {
    it('generates valid ML-KEM-768 key pairs with correct entropy', () => {
      const kp = generateMlKem768KeyPair();
      expect(kp.publicKey).toBeInstanceOf(Uint8Array);
      expect(kp.privateKey).toBeInstanceOf(Uint8Array);
      expect(kp.publicKey.length).toBeGreaterThan(1000);
      expect(kp.publicKeyHex.length).toBe(kp.publicKey.length * 2);
    });

    it('successfully encapsulates and decapsulates shared secrets', () => {
      const recipient = generateMlKem768KeyPair();
      const enc = mlKem768Encapsulate(recipient.publicKey);

      expect(enc.ciphertext.length).toBeGreaterThan(1000);
      expect(enc.sharedSecret.length).toBe(32);

      const dec = mlKem768Decapsulate(enc.ciphertext, recipient.privateKey);
      expect(dec.sharedSecret.length).toBe(32);
      expect(dec.sharedSecretHex).toBe(enc.sharedSecretHex);
    });
  });

  describe('2. Hybrid KEM (X25519 + ML-KEM-768)', () => {
    it('encapsulates and decapsulates a combined quantum-safe secret', () => {
      const recipient = generateHybridKEMKeyPair();
      expect(recipient.hybridPublicKeyHex).toContain('x25519:');
      expect(recipient.hybridPublicKeyHex).toContain('mlkem768:');

      const enc = hybridEncapsulate(recipient.classicalPublicKey, recipient.pqcPublicKey);
      expect(enc.hybridCiphertextHex).toMatch(/^sovra-hybrid-kem:v1:[0-9a-f]+\.[0-9a-f]+$/);
      expect(enc.quantumSafeSharedSecret.length).toBe(32);

      const decSecret = hybridDecapsulate(
        enc.hybridCiphertextHex,
        recipient.classicalPrivateKey,
        recipient.pqcPrivateKey
      );

      expect(Buffer.from(decSecret).toString('hex')).toBe(enc.quantumSafeSharedSecretHex);
    });
  });

  describe('3. ML-DSA-65 (Dilithium3) Post-Quantum Lattice Signatures', () => {
    it('generates ML-DSA-65 keypair, signs message, and verifies validity', () => {
      const kp = generateMlDsa65KeyPair();
      const message = 'Sovra Decentralized Sovereign Stream #42';

      const sig = mlDsa65Sign(message, kp.privateKey);
      expect(sig.length).toBe(160);

      const valid = mlDsa65Verify(message, sig, kp.publicKey);
      expect(valid).toBe(true);

      const tamperedValid = mlDsa65Verify('Tampered message payload', sig, kp.publicKey);
      expect(tamperedValid).toBe(false);
    });
  });

  describe('4. Hybrid Dual-Signature (Ed25519 + ML-DSA-65)', () => {
    it('signs and verifies message with both classical and post-quantum algorithms', () => {
      const kp = generateHybridSignKeyPair();
      const message = JSON.stringify({
        action: 'transfer_creator_earnings',
        amount: 250.0,
        did: 'did:sovra:alice_creator',
        nonce: 10091,
      });

      const hybridSig = signHybrid(message, kp.ed25519PrivateKey, kp.mlDsaPrivateKey);
      expect(hybridSig.algorithm).toBe('ed25519+ml-dsa-65');
      expect(hybridSig.signatureHex).toMatch(/^sovra-pqc-sig:v1:[0-9a-f]{128}\.[0-9a-f]{320}$/);

      const verified = verifyHybrid(
        message,
        hybridSig.signatureHex,
        kp.ed25519PublicKey,
        kp.mlDsaPublicKey
      );
      expect(verified).toBe(true);
    });

    it('strictly rejects verification if either classical or quantum signature is tampered', () => {
      const kp = generateHybridSignKeyPair();
      const message = 'Sovereign Audience Graph Export v2';

      const hybridSig = signHybrid(message, kp.ed25519PrivateKey, kp.mlDsaPrivateKey);

      // 1. Message tampered
      expect(verifyHybrid(message + '_corrupt', hybridSig.signatureHex, kp.ed25519PublicKey, kp.mlDsaPublicKey)).toBe(false);

      // 2. Wrong public key
      const fakeKp = generateHybridSignKeyPair();
      expect(verifyHybrid(message, hybridSig.signatureHex, fakeKp.ed25519PublicKey, kp.mlDsaPublicKey)).toBe(false);
      expect(verifyHybrid(message, hybridSig.signatureHex, kp.ed25519PublicKey, fakeKp.mlDsaPublicKey)).toBe(false);
    });
  });
});
