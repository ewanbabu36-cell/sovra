# SOVRA — P0 SECURITY AND INTEGRITY BACKLOG

**Document ID:** `SOVRA-AUDIT-DOC-04`  
**Classification:** Critical Security Vulnerability, Fraud Risk & Systemic Defect Registry  
**Standard:** Zero-Trust, Evidence-Driven Security Audit  
**Repository Working Directory:** `d:\Sovra`  
**Evaluation Date:** November 5, 2026  

---

## 1. Executive Summary & Vulnerability Matrix

This backlog catalogs all verified security vulnerabilities, cryptographic failures, financial inflation vectors, and architectural integrity defects in the SOVRA codebase. Each item includes precise file locations, line numbers, proof-of-concept reproduction details, concrete impact assessments, and minimal-change remediation blueprints.

### Summary by Severity Tier
- **P0 Blockers (Critical):** 5 Confirmed Vulnerabilities (Immediate exploitability, cryptographic compromise, unbacked token minting, identity spoofing)
- **P1 Defects (High):** 4 Confirmed Defects (BOLA/IDOR, single-process blast radius, unbuilt PoU pipeline, L1 disconnection)
- **P2 Risks (Medium):** 3 Confirmed Risks (Simulated metrics, CSAM escalation pipeline, non-standard video chunking)
- **P3 Refinements (Low):** 2 Operational Limitations (Web Bluetooth browser limits, DOM layout complexity)

---

## 2. P0 Critical Blockers (Production Gate Blockers)

---

### `SEC-P0-01`: Cryptographic Privacy Compromise — Public-DID Derived Symmetrical Keys in E2EE

- **Component:** SOVRA Connect Messaging Engine
- **Location:** `scripts/dev-server.ts:34300-34335`, `scripts/routes/chat.routes.ts:394`
- **CVSS v3.1 Score:** **9.8 (Critical)** `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`
- **Defect Description:**
  1. Client-side message encryption in `window.SovraE2EE` derives the AES-256-GCM symmetric encryption key using PBKDF2 from `[myDid, peerDid].sort().join('::')` with a hardcoded static salt string:
     ```ts
     // scripts/dev-server.ts:34310
     const sharedSeed = [myDid, peerDid].sort().join('::');
     const encKey = await deriveKeyFromSeed(sharedSeed, 'sovra_e2ee_salt_v1_deterministic');
     ```
  2. If the client fails to encrypt or sends an envelope without ciphertext, the server fallback in `chat.routes.ts:394` derives:
     ```ts
     // scripts/routes/chat.routes.ts:394
     const threadSecret = crypto.createHash('sha256').update('SOVRA_MSG_SEAL|' + principal.did + '_' + recipientDid).digest();
     ```
  3. **Zero Asymmetric Cryptography:** Neither derivation uses Diffie-Hellman (X25519/ECDH) or private keys. The keys are derived purely from public, unencrypted string identifiers (`did:key:...` or `did:sovra:...`).
- **Exploitation & Impact:**
  Any observer (network sniffer, database inspector, rogue node, or server admin) can read every direct message in the database simply by extracting the sender and recipient DIDs from the row metadata and computing the deterministic key.
- **Required Minimal Remediation:**
  1. Deprecate `window.SovraE2EE` deterministic seed derivation.
  2. Integrate a standards-compliant Signal Double Ratchet protocol using Curve25519 key agreements (X3DH).
  3. Prohibit the server from sealing or decrypting direct messages; reject any unencrypted payload with HTTP 400.

---

### `FIN-P0-01`: Monetary Supply Invariant Breach — Unconstrained User Registration Token Minting

- **Component:** Core Database Engine & Token Ledger
- **Location:** `scripts/database-migrations.ts:55`, `scripts/database-engine.ts:3062`, `scripts/database-engine.ts:3144`
- **CVSS v3.1 Score:** **9.1 (Critical)** `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:H`
- **Defect Description:**
  1. SQLite Migration 001 defines the `users` table schema with a default balance of 500 SOV:
     ```sql
     -- scripts/database-migrations.ts:55
     balance_sov REAL NOT NULL DEFAULT 500.0,
     ```
  2. In `scripts/database-engine.ts`, user registration unconditionally grants 500.0 SOV created out of thin air:
     ```ts
     // scripts/database-engine.ts:3062
     const newUser: UserRecord = {
       did: userDid,
       handle: handle,
       balanceSov: 500.0, // Free tokens minted from thin air!
       createdAt: Date.now(),
     };
     ```
  3. This grant **completely bypasses** the `MAX_LIFETIME_SOV_CAP` (100,000,000 SOV) enforced in `adjustUserBalanceWithAudit()`. At 200,001 user registrations, total circulating supply silently breaches 100M SOV without trigger or error.
- **Exploitation & Impact:**
  An attacker can script 200,000 registration requests via `POST /api/auth/register`, arbitrarily creating 100,000,000 SOV and collapsing the monetary token economics.
