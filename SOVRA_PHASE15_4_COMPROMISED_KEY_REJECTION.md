# SOVRA PROTOCOL — PHASE 15.4 COMPROMISED KEY REJECTION
**Document ID:** `SOVRA-P15.4-REJECT-005`  
**Security Classification:** `CRITICAL CRYPTOGRAPHIC ENFORCEMENT / ZERO-TRUST`  
**Network / Chain ID:** `sovra-testnet-0`  
**Baseline Commits:** Phase 15.2 `d16d239`, Phase 15.3 `e983be1`  
**Date:** November 22, 2026  
**Auditor:** SOVRA Protocol Security & Cryptographic Consensus Engineering Taskforce  

---

## 1. Executive Summary

This report establishes cryptographic and code-level proof that compromised genesis validator identities are strictly and irrevocably rejected from participating in consensus at or above the designated transition height.

The consensus engine implements defense-in-depth: rather than relying on a single verification check at block commit time, the protocol enforces revocation checks at **seven independent protocol layers**:

1. Local Proposer Interface (`Engine.SignProposal`)
2. Inbound Proposal Verification (`VerifyProposalWithSchedule`)
3. Local Prevote Interface (`Engine.SignPrevote`)
4. Local Precommit Interface (`Engine.SignPrecommit`)
5. Inbound Vote Pool Gossip Ingestion (`VotePool.AddVote`)
6. Precommit Quorum Aggregation (`VotePool.GetPrecommitQuorum`)
7. Commit Certificate Verification & P2P Gossip Ingestion (`VerifyCommitCertificateWithSchedule`)

---

## 2. Seven-Layer Defense Matrix

```
   Layer 1: Engine.SignProposal()            ---> Refuses to sign if address revoked at H
   Layer 2: VerifyProposalWithSchedule()     ---> Rejects proposal signature from revoked proposer
   Layer 3: Engine.SignPrevote()             ---> Refuses to sign if address revoked at H
   Layer 4: Engine.SignPrecommit()           ---> Refuses to sign if address revoked at H
   Layer 5: VotePool.AddVote()               ---> Drops vote if address revoked at H
   Layer 6: VotePool.GetPrecommitQuorum()    ---> Ignores power from revoked addresses
   Layer 7: VerifyCommitCertificateWithSched ---> Rejects certificate containing any revoked signature
```

### Layer 1: Proposer Signer Abort (`chain/consensus/engine.go`)
```go
if activeSet.IsRevokedAtHeight(myAddr, height) {
    return nil, fmt.Errorf("validator %s is revoked at height %d: %w", myAddr, height, ErrRevokedValidator)
}
```
Even if an attacker gains possession of a compromised genesis private key on a node host, the daemon's consensus engine refuses to construct or sign a block proposal at $H \ge H_{\text{trans}}$.

### Layer 2: Proposal Ingestion Rejection (`chain/consensus/verifier.go`)
```go
if valSet.IsRevokedAtHeight(prop.ProposerAddress, prop.Height) {
    return fmt.Errorf("%w: proposer %s was revoked at or before height %d", 
        ErrRevokedValidator, prop.ProposerAddress, prop.Height)
}
```
If a rogue node broadcasts an externally signed proposal using a compromised genesis key, every honest peer rejects the proposal before executing any transactions.

### Layer 3 & 4: Voting Signer Abort (`chain/consensus/engine.go`)
```go
if activeSet.IsRevokedAtHeight(myAddr, height) {
    return nil, fmt.Errorf("validator %s is revoked at height %d: %w", myAddr, height, ErrRevokedValidator)
}
```
Calls to `SignPrevote` and `SignPrecommit` immediately abort with `ErrRevokedValidator`.

### Layer 5: Vote Pool Ingestion Filtering (`chain/consensus/types.go`)
```go
activeValSet := vp.getValSetForHeight(vote.Height)
if activeValSet.IsRevokedAtHeight(vote.ValidatorAddress, vote.Height) {
    return false, fmt.Errorf("vote from revoked validator %s at height %d: %w", 
        vote.ValidatorAddress, vote.Height, ErrRevokedValidator)
}
```
Incoming P2P vote messages bearing a revoked validator address are dropped at the door.

### Layer 6: Quorum Power Aggregation (`chain/consensus/types.go`)
```go
if activeValSet.IsRevokedAtHeight(v.ValidatorAddress, height) {
    continue
}
```
Even if a malformed vote bypassed the pool, `GetPrecommitQuorum` skips the vote during power accumulation.

### Layer 7: Commit Certificate Verification (`chain/consensus/verifier.go`)
```go
if valSet.IsRevokedAtHeight(sig.ValidatorAddress, cert.Height) {
    return fmt.Errorf("%w: validator %s was revoked at or before height %d", 
        ErrRevokedValidator, sig.ValidatorAddress, cert.Height)
}
```
Any block carrying a commit certificate containing even one revoked signature is rejected outright by `ApplyBlock` and `OnReceiveCommitCert`.

---

## 3. Adversarial Attack Scenario Verifications

The following attack scenarios were executed and verified in test suites `tests/security/phase15-4-live-consensus-transition.test.ts` and `chain/consensus/transition_boundary_test.go`:

| Attack Vector | Attacker Action | Expected Protocol Response | Empirical Result |
| :--- | :--- | :--- | :--- |
| **Attack 1: Old Proposer Hijack** | Compromised genesis key signs proposal at $H \ge 40,000$ | `ERR_REVOKED_VALIDATOR` | **PASS (REJECTED)** |
| **Attack 2: Old Quorum Certificate** | 4 compromised genesis keys sign certificate at $H=40,000$ | `ERR_REVOKED_VALIDATOR` | **PASS (REJECTED)** |
| **Attack 3: Mixed Quorum Fabrication** | 2 replacement keys (50%) + 1 compromised key (25%) = 75% | `ERR_REVOKED_VALIDATOR` | **PASS (REJECTED)** |
| **Attack 4: Insufficient Quorum** | 2 replacement keys (50%) attempt to commit without 3rd key | `ERR_INSUFFICIENT_QUORUM` | **PASS (REJECTED)** |
| **Attack 5: Pre-Activation Intrusion** | Replacement key attempts to sign at $H=39,999$ | `ERR_UNKNOWN_VALIDATOR` | **PASS (REJECTED)** |
| **Attack 6: Certificate Replay** | Pre-transition certificate replayed at $H \ge 40,000$ | `ERR_REVOKED_VALIDATOR` / Mismatch | **PASS (REJECTED)** |

---

## 4. Cryptographic Proof Summary

The mathematical guarantee of BFT safety post-transition is established:
$$\forall v \in \mathcal{V}_{\text{genesis}}, \quad \forall H \ge H_{\text{trans}}, \quad \text{IsRevokedAtHeight}(v, H) = \text{true}$$
$$\implies \text{VotingPower}_{\text{effective}}(v, H) = 0$$

Because $\sum_{v \in \mathcal{V}_{\text{replacement}}} \text{VotingPower}(v) = 100$, and quorum requires strictly $> 66.7\%$, no block can be finalized without the participation of at least 3 distinct replacement validators ($75\%$).

---

*Certified by SOVRA Cryptographic Verification Team.*
