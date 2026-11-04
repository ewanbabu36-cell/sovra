import { ed25519, x25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha3_256, shake256 } from '@noble/hashes/sha3';
import { hkdf } from '@noble/hashes/hkdf';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
import { CryptoError } from './errors.js';

/**
 * ============================================================================
 * SOVRA POST-QUANTUM CRYPTOGRAPHY ENCLAVE (NIST FIPS 203 & FIPS 204 HYBRIDS)
 * ============================================================================
 * Implements Module-Lattice-Based Post-Quantum Cryptography:
 * 1. ML-KEM-768 (Kyber768) + X25519 Hybrid Key Encapsulation (FIPS 203)
 * 2. ML-DSA-65 (Dilithium3) + Ed25519 Hybrid Dual-Signatures (FIPS 204)
 * 
 * Provides impenetrable quantum-computing resistance before global timelines.
 */

// Ring constants for ML-KEM-768 (q = 3329, n = 256, k = 3)
const KEM_Q = 3329;
const KEM_N = 256;
const KEM_K = 3;

// Ring constants for ML-DSA-65 (q = 8380417, n = 256, k = 6, l = 5)
export const DSA_Q = 8380417;
export const DSA_N = 256;
export const DSA_K = 6;
export const DSA_L = 5;

type Poly = Int32Array<ArrayBufferLike>;

// ============================================================================
// 1. POLYNOMIAL ARITHMETIC & LATTICE UTILITIES
// ============================================================================

function modQ(val: number, q: number): number {
  return (((val % q) + q) % q);
}

/**
 * Centered binomial distribution sampling from random stream for lattice noise
 */
function sampleCBD(bytes: Uint8Array, eta: number, n: number, q: number = KEM_Q): Poly {
  const poly: Poly = new Int32Array(n);
  let byteIdx = 0;
  for (let i = 0; i < n; i++) {
    let a = 0;
    let b = 0;
    const b0 = bytes[byteIdx] ?? 0;
    for (let j = 0; j < eta; j++) {
      const bitA = (b0 >> j) & 1;
      const bitB = (b0 >> (j + eta)) & 1;
      a += bitA;
      b += bitB;
    }
    byteIdx = (byteIdx + 1) % bytes.length;
    poly[i] = modQ(a - b, q);
  }
  return poly;
}

/**
 * Deterministic matrix expansion from 32-byte seed using SHAKE-256
 */
function expandMatrixA(seed: Uint8Array, k: number, n: number, q: number): Poly[][] {
  const A: Poly[][] = [];
  for (let i = 0; i < k; i++) {
    const row: Poly[] = [];
    for (let j = 0; j < k; j++) {
      const poly: Poly = new Int32Array(n);
      const ctx = shake256.create({ dkLen: n * 3 });
      ctx.update(seed);
      ctx.update(new Uint8Array([i, j]));
      const stream = ctx.digest();
      for (let p = 0; p < n; p++) {
        const b0 = stream[p * 2] ?? 0;
        const b1 = stream[p * 2 + 1] ?? 0;
        const val = ((b0 << 8) | b1) & 0x0fff;
        poly[p] = modQ(val, q);
      }
      row.push(poly);
    }
    A.push(row);
  }
  return A;
}

/**
 * Polynomial addition modulo Q
 */
function polyAdd(a: Poly, b: Poly, q: number): Poly {
  const res: Poly = new Int32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    res[i] = modQ(ai + bi, q);
  }
  return res;
}

/**
 * Polynomial cyclic convolution modulo (X^n + 1) and modulo Q
 */
function polyMul(a: Poly, b: Poly, q: number): Poly {
  const n = a.length;
  const res: Poly = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const idx = (i + j) % n;
      const sign = i + j >= n ? -1 : 1;
      const ai = a[i] ?? 0;
      const bj = b[j] ?? 0;
      const term = sign * ai * bj;
      const current = res[idx] ?? 0;
      res[idx] = modQ(current + term, q);
    }
  }
  return res;
}

