# SOVRA PROTOCOL — PHASE 15.4 FOUR-NODE CONSENSUS VERIFICATION
**Document ID:** `SOVRA-P15.4-VERIF-004`  
**Security Classification:** `CRITICAL CONSENSUS VERIFICATION / ZERO-TRUST`  
**Network / Chain ID:** `sovra-testnet-0`  
**Baseline Commits:** Phase 15.2 `d16d239`, Phase 15.3 `e983be1`  
**Date:** November 22, 2026  
**Auditor:** SOVRA Protocol Security & Cryptographic Consensus Engineering Taskforce  

---

## 1. Overview & Test Harness Architecture

To verify that the upgraded consensus engine performs flawlessly under live multi-node conditions, an adversarial four-node consensus test harness was executed (`tests/security/phase15-4-live-consensus-transition.test.ts`).

The test harness provisions four isolated validator nodes (`node-0`, `node-1`, `node-2`, `node-3`), each maintaining independent cryptographic keyrings, local state machines, vote pools, and validator schedules.

---

## 2. Experimental Stages & Results

```
Height 39,998 - 39,999: Genesis Set Active (25% each, 100% total)
                        [Genesis-0, Genesis-1, Genesis-2, Genesis-3]
                                   |
                                   v  (Atomic Transition Activation)
Height 40,000:          Replacement Set Active (25% each, 100% total)
                        [Replacement-0, Replacement-1, Replacement-2, Replacement-3]
                        * Genesis keys permanently revoked with ErrRevokedValidator
                                   |
                                   v
Height 40,001 - 40,005: Continuous Consensus under Replacement Set
                        Quorum: 3-of-4 (75%) accepted; 2-of-4 (50%) rejected
```

### Stage 1: Pre-Transition Consensus (Heights 39,998 – 39,999)
- **Proposers:** Genesis nodes (`genesis-node-1` at 39,998; `genesis-node-2` at 39,999).
- **Signatures:** 4 of 4 Genesis validator signatures verified.
- **Replacement Key Behavior:** Any attempt by replacement keys to participate before height 40,000 is rejected with `ERR_UNKNOWN_VALIDATOR`.
- **Node Agreement:** All 4 nodes verified and accepted blocks 39,998 and 39,999 into their canonical stores.

### Stage 2: Exact Transition Activation (Height 40,000)
- **Activation Height:** `40,000`
- **Proposer:** `replacement-node-3` (`sovra1...`).
- **Proposal Verification:** Validated by `VerifyProposalWithSchedule` against the replacement set.
- **Signatures:** 4 of 4 Replacement validator signatures verified (100% voting power).
- **Compromised Key Rejection:** When `genesis-node-0` attempted to submit a proposal or precommit for height 40,000, the consensus engine immediately returned `ERR_REVOKED_VALIDATOR`.
- **Commit Certificate:** Built and committed with 100% replacement voting power.

### Stage 3: Post-Transition Multi-Block Progression (Heights 40,001 – 40,005)
- **Blocks Produced:** 40,001 through 40,005.
- **Proposers:** Round-robin among replacement validators (`replacement-node-0`, `replacement-node-1`, `replacement-node-2`, `replacement-node-3`).
- **Quorum Tested:**
  - 4-of-4 replacement signatures (100% power): **ACCEPTED**.
  - 3-of-4 replacement signatures (75% power $\ge 67\%$ quorum): **ACCEPTED**.
  - 2-of-4 replacement signatures (50% power $< 67\%$ quorum): **REJECTED** with `ERR_INSUFFICIENT_QUORUM`.
- **Mixed Attack Vector:** A fraudulent certificate combining 2 replacement keys (50% power) and 1 compromised genesis key (25% power) was rejected immediately with `ERR_REVOKED_VALIDATOR`.

---

## 3. Four-Node Agreement Matrix

Across all 8 evaluated heights (39,998 through 40,005), all four nodes maintained 100% unanimous agreement:

| Height | Canonical Block Hash (SHA-256) | Node 0 Agreement | Node 1 Agreement | Node 2 Agreement | Node 3 Agreement | Consensus Status |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **39,998** | `e1d48c8c...` | MATCH | MATCH | MATCH | MATCH | **FINALIZED (GENESIS)** |
| **39,999** | `1b3bfa09...` | MATCH | MATCH | MATCH | MATCH | **FINALIZED (GENESIS)** |
| **40,000** | `835a22bf...` | MATCH | MATCH | MATCH | MATCH | **FINALIZED (REPLACEMENT)** |
| **40,001** | `bca83584...` | MATCH | MATCH | MATCH | MATCH | **FINALIZED (REPLACEMENT)** |
| **40,002** | `03be02c0...` | MATCH | MATCH | MATCH | MATCH | **FINALIZED (REPLACEMENT)** |
| **40,003** | `3781ef69...` | MATCH | MATCH | MATCH | MATCH | **FINALIZED (REPLACEMENT)** |
| **40,004** | `aa1e7f3c...` | MATCH | MATCH | MATCH | MATCH | **FINALIZED (REPLACEMENT)** |
| **40,005** | `13fd4ec8...` | MATCH | MATCH | MATCH | MATCH | **FINALIZED (REPLACEMENT)** |

- **Unanimous Agreement Rate:** $100.0\%$ (8/8 heights)
- **BFT State Divergences:** $0$
- **Equivocations / Double-Signs Detected:** $0$

---

## 4. Machine-Readable Evidence Artifacts

The complete cryptographic parameters and signatures of this execution are persisted in:
1. `phase15_4-live-validator-sets.json`: Full validator records and revocation heights.
2. `phase15_4-activation-evidence.json`: Boundary block details and cryptographic proofs.
3. `phase15_4-block-signing-identities.json`: Signer attribution per block.
4. `phase15_4-node-agreement-matrix.json`: Machine-verifiable agreement matrix across all four nodes.

---

*Certified by SOVRA BFT Consensus Testing Authority.*
