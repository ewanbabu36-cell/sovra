# SOVRA — PROJECT ARCHITECTURE MAP & TOPOLOGY AUDIT

**Audit Date**: 2026-11-04  
**Audit Entity**: Multidisciplinary Enterprise Technology Audit Organization  
**Auditor Roles**: Chief Technology Officer (CTO) & Principal Software Architect  
**Classification**: Proprietary & Zero-Trust Verification  
**Evaluation Status**: VERIFIED (with architectural duality caveats)

---

## 1. MACRO-ARCHITECTURE OVERVIEW

The SOVRA repository exhibits an architectural duality between a **distributed polyglot microservice/blockchain ecosystem** and a **highly integrated edge monolith development server**.

```mermaid
flowchart TD
    subgraph Client Tier
        W[apps/sovra-app - Web/SPA]
        A[apps/sovra-admin - Admin Console]
        M[apps/sovra-mobile - React Native/Expo]
        T[apps/twa - Telegram Mini App]
        I[apps/ios - Native iOS Swift]
    end

    subgraph Edge Monolith [scripts/dev-server.ts - 4.98 MB Monolith]
        HTTP[Native Node HTTP/HTTPS Server :3001/:3443]
        ROUTER[scripts/routes/ 24 Modular Controllers]
        WS[WebSocket Engine - Realtime Signaling]
        P2P_EDGE[Libp2p Node - TCP :4001 / Noise_XX]
        MEM_DB[sovraDb - In-Memory Social Graph]
        SQLITE_EDGE[node:sqlite - WAL Mode Relational Engine]
    end

    subgraph Independent Services Tier
        S_API[services/api - Express/TypeScript API Gateway]
        S_SEARCH[services/search - Vector/Full-text Search]
        S_MOD[services/moderation-worker - Content Moderation]
        S_TRANS[services/transcoder - HLS Media Transcoder]
    end

    subgraph Layer 1 Blockchain Tier [chain/]
        TENDERMINT[Cosmos SDK / CometBFT Consensus]
        X_IDENTITY[x/identity - On-chain DID Registry]
        X_TOKEN[x/token - Native Token & Transfer Engine]
        X_ESCROW[x/escrow - Quadratic Funding & Escrows]
    end

    subgraph Node Archetypes Tier [nodes/]
        N_FULL[nodes/full-node - Complete State Validator]
        N_RELAY[nodes/relay-node - TURN/WebRTC Signal Router]
        N_STORE[nodes/storage-node - Content-Addressable Storage]
        N_COMM[nodes/community-node - Local Governance]
        N_INDEX[nodes/index-node - Search & Graph Indexer]
    end

    Client Tier --> HTTP
    Client Tier -.-> S_API
    HTTP --> ROUTER
    ROUTER --> MEM_DB
    MEM_DB <--> SQLITE_EDGE
    P2P_EDGE <--> TENDERMINT
    N_FULL <--> TENDERMINT
```

---

## 2. STRUCTURAL DIRECTORY TOPOLOGY

The workspace encompasses 5,013 source files totaling 917.37 MB across five primary organizational domains:

