# SOVRA — CRYPTOGRAPHIC VERIFICATION RESULTS

**Audit Date:** November 4, 2026  
**Auditor:** Independent Cryptographic Reviewer & Senior Security Researcher  
**Target:** BN254 Groth16 Verifier, WebAuthn PRF, Ed25519 Signatures, and DID Key Formats  
**Commit Inspected:** `a8ed7da` on `remediation/critical-security-hardening`  

---

## 1. GROTH16 ZERO-KNOWLEDGE PROOF VERIFIER (BN254)

### 1.1 Architecture & Mathematical Implementation
The Groth16 verifier was introduced in commit `a8ed7da` inside `packages/crypto/src/zk.ts` using `@noble/curves/bn254`.

The verifier executes the 4-pairing bilinear equation over the BN254 pairing-friendly elliptic curve (order $r = 21888242871839275222246405745257275088548364400416034343698204186575808495617$):
$$e(-\pi_a, \pi_b) \cdot e(\alpha_1, \beta_2) \cdot e(L, \gamma_2) \cdot e(\pi_c, \delta_2) = 1 \in F_{p^{12}}$$

Where the public input linear combination $L \in G_1$ is constructed via:
$$L = IC_0 + \sum_{i=1}^{n} x_i \cdot IC_i$$

### 1.2 Mathematical Evaluation of the Pairing Engine
To evaluate whether `verifyGroth16Proof` correctly implements bilinear pairing arithmetic, an independent mathematical test vector was constructed using known generators and discrete scalars on BN254:
- Generator points $G_1, G_2$
- Secret scalars $\alpha = 2, \beta = 3 \implies e(\alpha, \beta) = e(G_1, G_2)^6$
- Proof elements $A = 2 \cdot G_1, B = 3 \cdot G_2 \implies e(-A, B) = e(G_1, G_2)^{-6}$
- Public inputs $x_1 = 1$, $IC_0 = 7 \cdot G_1$, $IC_1 = 11 \cdot G_1 \implies L = 18 \cdot G_1$
- Verifier keys $\gamma = 5 \cdot G_2$, $\delta = 5 \cdot G_2$, and $C = (r - 18) \cdot G_1$

**Empirical Execution Results:**
```text
Valid proof test result:     { valid: true, reason: 'OK' }
Tampered proof test result:  { valid: false, reason: 'Bilinear pairing check failed: e(-A,B)*e(alpha,beta)*e(L,gamma)*e(C,delta) != 1' }
Wrong public input result:   { valid: false, reason: 'Bilinear pairing check failed: e(-A,B)*e(alpha,beta)*e(L,gamma)*e(C,delta) != 1' }
```
**Finding:** The underlying pairing math in `verifyGroth16Proof` is **mathematically sound** and reliably detects tampered proof points and mismatched public signals.

---

### 1.3 CRITICAL FLAW 1: Curve Point Validation Failure in Default VKey (SEC-01-A)
The default Semaphore humanity verification key `DEFAULT_SEMAPHORE_HUMANITY_VKEY` hardcoded at `packages/crypto/src/zk.ts:171` was tested for elliptic curve point validity using `@noble/curves/bn254`:

```typescript
const p = bn254.fields.Fp.ORDER;
// BN254 G1 curve equation: y^2 mod p == (x^3 + 3) mod p
const x = BigInt(DEFAULT_SEMAPHORE_HUMANITY_VKEY.vk_alpha_1[0]);
const y = BigInt(DEFAULT_SEMAPHORE_HUMANITY_VKEY.vk_alpha_1[1]);
const y2 = (y * y) % p;
const x3_3 = (x * x * x + 3n) % p;
```

**Observed Empirical Results:**
```text
BN254 Fp order p: 30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47
y^2 mod p   : 153bb08de33dec5238211939bc052c440ab12da4a608fb81b12f04f02ad2dfa8
x^3+3 mod p : 22657fc95c0baf12c5ebcc5ddd6e7909058703f88743e05ef0ed3fcda9a08fa1
Matches?    : false

Point Assertions:
vk_alpha_1 error: bad point: equation left != right
vk_beta_2 valid:  true
IC[0] error:      bad point: equation left != right
IC[1] error:      bad point: equation left != right
IC[2] error:      bad point: equation left != right
```
**Root Cause:** The coordinates in `DEFAULT_SEMAPHORE_HUMANITY_VKEY` were manually transcribed or synthetically mock-generated rather than exported from a genuine `snarkjs zkey export verification_key`.  
**Consequence:** Any legitimate Semaphore proof verified against this key **fails with a hard exception** inside `@noble/curves`.

---

### 1.4 CRITICAL FLAW 2: Client-Controlled Verification Key Injection (SEC-01-B)
In `scripts/routes/zk.routes.ts`:
```typescript
// Line 110:
const vKey = (body.vKey && typeof body.vKey === "object") ? body.vKey : DEFAULT_SEMAPHORE_HUMANITY_VKEY;
const verificationResult = verifyGroth16Proof(proofObj, publicSignals, vKey);
```