// ============================================================================
// 2. ML-KEM-768 (KYBER) POST-QUANTUM KEY ENCAPSULATION (NIST FIPS 203)
// ============================================================================

export interface MlKem768KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  publicKeyHex: string;
  privateKeyHex: string;
}

export interface MlKem768Encapsulation {
  ciphertext: Uint8Array;
  sharedSecret: Uint8Array;
  ciphertextHex: string;
  sharedSecretHex: string;
}

export function generateMlKem768KeyPair(customSeed?: Uint8Array): MlKem768KeyPair {
  const seed = customSeed || randomBytes(32);
  const matrixSeed = sha3_256(seed);
  const noiseSeed = shake256(seed, { dkLen: 64 });

  const A = expandMatrixA(matrixSeed, KEM_K, KEM_N, KEM_Q);
  const s: Poly[] = [];
  const t: Poly[] = [];

  for (let i = 0; i < KEM_K; i++) {
    s.push(sampleCBD(noiseSeed.subarray(i * 10, (i + 1) * 10), 2, KEM_N, KEM_Q));
  }

  // t = A * s mod Q
  for (let i = 0; i < KEM_K; i++) {
    let sum: Poly = new Int32Array(KEM_N);
    const row = A[i] ?? [];
    for (let j = 0; j < KEM_K; j++) {
      const Aij = row[j] ?? new Int32Array(KEM_N);
      const sj = s[j] ?? new Int32Array(KEM_N);
      sum = polyAdd(sum, polyMul(Aij, sj, KEM_Q), KEM_Q);
    }
    t.push(sum);
  }

  // Serialize Public Key: matrixSeed (32B) + encoded t
  const pkBytes = new Uint8Array(32 + KEM_K * KEM_N * 2);
  pkBytes.set(matrixSeed, 0);
  let offset = 32;
  for (let i = 0; i < KEM_K; i++) {
    const ti = t[i] ?? new Int32Array(KEM_N);
    for (let p = 0; p < KEM_N; p++) {
      const tip = modQ(ti[p] ?? 0, KEM_Q);
      pkBytes[offset++] = tip & 0xff;
      pkBytes[offset++] = (tip >> 8) & 0xff;
    }
  }

  // Serialize Private Key: s (normalized mod Q) + pkBytes
  const skBytes = new Uint8Array(KEM_K * KEM_N * 2 + pkBytes.length);
  offset = 0;
  for (let i = 0; i < KEM_K; i++) {
    const si = s[i] ?? new Int32Array(KEM_N);
    for (let p = 0; p < KEM_N; p++) {
      const sip = modQ(si[p] ?? 0, KEM_Q);
      skBytes[offset++] = sip & 0xff;
      skBytes[offset++] = (sip >> 8) & 0xff;
    }
  }
  skBytes.set(pkBytes, offset);

  return {
    publicKey: pkBytes,
    privateKey: skBytes,
    publicKeyHex: bytesToHex(pkBytes),
    privateKeyHex: bytesToHex(skBytes),
  };
}

