# SOVRA — VERIFIED SECURITY CLAIMS MATRIX

**Verification Date:** November 4, 2026  
**Auditor:** Independent External Security Reviewer  
**Commit Inspected:** `a8ed7da` on `remediation/critical-security-hardening`  
**Standard:** Zero-Trust Empirical Verification  

This document details all security controls and remediation claims that have been **independently and empirically proven** to function as claimed through direct test execution and code analysis.

---

### CLAIM 1: Removal of Benchmark Rate-Limiting Backdoor (SEC-05)

- **Finding ID:** `SEC-05-VERIFIED`
- **Severity:** HIGH (Remediated)
- **Exact File & Line:** `scripts/dev-server.ts:89425-89430`
- **Description:** Previously, the HTTP header `x-sovra-benchmark: sovereign_synthetic_load_gate_bypass` permitted unauthorized callers to completely bypass API rate limiting. This header was stripped from production routing in commit `a8ed7da`.
- **Reproduction Command:**
  ```powershell
  node --experimental-strip-types scratch/test_auth_ratelimit.ts
  ```
- **Actual Observed Output:**
  ```text
  Sent 50 requests to /api/user/login with x-sovra-benchmark header.
  Result: Non-429: 30, 429 Rate Limited: 20
  ```
- **Expected Output:** Exactly 30 requests permitted (auth token bucket capacity), subsequent requests rejected with `HTTP 429 Too Many Requests`.
- **Evidence:** Code grep across all files for `x-sovra-benchmark` returned 0 occurrences. Endpoint strictly returned HTTP 429 despite attacker-provided header.
- **Limitations:** Only protects against callers from a single IP. If caller controls multiple IPs and proxy headers are trusted, distributed requests can still consume capacity.
- **Status:** **VERIFIED**

---

### CLAIM 2: Semaphore Nullifier Replay Defense (ZK Humanity)

- **Finding ID:** `ZK-NULLIFIER-REPLAY-VERIFIED`
- **Severity:** CRITICAL (Remediated)
- **Exact File & Line:** `scripts/routes/zk.routes.ts:74-80`
- **Description:** Double-spending or replaying a spent Semaphore nullifier hash across humanity verification attempts is blocked with HTTP 409 Conflict.
- **Reproduction Command:**
  ```powershell
  node --experimental-strip-types scratch/test_nullifier_replay.ts
  ```
- **Actual Observed Output:**
  ```text
  Sending first attempt:
  [ATTEMPT_1] Status: 200
  [ATTEMPT_1] Body: {"ok":true,"badge":"🛡️ ZK-Human", ...}
  Sending replay attempt with identical nullifier:
  [ATTEMPT_2_REPLAY] Status: 409
  [ATTEMPT_2_REPLAY] Body: {"ok":false,"error":"Nullifier has already been spent. Humanity attestation replay prevented."}
  ```
- **Expected Output:** Second request with identical nullifier must be rejected with HTTP 409.
- **Evidence:** `sovraDb.getZkAttestationByNullifier(nullifier)` lookup and `sovraDb.registerZkAttestation()` atomically prevent duplicate registrations.
- **Limitations:** Dependent on persistence of `zk_attestations` database table. If database is wiped or rolled back, replay protection is reset.
- **Status:** **VERIFIED**

---

### CLAIM 3: Concurrent Nullifier Race Condition Defense

- **Finding ID:** `ZK-NULLIFIER-RACE-VERIFIED`
- **Severity:** HIGH (Remediated)
- **Exact File & Line:** `scripts/routes/zk.routes.ts:74-80, 133-137`
- **Description:** Simultaneous concurrent submissions of the identical nullifier from different threads or sessions cannot cause duplicate human badges to be awarded.
- **Reproduction Command:**
  ```powershell
  node --experimental-strip-types scratch/test_race_nullifier.ts
  ```
- **Actual Observed Output:**
  ```text
  Firing 5 concurrent requests with the identical nullifier: race_nullifier_1793800763575
  Req 1: Status 200 - {"ok":true,"badge":"🛡️ ZK-Human", ...}
  Req 2: Status 409 - {"ok":false,"error":"Nullifier has already been spent..."}
  Req 3: Status 409 - {"ok":false,"error":"Nullifier has already been spent..."}
  Req 4: Status 409 - {"ok":false,"error":"Nullifier has already been spent..."}
  Req 5: Status 409 - {"ok":false,"error":"Nullifier has already been spent..."}
  Summary: Successes: 1, Conflicts: 4
  ```
- **Expected Output:** Exactly 1 success (HTTP 200) and 4 conflicts (HTTP 409).
- **Evidence:** All 4 concurrent racing calls received HTTP 409.
- **Limitations:** Verified under single Node.js process runtime. Multi-process clustering requires distributed Redis or SQLite immediate transaction locking.
- **Status:** **VERIFIED**

---

### CLAIM 4: BN254 Groth16 Bilinear Pairing Equation Engine

- **Finding ID:** `ZK-PAIRING-ENGINE-VERIFIED`
- **Severity:** CRITICAL (Remediated)
- **Exact File & Line:** `packages/crypto/src/zk.ts:49-166`
- **Description:** The mathematical Groth16 verifier implements genuine BN254 bilinear pairing checks $e(-\pi_a, \pi_b) \cdot e(\alpha, \beta) \cdot e(L, \gamma) \cdot e(\pi_c, \delta) == 1$ in $F_{p^{12}}$ using `@noble/curves/bn254`.
- **Reproduction Command:**
  ```powershell
  node --experimental-strip-types scratch/test_valid_groth16.ts
  ```
