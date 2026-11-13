# SOVRA — CURRENT INFRASTRUCTURE & TOPOLOGY MAP

> **Standard:** Zero-Trust Forensic System Discovery  
> **Repository Commit:** `6306538` | **Date:** 2026-11-05  
> **Status:** Phase 0 Architecture Deliverable  

---

## 1. Monorepo & Subsystem Topology

The SOVRA repository is structured as a pnpm/Turbo workspace spanning core protocol packages, standalone node daemons, microservices, mobile/web client apps, and a native Go Layer-1 blockchain engine.

```mermaid
graph TD
    subgraph Client Applications
        Mobile["apps/sovra-mobile (React Native / Expo)"]
        WebApp["apps/sovra-app (PWA / Web Client)"]
        AdminApp["apps/sovra-admin (Enterprise Operations)"]
        iOS["apps/ios (Capacitor Container)"]
        TWA["apps/twa (Trusted Web Activity)"]
    end

    subgraph Core Protocol & Library Packages
        Crypto["packages/crypto (ML-KEM, Ed25519, Ratchet, ZK)"]
        Identity["packages/identity (W3C DID, WebAuthn Passkeys)"]
        P2P_Pkg["packages/p2p (Noise_XX, Kademlia DHT, GossipSub)"]
        Storage_Pkg["packages/storage (UnixFS DAGs, BitSwap v1.2)"]
        Protocol_Pkg["packages/protocol (CRDTs, SignedOps, HLS)"]
        AI_Pkg["packages/ai (PrivateKnowledgeTwin, FeedRanker)"]
    end

    subgraph Node Daemons & Gateway
        DevServer["scripts/dev-server.ts (Monolithic Gateway :3001)"]
        BootstrapNode["scripts/bootstrap-node.ts (P2P Seed Daemon :4001, :8080)"]
        StorageNode["nodes/storage-node (Continuous Pinning & BitSwap)"]
        CommunityNode["nodes/community-node (Local Community Hub)"]
        RelayNode["nodes/relay-node (Circuit Relay v2)"]
    end

    subgraph Consensus & Persistence
        SqliteDB[("SQLite WAL: sovra-social.sqlite")]
        GoChain["chain/ (CometBFT L1 Consensus :26656, :26657)"]
        PebbleDB[("Pebble LSM Store: chain/data")]
    end

    Mobile --> DevServer
    WebApp --> DevServer
    DevServer --> SqliteDB
    DevServer --> GoChain
    DevServer --> P2P_Pkg
    StorageNode --> Storage_Pkg
    GoChain --> PebbleDB
```

---

## 2. Major Capability Classification Matrix

In accordance with Section 1 of the Mandate, every capability is independently audited and classified into one of six standardized states:

| Capability | Module & Primary Path | Implementation Details & Evidence | Classification |
|:---|:---|:---|:---:|
| **Layer-1 Consensus Engine** | [`chain/`](file:///d:/Sovra/chain) | Go 1.27.0 CometBFT consensus engine, Tendermint BFT v0.38, block time ~1s, Chain ID `sovra-testnet-0`. 100% Go test suite passed. | **Implemented and verified** |
| **State Persistence Store** | [`chain/store/store.go`](file:///d:/Sovra/chain/store/store.go) | CockroachDB Pebble LSM key-value store, atomic batching, iterator prefix scanning. Verified in Go unit tests. | **Implemented and verified** |
| **WASM Smart Contract Engine** | [`chain/x/wasm/keeper/`](file:///d:/Sovra/chain/x/wasm/keeper) | Pure-Go Wazero WebAssembly runtime executing CosmWasm contracts with strict gas metering and zero CGO dependencies. | **Implemented and verified** |
| **Monetary Issuance & 100M Cap** | [`chain/x/issuance/types/`](file:///d:/Sovra/chain/x/issuance/types) | Base unit micro-SOV ($10^6 \mu\text{SOV}$). Hard cap strictly bounded at $100\text{M SOV}$ ($10^{14} \mu\text{SOV}$). Tested. | **Implemented and verified** |
| **P2P Swarm & Transport** | [`packages/p2p/`](file:///d:/Sovra/packages/p2p) | Real OS TCP sockets, Noise_XX handshake, Kademlia DHT ($0.322\text{ms}$ lookup), GossipSub ($126\text{k msgs/s}$). 184 tests passed. | **Implemented and verified** |
| **BitSwap Block Exchange** | [`packages/storage/`](file:///d:/Sovra/packages/storage), [`nodes/storage-node/`](file:///d:/Sovra/nodes/storage-node) | `/sovra/bitswap/1.2.0` over libp2p streams, UnixFS DAG chunking ($256\text{ KB}$), Continuous SQLite pinning. Verified in `storage-p2p.test.ts`. | **Implemented and verified** |
| **Embedded Relational DB** | [`scripts/database-sqlite.ts`](file:///d:/Sovra/scripts/database-sqlite.ts) | Node.js `node:sqlite` DatabaseSync in WAL mode, B-tree indexes, 15 migrations in `database-migrations.ts`. | **Implemented and verified** |
| **Continuous WAL Replication** | [`docker/litestream.yml`](file:///d:/Sovra/docker/litestream.yml) | Litestream streaming WAL frames to S3/R2 at 1-second intervals with 7-day retention. Verified manifest. | **Partially implemented** (Configured, verified locally) |
| **Disaster Recovery Engine** | [`scripts/sovra-backup-restore.ts`](file:///d:/Sovra/scripts/sovra-backup-restore.ts) | Atomic SQLite `VACUUM INTO`, SHA-256 manifests. Verified in `backup-restore-production-drill.test.ts` (13.83ms restore). | **Implemented and verified** |
| **Offline BLE GATT Mesh** | [`scripts/ble-mesh-engine.ts`](file:///d:/Sovra/scripts/ble-mesh-engine.ts), [`apps/sovra-mobile/`](file:///d:/Sovra/apps/sovra-mobile) | Multi-hop store-and-forward routing, ChaCha20-Poly1305 tamper rejection. Verified in `durable-offline-mesh.test.ts`. | **Implemented and verified** |
| **Multi-Node State Convergence** | [`tests/integration/phase3-distributed-state-simulation.test.ts`](file:///d:/Sovra/tests/integration/phase3-distributed-state-simulation.test.ts) | 4 independent nodes, 1,000+ events, network partition, packet drops, duplicate bursts, crash recovery. Passed in 13.5s. | **Implemented and verified** |
| **Self-Healing Solvency Daemon** | [`scripts/self-healing-daemon.ts`](file:///d:/Sovra/scripts/self-healing-daemon.ts) | 15-min WAL checkpoints, orphan block cleanup (<500MB quota), 60-second solvency circuit breaker. | **Implemented and verified** |
| **Monolithic Dev Server Gateway** | [`scripts/dev-server.ts`](file:///d:/Sovra/scripts/dev-server.ts) | Single-process Node.js runtime (101,482 lines) handling HTTP REST, SSE event stream, WebSocket, and L1 RPC proxy. | **Partially implemented** (Functional monolith; needs decoupling) |
| **Client-Side L1 Transaction Signing** | [`packages/crypto/src/wallet.ts`](file:///d:/Sovra/packages/crypto/src/wallet.ts) | Ed25519/secp256k1 client wallet signing implemented, but dev-server line 89410 still holds custodial validator key for API callers. | **Partially implemented** (Custodial gateway drift) |
| **Multi-Provider Authoritative DNS** | N/A | Automated multi-provider DNS sync (e.g., OctoDNS to Cloudflare + deSEC + Porkbun) with automated failover is absent. | **Designed but not implemented** |
| **Decentralized Validator Set** | [`chain/seeds.txt`](file:///d:/Sovra/chain/seeds.txt) | Seed registry exists, but current active validator nodes in `mytestnet/` are operated on loopback/local developer machines. | **Prototype or simulated** (Testnet only; no public mainnet federation) |
| **Automated Node Auto-Update** | N/A | Cryptographically signed container auto-updater verifying digest signatures before in-place upgrade. | **Missing** |

---

## 3. Blockchain & P2P Footprint

- **Genesis File:** [`chain/genesis-phase2-public.json`](file:///d:/Sovra/chain/genesis-phase2-public.json)
- **Chain ID:** `sovra-testnet-0`
- **Initial Minting Allocation:** $15,000,000 \text{ SOV}$ ($1.5 \times 10^{13} \mu\text{SOV}$) circulating; $85,000,000 \text{ SOV}$ ($8.5 \times 10^{13} \mu\text{SOV}$) in unminted halving pool.
- **Validator Keys on Disk:** `chain/mytestnet/node0/validator-0.key.json` (Used by custodial endpoint in `scripts/dev-server.ts#L89410`).
- **Seed Nodes:** Registered in `chain/seeds.txt` (`seed1.testnet.sovra.network:26656`, `seed2.testnet.sovra.network:26656`, `seed3.testnet.sovra.network:26656`).
- **P2P Ports:** Port 4001 (Noise_XX TCP libp2p), Port 26656 (CometBFT consensus P2P), Port 26657 (CometBFT JSON-RPC).