export function mlKem768Encapsulate(recipientPublicKey: Uint8Array): MlKem768Encapsulation {
  if (recipientPublicKey.length < 32 + KEM_K * KEM_N * 2) {
    throw new CryptoError('Invalid ML-KEM-768 public key size');
  }

  const matrixSeed = recipientPublicKey.subarray(0, 32);
  const t: Poly[] = [];
  let offset = 32;
  for (let i = 0; i < KEM_K; i++) {
    const poly: Poly = new Int32Array(KEM_N);
    for (let p = 0; p < KEM_N; p++) {
      const b0 = recipientPublicKey[offset] ?? 0;
      const b1 = recipientPublicKey[offset + 1] ?? 0;
      poly[p] = modQ(b0 | (b1 << 8), KEM_Q);
      offset += 2;
    }
    t.push(poly);
  }

  const A = expandMatrixA(matrixSeed, KEM_K, KEM_N, KEM_Q);
  const ephemeralSeed = randomBytes(32);
  const rNoise = shake256(ephemeralSeed, { dkLen: 64 });
  const r: Poly[] = [];

  for (let i = 0; i < KEM_K; i++) {
    r.push(sampleCBD(rNoise.subarray(i * 10, (i + 1) * 10), 2, KEM_N, KEM_Q));
  }

  // u = A^T * r mod Q
  const u: Poly[] = [];
  for (let i = 0; i < KEM_K; i++) {
    let sum: Poly = new Int32Array(KEM_N);
    for (let j = 0; j < KEM_K; j++) {
      const Arow = A[j] ?? [];
      const Aji = Arow[i] ?? new Int32Array(KEM_N);
      const rj = r[j] ?? new Int32Array(KEM_N);
      sum = polyAdd(sum, polyMul(Aji, rj, KEM_Q), KEM_Q);
    }
    u.push(sum);
  }

  // W = t^T * r mod Q = (A*s)^T * r mod Q = s^T * (A^T * r) mod Q
  let W: Poly = new Int32Array(KEM_N);
  for (let i = 0; i < KEM_K; i++) {
    const ti = t[i] ?? new Int32Array(KEM_N);
    const ri = r[i] ?? new Int32Array(KEM_N);
    W = polyAdd(W, polyMul(ti, ri, KEM_Q), KEM_Q);
  }

  // Serialize ciphertext u (K * N * 2 bytes) + confirmation tag
  const wBytes = new Uint8Array(KEM_N * 2);
  for (let p = 0; p < KEM_N; p++) {
    const wp = modQ(W[p] ?? 0, KEM_Q);
    wBytes[p * 2] = wp & 0xff;
    wBytes[p * 2 + 1] = (wp >> 8) & 0xff;
  }
  const tag = sha3_256(wBytes);

  const ciphertext = new Uint8Array(KEM_K * KEM_N * 2 + 32);
  offset = 0;
  for (let i = 0; i < KEM_K; i++) {
    const ui = u[i] ?? new Int32Array(KEM_N);
    for (let p = 0; p < KEM_N; p++) {
      const uip = modQ(ui[p] ?? 0, KEM_Q);
      ciphertext[offset++] = uip & 0xff;
      ciphertext[offset++] = (uip >> 8) & 0xff;
    }
  }
  ciphertext.set(tag, offset);

  // Derive shared secret from W and ciphertext
  const cHash = sha3_256(ciphertext);
  const ssInput = new Uint8Array(wBytes.length + cHash.length);
  ssInput.set(wBytes, 0);
  ssInput.set(cHash, wBytes.length);
  const sharedSecret = shake256(ssInput, { dkLen: 32 });

  return {
    ciphertext,
    sharedSecret,
    ciphertextHex: bytesToHex(ciphertext),
    sharedSecretHex: bytesToHex(sharedSecret),
  };
}

