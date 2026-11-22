# SOVRA PHASE 14 — CONSENSUS FORENSIC AUDIT & BFT GAP ANALYSIS

**Author:** Principal Blockchain Protocol Auditor & Distributed Systems Engineer  
**Target Repository:** `D:\Sovra`  
**Phase 13 Baseline:** `343fae0` (Phase 13.5 Independent Certification)  
**Target Execution:** Phase 14 Production-Grade BFT Consensus & Cryptographic Finality  
**Canonical Specification:** [`SOVRA_INDUSTRY_STANDARD_MASTER_GOAL_AND_ACCEPTANCE.md`](file:///d:/Sovra/SOVRA_INDUSTRY_STANDARD_MASTER_GOAL_AND_ACCEPTANCE.md)  
**Audit Evaluation:** **PRE-IMPLEMENTATION FORENSIC BASELINE COMPLETE**

---

## 1. OBJECTIVE & FORENSIC MANDATE

In strict accordance with Phase 14 Non-Negotiable Rule 1 ("Perform a complete forensic audit before modifying code"), this report establishes the baseline architectural, cryptographic, and protocol-level state of the SOVRA blockchain consensus engine prior to implementing cryptographic commit certificates and BFT two-phase finality.

The audit inspects:
1. Current consensus state machine (`chain/cmd/sovrad/main.go`).
2. Proposal signing and verification (`chain/privval/`).
3. P2P message structures and wire protocol (`chain/p2p/`).
4. Validator-set management and voting-power calculations.
5. Persistent locking and `LastSignedState` high-water mark protection.
6. Block validation, execution, and deterministic `AppHash` generation.
7. Restart and P2P synchronization catch-up logic.

---

## 2. DEEP AUDIT OF THE EXISTING CONSENSUS SUBSYSTEMS

### 2.1 Consensus State Machine
The core consensus loop resides in [`chain/cmd/sovrad/main.go`](file:///d:/Sovra/chain/cmd/sovrad/main.go) (lines 1030–1165):
- **Scheduling Algorithm:** Deterministic round-robin rotation:
  $$\text{proposerIndex} = (H - 1 + R) \bmod N$$
  Where $H$ is next height, $R$ is current round (0-indexed), and $N = 4$ validators.
- **Round Timeout:** If no block is committed within $4.0$ seconds, nodes advance $R \rightarrow R + 1$ to allow a fallback proposer.
- **Quorum Presence Check:** Prior to proposing, the node checks whether active connected voting power exceeds $66.7\%$ ($\sum P_{\text{active}} \times 3 > \sum P_{\text{total}} \times 2$). If not, block production halts.

### 2.2 Proposal Signing & Verification
- **Proposal Generation:** The designated proposer creates a [`privval.Proposal`](file:///d:/Sovra/chain/privval/types.go) containing `Height`, `Round`, `POLRound`, `BlockHash`, and `ProposerAddress`.
- **Signing:** The proposer signs the canonical bytes via `privVal.SignProposal(chainID, prop)`.
- **Canonical Formatting:**
  `"SOVRA_CONSENSUS_PROPOSAL:" + chainID + ":" + height + ":" + round + ":" + polRound + ":" + blockHash`
- **Gap:** Receiving peers receive a `p2p.BlockData` envelope. The proposer signature itself is not serialized in `p2p.BlockData` over the wire, and receiving peers do not verify the proposer's Ed25519 signature before executing `ApplyBlock`.

### 2.3 P2P Wire Protocol & Message Structures
In [`chain/p2p/types.go`](file:///d:/Sovra/chain/p2p/types.go), the wire message types are currently:
- `handshake` / `handshake_ack`
- `pex_req` / `pex_resp`
- `block_req` / `block_resp`
- `new_block`
- `tx`

#### Critical Architectural Deficiencies in Wire Protocol:
1. **Absence of Vote Messages:** Neither `prevote` nor `precommit` messages are transmitted over the P2P switch.
2. **Missing Commit Certificate in BlockData:** [`p2p.BlockData`](file:///d:/Sovra/chain/p2p/types.go) consists only of `Height`, `Time`, `AppHash`, `Proposer`, `TxCount`, and `Txs`. There is no `CommitCert` field holding the validator signatures.
3. **No Signature Aggregation:** Blocks are committed upon receipt without verifying whether $> 2/3$ of the validator set agreed to commit that specific block hash.

### 2.4 Validator-Set & Voting Power
In [`chain/mytestnet/node0/genesis.json`](file:///d:/Sovra/chain/mytestnet/node0/genesis.json):
- 4 validators: `validator-0`, `validator-1`, `validator-2`, `validator-3`.
- Voting power: $25$ each; Total Voting Power = $100$.
- Supermajority threshold ($> 2/3$):
  $$\text{Quorum Threshold} = \lfloor \frac{2}{3} \times 100 \rfloor + 1 = 67 \implies \text{requires } \ge 3 \text{ validators } (75\%)$$
- Public keys: Available for each validator in genesis.

### 2.5 Persistent Locking & `LastSignedState`
In [`chain/privval/types.go`](file:///d:/Sovra/chain/privval/types.go):
- `LastSignedState` tracks `(Height, Round, Step, BlockHash)`.
- Monotonicity invariants:
  - Height regression is rejected with `ErrDoubleSigningProtection`.
  - Round regression at the same height is rejected.
  - Step regression at the same height and round is rejected.
  - Conflicting block hash at the same step is rejected.
  - Idempotent re-signing of the exact same vote/proposal is permitted.
- **Audit Finding:** The local signing daemon is cryptographically sound and safe against local equivocation. However, the rest of the network does not receive or cross-verify these signed votes.

### 2.6 Block Execution & Deterministic AppHash
- `app.BeginBlock(height, time)`
- `app.DeliverTx(tx)`
- `app.Commit()` $\rightarrow$ Generates 32-byte SHA-256 state root from Pebble KV store.
- `app.SaveBlock(height, bBz)` $\rightarrow$ Persists raw block JSON.

### 2.7 Synchronization Catch-Up (`GetBlocks` / `ApplyBlock`)
- When a node joins or catches up, it sends `MsgTypeBlockRequest` with `(FromHeight, ToHeight)`.
- The peer responds with `MsgTypeBlockResponse` containing `[]BlockData`.
- The receiver loops over `Blocks` and calls `ApplyBlock(b)`.
- **Gap:** The receiver applies every block without verifying a cryptographic commit certificate attached to each block. A malicious peer could serve fabricated blocks during fast-sync.

---

## 3. COMPLETE BFT CONSENSUS GAP ANALYSIS

```mermaid
flowchart TD
    subgraph Current Custom Implementation (Category C)
        A1[Designated Proposer Turn] --> B1[Connected Peer Power Check > 66.7%]
        B1 --> C1[Execute Block & Compute AppHash]
        C1 --> D1[Proposer Signs Proposal locally]
        D1 --> E1[Gossip BlockData over P2P]
        E1 --> F1[Receivers Apply Block directly without Vote Verification]
    end

    subgraph Standard BFT Commit Finality (Phase 14 Target)
        A2[Proposer Broadcasts Proposal with Signature] --> B2[Peers Verify Proposer Turn & Signature]
        B2 --> C2[Peers Broadcast Prevote with Ed25519 Sig]
        C2 --> D2[Aggregate 2/3+ Prevotes -> Lock on Block]
        D2 --> E2[Peers Broadcast Precommit with Ed25519 Sig]
        E2 --> F2[Aggregate 2/3+ Precommits -> CommitCertificate]
        F2 --> G2[Commit Block & Attach CommitCertificate]
        G2 --> H2[P2P Sync Verifies CommitCertificate before Applying]
    end
```

| BFT Consensus Requirement | Current Status | Phase 14 Implementation Requirement |
| :--- | :---: | :--- |
| **Prevote Gossip Message** | **MISSING** | Add `MsgTypePrevote` with Ed25519 signed vote payload |
| **Precommit Gossip Message** | **MISSING** | Add `MsgTypePrecommit` with Ed25519 signed vote payload |
| **Commit Certificate Wire Struct** | **MISSING** | Define `CommitCertificate` containing height, round, hash, and $\ge 3$ validator signatures |
| **Commit Certificate in BlockData** | **MISSING** | Include `CommitCert *CommitCertificate` in `p2p.BlockData` |
| **Validator Signature Verification** | **LOCAL ONLY** | Implement multi-signature verification against genesis validator set |
| **Two-Thirds+ Quorum Enforcement** | **CONNECTED ONLY** | Enforce $\sum P_i > \frac{2}{3} P_{\text{total}}$ based on verified cryptographic signatures |
| **Duplicate-Vote Rejection** | **LOCAL ONLY** | Track peer vote cache to reject duplicate or conflicting votes |
| **Equivocation Detection** | **LOCAL ONLY** | Detect and flag validators signing conflicting block hashes at same round |
| **Sync-Time Certificate Verification** | **MISSING** | `ApplyBlock` must reject any block lacking a verified 3-of-4 commit certificate |

---

## 4. AUDIT CONCLUSION & IMPLEMENTATION CLEARANCE

The forensic audit is complete. The existing codebase provides a solid foundation (Pebble KV storage, Ed25519 HSM signing, `LastSignedState` double-sign protection, and a working P2P switch).

Phase 14.2 implementation may now proceed to wire the complete two-phase BFT commit finality engine into `chain/p2p/`, `chain/privval/`, and `chain/cmd/sovrad/`.
