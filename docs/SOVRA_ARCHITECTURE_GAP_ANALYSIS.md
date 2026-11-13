# SOVRA — ARCHITECTURE GAP ANALYSIS & EVOLUTION PLAN

**Document ID:** `SOVRA-AUDIT-DOC-03`  
**Classification:** Systems Architecture, Data Flow & Topology Evaluation  
**Standard:** Zero-Trust, Evidence-Driven Architectural Analysis  
**Repository Working Directory:** `d:\Sovra`  
**Evaluation Date:** November 5, 2026  

---

## 1. Executive Summary

This document contrasts the **Current As-Built Architecture** with the **Target Sovereign Vision Architecture**. It analyzes trust boundaries, data flows, single points of failure (SPOFs), and duplicate subsystems. Rather than proposing an unnecessary and risky rewrite, it outlines an incremental evolutionary migration plan that bridges the Node.js application layer to the standalone Go Layer-1 blockchain (`sovrad.exe`) and introduces true cryptographic zero-trust boundaries.

---

## 2. Current Architecture Diagram (As-Built)

```
[ Client Layer ]
  +-------------------------+    +-----------------------+    +----------------------+
  | Browser Web App         |    | React Native Mobile   |    | Standalone CLI / P2P |
  | (apps/sovra-app bundle) |    | (apps/sovra-mobile)   |    | (nodes/community)    |
  +-------------------------+    +-----------------------+    +----------------------+
               \                             |                             /
                \____________________________|____________________________/
                                             |
                                  HTTP / WebSockets (Port 3001)
                                             |
[ Single-Process Monolith ]                  v
  +----------------------------------------------------------------------------------+
  | scripts/dev-server.ts (~101,400 LOC Single Node.js Runtime)                      |
  |                                                                                  |
  |  [ Authentication & Identity ]                                                   |
  |    - resolvePrincipal(): Checks Bearer token OR accepts unauthenticated          |
  |      'X-Sovra-DID' header directly! (AUTH-P0-01)                                 |
  |                                                                                  |
  |  [ Modular Route Dispatch ]                                                      |
  |    - scripts/routes/chat.routes.ts   (Direct messaging, PBKDF2/SHA-256 seal)     |
  |    - scripts/routes/video.routes.ts  (Chunked uploads without BOLA checks)       |
  |    - scripts/routes/studio.routes.ts (Escrows, hardcoded CTR/Duration analytics) |
  |    - scripts/routes/wallet.routes.ts (Queries L1 RPC -> falls back to SQLite)    |
  |    - scripts/routes/admin_features.routes.ts (Unauthenticated admin endpoints)   |
  |                                                                                  |
  |  [ Monolithic In-Memory State ]                                                  |
  |    - Maps for SSE calling, audio chunks, in-memory rate limits, and DTN queues   |
  |                                                                                  |
  |  [ Dual-Sync Storage Engine ]                                                    |
  |    - scripts/database-sqlite.ts (Embedded SQLite WAL, 10 migrations)             |
  |    - scripts/database-engine.ts (In-memory `this.db` -> JSON file persistence)   |
  +----------------------------------------------------------------------------------+
          |                                                               |
          | (Filesystem read/write)                                       | (Failed RPC / Offline)
          v                                                               v
  +-----------------------------------+               +------------------------------+
  | Local Disk Storage                |               | Go L1 Blockchain Daemon      |
  |  - .sovra-storage-dev/            |               | (chain/sovrad.exe)           |
  |    - database.json (unindexed)    |               | [CURRENTLY OFFLINE / CLOSED] |
  |    - uploads/ (video chunks)      |               |  - Port 26657: Unreachable   |
  |  - sovra_embedded.sqlite (WAL db) |               |  - Pebble KVStore uncoupled  |
  +-----------------------------------+               +------------------------------+
```

---

## 3. Proposed Target Architecture Diagram