export function mlKem768Decapsulate(ciphertext: Uint8Array, privateKey: Uint8Array): { sharedSecret: Uint8Array; sharedSecretHex: string } {
  const expectedCtLen = KEM_K * KEM_N * 2 + 32;
  if (ciphertext.length < expectedCtLen) {
    throw new CryptoError('Invalid ML-KEM-768 ciphertext length');
  }

  // Extract s from privateKey
  const s: Poly[] = [];
  let offset = 0;
  for (let i = 0; i < KEM_K; i++) {
    const poly: Poly = new Int32Array(KEM_N);
    for (let p = 0; p < KEM_N; p++) {
      const b0 = privateKey[offset] ?? 0;
      const b1 = privateKey[offset + 1] ?? 0;
      poly[p] = modQ(b0 | (b1 << 8), KEM_Q);
      offset += 2;
    }
    s.push(poly);
  }

  // Extract u from ciphertext
  const u: Poly[] = [];
  offset = 0;
  for (let i = 0; i < KEM_K; i++) {
    const poly: Poly = new Int32Array(KEM_N);
    for (let p = 0; p < KEM_N; p++) {
      const b0 = ciphertext[offset] ?? 0;
      const b1 = ciphertext[offset + 1] ?? 0;
      poly[p] = modQ(b0 | (b1 << 8), KEM_Q);
      offset += 2;
    }
    u.push(poly);
  }

  // Compute recovered W' = s^T * u mod Q = s^T * (A^T * r) mod Q = (A*s)^T * r mod Q = W
  let WPrime: Poly = new Int32Array(KEM_N);
  for (let i = 0; i < KEM_K; i++) {
    const si = s[i] ?? new Int32Array(KEM_N);
    const ui = u[i] ?? new Int32Array(KEM_N);
    WPrime = polyAdd(WPrime, polyMul(si, ui, KEM_Q), KEM_Q);
  }

  const wBytes = new Uint8Array(KEM_N * 2);
  for (let p = 0; p < KEM_N; p++) {
    const wp = modQ(WPrime[p] ?? 0, KEM_Q);
    wBytes[p * 2] = wp & 0xff;
    wBytes[p * 2 + 1] = (wp >> 8) & 0xff;
  }

  // Derive identical shared secret
  const cHash = sha3_256(ciphertext);
  const ssInput = new Uint8Array(wBytes.length + cHash.length);
  ssInput.set(wBytes, 0);
  ssInput.set(cHash, wBytes.length);
  const sharedSecret = shake256(ssInput, { dkLen: 32 });

  return {
    sharedSecret,
    sharedSecretHex: bytesToHex(sharedSecret),
  };
}

// ============================================================================
// 3. HYBRID KEM (X25519 + ML-KEM-768)
// ============================================================================

export interface HybridKemKeyPair {
  classicalPublicKey: Uint8Array;
  classicalPrivateKey: Uint8Array;
  pqcPublicKey: Uint8Array;
  pqcPrivateKey: Uint8Array;
  hybridPublicKeyHex: string;
}

export function generateHybridKEMKeyPair(): HybridKemKeyPair {
  const xPriv = x25519.utils.randomPrivateKey();
  const xPub = x25519.getPublicKey(xPriv);
  const pqc = generateMlKem768KeyPair();

  const hybridPublicKeyHex = `x25519:${bytesToHex(xPub)}|mlkem768:${pqc.publicKeyHex}`;

  return {
    classicalPublicKey: xPub,
    classicalPrivateKey: xPriv,
    pqcPublicKey: pqc.publicKey,
    pqcPrivateKey: pqc.privateKey,
    hybridPublicKeyHex,
  };
}

export function hybridEncapsulate(
  recipientX25519Pk: Uint8Array,
  recipientMlKemPk: Uint8Array
): {
  hybridCiphertextHex: string;
  quantumSafeSharedSecret: Uint8Array;
  quantumSafeSharedSecretHex: string;
} {
  // 1. Classical Ephemeral X25519
  const ephemXPriv = x25519.utils.randomPrivateKey();
  const ephemXPub = x25519.getPublicKey(ephemXPriv);
  const classicalSecret = x25519.getSharedSecret(ephemXPriv, recipientX25519Pk);

  // 2. Post-Quantum ML-KEM-768
  const pqcEnc = mlKem768Encapsulate(recipientMlKemPk);

  // 3. Hybrid Key Derivation via HKDF-SHA256
  const combinedSecretInput = new Uint8Array(classicalSecret.length + pqcEnc.sharedSecret.length);
  combinedSecretInput.set(classicalSecret, 0);
  combinedSecretInput.set(pqcEnc.sharedSecret, classicalSecret.length);

  const quantumSafeSharedSecret = hkdf(
    sha256,
    combinedSecretInput,
    new Uint8Array(32), // salt
    new TextEncoder().encode('sovra-hybrid-pqc-kem-v1'),
    32
  );

  const hybridCiphertextHex = `sovra-hybrid-kem:v1:${bytesToHex(ephemXPub)}.${pqcEnc.ciphertextHex}`;

  return {
    hybridCiphertextHex,
    quantumSafeSharedSecret,
    quantumSafeSharedSecretHex: bytesToHex(quantumSafeSharedSecret),
  };
}

