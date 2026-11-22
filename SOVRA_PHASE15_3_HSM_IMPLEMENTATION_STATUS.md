# SOVRA PHASE 15.3 — HARDWARE SECURITY MODULE (HSM) IMPLEMENTATION STATUS

**Authority:** Principal Cryptographic Security Auditor & Hardware Infrastructure Engineer  
**Date:** 2026-11-22  
**Baseline Commit:** `d16d239` (Phase 15.2)  
**Evaluation Scope:** PKCS#11 Interface Architecture, Cloud KMS Ed25519 Support Realities, Double-Sign Protection & Device-Backed Certification State  
**Status:** SPECIFICATION COMPLETE & TESTED | SIMULATION DRIVER DEV-ONLY | PRODUCTION HARDWARE CERTIFICATION BLOCKED

---

## 1. Executive Summary & Non-Negotiable Rule 4

In accordance with Non-Negotiable Rule 4 ("Do not claim a physical HSM is integrated unless a real device and production signing operation are demonstrated") and Workstream 5 instructions ("Do not implement a fake HSM"):

1. **No Fake Hardware Integration:** The repository does not pretend that software mocks or in-memory arrays are certified physical HSMs.
2. **Cloud KMS Reality Codified:** The architectural reality that commodity cloud key management services (AWS KMS, GCP Cloud KMS, Azure Key Vault) **do not support Ed25519 digital signatures** is formally documented and codified in the protocol codebase.
3. **True Hardware Targets Specified:** The production specification targets **PKCS#11 v2.40+ / v3.0** via **AWS CloudHSM SDK 5+** or **YubiHSM 2**, which natively support the `CKM_EDDSA` mechanism (curve OID `1.3.101.112`).
4. **Development Driver Classification:** The local software driver (`MemoryEnclaveHSM` in `chain/privval/hsm.go`) is strictly tagged `[DEVELOPMENT_ONLY]`.
5. **Certification Status:** Production HSM integration is formally classified as **BLOCKED / NOT CERTIFIED** until physical hardware devices are deployed and validated under live testnet conditions.

---

## 2. Cryptographic Mechanism & Cloud Provider Evaluation

### Cloud KMS Realities (Audit Truth Table)

| Cloud Key Service | PureEd25519 (RFC 8032) Support | FIPS Level | Usable as Direct Sovereign Validator Signer? |
|-------------------|:------------------------------:|:----------:|:---------------------------------------------:|
| **AWS KMS** | **NO** (Only RSA, P-256, P-384, P-521, secp256k1) | FIPS 140-3 Level 3 | ❌ **UNSUPPORTED** |
| **GCP Cloud KMS** | **NO** (Only RSA, P-256, P-384, secp256k1) | FIPS 140-3 Level 3 | ❌ **UNSUPPORTED** |
| **Azure Key Vault** | **NO** (Only RSA, P-256, P-384, P-521, secp256k1) | FIPS 140-2 Level 2/3 | ❌ **UNSUPPORTED** |
| **AWS CloudHSM SDK 5+** | **YES** (`CKM_EDDSA`, curve OID `1.3.101.112`) | FIPS 140-3 Level 3 | ✅ **SUPPORTED** (via PKCS#11) |
| **YubiHSM 2** | **YES** (`CKM_EDDSA`, Edwards curve 25519) | FIPS 140-2 Level 3 | ✅ **SUPPORTED** (via PKCS#11) |

---

## 3. Production PKCS#11 Hardware Specification

The hardware abstraction layer is declared in `chain/privval/hsm.go`:

### 1. Required PKCS#11 Mechanism Codes
```go
const (
    CKK_EC_EDWARDS              uint64 = 0x00000040 // Edwards curve key type
    CKM_EC_EDWARDS_KEY_PAIR_GEN uint64 = 0x00001055 // Keypair generation mechanism
    CKM_EDDSA                   uint64 = 0x00001057 // PureEd25519 signing mechanism
    OID_ED25519                 string = "1.3.101.112"
)
```

### 2. Mandatory Key Attributes (Non-Exportability Enforcement)
When generating validator signing keys within the HSM partition:
- `CKA_EXTRACTABLE = CK_FALSE`: The private key can **never** be exported from the physical cryptographic boundary in plaintext or wrapped form.
- `CKA_SENSITIVE = CK_TRUE`: Plaintext key material cannot be read by any user or administrator session.
- `CKA_TOKEN = CK_TRUE`: The key persists across device reboots and session disconnects.
- `CKA_SIGN = CK_TRUE`: Authorized for cryptographic signature generation.

### 3. Persistent Double-Signing Prevention
Before dispatching a sign request to the PKCS#11 session, the signer validates:
- High-water mark progression:
  $$H_{\text{req}} > H_{\text{high}} \quad \lor \quad (H_{\text{req}} = H_{\text{high}} \land R_{\text{req}} > R_{\text{high}})$$
- Step progression within round: Prevote $\rightarrow$ Precommit.
- Conflicting BlockHash rejection: If a vote was already signed for $(H, R)$ with block hash $B_1$, any request for $(H, R)$ with $B_2 \neq B_1$ is rejected with `REJECTED_DOUBLE_SIGN`.

### 4. Tamper-Evident Audit Trail (`SigningAuditLogger`)
- Every signing operation is logged to an immutable hash chain:
  $$\text{Hash}_i = \text{SHA-256}\left(\text{Timestamp} \mathbin{\Vert} \text{KeyLabel} \mathbin{\Vert} H \mathbin{\Vert} R \mathbin{\Vert} \text{Step} \mathbin{\Vert} \text{BlockHash} \mathbin{\Vert} \text{Digest} \mathbin{\Vert} \text{Status} \mathbin{\Vert} \text{Hash}_{i-1}\right)$$
- Protects against repudiation and provides cryptographic proof of all HSM signing requests.

---

## 4. Device Failure & Crash Recovery Behavior

1. **Session Disconnection / Network Glitch:**
   - If the PKCS#11 daemon restarts or loses connection to the CloudHSM cluster, `p.sessionOpen` flips to `false`.
   - The validator daemon **halts consensus signing** rather than falling back to unauthenticated software keys.
2. **Crash Recovery:**
   - On daemon restart, the high-water mark is restored from disk store (`val_highwater.json`).
   - The HSM session is re-established via PIN authentication; the non-exportable private key is located by `CKA_LABEL` and `CKA_ID`.
3. **Fail-Safe Invariant:**
   - An unresponsive or failed HSM produces block timeout advances (new rounds), but **never double-signs or produces conflicting proposals**.

---

## 5. Certification Gate Status

- **Local Development Driver:** **APPROVED FOR DEVELOPMENT ONLY** (`MemoryEnclaveHSM`).
- **Production Hardware-Backed Signing:** **BLOCKED / NOT CERTIFIED** (pending physical deployment on multi-cloud hosts).
