# SOVRA — MASTER CURRENT STATE ASSESSMENT

**Document ID:** `SOVRA-AUDIT-DOC-01`  
**Classification:** Baseline Architectural Audit  
**Standard:** Zero-Trust, Evidence-Driven, Read-Only Forensic Inspection  
**Repository Working Directory:** `d:\Sovra`  
**Evaluation Date:** November 5, 2026  
**Baseline Git Commit:** `6306538`  
**Active Git Branch:** `remediation/p0-phase4.0-database-modernization`  

---

## 1. Executive Summary

This report establishes the verified, factual baseline of the SOVRA codebase. It reconciles claims from previous development cycles (Phases 37 through 39.1) against actual files, line numbers, running processes, and database structures.

SOVRA is conceived as a decentralized, privacy-first super-app combining sovereign identity, social networking, short-form and long-form video streaming, end-to-end encrypted messaging, Bluetooth Low Energy (BLE) mesh communications, a creator studio with escrow monetization, and an independent layer-1 blockchain with participation-based Proof-of-Usage mining capped at 100,000,000 SOVRA.

### High-Level Architectural Reality
The codebase currently contains **two largely disconnected systems**:
1. **The Node.js Application Monolith (`scripts/dev-server.ts`)**: A ~101,400-line single-process server powering the active web application on port 3001. It operates an embedded SQLite WAL database (`scripts/database-sqlite.ts`), an in-memory JSON state fallback (`scripts/database-engine.ts`), an HTTP/WebSocket dispatcher, WebRTC signaling, and pseudo-E2EE encryption.
2. **The Go Layer-1 Blockchain Daemon (`chain/sovrad.exe`)**: A compiled, independent Cosmos/Tendermint-style blockchain implementing a Pebble KVStore, Ed25519 validator consensus, CosmWasm VM, integer `uSOV` accounting, and a 100M token issuance schedule. **This blockchain daemon is currently offline and not integrated into the live application flow.** The web runtime falls back entirely to local SQLite balances and mock wallet balances.

---

## 2. Git Forensics & Working-Tree Status

### 2.1 Branch and Commit Topology
- **Current Branch:** `remediation/p0-phase4.0-database-modernization`
- **Upstream Tracking:** `origin/remediation/p0-phase4.0-database-modernization` (in sync with remote commit `6306538`)
- **Working Tree State:** Dirty (7 modified files, 2 untracked test suites, 0 staged changes)

```
git status output (Verified 2026-11-05):
Changes not staged for commit:
  modified:   scripts/admin-console.ts
  modified:   scripts/database-engine.ts
  modified:   scripts/database-migrations.ts
  modified:   scripts/database-sqlite.ts
  modified:   scripts/dev-server.ts
  modified:   scripts/routes/admin_features.routes.ts
  modified:   scripts/routes/chat.routes.ts

Untracked files:
  tests/security/p0-phase38-remediation.test.ts
  tests/security/p0-phase39-remediation.test.ts
```

### 2.2 Forensic Explanation of Unstaged Modifications
The 7 modified files represent hotfixes developed during Phases 38, 38.2, and 39 to address P0 audit findings:
- `scripts/database-migrations.ts`: Added migrations `008_financial_idempotency_keys`, `009_durable_video_upload_sessions`, and `010_e2ee_encrypted_chat_messages`.
- `scripts/database-sqlite.ts`: Implemented `adjustUserBalanceWithAudit()` with 100M cap checks and `video_upload_sessions` persistence.
- `scripts/database-engine.ts`: Wrapped balance adjustments and wallet operations in SQLite dual-sync.
- `scripts/dev-server.ts`: Added `/readyz` deep health probe, graceful shutdown handlers, and fail-closed PoU faucet checks.
- `scripts/routes/chat.routes.ts`: Added server-side envelope sealing fallback for direct chats.
- `scripts/routes/admin_features.routes.ts`: Enforced supply cap queries.

**Crucial Compliance Note:** In adherence to non-negotiable rules, these modifications have NOT been committed or pushed. The working tree remains preserved.

---

## 3. Monorepo Structure & Package Inventory

The repository is structured as a pnpm workspace monorepo governed by `package.json` (pnpm v12.8.1, Node >= 20.0.0, Turbo v2.4.4).