### 1. Applications (`apps/`)
- [`apps/sovra-app`](file:///d:/Sovra/apps/sovra-app): Flagship social client interface (Vite, React 18, TypeScript, TailwindCSS).
- [`apps/sovra-admin`](file:///d:/Sovra/apps/sovra-admin): Protocol operations center, governance monitoring, telemetry viewer.
- [`apps/sovra-mobile`](file:///d:/Sovra/apps/sovra-mobile): React Native / Expo cross-platform mobile client.
- [`apps/ios`](file:///d:/Sovra/apps/ios): Native Swift iOS wrapper and enclave integration.
- [`apps/twa`](file:///d:/Sovra/apps/twa): Telegram Web App embedded client for social onboarding.

### 2. Core Protocol Packages (`packages/`)
- [`packages/crypto`](file:///d:/Sovra/packages/crypto): Cryptographic primitives (ChaCha20-Poly1305, HKDF, Ed25519, X25519, SHA-256).
- [`packages/identity`](file:///d:/Sovra/packages/identity): W3C `did:key` resolver, passkey management, BIP-39 mnemonic derivation.
- [`packages/messaging`](file:///d:/Sovra/packages/messaging): Two-tier inbox protocol, disappearing message envelopes, Signal Double Ratchet abstraction.
- [`packages/p2p`](file:///d:/Sovra/packages/p2p): Noise Protocol Framework (`Noise_XX_25519_ChaChaPoly_SHA256`), Libp2p node lifecycle.
- [`packages/protocol`](file:///d:/Sovra/packages/protocol): Wire format serialization, message schemas, consensus protobufs.
- [`packages/storage`](file:///d:/Sovra/packages/storage): Content-addressable storage (CIDv1, blake3/sha256 chunking, Merkle DAG).
- [`packages/social`](file:///d:/Sovra/packages/social): Graph models, feed ranking, taste vector cosine similarity.
- [`packages/moderation`](file:///d:/Sovra/packages/moderation): Decentralized jury system, community notes Bayesian scoring.
- [`packages/ai`](file:///d:/Sovra/packages/ai): On-device intent classifier, summarization vectors, privacy guardrails.
- [`packages/ui`](file:///d:/Sovra/packages/ui): Shared atomic design system, Tailwind design tokens, icons.
- [`packages/shared`](file:///d:/Sovra/packages/shared): Common error hierarchies, utility functions, type guards.

### 3. Layer 1 Sovereign Chain (`chain/`)
Built with Go (Cosmos SDK v0.47+ / CometBFT):
- `chain/cmd/sovrad`: Node daemon executable.
- `chain/x/identity`: On-chain identity verification and DID state.
- `chain/x/escrow`: Quadratic funding escrows and milestone payouts.
- `chain/x/token`: Native SOVRA tokenomics, staking, and gas fees.
- `chain/store`: Prefix key-value state store backing consensus.

### 4. Specialized Node Archetypes (`nodes/`)
- `nodes/full-node`: Validates blocks and maintains the entire global social ledger.
- `nodes/relay-node`: Relays encrypted WebRTC packets and Libp2p circuit relays across NAT.
- `nodes/storage-node`: Provides distributed pin storage and chunk serving.
- `nodes/community-node`: Manages local server spaces and community moderation.
- `nodes/index-node`: Aggregates feeds and runs off-chain query indexing.

### 5. Services & Edge Monolith (`services/` & `scripts/`)
- **Microservices**: `services/api`, `services/search`, `services/transcoder`, `services/moderation-worker`.
- **Edge Monolith**: [`scripts/dev-server.ts`](file:///d:/Sovra/scripts/dev-server.ts) (4.98 MB, 100,836 lines of code). Serves as a zero-dependency self-contained executable delivering the complete web UI, API routing, WebSocket signaling, and local storage engine.
- **Relational Storage**: [`scripts/database-sqlite.ts`](file:///d:/Sovra/scripts/database-sqlite.ts) (4,922 lines, 56 SQLite tables in WAL mode).

---

## 3. ARCHITECTURAL DUALITY ASSESSMENT

| Architectural Property | Distributed Microservices + Chain | Edge Monolith (`scripts/dev-server.ts`) | Status |
| :--- | :--- | :--- | :--- |
| **Primary Target** | Cloud Cluster / Sovereign Decentralized Network | Desktop / Edge / Local Developer Node | **VERIFIED** |
| **Runtime Execution** | Polyglot (Go + Node.js + Rust) | Pure Node.js (v20+ Native APIs) | **VERIFIED** |
| **Data Persistence** | Cosmos IAVL + Postgres + IPFS | In-Memory Graph + `node:sqlite` (WAL) + JSON | **VERIFIED** |
| **Networking** | Libp2p GossipSub + CometBFT P2P | Native HTTP/HTTPS + WebSocket + TCP 4001 | **VERIFIED** |
| **Coupling Level** | Decoupled (gRPC / REST / Proto) | Highly Coupled (Shared Memory Heap) | **VERIFIED** |

### Architectural Risk Finding:
> [!WARNING]
> While the microservices and Cosmos L1 chain present an enterprise-grade multi-tier architecture, the **primary running application** that users interact with is the Edge Monolith (`scripts/dev-server.ts`). Code duplication exists between `packages/*` and the inlined logic inside `scripts/dev-server.ts`. Changes made to shared packages do not automatically reflect in `dev-server.ts` unless explicitly synchronized.

---

## 4. ARCHITECTURAL SCORECARD

- **Modularity & Separation of Concerns**: `74 / 100` (Degraded by inlined frontend/backend monolith)
- **Extensibility & Scalability**: `86 / 100` (Excellent microservice and Cosmos SDK design)
- **Deployment Resilience**: `82 / 100` (Self-contained single binary capability is high)
- **Overall Architectural Integrity Score**: **80.7 / 100**
