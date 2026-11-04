# SOVRA — PRODUCTION DEPLOYMENT RELEASE GATE & RUNBOOK

**Release Target:** SOVRA v0.1.0-apex  
**Audit Decision:** **NO-GO** 🛑  
**Date:** November 4, 2026  
**Auditor:** Independent Production Security Gatekeeper  
**Evaluation Standard:** Zero-Trust Production Readiness Framework  

---

## 1. RELEASE GATE DECISION

### Formal Determination: **NO-GO**

The release candidate at commit `a8ed7da` on branch `remediation/critical-security-hardening` is **REJECTED** for general production deployment.

Production deployment is barred due to unresolved critical cryptographic flaws (forgeable humanity attestations via client-controlled verification keys and invalid default elliptic curve points), incomplete WebAuthn PRF integration, plaintext session tokens in `localStorage` (`SEC-07`), forensic WAL data retention, and runtime V8 ArrayBuffer out-of-memory crashes.

---

## 2. GATE STATUS SCORECARD

| Production Gate | Evaluated Standard | Status | Release Impact |
| :--- | :--- | :--- | :--- |
| **Gate 1: Build & Integrity** | Clean tree, complete builds, no swallowed tests | **PARTIALLY VERIFIED** | Test suite contains failing E2E test and swallowed test assertions. |
| **Gate 2: ZK / Groth16** | Semaphore humanity verification soundness | **FAILED** | **BLOCKER:** VKey coordinates invalid; client-controlled VKey bypasses verification. |
| **Gate 3: WebAuthn PRF** | Hardware Enclave Passkey Key Derivation | **FAILED** | **BLOCKER:** Frontend integration is a no-op toast; does not derive keys or log in. |
| **Gate 4: Session Security** | Token storage isolation, XSS/CSRF defenses | **FAILED** | **BLOCKER:** Plaintext tokens in `localStorage`; `SEC-07` remains OPEN. |
| **Gate 5: Data Erasure** | Complete physical deletion of ephemeral messages | **PARTIALLY VERIFIED** | Relational rows deleted, but WAL frames retain recoverable plaintext. |
| **Gate 6: Privacy & Telemetry** | IP masking, proxy trust, unlinkable logs | **PARTIALLY VERIFIED** | Telemetry logs link user DID to /24 IP; proxy parsing selects leftmost header. |
| **Gate 7: API Security** | OWASP Top 10, rate limiting, BOLA/IDOR | **VERIFIED** | Backdoors removed; rate limits and BOLA defenses verified functional. |
| **Gate 8: Product Security** | Client bundles, Ghost Mode disclaimers | **PARTIALLY VERIFIED** | Bundles clean; residual wording defect in feature registry. |
| **Gate 9: Operations** | Env validation, secrets handling, process stability | **FAILED** | **BLOCKER:** Server crashed during idle operation due to V8 out-of-memory. |
| **Gate 10: Performance** | Load capacity, p95/p99 latency, rate limiter | **VERIFIED** | Sustained 1,552 req/sec; p50 = 9.9ms, p99 = 54ms. |

---

## 3. MANDATORY CRITERIA FOR RE-EVALUATION

Before any reconsideration for **GO** or **CONDITIONAL GO**, the following remediation steps must be completed and independently re-tested:

### Critical Cryptographic Remediation (P0)
1. **Canonical Semaphore Verification Key:** Replace `DEFAULT_SEMAPHORE_HUMANITY_VKEY` with valid BN254 curve points exported from the canonical Semaphore v3 `.zkey`.
2. **Remove Client-Supplied VKey:** Delete `body.vKey` parsing in `scripts/routes/zk.routes.ts`. Enforce that all proofs are verified strictly against the static server-side verification key.
3. **Connect WebAuthn PRF Flow:** Wire `extResults.prf.results.first` into `deriveKeyFromWebAuthnPrf` in `scripts/dev-server.ts:85203`, derive the Ed25519 signing key, challenge the user, and sign a session payload to complete real authentication.

### Session Hardening (P0)
4. **Remediate SEC-07:** Transition browser session management to `HttpOnly; Secure; SameSite=Strict` cookies. Completely eliminate `localStorage.setItem('sovra_session_token', token)` across the web client.

### Reliability & Forensic Hardening (P1)
5. **V8 Memory Stability:** Investigate and eliminate the large buffer allocations in background daemons (such as automated backup zip generation or brand asset rendering) that caused `v8::ArrayBuffer::NewBackingStore Allocation failed`.
6. **WAL Checkpointing on Purge:** Trigger `PRAGMA wal_checkpoint(TRUNCATE);` following expiring message purges to ensure forensic non-recoverability on disk.

---

## 4. PRODUCTION OPERATIONAL RUNBOOK

For authorized staging or pilot deployments under sandbox conditions, follow this operational runbook:

### 4.1 Required Production Environment Variables
```bash
NODE_ENV=production
PORT=3001
SOVRA_P2P_PORT=4001
SOVRA_STORAGE_DIR=/var/lib/sovra/storage
ADMIN_SECRET_KEY=<generate-random-64-character-hex-string>
TURN_SECRET=<generate-random-64-character-hex-string>
SOVRA_ALLOWED_ORIGINS=https://sovra.network
SOVRA_TRUST_PROXY=private
```

### 4.2 Startup Command
```bash
node --max-old-space-size=4096 --experimental-strip-types scripts/dev-server.ts
```

### 4.3 Database Migration & Rollback Runbook
1. Check current schema version:
   ```bash
   sqlite3 /var/lib/sovra/storage/sovra-social.sqlite "SELECT MAX(version) FROM schema_migrations;"
   ```
2. Verify migrations:
   ```bash
   node --experimental-strip-types scripts/database-migrations.ts
   ```
3. Backup snapshot prior to migration:
   ```bash
   sqlite3 /var/lib/sovra/storage/sovra-social.sqlite "VACUUM INTO '/var/lib/sovra/backups/pre_mig_backup.sqlite';"
   ```

### 4.4 Automated Alerting & Telemetry Metrics
- **Node Status Endpoint:** `GET /api/status` (Health, memory, event loop lag, connected P2P peers).
- **Admin Metrics Endpoint:** `GET /api/admin/metrics` (Requires `ADMIN_SECRET_KEY` bearer token).
- **Process Memory Alert Threshold:** Trigger alert if Node RSS exceeds 1,500 MB or event loop latency exceeds 100 ms.
