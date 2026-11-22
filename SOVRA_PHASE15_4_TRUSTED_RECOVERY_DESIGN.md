# SOVRA PROTOCOL — PHASE 15.4 TRUSTED RECOVERY DESIGN
**Document ID:** `SOVRA-P15.4-RECOVERY-002`  
**Security Classification:** `CRITICAL PROTOCOL ARCHITECTURE / ZERO-TRUST`  
**Network / Chain ID:** `sovra-testnet-0` (and `sovra-recovery-1`)  
**Baseline Commits:** Phase 15.2 `d16d239`, Phase 15.3 `e983be1`  
**Date:** November 22, 2026  
**Auditor:** SOVRA Protocol Security & Cryptographic Consensus Engineering Taskforce  

---

## 1. Core Principle: Immutability of Cryptographic Ledgers

A foundational premise of Byzantine Fault Tolerant consensus is that **a blockchain is an immutable sequence of cryptographically certified state transitions**. 

When blocks are committed with $2/3+$ precommit signatures:
$$\sum_{v \in \text{signers}} \text{VotingPower}(v) \ge \text{QuorumPower}$$
and those blocks are chained via cryptographically signed hashes:
$$\text{Header}(H).\text{LastCommitHash} = \mathcal{H}(\text{CommitCert}(H-1))$$
the resulting ledger cannot be retroactively rewritten without violating the fundamental integrity of the consensus engine.

### The Prohibition of Retroactivity
1. **No Falsification:** We strictly forbid any code or operator action that attempts to re-sign historical blocks 40,000–44,900+ using replacement keys or backdate certificates.
2. **No Post-Hoc Erasure:** We strictly forbid erasing historical blocks to simulate a clean state on the same chain ID.
3. **No Mismatch Attribution:** Any attempt to evaluate blocks 40,000–44,900+ against replacement validator public keys will fail with `ErrRevokedValidator` or `ErrUnknownValidator`, because the physical cryptographic signatures stored in the persistent database were computed by the private keys of the genesis validators.

---

## 2. Forward Recovery Architecture

To maintain zero-trust integrity, the protocol defines two authorized recovery paths:

### Path A: Forward On-Chain Transition on Existing Network (`sovra-testnet-0`)
If the existing testnet `sovra-testnet-0` is kept alive, recovery is achieved through a **forward-scheduled transition**:
- **Current Chain Height:** $\approx 44,900+$
- **Scheduled Activation Height:** $H_{\text{forward}} = 50,000$ (or an agreed future block height).
- **Protocol Mechanism:**
  1. The upgraded daemon (compiled from `chain/cmd/sovrad/main.go` with full `ValidatorSchedule` wiring) registers an authorized on-chain validator transition targeting $H_{\text{forward}}$.
  2. Between the current height and $H_{\text{forward}}-1$, blocks continue to be validated against the active set.
  3. At exact height $H_{\text{forward}}$, the transition activates atomically:
     - The genesis validator set is permanently revoked in `valSchedule`.
     - The replacement validator set assumes $100\%$ voting power ($4 \times 25 = 100$).
     - At $H \ge H_{\text{forward}}$, any signature from the genesis keys is rejected with `ErrRevokedValidator`.
  4. The network transitions without chain halt, balance loss, or ledger erasure.

### Path B: Pristine Recovery Network (`sovra-recovery-1`)
For clean remote testnet onboarding, a completely isolated network is specified:
- **Chain ID:** `sovra-recovery-1` (distinct from `sovra-testnet-0`).
- **Genesis Validators:** The 4 replacement validator identities generated from the encrypted keystores (derived via Argon2id / Scrypt with $N=32768, r=8, p=1$).
- **Compromised Key Exposure:** Zero. The compromised genesis identities have zero allocation, zero voting power, and zero cryptographic existence on `sovra-recovery-1`.
- **Monetary Supply Invariant:** Exactly $30,000,000\text{ SOV}$ ($30,000,000,000,000\text{ uSOV}$) allocated cleanly among the replacement accounts ($7,500,000\text{ SOV}$ each).
- **Separation:** Strict separation of P2P ports, chain ID headers, handshake signatures, and genesis hash guarantees that nodes on `sovra-testnet-0` cannot cross-talk or peer with `sovra-recovery-1`.

---

## 3. Network Separation & Anti-Replay Guarantees

Every message in the SOVRA BFT consensus engine is domain-separated by `ChainID`:

$$\text{VotePayload} = \texttt{SOVRA\_CANONICAL\_VOTE} \parallel \text{ChainID} \parallel \text{Step} \parallel H \parallel R \parallel \text{BlockHash} \parallel \text{ValAddr} \parallel \text{ValIndex}$$

$$\text{ProposalPayload} = \texttt{SOVRA\_CANONICAL\_PROPOSAL} \parallel \text{ChainID} \parallel H \parallel R \parallel \text{BlockHash} \parallel \text{ProposerAddr}$$

Because `ChainID` is permanently hashed into every vote and proposal:
1. No signature created for `sovra-testnet-0` can ever be replayed on `sovra-recovery-1`.
2. No signature created for `sovra-recovery-1` can ever be replayed on `sovra-testnet-0`.
3. P2P handshakes enforce strict `ChainID` agreement prior to peer authentication.

---

## 4. Operational Recovery Roadmap

| Step | Action | Status |
| :--- | :--- | :--- |
| **Step 1** | Wire `ValidatorSchedule` into `chain/consensus/engine.go` and `chain/cmd/sovrad/main.go` | **COMPLETED** |
| **Step 2** | Prove 4-node live consensus transition in deterministic test suite | **COMPLETED** |
| **Step 3** | Re-run full 23-suite regression matrix | **IN PROGRESS** |
| **Step 4** | Deploy upgraded binary to local 4-node cluster | **READY** |
| **Step 5** | Authorize clean remote testnet `sovra-recovery-1` upon physical HSM availability | **GATE PROTECTED** |

---

*Approved by SOVRA Architecture & Security Board.*
