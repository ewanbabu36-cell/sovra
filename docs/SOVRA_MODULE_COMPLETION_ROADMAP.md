# SOVRA — MODULE COMPLETION ROADMAP

**Document ID:** `SOVRA-AUDIT-DOC-07`  
**Classification:** Technical Work Breakdown by Functional Subsystem  
**Standard:** Minimal-Change, Incremental Engineering Specification  
**Repository Working Directory:** `d:\Sovra`  
**Evaluation Date:** November 5, 2026  

---

## 1. Executive Summary

This roadmap details the concrete engineering tasks required to bring all seven core SOVRA modules from their current state to production-grade completion, meeting all functional, security, and cryptographic acceptance criteria without discarding existing working code.

---

## 2. Module 1: SOVRA Identity Completion Workstream

### Objective: Cryptographically sovereign, non-custodial, recoverable identity

```
[Target: did:key:z6Mku... + WebAuthn PRF Enclave + M-of-N Social Recovery]
```

1. **Task ID-01: Remove Header-Based Impersonation (`AUTH-P0-01`)**
   - *Action:* Remove `X-Sovra-DID` unconditional trust in `scripts/dev-server.ts:89205-89215`.
   - *Target:* Require valid session token or signed RFC 9421 HTTP signature for all requests.
2. **Task ID-02: Eliminate Registration 500 SOV Minting (`FIN-P0-01`)**
   - *Action:* Change default `balance_sov` to `0.0` in `scripts/database-migrations.ts:55` and `scripts/database-engine.ts:3062`.
   - *Target:* Zero tokens minted upon registration; initial balances funded only through verified faucet or transfers.
3. **Task ID-03: Social Recovery API & Persistence (`ID-P1-01`)**
   - *Action:* Create migration `011_social_recovery_plans` (columns: `target_did`, `threshold`, `guardians_json`, `timelock_seconds`, `sequence`).
   - *Target:* Expose `/api/identity/recovery/plan` and `/api/identity/recovery/claim` using `packages/identity/src/recovery.ts`.
4. **Task ID-04: Key Rotation On-Chain Registry (`ID-P2-01`)**
   - *Action:* Wire `packages/identity/src/rotation.ts` to `POST /api/identity/rotate-key`.
   - *Target:* Broadcast dual-signed key rotation assertions to L1 `x/auth` store.

---

## 3. Module 2: SOVRA Social Completion Workstream

### Objective: Censorship-resistant, truthful social graph and feed engine

1. **Task SOC-01: Truthful Trending Algorithmic Pipeline (`SOC-P2-01`)**
   - *Action:* Remove `count * 150 + 120` artificial multipliers and synthetic `#sovra` baseline in `scripts/routes/feed.routes.ts:45-65`.
   - *Target:* Report actual measured hashtag velocity with sliding 24-hour decay window.
2. **Task SOC-02: Remove Persona Fallback Leakage (`SOC-P2-02`)**
   - *Action:* Eliminate hardcoded `did:sovra:user_rahul_sharma_core` fallback in `scripts/routes/feed.routes.ts:75, 90`.
   - *Target:* Return HTTP 401 for unauthenticated subscription feed requests.
3. **Task SOC-03: Mandatory CSAM Quarantine & Reporting Pipe (`MOD-P1-01`)**
   - *Action:* Add automated media perceptual hashing (PDQ/PhotoDNA) to content moderation ingress in `scripts/routes/media.routes.ts`.
   - *Target:* Confirmed CSAM immediately quarantined; unencrypted logs purged; incident dispatched to designated safety officer.
4. **Task SOC-04: Government Censorship Appeals with 66% Quorum (`MOD-P2-01`)**
   - *Action:* Implement formal appeal state machine in `scripts/database-sqlite.ts` requiring 66% juror supermajority to uphold government takedown requests for lawful political content.

---

## 4. Module 3: SOVRA Moments Completion Workstream

### Objective: High-performance, decentralized short-form video & story playback

1. **Task MOM-01: Unified Storage Adapter for BitSwap & Local FS (`MOM-P1-01`)**
   - *Action:* Consolidate `scripts/media-storage-adapter.ts` with `packages/storage/src/reels.ts`.
   - *Target:* Seamless fallback: serve local cached file if available; pull from IPFS BitSwap blockstore if remote.
2. **Task MOM-02: Client-Side Vertical Viewport Memory Optimization (`MOM-P2-01`)**
   - *Action:* Implement virtualized DOM pool in `apps/sovra-app/src/ui/ReelsViewport.ts`.
   - *Target:* Maximum 3 active HTML5 video elements in DOM simultaneously during infinite scroll, eliminating mobile web memory leaks.

---

## 5. Module 4: SOVRA Connect Completion Workstream

### Objective: True zero-trust Signal Double Ratchet E2EE and scalable calling

```
[Target: X3DH + Double Ratchet + Sender Keys Group Encryption + WebRTC SFU]
```

1. **Task CON-01: Eliminate Deterministic Seed Derivation (`SEC-P0-01`)**
   - *Action:* Completely remove `window.SovraE2EE` deterministic PBKDF2 seed logic in `scripts/dev-server.ts:34300-34335`.
   - *Target:* Implement client-side Curve25519 identity key generation and ephemeral key exchange.
2. **Task CON-02: Double Ratchet & Prekey Bundle Ingress (`CON-P0-01`)**
   - *Action:* Add SQLite table `user_prekeys` (storing signed identity key, signed prekey, one-time prekeys).
   - *Target:* Clients fetch peer prekeys via `GET /api/chat/prekey`, perform X3DH handshake, and establish a ratcheted session.
