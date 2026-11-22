# SOVRA PHASE 14 — BFT CONSENSUS ARCHITECTURE SPECIFICATION

**Canonical Reference:** `SOVRA_INDUSTRY_STANDARD_MASTER_GOAL_AND_ACCEPTANCE.md`  
**Phase:** 14 — Production-Grade BFT Consensus & Cryptographic Finality  
**System Classification:** In-House Custom Byzantine Fault Tolerant (BFT) State Machine Replication  
**Target:** Local Development, Local Testnet, and Remote Multi-Cloud Federation  
**Security Classification:** Highly Critical Distributed Systems Specification  
**Status:** IMPLEMENTED, TESTED, VERIFIED  

---

## 1. EXECUTIVE SUMMARY & ARCHITECTURAL FOUNDATION

Prior to Phase 14, the SOVRA blockchain employed a custom round-robin proposer model with P2P block gossip and a local quorum power check ($> 66.7\%$) based on active P2P node connections. However, blocks were broadcast and committed solely on the authority of the designated proposer's signature (`GAP-P1-02`). 

Under Phase 14, SOVRA eliminates this vulnerability by implementing **true Byzantine Fault Tolerant (BFT) 2-Phase Commit Consensus** with cryptographically verifiable commit certificates (`CommitCertificate`). A block is **never** considered finalized merely because its proposer signed it. Finality requires explicit, signed Ed25519 precommit votes aggregating strictly $> 2/3$ of the active validator voting power ($N=4$, $P=25$ each, Quorum $= 67/100$, requiring 3 independent validator signatures).

### Non-Negotiable System Invariant
$$\text{Finality}(B_h) \iff \sum_{v \in \text{Precommits}(B_h)} \text{VotingPower}(v) > \frac{2}{3} \times \text{TotalVotingPower} \wedge \forall v, \text{VerifySig}(v, \text{BlockHash}(B_h))$$

---

## 2. FORMAL CONSENSUS STATE MACHINE & TWO-PHASE COMMIT

The SOVRA BFT consensus state machine operates in deterministic rounds $R \ge 0$ for each block height $H \ge 1$.

```
               +-----------------------------------------+
               |              NEW HEIGHT (H)             |
               +-----------------------------------------+
                                    |
                                    v
               +-----------------------------------------+
               |              ROUND START (R)            |
               |      Deterministic Proposer Selection   |
               +-----------------------------------------+
                                    |
                    +---------------+---------------+
                    | (If Proposer)                 | (If Validator)
                    v                               v
         +--------------------+            +--------------------+
         |   BEGIN BLOCK &    |            |   AWAIT PROPOSAL   |
         |  COMPUTE CANDIDATE |            |    (TIMEOUT 4s)    |
         +--------------------+            +--------------------+
                    |                               |
                    v                               v
         +--------------------+            +--------------------+
         |  SIGN PROPOSAL &   |            |  VERIFY PROPOSAL   |
         |  BROADCAST CAND.   |            |    & PROPOSER      |
         +--------------------+            +--------------------+
                    |                               |
                    +---------------+---------------+
                                    |
                                    v
               +-----------------------------------------+
               |                PREVOTE                  |
               |   Cast signed prevote for block hash    |
               +-----------------------------------------+
                                    |
                                    v
               +-----------------------------------------+
               |               PRECOMMIT                 |
               |   Lock on BlockHash, cast precommit     |
               |   via P2P Switch to VotePool            |
               +-----------------------------------------+
                                    |
                                    v
               +-----------------------------------------+
               |             QUORUM POLLING              |
               |   Sum(Precommit Power) >= 67% (3 of 4)  |
               +-----------------------------------------+
                    |                               |
          (Quorum Reached)                 (Timeout / Insufficient)
                    |                               |
                    v                               v
         +--------------------+            +--------------------+
         |  BUILD COMMIT CERT |            |   ADVANCE ROUND    |
         |  ATTACH TO BLOCK   |            |      (R -> R+1)    |
         +--------------------+            +--------------------+
                    |                               |
                    v                               +-> (Retry R+1)
         +--------------------+
         | PERSIST & COMMIT   |
         | TO PEBBLE DATABASE |
         +--------------------+
                    |
                    v
         +--------------------+
         | GOSSIP FINAL BLOCK |
         | & COMMIT CERT OVER |
         |      P2P SWITCH    |
         +--------------------+
```

### 2.1 Round-Robin Proposer Selection
The proposer for height $H$ and round $R$ is deterministically selected using CometBFT modular arithmetic over the canonical active validator set:
$$\text{ProposerIndex}(H, R) = (H - 1 + R) \pmod{|\text{Validators}|}$$
Because the validator set is strictly ordered by canonical genesis configuration and public key, all honest nodes compute identical proposer schedules without communication.

