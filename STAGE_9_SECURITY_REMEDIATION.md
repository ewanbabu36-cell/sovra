# Stage 9 — Phase 2 Security Remediation Report

**Program:** SOVRA Stage 9 — Certification Blocker Closure Program  
**Baseline Preserved:** Stage 8 verdict remains **`NOT TESTED — External Field Certification`** ([STAGE_8_FINAL_CERTIFICATION.md](file:///d:/Sovra/STAGE_8_FINAL_CERTIFICATION.md)).  
**Remediation Date:** `2026-11-26`  
**Root-Cause Reference:** [STAGE_9_SECURITY_ROOT_CAUSE.md](file:///d:/Sovra/STAGE_9_SECURITY_ROOT_CAUSE.md)  
**Policy Compliance:** Zero existing test assertions were weakened, removed, or artificially skipped; existing SQLite schemas, user databases, and identities were preserved (`0` destructive migrations); backward compatibility for non-E2EE channel broadcasts and legacy `SqliteSocialDatabaseEngine.createChatMessage()` callers was retained.

---

## 1. Verified Defects Remediated vs. Non-Product Issues Preserved

| Finding ID | Classification | Remediation Action Taken | Backward Compatibility & Data Preservation |
|---|---|---|---|
| **S9-REM-01** | **Product Defect (Fail-Open Monitoring & `# HELP` Collision)** | Fixed [consensus-monitor.ts:195-198,265-283,305](file:///d:/Sovra/services/api/src/monitoring/consensus-monitor.ts#L195-L307):<br>1. `totalCount === 0` now forces `consensusHalted = true` and `healthy = false`.<br>2. Unreachable `/query/supply` no longer fabricates hardcoded `'30139348240070'` or `masterInvariantHolds: true`; fails closed to `'0'` and `false`.<br>3. Reworded `# HELP sovra_consensus_healthy` line (`1=consensus active within lag threshold, 0=halted or degraded`) so scrapers checking `'sovra_consensus_healthy 1'` cannot false-pass on help text when gauge emits `0`. | Existing `ConsensusHealthSummary` & Prometheus metric names unchanged; no storage/state schema touched. Compiled cleanly via `npm --prefix services/api run build` (`Exit 0`). |
| **S9-REM-02** | **Product Defect (E2EE Fail-Open Storage & Call-Log Mislabeling)** | Fixed [database-engine.ts:4061-4065](file:///d:/Sovra/scripts/database-engine.ts#L4061-L4065) & [call.routes.ts:701](file:///d:/Sovra/scripts/routes/call.routes.ts#L701):<br>1. `SovraDatabaseEngine.appendMessage()` now throws `ERR_CLIENT_E2EE_REQUIRED` fail-closed if `msg.isE2EE === true` without `ciphertextHex`, `ivHex`/`nonceHex`, and `tagHex` — preventing silent plaintext downgrade.<br>2. Fixed system-generated call-log bubble in `call.routes.ts:701` (`isE2EE: true` -> `isE2EE: false`) since plaintext server call logs carry no client ciphertext. | Intentional P0-01 zero-trust guarantees preserved (`server never derives deterministic threadId keys`); `channel:*` / explicit `isE2EE: false` messages still persist cleanly; existing `./.sovra-storage-dev` DB left untouched. |
| **S9-REM-03** | **Targeted Phase 2 Regression Suite Added** | Added [stage9-p2-security-regression.test.ts](file:///d:/Sovra/tests/security/stage9-p2-security-regression.test.ts) (`4` regression tests): empty `rpcUrls` fail-closed, unreachable validator non-fabrication & `# HELP` non-collision, live ephemeral `/status`+`/net_info`+`/query/supply` probe, and `appendMessage()` fail-closed `ERR_CLIENT_E2EE_REQUIRED` + client E2EE + plaintext channel compat. | Uses OS temp dir (`db.getSqliteEngine()?.close()` on teardown) and ephemeral `127.0.0.1:0` HTTP ports — zero mutation of workspace DBs. |
| **S9-NON-01** | **Unchanged — `governance_p0_remediation.test.ts` (`P0-C`)** | Zero source edit to `admin-console.routes.ts` or `governance_p0_remediation.test.ts`. Verified via isolated `dev-server.ts` on `:3001` (`temp` `SOVRA_STORAGE_DIR`): **`32/32 PASS` (`Exit 0`)**. | Live HTTP `admin-console` protections (`401` gating, `403` unilateral prohibition) remain strict. |
| **S9-NON-02** | **Unchanged — `phase10-security-monitoring.test.ts` & CometBFT `26677`/`26687`** | Zero test weakening in [phase10-security-monitoring.test.ts](file:///d:/Sovra/tests/security/phase10-security-monitoring.test.ts). Fixing the `# HELP` collision (`S9-REM-01`) exposed line `122` (`sovra_consensus_healthy 1`) as failing offline alongside line `77` when L1 CometBFT `26657/26667/26677/26687` daemons are stopped under IA-01. | `SOVRA-CORE` remains L1-independent per IA-01 (`SOVRA_ENABLE_EXT_CONSENSUS` unset by default). |
| **S9-NON-03** | **Unchanged — `phase7-governance-e2ee-adversarial.test.ts`** | Pre-`P0-01` assertions expecting `'Double Ratchet'` badge and removed deterministic server-side `AES-GCM-256` fallback were intentionally preserved untouched (`2 failed | 11 passed`) rather than weakening/rewriting security history or restoring server key derivation. | Preserves `P0-01` client-only E2EE guarantee verified by [target_e2ee_client_side_hardening.test.ts](file:///d:/Sovra/tests/security/target_e2ee_client_side_hardening.test.ts) (`9/9 PASS` against isolated `:3001`). |

---

## 2. Modified & Added Source Files (`Phase 2`)

1. **[services/api/src/monitoring/consensus-monitor.ts](file:///d:/Sovra/services/api/src/monitoring/consensus-monitor.ts)** — Fail-closed `totalCount === 0` quorum/health check, removed hardcoded `'30139348240070'` supply fallback, and fixed `# HELP sovra_consensus_healthy` Prometheus substring bug.
2. **[scripts/database-engine.ts](file:///d:/Sovra/scripts/database-engine.ts#L4061-L4065)** — Fail-closed `ERR_CLIENT_E2EE_REQUIRED` guard on `SovraDatabaseEngine.appendMessage()` when `isE2EE: true` lacks client ciphertext tuple.
3. **[scripts/routes/call.routes.ts](file:///d:/Sovra/scripts/routes/call.routes.ts#L701)** — Fixed plaintext call-log system bubble from `isE2EE: true` to `isE2EE: false`.
4. **[tests/security/stage9-p2-security-regression.test.ts](file:///d:/Sovra/tests/security/stage9-p2-security-regression.test.ts)** — Added `4` targeted security regression tests covering `ConsensusMonitor` and `appendMessage`.

---

## 3. Verification Summary Post-Remediation

* `npm --prefix services/api run build` (`tsc -p tsconfig.json`): **`Exit 0`**
* [stage9-p2-security-regression.test.ts](file:///d:/Sovra/tests/security/stage9-p2-security-regression.test.ts): **`4 passed (4)` (`Exit 0`)**
* Full 120 baseline regression suite, all 54 security suites offline, 6 isolated HTTP `:3001` security suites, 8 affected integration/API suites, 23 workspace typechecks, and Go L1 tests: recorded in full in [STAGE_9_REGRESSION_RESULTS.md](file:///d:/Sovra/STAGE_9_REGRESSION_RESULTS.md).
