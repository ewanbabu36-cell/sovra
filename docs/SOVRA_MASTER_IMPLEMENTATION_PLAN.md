# SOVRA — MASTER IMPLEMENTATION PLAN & WORKSTREAM ROADMAP

**Document ID:** `SOVRA-AUDIT-DOC-08`  
**Classification:** Master Consolidated Engineering Execution Plan  
**Standard:** Zero-Trust, Dependency-Aware, Evidence-Driven Implementation Standard  
**Repository Working Directory:** `d:\Sovra`  
**Evaluation Date:** November 5, 2026  

---

## 1. Master Plan Overview & Inter-Document Links

This Master Implementation Plan serves as the central operational guide for transitioning SOVRA from its current uncoupled state into a fully hardened, cryptographically secure, decentralized production platform.

### Supporting Audit Reports & Dependencies
- Current State Assessment: [SOVRA_MASTER_CURRENT_STATE.md](SOVRA_MASTER_CURRENT_STATE.md)
- Blueprint Feature Mapping: [SOVRA_BLUEPRINT_FEATURE_MAPPING.md](SOVRA_BLUEPRINT_FEATURE_MAPPING.md)
- Architecture Gap Analysis: [SOVRA_ARCHITECTURE_GAP_ANALYSIS.md](SOVRA_ARCHITECTURE_GAP_ANALYSIS.md)
- Critical Security Backlog: [SOVRA_P0_SECURITY_AND_INTEGRITY_BACKLOG.md](SOVRA_P0_SECURITY_AND_INTEGRITY_BACKLOG.md)
- Monetary Protocol Audit: [SOVRA_COIN_PROTOCOL_GAP_ANALYSIS.md](SOVRA_COIN_PROTOCOL_GAP_ANALYSIS.md)
- Decentralization Readiness: [SOVRA_DECENTRALIZATION_READINESS.md](SOVRA_DECENTRALIZATION_READINESS.md)
- Module Completion Roadmap: [SOVRA_MODULE_COMPLETION_ROADMAP.md](SOVRA_MODULE_COMPLETION_ROADMAP.md)
- Open Decisions & Policies: [SOVRA_OPEN_DECISIONS_AND_DEPENDENCIES.md](SOVRA_OPEN_DECISIONS_AND_DEPENDENCIES.md)
- Acceptance Gates & Criteria: [SOVRA_IMPLEMENTATION_ACCEPTANCE_GATES.md](SOVRA_IMPLEMENTATION_ACCEPTANCE_GATES.md)

---

## 2. Implementation Phases & Gate Governance

The implementation is structured into **Five Sequential Engineering Phases**. Progression between phases is strictly barred until all gate exit criteria pass independent verification.

```
+-----------------------------------------------------------------------------------+
| PHASE 1: Critical Security, Cryptographic & Monetary Invariant Hardening (P0)     |
| Gate: Zero authentication bypasses, zero unbacked minting, audited Double Ratchet |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| PHASE 2: Core Reliability, BOLA Prevention & Media Durability (P1)                |
| Gate: Resumable chunk offsets verified, author checks enforced, crash durable     |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| PHASE 3: Layer-1 Blockchain Daemon Supervision & Monetary Integration (P1/P2)     |
| Gate: sovrad running via supervisor; Node queries L1 RPC; 20-year emission curve   |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| PHASE 4: Proof-of-Usage Mining Pipeline & Telemetry Ingestion (P1/P2)             |
| Gate: 60s heartbeats active; accumulators track 24h milestone; anti-Sybil verified|
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| PHASE 5: Decentralization, Multi-Validator Cluster & Mainnet Genesis (P2)         |
| Gate: 4+ independent validators; 100M cap verified on-chain; Mainnet Genesis      |
+-----------------------------------------------------------------------------------+
```

---

## 3. Work Item Registry

### Tier P0: Critical Security, Cryptographic & Monetary Blockers

---