```
[ Client Layer ]
  +----------------------------+   +-----------------------------+
  | Web Client (WASM Crypto)   |   | Native Mobile (Secure Encl) |
  |  - Signal Double Ratchet   |   |  - Native BLE 5.3 Mesh      |
  |  - WebAuthn PRF Enclave    |   |  - Local SQLite Cache       |
  +----------------------------+   +-----------------------------+
                 \                               /
                  \   RFC 9421 Signed Requests  /
                   \___________________________/
                                 |
                                 v
[ Gateway & Routing Layer ]
  +-------------------------------------------------------------+
  | SOVRA Gateway & Ingress Router (TLS Termination & Auth Gate)|
  |  - Signature Verification: Verifies Ed25519 request headers |
  |  - Strict Session Enforcement: Eliminates X-Sovra-DID trust |
  |  - Rate Limiting & DoS Mitigation                           |
  +-------------------------------------------------------------+
        /                        |                         \
       v                         v                          v
[ Application Services ]  [ Media / Transcoder ]    [ Node.js WebRTC Signaling ]
  - Social & Feeds          - Video Ingestion         - Ephemeral Call Signaling
  - Spaces & Community      - FFmpeg ABR Pipeline     - STUN / TURN / Relay Pool
  - Moments & Reels         - BitSwap CID Pinning     - Isolated from DB transactions
       |                         |
       +------------+------------+
                    |
                    v
[ Persistence & State Layer ]
  +-------------------------------------------------------------+
  | Primary Relational Database (PostgreSQL / SQLite WAL Engine)|
  |  - Strict Zero-Float Accounting (Base integer uSOV)         |
  |  - Idempotent Transaction Ledgers & Audit Trails            |
  |  - Ephemeral Session Store                                  |
  +-------------------------------------------------------------+
                    |
                    | (Authoritative Consensus & Money Transfer)
                    v
[ Consensus & Monetary Layer (Layer-1) ]
  +-------------------------------------------------------------+
  | SOVRA L1 Blockchain Core (chain/sovrad daemon)             |
  |  - Tendermint PBFT Consensus & P2P Gossip (Port 26656)      |
  |  - Pebble Multi-Store: Pebble KV, Merkle State Commitment   |
  |  - x/issuance: Enforces 100M Cap across ALL coin creations  |
  |  - x/bank: Integer uSOV balance transfers & verifiable burn |
  |  - x/wasm: Creator token contracts & multi-sig split escrows|
  +-------------------------------------------------------------+
```

---

## 4. Existing vs. Target Component Mapping

| Architectural Component | Current Implementation | Target Sovereign Blueprint | Evolution Strategy |
| :--- | :--- | :--- | :--- |
| **Authentication Gate** | `resolvePrincipal()` in `dev-server.ts:89139` accepts raw `X-Sovra-DID` header with zero signature. | Cryptographic request verification (RFC 9421 HTTP Message Signatures) tied to registered session tokens. | **FIX:** Deprecate `X-Sovra-DID` header trust. Require valid Bearer token or signed nonces. |
| **Identity Registry** | `users` table in SQLite; `did.ts` library in `packages/identity`. | On-chain W3C DID document registry with cryptographic key rotation assertions. | **EXTEND:** Wire `packages/identity/src/rotation.ts` to L1 `x/auth` state. |
| **1:1 Messaging** | Symmetrical AES-256-GCM derived from public DIDs (`[didA, didB].sort()`) or server seal. | Signal Double Ratchet (X3DH + Curve25519) with ephemeral key exchange and forward secrecy. | **REPLACE:** Integrate audited Double Ratchet engine; zero server-side plaintext exposure. |
| **Monetary Authority** | SQLite `users.balance_sov` (floating point) with unconstrained 500 SOV registration grants. | Authoritative Go L1 Blockchain (`sovrad`) with integer `uSOV` precision and strict 100M cap. | **INTEGRATE:** Bridge Node.js gateway to `sovrad` RPC via background daemon supervisor. |
| **Ad Escrow & Burn** | In-memory `sponsored_escrows` array; 95% creator / 5% platform / 0% burn / 2% unbacked referral mint. | Smart contract escrow in `x/wasm`; creator payout + platform fee + permanent coin burn from existing supply. | **FIX:** Eliminate unbacked referral minting; route escrows through atomic ledger with verified burn. |
| **Video Uploads** | `video_upload_sessions` in SQLite; raw byte append in `PATCH /chunk` without author validation. | Resumable chunked upload with author DID verification, byte-offset checksums, and auto-cleanup. | **FIX:** Add author check on chunk routes; enforce offset math; attach TTL garbage collector. |
| **Video Transcoding** | Main thread spawns FFmpeg or slices raw MP4 into fake `.ts` files. | Isolated worker (`services/transcoder`) executing containerized FFmpeg multi-resolution ABR jobs. | **EXTEND:** Offload transcode jobs to background service queue. |
| **BLE Mesh** | Simulated DTN engine in `scripts/ble-mesh-engine.ts`; React Native bridge in mobile app. | Native Android/iOS BLE 5.3 GATT mesh with store-and-forward outbox and gateway bridge nodes. | **KEEP:** Mobile native bridge; document Web Bluetooth browser limitations in UX. |

