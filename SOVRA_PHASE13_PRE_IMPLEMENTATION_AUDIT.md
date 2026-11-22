# SOVRA PHASE 13 — PRE-IMPLEMENTATION DEEP FORENSIC AUDIT REPORT

**Author:** Principal CometBFT Architect & Distributed Systems Security Auditor  
**Target Repository:** `D:\Sovra`  
**Git Baseline Commit:** `1899c27`  
**Target Architecture:** Canonical Four-Validator CometBFT Consensus Cluster  
**Canonical Specification:** `SOVRA_INDUSTRY_STANDARD_MASTER_GOAL_AND_ACCEPTANCE.md`  
**Date of Audit:** 2026-11-21  
**Audit Determination:** **PRE-IMPLEMENTATION AUDIT COMPLETE — ROOT CAUSE IDENTIFIED**

---

## 1. EXECUTIVE SUMMARY

The Phase 12 forensic audit identified a state discrepancy: Validator 0 (`127.0.0.1:26657`) diverged in application hash and token supply from Validators 1, 2, and 3 (`:26667`, `:26677`, `:26687`), despite all nodes reportedly sharing the same chain ID (`sovra-testnet-0`) and genesis document.

This Phase 13.1 deep pre-implementation audit inspected all configuration files, cryptographic keys, genesis documents, supervisor scripts, network topologies, and block databases prior to modifying any code or runtime state.

### Key Audit Findings:
1. **Genesis Cryptographic Parity:** All four validator node home directories contain identical `genesis.json` files with SHA-256 hash `19d788219464d4e2fd95264ffd476abed95a431b6dc01184bae58abdd9b199cb`.
2. **Validator Key Independence:** All four nodes possess distinct Ed25519 validator private keys, unique public keys, unique node IDs, and equal voting power (25 voting power each, totaling 100).
3. **P2P Topology Defect (Root Cause of Isolation):** `chain/mytestnet/node0/config.json` was configured with `persistent_peers: []` and `seeds: []`. Node 0 never proactively dialed other validators.
4. **Lifecycle Coupling:** `scripts/dev-server.ts` embeds `L1ChainSupervisor` from `scripts/chain-supervisor.ts`, which auto-spawns **Node 0 only**. As a result, Node 0 ran for days in the background across integration test cycles, independently producing 92,000+ blocks and executing an epoch inflation schedule.
5. **State Storage Divergence:** 
   - Node 0 accumulated `minted: 30139358240070 uSOV` and `burned: 10000000 uSOV` ($30,139,348.240070\text{ SOV}$ total supply).
   - Nodes 1, 2, and 3 accumulated `minted: 30041807472021 uSOV` and `burned: 0 uSOV` ($30,041,807.472021\text{ SOV}$ total supply).
   - Because `SovraApp.computeStateRoot()` hashes `height:supply:minted:burned`, Node 0 computes a divergent AppHash even when processing identical block heights.

---

## 2. DETAILED TEN-POINT AUDIT MATRIX

### 2.1 Node Configurations
| Node | Home Directory | Moniker | RPC Port | P2P Port | Seeds Configured | Persistent Peers Configured |
|:----:|----------------|:-------:|:--------:|:--------:|:----------------:|:---------------------------:|
| **0** | `chain/mytestnet/node0` | `validator-0` | `26657` | `26656` | `[]` (EMPTY) | `[]` (EMPTY) |
| **1** | `chain/mytestnet/node1` | `validator-1` | `26667` | `26666` | `[Node 0]` | `[]` (EMPTY) |
| **2** | `chain/mytestnet/node2` | `validator-2` | `26677` | `26676` | `[Node 0]` | `[]` (EMPTY) |
| **3** | `chain/mytestnet/node3` | `validator-3` | `26687` | `26686` | `[Node 0]` | `[]` (EMPTY) |

**Finding:** Node 0 was configured as an isolated seed target rather than a reciprocal peer in a 4-node full mesh.

### 2.2 Genesis Document Verification
All files located at `chain/mytestnet/node{0,1,2,3}/genesis.json`:
- **File Length:** 1,909 bytes
- **SHA-256 Checksum:** `19d788219464d4e2fd95264ffd476abed95a431b6dc01184bae58abdd9b199cb`
- **Chain ID:** `sovra-testnet-0`
- **Genesis Timestamp:** `1792061459` (2026-10-14T02:50:59Z)
- **Initial Supply:** $30,000,000.000000\text{ SOV}$ ($30,000,000,000,000\text{ uSOV}$)
- **Initial Accounts:** 4 accounts, 7,500,000.000000 SOV allocated to each validator address.

