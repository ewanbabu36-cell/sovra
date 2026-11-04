# SOVRA — CRYPTOGRAPHIC PROTOCOL & PRIMITIVES AUDIT

**Audit Date**: 2026-11-04  
**Audit Entity**: Multidisciplinary Enterprise Technology Audit Organization  
**Auditor Roles**: Cryptography & Protocol Security Researcher & AppSec Engineer  
**Core Target Packages**: `packages/crypto`, `packages/identity`, `packages/p2p`, `scripts/routes/zk.routes.ts`  
**Evaluation Status**: PARTIALLY VERIFIED (Real primitives verified; ZK Groth16 & WebAuthn PRF incomplete)

---

## 1. CRYPTOGRAPHIC PRIMITIVES & ALGORITHMIC MATRIX

| Cryptographic Task | Standard / RFC | Library Implementation | Source Evidence | Audit Status |
| :--- | :--- | :--- | :--- | :--- |
| **Identity Signatures** | RFC 8032 (Ed25519) | `@noble/curves/ed25519` | `packages/identity/src/keypair.ts:16-65` | **VERIFIED** |
| **Asymmetric Key Exchange**| RFC 7748 (X25519) | `@noble/curves/ed25519` (edwardsToMontgomery) | `packages/crypto/src/ecdh.ts:22-54` | **VERIFIED** |
| **Authenticated Encryption**| RFC 8439 (ChaCha20-Poly1305) | `@noble/ciphers/chacha` | `packages/crypto/src/aead.ts:18-62` | **VERIFIED** |
| **Key Derivation** | RFC 5869 (HKDF-SHA256) | `@noble/hashes/hkdf` | `packages/crypto/src/kdf.ts:14-40` | **VERIFIED** |
| **Mnemonic Backup** | BIP-0039 | `@scure/bip39` (English wordlist) | `packages/identity/src/mnemonic.ts:12-48` | **VERIFIED** |
| **Transport Layer Security**| Noise Protocol Framework Rev 34 | `Noise_XX_25519_ChaChaPoly_SHA256` | `packages/p2p/src/transport.ts:20-80` | **VERIFIED** |
| **Zero-Knowledge Humanity**| Semaphore Groth16 SNARK | Missing `snarkjs` verify | `scripts/routes/zk.routes.ts:55-107` | **PARTIALLY VERIFIED** |
| **Hardware Enclave Binding**| WebAuthn PRF Extension | `console.log` stub | `scripts/dev-server.ts:85167-85180` | **FAILED** |

---

## 2. P2P TRANSPORT SECURITY AUDIT: NOISE_XX PROTOCOL

The sovereign transport protocol implements the **Noise_XX** handshake pattern, providing mutual authentication, forward secrecy, and identity hiding:

```
Noise_XX_25519_ChaChaPoly_SHA256:
  -> e
  <- e, ee, s, es
  -> s, se
```

### Protocol Execution Verification:
1. **Ephemeral Key Exchange (`e`)**: Each node generates a fresh ephemeral X25519 keypair for each connection session.
2. **Static Key Exchange (`s`)**: Static Ed25519 identity keys are converted to Montgomery space (`edwardsToMontgomeryPub`) and exchanged under AEAD encryption.
3. **Replay & Tamper Resistance**:
   - Live socket probe to `127.0.0.1:4001` confirmed listener is actively bound and parsing Noise frame preambles.
   - Handshake states prevent packet injection prior to cryptographic key ratification.

---

## 3. ZERO-KNOWLEDGE SEMAPHORE AUDIT (FINDING SEC-01)

### Mathematical Reality vs Claim:
- **Claimed**: Zero-knowledge proof verifying that an identity belongs to an authorized Semaphore Merkle tree without revealing their identity, with cryptographic double-spend nullifier protection.
- **Audit Discovery**:
  - The nullifier deduplication database constraint is **VERIFIED** (`HTTP 409 Conflict` on duplicate nullifier).
  - The Groth16 mathematical pairing verification ($e(A, B) = e(\alpha, \beta) \cdot e(x, \gamma) \cdot e(C, \delta)$) is **COMPLETELY MISSING**.
  - Code inspection of `scripts/routes/zk.routes.ts`:
    ```typescript
    // Proof object is parsed from JSON body but never passed to snarkjs:
    const { proof, publicSignals, nullifierHash } = body;
    if (!nullifierHash) return sendError(res, 400, 'Nullifier hash required');
    if (sovraDb.hasNullifier(nullifierHash)) {
      return sendError(res, 409, 'Nullifier already spent');
    }
    // Directly marks verified without verifying bilinear pairings!
    sovraDb.recordZkAttestation({ did: principal.did, nullifierHash, verified: true });
    ```
- **Risk**: Forgery is trivial. Any client can generate a random string and claim verified human status.

---

## 4. WEBAUTHN PRF EXTENSION AUDIT (FINDING SEC-02)

### FIDO2 / WebAuthn PRF Implementation:
- **Claimed**: Client derives master root seed directly from biometric enclave (FaceID / TouchID / Windows Hello) using HMAC-secret / PRF extension (`prf: { eval: { first: salt } }`).
- **Audit Discovery**:
  - `packages/identity/src/passkey.ts` contains an architectural wrapper.
  - The actual browser integration delivered in `scripts/dev-server.ts:85167-85180` consists of:
    ```javascript
    async function loginWithHardwareEnclavePrf() {
      console.log('[Enclave] deriveKeyFromWebAuthnPrf active for seed-phrase-less master key derivation');
    }
    ```
  - **Verdict**: Unimplemented prototype stub. A console message does not constitute cryptographic execution.

---

## 5. CRYPTOGRAPHIC SECURITY SCORECARD

- **Symmetric Primitives & AEAD**: `98 / 100` (Modern ChaCha20-Poly1305)
- **Asymmetric Signature & Key Exchange**: `96 / 100` (Ed25519 & X25519 via Noble)
- **Transport Handshake (Noise_XX)**: `92 / 100`
- **Zero-Knowledge Circuit Verification**: `25 / 100` (Proof validation absent)
- **Hardware Enclave & WebAuthn PRF**: `15 / 100` (Stubbed)
- **Overall Cryptographic Protocol Score**: **65.2 / 100**
