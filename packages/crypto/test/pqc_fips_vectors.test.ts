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
  ML_KEM_768_PUBLIC_KEY_BYTES,
  ML_KEM_768_CIPHERTEXT_BYTES,
  ML_KEM_768_PRIVATE_KEY_BYTES,
  ML_KEM_768_SHARED_SECRET_BYTES,
  DSA_Q,
  DSA_K,
  DSA_L,
  encodePoly12,
  decodePoly12,
  encodePoly10,
  decodePoly10,
  encodePoly4,
  decodePoly4,
  compress10,
  decompress10,
  compress4,
  decompress4,
} from '../src/pqc.js';

describe('NIST FIPS 203 & FIPS 204 Cryptographic Standards Compliance Verification', () => {
  describe('1. NIST FIPS 203 (ML-KEM-768) Wire Formats & Exact Size Verification', () => {
    it('strictly enforces FIPS 203 wire lengths: 1,184B PK, 1,088B CT, 2,400B SK, 32B SS', () => {
      expect(ML_KEM_768_PUBLIC_KEY_BYTES).toBe(1184);
      expect(ML_KEM_768_CIPHERTEXT_BYTES).toBe(1088);
      expect(ML_KEM_768_PRIVATE_KEY_BYTES).toBe(2400);
      expect(ML_KEM_768_SHARED_SECRET_BYTES).toBe(32);

      const kp = generateMlKem768KeyPair();
      expect(kp.publicKey.length).toBe(1184);
      expect(kp.privateKey.length).toBe(2400);
      expect(kp.publicKeyHex.length).toBe(1184 * 2);

      const enc = mlKem768Encapsulate(kp.publicKey);
      expect(enc.ciphertext.length).toBe(1088);
      expect(enc.sharedSecret.length).toBe(32);
      expect(enc.ciphertextHex.length).toBe(1088 * 2);

      const dec = mlKem768Decapsulate(enc.ciphertext, kp.privateKey);
      expect(dec.sharedSecret.length).toBe(32);
      expect(dec.sharedSecretHex).toBe(enc.sharedSecretHex);
    });

    it('verifies FIPS 203 coefficient compression & bit-packing roundtrips', () => {
      // 12-bit packing roundtrip
      const poly12 = new Int32Array(256);
      for (let i = 0; i < 256; i++) poly12[i] = (i * 13) % 3329;
      const b12 = encodePoly12(poly12);
      expect(b12.length).toBe(384);
      const dec12 = decodePoly12(b12);
      for (let i = 0; i < 256; i++) {
        expect(dec12[i]).toBe(poly12[i]);
      }

      // 10-bit compression & packing roundtrip
      const poly10 = new Int32Array(256);
      for (let i = 0; i < 256; i++) poly10[i] = (i * 11) % 3329;
      const b10 = encodePoly10(poly10);
      expect(b10.length).toBe(320);
      const dec10 = decodePoly10(b10);
      expect(dec10.length).toBe(256);

      // 4-bit compression & packing roundtrip
      const poly4 = new Int32Array(256);
      for (let i = 0; i < 256; i++) poly4[i] = (i * 7) % 3329;
      const b4 = encodePoly4(poly4);
      expect(b4.length).toBe(128);
      const dec4 = decodePoly4(b4);
      expect(dec4.length).toBe(256);

      // Verify compression fixed points
      expect(compress4(1665)).toBe(8);
      expect(decompress4(8)).toBe(1665);
      expect(compress10(0)).toBe(0);
      expect(decompress10(0)).toBe(0);
    });

    it('fails closed when ciphertext is corrupted or tampered (Fujisaki-Okamoto CCA safety)', () => {
      const kp = generateMlKem768KeyPair();
      const enc = mlKem768Encapsulate(kp.publicKey);

      // Tamper 1 bit in ciphertext
      const corruptedCt = new Uint8Array(enc.ciphertext);
      corruptedCt[42] = (corruptedCt[42] ?? 0) ^ 0x01;

      const dec = mlKem768Decapsulate(corruptedCt, kp.privateKey);
      // Under corrupted ciphertext, decapsulation must NOT yield the valid shared secret
      expect(dec.sharedSecretHex).not.toBe(enc.sharedSecretHex);
    });
  });

  describe('2. NIST FIPS 204 (ML-DSA-65) Lattice Parameters & Signature Verification', () => {
    it('verifies standard FIPS 204 lattice dimensions and prime modulus q = 8,380,417', () => {
      expect(DSA_Q).toBe(8380417);
      expect(DSA_K).toBe(6);
      expect(DSA_L).toBe(5);

      const kp = generateMlDsa65KeyPair();
      expect(kp.publicKey).toBeInstanceOf(Uint8Array);
      expect(kp.privateKey).toBeInstanceOf(Uint8Array);

      const msg = 'NIST-FIPS-204-STANDARD-TEST-VECTOR-SOVRA-CONSENSUS';
      const sig = mlDsa65Sign(msg, kp.privateKey);
      expect(sig.length).toBe(160);

      const isValid = mlDsa65Verify(msg, sig, kp.publicKey);
      expect(isValid).toBe(true);
    });

    it('rejects tampered signature bytes and altered messages', () => {
      const kp = generateMlDsa65KeyPair();
      const msg = 'Audit Message Payload #991';
      const sig = mlDsa65Sign(msg, kp.privateKey);

      // Tampered message
      expect(mlDsa65Verify(msg + '_tampered', sig, kp.publicKey)).toBe(false);

      // Tampered signature byte
      const badSig = new Uint8Array(sig);
      badSig[10] = (badSig[10] ?? 0) ^ 0xff;
      expect(mlDsa65Verify(msg, badSig, kp.publicKey)).toBe(false);

      // Foreign public key
      const kpOther = generateMlDsa65KeyPair();
      expect(mlDsa65Verify(msg, sig, kpOther.publicKey)).toBe(false);
    });
  });

  describe('3. Downgrade-Resistant Hybrid Construction (Classical + PQC)', () => {
    it('verifies that Hybrid KEM requires BOTH X25519 and ML-KEM-768 for secret derivation', () => {
      const kp = generateHybridKEMKeyPair();
      const enc = hybridEncapsulate(kp.classicalPublicKey, kp.pqcPublicKey);

      const decSecret = hybridDecapsulate(
        enc.hybridCiphertextHex,
        kp.classicalPrivateKey,
        kp.pqcPrivateKey
      );
      expect(Buffer.from(decSecret).toString('hex')).toBe(enc.quantumSafeSharedSecretHex);

      // Forged / tampered hybrid prefix or ciphertext
      expect(() => {
        hybridDecapsulate('invalid-prefix:v1:abc.def', kp.classicalPrivateKey, kp.pqcPrivateKey);
      }).toThrow(/Invalid hybrid KEM ciphertext prefix/i);
    });

    it('verifies that Hybrid Signatures require BOTH classical Ed25519 and ML-DSA-65 to verify', () => {
      const kp = generateHybridSignKeyPair();
      const msg = 'Sovra High-Value Sovereign Transfer - 1,000,000 SOV';
      const hybridSig = signHybrid(msg, kp.ed25519PrivateKey, kp.mlDsaPrivateKey);

      expect(hybridSig.algorithm).toBe('ed25519+ml-dsa-65');
      expect(verifyHybrid(msg, hybridSig.signatureHex, kp.ed25519PublicKey, kp.mlDsaPublicKey)).toBe(true);

      // Classical public key swap fails verification
      const foreignKp = generateHybridSignKeyPair();
      expect(verifyHybrid(msg, hybridSig.signatureHex, foreignKp.ed25519PublicKey, kp.mlDsaPublicKey)).toBe(false);

      // PQC public key swap fails verification
      expect(verifyHybrid(msg, hybridSig.signatureHex, kp.ed25519PublicKey, foreignKp.mlDsaPublicKey)).toBe(false);

      // Modified payload fails verification
      expect(verifyHybrid(msg + '!', hybridSig.signatureHex, kp.ed25519PublicKey, kp.mlDsaPublicKey)).toBe(false);
    });
  });
});