- **Required Minimal Remediation:**
  1. Alter user registration schema and default balance to `0.0 SOV`.
  2. Route all token emission through a centralized `issueTokens()` method that verifies `(totalCirculating + amount) <= MAX_LIFETIME_SOV_CAP` within an exclusive SQLite transaction.

---

### `AUTH-P0-01`: Authentication Bypass — Unauthenticated Header-Based Identity Impersonation

- **Component:** Server Request Ingress & Principal Resolver
- **Location:** `scripts/dev-server.ts:89205-89215`
- **CVSS v3.1 Score:** **9.8 (Critical)** `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`
- **Defect Description:**
  In `scripts/dev-server.ts`, `resolvePrincipal()` contains an explicit bypass intended for internal mesh nodes:
  ```ts
  // scripts/dev-server.ts:89205-89215
  const sovereignDidHeader = req.headers['x-sovra-did'] ? String(req.headers['x-sovra-did']).trim() : '';
  if (sovereignDidHeader) {
    const user = sovraDb.findUserByDid(sovereignDidHeader);
    if (user) {
      const activeToken = user.sessionToken || ('stk_' + crypto.randomBytes(24).toString('hex'));
      return createAuthenticatedPrincipal({
        did: user.did,
        sessionId: activeToken,
        role: user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' ? user.role : 'USER',
        authenticationMethod: 'BEARER_TOKEN',
      });
    }
  }
  ```
  This code does **zero signature checking** and **zero network IP validation**. If a client omits the Authorization header and passes `X-Sovra-DID: <victimDid>`, the server looks up the user and fully authenticates the request as the victim!
- **Exploitation & Impact:**
  Any anonymous HTTP client can execute actions as any user (e.g. transfer wallet funds, post content, delete channels) simply by providing that user's public DID in the `X-Sovra-DID` HTTP header.
- **Required Minimal Remediation:**
  Delete lines 89205-89215 entirely. Require valid cryptographic bearer session tokens or Ed25519 HTTP message signatures (RFC 9421) for all principal resolutions.

---

### `AUTH-P0-02`: Authorization Bypass — Unauthenticated Admin Console & Balance Adjustments

- **Component:** Admin Operations API
- **Location:** `scripts/routes/admin_features.routes.ts:15-100`, `scripts/dev-server.ts:99801`
- **CVSS v3.1 Score:** **9.8 (Critical)** `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`
- **Defect Description:**
  1. `handleAdminFeatureRoute` in `scripts/routes/admin_features.routes.ts` handles:
     - `POST /api/admin/user/update-role`
     - `POST /api/admin/user/adjust-balance`
     - `POST /api/admin/user/toggle-badge`
     - `POST /api/admin/revenue/take-rate`
  2. The context passed from `dev-server.ts:99801` does **not pass `enforceAuth` or `resolvePrincipal`**, and the route controller does not perform any authentication checks.
  3. In `POST /api/admin/user/adjust-balance`:
     ```ts
     // scripts/routes/admin_features.routes.ts:73
     const adminDid = String(parsed.adminDid || req.headers['x-admin-did'] || 'did:sov:admin_root').trim();
     ```
     If unprovided, the caller DID automatically defaults to `'did:sov:admin_root'` (which holds `users:write` and `ledger:transfer` permissions in SQLite RBAC).
- **Exploitation & Impact:**
  Any unauthorized external actor can call `POST /api/admin/user/adjust-balance` or `POST /api/admin/user/update-role` and grant themselves arbitrary SOV balances or promote their account to `SUPER_ADMIN`.
- **Required Minimal Remediation:**
  Pass `enforceAuth(req, res)` into `AdminFeatureContext`. Reject any request that does not carry a verified session token belonging to an authenticated principal with `SUPER_ADMIN` RBAC permission.

---

### `FIN-P0-02`: Financial Inflation & Zero Burn — Ad Escrow Referral Minting

- **Component:** Creator Studio Ad Settlement Engine
- **Location:** `scripts/database-engine.ts:16742-16758`
- **CVSS v3.1 Score:** **8.6 (High)** `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N`
- **Defect Description:**
  In `scripts/database-engine.ts`, `recordFinancialLedgerEntry()` executes ad campaign settlement:
  ```ts
  // scripts/database-engine.ts:16742-16758
  const gross = Number(entry.grossAmountSov || entry.grossSov || 0);
  const platformFee = Math.round(gross * 0.05 * 1000) / 1000; // 5% platform fee
  const netCreator = Math.round((gross - platformFee) * 1000) / 1000; // 95% creator payout
  // Zero burn is executed! (Target blueprint requires 10% burn)

  // Referral bonus:
  const referralRewardSov = Math.round(gross * 0.02 * 1000) / 1000;
  referrerUser.balanceSov = Math.round(((referrerUser.balanceSov || 0) + referralRewardSov) * 100) / 100;
  ```
  The 2% referral reward is credited to the referrer without deducting it from `platformFee` or `grossAmountSov`. It is minted directly out of thin air, inflating the total coin supply on every ad release! Furthermore, 0% of the coins are burned.
