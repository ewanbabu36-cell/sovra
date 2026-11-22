# SOVRA PHASE 15.3 — HEIGHT-40,000 BOUNDARY ADVERSARIAL SECURITY REPORT

**Authority:** Principal CometBFT Architect & Cryptographic Security Auditor  
**Date:** 2026-11-22  
**Baseline Commit:** `d16d239` (Phase 15.2)  
**Evaluation Scope:** Boundary Condition Verification, 14 Adversarial Invariants, Quorum & Partition Dynamics  
**Status:** ALL 14 INVARIANTS VERIFIED (100% Passing in Go and TypeScript)

---

## 1. Executive Summary

A critical requirement of Phase 15.3 is proving that the validator transition scheduled at height $40,000$ functions correctly, instantaneously, and securely under adversarial conditions.

Fourteen distinct boundary invariants were specified, implemented, and executed across two independent test runners:
1. `chain/consensus/transition_boundary_test.go` (Go consensus engine)
2. `tests/security/phase15-3-validator-transition-boundary.test.ts` (TypeScript / Vitest suite)

Every test passed without flakiness or regressions.

---

## 2. In-Depth Boundary Invariant Analysis

### Property 1: Height 39,999 Historical Validator Behavior
- **Test Condition:** A proposed block at height 39,999 with commit certificate signed by 3 of 4 genesis validators (75% power $\ge 67\%$).
- **Verification Result:** The schedule resolves `genesisValSet`. The certificate is verified and accepted.
- **Negative Test:** An attempt by rotated validators to sign at height 39,999 fails with `ERR_UNKNOWN_VALIDATOR`. Rotated validators have zero authority prior to height 40,000.

### Property 2: Height 40,000 Exact Transition Activation
- **Test Condition:** Block 40,000 arrives at the boundary. Rotated validators sign the commit certificate.
- **Verification Result:** The schedule switches instantaneously to `newValSet`. The rotated certificate is certified and committed.
- **Negative Test:** Genesis validators attempting to sign at height 40,000 are rejected with `ERR_REVOKED_VALIDATOR`.

### Property 3: Height 40,001 Forward Quorum Authorization
- **Test Condition:** Block 40,001 signed by rotated validators.
- **Verification Result:** Successfully certified.
- **Negative Test:** Old genesis validators attempting to sign at height 40,001 are strictly rejected with `ERR_REVOKED_VALIDATOR`.

### Property 4: Old Validator Individual Signatures Rejected
- **Attack Vector:** An adversary attempts to slip an individual genesis validator vote into an otherwise valid commit certificate.
- **Verification Result:** In `VerifyCommitCertificate()`, every signature is checked against `valSet.IsRevokedAtHeight(sig.ValidatorAddress, cert.Height)`. As soon as the revoked address is encountered, the entire certificate is rejected with `ErrRevokedValidator`.

### Property 5: Old Validator Full Certificates Rejected
- **Attack Vector:** Adversary possessing all 4 compromised genesis private keys attempts to forge a complete commit certificate for height 40,000.
- **Verification Result:** The certificate is immediately rejected. Compromised keys have zero power at or above height 40,000.

### Property 6: New Validator Quorum Enforcement
- **Supermajority Threshold:** Total voting power $W = 100$.
  $$\text{QuorumPower} = \left\lfloor \frac{2 \cdot 100}{3} \right\rfloor + 1 = 67 \text{ voting power}$$
- **Test 6a (3/4 validators = 75% power):** $75 \ge 67 \implies$ **ACCEPTED**.
- **Test 6b (2/4 validators = 50% power):** $50 < 67 \implies$ **REJECTED** with `ErrInsufficientQuorum`.

### Property 7: Invalid or Unauthorized Transition Rejected
- **Test 7a (Non-positive height):** Proposal with $H=0$ fails with `ErrInvalidTransition`.
- **Test 7b (Empty validator set):** Proposal with 0 validators fails with `ErrInvalidTransition`.
- **Test 7c (Unauthorized proposal):** Proposal marked `UNAUTHORIZED` fails with `ErrUnauthorizedTransition`.

### Property 8: Conflicting Transition Proposals Rejected
- **Attack Vector:** Proposing two conflicting validator sets for the same height ($40,000$).
- **Verification Result:** The schedule detects that height 40,000 is already registered and returns `ErrConflictingTransition`.

### Property 9: Replay of Old Transition Rejected
- **Attack Vector:** Replaying an old transition for height $35,000$ when the schedule is at height $40,000$.
- **Verification Result:** Returns `ErrReplayedTransition` because $H \le H_{\text{existing}}$.

### Property 10: State Recovery Before and After Transition
- **Crash at $H=39,998$:** Node restarts, loads state, queries schedule $\implies$ genesis set active, zero premature revocations.
- **Crash at $H=40,005$:** Node restarts, loads state, queries schedule $\implies$ rotated set active, genesis keys permanently revoked.

### Property 11 & 12: Network Partition & Recovery Without Rollback
- **Scenario:** Node partitioned before height 40,000 reconnects and receives blocks 39,999, 40,000, and 40,001.
- **Verification Result:** Block 39,999 is verified against genesis set. Block 40,000 is verified against rotated set.
- **Rollback Defense:** If a malicious peer attempts to serve an alternate block 40,000 signed by genesis keys, the catch-up node rejects it with `ErrRevokedValidator`. Validator-set rollback is impossible.

### Property 13: Historical Block & Certificate Verification
- **Audit Verification:** Full sync nodes verifying blocks $1 \le H < 40,000$ resolve the genesis set. Historical blocks remain cryptographically valid.

### Property 14: Financial State & AppHash Invariance
- **Balance Equation:** Ledger balances across the 4 accounts ($7,500,000\text{ SOV}$ each) and total supply ($30,000,000\text{ SOV}$) remain unchanged by validator key rotation.
- **AppHash:** Transition does not alter application state hashes.

---

## 3. Summary Scorecard

| Property # | Adversarial Boundary Condition | Go Engine | Vitest Runner | Invariant Status |
|:----------:|:-------------------------------|:---------:|:-------------:|:----------------:|
| 1 | Height 39,999 Historical Behavior | **PASS** | **PASS** | **VERIFIED** |
| 2 | Height 40,000 Exact Activation | **PASS** | **PASS** | **VERIFIED** |
| 3 | Height 40,001 Forward Quorum | **PASS** | **PASS** | **VERIFIED** |
| 4 | Old Signatures Rejected | **PASS** | **PASS** | **VERIFIED** |
| 5 | Old Certificates Rejected | **PASS** | **PASS** | **VERIFIED** |
| 6 | Quorum Power (75% vs 50%) | **PASS** | **PASS** | **VERIFIED** |
| 7 | Invalid Transitions Rejected | **PASS** | **PASS** | **VERIFIED** |
| 8 | Conflicting Proposals Rejected | **PASS** | **PASS** | **VERIFIED** |
| 9 | Replayed Transitions Rejected | **PASS** | **PASS** | **VERIFIED** |
| 10 | Restarts Pre/Post Boundary | **PASS** | **PASS** | **VERIFIED** |
| 11 | Partition Across Boundary | **PASS** | **PASS** | **VERIFIED** |
| 12 | Recovery Without Rollback | **PASS** | **PASS** | **VERIFIED** |
| 13 | Historical Block Verification | **PASS** | **PASS** | **VERIFIED** |
| 14 | Financial State & AppHash Invariance | **PASS** | **PASS** | **VERIFIED** |
