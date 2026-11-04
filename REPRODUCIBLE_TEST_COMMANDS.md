# SOVRA — REPRODUCIBLE TEST COMMANDS RUNBOOK

**Audit Date:** November 4, 2026  
**Auditor:** Independent External Security Reviewer  
**Commit:** `a8ed7da` on `remediation/critical-security-hardening`  

This runbook provides the exact, copy-pasteable CLI commands and scripts required to independently reproduce every test, finding, and vulnerability reported during the zero-trust audit.

---

## 1. PRE-REQUISITES & ENVIRONMENT SETUP

Ensure you are at the repository root `D:\Sovra`:
```powershell
cd D:\Sovra
git checkout remediation/critical-security-hardening
git rev-parse HEAD
# Output must match: a8ed7da66d4934045aafc1f60ecef8bb4f757fee
```

If testing live HTTP endpoints, ensure the server daemon is active:
```powershell
node --max-old-space-size=4096 --experimental-strip-types scripts/dev-server.ts
```

---

## 2. GATE 1: GIT & BUILD INTEGRITY REPRODUCTION

### Check Working Tree Status
```powershell
git status
```
*Expected Output:* `nothing to commit, working tree clean`.

### Execute Production Build Check
```powershell
npm run test:prod-build
```
*Expected Output:* Code check passes for dev-server and database-engine; bundle generated at `apps/sovra-app/dist/bundle.js`.

### Run Fast Test Suite
```powershell
npm run test:fast
```
*Expected Output:* 5 test files passed, 34/34 tests passed.

---

## 3. GATE 2: ZK / GROTH16 CRYPTOGRAPHY REPRODUCTION

### 3.1 Test VKey Curve Point Soundness (SEC-01-A)
```powershell
node --experimental-strip-types -e "
import { bn254 } from 'file:///D:/Sovra/node_modules/.pnpm/node_modules/@noble/curves/bn254.js';
import { DEFAULT_SEMAPHORE_HUMANITY_VKEY } from 'file:///D:/Sovra/packages/crypto/src/zk.ts';

const p = bn254.fields.Fp.ORDER;
const x = BigInt(DEFAULT_SEMAPHORE_HUMANITY_VKEY.vk_alpha_1[0]);
const y = BigInt(DEFAULT_SEMAPHORE_HUMANITY_VKEY.vk_alpha_1[1]);
console.log('y^2 mod p == x^3 + 3 mod p:', (y*y)%p === (x*x*x + 3n)%p);

try {
  bn254.G1.ProjectivePoint.fromAffine({ x, y }).assertValidity();
} catch (e) {
  console.log('Observed Error:', e.message);
}
"
```
*Expected Output:*
```text
y^2 mod p == x^3 + 3 mod p: false
Observed Error: bad point: equation left != right
```

### 3.2 Test Mathematical Bilinear Pairing Engine
```powershell
node --experimental-strip-types scratch/test_valid_groth16.ts
```
*Expected Output:*
```text
Valid proof test result: { valid: true, reason: 'OK' }
Tampered proof test result: { valid: false, reason: 'Bilinear pairing check failed...' }
Wrong public input test result: { valid: false, reason: 'Bilinear pairing check failed...' }
```

### 3.3 Exploit Client-Controlled VKey Humanity Badge Forgery (SEC-01-B)
```powershell
node --experimental-strip-types scratch/test_zk_api_vkey_bypass.ts
```
*Expected Output:*
```text
HTTP Status: 200
Response Body: {"ok":true,"badge":"🛡️ ZK-Human","isHuman":true,"isVerifiedHuman":true,...}
```

### 3.4 Test Semaphore Nullifier Replay Defense
```powershell
node --experimental-strip-types scratch/test_nullifier_replay.ts
```
*Expected Output:*
```text
[ATTEMPT_1] Status: 200
[ATTEMPT_2_REPLAY] Status: 409
[ATTEMPT_2_REPLAY] Body: {"ok":false,"error":"Nullifier has already been spent..."}
```

### 3.5 Test Concurrent Nullifier Race Condition
```powershell
node --experimental-strip-types scratch/test_race_nullifier.ts
```
*Expected Output:*
```text
Summary: Successes: 1, Conflicts: 4
```

---