**Vulnerability:** The endpoint accepts a verification key supplied by the HTTP client in `body.vKey`. An attacker can generate their own trivial verification key and matching proof, submit it to `/api/zk/humanity/verify`, and receive a verified badge:

**Live Attack Verification:**
```bash
POST /api/zk/humanity/verify
{
  "subjectDid": "did:key:z6Mkhacker_zk_bypass_test",
  "nullifierHash": "nullifier_test_1793800684456",
  "proof": { "pi_a": [...], "pi_b": [...], "pi_c": [...] },
  "publicSignals": ["1"],
  "vKey": { "vk_alpha_1": [...], "vk_beta_2": [...], ... }
}
```
**Response Received:**
```json
HTTP/1.1 200 OK
{
  "ok": true,
  "badge": "🛡️ ZK-Human",
  "isHuman": true,
  "isVerifiedHuman": true,
  "attestation": {
    "id": "zk_att_1793800684715_f6d663",
    "subjectDid": "did:key:z6Mkhacker_zk_bypass_test",
    "attestationType": "proof_of_humanity",
    "issuerDid": "did:sovra:zk_identity_authority"
  }
}
```
**Severity:** **CRITICAL**. An attacker can forge humanity attestations for an infinite number of arbitrary identities without generating a single valid Semaphore proof.

---

## 2. NULLIFIER ATOMICITY & REPLAY TESTING

The nullifier tracking engine was subjected to sequential and concurrent stress testing:

1. **Sequential Replay:**
   - First submission: `HTTP 200 OK`
   - Second submission with identical nullifier `fixed_static_nullifier_0xdeadbeef1234`: `HTTP 409 Conflict`
   - Response: `{"ok":false,"error":"Nullifier has already been spent. Humanity attestation replay prevented."}`
   - **Verdict:** **VERIFIED**

2. **Concurrent Race Condition:**
   - 5 asynchronous HTTP requests submitted simultaneously with identical nullifier `race_nullifier_1793800763575`
   - Result: Req 1: `HTTP 200`; Reqs 2–5: `HTTP 409 Conflict`
   - **Verdict:** **VERIFIED**

---

## 3. WEBAUTHN PRF KEY DERIVATION EVALUATION

In `packages/crypto/src/webauthn-prf.ts`:
- `deriveKeyFromWebAuthnPrf(prfOutput, domainSalt)` applies HKDF-SHA256 to a minimum 32-byte authenticator PRF output:
  $$\text{Seed} = \text{HKDF-SHA256}(\text{IKM}=\text{prfOutput}, \text{salt}=\text{domainSalt}, \text{info}=\text{'sovra:webauthn:prf:ed25519:v1'}, \text{len}=32)$$
- The resulting 32-byte seed is passed to `generateEd25519KeyPairFromSeed()`, yielding a deterministic `did:key:z6Mk...` identifier.
- Unit tests confirm:
  - Deterministic key generation from identical PRF output.
  - Rejection of inputs $< 32$ bytes.
  - Tamper detection on Ed25519 message signatures.
- **Vulnerability (SEC-02-A):** This derivation engine is **completely uncoupled from the web frontend**. The browser client (`scripts/dev-server.ts:85203`) receives `extResults.prf.results.first` and does not pass it to `deriveKeyFromWebAuthnPrf`.
- **Verdict:** **FAILED AT INTEGRATION LAYER**

---

## 4. SUMMARY OF CRYPTOGRAPHIC GATES

| Component | Standard / Formula | Status | Defect / Vulnerability |
| :--- | :--- | :--- | :--- |
| **Bilinear Pairings** | $e(-\pi_a, \pi_b) \cdot e(\alpha, \beta) \cdot e(L, \gamma) \cdot e(\pi_c, \delta) = 1$ | **VERIFIED** | None in pairing engine itself. |
| **Humanity VKey** | Canonical Semaphore v3 BN254 Key | **FAILED** | Coordinates not on curve ($y^2 \neq x^3 + 3$). |
| **VKey Authorization** | Server-enforced circuit parameters | **FAILED** | `body.vKey` allows client-controlled key injection. |
| **Nullifier Replay** | Unique nullifier hash lookup | **VERIFIED** | Duplicate nullifiers return 409 Conflict. |
| **Race Concurrency** | Atomic insertion lock | **VERIFIED** | 1 permitted, 4 rejected in race test. |
| **WebAuthn PRF** | HKDF-SHA256 $\implies$ Ed25519 keypair | **PARTIAL** | Backend math valid; browser client integration missing. |
| **DID Encoding** | Multicodec `0xed01` + Base58BTC (`did:key:z6Mk...`) | **VERIFIED** | Valid W3C DID format. |