---

## 5. End-to-End Data Flow Traces

### 5.1 Identity Registration Flow
```
[User Device]                 [Ingress Gateway]             [SQLite / User DB]         [L1 Blockchain]
      |                               |                              |                        |
  1. Generate Ed25519 Keypair         |                              |                        |
      |                               |                              |                        |
  2. POST /api/auth/register --------->                              |                        |
     (pubKey, handle, signature)      |                              |                        |
                                  3. Verify Ed25519                  |                        |
                                     Signature                       |                        |
                                      |                              |                        |
                                  4. Insert User Record ------------->                        |
                                     (balance = 0 uSOV)              |                        |
                                      |                              |                        |
                                  5. Optional: Issue Session Token ->|                        |
                                      |                              |                        |
                                  6. Query / Initialize Account ------------------------------->
                                      |                                                       |
  7. Return Session <-----------------+                                                       |
```

### 5.2 End-to-End Encrypted Messaging Flow
```
[Alice (Sender)]              [SOVRA Server Gateway]         [SQLite Storage]         [Bob (Recipient)]
      |                               |                              |                        |
  1. Fetch Bob's Prekey Bundle ------->                              |                        |
     GET /api/chat/prekey?did=Bob     |                              |                        |
  2. Return Signed Prekeys <----------+                              |                        |
      |                                                              |                        |
  3. X3DH Key Agreement                                              |                        |
     + Double Ratchet Encrypt                                        |                        |
      |                                                              |                        |
  4. POST /api/chat/send ------------->                              |                        |
     (recipientDid, ephemeralKey,     |                              |                        |
      ratchetHeader, ciphertextHex)   |                              |                        |
                                  5. Verify Authentication           |                        |
                                     (Zero Cleartext Readable)       |                        |
                                      |                              |                        |
                                  6. Persist Ciphertext Envelope ---->                        |
                                      |                                                       |
                                  7. Dispatch WebSocket / Push ------------------------------->
                                                                                              |
                                                                                  8. Decrypt with Ratchet
                                                                                     Private State
```

### 5.3 Coin Transaction & Campaign Escrow Flow
```
[Advertiser / User]           [Application Gateway]          [L1 Chain Node (sovrad)]  [Creator Wallet]
      |                               |                              |                        |
  1. Sign Tx: Lock Escrow             |                              |                        |
     POST /api/escrow/create --------->                              |                        |
                                  2. Broadcast Signed Tx ------------>                        |
                                     (broadcast_tx_commit)           |                        |
                                                                 3. Debit Advertiser uSOV     |
                                                                 4. Lock in Module Escrow     |
                                                                 5. Commit Block Invariant    |
                                                                     |                        |
                                  6. Escrow Confirmed <--------------+                        |
                                      |                                                       |
  7. Creator Delivers Content --------+                                                       |
      |                               |                                                       |
  8. Release Escrow ------------------>                                                       |
                                  9. Execute Smart Contract ---------------------------------->
                                     Split & Settlement:             |                        |
                                     - 70% Creator Credit            |------------------------>
                                     - 20% Platform Fee              | (Module Account)       |
                                     - 10% Permanent Burn            | (BurnCoins: uSOV)      |
                                                                 10. Invariant Check:         |
                                                                     Supply -= BurnAmount     |
```

---

## 6. Trust Boundaries & Cryptographic Key Ownership

