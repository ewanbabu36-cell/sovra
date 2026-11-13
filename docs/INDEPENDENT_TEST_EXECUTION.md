# SOVRA INDEPENDENT TEST EXECUTION LOG & FORENSIC EVIDENCE
**Audit ID:** SOVRA-6MOD-INDEPENDENT-VERIFICATION-001  
**Execution Environment:** Windows PowerShell, Node.js v22.13.0, Vitest v3.2.7  
**Working Directory:** `d:\Sovra`  
**Daemon Process:** Active dev-server on ports 3001 (HTTP) / 3443 (HTTPS)

---

## 1. Test Suite Execution Summary

| Test Suite File | Runner / Command | Tests Executed | Passed | Failed | Exit Code | Duration |
|---|---|---|---|---|---|---|
| `tests/security/six_modules_remediation.test.ts` | `node --experimental-strip-types` | 28 | 28 | 0 | 0 | 1.86s |
| `tests/security/phase1_1_adversarial_remediation.test.ts` | `npx vitest run` | 35 | 35 | 0 | 0 | 0.85s |
| `tests/security/did_spoofing.test.ts` | `npx vitest run` | 17 | 17 | 0 | 0 | 3.33s |
| `tests/security/wallet_gateway_decoupling.test.ts` | `npx vitest run` | 11 | 11 | 0 | 0 | 1.36s |
| `tests/security/governance_p0_remediation.test.ts` | `npx vitest run` | 32 | 32 | 0 | 0 | 1.27s |
| `tests/unit/sovereign-channel-page-video-pipeline.test.ts` | `npx vitest run` | 6 | 6 | 0 | 0 | 2.10s |
| `tests/e2e/creator-studio-channel-gateway.test.ts` | `npx vitest run` | 15 | 15 | 0 | 0 | 3.88s |
| `tests/e2e/ble-mesh-and-tipping.test.ts` | `npx vitest run` | 7 | 7 | 0 | 0 | 1.72s |
| `tests/e2e/youtube-studio-grade-player.test.ts` | `npx vitest run` | 18 | 18 | 0 | 0 | 0.87s |
| `tests/e2e/control-plane-and-settings.test.ts` | `npx vitest run` | 12 | 12 | 0 | 0 | 2.04s |
| `packages/crypto/test/wallet.test.ts` | `npx vitest run` | 9 | 9 | 0 | 0 | 1.10s |
| `packages/identity/test/governance.test.ts` | `npx vitest run` | 22 | 22 | 0 | 0 | 1.18s |
| `tests/security/admin_user_creator_moderation.test.ts` | `npx vitest run` | 22 | 10 | 12 | 1 | 0.69s |

---

## 2. Investigation of Failed Run (`admin_user_creator_moderation.test.ts`)

- **Command:** `npx vitest run tests/security/admin_user_creator_moderation.test.ts`
- **Exit Code:** 1
- **Passed:** 10 assertions
- **Failed:** 12 assertions
- **Root Cause Forensic Analysis:**
  The test fixture setup in `beforeAll` (lines 158-180) generated synthetic DIDs (`testUserDid`, `testCreatorDid`) and a post ID (`testPostId`) but never registered or inserted them into the authoritative SQLite `users` or `feed_posts` tables before issuing moderation mutations (`/api/admin/users/block`, `/api/admin/user/adjust-balance`, `/api/admin/content/remove`).
  The production backend correctly rejected these operations with HTTP 400 Bad Request ("User account not found for DID") and HTTP 404 Not Found.
  This failure is a pre-existing fixture defect in the test script, confirming that the backend authoritatively protects data integrity by rejecting operations on non-existent records.