- **Actual Observed Output:**
  ```text
  Valid proof test result: { valid: true, reason: 'OK' }
  Tampered proof test result: {
    valid: false,
    reason: 'Bilinear pairing check failed: e(-A,B)*e(alpha,beta)*e(L,gamma)*e(C,delta) != 1'
  }
  Wrong public input test result: {
    valid: false,
    reason: 'Bilinear pairing check failed: e(-A,B)*e(alpha,beta)*e(L,gamma)*e(C,delta) != 1'
  }
  ```
- **Expected Output:** Mathematical vector satisfying the pairing relation returns `{ valid: true }`; tampered points or public inputs fail bilinear pairing.
- **Evidence:** Noble Curves bn254 pairing engine successfully differentiates between valid points and tampered inputs.
- **Limitations:** Only verifies that the pairing arithmetic function is sound. Does not mean the default verification key is valid (see SEC-01-A).
- **Status:** **VERIFIED**

---

### CLAIM 5: Automated Disappearing Message Background Erasure

- **Finding ID:** `DATA-ERASURE-DAEMON-VERIFIED`
- **Severity:** HIGH (Remediated)
- **Exact File & Line:** `scripts/dev-server.ts:100768-100772`, `scripts/database-sqlite.ts:344-355`
- **Description:** Expired disappearing messages are automatically purged by a 15-second background interval daemon without requiring any HTTP request or client trigger.
- **Reproduction Command:**
  ```powershell
  node --experimental-strip-types scratch/test_forensic_erasure.ts
  ```
- **Actual Observed Output:**
  ```text
  SQLite direct query immediately after insert: FOUND
  2. Waiting 18 seconds for dev-server 15s background daemon to fire...
  3. Storage audit after 18s (zero HTTP requests triggered):
  SQLite query after 18s: DELETED from direct_messages table (SUCCESS)
  Notification A (with data.messageId): PURGED (SUCCESS)
  Notification B (with targetId: msgId): PURGED (SUCCESS)
  Forensic raw-bytes in SQLite DB file: CLEARED from binary
  ```
- **Expected Output:** Expired message deleted from `direct_messages` SQLite table and associated notifications cleared.
- **Evidence:** Direct SQLite database query returned NULL after 18 seconds.
- **Limitations:** Plaintext remains temporarily recoverable in SQLite WAL file until checkpoint or vacuum (see SEC-03-B).
- **Status:** **VERIFIED**

---

### CLAIM 6: BOLA / IDOR Authorization Protection

- **Finding ID:** `API-BOLA-IDOR-VERIFIED`
- **Severity:** HIGH (Remediated)
- **Exact File & Line:** `scripts/dev-server.ts:89600-90800`
- **Description:** Complete defense against Broken Object Level Authorization (BOLA/IDOR) across feed posts, comments, sessions, and relationships.
- **Reproduction Command:**
  ```powershell
  npx vitest run tests/security/adversarial-bola-idor-matrix.test.ts
  ```
- **Actual Observed Output:**
  ```text
  RUN  v3.2.7 D:/Sovra
  ✓ tests/security/adversarial-bola-idor-matrix.test.ts (17 tests) 224ms
  Test Files  1 passed (1)
       Tests  17 passed (17)
  ```
- **Expected Output:** 17/17 adversarial tests pass; attempts by unauthorized users to edit posts, delete comments, revoke sessions, or alter post visibility return HTTP 403 Forbidden.
- **Evidence:** All 17 tests passed cleanly against the live HTTP endpoint.
- **Limitations:** Evaluated against simulated bearer session tokens; relies on token integrity.
- **Status:** **VERIFIED**

---

### CLAIM 7: Production Environment Fail-Closed Secrets Enforcement

- **Finding ID:** `OPS-ENV-FAILCLOSED-VERIFIED`
- **Severity:** HIGH (Remediated)
- **Exact File & Line:** `scripts/env-validator.ts:42-80`
- **Description:** The application refuses to start in `NODE_ENV=production` if `ADMIN_SECRET_KEY` is missing or set to an insecure default secret.
- **Reproduction Command:**
  ```powershell
  node --experimental-strip-types scratch/test_env_validator.ts
  ```
- **Actual Observed Output:**
  ```text
  Test 1 (Prod without ADMIN_SECRET_KEY) valid: false Errors: [
    'CRITICAL: ADMIN_SECRET_KEY environment variable is required in production.'
  ]
  Test 2 (Prod with insecure default key) valid: false Errors: [
    'CRITICAL: Default or demo ADMIN_SECRET_KEY is strictly forbidden in production.'
  ]
  Test 3 (Prod with strong secrets) valid: true Errors: []
  ```
- **Expected Output:** `valid: false` when secrets are absent or weak; `valid: true` only when strong keys are supplied.
- **Evidence:** `validateEnvironment()` returns false and halts startup in production mode.
- **Limitations:** Only applies when `NODE_ENV === 'production'`. Development mode permits default secrets.
- **Status:** **VERIFIED**
