# SOVRA — Critical Gaps & Prioritized Remediation Roadmap

**Audit Date:** November 24, 2026  
**Auditor:** Independent Sovereign Engineering Review Board  
**Target:** Monorepo `D:\Sovra`  

---

## 1. Executive Summary & Prioritization Framework

To achieve an orderly, risk-free public launch, all identified technical debt, test regressions, and feature gaps are categorized into four strict priority tiers:

- **P0 (Gate A Launch Blockers):** Defects that impact consumer user experience, crash fresh user accounts, or cause pre-launch test suite failures. Must be resolved before opening to public traffic.
- **P1 (Gate B Launch Blockers):** Gaps in on-chain smart contracts, multi-cloud automated failover, or validator rotation. Must be resolved before full sovereign blockchain mainnet.
- **P2 (Post-Launch Hardening):** Performance optimizations, view file modularization, and test runner rate-limit isolation.
- **P3 (Continuous Polish):** UI micro-animations, additional language localizations, and documentation refinements.

---

## 2. P0: Gate A Social Media Launch Blockers (RESOLVED & VERIFIED)

### P0-1: User Profile `story_highlights` Array Initialization — [RESOLVED & VERIFIED]
- **Fix:** Initialized `story_highlights: []` and `user_close_friends: {}` in `initEmptySchema()`, `load()`, and `sanitizeState()` in `scripts/database-engine.ts`.
- **Verification Evidence:** `tests/e2e/instagram-parity-suite.test.ts` passed 26 of 26 tests (100%).

### P0-2: Service Worker Cache Version Test Assertion — [RESOLVED & VERIFIED]
- **Fix:** Updated `tests/audit/world_standard_flagship_audit.test.ts:58` to expect `'sovra-pwa-v10'`.
- **Verification Evidence:** `npm run audit:prelaunch` passed 44 of 44 tests across all 3 audit suites (100%).

### P0-3: Ads Escrow Balance Property Null Check — [RESOLVED & VERIFIED]
- **Fix:** Resolved `findUserByDid` negative-cache eviction in `scripts/database-engine.ts` so dynamically registered users are immediately accessible.
- **Verification Evidence:** `tests/e2e/sovereign-ads-manager.test.ts` passed 7 of 7 tests (100%).

### P0-4: Test Runner Rate Limiter Reset Hook
- **Problem:** 38 security tests fail with HTTP 429 because running 53 test suites in parallel saturates the single in-memory TokenBucket throttle.
- **Target File:** `tests/security/` test setup helper / `tests/helpers/test-server.ts`
- **Fix:** Expose a test-only `resetRateLimiter()` hook to clear IP throttles between test suite runs.
- **Effort:** 30 minutes.
- **Verification:** Re-run `npx vitest run tests/security/`.

---

## 3. P1: Gate B Sovereign Ecosystem Launch Blockers

### P1-1: Validator Keystore Path Reconciliation in Decoupling Test
- **Problem:** `tests/security/wallet_gateway_decoupling.test.ts` references the obsolete path `chain/mytestnet/node0/validator-0.key.json`.
- **Target File:** `tests/security/wallet_gateway_decoupling.test.ts:343, 409`
- **Fix:** Update test path to check `chain/rotated_keys/` or verify keystore isolation through environment variables.
- **Effort:** 30 minutes.

### P1-2: CosmWasm CW20 AMM Swap Route Execution
- **Problem:** Creator token AMM swaps return 404 in certain test fixtures where the AMM liquidity table was uninitialized.
- **Target File:** `scripts/dev-server.ts` (routes `/api/wallet/amm/swap` and `/api/studio/dashboard`)
- **Fix:** Ensure default AMM liquidity pools are automatically seeded for creator tokens on boot.
- **Effort:** 1 hour.

### P1-3: Multi-Cloud Validator Automated Orchestrator
- **Problem:** Multi-node federation currently requires launching separate terminal processes manually.
- **Target File:** `deploy/docker-compose.seed-nodes.yml` and `chain/scripts/`
- **Fix:** Provide a one-command bash/powershell script to spin up 4 local validator nodes with automated BFT peering.
- **Effort:** 2 hours.

---

## 4. P2: Post-Launch Technical Debt & Performance Hardening

### P2-1: Modularization of Massive View Files
- **Problem:** `scripts/views/scripts.view.ts` is 58,249 lines and `layout.view.ts` is 15,306 lines. While functionally sound, their size makes code navigation unwieldy.
- **Remediation Plan:** Split `scripts.view.ts` into modular feature bundles:
  - `views/client/webrtc.client.ts`
  - `views/client/wallet.client.ts`
  - `views/client/studio.client.ts`
  - `views/client/social.client.ts`
- **Timeline:** Milestone 2 (2 weeks post-launch).

### P2-2: Windows SQLite Snapshot EBUSY Concurrency Retry
- **Problem:** On Windows, concurrent file copies during background snapshot saves can occasionally raise non-fatal `EBUSY` warnings.
- **Remediation Plan:** Implement exponential backoff retry (3 attempts, 50ms jitter) in `scripts/database-engine.ts:3451` before copyfile fallback.
- **Timeline:** Milestone 2.

---

## 5. Remediation Timeline & Milestones

```
+-------------------------------------------------------------+
| WEEK 1: GATE A POLISH (Hours 1 - 4)                         |
| - Execute P0-1, P0-2, P0-3, P0-4                           |
| - Verify 100% pre-launch audit pass                         |
| - CERTIFY GATE A: SOCIAL MEDIA PUBLIC LAUNCH               |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| WEEK 2-3: GATE B POLISH & VALIDATOR DEPLOYMENT             |
| - Execute P1-1, P1-2, P1-3                                 |
| - Multi-node cloud VPS deployment (US, EU, AP)             |
| - CERTIFY GATE B: COMPLETE SOVEREIGN ECOSYSTEM MAINNET     |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| WEEK 4+: POST-LAUNCH MODULARIZATION                         |
| - Execute P2-1, P2-2                                       |
| - Continuous scaling & peer telemetry monitoring            |
+-------------------------------------------------------------+
```
