# SOVRA — PHASE 1 AUTHENTICATION ATTACK MATRIX
**Task ID:** TSK-P0-01 (Adversarial Identity Authentication Audit)  
**Auditor Role:** Senior Application Security Auditor  
**Audit Scope:** 12 Core Authentication & Replay Vectors in `resolvePrincipal()` and Associated Handlers  
**Primary Artifact Inspected:** `scripts/dev-server.ts#L89140-L89350` & `services/api/src/`  
**Evaluation Standard:** Zero-Trust Cryptographic & Replay Resilience  
**Overall Section Verdict:** ⚠️ **PARTIALLY MITIGATED (CRITICAL FLAWS REMAIN)**

---

## 1. COMPREHENSIVE ATTACK VECTOR EVALUATION

| Vector # | Attack Vector Description | Severity | Theoretical Flaw Present? | Test Verified? | Vector Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **VEC-01** | Arbitrary DID Header Spoofing (`X-Sovra-DID` only) | Critical | No (in `dev-server.ts`); Yes (in `services/api`) | Yes (`did_spoofing.test.ts`) | **PARTIALLY MITIGATED** |
| **VEC-02** | Forged / Invalid Ed25519 Signatures | Critical | No | Yes (`did_spoofing.test.ts`) | **VERIFIED DEFENDED** |
| **VEC-03** | Request Body Tampering / Missing Body Hash | High | **YES (Critical Design Flaw)** | No test covers body integrity | ❌ **VULNERABLE / FAILED** |
| **VEC-04** | HTTP Method & Path Binding Bypass | High | No | Yes (`did_spoofing.test.ts`) | **VERIFIED DEFENDED** |
| **VEC-05** | Expired Timestamps Replay (> 300s) | High | No | Yes (`did_spoofing.test.ts`) | **VERIFIED DEFENDED** |
| **VEC-06** | Future Timestamps Clock Drift (> 60s) | Medium | No | Yes (`did_spoofing.test.ts`) | **VERIFIED DEFENDED** |
| **VEC-07** | Replay Nonce Re-submission | High | No | Yes (`did_spoofing.test.ts`) | **VERIFIED DEFENDED** |
| **VEC-08** | Concurrent Replay Race Conditions | High | Potential across cluster/workers | In-memory atomic check only | ⚠️ **CONDITIONAL PASS** |
| **VEC-09** | Cross-User Nonce Scoping Flaw (Global DoS) | Medium | **YES (Design Flaw)** | No test checks multi-DID nonces | ❌ **VULNERABLE / FAILED** |
| **VEC-10** | Nonce Expiry & Storage Garbage Collection | Low | No | Code verified (10m TTL / 60s sweep) | **VERIFIED DEFENDED** |
| **VEC-11** | Request Memoization & Caching Bypass | Medium | No | Verified before dispatch | **VERIFIED DEFENDED** |
| **VEC-12** | Legitimate Authenticated Traffic Compatibility | Critical | Yes (E2E admin tests broken) | E2E suite fails (exit code 1) | ❌ **VULNERABLE / FAILED** |

---

## 2. DETAILED VECTOR-BY-VECTOR AUDIT

### Vector 01: Arbitrary DID Header Spoofing (`X-Sovra-DID`)
- **Threat Scenario:** An attacker injects `X-Sovra-DID: did:sovra:victim_user` or `X-Sovra-DID: did:sovra:admin_root` without cryptographic signatures to hijack identity.
- **Code Inspection:**
  - `scripts/dev-server.ts#L89246-L89255`:
    ```typescript
    const hasSig = !!req.headers['x-sovra-signature'];
    const hasDID = !!req.headers['x-sovra-did'];
    if (hasDID && !hasSig) {
      return null; // Explicitly reject spoofed DID headers lacking signature
    }
    ```
  - `services/api/src/controllers/wallet.controller.ts#L63`:
    ```typescript
    const userDid = (req.headers['x-sovra-did'] as string) || 'default_user';
    ```
- **Auditor Assessment:** In `scripts/dev-server.ts`, arbitrary DID headers alone are strictly rejected and return `null`. However, in the microservice `services/api`, arbitrary `X-Sovra-DID` headers are trusted directly without signature verification.
- **Verdict:** **PARTIALLY MITIGATED** (Secured in monolithic dev-server, completely broken in `services/api`).

---

### Vector 02: Forged / Invalid Ed25519 Signatures
- **Threat Scenario:** An attacker crafts a random or malformed Ed25519 signature to impersonate a registered DID.
- **Code Inspection:**
  - `scripts/dev-server.ts#L89260-L89285`:
    - Public key is fetched from `dids` table (`signing_public_key`).
    - Standard Node.js `crypto.verify(null, Buffer.from(payload), pubKeyObj, Buffer.from(sig, 'hex'))` is executed.
    - If verification returns `false`, `resolvePrincipal()` returns `null`.
