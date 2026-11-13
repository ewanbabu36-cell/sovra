# SOVRA INDEPENDENT CLAIM-VS-EVIDENCE MATRIX
**Audit ID:** SOVRA-6MOD-INDEPENDENT-VERIFICATION-001  
**Scope:** Remediation Claims Verification  
**Mode:** ZERO-TRUST FORENSIC ANALYSIS

---

## Remediation Claim-to-Evidence Matrix

| # | Remediation Claim | Source File | Function / Mechanism | Runtime Test | Evidence / Log Output | Verdict |
|---|---|---|---|---|---|---|
| 1 | Wallet transfer requires authentication | `scripts/routes/wallet.routes.ts:519` | `ctx.enforceAuth(req, res)` | `six_modules_remediation.test.ts` (1.1) | HTTP 401 returned when Authorization/signature header is absent. | **VERIFIED** |
| 2 | Wallet BOLA / sender DID spoofing blocked | `scripts/routes/wallet.routes.ts:522` | `senderDid !== principal.did` check | `six_modules_remediation.test.ts` (1.2) | HTTP 403 Forbidden returned when attacker attempts to transfer victim's funds. | **VERIFIED** |
| 3 | Atomic P2P SQLite transfer with double-entry | `scripts/database-sqlite.ts:4730` | `executeAtomicIdempotentTransfer` | `six_modules_remediation.test.ts` (1.3) | HTTP 200 returned; balance deducted from sender, credited to receiver, logged in `token_transfers`. | **VERIFIED** |
| 4 | Replay protection via idempotency key | `scripts/database-sqlite.ts:4816` | `financial_idempotency_keys` lookup | `six_modules_remediation.test.ts` (1.4) | Repeated request with identical key returns cached response with `isReplay: true` and zero double debit. | **VERIFIED** |
| 5 | Insufficient balance transfer rejected | `scripts/database-sqlite.ts:4877` | `senderBal < totalDeduction` check | `six_modules_remediation.test.ts` (1.5) | HTTP 400 Bad Request returned with descriptive error. | **VERIFIED** |
| 6 | Self-transfer prohibited | `scripts/routes/wallet.routes.ts:550` | `recipientDid === senderDid` check | `six_modules_remediation.test.ts` (1.6) | HTTP 400 Bad Request returned. | **VERIFIED** |
| 7 | Faucet authentication & 24h rate limit | `scripts/routes/wallet.routes.ts:427, 439` | `enforceAuth` + `token_transfers` 24h query | `six_modules_remediation.test.ts` (1.7) | Unauthenticated claim returns 401; repeat claim within 24h returns 429 Too Many Requests. | **VERIFIED** |
| 8 | Faucet debits from Genesis Treasury | `scripts/routes/wallet.routes.ts:471` | `INSERT INTO token_transfers ... from_did='did:sov:treasury_genesis'` | `six_modules_remediation.test.ts` (1.7) | Ledger entry created with provenance; explicit decrement on `users` table omitted. | **PARTIALLY VERIFIED** |
| 9 | 100M lifetime SOV supply cap bound | `scripts/database-sqlite.ts:6371` | `MAX_LIFETIME_SOV_CAP = 100_000_000` | Code Inspection (`database-sqlite.ts:6434`) | Adjustments exceeding 100M cap throw exception; hard cap is structurally maintained. | **VERIFIED** |
| 10 | Studio `creator_primary` fallback eliminated | `scripts/routes/studio.routes.ts:31` | `resolveCreatorDid` returns `null` | Code Inspection (`studio.routes.ts:40`) | Fallback identity purged; unauthenticated requests fail resolution. | **VERIFIED** |
| 11 | Studio mutating routes require auth | `scripts/routes/studio.routes.ts:538-1662` | `ctx.enforceAuth(req, res)` | `six_modules_remediation.test.ts` (2.1-2.5) | Unauthenticated requests to upload, delete, update, playlists, and payout return HTTP 401. | **VERIFIED** |
| 12 | Studio creator payout settled in SQLite | `scripts/database-engine.ts:7462` | `claimCreatorPayout` | Code Inspection & `six_modules_remediation.test.ts` (2.6) | Accrued balance updated; SQLite `token_transfers` recorded. | **VERIFIED** |
| 13 | Studio synthetic tip pool default | `scripts/database-engine.ts:7416` | `baseTipPool = 324.50` default | Forensic Code Inspection | When `allTips.length === 0`, default is 324.50 SOV instead of 0.0 SOV. | **DEFECT / LEAK (P2)** |
| 14 | BLE native Android & iOS implementation | `SovraBleModule.kt`, `SovraBleBridge.mm` | Real GATT server, advertising, scanning | Source Code Inspection | Authentic native Kotlin and Objective-C++ code exists. | **VERIFIED (Code)** |
| 15 | BLE physical dual-handset over-the-air | Physical RF radio propagation | Dual-handset GATT communication | Hardware Inspection | No physical handsets attached to desktop CI environment. | **UNVERIFIED (Hardware Required)** |
| 16 | Settings `masterKey.did` fallback removed | `scripts/dev-server.ts:91136, 91160` | `enforceAuth` + `targetDid || principal.did` | Code Inspection | No fallback to master key exists. | **VERIFIED** |
| 17 | Settings BOLA / IDOR access closed | `scripts/dev-server.ts:91137, 91161` | Caller vs target DID equality check | `six_modules_remediation.test.ts` (4.1-4.6) | Cross-user read or write returns HTTP 403 Forbidden. | **VERIFIED** |
| 18 | Video `rahul_sharma_core` persona removed | `scripts/routes/video.routes.ts:1180` | `enforceAuth` + principal binding | `six_modules_remediation.test.ts` (5.1-5.5) | Fallback removed; watch progress and subscriptions protected. | **VERIFIED** |
| 19 | Reels 95/5 creator/seeder micro-tipping | `scripts/database-engine.ts:4900` | Universal tip split via SQLite ledger | `six_modules_remediation.test.ts` (6.2) | 95% creator and 5% seeder split settled atomically with zero platform fee. | **VERIFIED** |
| 20 | Non-confiscation suspension invariant | `scripts/database-sqlite.ts:4865` | Outbound transfer freeze on status | Code Inspection & Adversarial Suite | Suspended account outbound transfer blocked with 403; balance intact. | **VERIFIED** |