### 2.2 Canonical Vote Serialization
Votes must have an unforgeable, canonical byte representation to prevent signature malleability, cross-chain replay, and round confusion. In SOVRA, every vote signed by `PrivValidator` follows:
$$\text{CanonicalVoteBytes} = \texttt{"SOVRA\_CONSENSUS\_VOTE:"} \,\|\, \text{ChainID} \,\|\, \texttt{":"} \,\|\, \text{Step} \,\|\, \texttt{":"} \,\|\, H \,\|\, \texttt{":"} \,\|\, R \,\|\, \texttt{":"} \,\|\, \text{BlockHash}$$
Where:
- $\text{ChainID} \in \{\texttt{"sovra-testnet-0"}, \dots\}$
- $\text{Step} \in \{\texttt{"PREVOTE"}, \texttt{"PRECOMMIT"}\}$
- $H$ is the 64-bit integer height
- $R$ is the 64-bit integer round
- $\text{BlockHash}$ is the 32-byte hexadecimal representation of the candidate state root.

---

## 3. CORE CONSENSUS SUBSYSTEMS & PACKAGES

The Phase 14 consensus architecture is implemented across modular Go packages in `chain/`:

### 3.1 `chain/consensus/` (New Core Package)
- **`types.go`**: Defines `Validator`, `ValidatorSet`, `CommitSignature`, `CommitCertificate`, `EquivocationEvidence`, and `VotePool`.
- **`verifier.go`**: Pure cryptographic verifier containing:
  - `VerifyCommitCertificate(cert, valSet, chainID)`: Validates certificate structure, enforces Ed25519 signatures against registered public keys, prevents duplicate validator signatures, matches voting power, and enforces the $> 2/3$ quorum inequality.
  - `VerifyProposal(prop, valSet, chainID)`: Validates proposer identity and Ed25519 signature.
  - `VerifyVote(vote, valSet, chainID)`: Validates individual prevote/precommit signatures.
- **`engine.go`**: Stateful consensus coordinator containing:
  - `Engine`: Manages local validator state, locking, vote accumulation, and certificate generation.
  - `SignProposal`, `SignPrevote`, `SignPrecommit`: Delegates cryptographic signing to `privval.PrivValidator` while updating persistent locks.
  - `ProcessIncomingVote(vote)`: Deduplicates votes, verifies signatures, checks for equivocation, and registers voting power in the pool.
  - `WaitForPrecommitQuorum(height, round, blockHash, timeout)`: Asynchronous barrier awaiting $2/3+$ precommit aggregation.
  - `BuildCommitCertificate(height, round, blockHash)`: Serializes verified signatures into a canonical `CommitCertificate`.

### 3.2 `chain/p2p/` (Wire Protocol Enhancement)
- **`types.go`**:
  - `BlockData`: Extended with `CommitCert *consensus.CommitCertificate`.
  - Added message types: `MsgTypeVote = "vote"` and `MsgTypeCommitCert = "commit_cert"`.
  - Added payloads: `VotePayload` and `CommitCertPayload`.
- **`switch.go`**:
  - `SwitchCallbacks`: Extended with `OnReceiveVote(vote privval.Vote)` and `OnReceiveCommitCert(cert consensus.CommitCertificate)`.
  - Added broadcast channels: `BroadcastVote(vote, chainID)` and `BroadcastCommitCert(cert)`.
  - Peer fast sync: `syncBlocksFromPeer` requires all synchronized historical blocks to satisfy `VerifyCommitCertificate` before execution.

### 3.3 `chain/cmd/sovrad/` (Node Integration)
- Integrated `consensus.Engine` into the main daemon event loop.
- Proposer execution: Computes candidate state root, broadcasts proposal, broadcasts self-precommit, waits for $2/3+$ quorum, builds `CommitCertificate`, commits to Pebble DB, and broadcasts finalized block.
- Non-proposer validator: Verifies candidate proposal, casts signed precommit back via P2P switch, and halts local commitment until the block arrives with a valid `CommitCertificate`.
- RPC additions: `/block` exposes `last_commit`, `/commit` provides CometBFT-compatible signed header commits, and `/consensus_state` returns current quorum and active validator power.

---

## 4. BYZANTINE FAULT TOLERANCE & EQUIVOCATION PREVENTION

