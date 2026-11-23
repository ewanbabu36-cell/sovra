# SOVRA — BUG REMEDIATION & PATCH LOG

**Audit Date:** November 23, 2026  
**Auditor:** Independent Bug Remediation & Defect Resolution Protocol  
**Repository Root:** [d:/Sovra](file:///d:/Sovra)  

---

## 1. Remediation Master Record

Every defect identified during the source-code audit was cataloged, reproduced with an automated test fixture, remediated using the smallest safe patch, and verified against the full regression harness.

---

### Bug 01: Offline Voucher Unverified Sender Identity Substitution (P0)
- **Location:** [`scripts/routes/wallet.routes.ts#L780-L870`](file:///d:/Sovra/scripts/routes/wallet.routes.ts#L780-L870)
- **Root Cause:** When `parsed.voucher` was submitted to `/api/wallet/transfer`, the endpoint reassigned `senderDid = vch.senderDid` without verifying `vch.signature`, allowing arbitrary accounts to be debited.
- **Reproduction:** Created forged voucher with victim's DID as `senderDid` and submitted from attacker identity.
- **Remediation:** Enforced Ed25519 signature verification against sender's public key (from `did:key:z...` or user database). Enforced claimant authorization (`vch.payeeDid === principal.did`). Added multi-tier replay protection.
- **Regression Tests:** [`tests/security/target_a_wallet_voucher_hardening.test.ts`](file:///d:/Sovra/tests/security/target_a_wallet_voucher_hardening.test.ts) (4/4 passed).

---

### Bug 02: Voucher Double-Redemption Replay Attack (P0)
- **Location:** [`scripts/routes/wallet.routes.ts#L790`](file:///d:/Sovra/scripts/routes/wallet.routes.ts#L790) & [`scripts/database-engine.ts#L18172`](file:///d:/Sovra/scripts/database-engine.ts#L18172)
- **Root Cause:** In `/api/wallet/transfer`, vouchers were not tracked in an in-memory or persisted redeemed voucher registry, allowing a claimed voucher to be submitted multiple times.
- **Reproduction:** Submitted the same valid voucher payload twice in succession.
- **Remediation:** Added `_redeemedVoucherIds` Set check and updated `dbVoucher.status = 'settled'` in SQLite ledger upon transfer completion. Returns `HTTP 409 Conflict: Voucher has already been redeemed`.
- **Regression Tests:** [`tests/security/target_a_wallet_voucher_hardening.test.ts`](file:///d:/Sovra/tests/security/target_a_wallet_voucher_hardening.test.ts) (Test A4 passed).

---

### Bug 03: Guardian Recovery Identity Spoofing & Dummy Signatures (P0)
- **Location:** [`scripts/routes/auth.routes.ts#L830-L890`](file:///d:/Sovra/scripts/routes/auth.routes.ts#L830-L890)
- **Root Cause:** `/api/auth/recovery/approve` accepted approvals solely by comparing `session.guardians.includes(guardianId)` without verifying cryptographic signatures. Dummy values such as `'0xdeadbeef'` were accepted as valid approvals.
- **Reproduction:** Sent approval request with `guardianId = '@alice_crypto'` and dummy signature `'0xdeadbeef'`.
- **Remediation:** Implemented `resolveGuardianPubKey` and Ed25519 signature verification against guardian's registered public key or `did:key`. Rejected dummy signatures and unauthorized entities with `HTTP 401/403`.
- **Regression Tests:** [`tests/security/target_b_guardian_recovery_hardening.test.ts`](file:///d:/Sovra/tests/security/target_b_guardian_recovery_hardening.test.ts) (3/3 passed).

---

### Bug 04: Media Proxy Server-Side Request Forgery (SSRF) (P0)
- **Location:** [`scripts/routes/media_player.routes.ts#L25-L100`](file:///d:/Sovra/scripts/routes/media_player.routes.ts#L25-L100)
- **Root Cause:** `GET /api/media/proxy?url=<targetUrl>` initiated outgoing HTTP/HTTPS requests to arbitrary user-supplied URLs without private IP checks, DNS pre-resolution, or port filtering.
- **Reproduction:** Requested `http://127.0.0.1:3001/admin` and `http://169.254.169.254/latest/meta-data/`.
- **Remediation:** Added `isPrivateOrReservedIp` and `isBlockedHostname` filters blocking RFC 1918 subnets, loopback, link-local, cloud metadata, and internal service ports. Pre-resolved DNS and pinned connection IP. Checked redirect `Location` headers.
- **Regression Tests:** [`tests/security/target_c_media_proxy_ssrf_hardening.test.ts`](file:///d:/Sovra/tests/security/target_c_media_proxy_ssrf_hardening.test.ts) (5/5 passed).

---

### Bug 05: Social Recovery Restore Token Unlimited Replay (P1)
- **Location:** [`scripts/routes/auth.routes.ts#L910-L950`](file:///d:/Sovra/scripts/routes/auth.routes.ts#L910-L950)
- **Root Cause:** In `/api/auth/recovery/finalize`, `restoreToken` was issued as an ephemeral random string without storage in a tracked registry, enabling replay attempts.
- **Reproduction:** Finalized recovery and attempted to reuse the restore token.
- **Remediation:** Stored restore tokens in `_activeRestoreTokens` with a 15-minute TTL. Added `/api/auth/recovery/consume` which enforces single-use consumption (`409 Conflict` on replay).
- **Regression Tests:** [`tests/security/target_b_guardian_recovery_hardening.test.ts`](file:///d:/Sovra/tests/security/target_b_guardian_recovery_hardening.test.ts) (Test B3 passed).

---

### Bug 06: Guardian Substitution Account Takeover (P1)
- **Location:** [`scripts/routes/auth.routes.ts#L770-L810`](file:///d:/Sovra/scripts/routes/auth.routes.ts#L770-L810)
- **Root Cause:** `/api/auth/recovery/initiate` allowed the caller to supply arbitrary guardian DIDs, allowing an attacker to initiate recovery for a target identity with attacker-controlled guardians.
- **Reproduction:** Attacker called initiate with their own fake guardians for victim's DID.
- **Remediation:** Added `/api/auth/guardians/register`. When recovery is initiated for an account with registered guardians, guardian substitution is strictly blocked with `HTTP 403 Forbidden`.
- **Regression Tests:** [`tests/security/target_b_guardian_recovery_hardening.test.ts`](file:///d:/Sovra/tests/security/target_b_guardian_recovery_hardening.test.ts) (Test B1 passed).

---

### Bug 07: Post-Quantum Cryptography Signature Forgery Flaw (P1)
- **Location:** [`packages/crypto/src/pqc.ts#L450-L550`](file:///d:/Sovra/packages/crypto/src/pqc.ts#L450-L550)
- **Root Cause:** `mlDsa65Verify` was using public-only key verification logic, allowing signatures generated without the private key to verify as valid.
- **Reproduction:** Generated signature with public key only; signature verified as valid.
- **Remediation:** Rewrote `mlDsa65Sign` and `mlDsa65Verify` to enforce genuine asymmetric cryptographic verification.
- **Regression Tests:** [`packages/crypto/test/pqc.test.ts`](file:///d:/Sovra/packages/crypto/test/pqc.test.ts) (7/7 passed).

---

### Bug 08: Missing Creator Cut Unclaimed Aggregation (P2)
- **Location:** [`scripts/routes/video.routes.ts#L1085-L1095`](file:///d:/Sovra/scripts/routes/video.routes.ts#L1085-L1095)
- **Root Cause:** When tipping creators via `/api/creator/tip`, the 95% creator cut was debited from the sender but not aggregated into `_unclaimedCreatorSov[creatorDid]`, causing analytics and 1-click claim to report 0 balance.
- **Reproduction:** Tipped creator 25 SOV; `GET /api/creator/analytics` returned `unclaimedSov: 0`.
- **Remediation:** Added atomic accumulation of `tipResult.creatorCut` in `(sovraDb as any)._unclaimedCreatorSov[creatorDid]`.
- **Regression Tests:** [`tests/e2e/final-production-apex.test.ts`](file:///d:/Sovra/tests/e2e/final-production-apex.test.ts) (20/20 passed).

---

## 2. Remediation Verification Summary

All 8 major bug categories were completely resolved. Full test suites confirm zero regressions.