### 2.3 Validator Public Keys and Voting Power
Inspection of `genesis.json` and validator key files `chain/mytestnet/node*/validator-*.key.json`:
- **Validator 0:** `50dec499bc1281f64488a3ca9500c9c1a4eea67f5147af0450ee0deebf8601be` (Voting Power: 25 / 25.0%)
- **Validator 1:** `a81cd7b53eb1edcfc9abce54679faf08ccaa002bd5898b63431f29cc964e67e3` (Voting Power: 25 / 25.0%)
- **Validator 2:** `d6cbcf5c5acf4688995801c2993a53f4c5ff164bd897362909fb2f1a5ede7724` (Voting Power: 25 / 25.0%)
- **Validator 3:** `b5fc366f668f7d6dfc43a9b2942895ccb9e4eea5d7b1ca46f1e8c710347977ec` (Voting Power: 25 / 25.0%)
- **Quorum Requirement:** Total Power = 100. Byzantine Fault Tolerance quorum ($2/3 + 1$) requires $\ge 67$ voting power (minimum 3 validators).

### 2.4 Node Key Identities
CometBFT node IDs are deterministically derived via `sha256(pubKey)[:20]`:
- **Node 0 ID:** `2a806ca82d506a025d580d40600abc77a69e10e7`
- **Node 1 ID:** `664a83c922035ce28bb723e4e92aed1e60e26ea1`
- **Node 2 ID:** `cb55be9a3d2afab1c9bcbffb88367bec797d11cb`
- **Node 3 ID:** `d96f6140a4c4ae797d9e3a5badf467eb756d3d20`
All four node IDs are unique and strictly match their genesis configurations.

### 2.5 Persistent Peers and Seeds
- `node0` had 0 persistent peers and 0 seeds.
- `node1`, `node2`, and `node3` had `node0` in their seed list (`2a806ca82d50...@127.0.0.1:26656`).
- While PEX allows dynamic peer discovery once connected, if Node 0 starts first and Nodes 1–3 are offline, Node 0 continues producing blocks in complete network isolation.

### 2.6 P2P Network Addresses
- **Node 0:** Listen: `tcp://0.0.0.0:26656`, External: `127.0.0.1:26656`
- **Node 1:** Listen: `tcp://0.0.0.0:26666`, External: `127.0.0.1:26666`
- **Node 2:** Listen: `tcp://0.0.0.0:26676`, External: `127.0.0.1:26676`
- **Node 3:** Listen: `tcp://0.0.0.0:26686`, External: `127.0.0.1:26686`
Ports are correctly segregated and non-overlapping.

### 2.7 RPC Configurations
- **Node 0:** `http://127.0.0.1:26657`
- **Node 1:** `http://127.0.0.1:26667`
- **Node 2:** `http://127.0.0.1:26677`
- **Node 3:** `http://127.0.0.1:26687`
All endpoints serve standard CometBFT JSON-RPC routes: `/status`, `/net_info`, `/block`, `/genesis`, `/broadcast_tx_commit`.

### 2.8 Chain Supervisor Architecture
- `scripts/dev-server.ts` (PID 5860) imports `l1ChainSupervisor` from `scripts/chain-supervisor.ts`.
- On server initialization, `l1ChainSupervisor.start()` evaluates port 26657. If not running, it executes:
  ```bash
  chain/sovrad.exe start --home=chain/mytestnet/node0 --passphrase=sovra-testnet-secret
  ```
- **Architectural Flaw:** The supervisor only ever starts Node 0. It has no awareness of Nodes 1, 2, and 3. When developers run the API dev server, Node 0 runs as an isolated single-node chain, minting blocks without consensus with Nodes 1–3.

### 2.9 Existing State Databases
- `chain/mytestnet/node0/data/sovradb`: **9.75 MB**
- `chain/mytestnet/node1/data/sovradb`: **7.28 MB**
- `chain/mytestnet/node2/data/sovradb`: **7.52 MB**
- `chain/mytestnet/node3/data/sovradb`: **10.13 MB**
The variance in database size reflects divergent transaction logs, compaction schedules, and block heights accumulated across prior uncoordinated runs.

### 2.10 Identification of Why Validator 0 Was Isolated
1. **Config Misconfiguration:** Empty `persistent_peers` and `seeds` in `node0/config.json`.
2. **Supervisor Asymmetry:** `dev-server.ts` kept Node 0 running autonomously, advancing 81,777 blocks past Nodes 1–3.
3. **AppHash State Invariant:** Because Node 0 executed extra epoch emission blocks and a 10 SOV burn transaction, its internal KV-store state diverged from Nodes 1–3.
4. **Block Gossip Drop:** In `chain/cmd/sovrad/main.go`, `ApplyBlock` discards incoming blocks if `b.Height <= app.GetHeight()`. When nodes produced blocks independently on local tickers, they rejected each other's proposals.

---

## 3. AUDIT CONCLUSION & NEXT STEPS

The four validators share identical genesis documents, valid individual private/public keys, and proper network addresses. The state split was caused by:
1. Lack of explicit mutual `persistent_peers` in all four configs.
2. Independent block-production tickers rather than deterministic round-robin consensus with vote threshold enforcement.
3. Node 0 running solo via the API dev server background process.

The technical requirements for Phase 13.2 through Phase 13.8 are now clearly defined.