#### `TSK-P0-01`: Eliminate Header-Based Authentication Bypass (`AUTH-P0-01`)
- **Module:** SOVRA Identity & Ingress
- **Current State:** `scripts/dev-server.ts:89205-89215` trusts `req.headers['x-sovra-did']` unconditionally, granting full authenticated access as any user without credentials.
- **Target State:** `resolvePrincipal()` accepts ONLY verified cryptographic session tokens or RFC 9421 HTTP Message Signatures.
- **Files Affected:** `scripts/dev-server.ts:89200-89230`
- **Dependencies:** None (Immediate blocker).
- **Priority:** `P0` | **Risk:** High | **Complexity:** `SMALL`
- **Acceptance Criteria:** Sending `X-Sovra-DID` without a valid Bearer token returns HTTP 401 Unauthorized across 100% of routes.
- **Required Automated Tests:** Unit test in `tests/security/` proving header impersonation fails.
- **Manual/Hardware Tests:** Curl probe verifying `/api/wallet/assets` rejects spoofed headers.
- **Rollback Consideration:** Git revert of single block in `dev-server.ts`.
- **Independent Verification Method:** Execution of unauthenticated request script verifying 401 response code.

---

#### `TSK-P0-02`: Enforce RBAC on Administrative Feature Routes (`AUTH-P0-02`)
- **Module:** Governance & Admin Security
- **Current State:** `scripts/routes/admin_features.routes.ts` routes (`/update-role`, `/adjust-balance`) execute without auth checks, defaulting to `admin_root`.
- **Target State:** `handleAdminFeatureRoute` takes `enforceAuth()` context; enforces `SUPER_ADMIN` role and multi-admin signature before modifying roles or balances.
- **Files Affected:** `scripts/routes/admin_features.routes.ts:15-120`, `scripts/dev-server.ts:99801`
- **Dependencies:** `TSK-P0-01`.
- **Priority:** `P0` | **Risk:** High | **Complexity:** `MEDIUM`
- **Acceptance Criteria:** Unauthenticated requests to `/api/admin/user/update-role` return 401; non-admin users return 403 Forbidden.
- **Required Automated Tests:** Integration test in `tests/security/` verifying RBAC matrix on admin routes.
- **Manual/Hardware Tests:** Verify admin actions from browser console without session cookie are rejected.
- **Rollback Consideration:** Revert route context handler.
- **Independent Verification Method:** Automated permission matrix test suite execution.

---

#### `TSK-P0-03`: Terminate Free 500 SOV Registration Minting & Centralize Cap Invariant (`FIN-P0-01`)
- **Module:** SOVRA Coin Protocol
- **Current State:** `database-migrations.ts:55` and `database-engine.ts:3062` grant 500.0 SOV on every registration, bypassing the 100M cap.
- **Target State:** Default registration balance set to `0.0 SOV`. Centralized `issueTokens()` method strictly enforces `(circulatingSupply + amount) <= 100_000_000 SOV`.
- **Files Affected:** `scripts/database-migrations.ts:55`, `scripts/database-engine.ts:3062, 3144`, `scripts/database-sqlite.ts:6245`
- **Dependencies:** None.
- **Priority:** `P0` | **Risk:** Critical | **Complexity:** `MEDIUM`
- **Acceptance Criteria:** 1,000 automated user registrations create 0 new circulating tokens. Faucet claim fails if total cap would be exceeded.
- **Required Automated Tests:** Test script registering 1,000 accounts and asserting `totalSystemAccountingSov` remains constant.
- **Manual/Hardware Tests:** Inspect SQLite database records after UI onboarding.
- **Rollback Consideration:** Migration down script reverting column default.
- **Independent Verification Method:** SQLite query `SELECT SUM(balance_sov) FROM users;` before and after registrations.

---

