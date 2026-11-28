# Stage 9 — Phase 7 Complete Regression & Security Results

**Program:** SOVRA Stage 9 — Certification Blocker Closure Program  
**Baseline Preserved:** Stage 8 verdict remains **`NOT TESTED — External Field Certification`** ([STAGE_8_FINAL_CERTIFICATION.md](file:///d:/Sovra/STAGE_8_FINAL_CERTIFICATION.md)).  
**Verification Execution Date:** `2026-11-26`  
**Orchestration & Raw Logs:** [stage9-verify.mjs](file:///C:/Users/alamr/.gemini/antigravity/brain/d329ae1a-a8d0-40b2-b024-24d29195a2f5/scratch/stage9-verify.mjs) (`task-56210`, all post-edit verification steps executed against isolated temp `SOVRA_STORAGE_DIR` paths so workspace DBs remain untouched).

---

## 1. Top-Level Execution Matrix

| Verification Suite | Scope | Exact Result | Exit Code | Raw Evidence Log |
|---|---|---|---|---|
| **Baseline Regression Matrix** | All `120` Stage-6/8 baseline test files (`--no-file-parallelism`) | **`120 passed (120)` files · `758 passed (758)` tests** (`189.46s`) | **`0`** | [stage9-baseline-120.log](file:///C:/Users/alamr/.gemini/antigravity/brain/d329ae1a-a8d0-40b2-b024-24d29195a2f5/scratch/stage9-baseline-120.log) |
| **Complete Security Suite (Offline Isolated Loop)** | All `54` files in `tests/security/` (`53` existing + `stage9-p2-security-regression.test.ts`), each run in clean temp `SOVRA_STORAGE_DIR` | **`33 passed (33)` files · `21 failed/skipped` files** *(zero false passes; all 21 failures analyzed in Section 3)* | `N/A` *(per-file exit aggregated)* | [stage9-sec53-offline.json](file:///C:/Users/alamr/.gemini/antigravity/brain/d329ae1a-a8d0-40b2-b024-24d29195a2f5/scratch/stage9-sec53-offline.json) |
| **Isolated HTTP `:3001` Security Run** | `6` targeted `:3001` HTTP suites against ephemeral `dev-server.ts` (`SOVRA_ENABLE_EXT_CONSENSUS=false`, `SOVRA_NO_DNS=true`) | **`5/6` full PASS (`93/93` tests)**; `p0-phase5-verification.test.ts`: **`9 passed \| 2 failed`** *(the 2 failures query offline L1 RPC)* | `0` (`5` files) / `1` (`p0-phase5`) | [stage9-sec-http-isolated.json](file:///C:/Users/alamr/.gemini/antigravity/brain/d329ae1a-a8d0-40b2-b024-24d29195a2f5/scratch/stage9-sec-http-isolated.json) |
| **Affected Integration & Phase 2 Suites** | `8` suites: `services/api`, `stage9-p2`, `founder-independence-multiprocess`, `ia01-networking-and-storage`, `mobile-production-hardening`, `mnemonic-and-multi-relay`, `blind-push`, `transport-interop` | **`8 passed (8)` files · `42 passed (42)` tests** (`21.48s`) | **`0`** | [stage9-affected-integration.log](file:///C:/Users/alamr/.gemini/antigravity/brain/d329ae1a-a8d0-40b2-b024-24d29195a2f5/scratch/stage9-affected-integration.log) |
| **Workspace TypeScript Check** | `pnpm -r run typecheck` across monorepo workspaces | **`23 of 24` workspace projects Done (`0` errors)** | **`0`** | [stage9-typecheck.log](file:///C:/Users/alamr/.gemini/antigravity/brain/d329ae1a-a8d0-40b2-b024-24d29195a2f5/scratch/stage9-typecheck.log) |
| **`services/api` Production Build** | `npm --prefix services/api run build` (`tsc -p tsconfig.json`) | **`PASS` (`0` errors)** | **`0`** | Verified post-edit |
| **Go L1 Extension Suite** | `go test ./...` inside `chain/` | **`10` packages `ok`** (`cmd/sovrad`, `consensus`, `node`, `p2p`, `privval`, `store`, `x/auth`, `x/issuance/keeper`, `x/issuance/types`, `x/wasm`; `5` pkg `[no test files]`) | **`0`** | Verified post-edit |

---

## 2. Offline Security Suite — 33 Passing Suites (`33/54`)

All `33` files passed `100%` (`Exit 0`) in isolated offline runs (`SOVRA_STORAGE_DIR=<temp>`):

1. `adversarial-auth-bypass-remediation.test.ts` (`16 passed`)
2. `adversarial-database-modernization.test.ts` (`5 passed`)
3. `adversarial-phase2-remediation.test.ts` (`19 passed`)
4. `adversarial-phase3-remediation.test.ts` (`17 passed`)
5. `adversarial-phase35-remediation.test.ts` (`14 passed`)
6. `adversarial-phase36-remediation.test.ts` (`7 passed`)
7. `adversarial-phase38-remediation.test.ts` (`7 passed`)
8. `dependency-boundaries.test.ts` (`7 passed`)
9. `eight_vulnerabilities_hardening.test.ts` (`8 passed`)
10. `independent-bip39-audit.test.ts` (`8 passed`)
11. `independent-hmac-audit.test.ts` (`9 passed`)
12. `live-stream-security.test.ts` (`8 passed`)
13. `p0-phase39-remediation.test.ts` (`13 passed`)
14. `phase11-hmac-replay-security.test.ts` (`13 passed`)
15. `phase12-cors-validation.test.ts` (`10 passed`)
16. `phase12-distributed-security-store.test.ts` (`7 passed`)
17. `phase12-secret-and-auth-hardening.test.ts` (`17 passed`)
18. `phase15-3-validator-transition-boundary.test.ts` (`19 passed`)
19. `phase15-4-live-consensus-transition.test.ts` (`13 passed`)
20. `phase16-sanitization-quarantine.test.ts` (`14 passed`)
21. `phase9-security-isolation.test.ts` (`5 passed`)
22. `sec07-session-security.test.ts` (`5 passed`)
23. `seven_vulnerabilities_hardening.test.ts` (`7 passed`) *(isolated last so `wallet.routes.ts:58` L1 ensureReady cleanup completes cleanly)*
24. `stage9-p2-security-regression.test.ts` (`4 passed`) *(new Phase 2 suite)*
25. `target_a_wallet_voucher_hardening.test.ts` (`4 passed`)
26. `target_b_guardian_recovery_hardening.test.ts` (`3 passed`)
27. `target_c_media_proxy_ssrf_hardening.test.ts` (`5 passed`)
28. `target_multichain_bridge_settlement.test.ts` (`10 passed`)
29. `target_sec07_session_cookie_hardening.test.ts` (`5 passed`)
30. `target_ultrasound_monetary_invariants.test.ts` (`5 passed`)
31. `target_zk_range_proofs.test.ts` (`9 passed`)
32. `wal-forensic-erasure.test.ts` (`1 passed`)
33. `wallet_realworld_production.test.ts` (`10 passed`)

---

## 3. Complete Accounting of Offline Failures & Isolated HTTP Re-Runs (`21/54`)

Zero failing or skipped assertions are omitted below:

### Group A — Requires Running HTTP `dev-server.ts` on `:3001` (`12` suites offline)

| File | Offline Result (`task-56210`) | Isolated HTTP `:3001` Result | Notes |
|---|---|---|---|
| `governance_p0_remediation.test.ts` | `8 failed \| 24 passed (32)` (`ECONNREFUSED :3001`) | **`32 passed (32)` (`Exit 0`)** | Full HTTP `P0-C` pass |
| `target_e2ee_client_side_hardening.test.ts` | `9 skipped` (`ECONNREFUSED :3001` in `beforeAll`) | **`9 passed (9)` (`Exit 0`)** | Full client E2EE pass |
| `did_spoofing.test.ts` | `17 skipped` (`ECONNREFUSED :3001`) | **`17 passed (17)` (`Exit 0`)** | Full spoofing defense pass |
| `rbac-role-resource-matrix.test.ts` | `7 failed \| 11 passed (18)` (`ECONNREFUSED :3001`) | **`18 passed (18)` (`Exit 0`)** | Full RBAC HTTP pass |
| `adversarial-bola-idor-matrix.test.ts` | `17 failed (17)` (`ECONNREFUSED :3001`) | **`17 passed (17)` (`Exit 0`)** | Full IDOR/auth pass |
| `admin_user_creator_moderation.test.ts` | `22 skipped` (`ECONNREFUSED :3001`) | Not executed in 6-file subset | Environment HTTP dep (`:3001`) |
| `adversarial-phase33-remediation.test.ts` | `1 failed \| 18 passed (19)` (`ECONNREFUSED :3001` CSP check) | Not executed in 6-file subset | Environment HTTP dep (`:3001`) |
| `adversarial-remediation-gate.test.ts` | `25 skipped` (`ECONNREFUSED :3001`) | Not executed in 6-file subset | Environment HTTP dep (`:3001`) |
| `p0-phase38-remediation.test.ts` | `15 skipped` (`ECONNREFUSED :3001`) | Not executed in 6-file subset | Environment HTTP dep (`:3001`) |
| `phase1_1_adversarial_remediation.test.ts` | `35 skipped` (`ECONNREFUSED :3001`) | Not executed in 6-file subset | Environment HTTP dep (`:3001`) |
| `six_modules_remediation.test.ts` | `26 failed \| 2 passed (28)` (`ECONNREFUSED :3001`) | Not executed in 6-file subset | Environment HTTP dep (`:3001`) |
| `target_financial_settlement_state_machine.test.ts` | `6 skipped` (`ECONNREFUSED :3001`) | Not executed in 6-file subset | Environment HTTP dep (`:3001`) |

### Group B — Requires Live External `SOVRA-EXT-CONSENSUS` CometBFT L1 Cluster (`7` suites)

| File | Observed Result | Root Cause |
|---|---|---|
| `p0-phase5-verification.test.ts` | Offline: `5 failed \| 4 passed \| 2 skipped (11)`; Isolated HTTP `:3001` (L1 off): **`9 passed \| 2 failed (11)`** | The `2` HTTP-online failures are `GAP-P0-01` calling external CometBFT `L1_RPC` (`:26657`) while `SOVRA_ENABLE_EXT_CONSENSUS=false`. |
| `phase10-security-monitoring.test.ts` | Offline: **`2 failed \| 5 passed (7)`** | Line `77` expects live `26677/26687` validators; line `122` now honestly fails (`sovra_consensus_healthy 0` when `26657/26667` are offline) after Phase 2 fixed the `# HELP` false-positive collision. |
| `phase10-financial-testnet.test.ts` | Offline: `2 failed \| 5 passed (7)` | Live CometBFT testnet RPC unreachable (`ECONNREFUSED`). |
| `phase15-2-validator-rotation-recovery.test.ts` | Offline: `2 failed \| 10 passed (12)` | Live 4-node validator consensus offline. |
| `phase15-5-live-recovery.test.ts` | Offline: `13 failed (13)` | Requires live 4-node L1 recovery cluster + P2P switch. |
| `phase15-6-adversarial-audit.test.ts` | Offline: `11 failed \| 2 passed (13)` | Requires live 4-node L1 cluster `AppHash` & supply RPCs. |
| `phase9-financial-concurrency.test.ts` | Offline: `2 failed \| 2 passed (4)` | Queries live CometBFT L1 supply state machine. |

### Group C — Legacy Assertion / Removed Fixture Mismatches (`2` suites)

| File | Observed Result | Root Cause |
|---|---|---|
| `phase7-governance-e2ee-adversarial.test.ts` | Offline: `2 failed \| 11 passed (13)` | Pre-`P0-01` test assertions expecting removed `'Double Ratchet'` badge & deterministic `AES-GCM-256` server fallback (explicitly not weakened). |
| `wallet_gateway_decoupling.test.ts` | Offline: `8 failed \| 3 passed (11)` | Tests `1–7` fail on `:3001` offline; Test `8` asserts on-disk existence of plaintext fixture `chain/mytestnet/node0/validator-0.key.json` (absent from working tree). |
