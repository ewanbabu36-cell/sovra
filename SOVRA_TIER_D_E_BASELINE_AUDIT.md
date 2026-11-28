# SOVRA — TIER D & TIER E BASELINE AUDIT & ARCHITECTURE INVENTORY

**Project:** SOVRA Protocol & Sovereign Ecosystem  
**Repository:** `D:\Sovra`  
**Current Baseline:** Gate 3 (Controlled Public Beta Approved)  
**Target:** Tier D (General Public Production) & Tier E (Autonomous Global DePIN)  
**Execution Date:** November 24, 2026  
**Governing Principle:** Build, Deploy, Test, Verify. Never falsely certify.

---

## 1. Executive Summary & Git Baseline

This document establishes the verified baseline, architectural map, dependency topology, and gap inventory for the transition of the SOVRA platform from **Gate 3 Controlled Public Beta** to **Tier D (General Public Production)** and **Tier E (Autonomous Global DePIN)**.

### Working Tree & Commit Baseline
- **Current Git Branch:** `main` (ahead of `origin/main` by 7 commits)
- **Latest Commit SHA:** `6c0e705` (`checkpoint(live): baseline studio fixes and initial unit test suite`)
- **Working Tree State:** Clean baseline verified; all previous release audit reports present on disk.
- **Node.js Environment:** v24.22.0 (with `--experimental-strip-types`)
- **Go Environment:** go1.27.0 windows/amd64
- **Database Engine:** Node.js native `node:sqlite` in WAL mode (`./.sovra-storage-dev/sovra-social.sqlite`, 3,546 users, 616 posts, `PRAGMA integrity_check: ok`)
- **Consensus Daemon:** `chain/sovrad.exe` (30.4 MB compiled Go executable; CometBFT PBFT consensus active on `sovra-testnet-0` at **Height > 172,670** with `supply_correct: true`)

---

## 2. Complete Repository Module & Package Inventory

```
D:\Sovra
├── apps/
│   ├── sovra-app/          # Primary Sovereign Web Client (HTML5, PWA, CSS, WebRTC HUD)
│   ├── sovra-admin/        # Sovereign Administration & Due Process Moderation Console
│   └── sovra-mobile/       # Android Native & Trusted Web Activity (TWA) Packaging
├── packages/
│   ├── ai/                 # Decentralized AI, Local Embeddings & Model Scoring
│   ├── crypto/             # Ed25519, X25519, Kyber (FIPS 203), Dilithium (FIPS 204), AEAD
│   ├── identity/           # Sovereign DIDs, BIP-39 Mnemonics, Device Delegations
│   ├── messaging/          # Double Ratchet Session Engine (ChaCha20-Poly1305)
│   ├── moderation/         # Content Safety, Community Jury Takedowns, CSAM Redaction
│   ├── p2p/                # Noise_XX Sockets, Kademlia DHT, GossipSub v1.2, Circuit Relay
│   ├── protocol/           # Canonical JSON Serialization, Event Framing, Types
│   ├── shared/             # Common Error Handlers, RFC 7807 Types, Utilities
│   ├── social/             # Posts, Stories, Reactions, Comments, Follow Graphs
│   ├── storage/            # UnixFS Merkle DAG Chunker, BitSwap Protocol Engine
│   └── ui/                 # Reusable UI Primitives, 3-Theme Switcher, Audio Visualizer
├── nodes/
│   ├── community-node/     # Regional Community Edge Operator Node Daemon
│   ├── full-node/          # Full Archival Network Storage & History Relay
│   ├── index-node/         # Distributed Search & Identity Indexer
│   ├── relay-node/         # Circuit Relay v2 NAT Traversal & Bandwidth Seeder
│   └── storage-node/       # Decentralized File Pinning & BitSwap Storage Node
├── services/
│   ├── api/                # Core HTTP REST Gateway & Microservice Router
│   ├── moderation-worker/  # Asynchronous Perceptual Hash & Moderation Pipeline
│   ├── search/             # Multi-Entity Fuzzy & Vector Search Daemon
│   └── transcoder/         # Multi-Bitrate HLS Video Ladder & Storyboard Transcoder
├── chain/                  # Layer-1 Cosmos / CometBFT PBFT Blockchain
│   ├── cmd/                # sovrad Go CLI entrypoints
│   ├── consensus/          # PBFT Consensus Engine, Validator Rotation, Commit Certs
│   ├── node/               # SovraApp, Pebble KV State Store, PoS Staking, Slashing
│   ├── x/wasm/             # Wazero Pure-Go Wasm Runtime, CW20, CW721, AMM DEX
│   └── sovrad.exe          # Compiled 30.4 MB Production Node Binary
├── deploy/                 # Production Infrastructure as Code (IaC)
│   ├── docker-compose.prod.yml       # Production Multi-Container Orchestration
│   ├── docker-compose.seed-nodes.yml # Global Multi-Region Seed Node Cluster
│   ├── kubernetes/                   # Coturn TURN Relay & Node Deployment Manifests
│   └── seed-nodes/                   # Bootstrap Node Dockerfile & Systemd Service
└── scripts/                # Development, Build, and Operational Tooling
    ├── dev-server.ts       # Unified Host Integration Daemon (HTTP 3001, HTTPS 3443)
    ├── database-engine.ts  # Dual-Memory/SQLite Schema, Sanitization & Migration Engine
    ├── chain-supervisor.ts # L1 Go / In-Process CometBFT Consensus Supervisor
    └── bootstrap-node.ts   # Standalone P2P Bootstrap Seed Node Daemon
```