- **Test Evidence:** `tests/security/did_spoofing.test.ts` (Case: "rejects request with forged signature") passed with HTTP 401.
- **Verdict:** **VERIFIED DEFENDED**.

---

### Vector 03: Request Body Tampering / Missing Body Hash (Body Integrity)
- **Threat Scenario:** A man-in-the-middle or upstream proxy alters the JSON payload of an authenticated request (e.g., changing recipient DID or transfer amount from 10 to 1,000,000 tokens) while leaving the headers untouched.
- **Code Inspection:**
  - `scripts/dev-server.ts#L89275`:
    ```typescript
    const canonicalPayload = `${req.method}:${canonicalPath}:${nonce}:${timestamp}`;
    ```
- **Auditor Finding:** **CRITICAL DESIGN FLAW**.
  The canonical string signed by the client comprises ONLY:
  1. HTTP Method (`POST`, `GET`, etc.)
  2. Canonical Path (`/api/orders`, `/api/creator/payout`, etc.)
  3. Nonce (`x-sovra-nonce`)
  4. Timestamp (`x-sovra-timestamp`)
  **The request body is completely excluded from the signature!**
  Therefore, any valid signed request sent over HTTP/unencrypted proxy, or intercepted by a malicious proxy/CDN, can have its payload altered arbitrarily without invalidating the cryptographic signature. For example, a signed payment request to transfer 1 SOVRA can be modified in-flight to transfer 100,000 SOVRA to an attacker's address.
- **Required Remediation:**
  The canonical string must include a SHA-256 digest of the raw request body:
  ```typescript
  const bodyHash = crypto.createHash('sha256').update(rawBody || '').digest('hex');
  const canonicalPayload = `${req.method}:${canonicalPath}:${nonce}:${timestamp}:${bodyHash}`;
  ```
- **Verdict:** ❌ **VULNERABLE / FAILED**.

---

### Vector 04: HTTP Method & Path Binding Bypass
- **Threat Scenario:** An attacker captures a valid signed `GET /api/user/balance` request and attempts to replay it against a state-changing endpoint like `POST /api/user/delete` or `POST /api/creator/payout`.
- **Code Inspection:**
  - `canonicalPayload` concatenates `${req.method}:${canonicalPath}`.
  - Path canonicalization strips query strings: `req.url.split('?')[0]`.
- **Test Evidence:** Verified in `tests/security/did_spoofing.test.ts`. Replaying signature from `GET` on `POST` or on a different path fails verification.
- **Verdict:** **VERIFIED DEFENDED**.

---

### Vector 05: Expired Timestamps Replay
- **Threat Scenario:** An attacker intercepts valid signed headers and attempts to replay them hours or days later.
- **Code Inspection:**
  - `scripts/dev-server.ts#L89154-L89162`:
    ```typescript
    const now = Date.now();
    const reqTime = parseInt(timestamp, 10);
    if (isNaN(reqTime)) return false;
    if (now - reqTime > 300000) { // > 5 minutes
      return false;
    }
    ```
- **Test Evidence:** Verified in `tests/security/did_spoofing.test.ts`. Request with `timestamp = now - 301000` is rejected with HTTP 401.
- **Verdict:** **VERIFIED DEFENDED**.

---

### Vector 06: Future Timestamps Outside Permitted Drift
- **Threat Scenario:** An attacker creates a signed request with a timestamp in the far future (e.g. 2 hours ahead) so that it remains replayable indefinitely as time advances.
- **Code Inspection:**
  - `scripts/dev-server.ts#L89163-L89167`:
    ```typescript
    if (reqTime - now > 60000) { // > 1 minute in the future
      return false;
    }
    ```
- **Test Evidence:** Verified in `tests/security/did_spoofing.test.ts`. Request with `timestamp = now + 65000` is rejected with HTTP 401.
- **Verdict:** **VERIFIED DEFENDED**.

---

### Vector 07: Replayed Nonce Re-submission
- **Threat Scenario:** Within the valid 5-minute timestamp window, an attacker captures a valid signed request and replays it identical to the original.
- **Code Inspection:**
  - `scripts/dev-server.ts#L89169-L89174`:
    ```typescript
    if (replayNonceCache.has(nonce)) {
      return false; // Replay detected
    }
    replayNonceCache.set(nonce, reqTime);
    ```
- **Test Evidence:** Verified in `tests/security/did_spoofing.test.ts`. Sequential replay within 100ms is rejected with HTTP 401.
- **Verdict:** **VERIFIED DEFENDED**.

---