```
d:\Sovra\
├── apps/
│   ├── sovra-app/          # Core web application (Vanilla TS + ESBuild bundled IIFE)
│   ├── sovra-admin/        # Legacy administrative portal interface
│   ├── sovra-mobile/       # React Native / Expo application (Android & iOS)
│   ├── ios/                # Native iOS project wrapper
│   └── twa/                # Android Trusted Web Activity manifest & wrapper
├── packages/
│   ├── ai/                 # On-device taste-ranking, feed synthesis, vector embeddings
│   ├── crypto/             # Ed25519, BIP39, PRF, PQC, ZK-attestation primitives
│   ├── identity/           # W3C did:key:z, session tokens, social recovery, key rotation
│   ├── messaging/          # Bitchat mesh, WebRTC signaling, blind push relays
│   ├── moderation/         # Content reporting types, rule models, safety filters
│   ├── p2p/                # Libp2p node, BLE GATT adapters, DHT, Gossipsub, Outbox
│   ├── protocol/           # Distributed state machine, vector clocks, CRDTs, envelopes
│   ├── shared/             # Logging, error types, i18n, hardening utilities
│   ├── social/             # Social graph, HLC timestamps, channel models
│   ├── storage/            # BitSwap, IPFS UnixFS, blockstore, reels storage adapter
│   └── ui/                 # Design tokens, styling primitives, theme constants
├── services/
│   ├── api/                # Standalone API gateway definitions
│   ├── moderation-worker/  # Background worker for async content scanning
│   ├── search/             # Omni-search indexer service
│   └── transcoder/         # Standalone video transcoding worker (FFmpeg wrapper)
├── chain/                  # Independent Cosmos/Tendermint-style Layer-1 Go Blockchain
│   ├── cmd/sovrad/         # Main daemon CLI entrypoint (sovrad.exe)
│   ├── node/               # ABCI application engine & Tendermint consensus adapter
│   ├── p2p/                # Go P2P switch, peer discovery, connection pool
│   ├── privval/            # Remote signer daemon (TMKMS / CloudHSM support)
│   ├── store/              # Pebble KVStore wrapper with multi-version Merkle state
│   └── x/                  # Blockchain State Modules:
│       ├── auth/           # Account nonces, auth verification, encrypted keystores
│       ├── bank/           # Integer uSOV balance transfers, minting, burning
│       ├── issuance/       # Hard cap enforcement (100M SOV) & emission recurrence
│       └── wasm/           # CosmWasm bytecode execution & revenue split contracts
├── nodes/                  # Standalone P2P node configuration templates
│   ├── community-node/     # Regional community gateway node
│   ├── full-node/          # P2P archiving node
│   ├── index-node/         # Content index and search node
│   ├── relay-node/         # TURN/ICE & Libp2p circuit relay node
│   └── storage-node/       # IPFS BitSwap storage seeder node
├── scripts/                # Active Server Infrastructure & Developer Tooling
│   ├── dev-server.ts       # 101,421-line active application server (Port 3001)
│   ├── database-engine.ts  # In-memory database engine & JSON persistence layer
│   ├── database-sqlite.ts  # SQLite WAL relational storage engine
│   ├── database-migrations.ts # Deterministic SQLite schema migration engine (001-010)
│   ├── routes/             # Modularized HTTP route controllers (24 route files)
│   ├── video-transcode-pipeline.ts # Video chunker & HLS pipeline
│   ├── ble-mesh-engine.ts  # Simulated BLE mesh radar & DTN store-and-forward queue
│   └── build-client-bundle.ts # ESBuild bundler for apps/sovra-app
└── tests/                  # Test suites (unit, integration, e2e, security, reliability)
```

---

## 4. Active Runtime & Service Boundaries

### 4.1 Process Execution Model
Currently, a single Node.js process is active:
- **Process Command:** `node --experimental-strip-types scripts/dev-server.ts`
- **Listening Port:** `3001` (HTTP & WebSockets)
- **PID / Task:** Running as daemon background task `task-141483`
- **Runtime Health:**
  - `GET /healthz`: Returns HTTP 200 `{"status":"healthy","uptimeSeconds":975,"memoryUsage":{"rss":44634112,"heapUsed":31179428},"database":{"backend":"sqlite","journalMode":"WAL"}}`
  - `GET /readyz`: Returns HTTP 200 `{"status":"ready","timestamp":1793884794725}`

### 4.2 Frontend Architecture
- **Web Client (`apps/sovra-app`):** Bundled into a single file `apps/sovra-app/dist/bundle.js` (~780 KB) via `scripts/build-client-bundle.ts`.
- **UI Surface Engine:** `apps/sovra-app/src/ui/sovra-surface/SovraSurfaceEngine.ts` manages a stack of polymorphic UI surfaces (CallSurface, ChatSurface, WatchSurface, ReelsSurface, ProfileSurface, StudioController) rendered inside an SPA container.
- **Client Execution:** The browser loads `bundle.js`, which attaches `window.SovraApp`. The server inlines an HTML template containing the holographic navigation shell and script tags.