### 4.1 Equivocation (Double Signing) Detection
A validator is Byzantine if it signs two distinct block hashes for the same `(Height, Round, Step)`. The `VotePool` actively monitors all incoming votes:
```go
if existing, found := p.votesByVal[key]; found {
    if existing.BlockHash != v.BlockHash {
        evidence := &EquivocationEvidence{
            Height:           v.Height,
            Round:            v.Round,
            Step:             v.Type,
            ValidatorAddress: v.ValidatorAddress,
            FirstBlockHash:   existing.BlockHash,
            SecondBlockHash:  v.BlockHash,
            FirstSignature:   existing.SignatureHex,
            SecondSignature:  v.SignatureHex,
            Timestamp:        time.Now().Unix(),
        }
        p.equivocations = append(p.equivocations, evidence)
        return false, fmt.Errorf("equivocation detected for validator %s at H=%d R=%d", v.ValidatorAddress, v.Height, v.Round)
    }
}
```
Equivocating votes are immediately rejected from the vote pool and logged as slashing evidence.

### 4.2 High-Water Mark Replay Protection
Every validator node enforces monotonic height and round progression via `privval.LastSignedState`. If a Byzantine peer replays an old vote or attempts to force a validator to sign a lower height, the `PrivValidator` enforcer fails closed:
$$\text{If } H_{\text{req}} < H_{\text{last}} \lor (H_{\text{req}} = H_{\text{last}} \land R_{\text{req}} \le R_{\text{last}} \land \text{Step}_{\text{req}} \le \text{Step}_{\text{last}}), \quad \text{REJECT}$$

### 4.3 Network Partition Tolerance & Quorum Arithmetic
In a network of $N=4$ validators with equal voting power ($P_i = 25$, Total $= 100$):
$$\text{QuorumPower} = \left\lfloor \frac{2 \times 100}{3} \right\rfloor + 1 = 66 + 1 = 67$$
- **4 of 4 active:** Power $= 100 \ge 67$ (75% supermajority). Blocks finalize smoothly.
- **3 of 4 active (1 node down/isolated):** Power $= 75 \ge 67$. Blocks finalize smoothly. (Fault tolerance $f = 1$).
- **2 of 4 active (2 nodes down/isolated):** Power $= 50 < 67$. Consensus safely halts. No blocks are finalized.
- **Partition:** Network splits into partition A (3 nodes) and partition B (1 node). Partition A continues producing blocks. Partition B halts. No split-brain is mathematically possible.

---

## 5. VALIDATOR IDENTITY & CUSTODY SPECIFICATION

The 4 canonical validators forming `sovra-testnet-0` are cryptographically pinned:

| Validator Index | Moniker | Address | Public Key (Hex) | Voting Power |
| :--- | :--- | :--- | :--- | :--- |
| **0** | `validator-0` | `sovra1ca04677d4a5556ec4590e2e15ad94e2951243862` | `2688e886ca23dd7fb4c8d3c85583e90c40adcd5dd8cf33daadd84c73acc106d0` | 25 (25.0%) |
| **1** | `validator-1` | `sovra15bc25f403f6f4eec9b2b4613ba0225ab27fbc848` | `49560913016feb4094d21a4d766745fad1d1a00c282b4c6e96a0b2822dc61b08` | 25 (25.0%) |
| **2** | `validator-2` | `sovra1d9e0a692324e1bcbf624dafe8aab072ff46d7c4e` | `0cd6801ba0bc052e0accecdb92a177b1e3505d062161de0cf054dcadc2906249` | 25 (25.0%) |
| **3** | `validator-3` | `sovra184b484d466ac153cb7d5c330cca8751996e5a176` | `d0846dd03e3f13dbadc31781630c2e2abaef000bde4660c10777f1af88ee0ff2` | 25 (25.0%) |

**Total Active Power:** 100  
**Quorum Power Required:** 67 (strictly $> 2/3$)  
**Minimum Independent Signers:** 3 validators  

---

## 6. INDEPENDENT VERIFICATION & ACCEPTANCE STATUS

1. **Compilation:** `go build -o sovrad.exe ./cmd/sovrad` compiles with zero warnings or errors.
2. **Go Unit Test Suite:** `go test -v ./...` passed across all 10 packages:
   - `github.com/sovra/chain/cmd/sovrad` PASS
   - `github.com/sovra/chain/consensus` PASS
   - `github.com/sovra/chain/node` PASS
   - `github.com/sovra/chain/p2p` PASS
   - `github.com/sovra/chain/privval` PASS
   - `github.com/sovra/chain/store` PASS
   - `github.com/sovra/chain/x/auth` PASS
   - `github.com/sovra/chain/x/issuance/keeper` PASS
   - `github.com/sovra/chain/x/issuance/types` PASS
   - `github.com/sovra/chain/x/wasm` PASS
3. **Architectural Classification:** Custom CometBFT-compatible BFT consensus engine. Verified to achieve mathematical and cryptographic commit finality.