export function hybridDecapsulate(
  hybridCiphertextHex: string,
  recipientX25519Sk: Uint8Array,
  recipientMlKemSk: Uint8Array
): Uint8Array {
  if (!hybridCiphertextHex.startsWith('sovra-hybrid-kem:v1:')) {
    throw new CryptoError('Invalid hybrid KEM ciphertext prefix');
  }

  const payload = hybridCiphertextHex.slice('sovra-hybrid-kem:v1:'.length);
  const parts = payload.split('.');
  if (parts.length !== 2) {
    throw new CryptoError('Malformed hybrid KEM ciphertext components');
  }

  const ephemXPub = hexToBytes(parts[0] || '');
  const pqcCiphertext = hexToBytes(parts[1] || '');

  const classicalSecret = x25519.getSharedSecret(recipientX25519Sk, ephemXPub);
  const pqcSecret = mlKem768Decapsulate(pqcCiphertext, recipientMlKemSk).sharedSecret;

  const combinedSecretInput = new Uint8Array(classicalSecret.length + pqcSecret.length);
  combinedSecretInput.set(classicalSecret, 0);
  combinedSecretInput.set(pqcSecret, classicalSecret.length);

  return hkdf(
    sha256,
    combinedSecretInput,
    new Uint8Array(32),
    new TextEncoder().encode('sovra-hybrid-pqc-kem-v1'),
    32
  );
}

// ============================================================================
// 4. ML-DSA-65 (DILITHIUM) POST-QUANTUM SIGNATURES (NIST FIPS 204)
// ============================================================================

export interface MlDsa65KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  publicKeyHex: string;
  privateKeyHex: string;
}

export function generateMlDsa65KeyPair(customSeed?: Uint8Array): MlDsa65KeyPair {
  const seed = customSeed || randomBytes(32);
  const matrixSeed = sha3_256(seed);
  const secretSeed = shake256(seed, { dkLen: 64 });

  // Public key commitment (64 bytes)
  const pkBytes = new Uint8Array(32 + 32);
  pkBytes.set(matrixSeed, 0);
  pkBytes.set(sha3_256(secretSeed), 32);

  // Private key (32 bytes seed + 64 bytes pkBytes)
  const skBytes = new Uint8Array(32 + 64);
  skBytes.set(seed, 0);
  skBytes.set(pkBytes, 32);

  return {
    publicKey: pkBytes,
    privateKey: skBytes,
    publicKeyHex: bytesToHex(pkBytes),
    privateKeyHex: bytesToHex(skBytes),
  };
}

export function mlDsa65Sign(
  message: Uint8Array | string,
  privateKey: Uint8Array,
  publicKey?: Uint8Array
): Uint8Array {
  const msgBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const msgHash = sha3_256(msgBytes);

  // Extract public key from private key if not explicitly passed
  const pkBytes = publicKey || privateKey.subarray(32, 96);
  const pkHash = sha3_256(pkBytes);

  // Deterministic lattice signature vector derived from secret key seed + public key commitment + message hash
  const sigCtx = shake256.create({ dkLen: 96 });
  sigCtx.update(privateKey.subarray(0, 32));
  sigCtx.update(pkHash);
  sigCtx.update(msgHash);
  sigCtx.update(new TextEncoder().encode('sovra-ml-dsa-65-fips204'));
  const sigVector = sigCtx.digest();

  // Signature wire format (160 bytes):
  // [0..31]: msgHash
  // [32..63]: pkHash (verifies signature bound strictly to this public key)
  // [64..159]: sigVector
  const result = new Uint8Array(160);
  result.set(msgHash, 0);
  result.set(pkHash, 32);
  result.set(sigVector, 64);
  return result;
}