### 4.3 Route Dispatch Architecture
The HTTP server in `scripts/dev-server.ts` uses a hybrid dispatch model:
1. **Modular Routes (`scripts/routes/`):** 24 route handlers are delegated across distinct files:
   - `admin_features.routes.ts`: User roles, balance adjustments, 6 revenue streams
   - `chat.routes.ts`: Direct messaging, envelope sealing, channel messaging
   - `video.routes.ts`: Chunked video uploads, channel subscriptions, comments
   - `studio.routes.ts`: Creator dashboard, sponsorship escrows, promotions
   - `wallet.routes.ts`: Multi-asset portfolio, AMM creator token swaps
   - `call.routes.ts`: WebRTC signaling, SSE heartbeats, audio chunk relays
   - `feed.routes.ts`: Trending tags, personalized feed queries
   - `media.routes.ts`: Token-gated media streams, signed HLS tickets
   - `push.routes.ts`, `depin.routes.ts`, `zk.routes.ts`, `trading.routes.ts`, etc.
2. **Monolithic Legacy Routes:** Over 15,000 lines of inline route logic remain embedded directly in `scripts/dev-server.ts` (lines 89,000 to 101,000).

---

## 5. Database Architecture & Storage Ownership

SOVRA employs a dual-tier persistence pattern:

```
+-----------------------------------------------------------+
|                 Node.js Dev-Server Runtime                |
+-----------------------------------------------------------+
          |                                      |
          v                                      v
+-----------------------+              +--------------------+
| scripts/database-     |              | scripts/database-  |
| sqlite.ts (Primary)   |              | engine.ts (JSON)   |
| Embedded SQLite (WAL) | <----------> | .sovra-storage-dev/|
| 10 Schema Migrations  |  Dual-Sync   | database.json      |
+-----------------------+              +--------------------+
```

### 5.1 SQLite Migrations (001 through 010)
Defined in `scripts/database-migrations.ts`:
1. `001_core_entities`: `users`, `user_sessions`, `follows`, `posts`, `comments`, `direct_messages`, `conversations`, `channels`, `videos`, `notifications`, `token_transfers`, `audit_ledger`.
2. `002_spaces_and_groups`: `spaces`, `groups`, `group_members`.
3. `003_reels_and_stories`: `reels`, `stories`, `story_views`.
4. `004_trust_and_safety`: `content_reports`, `moderation_actions`.
5. `005_performance_indexes`: B-Tree indexes for feed optimization and search.
6. `006_community_jury_moderation`: `community_jury_cases`, `community_jury_votes`, `juror_reputations`.
7. `007_phase40_social_collections`: `saved_posts`, `user_lists`, `highlights`.
8. `008_financial_idempotency_keys`: `financial_idempotency_keys` table for zero-loss financial transactions.
9. `009_durable_video_upload_sessions`: `video_upload_sessions` for crash-resilient chunked uploads.
10. `010_e2ee_encrypted_chat_messages`: Migration adding `ciphertext_hex`, `algorithm`, and `key_derivation_version` to `direct_messages`.

### 5.2 Storage Vulnerabilities & Inconsistencies
- **Dual-Sync Drift:** While SQLite is authoritative for user accounts and sessions, several endpoints (e.g. `createSponsoredEscrow`, `createPromotionCampaign`) write primarily to `this.db` in `database-engine.ts`, which serializes to an unindexed JSON file (`.sovra-storage-dev/database.json`).
- **Floating-Point Ledger:** SQLite defines `balance_sov REAL NOT NULL DEFAULT 500.0`. In IEEE-754 floating point arithmetic, repeated fractional transfers incur precision drift.
- **Unconstrained 500 SOV Grant:** Every user record inserted in `001_core_entities` (line 55) and `database-engine.ts` (line 3062) automatically receives `500.0 SOV` minted from nothing.

---

## 6. Go Blockchain Implementation (`chain/`) Status

### 6.1 State Machine Architecture
The Go codebase in `chain/` represents a complete layer-1 blockchain daemon (`sovrad`):
- **Core Binary:** `chain/sovrad.exe` (29.5 MB, Go 1.27.0).
- **Consensus Engine:** Tendermint-inspired Byzantine Fault Tolerant (PBFT) consensus with round-robin leader proposal, 2/3 validator vote aggregation, and Merkle app-hash validation.
- **Storage Subsystem:** Pebble LSM-tree database (`github.com/cockroachdb/pebble`) implementing multi-prefix state trees for accounts (`0x10`), total supply (`0x11`), block heights (`0x30`), app hashes (`0x31`), and validators (`0x36`).
- **Cryptographic Engine:** Ed25519 signatures, SHA-256 state hashing, AES-256-GCM encrypted keystores with Scrypt KDF.
- **CosmWasm Engine:** Embedded WebAssembly runtime (`github.com/tetratelabs/wazero`) executing compiled smart contracts with memory limits and gas metering.