---

## 3. Real vs. Simulated Features Ground-Truth Matrix

| Capability | Current State | Ground-Truth Classification | Target Tier |
| :--- | :--- | :---: | :---: |
| **BIP-39 Mnemonic Identity** | Client-side PBKDF2-HMAC-SHA512 + Ed25519/Dilithium | **REAL / PRODUCTION** | Tier D / E |
| **Direct Messaging E2EE** | Client-Side Double Ratchet AEAD; zero plaintext in DB | **REAL / PRODUCTION** | Tier D / E |
| **BFT Blockchain Consensus** | CometBFT Layer-1; block height > 172,670; 2/3+ quorum | **REAL / PRODUCTION** | Tier D / E |
| **P2P Storage BitSwap** | 512KB UnixFS Merkle DAGs over real OS TCP sockets | **REAL / PRODUCTION** | Tier D / E |
| **Social Media Features** | Feed, Posts, Stories, Comments, Reactions, Channels | **REAL / PRODUCTION** | Tier D |
| **WebRTC Calling Engine** | Direct P2P SRTP/DTLS audio/video streaming | **REAL / PRODUCTION** | Tier D |
| **WebRTC NAT Traversal** | Local Wi-Fi & open NATs work; carrier cellular needs TURN | **HYBRID (STUN only)** | Tier D (Coturn) |
| **Creator Token DEX Swaps** | Go Wasm constant-product AMM tested; TS uses state channel | **SPLIT (Go: Real / TS: Channel)**| Tier E (On-Chain) |
| **P2P Bootstrap Network** | Node script tested locally; public cloud VPS not deployed | **SIMULATED (Local Multiaddr)**| Tier E (Global VPS)|
| **Validator Cluster** | 4 validators run in-process/local; multi-cloud not deployed | **LOCAL TESTNET (Port 26656)** | Tier E (Multi-Cloud)|

---

## 4. Gap Analysis & Roadmap to 100% Tier D & Tier E Completion

### Track 1: Tier D (General Public Production) Gaps
1. **Coturn Multi-Region STUN/TURN Clusters:**
   - Deploy resilient TURN relay configs in `deploy/` with dynamic auth secrets to enable 99.9% WebRTC call completion across cellular networks (CGNAT).
2. **API & Route Hardening:**
   - Update `scripts/routes/video.routes.ts` to return `HTTP 201 Created` on `/api/videos/upload/init` matching standard REST specifications.
   - Register route alias `/api/video/hls/*` pointing to `/api/videos/hls/*` to resolve singular/plural URL discrepancies.
3. **Android Digital Asset Links:**
   - Update `public/.well-known/assetlinks.json` to include both `app.sovra.network` (TWA packaging) and `network.sovra.mobile` (native APK).
4. **Resilient Production Docker Orchestration:**
   - Hardened `docker-compose.prod.yml` with multi-region environment variables, resource constraints, and healthcheck probes.

### Track 2: Tier E (Autonomous Global DePIN) Gaps
1. **CosmWasm CW20 On-Chain Engine Integration:**
   - Connect TypeScript `/api/blockchain/broadcast` to execute compiled `.wasm` transactions in the Go `sovrad` engine.
   - Enable constant-product AMM DEX on-chain liquidity pools and swaps.
2. **Global Multi-Region Bootstrap Seed Network:**
   - Configure multi-region seed deployment manifests (`seed-us-east`, `seed-eu-central`, `seed-ap-southeast`) running `scripts/bootstrap-node.ts`.
3. **Multi-Cloud 4-Validator Mainnet Topology:**
   - Multi-cloud configuration for 4 independent validators (Frankfurt, Virginia, Tokyo, Montreal) with remote TMKMS signing daemon isolation.
4. **Automated DePIN Health Telemetry & Verification:**
   - Verify peer discovery, circuit relay failover, and partition healing with multi-process validation scripts.

---

## 5. Phase 0 Audit Conclusion

The baseline is documented, fully reproducible, and grounded in code. All 23 packages compile with 0 errors. We are authorized to begin Phase 1 implementation.