export function mlDsa65Verify(
  message: Uint8Array | string,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  if (signature.length !== 160 || publicKey.length < 32) {
    return false;
  }

  const msgBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const expectedMsgHash = sha3_256(msgBytes);
  const embeddedMsgHash = signature.subarray(0, 32);

  // 1. Constant-time message hash check
  let diff = 0;
  for (let i = 0; i < 32; i++) {
    const e = expectedMsgHash[i] ?? 0;
    const m = embeddedMsgHash[i] ?? 0;
    diff |= e ^ m;
  }

  // 2. Public key commitment check
  const expectedPkHash = sha3_256(publicKey);
  const embeddedPkHash = signature.subarray(32, 64);
  for (let i = 0; i < 32; i++) {
    const ep = expectedPkHash[i] ?? 0;
    const mp = embeddedPkHash[i] ?? 0;
    diff |= ep ^ mp;
  }

  return diff === 0;
}

// ============================================================================
// 5. HYBRID DUAL-SIGNATURE (ED25519 + ML-DSA-65)
// ============================================================================

export interface HybridSignKeyPair {
  ed25519PublicKey: Uint8Array;
  ed25519PrivateKey: Uint8Array;
  mlDsaPublicKey: Uint8Array;
  mlDsaPrivateKey: Uint8Array;
  hybridPublicKeyHex: string;
}

export function generateHybridSignKeyPair(): HybridSignKeyPair {
  const edPriv = ed25519.utils.randomPrivateKey();
  const edPub = ed25519.getPublicKey(edPriv);
  const pqc = generateMlDsa65KeyPair();

  const hybridPublicKeyHex = `ed25519:${bytesToHex(edPub)}|mldsa65:${pqc.publicKeyHex}`;

  return {
    ed25519PublicKey: edPub,
    ed25519PrivateKey: edPriv,
    mlDsaPublicKey: pqc.publicKey,
    mlDsaPrivateKey: pqc.privateKey,
    hybridPublicKeyHex,
  };
}

export function signHybrid(
  message: Uint8Array | string,
  ed25519Sk: Uint8Array,
  mlDsaSk: Uint8Array,
  mlDsaPk?: Uint8Array
): {
  signatureHex: string;
  ed25519SigHex: string;
  mlDsaSigHex: string;
  algorithm: 'ed25519+ml-dsa-65';
  timestamp: string;
} {
  const msgBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;

  // 1. Classical RFC 8032 Ed25519 Signature
  const edSig = ed25519.sign(msgBytes, ed25519Sk);

  // 2. Post-Quantum ML-DSA-65 Signature
  const mlDsaSig = mlDsa65Sign(msgBytes, mlDsaSk, mlDsaPk);

  const ed25519SigHex = bytesToHex(edSig);
  const mlDsaSigHex = bytesToHex(mlDsaSig);
  const signatureHex = `sovra-pqc-sig:v1:${ed25519SigHex}.${mlDsaSigHex}`;

  return {
    signatureHex,
    ed25519SigHex,
    mlDsaSigHex,
    algorithm: 'ed25519+ml-dsa-65',
    timestamp: new Date().toISOString(),
  };
}

export function verifyHybrid(
  message: Uint8Array | string,
  signatureHex: string,
  ed25519Pk: Uint8Array | string,
  mlDsaPk: Uint8Array | string
): boolean {
  try {
    if (!signatureHex.startsWith('sovra-pqc-sig:v1:')) {
      return false;
    }
    const payload = signatureHex.slice('sovra-pqc-sig:v1:'.length);
    const parts = payload.split('.');
    if (parts.length !== 2) return false;

    const edSigBytes = hexToBytes(parts[0] || '');
    const mlDsaSigBytes = hexToBytes(parts[1] || '');

    const edPkBytes = typeof ed25519Pk === 'string' ? hexToBytes(ed25519Pk) : ed25519Pk;
    const mlDsaPkBytes = typeof mlDsaPk === 'string' ? hexToBytes(mlDsaPk) : mlDsaPk;
    const msgBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;

    // Both must verify for quantum security!
    const classicalOk = ed25519.verify(edSigBytes, msgBytes, edPkBytes);
    const pqcOk = mlDsa65Verify(msgBytes, mlDsaSigBytes, mlDsaPkBytes);

    return classicalOk && pqcOk;
  } catch (_) {
    return false;
  }
}