#### `TSK-P0-04`: Eliminate Unbacked Ad Referral Minting & Enforce Deflationary Burn (`FIN-P0-02`)
- **Module:** Creator Studio & Ads Economy
- **Current State:** `scripts/database-engine.ts:16742-16758` mints 2% referral rewards out of thin air on ad release and executes 0% coin burn.
- **Target State:** 100% of payouts, platform fees, and referral rewards deducted strictly from existing campaign escrow. 10% permanent burn executed and debited from supply.
- **Files Affected:** `scripts/database-engine.ts:16735-16765`, `scripts/routes/studio.routes.ts:2230-2270`
- **Dependencies:** `TSK-P0-03`.
- **Priority:** `P0` | **Risk:** High | **Complexity:** `MEDIUM`
- **Acceptance Criteria:** Mathematical invariant holds: `escrowAmount == creatorPayout + platformFee + referralBonus + burnedCoins`. Total system supply decreases by `burnedCoins`.
- **Required Automated Tests:** Unit test in `tests/unit/trading-engine.test.ts` verifying zero inflation on ad release.
- **Manual/Hardware Tests:** Execute sponsored escrow release via UI and inspect supply counter.
- **Rollback Consideration:** Revert ledger calculation function.
- **Independent Verification Method:** Check `GET /api/admin/sovra-supply` before and after ad release.

---

#### `TSK-P0-05`: Replace Deterministic Symmetrical Messaging with Signal Double Ratchet (`SEC-P0-01`)
- **Module:** SOVRA Connect (E2EE)
- **Current State:** `window.SovraE2EE` derives keys from `[myDid, peerDid].sort()` with static salt; server fallback uses SHA-256 seal. No private keys involved.
- **Target State:** Complete Signal-compatible Double Ratchet implementation (X3DH + Curve25519 identity keys + ephemeral ratchets). Server acts as untrusted ciphertext router only.
- **Files Affected:** `scripts/dev-server.ts:34300-34350`, `scripts/routes/chat.routes.ts:380-430`, `apps/sovra-app/src/hooks/useE2EEMessenger.ts`
- **Dependencies:** None.
- **Priority:** `P0` | **Risk:** Critical | **Complexity:** `LARGE`
- **Acceptance Criteria:** Server receives only opaque ciphertext; server logs or database inspection cannot decrypt message text. Forward secrecy verified upon session ratchet.
- **Required Automated Tests:** Cryptographic test verifying message decryption fails if past ratchet keys are exposed.
- **Manual/Hardware Tests:** Send message between two browser sessions; query SQLite `direct_messages` table and prove text is unrecoverable without recipient private key.
- **Rollback Consideration:** Keep dual-read capability for existing legacy chat rows.
- **Independent Verification Method:** Mathematical proof of X25519 key exchange.

---

### Tier P1: Core Product Correctness, Integrations & Reliability

---

#### `TSK-P1-01`: Enforce Author DID Verification on Resumable Chunk Uploads (`VID-P1-01`)
- **Module:** SOVRA Video
- **Current State:** `scripts/routes/video.routes.ts:65-120` allows any requester with `uploadId` to upload video chunks.
- **Target State:** `PATCH /api/videos/upload/chunk` validates `session.author_did === principal.did`.
- **Files Affected:** `scripts/routes/video.routes.ts:65-140`
- **Dependencies:** `TSK-P0-01`.
- **Priority:** `P1` | **Risk:** Medium | **Complexity:** `SMALL`
- **Acceptance Criteria:** Attempting to upload a chunk with a valid session ID but mismatched caller DID returns HTTP 403 Forbidden.
- **Required Automated Tests:** Security BOLA regression test in `tests/security/adversarial-bola-idor-matrix.test.ts`.
- **Manual/Hardware Tests:** Multi-user curl script verifying chunk injection rejection.
- **Rollback Consideration:** Revert route validation block.
- **Independent Verification Method:** Automated test execution verifying 403 exit code.

---

