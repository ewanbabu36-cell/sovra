# SOVRA — COMPLETE ARCHITECTURE & SYSTEMS REPORT

**Workspace:** `D:\Sovra`  
**Architecture Classification:** Sovereign Layer-1 Blockchain + Decentralized P2P Media Super-App  
**Publication Date:** November 24, 2026  
**Auditor:** Principal Cryptography & Distributed Systems Architect  

---

## 1. SYSTEM TOPOLOGY & MONOREPO COMPONENT MAP

Sovra is structured as a pnpm-managed monorepo with 5 user-facing applications, 11 foundation libraries, 4 microservices, 5 specialized node types, and a centralized sovereign dev-server orchestrator.

```
                              ┌───────────────────────────────────────────────┐
                              │            SOVRA CLIENT APPLICATIONS         │
                              ├──────────────┬───────────────┬────────────────┤
                              │  sovra-app   │  sovra-mobile │  sovra-admin   │
                              │ (Next.js/TS) │ (Capacitor/TS)│  (Ops Console) │
                              └──────┬───────┴───────┬───────┴────────┬───────┘
                                     │               │                │
┌────────────────────────────────────┼───────────────┼────────────────┼────────────────────────────────────┐
│ SOVRA CORE RUNTIME (scripts/dev-server.ts + scripts/routes/*.ts)                                         │
│ ┌────────────────────────┬─────────────────────────┬─────────────────────────┬─────────────────────────┐ │
│ │ Auth & Identity Routes │ Live Streaming & Tipping│ Video & Media Transcode │ P2P WebRTC / ICE Routes │ │
│ │ (auth.routes.ts)       │ (live.routes.ts)        │ (studio.routes.ts)      │ (webrtc.routes.ts)      │ │
│ ├────────────────────────┼─────────────────────────┼─────────────────────────┼─────────────────────────┤ │
│ │ Monetary & Bridging    │ ZK Attestations & Badges│ UnixFS & Storage Daemon │ Moderation & Escrow     │ │
│ │ (enterprise-protocol)  │ (zk.routes.ts)          │ (storage.routes.ts)     │ (admin_features.routes) │ │
│ └────────────────────────┴─────────────────────────┴─────────────────────────┴─────────────────────────┘ │
└────────────────────────────────────┬────────────────────────────────┼────────────────────────────────────┘
                                     │                                │
┌────────────────────────────────────┴────────────────────────────────┴────────────────────────────────────┐
│ MONOREPO PACKAGES (packages/*)                                                                           │
│  • packages/crypto      : NIST FIPS 203 (ML-KEM-768), FIPS 204 (ML-DSA-65), BN254 Groth16, Ed25519, BIP39│
│  • packages/storage     : BitSwap 1.2.0, WebRtcDataChannel Swarm, Memory/Tiered Blockstores, UnixFS DAG │
│  • packages/identity    : W3C DIDs (did:sovra:), Ed25519 Auth, RBAC, Guardian Recovery, Passkeys        │
│  • packages/protocol    : SIP-001 Binary Wire Framing (`0x534F5652`), CRDT Projections, GossipSub Mesh │
│  • packages/p2p         : Noise Protocol Framework Handshakes, ICE NAT Traversal (STUN/TURN), BLE Mesh  │
│  • packages/social      : Hybrid Logical Clocks (HLC), Feed CRDTs, Portable Graph Reputation            │
└────────────────────────────────────┬────────────────────────────────┬────────────────────────────────────┘
                                     │                                │
┌────────────────────────────────────┴────────────────────────────────┴────────────────────────────────────┐
│ PERSISTENCE & CONSENSUS LAYERS                                                                           │
│  1. Document Store      : .sovra-storage-dev/dynamic-social-state.json (In-memory + atomic disk flush)   │
│  2. Relational Database : .sovra-storage-dev/sovra-social.sqlite (Native node:sqlite WAL mode)           │
│  3. L1 Consensus Engine : CometBFT 4-Node Validator Cluster (sovrad.exe: ports 26657, 26667, 26677...)  │
│  4. Sound Money Ledger  : 100M Cap, 50% Gas Burn, 20% Ad Burn -> Consensus Dead Sink                      │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. MODULAR ROUTE ARCHITECTURE (scripts/routes/)

The backend HTTP server is decoupled into 34 single-responsibility route controllers:

1. `admin-console.routes.ts`: Enterprise operations dashboard and monitoring endpoints.
2. `admin_features.routes.ts`: Moderator actions, user restrictions, and community governance.
3. `ai.routes.ts`: Local edge AI copilot inference and summarization.
4. `auth.routes.ts`: Ed25519 challenge-response authentication, session cookie issuance (`SOVRA_SESSION_ID`).
5. `call.routes.ts`: WebRTC 1-to-1 audio/video call signaling and peer discovery.
6. `community-notes.routes.ts`: Decentralized Birdwatch-style collaborative fact-checking.
7. `creator-referrals.routes.ts`: On-chain referral rewards tracking.
8. `depin-hotspot.routes.ts`: DePIN Wi-Fi / BLE bandwidth proof-of-coverage ledger.
9. `enterprise-protocol.routes.ts`: PQC sign/verify, ZK humanity verification, Lightning BOLT-11, and Base L2 bridging.
10. `explorer.routes.ts`: CometBFT block and transaction indexer endpoints.
11. `governance.routes.ts`: Quadratic voting on-chain proposals.
12. `live.routes.ts`: WebRTC broadcast mesh, WHEP ingest, live chat, and 95/5 stream tipping.
13. `notifications.routes.ts`: P2P push notifications and unread badges.
14. `operator.routes.ts`: Infrastructure and delegate health monitoring.
15. `spaces.routes.ts`: Multi-speaker audio rooms with PQC encrypted audio channels.
16. `storage.routes.ts`: UnixFS DAG publishing, pin registry, and garbage collection.
17. `studio.routes.ts`: Creator video upload, WebCodecs hardware transcode, and analytics.
18. `trading.routes.ts`: Non-custodial creator token orderbook and AMM.
19. `webrtc.routes.ts`: ICE relay servers discovery and dynamic BitSwap swarm status.
20. `zk.routes.ts`: Groth16 selective disclosure, humanity badges, and range proofs.
... [Additional 14 specialized routes: friends, search, tipping, moderation, feeds, etc.]

---

## 3. P2P STREAMING ARCHITECTURE

Sovra combines WebRTC data channels with BitSwap 1.2.0:
- **Block Size:** Standardized 256 KiB chunks.
- **Wire Framing:** SIP-001 Binary Protocol Header:
  - Magic: `0x534F5652` ('SOVR')
  - Version: `0x01`
  - Message Type: `0x0040` (Want), `0x0041` (Block), `0x0042` (Choke), `0x0043` (Unchoke).
  - Ed25519 64-byte signature appended to every frame.
- **Tit-for-Tat Choking:** BitTorrent-style economic game theory implemented in `WebRtcDataChannelBitSwapAdapter`, rewarding high-bandwidth peers and optimistically unchoking new peers every 3 rounds.
- **Fallback Architecture:** When WebRTC peer swarms are sparse (< 2 seeders), HLS client seamlessly switches to HTTP edge chunk streaming without playback interruption.

---

## 4. DUAL-ENGINE PERSISTENCE ARCHITECTURE

1. **In-Memory Document Store (`scripts/database-engine.ts`):**
   - High-performance, zero-latency in-memory state for rapid WebRTC signaling, live chat, and real-time feeds.
   - Synchronized to disk atomically (`dynamic-social-state.json`) with automated rolling `.bak` snapshot recovery.
2. **Native SQLite Engine (`scripts/database-sqlite.ts`):**
   - Implements relational foreign keys, WAL (Write-Ahead Logging) mode, and transaction ACID guarantees.
   - Houses the financial ledger, token balances, CometBFT transaction receipts, and audit logs.
