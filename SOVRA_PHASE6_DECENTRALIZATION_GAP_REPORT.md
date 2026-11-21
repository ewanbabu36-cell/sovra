# SOVRA PHASE 6: DECENTRALIZATION GAP AUDIT REPORT
## Central Server Dependencies, Single-Point-of-Failure Analysis & Roadmap to True Sovereign Distribution

**Date:** November 21, 2026  
**Auditor:** Independent Principal Distributed Systems Architect & Cybersecurity Auditor  
**Subject:** Full Audit of Centralization Vectors across SOVRA Web, Mobile, Storage, and Consensus Subsystems  
**Canonical Spec:** `SOVRA_INDUSTRY_STANDARD_MASTER_GOAL_AND_ACCEPTANCE.md` (Gate 4 & Release Blocker Register)  
**Status:** **CRITICAL DECENTRALIZATION GAPS CATALOGED**

---

## 1. Executive Summary

A critical standard of this independent audit is:  
**"Do not label a capability decentralized merely because a P2P library exists in the repository."**

While SOVRA possesses sophisticated decentralized building blocks (`@sovra/p2p`, `@sovra/storage`, `sovrad.exe`, BitSwap, and Noise_XX transports), the **day-to-day runtime experience of the Web client and mobile app remains architecturally tethered to a central monolithic server process** (`scripts/dev-server.ts`).

This report forensically catalogs every remaining central dependency, assesses its failure impact, and defines the exact architectural interventions required before SOVRA 1.0 can claim true operational decentralization.

---

## 2. Centralization Vector Analysis

### Gap 1: Monolithic Gateway Single Point of Failure (SPOF)
- **Component:** `scripts/dev-server.ts` (listening on HTTP 3001 / HTTPS 3443).
- **Reality:** All consumer UI traffic (feed generation, reels catalog, profile lookups, tipping endpoints, video upload orchestration, and chat signaling) routes through `dev-server.ts`.
- **Impact if Down:** If the single `dev-server.ts` process terminates or crashes:
  - The Web client cannot be served (HTTP 502 / connection refused).
  - The mobile app's REST endpoints (`fetchFeedPosts`, `fetchWatchVideos`) fail.
  - Video uploads fail.
  - New user registrations fail.
- **Root Cause:** Consumer apps rely on an HTTP gateway rather than connecting directly as full or light P2P nodes to the libp2p / CometBFT mesh.

---

### Gap 2: Single-Host Local Database Dependency
- **Component:** SQLite Database (`scripts/database-sqlite.ts`, `database.sqlite`).
- **Reality:** User accounts, follow graphs, posts, comments, likes, notifications, and group channels are stored in a local SQLite file managed by the server process.
- **Impact if Down:** Data is not federated across multiple independent database nodes. While SQLite WAL provides high-speed local queries, an outage of the database host prevents read and write access to all social data.
- **Target Architecture:** P2P gossip sync of signed user posts using Ceramic, OrbitDB, or decentralized GossipSub events with local client caching.

---

### Gap 3: WebRTC Video/Voice Calling Signaling Centralization
- **Component:** `scripts/dev-server.ts` WebSocket / Polling signaling handlers.
- **Reality:** Establishing a WebRTC 1-on-1 audio/video call currently relies on `dev-server.ts` exchanging SDP offers and ICE candidates between peers.
- **Impact if Down:** If the server is offline, two peers on the same local network cannot negotiate a call unless they fall back to local BitChat BLE mesh or Wi-Fi Direct.
- **Target Architecture:** Serverless WebRTC signaling over decentralized libp2p Kademlia DHT or Nostr ephemeral relays.

---

### Gap 4: Storage Swarm Media Replication vs. Local FlatFS
- **Component:** `scripts/storage-daemon.ts` (`.sovra-storage-dev`).
- **Reality:** The storage daemon stores UnixFS video chunks in a local filesystem directory. While `@sovra/storage` implements BitSwap and can exchange blocks between two running daemons, there is **no automated multi-node cloud pinning cluster** constantly maintaining replication across independent geographic storage providers.
- **Impact if Down:** If the host storing `.sovra-storage-dev` loses disk data or shuts down, media blocks referenced by CIDs become unretrievable by other peers.

---

### Gap 5: Validator Single-Operator Colocation
- **Component:** `chain/mytestnet/` (`node0` through `node3`).
- **Reality:** The four CometBFT validator nodes currently run on a single physical host (`d:\Sovra` on Windows) on loopback ports (26656-26686).
- **Impact if Down:** A host reboot, local OS crash, or power failure halts 100% of the validator set simultaneously, completely eliminating Byzantine fault tolerance.
- **Target Architecture:** Provisioning 4+ distinct cloud/bare-metal servers in geographically disparate regions (e.g. Frankfurt, Virginia, Tokyo, Singapore) operated by independent entities.

---

## 3. Subsystem Independence Classification Matrix

| Capability | Current Operational Model | Decentralization Classification | Primary Central Dependency |
| :--- | :--- | :--- | :--- |
| **Identity & Keys** | W3C `did:key` (Ed25519) generated on client | **100% DECENTRALIZED** | None (client sovereignty) |
| **E2EE Messaging** | Client Double Ratchet (ChaCha20-Poly1305) | **HYBRID RELAY** | Server relays opaque ciphertext |
| **Blockchain Consensus** | 4 CometBFT validators in P2P switch | **FEDERATED PROTOCOL (LOCAL)** | Colocated on single host OS |
| **Wallet Settlements** | Direct L1 RPC `/query/balance` + transfers | **FEDERATED** | Dependent on L1 node uptime |
| **Social Graph & Posts** | REST API reading/writing SQLite | **CENTRALIZED GATEWAY** | `dev-server.ts` + `database.sqlite` |
| **Media Distribution** | BitSwap protocol + local FlatFS blockstore | **HYBRID P2P** | Local storage daemon host |
| **Video Calling** | WebRTC media streams | **HYBRID P2P** | Central WebSocket signaling |
| **Mobile Offline Mesh** | Outbox queue + BLE mesh / Wi-Fi Direct | **LOCAL DECENTRALIZED** | Sync requires server gateway |

---

## 4. Remediation Plan to Unblock Gate 4 for SOVRA 1.0

To advance Gate 4 from **PARTIALLY VERIFIED** to **PRODUCTION PASSED**, the following infrastructure deployments must be enacted:

1. **Deploy Multi-Cloud Validator Fleet:**
   - Deploy 4 independent nodes across 4 distinct cloud providers (e.g., AWS, GCP, Azure, Hetzner).
   - Configure public DNS seed addresses and persistent P2P peers.
2. **Implement Client-Side P2P Failover:**
   - Equip `@sovra/mobile` and web client with a light P2P client capable of querying multiple public CometBFT RPC endpoints directly if `dev-server` is unreachable.
3. **Federate UnixFS Media Pinning:**
   - Establish IPFS Cluster or decentralized Storage Provider nodes that automatically pin uploaded CIDs across at least 3 geographically separated storage nodes.
4. **Decentralize WebRTC Signaling:**
   - Implement libp2p rendezvous and DHT-based peer exchange for call signaling.