#### `TSK-P1-02`: Byte-Range Offset Verification & Upload Session Auto-Cleanup (`VID-P1-02`)
- **Module:** SOVRA Video
- **Current State:** Chunks assembled monotonically by arrival index; abandoned uploads linger indefinitely on disk.
- **Target State:** Strict byte-offset verification (`Content-Range`); cron task cleans up uploads older than 24h.
- **Files Affected:** `scripts/routes/video.routes.ts:80-160`, `scripts/database-sqlite.ts:6340`
- **Dependencies:** `TSK-P1-01`.
- **Priority:** `P1` | **Risk:** Medium | **Complexity:** `MEDIUM`
- **Acceptance Criteria:** Out-of-order chunks assemble into correct byte stream; abandoned upload directories auto-deleted.
- **Required Automated Tests:** Chunk reordering and assembly test in `tests/e2e/abr-streaming-and-seeder.test.ts`.
- **Manual/Hardware Tests:** Upload 50MB video with simulated 20% packet retry.
- **Rollback Consideration:** Revert chunk write stream logic.
- **Independent Verification Method:** SHA-256 hash comparison between raw source video and assembled video.

---

#### `TSK-P1-03`: Align Go Blockchain Emission Constants to 20-Year Schedule (`CHN-P1-01`)
- **Module:** Consensus & Monetary Layer
- **Current State:** `chain/x/issuance/types/constants.go:30` defines 25 years (`TotalPolicyEpochs = 9125`).
- **Target State:** Recalculate annual seeder schedule array for exactly 20 years (`7,300 daily epochs`) while preserving the 100M uSOV hard cap and exact integer math.
- **Files Affected:** `chain/x/issuance/types/constants.go:30`, `chain/x/issuance/types/emission.go:15-80`
- **Dependencies:** None.
- **Priority:** `P1` | **Risk:** Medium | **Complexity:** `MEDIUM`
- **Acceptance Criteria:** `TotalPolicyEpochs == 7300`. `ComputeEpochAllowance(7300)` returns final residual; epoch 7301 returns 0. Total sum equals exactly `100,000,000,000,000 uSOV`.
- **Required Automated Tests:** Unit test in `chain/x/issuance/types/emission_test.go` asserting exact 100M sum.
- **Manual/Hardware Tests:** Recompile `sovrad.exe` and execute `sovrad query supply`.
- **Rollback Consideration:** Revert Go source file.
- **Independent Verification Method:** Go test suite run (`go test ./x/issuance/...`).

---

#### `TSK-P1-04`: Supervised Background Execution of Layer-1 Node (`CHN-P1-02`)
- **Module:** Decentralized Infrastructure
- **Current State:** `chain/sovrad.exe` is offline; `dev-server.ts` falls back to SQLite mock wallet state.
- **Target State:** Process supervisor daemon launches `sovrad start` on localhost; `scripts/routes/wallet.routes.ts` queries live RPC (`http://127.0.0.1:26657`) for all balances.
- **Files Affected:** `scripts/dev-server.ts:100500`, `scripts/routes/wallet.routes.ts:15-100`
- **Dependencies:** `TSK-P1-03`.
- **Priority:** `P1` | **Risk:** High | **Complexity:** `MEDIUM`
- **Acceptance Criteria:** `GET /status` on port 26657 returns block height `> 0`; wallet route returns on-chain integer balances without fallback errors.
- **Required Automated Tests:** Integration test in `tests/integration/sovra-l1-blockchain.test.ts` executing live transactions.
- **Manual/Hardware Tests:** Query `/api/wallet/assets` and verify balance matches `sovrad query balance`.
- **Rollback Consideration:** Stop daemon and re-enable local fallback.
- **Independent Verification Method:** TCP socket check and RPC balance query.

---

