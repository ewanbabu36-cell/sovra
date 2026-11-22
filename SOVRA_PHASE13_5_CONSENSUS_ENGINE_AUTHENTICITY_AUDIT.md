# SOVRA PHASE 13.5 — CONSENSUS ENGINE AUTHENTICITY AUDIT

**Author:** Principal Blockchain Protocol Auditor, CometBFT Consensus Engineer & Independent Release Authority  
**Target Repository:** `D:\Sovra`  
**Git Baseline Commit:** `1899c27` (Phase 12 Forensic Baseline)  
**Implementation Commit:** `a793a44` (Phase 13 Unification)  
**Canonical Specification:** [`SOVRA_INDUSTRY_STANDARD_MASTER_GOAL_AND_ACCEPTANCE.md`](file:///d:/Sovra/SOVRA_INDUSTRY_STANDARD_MASTER_GOAL_AND_ACCEPTANCE.md)  
**Classification Verdict:** **CATEGORY C: CUSTOM / HYBRID COMETBFT-COMPATIBLE CONSENSUS ENGINE**  
**Production Testnet Status:** **LOCALLY OPERATIONAL & SYNCHRONIZED**  
**Mainnet Release Status:** **STRICTLY NOT AUTHORIZED**

---

## 1. EXECUTIVE SUMMARY & ENGINE CLASSIFICATION

Pursuant to the Phase 13.5 Independent Consensus Security Certification mandate, an independent, forensic audit of the SOVRA blockchain consensus engine was conducted across the source tree (`chain/cmd/sovrad/`, `chain/p2p/`, `chain/privval/`, and `chain/go.mod`).

The audit categorically evaluates whether SOVRA's consensus implementation represents:
- **Category A:** Genuine upstream CometBFT implementation (`github.com/cometbft/cometbft`) utilizing the complete Tendermint/CometBFT consensus protocol state machine (Propose $\rightarrow$ Prevote $\rightarrow$ Precommit $\rightarrow$ Commit certificate with $> 2/3$ multi-signatures).
- **Category B:** Tendermint Core variant.
- **Category C:** Custom / hybrid CometBFT-compatible consensus engine that implements Tendermint-style round-robin proposer scheduling, Pebble KV state execution, Ed25519 proposal signing with high-water mark protection, and exposes CometBFT HTTP/WebSocket RPC schemas, but runs its own internal consensus state machine.
- **Category D:** Mock or simulated consensus engine.

### Definitive Classification: CATEGORY C (Custom / Hybrid Engine)

> [!IMPORTANT]
> **Definitive Finding:** SOVRA does **NOT** import or run genuine upstream CometBFT (`github.com/cometbft/cometbft`). It is an **in-house custom Go consensus daemon (`sovrad`)** architected to provide wire-level RPC emulation for CometBFT clients while executing a simplified round-robin consensus algorithm with quorum checking and Pebble state persistence.

---

## 2. DEPENDENCY & GO MODULE AUDIT

An inspection of [`chain/go.mod`](file:///d:/Sovra/chain/go.mod) reveals the following direct and indirect dependencies:

```go
module sovra/chain

go 1.23

require (
    cosmossdk.io/math v1.4.0
    github.com/cockroachdb/pebble v1.1.2
    github.com/gorilla/mux v1.8.1
    github.com/gorilla/websocket v1.5.3
    github.com/stretchr/testify v1.10.0
    golang.org/x/crypto v0.32.0
)
```

### Forensic Findings:
1. **Absence of Upstream CometBFT:** The official repository `github.com/cometbft/cometbft` (and legacy `github.com/tendermint/tendermint`) is **completely absent** from `chain/go.mod`.
2. **Key Low-Level Primitives:** The engine relies directly on:
   - `cockroachdb/pebble` for LSM-tree KV blockchain state and block storage.
   - `golang.org/x/crypto` (specifically `ed25519` and `scrypt`) for cryptographic operations.
   - `gorilla/websocket` and `gorilla/mux` for HTTP RPC and subscription streaming.
   - `cosmossdk.io/math` for arbitrary precision integer arithmetic (`Uint`, `Int`).

---

## 3. CONSENSUS STATE MACHINE ARCHITECTURE

The consensus loop is implemented in [`chain/cmd/sovrad/main.go`](file:///d:/Sovra/chain/cmd/sovrad/main.go) (lines 1040–1160). The engine implements a round-robin leader rotation model:

$$\text{proposerIndex} = (H - 1 + R) \bmod N$$

Where:
- $H$ is the target block height (`nextHeight = app.GetHeight() + 1`).
- $R$ is the consensus round (`currentRound`, initialized to 0).
- $N$ is the number of active genesis validators ($N = 4$).

### 3.1 Proposer Turn Determination
In `chain/cmd/sovrad/main.go`:
```go
func isMyTurnToPropose(height int64, round int64) bool {
    idx := int((height - 1 + round) % int64(len(genesisValidators)))
    return genesisValidators[idx].Moniker == cfg.Moniker
}
```

### 3.2 Peer Quorum Check
Before proposing a block, a node evaluates active connected voting power across the P2P switch:
```go
// CometBFT rule: block production requires strictly > 2/3 of total voting power
if activePower*3 <= totalPower*2 {
    if !wasQuorumLost {
        wasQuorumLost = true
        fmt.Printf("[CONSENSUS QUORUM LOSS] Active voting power %d/%d (%.1f%%) <= 66.7%% supermajority. Halting block production.\n",
            activePower, totalPower, float64(activePower)/float64(totalPower)*100)
    }
    lastHeightTime = time.Now()
    continue
}
```

### 3.3 Round Advancement on Timeout
If no block is committed within 4 seconds, nodes advance the round:
```go
if time.Since(lastHeightTime) > 4*time.Second {
    currentRound++
    lastHeightTime = time.Now()
    fmt.Printf("[CONSENSUS ROUND ADVANCE] H=%d advancing to round %d\n", nextHeight, currentRound)
}
```

---

## 4. WHAT IS IMPLEMENTED VS WHAT IS MISSING

| Component | Status | Implementation Details in SOVRA |
| :--- | :--- | :--- |
| **Pebble KV Storage** | **IMPLEMENTED** | Raw state machine, account store, and block history stored in Pebble LSM |
| **Deterministic AppHash** | **IMPLEMENTED** | SHA-256 state root computed via `app.Commit()` upon state changes |
| **Round-Robin Proposer** | **IMPLEMENTED** | Strict $(H - 1 + R) \bmod 4$ rotation matching Tendermint scheduling |
| **Quorum Threshold Gate** | **IMPLEMENTED** | Node will not propose if active connected power $\le 66.7\%$ ($< 3/4$) |
| **Round Advance Timeout** | **IMPLEMENTED** | 4-second timeout to advance round $R \rightarrow R+1$ for fallback proposer |
| **Proposer Ed25519 Signing** | **IMPLEMENTED** | Designated proposer signs proposal via `privVal.SignProposal` |
| **High-Water Mark Signer** | **IMPLEMENTED** | `LastSignedState` in `chain/privval` strictly forbids regression |
| **CometBFT RPC Compatibility** | **IMPLEMENTED** | `/status`, `/net_info`, `/block`, `/broadcast_tx_commit`, `/genesis`, `/validators` |
| **P2P Vote Gossip (Prevote/Precommit)** | **MISSING** | Prevote and Precommit messages are **not** gossiped over P2P |
| **Block Commit Certificates** | **MISSING** | Blocks do **not** carry an aggregated 3-of-4 Ed25519 commit certificate |
| **Mempool Proposer Packaging** | **PARTIAL** | Txs received via `/broadcast_tx_commit` are gossiped, but block proposal loop defaults to empty blocks during idle periods |

---

## 5. AUDITOR VERDICT & MIGRATION PATH

1. **Classification:** SOVRA is a **Category C: Custom / Hybrid CometBFT-Compatible Engine**. It is **not** genuine upstream CometBFT.
2. **Safety Evaluation:** Within a trusted or federated testnet topology of 4 known nodes, the implementation enforces round-robin rotation, quorum presence checks, and deterministic state transitions. However, because blocks do not contain aggregated multi-signature commit certificates on the wire, the consensus model is closer to **Federated Proof-of-Authority (PoA)** with Tendermint-compatible RPC than true Asynchronous Byzantine Fault Tolerance (ABFT).
3. **Migration Recommendation:**
   - **Phase 14 Recommendation:** Complete the migration to full CometBFT by either:
     - *Path 1 (Native Upstream CometBFT):* Integrate `github.com/cometbft/cometbft` via ABCI v0.38+, utilizing SOVRA as an ABCI Application (`Application` interface: `InitChain`, `PrepareProposal`, `ProcessProposal`, `FinalizeBlock`, `Commit`).
     - *Path 2 (Complete In-House ABFT):* Add `MsgTypePrevote` and `MsgTypePrecommit` to `chain/p2p/types.go`, gossip votes among nodes, and attach the 3-of-4 signature commit certificate directly to `p2p.BlockData`.
4. **Mainnet Authorization:** **STRICTLY NOT AUTHORIZED.** Mainnet launch must not occur until full Byzantine multi-signature commit certificates are enforced.
