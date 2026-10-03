# SOVRA 21-Phase Master Implementation Roadmap

## Overview & Execution Strategy

Sovra is built strictly incrementally, adhering to **Section 21 (Phase Completion Rule)**:

> _"A phase is NOT complete merely because the code compiles. Every phase requires: implementation, unit tests, integration tests, failure tests, security review, documentation, migration considerations, performance measurements, and explicit acceptance criteria."_

The roadmap progresses through 21 phases (Phase 0 to Phase 20), starting from the architectural foundation and protocol primitives before constructing high-level user interfaces.

---

## Complete Phase Matrix (Phase 0 to Phase 20)

```
+--------------------------------------------------------------------------------------------------+
| PHASE 0: Architecture Audit & Specifications (CURRENT)                                           |
| Deliverables: Master architecture, roadmap, threat model, content policy documentation.         |
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 1: Monorepo, Toolchain & Testing Infrastructure                                            |
| Deliverables: pnpm workspace, Turborepo, Vitest, TypeScript configs, ESLint/Prettier, CI pipeline|
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 2: Cryptographic Identity Engine (`packages/identity` & `packages/crypto`)                 |
| Deliverables: Ed25519/X25519 keypairs, did:key, canonical JSON signing, multi-device delegation.  |
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 3: Peer-to-Peer Networking Engine (`packages/p2p`)                                         |
| Deliverables: libp2p node, Noise transport, Yamux, Kademlia DHT, GossipSub v1.2, Circuit Relay v2|
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 4: Distributed Content-Addressed Storage (`packages/storage`)                              |
| Deliverables: Helia/IPFS chunking, CID generation, UnixFS DAG, BitSwap, local cache provider.    |
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 5: Decentralized Social Graph Engine (`packages/social` & `packages/protocol`)             |
| Deliverables: Signed follow/unfollow events, mute/block lists, decentralized relationship state. |
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 6: Posts, Chronological Feeds & Profile UI (`apps/sovra-app`)                              |
| Deliverables: Signed post/reply events, local chronological feed engine, profile viewer, UI base.|
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 7: Content Safety, Policy Engine & Admin Moderation (`packages/moderation`, `apps/admin`)   |
| Deliverables: Multi-modal scanner, perceptual hashes, quarantine queue, Admin Panel moderation.  |
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 8: Device-Side Screen-Time & Wellbeing Engine (`apps/sovra-app`)                           |
| Deliverables: Local session monitors, usage budgets, quiet hours, break challenges, no server.  |
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 9: End-to-End Encrypted Messaging (`packages/messaging`)                                   |
| Deliverables: X3DH handshake, Double Ratchet sessions, encrypted blobs, receipts, private chat UI|
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 10: Multi-Resolution Video & Creator Studio (`services/transcoder`, `apps/sovra-app`)      |
| Deliverables: HLS transcoding (360p-1080p), segment chunking, adaptive player, Creator Studio UI.|
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 11: Privacy-Preserving Local Recommendation Engine (`packages/social`)                     |
| Deliverables: Client-side scoring heuristics, user-controlled weights, zero server profiling.    |
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 12: Encrypted Voice & Video Calling (`packages/messaging`)                                 |
| Deliverables: WebRTC 1:1 and mesh calls, DTLS-SRTP, P2P signaling via GossipSub, call UI.        |
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 13: Decentralized Communities & Topic Governance (`packages/social`, `nodes/community`)   |
| Deliverables: Signed community manifests, roles, member directories, topic channels.            |
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 14: Cross-Node Federation & Relay Protocol (`packages/p2p`, `nodes/relay-node`)            |
| Deliverables: Inter-relay synchronization, topic peering, server-to-server gossip filters.       |
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 15: Decentralized Naming & Identity Alias System (`packages/identity`)                     |
| Deliverables: Human-readable handle aliases, cryptographic proof of domain (DNS-over-DID), ENS.  |
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 16: Standalone Node Ecosystem Deployment (`nodes/*`)                                       |
| Deliverables: Docker packaging, full node CLI, relay node daemon, storage provider daemon.       |
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 17: Distributed Search & Query Indexing (`services/search`, `nodes/index-node`)           |
| Deliverables: Inverted indexer over verified events, full-text search, client-side signature check|
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 18: Decentralized Live Streaming (`services/transcoder`, `apps/sovra-app`)                 |
| Deliverables: WebRTC-to-HLS live ingest, peer-assisted chunk distribution, live chat over PubSub.|
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 19: Security Fuzzing, Chaos Engineering & Adversarial Testing                              |
| Deliverables: Sybil attack test, network partition test, malicious relay injection, stress tests.|
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| PHASE 20: Production Release, Hardening & Multi-Platform Distribution                            |
| Deliverables: Production binaries, security audit clearance, zero-dependency release bundle.     |
+--------------------------------------------------------------------------------------------------+
```

---

## Detailed Specifications for Each Phase

### Phase 0: Architecture and Specifications (CURRENT PHASE)

- **Goal:** Conduct repository audit, define system models, establish threat models, and author content safety policies.
- **Deliverables:**
  - `docs/architecture/MASTER-ARCHITECTURE.md`
  - `docs/architecture/PHASE-ROADMAP.md`
  - `docs/security/THREAT-MODEL.md`
  - `docs/moderation/CONTENT-POLICY.md`
- **Acceptance Criteria:**
  - Complete architectural consistency across all documents.
  - Zero code committed without approved protocol definitions.
  - Verification that admin panel is non-critical for network survival.

### Phase 1: Monorepo + CI/CD + Testing Infrastructure

- **Goal:** Establish a modular monorepo toolchain supporting packages, applications, nodes, and background services.
- **Components:**
  - `pnpm` workspaces + Turborepo orchestration.
  - Strict TypeScript 5.x configuration (`tsconfig.base.json`).
  - Vitest test runner with workspace configuration.
  - Shared ESLint and Prettier configurations.
  - GitHub Actions / local CI verification scripts.
- **Acceptance Criteria:**
  - `pnpm install` succeeds cleanly.
  - `pnpm build` builds all package stubs in proper topological order.
  - `pnpm test` executes unified test runner across all packages with 100% pass rate.
  - Type-checking (`tsc --noEmit`) passes with zero errors under strict mode.

### Phase 2: Decentralized Identity (`packages/crypto` & `packages/identity`)

- **Goal:** Build cryptographic identity primitives, DID documents, and signature suites.
- **Components:**
  - Audited primitives using `@noble/curves` (Ed25519) and `@noble/hashes` (BLAKE3, SHA-256).
  - Keypair generation, seed derivation (BIP-39 mnemonic fallback).
  - W3C DID representation (`did:key`).
  - Signed event generation and signature verification with canonical JSON serialization (RFC 8785).
  - Multi-device linking through signed delegation assertions.
  - Secure local keystore interface (WebCrypto / platform keychain).
- **Acceptance Criteria:**
  - Unit tests verify deterministic signature generation and validation.
  - Invalid or tampered payloads fail signature validation 100% of the time.
  - Device delegation tokens can be verified and revoked cryptographically.
  - Benchmarks prove >5,000 signature verifications/sec per core.

### Phase 3: P2P Networking (`packages/p2p`)

- **Goal:** Instantiate libp2p stack with discovery, secure transports, and pubsub message broadcasting.
- **Components:**
  - libp2p node lifecycle management.
  - Transports: WebSockets, TCP, WebRTC Direct.
  - Handshake: Noise protocol (`Noise_XX_25519_ChaChaPoly_BLAKE2s`).
  - Multiplexing: Yamux.
  - Peer Discovery: Kademlia DHT, mDNS.
  - Message Broadcast: GossipSub v1.2 with topic subscriptions and peer scoring.
  - NAT Traversal: STUN, AutoNAT, Circuit Relay v2 client/server.
- **Acceptance Criteria:**
  - 3+ headless node instances discover each other in automated tests without central coordinator.
  - Firewalled node communicates via Circuit Relay v2 fallback.
  - Message published on topic `/sovra/test` reaches all subscribed peers within 500ms.
  - Node disconnect and reconnect recovers peer mesh without manual intervention.

### Phase 4: Distributed Storage (`packages/storage`)

- **Goal:** Implement content-addressed storage for images, video segments, and public assets.
- **Components:**
  - Helia IPFS node integration.
  - UnixFS chunking (256KB block size).
  - Deterministic CIDv1 generation (multihash BLAKE3 / SHA-256).
  - BitSwap data transfer protocol.
  - Local blockstore cache with LRU eviction.
- **Acceptance Criteria:**
  - Media file chunked into DAG matches deterministic CID across different nodes.
  - Peer B retrieves file blocks from Peer A via BitSwap over direct libp2p connection.
  - Storage node pins content and serves it to newly joined nodes.

### Phase 5: Social Graph (`packages/social` & `packages/protocol`)

- **Goal:** Decentralize relationships (following, followers, blocks, mutes) via signed cryptographic events.
- **Components:**
  - Event schemas for `Follow`, `Unfollow`, `Block`, `Mute`.
  - Relationship state store (SQLite / IndexedDB) derived by replaying signed events.
  - Conflict resolution: highest timestamp + cryptographic signature wins.
- **Acceptance Criteria:**
  - A user's follower graph can be rebuilt deterministically from raw signed events.
  - Blocked peer's events are dropped at the local engine level before entering UI state.
  - Offline follow events synchronize and reconcile correctly upon reconnection.

### Phase 6: Posts, Feeds & Profile UI (`apps/sovra-app`)

- **Goal:** Provide primary microblogging feed, user profiles, and post creation UI.
- **Components:**
  - Feed UI: Chronological feed, post composer, reply threads, media attachment viewer.
  - Profile UI: Avatar, bio, signed event history, follower/following count.
  - Local feed engine: Pulls events from subscribed GossipSub topics and local cache.
- **Acceptance Criteria:**
  - Publishing a post broadcasts signed event to peer mesh.
  - Followed user's posts appear in chronological order in subscriber's feed.
  - Client functions fully offline, displaying cached feed and queueing outbound posts.

### Phase 7: Content Safety, Policy Engine & Admin Moderation (`packages/moderation`, `apps/sovra-admin`)

- **Goal:** Enforce strict policy against sexually explicit/suggestive material while preserving identity discussions.
- **Components:**
  - Multi-stage pipeline: Visual classification, video frame extraction, text/OCR checks.
  - Perceptual hashing (PDQ / perceptual hash index) for instant matching.
  - Admin Panel moderation dashboard with quarantine queue, review tools, audit logs.
  - User appeals submission and review workflow.
- **Acceptance Criteria:**
  - Known sexually explicit test assets are quarantined with 100% precision.
  - Neutral discussions of sexual orientation/identity are correctly classified as ALLOW.
  - Actions taken in the Admin Panel produce tamper-evident cryptographic audit logs.
  - Complete shutdown of Admin Panel does NOT impair consumer app feed rendering.

### Phase 8: Screen-Time Controls & Digital Wellbeing (`apps/sovra-app`)

- **Goal:** Device-side enforcement of usage budgets, quiet hours, and autoplay management.
- **Components:**
  - High-precision local usage tracker for feeds, short-form clips, and explore.
  - Warning banners and lockout modal screens.
  - Configurable daily limit profiles and break challenges.
  - Tamper-proofing against local system clock manipulation.
- **Acceptance Criteria:**
  - Exceeding configured daily budget blocks feed interaction without contacting any server.
  - Reset occurs at local midnight or configurable schedule.
  - Autoplay control persists across app restarts.

### Phase 9: End-to-End Encrypted Messaging (`packages/messaging`)

- **Goal:** Private 1:1 and group communication with forward secrecy.
- **Components:**
  - X3DH prekey bundle generation and exchange.
  - Double Ratchet algorithm implementation (symmetric-key & DH ratchets).
  - Out-of-band attachment encryption ($K_{media}$) and encrypted transport.
  - Delivery and read status receipts.
- **Acceptance Criteria:**
  - Two peers exchange encrypted messages with zero plaintext exposure to intermediate relays.
  - Past messages remain undecryptable even if current session key is compromised (Forward Secrecy).
  - Encrypted media attachments are decrypted only by recipient holding the symmetric key.

### Phase 10: Multi-Resolution Video & Creator Studio (`services/transcoder`, `apps/sovra-app`)

- **Goal:** Support short-form and long-form video with adaptive streaming and creator tools.
- **Components:**
  - FFmpeg transcoding service generating 360p, 480p, 720p, 1080p HLS segments (`.ts` and `.m3u8`).
  - HLS video player with adaptive bitrate switching.
  - Integrated Creator Studio: Upload manager, segment preview, scheduled publish queue.
- **Acceptance Criteria:**
  - Uploaded 1080p test video is transcoded into multi-bitrate HLS segments with valid CIDs.
  - Client smoothly streams video from IPFS storage nodes with adaptive resolution shifting.
  - Creator Studio runs inside the main application without requiring a separate login.

### Phases 11 to 20 Overview

- **Phase 11 (Recommendation):** Client-side privacy-first algorithmic sorting based on local preference weights.
- **Phase 12 (Voice/Video Calls):** WebRTC peer-to-peer audio and video with DTLS-SRTP encryption.
- **Phase 13 (Communities):** Topic-based sub-networks with community node governance and member badges.
- **Phase 14 (Federation):** Relay-to-relay federation protocols for scaling cross-cluster topic sync.
- **Phase 15 (Decentralized Naming):** DNS-over-DID and cryptographic username claim verification.
- **Phase 16 (Node Ecosystem):** Standalone full-node, relay-node, and storage-node daemons with CLI management.
- **Phase 17 (Distributed Search):** Node-level verified search indexes without central data monopolies.
- **Phase 18 (Live Streaming):** Low-latency WebRTC broadcast distribution with peer-assisted relaying.
- **Phase 19 (Chaos & Security Fuzzing):** Sybil resistance, network partitions, Eclipse attacks, and DDoS stress tests.
- **Phase 20 (Production Release):** Multi-platform packaging, production audits, final release sign-off.

---

## Immediate Next Step: Phase 1 Action Plan

To execute Phase 1 successfully, the following concrete steps are defined:

1. Initialize Git repository and root `.gitignore`.
2. Configure `pnpm-workspace.yaml` and root `package.json` for monorepo workspaces.
3. Configure `turbo.json` for build, lint, and test caching pipelines.
4. Establish shared configuration packages (`tsconfig.base.json`, linting).
5. Scaffold skeleton directory structure:
   - `apps/sovra-app`, `apps/sovra-admin`
   - `packages/crypto`, `packages/identity`, `packages/protocol`, `packages/p2p`, `packages/storage`, `packages/messaging`, `packages/social`, `packages/moderation`, `packages/shared`, `packages/ui`
   - `nodes/full-node`, `nodes/relay-node`, `nodes/storage-node`
   - `services/transcoder`
6. Set up Vitest workspace runner and author baseline validation tests across all workspaces.
7. Verify clean build and test execution across the entire repository.