- **Exploitation & Impact:**
  Violates the confirmed monetary constraint: "Advertiser payments and creator payouts must use existing coins. No advertising-related minting. Permanent burns must never be reminted."
- **Required Minimal Remediation:**
  1. Deduct all fees and referral bonuses strictly from existing escrowed funds (`grossAmountSov`).
  2. Implement an atomic burn transaction that calls `burnCoins(burnAmount)` and reduces the global supply counter.

---

## 3. P1 High-Priority Defects (Reliability & Functional Integrity)

### `VID-P1-01`: Broken Object-Level Authorization (BOLA/IDOR) on Chunk Uploads
- **Location:** `scripts/routes/video.routes.ts:65-120` (`PATCH /api/videos/upload/chunk`)
- **Impact:** Any user knowing an `uploadId` can upload arbitrary chunks into another user's video stream without matching `author_did`.
- **Remediation:** Enforce `session.author_did === principal.did` on every chunk append request.

### `POU-P1-01`: Completely Unbuilt Proof-of-Usage Pipeline Behind Fail-Closed Gate
- **Location:** `scripts/dev-server.ts:91250`
- **Impact:** While the faucet correctly returns HTTP 403 (rejecting unverified claims), legitimate users can **never earn mining rewards** because 60-second client heartbeats, witness validation, and `user_usage_accumulators` tables do not exist.
- **Remediation:** Implement the heartbeat ingestion endpoint, cumulative usage aggregator table, and anti-Sybil challenge verifier.

### `ARCH-P1-01`: Decoupled Layer-1 Go Blockchain & Node.js Dual Ledgers
- **Location:** `chain/` vs `scripts/database-sqlite.ts`
- **Impact:** Node.js server maintains an unlinked floating-point balance in SQLite while the compiled Go blockchain daemon sits idle. Transactions never commit to consensus.
- **Remediation:** Create a supervisor daemon that manages `sovrad.exe` and wires `wallet.routes.ts` directly to the Tendermint RPC socket.

### `SESS-P1-01`: Monolithic Single-Process Blast Radius
- **Location:** `scripts/dev-server.ts:1-101421`
- **Impact:** Web application, REST API, WebSockets, WebRTC signaling, SQLite WAL, and Libp2p run in a single Node.js process. A memory leak or unhandled promise rejection causes a 100% platform blackout.
- **Remediation:** Decouple signaling and media processing into independent worker processes.

---

## 4. P2 Medium-Priority Risks

### `STUDIO-P2-01`: Fabricated Creator Studio Benchmarks & Trending Multipliers
- **Location:** `scripts/database-engine.ts:8500-8540`, `scripts/routes/feed.routes.ts:45-65`
- **Impact:** Trending tags display inflated numbers (`count * 150 + 120`), and CTR/duration benchmarks are hardcoded mock strings.
- **Remediation:** Connect metrics directly to real watch telemetry beacons.

### `MOD-P2-01`: Missing CSAM Legal Escalation & Formal Appeal Quorums
- **Location:** `scripts/routes/admin_features.routes.ts:400-500`
- **Impact:** Community jury handles general complaints, but automated quarantine and legal dispatch for child sexual abuse material (CSAM) are missing.
- **Remediation:** Establish automated hash-matching (PhotoDNA/PDQ) and immediate quarantine isolation.

### `VID-P2-01`: Invalid Non-FFmpeg Pure Node Video Chunker Fallback
- **Location:** `scripts/video-transcode-pipeline.ts:180-240`
- **Impact:** Slices raw MP4 binary by byte offsets and renames them to `.ts`. HLS video players fail to decode segments.
- **Remediation:** Fail cleanly when FFmpeg is missing rather than writing corrupt HLS segments.

---

## 5. P3 Operational Limitations

### `MESH-P3-01`: Browser Web Bluetooth Peripheral Incompatibility
- **Location:** `packages/p2p/src/mesh/ble-transport.ts`
- **Impact:** Web Bluetooth cannot advertise as a peripheral; browser-to-browser mesh is physically impossible without native mobile app relays.
- **Remediation:** Clarify UI messaging for browser users; indicate that Mesh Relay requires the native Android/iOS app.

---

## 6. Zero-Tolerance Acceptance Criteria for Remediation

To close out the P0 backlog in subsequent implementation cycles:
1. **Cryptographic Validation:** Zero direct messages stored using public-string derived keys.
2. **Cap Validation:** Total user balances in SQLite + treasury reserve must be proven `<= 100,000,000 SOV` at all times, with 0 SOV granted upon registration.
3. **Authentication Validation:** 100% of mutating and administrative routes must reject requests lacking valid cryptographic session tokens or Ed25519 signatures.
4. **Economic Settlement:** 100% of ad campaign releases must execute coin burns from existing escrow with zero unbacked minting.