#### `TSK-P1-05`: Proof-of-Usage 60-Second Client Heartbeat & Accumulator Pipeline (`POU-P1-01`)
- **Module:** SOVRA Coin Protocol & Mining
- **Current State:** Faucet gate rejects claims (`< 24h`), but client heartbeat and database accumulator tables do not exist.
- **Target State:** Add SQLite table `user_usage_accumulators`; expose `POST /api/wallet/pou/heartbeat`; clients emit signed 60s pings with activity proof; accumulator increments verified hours upon challenge completion.
- **Files Affected:** `scripts/database-migrations.ts:750`, `scripts/routes/wallet.routes.ts:250-320`, `apps/sovra-app/src/hooks/useAccountLifecycle.ts`
- **Dependencies:** `TSK-P0-01`, `TSK-P0-03`.
- **Priority:** `P1` | **Risk:** Medium | **Complexity:** `LARGE`
- **Acceptance Criteria:** A user accumulating 24 verified hours (1,440 valid heartbeat proofs) successfully unlocks reward eligibility at `/api/wallet/faucet/claim`.
- **Required Automated Tests:** End-to-end simulation of 1,440 heartbeats and subsequent claim execution.
- **Manual/Hardware Tests:** Run client session for 5 minutes and observe accumulator increment in SQLite.
- **Rollback Consideration:** Revert migration and heartbeat route.
- **Independent Verification Method:** SQLite inspection of `verified_usage_seconds`.

---

### Tier P2: Decentralization, Creator Economy & Governance Completion

---

#### `TSK-P2-01`: Creator Studio Real Telemetry Ingestion (`STU-P2-01`)
- **Module:** SOVRA Studio
- **Current State:** Hardcoded CTR (`8.4%`) and duration (`4:12`) mock metrics.
- **Target State:** Dashboard queries actual SQL aggregation over `watch_history` table.
- **Files Affected:** `scripts/database-engine.ts:8500-8540`
- **Dependencies:** None.
- **Priority:** `P2` | **Risk:** Low | **Complexity:** `SMALL`
- **Acceptance Criteria:** Empty channels show 0 views/CTR; new views reflect actual playback times.

---

#### `TSK-P2-02`: Containerized Video Transcoder Service (`VID-P2-02`)
- **Module:** Media Infrastructure
- **Current State:** Main dev-server spawns FFmpeg on host CPU, causing request latency spikes.
- **Target State:** Offload transcode jobs to `services/transcoder` background daemon via IPC queue.
- **Files Affected:** `scripts/video-transcode-pipeline.ts:50-120`, `services/transcoder/src/index.ts`
- **Dependencies:** None.
- **Priority:** `P2` | **Risk:** Medium | **Complexity:** `MEDIUM`
- **Acceptance Criteria:** Main HTTP event loop latency remains `< 20ms` during active 1080p transcode.

---

#### `TSK-P2-03`: CSAM Escalation Pipeline & Formal 66% Quorum Appeals (`MOD-P2-01`)
- **Module:** Trust & Safety / Governance
- **Current State:** Basic community jury without automated legal escalation or supermajority quorum.
- **Target State:** Automated hash quarantine for illegal media; binding 66% juror supermajority quorum for government takedown appeals.
- **Files Affected:** `scripts/routes/admin_features.routes.ts:400-500`, `scripts/database-sqlite.ts:4500`
- **Dependencies:** `TSK-P0-02`.
- **Priority:** `P2` | **Risk:** Medium | **Complexity:** `MEDIUM`
- **Acceptance Criteria:** Takedown appeal fails if quorum `< 66%`; CSAM quarantine executes within 500ms.

---

#### `TSK-P2-04`: Multi-Validator Cluster Testnet Bootstrap (`CHN-P2-01`)
- **Module:** Decentralization & Consensus
- **Current State:** Single-validator local setup (`node0`).
- **Target State:** 4-validator PBFT cluster deployed via Docker Compose with TMKMS remote signing.
- **Files Affected:** `docker/docker-compose.testnet.yml`, `chain/privval/`
- **Dependencies:** `TSK-P1-04`.
- **Priority:** `P2` | **Risk:** High | **Complexity:** `LARGE`
- **Acceptance Criteria:** Network continues producing blocks when 1 validator node is abruptly killed ($N=4, f=1$).

---

### Tier P3: Optimizations, Hardware UX Refinements & Future Enhancements

