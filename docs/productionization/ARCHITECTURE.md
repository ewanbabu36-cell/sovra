# Sovra — System Architecture Specification

## 1. System Topology & Physical Deployment

Sovra is an identity-first, transport-agnostic, sovereign decentralized social network platform. It operates as autonomous peer nodes communicating directly over local area networks (LAN), the open Internet, or offline mesh topologies.

```
       [ Client Web / Mobile UI ]
                   │ (HTTP / JSON / WebSocket)
                   ▼
       [ Port 3001: Reverse Router & Auth Gateway ]
       ├── Security Layer: Rate Limiting, CORS, Bounded Streams
       ├── Principal Resolver: W3C DIDs & Session Tokens
       └── Centralized Authorization & Privacy Matrix
                   │
       ┌───────────┴───────────────────────────────┐
       ▼                                           ▼
[ Local Engine Layer ]                   [ P2P Mesh Network ]
├── SovraDatabaseEngine (Atomic Disk)    ├── Libp2p Node (Port 4001)
├── Bitswap & Blockstore (CID v1)        ├── Noise_XX Encryption
├── Transcoding & ABR Pipeline           ├── GossipSub Topics
└── Sovereign Identity Manager           └── Kademlia DHT Discovery
```

---

## 2. Layer Definitions

### A. Presentation & Client Layer
* **Consumer Web (`apps/sovra-app` / `scripts/dev-server.ts`):** Single Page Application rendering feed, reels, articles, stories, direct messages, and channels.
* **Ops Console (`apps/sovra-admin` / `scripts/admin-console.ts`):** Real-time node administration, telemetry, audit logs, and peer topology.
* **Mobile App (`apps/sovra-mobile`):** React Native mobile client for Android and iOS.

### B. Core Application & API Layer
* Bound on OS TCP port `3001`.
* Enforces authenticated principal resolution on all privileged operations.
* Rejects revoked sessions and forged caller DIDs.

### C. Persistent Storage Engine
* Located at `.sovra-storage-dev` (configurable via `SOVRA_STORAGE_DIR`).
* Atomic rename writes with file-locking safety and automatic rolling `.bak` backup recovery.
* 15 distinct relational/document collections with schema version tracking.

### D. P2P Mesh & Content Routing
* Libp2p node bound on TCP port `4001`.
* Noise_XX cryptographic handshake for point-to-point stream confidentiality.
* GossipSub pubsub for distributed social graph updates, signed follow events, and public channel dissemination.