3. **Task CON-03: Zero-Cleartext Server Transport Gate (`CON-P0-02`)**
   - *Action:* Remove server-side envelope sealing fallback (`chat.routes.ts:394`).
   - *Target:* Server strictly rejects any message that is not pre-encrypted by sender (`ciphertext_hex` required); server cannot read plaintext.
4. **Task CON-04: Sender Keys Protocol for Group E2EE (`CON-P1-01`)**
   - *Action:* Implement Signal-compatible Sender Keys distribution for Spaces and Groups in `scripts/routes/chat.routes.ts`.
   - *Target:* Group messages encrypted once via symmetric ratchet key; sender keys distributed pairwise via 1:1 Double Ratchet sessions.
5. **Task CON-05: WebRTC Ephemeral Call Signaling Persistence (`CON-P2-01`)**
   - *Action:* Move call signaling state from in-memory Maps (`callAudioChunkStore`, `callSseClients`) to SQLite ephemeral tables with 30s TTL.
   - *Target:* Signaling survives server process restarts; active calls remain connected.

---

## 6. Module 5: SOVRA Video Completion Workstream

### Objective: Resumable, BOLA-protected video ingestion with containerized ABR transcode

1. **Task VID-01: Enforce Author DID on Chunk Uploads (`VID-P1-01`)**
   - *Action:* In `scripts/routes/video.routes.ts:65-120`, enforce `session.author_did === principal.did`.
   - *Target:* Return HTTP 403 Forbidden on any attempt to upload chunks to another creator's upload session.
2. **Task VID-02: Byte-Offset Resumption Math (`VID-P1-02`)**
   - *Action:* Update `PATCH /api/videos/upload/chunk` to accept `Content-Range: bytes START-END/TOTAL`.
   - *Target:* Verify byte offsets strictly; handle out-of-order retries deterministically; prevent chunk overwrite corruption.
3. **Task VID-03: Abandoned Upload TTL Garbage Collector (`VID-P2-01`)**
   - *Action:* Add scheduled cleanup task purging directories in `.sovra-storage-dev/uploads/` whose session `updated_at > 24 hours`.
4. **Task VID-04: Isolate Transcoding into Standalone Worker (`VID-P2-02`)**
   - *Action:* Offload FFmpeg execution from `scripts/video-transcode-pipeline.ts` to `services/transcoder` background daemon.
   - *Target:* Prevent main application server CPU starvation during 1080p ABR transcode.

---

## 7. Module 6: SOVRA Studio Completion Workstream

### Objective: Truthful creator analytics and non-inflationary ad escrow settlement

1. **Task STU-01: Connect Real Telemetry to Studio Dashboard (`STUDIO-P2-01`)**
   - *Action:* Replace hardcoded CTR (`8.4%`) and duration (`4:12`) in `scripts/database-engine.ts:8500-8540` with SQL aggregations over `watch_history`.
   - *Target:* Display truthful, measured viewing benchmarks.
2. **Task STU-02: Non-Inflationary Ad Settlement & Permanent Burn (`FIN-P0-02`)**
   - *Action:* Update `recordFinancialLedgerEntry()` in `scripts/database-engine.ts:16742`:
     - Deduct 100% of payout, fee, and referral bonuses from escrowed `bountyAmountSov`.
     - Zero unbacked minting.
     - Execute permanent coin burn (10% proposal) and debit from global supply.
   - *Target:* Escrow settlement is mathematically balanced and strictly non-inflationary.
3. **Task STU-03: Creator Channel Tier Subscriptions Reconciliation (`STU-P1-01`)**
   - *Action:* Transition monthly tier renewals to SQLite `financial_idempotency_keys` table.
   - *Target:* Prevent double-billing on transient network disconnects.

---

## 8. Module 7: SOVRA Mesh Completion Workstream

### Objective: Resilient offline BLE discovery and store-and-forward mesh routing

1. **Task MSH-01: Native Mobile BLE GATT Bridge Hardening (`MSH-P1-01`)**
   - *Action:* Implement Android foreground service with persistent notification in `apps/sovra-mobile` to maintain BLE GATT mesh advertising during Doze mode.
   - *Target:* Reliable peer discovery in background on Android 12+.
2. **Task MSH-02: DTN Outbox Congestion Control (`MSH-P2-01`)**
   - *Action:* Implement packet TTL decay and storage quota limits (max 50 MB per relay node) in `packages/p2p/src/mesh/outbox-store.ts`.
   - *Target:* Prevent relay node disk exhaustion attacks.
3. **Task MSH-03: Browser UX Transparency for Web Bluetooth (`MSH-P3-01`)**
   - *Action:* Update Web UI to detect absence of BLE Peripheral support and render educational banner informing users that offline mesh routing requires the native mobile app.

---

## 9. Workstream Dependency Graph

```
[ID-01, ID-02] (P0 Security & Cap)
       |
       +---> [CON-01, CON-02, CON-03] (P0 E2EE Double Ratchet)
       |
       +---> [VID-01, VID-02] (P1 Video Resumability)
       |
       +---> [STU-02] (P0 Ad Escrow Non-Inflationary Settlement)
       |
       v
[L1 Blockchain Supervised Integration]
       |
       +---> [x/pou Participation Mining Engine]
       |
       v
[Full Multi-Node Mainnet Genesis]
```
