# SOVRA-EXT-CONSENSUS
## Optional Replicated Consensus & Experimental Issuance Extension

**Classification:** Optional Extension (NOT part of mandatory `SOVRA-CORE`)  
**Amendment Baseline:** `IA-01 Section 1 & Section 2`  
**Implementation Path:** [chain/](file:///d:/Sovra/chain/go.mod)

---

## 1. Isolation Boundary

1. Mandatory `SOVRA-CORE`, `SOVRA-ID`, `SOVRA-NET`, `SOVRA-EVT`, `SOVRA-STORE`, `SOVRA-SYNC`, `SOVRA-MSG`, `SOVRA-APP`, and `SOVRA-GOV` operate **100% independently** of `SOVRA-EXT-CONSENSUS`.
2. Core packages (`@sovra/identity`, `@sovra/p2p`, `@sovra/protocol`, `@sovra/social`, `@sovra/storage`, `@sovra/messaging`, `@sovra/crypto`, `@sovra/shared`) and daemon nodes (`full-node`, `storage-node`, `relay-node`, `community-node`, `index-node`) MUST NOT import or require Go L1 RPC (`26657`), `sovrad`, validator staking, or wallet balances for identity creation, peer discovery, storage pinning, routing, or social/messaging sync.
3. No global blockchain, token ownership, mining, validator node, or gas fee is mandatory to run or use Sovra.

## 2. Preserved Experimental Components

- Existing custom Go BFT consensus engine ([chain/consensus](file:///d:/Sovra/chain/consensus/engine.go), [chain/node](file:///d:/Sovra/chain/node/app.go), [chain/cmd/sovrad](file:///d:/Sovra/chain/cmd/sovrad/main.go)) and `100M` lifetime supply + 4-year bit-shift halving issuance logic ([chain/x/issuance](file:///d:/Sovra/chain/x/issuance/keeper/keeper.go)) remain preserved strictly as **experimental optional extension code**.
- Optional gateway integration ([scripts/routes/wallet.routes.ts](file:///d:/Sovra/scripts/routes/wallet.routes.ts), [scripts/chain-supervisor.ts](file:///d:/Sovra/scripts/chain-supervisor.ts)) is decoupled from core node identity and subject to separate community economic/legal ratification before any production activation.