---

#### `TSK-P3-01`: Android Foreground Service for Background BLE Mesh (`MSH-P3-01`)
- **Module:** SOVRA Mesh
- **Target State:** Foreground service maintaining BLE GATT advertising in Doze mode.
- **Priority:** `P3` | **Complexity:** `MEDIUM`

#### `TSK-P3-02`: Web Bluetooth Limitation Transparency Banner (`UX-P3-01`)
- **Module:** Web Client UI
- **Target State:** Explanatory banner displayed when browser lacks BLE peripheral capabilities.
- **Priority:** `P3` | **Complexity:** `SMALL`

---

## 4. Workstream Parallelism & Execution Sequence

```
[Sequential Path 1: Core Security & Monetary Base]
TSK-P0-01 (Remove Header Bypass) ──> TSK-P0-02 (Admin RBAC) ──> TSK-P0-03 (0 Registration Grant) ──> TSK-P0-04 (Escrow Settlement)

[Parallel Workstream A: Cryptographic Privacy]
TSK-P0-05 (Signal Double Ratchet) ──> Multi-Device Key Vault ──> Group Sender Keys

[Parallel Workstream B: Media & Ingestion]
TSK-P1-01 (Author BOLA Check) ──> TSK-P1-02 (Byte Offsets & TTL) ──> TSK-P2-02 (Transcoder Worker)

[Parallel Workstream C: L1 Blockchain Authority]
TSK-P1-03 (20-Year Curve) ──> TSK-P1-04 (Supervised sovrad) ──> TSK-P1-05 (PoU Heartbeats) ──> TSK-P2-04 (4-Node Cluster)
```

---

## 5. Summary Matrix of Implementation Work Items

| Task ID | Module | Priority | Complexity | Risk | Direct Dependency | Target Phase |
| :--- | :--- | :---: | :---: | :---: | :--- | :---: |
| `TSK-P0-01` | Identity / Auth | **P0** | SMALL | High | None | **Phase 1** |
| `TSK-P0-02` | Admin / Governance | **P0** | MEDIUM | High | `TSK-P0-01` | **Phase 1** |
| `TSK-P0-03` | Monetary Protocol | **P0** | MEDIUM | Critical | None | **Phase 1** |
| `TSK-P0-04` | Creator Studio Ads | **P0** | MEDIUM | High | `TSK-P0-03` | **Phase 1** |
| `TSK-P0-05` | Connect (E2EE) | **P0** | LARGE | Critical | None | **Phase 1** |
| `TSK-P1-01` | Video Ingestion | **P1** | SMALL | Medium | `TSK-P0-01` | **Phase 2** |
| `TSK-P1-02` | Video Resumability | **P1** | MEDIUM | Medium | `TSK-P1-01` | **Phase 2** |
| `TSK-P1-03` | Consensus / Issuance| **P1** | MEDIUM | Medium | None | **Phase 3** |
| `TSK-P1-04` | L1 Integration | **P1** | MEDIUM | High | `TSK-P1-03` | **Phase 3** |
| `TSK-P1-05` | Mining / PoU | **P1** | LARGE | Medium | `TSK-P0-03` | **Phase 4** |
| `TSK-P2-01` | Studio Analytics | **P2** | SMALL | Low | None | **Phase 4** |
| `TSK-P2-02` | Media Transcoder | **P2** | MEDIUM | Medium | `TSK-P1-02` | **Phase 4** |
| `TSK-P2-03` | Trust & Safety | **P2** | MEDIUM | Medium | `TSK-P0-02` | **Phase 5** |
| `TSK-P2-04` | Multi-Validator L1 | **P2** | LARGE | High | `TSK-P1-04` | **Phase 5** |
| `TSK-P3-01` | Mesh Native Mobile | **P3** | MEDIUM | Low | None | **Phase 5** |
| `TSK-P3-02` | Web Client UX | **P3** | SMALL | Low | None | **Phase 5** |
