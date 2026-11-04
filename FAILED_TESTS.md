# SOVRA — COMPREHENSIVE FAILED & DEFICIENT TESTS REGISTER

**Audit Date**: 2026-11-04  
**Audit Entity**: Multidisciplinary Enterprise Technology Audit Organization  
**Auditor Roles**: QA Automation Engineer & Backend Security Researcher  
**Status**: ACTIVE COMPILATION OF EMPIRICALLY CONFIRMED FAILURES  
**Strict Statuses Applied**: FAILED / PARTIALLY VERIFIED

---

## 1. SUMMARY OF FAILED & DEFICIENT TEST RESULTS

```
Total Empirical Tests Executed: 42
Tests Passed: 35
Tests Failed / Deficient: 7
```

---

## 2. DETAILED FAILED TEST PROFILES

### TEST-01: Bogus ZK-SNARK Proof Acceptance (Circuit Bypass)
- **Status**: **FAILED**
- **Test File**: `scratch/audit_suite/adversarial_test_runner.cjs`
- **Target Endpoint**: `POST /api/zk/humanity/verify`
- **Command**: `node scratch/audit_suite/adversarial_test_runner.cjs`
- **Sent Payload**:
  ```json
  {
    "proof": { "pi_a": ["0x00"], "pi_b": [["0x00"]], "pi_c": ["0x00"] },
    "publicSignals": ["0xdeadbeef"],
    "nullifierHash": "nullifier_adversarial_bogus_proof"
  }
  ```
- **Expected Result**: `HTTP 400 Bad Request` or `HTTP 422 Unprocessable Entity` ("Invalid cryptographic SNARK proof: bilinear pairing check failed").
- **Actual Received Result**: `HTTP 200 OK`
  ```json
  { "ok": true, "verified": true }
  ```
- **Root Cause**: `scripts/routes/zk.routes.ts:55-107` omits `snarkjs.groth16.verify()`.
- **Severity**: **CRITICAL**

---

### TEST-02: Rate Limiter Debug Header Backdoor Bypass
- **Status**: **FAILED**
- **Test File**: `scratch/audit_suite/perf_benchmark.cjs`
- **Target Endpoint**: `GET /api/watch/videos`
- **Command**: Rapid-fire burst of 30 concurrent GET requests with header `'x-sovra-benchmark': 'true'`
- **Expected Result**: At least 20 requests throttled with `HTTP 429 Too Many Requests`.
- **Actual Received Result**:
  ```
  BYPASS TEST RESULT: { '200': 30 } (Zero requests throttled!)
  ```
- **Root Cause**: `scripts/dev-server.ts:89390` explicitly disables rate limiting if `req.headers['x-sovra-benchmark'] === 'true'`.
- **Severity**: **HIGH**

---

### TEST-03: WebAuthn Hardware Enclave PRF Implementation Stub
- **Status**: **FAILED**
- **Test File**: `scripts/dev-server.ts:85167-85180`
- **Function**: `loginWithHardwareEnclavePrf()`
- **Expected Result**: Invocation of `navigator.credentials.get({ publicKey: { extensions: { prf: ... } } })` returning raw salt bits.
- **Actual Received Result**:
  ```javascript
  console.log('[Enclave] deriveKeyFromWebAuthnPrf active for seed-phrase-less master key derivation');
  ```
- **Severity**: **HIGH**

---

### TEST-04: Ghost Mode Real IP Exposure in Server Telemetry
- **Status**: **FAILED**
- **Test Execution**: Toggled Ghost Mode ON in client; sent request to server.
- **Expected Result**: Client IP masked via proxy/mixnet or suppressed from server logs.
- **Actual Received Result**: Real client IP address `127.0.0.1` immediately logged into SQLite `admin_wiretap_telemetry` table.
- **Root Cause**: Ghost Mode is purely a CSS class toggle (`is-ghost`) in `scripts/dev-server.ts:47245-47280`.
- **Severity**: **MEDIUM**

---

### TEST-05: Missing `package.json` in `services/api`
- **Status**: **FAILED**
- **Test Suite**: `tests/security/dependency-boundaries.test.ts`
- **Command**: `npx vitest run tests/security/dependency-boundaries.test.ts`
- **Failure Output**:
  ```
  FAIL tests/security/dependency-boundaries.test.ts > Architectural Dependency Boundaries Enforcement > guarantees that NO package, node, or service depends on the Company Admin Panel
  Error: ENOENT: no such file or directory, open 'D:\Sovra\services\api\package.json'
  ```
- **Root Cause**: `services/api` was scaffolded without completing package initialization.
- **Severity**: **MEDIUM**

---

### TEST-06: Missing `tsconfig.json` in `services/api`
- **Status**: **FAILED**
- **Test Suite**: `tests/security/dependency-boundaries.test.ts`
- **Command**: `npx vitest run tests/security/dependency-boundaries.test.ts`
- **Failure Output**:
  ```
  FAIL tests/security/dependency-boundaries.test.ts > Architectural Dependency Boundaries Enforcement > verifies that all packages have valid package.json and tsconfig.json files
  AssertionError: expected false to be true
  ```
- **Severity**: **LOW**

---

### TEST-07: Disappearing Message Foreground-Only Purge
- **Status**: **PARTIALLY VERIFIED (Failed physical background purge)**
- **Target Endpoint**: `GET /api/chat/messages`
- **Test Execution**: Sent 1s TTL message. Checked disk at t=2.5s without making API call.
- **Result**: Plaintext ciphertext and record remained in database file. Purge was only triggered once the client performed a manual GET request.
- **Severity**: **HIGH**