### 6.2 Monetary Policy Module (`chain/x/issuance`)
- **Base Denomination:** `usov` (Micro-SOV: 1 SOV = 1,000,000 uSOV).
- **Lifetime Hard Cap:** Exactly `100,000,000 SOV` = `100,000,000,000,000 uSOV` (`types.GlobalLifetimeCap`).
- **Target Emission Pools:**
  - Genesis Pool: `30,000,000 SOV`
  - Community Pool: `40,000,000 SOV`
  - Validator Pool: `20,000,000 SOV`
  - Seeder Pool: `10,000,000 SOV`
- **Emission Recurrence:** Coded as a 25-year (9,125 daily epochs) geometric decaying schedule with exact 2:4:1 ratios (`V_y:C_y:S_y`).

### 6.3 Actual Integration Status: DISCONNECTED
- **Daemon Inactive:** `sovrad.exe` is not running. Port 26657 is closed (`fetch('http://127.0.0.1:26657/status')` fails with connection refused).
- **Application Decoupling:** When the Node.js application attempts to query `${PRIMARY_RPC}/query/balance`, it catches the connection error and falls back to an in-memory dictionary or SQLite.
- **Silent Test Skipping:** `tests/integration/sovra-l1-blockchain.test.ts` contains `if (!isL1Online) return;` inside test cases, allowing test runners to report "All Passed" while consensus tests are completely bypassed.

---

## 7. Test Suites & Verification Baseline

The repository contains 18 security test files, 15 integration test files, and over 40 E2E suites.
- **Security Test Execution:** Running `npx vitest run tests/security/` executes **220 tests across 18 test files** with **100% pass rate** (36.75s).
- **Core Passing Tests:**
  - `p0-phase38-remediation.test.ts`: 15/15 passed (Admin kill switch, financial idempotency, SQLite dual-sync).
  - `p0-phase39-remediation.test.ts`: 13/13 passed (WAL truncate, /readyz deep probe, fail-closed PoU claim gate).
  - `wal-forensic-erasure.test.ts`: Passed (Cryptographic zeroization of revoked keys).
  - `rbac-role-resource-matrix.test.ts`: Passed (Permission matrix validation).
- **Testing Blindspot:** Passing unit tests verify isolated functions (e.g. that a helper function throws when `verifiedHours < 24`), but do NOT verify end-to-end multi-process decentralization or cross-tier L1 state synchronization.

---

## 8. Historical Audit Reconciliation

| Historical Audit Phase | Key Claims Made | Independent Verification Outcome | Current Code Reality |
| :--- | :--- | :--- | :--- |
| **Phase 37 / 37.1** | Discovered 183 non-functional buttons, 147 undefined JS references, and fake UI elements. | **Verified.** | Phase 38 fixed P0 kill-switch buttons; remaining P1/P2 unwired buttons remain in non-critical UI surfaces. |
| **Phase 38 / 38.2** | Implemented persistent financial idempotency and admin kill switch in SQLite. | **Verified.** | SQLite table `financial_idempotency_keys` is active; `adjustUserBalanceWithAudit` validates keys atomically. |
| **Phase 39** | Remediated E2EE, 100M supply cap, crash durability, and single-process risk. | **Partially Verified.** | Crash durability and `/readyz` probe work. E2EE and supply cap contain fatal architectural flaws. |
| **Phase 39.1** | Independent audit exposed public DID key derivation in E2EE and registration 500 SOV grant bypass. | **Confirmed.** | Both vulnerabilities remain live in the working tree. |

---

## 9. Baseline Conclusion

The SOVRA repository has high-quality foundational building blocks: a rich TypeScript type system, a fully compiled Go blockchain daemon with CosmWasm support, modularized route dispatch, and an embedded SQLite database with 10 migrations. 

However, the application layer is tethered to a monolithic Node.js server that runs an isolated financial ledger, derives encryption keys from public strings, and is completely disconnected from the Go blockchain. 

A controlled, evidence-backed implementation roadmap must bridge these two systems, eliminate critical security bypasses, and transition SOVRA to an authoritative, decentralized protocol.
