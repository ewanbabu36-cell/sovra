# SOVRA — OPEN BLOCKERS AND RESIDUAL RISKS REPORT

**Audit Date:** November 4, 2026  
**Auditor:** Independent External Security Reviewer  
**Status:** ACTIVE PRODUCTION BLOCKERS  
**Commit:** `a8ed7da` on `remediation/critical-security-hardening`  

This document catalogs every open vulnerability, architectural flaw, and operational risk identified during the zero-trust audit that prevents a production **GO** release.

---

### BLOCKER 1: Invalid Elliptic Curve Points in Default Verification Key (SEC-01-A)

- **Finding ID:** `SEC-01-A`
- **Severity:** **CRITICAL**
- **Exact File & Line:** `packages/crypto/src/zk.ts:171-223`
- **Description:** The hardcoded Semaphore v3 humanity verification key (`DEFAULT_SEMAPHORE_HUMANITY_VKEY`) contains point coordinates for `vk_alpha_1`, `IC[0]`, `IC[1]`, and `IC[2]` that **do not lie on the BN254 elliptic curve**.
- **Reproduction Command:**
  ```powershell
  node --experimental-strip-types scratch/test_vkey.ts
  ```
- **Actual Observed Output:**
  ```text
  Testing VKEY points validity:
  vk_alpha_1 error: bad point: equation left != right
  vk_beta_2 valid: true
  IC[0] error: bad point: equation left != right
  IC[1] error: bad point: equation left != right
  IC[2] error: bad point: equation left != right
  ```
- **Expected Output:** All verification key points must satisfy the BN254 curve equation $y^2 = x^3 + 3 \pmod p$.
- **Impact:** Any genuine Semaphore zero-knowledge proof submitted by a legitimate user will **always be rejected** by `verifyGroth16Proof` with:
  `Cryptographic assertion error: bad point: equation left != right`.
- **Status:** **FAILED**

---

### BLOCKER 2: Client-Controlled Verification Key (VKey Confusion / Forgeable Humanity) (SEC-01-B)

- **Finding ID:** `SEC-01-B`
- **Severity:** **CRITICAL**
- **Exact File & Line:** `scripts/routes/zk.routes.ts:110`
- **Description:** The humanity verification endpoint `/api/zk/humanity/verify` inspects the request body and accepts an arbitrary client-supplied verification key:
  ```typescript
  const vKey = (body.vKey && typeof body.vKey === "object") ? body.vKey : DEFAULT_SEMAPHORE_HUMANITY_VKEY;
  ```
  This allows an attacker to construct a trivial 1-constraint pairing relation and supply both the key and the proof, completely bypassing the actual Semaphore humanity circuit.
- **Reproduction Command:**
  ```powershell
  node --experimental-strip-types scratch/test_zk_api_vkey_bypass.ts
  ```
- **Actual Observed Output:**
  ```text
  HTTP Status: 200
  Response Body: {"ok":true,"badge":"🛡️ ZK-Human","isHuman":true,"isVerifiedHuman":true,"attestation":{"id":"zk_att_...","subjectDid":"did:key:z6Mkhacker_zk_bypass_test","attestationType":"proof_of_humanity", ...}}
  ```
- **Expected Output:** The server must strictly verify proofs against an immutable server-side verification key and reject any client-supplied `vKey` with `HTTP 400 Bad Request`.
- **Impact:** Complete breakdown of the Sybil resistance and humanity verification guarantees. Any attacker can grant themselves or bot clusters verified human badges at will.
- **Status:** **FAILED**

---

### BLOCKER 3: WebAuthn PRF Browser Frontend Incomplete (SEC-02-A & SEC-02-B)

- **Finding ID:** `SEC-02-A`
- **Severity:** **HIGH**
- **Exact File & Line:** `scripts/dev-server.ts:85167-85215`, `tests/e2e/webauthn-prf-enclave.test.ts:67`
- **Description:** The function `loginWithHardwareEnclavePrf` prompts the browser authenticator via `navigator.credentials.get({ publicKey: { extensions: { prf: ... } } })`. However, upon receiving the PRF extension result (`extResults.prf.results.first`), it **only displays a UI toast**:
  ```typescript
  if (extResults.prf && extResults.prf.results && extResults.prf.results.first) {
    showAccountToast("✅ Hardware Enclave PRF seed successfully derived!");
  }
  ```
  It does not import or call `deriveKeyFromWebAuthnPrf`, does not derive the Ed25519 signing key, and does not log the user in.
- **Reproduction Command:**
  ```powershell
  npx vitest run tests/e2e/webauthn-prf-enclave.test.ts
  ```
- **Actual Observed Output:**
  ```text
  FAIL tests/e2e/webauthn-prf-enclave.test.ts > verifies client UI exposes loginWithHardwareEnclavePrf authentication hook
  AssertionError: expected '...' to contain 'deriveKeyFromWebAuthnPrf'
  ```
- **Expected Output:** PRF output must be derived into a cryptographic identity and passed to session authentication; all 5 tests in `webauthn-prf-enclave.test.ts` must pass.
- **Impact:** Users attempting hardware passkey PRF login are shown a success toast, but are not actually logged in or authenticated.
- **Status:** **FAILED**

---

### BLOCKER 4: Plaintext Bearer Session Tokens in LocalStorage (SEC-07-A)