### Vector 08: Concurrent Replay Race Conditions
- **Threat Scenario:** An attacker sends identical requests simultaneously across multiple network sockets to trigger a race condition where both requests are processed before the nonce cache is updated.
- **Code Inspection:**
  - In a single Node.js process, JavaScript execution is single-threaded; `replayNonceCache.has()` and `replayNonceCache.set()` execute synchronously in the same event-loop tick before asynchronous I/O begins.
- **Audit Caveat:** If the server is deployed in cluster mode (`pm2 cluster`, Kubernetes pods, or multi-worker threads), the in-memory `Map` is NOT shared across processes. A concurrent request hitting Pod B while Pod A processes the first request will succeed on both pods.
- **Required Remediation:** In multi-node production, replace the local in-memory Map with an atomic Redis `SET <nonce> <timestamp> NX EX 600` operation.
- **Verdict:** ⚠️ **CONDITIONAL PASS** (Safe in single-threaded dev server, unsafe for distributed deployment).

---

### Vector 09: Nonces Scoped to Authenticated Identity (Cross-User DoS)
- **Threat Scenario:**
  - System A generates nonces sequentially or uses deterministic counters (e.g. UUIDs or sequential indices).
  - An attacker observes or predicts the nonce format, generates an identical nonce for their own DID `did:sovra:attacker`, and transmits a request.
  - The victim user attempts to transmit a legitimate request using that nonce.
- **Code Inspection:**
  - `scripts/dev-server.ts#L89141`:
    ```typescript
    const replayNonceCache = new Map<string, number>();
    ```
  - `checkAndRecordReplayNonce(nonce, timestamp)` takes ONLY `nonce` and `timestamp`. It does NOT accept or check `did`!
- **Auditor Finding:** **DESIGN DEFICIENCY**.
  Because nonces are stored globally in `replayNonceCache` without being scoped to the caller's DID:
  1. A low-entropy or colliding nonce from user A locks out user B from using the same nonce.
  2. An attacker can intentionally poison the nonce cache to execute targeted Denial of Service against other users.
- **Required Remediation:**
  The cache key must be scoped to the caller's identity:
  ```typescript
  const cacheKey = `${did}:${nonce}`;
  if (replayNonceCache.has(cacheKey)) return false;
  replayNonceCache.set(cacheKey, reqTime);
  ```
- **Verdict:** ❌ **VULNERABLE / FAILED**.

---

### Vector 10: Nonce Expiry & Storage Cleanup
- **Threat Scenario:** Unbounded memory growth leading to out-of-memory (OOM) crash under sustained traffic.
- **Code Inspection:**
  - `scripts/dev-server.ts#L89143-L89151`:
    ```typescript
    setInterval(() => {
      const cutoff = Date.now() - 600000; // 10 minutes
      for (const [nonce, ts] of replayNonceCache.entries()) {
        if (ts < cutoff) replayNonceCache.delete(nonce);
      }
    }, 60000).unref();
    ```
- **Auditor Assessment:** Nonces are retained for 10 minutes (twice the 5-minute validity window) and pruned cleanly every 60 seconds. `.unref()` prevents the timer from hanging the Node.js event loop on shutdown.
- **Verdict:** **VERIFIED DEFENDED**.

---

### Vector 11: Request Memoization & Caching Bypass
- **Threat Scenario:** HTTP reverse proxies or framework request memoization layers serve cached authentication decisions, allowing replayed requests to bypass the replay validator.
- **Code Inspection:**
  - `checkAndRecordReplayNonce()` executes inside `_doResolvePrincipal()` on every individual incoming request before any caching or route dispatch.
- **Verdict:** **VERIFIED DEFENDED**.

---

### Vector 12: Legitimate Authenticated Traffic Compatibility
- **Threat Scenario:** Security hardening inadvertently breaks legitimate API clients, mobile apps, or admin integrations.
- **Test Evidence:**
  - `tests/e2e/admin-systems-security-api.test.ts` **FAILS** with exit code 1.
  - Specifically, two integration tests fail because the test client uses `x-admin-did` headers without signatures or bearer tokens, which the hardened server rejects.
- **Auditor Finding:** While rejecting unauthenticated requests is the desired security behavior, legitimate administrative tests and scripts are currently broken and incompatible with the server's authentication layer.
- **Verdict:** ❌ **VULNERABLE / FAILED** (Legitimate administrative test workflows currently fail).

---

## 3. SUMMARY OF ATTACK MATRIX VERDICTS

| Status | Count | Percentage |
| :--- | :--- | :--- |
| **VERIFIED DEFENDED** | 6 | 50.0% |
| **CONDITIONAL PASS** | 1 | 8.3% |
| **PARTIALLY MITIGATED** | 1 | 8.3% |
| **VULNERABLE / FAILED** | 4 | 33.3% |

**Auditor Conclusion:** With 4 of 12 attack vectors failing verification (including request body integrity and cross-user nonce scoping), the identity authentication mechanism does NOT satisfy zero-trust production readiness requirements.