## 4. GATE 3: WEBAUTHN PRF FAILURE REPRODUCTION

### Execute Failing Vitest E2E Test (SEC-02-B)
```powershell
npx vitest run tests/e2e/webauthn-prf-enclave.test.ts
```
*Expected Output:*
```text
FAIL tests/e2e/webauthn-prf-enclave.test.ts > verifies client UI exposes loginWithHardwareEnclavePrf authentication hook
AssertionError: expected '...' to contain 'deriveKeyFromWebAuthnPrf'
Tests: 1 failed | 4 passed (5)
```

---

## 5. GATE 4: SESSION & KEY SECURITY AUDIT (SEC-07-A)

### Scan LocalStorage Token Usages
```powershell
Select-String -Path "scripts/dev-server.ts" -Pattern "localStorage\.setItem\('sovra_session_token'"
```
*Expected Output:* Proves lines 33051, 33136, and 33574 store unencrypted bearer tokens into `localStorage`.

---

## 6. GATE 5: COMPLETE DATA ERASURE & WAL FORENSICS

### Run Autonomous Expiry & Forensic Disk Scan
```powershell
node --experimental-strip-types scratch/test_forensic_erasure.ts
```
*Expected Output:*
```text
SQLite query after 18s:                     DELETED from direct_messages table (SUCCESS)
Notification A (with data.messageId):        PURGED (SUCCESS)
Notification B (with targetId: msgId):       PURGED (SUCCESS)
Forensic raw-bytes in SQLite DB file:        CLEARED from binary
Forensic raw-bytes in SQLite WAL file:       FOUND in binary (Forensically recoverable until checkpoint)
```

---

## 7. GATE 6: PRIVACY & TELEMETRY AUDIT

### Inspect Wiretap Telemetry Table Schema
```powershell
node --experimental-strip-types -e "
import DatabaseSync from 'node:sqlite';
const db = new DatabaseSync.DatabaseSync('.sovra-storage-dev/sovra-social.sqlite');
const table = db.prepare(\"SELECT sql FROM sqlite_master WHERE name='admin_wiretap_telemetry'\").get();
console.log(table.sql);
"
```
*Expected Output:* Shows `ip_address TEXT`, `did TEXT`, and `timestamp INTEGER` in the same relational schema.

---

## 8. GATE 7: API & BACKEND SECURITY

### Test Rate Limit Bypass Removal (SEC-05-A)
```powershell
node --experimental-strip-types scratch/test_auth_ratelimit.ts
```
*Expected Output:*
```text
Sent 50 requests to /api/user/login with x-sovra-benchmark header.
Result: Non-429: 30, 429 Rate Limited: 20
```

### Execute Adversarial BOLA / IDOR Matrix
```powershell
npx vitest run tests/security/adversarial-bola-idor-matrix.test.ts
```
*Expected Output:* 17 passed (17).

---

## 9. GATE 8: FRONTEND & PRODUCT SECURITY

### Scan Production Bundle for Leaked Private Keys
```powershell
Select-String -Path "apps/sovra-app/dist/bundle.js" -Pattern "(BEGIN PRIVATE KEY|ADMIN_SECRET|sk_live)"
```
*Expected Output:* No matches found.

---

## 10. GATE 9: DEPLOYMENT & ENVIRONMENT VALIDATION

### Run Environment Fail-Closed Test
```powershell
node --experimental-strip-types scratch/test_env_validator.ts
```
*Expected Output:*
```text
Test 1 (Prod without ADMIN_SECRET_KEY) valid: false Errors: ['CRITICAL: ADMIN_SECRET_KEY... required']
Test 2 (Prod with insecure default key) valid: false Errors: ['CRITICAL: Default or demo ADMIN_SECRET_KEY... forbidden']
Test 3 (Prod with strong secrets) valid: true Errors: []
```

---

## 11. GATE 10: INDEPENDENT PERFORMANCE VALIDATION

### Execute 20-Worker Concurrency Load Test
```powershell
node --experimental-strip-types scratch/independent_load_test.ts
```
*Expected Output:*
```text
Total Requests Completed: ~7,700 in 5.00s
Throughput: ~1,550 req/sec
p50 Latency: < 15 ms
p95 Latency: < 40 ms
p99 Latency: < 60 ms
```