1. **Client-Owned Private Keys:**
   - Ed25519 Identity Private Key: Held only in client memory, browser WebCrypto non-exportable storage, or iOS Keychain / Android KeyStore.
   - Signal Ratchet Ephemeral Keys: Ephemeral; zeroized immediately upon ratchet progression.
   - Master Recovery Seed (BIP39): Displayed once during onboarding; never transmitted to or stored on server.
2. **Server Trust Boundary:**
   - The server is an **untrusted router and ciphertext custodian** for messaging.
   - The server acts as an authorized gateway for social feeds, content delivery, and media transcoding.
   - The server **must never possess the ability to decrypt private communications or unilaterally mint coins**.
3. **L1 Consensus Trust Boundary:**
   - The Go blockchain is the **authoritative arbiter of monetary state, token supply, and smart contracts**.
   - Consensus is guaranteed by Byzantine Fault Tolerant validator vote thresholds (2/3+ stake).

---

## 7. Single Points of Failure (SPOF) Analysis

| Component | Failure Mode | Impact | Severity | Mitigation Architecture |
| :--- | :--- | :--- | :---: | :--- |
| **`scripts/dev-server.ts`** | Process crash, uncaught exception, or Node.js OOM. | 100% outage: Web app, REST APIs, WebSockets, signaling, and database write lock severed. | **P0** | Decompose into independent micro-services managed by process supervisors (PM2 / systemd / Docker Compose). |
| **Single SQLite File (`sovra_embedded.sqlite`)** | Disk corruption, lock contention during heavy concurrent video chunking. | All mutating API calls fail; database entering read-only or corrupted state. | **P1** | Retain SQLite WAL mode for edge/local nodes; transition high-concurrency production deployments to PostgreSQL. |
| **In-Memory Signaling Maps** | Server restart terminates all active WebRTC call handshakes. | Active calls drop signaling; incoming calls cannot be answered. | **P1** | Persist signaling sessions in Redis or SQLite ephemeral tables with heartbeat TTLs. |
| **Local Video Transcode Spawn** | FFmpeg process monopolizes 100% CPU on host machine. | API response latency spikes; heartbeat timeouts trigger false crash restarts. | **P2** | Isolate transcoding into dedicated background container worker (`services/transcoder`). |

---

## 8. Integration Gaps & Duplicate Subsystem Risks

### 8.1 The Dual-Ledger Problem
- **Risk:** SOVRA currently maintains two separate balance records:
  1. `balance_sov REAL` in SQLite `users` table.
  2. `x/bank` integer balances in Go Pebble KVStore.
- **Consequence:** Transactions executed in the web UI update SQLite but never write to the blockchain. If the blockchain is brought online, user balances will disagree completely.
- **Architectural Remedy:** SQLite must act purely as an indexed cache / read-projection of L1 account state. All coin debits and credits must be dispatched to `sovrad` via signed transactions.

### 8.2 The Dual-P2P Stack Problem
- **Risk:**
  1. `packages/p2p` implements a Libp2p/TypeScript P2P stack (Gossipsub, Bitswap, DHT).
  2. `chain/p2p` implements a Go Tendermint P2P switch.
- **Consequence:** Network isolation: peers connected via the Node.js P2P network cannot validate blockchain blocks, and blockchain validator nodes cannot relay user social content.
- **Architectural Remedy:** Clear separation of concerns:
  - **Go P2P Switch:** Dedicated exclusively to validator consensus, block replication, and transaction mempool.
  - **Node.js / Mobile P2P:** Dedicated to media chunk distribution (BitSwap), social graph gossip, and BLE mesh routing.

---

## 9. Migration & Backward Compatibility Strategy

To ensure zero downtime and zero loss of existing test data:
1. **Preserve Embedded SQLite as Edge Engine:** Small-scale local deployments and mobile nodes retain SQLite WAL.
2. **Phase In L1 Daemon via Localhost RPC:** The Node.js application will run a supervisor daemon that launches `sovrad.exe` alongside `dev-server.ts`, establishing a reliable `http://127.0.0.1:26657` bridge before exposing external networks.
3. **Dual-Read Compatibility Window:** Balance queries will read from SQLite during transition, falling back to L1 reconciliation on write operations.