- **Finding ID:** `SEC-07-A`
- **Severity:** **HIGH**
- **Exact File & Line:** `scripts/dev-server.ts:33051, 33136, 33574`
- **Description:** Plaintext bearer tokens and complete user profile records containing the token are continuously written to `localStorage.setItem('sovra_session_token', token)`. Even when encryption into `sovra_session_token_enc` was added, line 33574 simultaneously writes the unencrypted plaintext token right beside it.
- **Reproduction Command:**
  ```powershell
  Select-String -Path "scripts/dev-server.ts" -Pattern "localStorage\.setItem\('sovra_session_token'"
  ```
- **Actual Observed Output:**
  ```text
  scripts\dev-server.ts:33051: try { localStorage.setItem('sovra_session_token', canonicalTok); } catch(e) {}
  scripts\dev-server.ts:33136: try { localStorage.setItem('sovra_session_token', myProfile.sessionToken); } catch(e) {}
  scripts\dev-server.ts:33574: localStorage.setItem('sovra_session_token', token);
  ```
- **Expected Output:** Bearer tokens must be stored exclusively in `HttpOnly; Secure; SameSite=Strict` cookies, completely inaccessible to JavaScript execution context.
- **Impact:** Any DOM-based XSS, supply-chain dependency injection, or malicious extension can read `localStorage.getItem('sovra_session_token')` and compromise the user's account.
- **Status:** **FAILED**

---

### BLOCKER 5: V8 ArrayBuffer Allocation Crash (OPS-01-A)

- **Finding ID:** `OPS-01-A`
- **Severity:** **CRITICAL**
- **Exact File & Line:** Node.js V8 Engine Runtime / `scripts/dev-server.ts`
- **Description:** During idle runtime observation (at ~708,588 ms / 11.8 minutes), the background dev server process crashed unexpectedly with:
  ```text
  FATAL ERROR: v8::ArrayBuffer::NewBackingStore Allocation failed - process out of memory
  ```
- **Reproduction Command:**
  ```powershell
  Get-Content -Path "C:\Users\alamr\.gemini\antigravity\brain\86a0ec53-93fa-4945-8b9f-8299932a847c\.system_generated\tasks\task-132997.log" -Tail 20
  ```
- **Actual Observed Output:**
  ```text
  <--- Last few GCs --->
  [1904:00004998004B8000]   708588 ms: Mark-Compact (reduce) 52.7 (55.6) -> 44.3 (48.1) MB, pooled: 0.0 MB...
  FATAL ERROR: v8::ArrayBuffer::NewBackingStore Allocation failed - process out of memory
  ```
- **Expected Output:** Process must run continuously without memory exhaustion or catastrophic ArrayBuffer allocation failure.
- **Impact:** Production server crashes, terminating all active P2P TCP connections, HTTP sessions, and WebRTC signalling calls.
- **Status:** **FAILED**

---

### RISK 6: SQLite WAL Forensic Plaintext Retention (SEC-03-B)

- **Finding ID:** `SEC-03-B`
- **Severity:** **MEDIUM**
- **Exact File & Line:** `.sovra-storage-dev/sovra-social.sqlite-wal`
- **Description:** Although disappearing message rows are deleted from `direct_messages`, the raw text and ID remain written into WAL page frames on disk until an explicit `wal_checkpoint(TRUNCATE)` or `VACUUM` occurs.
- **Reproduction Command:**
  ```powershell
  node --experimental-strip-types scratch/test_forensic_erasure.ts
  ```
- **Actual Observed Output:**
  ```text
  Forensic raw-bytes in SQLite DB file: CLEARED from binary
  Forensic raw-bytes in SQLite WAL file: FOUND in binary (Forensically recoverable until checkpoint)
  ```
- **Expected Output:** Deletion of disappearing messages must ensure unrecoverability on disk.
- **Impact:** Forensic recovery from storage drives or unencrypted server backups.
- **Status:** **PARTIALLY VERIFIED**

---

### RISK 7: Telemetry Linkability & DID Correlation (SEC-06-A)

- **Finding ID:** `SEC-06-A`
- **Severity:** **MEDIUM**
- **Exact File & Line:** `scripts/database-sqlite.ts:3458-3481`
- **Description:** `admin_wiretap_telemetry` records the client's `did` directly alongside `ip_address` (`/24` subnet) and exact millisecond `timestamp`.
- **Expected Output:** Telemetry must be strictly decoupled from user identity, or ephemeral with zero persistence of user DIDs alongside network addresses.
- **Status:** **PARTIALLY VERIFIED**

---

### RISK 8: Leftmost Proxy IP Spoofing (SEC-06-B)

- **Finding ID:** `SEC-06-B`
- **Severity:** **MEDIUM**
- **Exact File & Line:** `scripts/dev-server.ts:89403-89410`
- **Description:** When `SOVRA_TRUST_PROXY` is configured to `private` or `true`, line 89406 iterates through `X-Forwarded-For` and selects `parts[0]` (the leftmost IP). An adversary can prepend an arbitrary IP to `X-Forwarded-For` to evade rate limiting or spoof telemetry logs.
- **Expected Output:** Secure proxy parsers read the rightmost untrusted hop (`parts[parts.length - 1]`).
- **Status:** **PARTIALLY VERIFIED**
