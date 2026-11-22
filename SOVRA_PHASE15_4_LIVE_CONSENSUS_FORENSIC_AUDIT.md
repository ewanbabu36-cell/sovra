# SOVRA PROTOCOL — PHASE 15.4 LIVE CONSENSUS FORENSIC AUDIT
**Document ID:** `SOVRA-P15.4-AUDIT-001`  
**Security Classification:** `CRITICAL FORENSIC AUDIT / ZERO-TRUST`  
**Network / Chain ID:** `sovra-testnet-0`  
**Baseline Commits:** Phase 15.2 `d16d239`, Phase 15.3 `e983be1`  
**Date:** November 22, 2026  
**Auditor:** SOVRA Protocol Security & Cryptographic Consensus Engineering Taskforce  

---

## 1. Executive Summary

This forensic audit investigates the runtime consensus state of the live 4-node loopback cluster for network `sovra-testnet-0`. 

In Phase 15.2 and Phase 15.3, an on-chain validator set transition mechanism (`ValidatorSchedule`) was designed and unit-tested in `chain/consensus/transition_boundary_test.go` and `tests/security/phase15-3-validator-transition-boundary.test.ts`. That test demonstrated that, in isolation, a validator transition scheduled for height 40,000 would reject the original genesis validator keys and accept replacement keys.

However, a live forensic inspection of the running daemons on `sovra-testnet-0` revealed a critical discrepancy:
**The live chain continued producing and finalizing blocks well beyond height 40,000 (reaching height 44,900+) entirely authorized and signed by the compromised genesis validator keys.**

This audit documents the exact factual state of the running chain, the root cause analysis of why the running daemons did not transition at height 40,000, and explicitly establishes that **no retroactive tampering, block invalidation, or historical certificate falsification will be performed**. The historical reality of the blockchain is permanently recorded as a live security incident.

---

## 2. Live Chain Empirical Evidence

### 2.1 Live Node Query & Status
Direct HTTP queries against the running Node 0 daemon (`http://127.0.0.1:26657/status`) returned the following machine state:
```json
{
  "chain_id": "sovra-testnet-0",
  "moniker": "validator-0",
  "node_id": "2a806ca82d506a025d580d40600abc77a69e10e7",
  "height": 44899,
  "app_hash": "cd162858affc178fba5e01fb38f397dbd8ea9519f120f9183956100946a9eae7",
  "genesis_time": 1792061459,
  "total_supply": "30041807472021",
  "lifetime_mint": "30041807472021",
  "lifetime_burn": "0",
  "supply_correct": true
}
```

### 2.2 Consensus State Analysis (`/consensus_state`)
Querying `http://127.0.0.1:26657/consensus_state` revealed that the active validator set in the running process memory was strictly identical to the initial genesis set:
```json
{
  "id": -1,
  "jsonrpc": "2.0",
  "result": {
    "height": 44909,
    "is_validator": true,
    "quorum_power": 67,
    "total_voting_power": 100,
    "validators": [
      {
        "name": "validator-0",
        "address": "sovra12a806ca82d506a025d580d40600abc77a69e10e7",
        "pub_key": "50dec499bc1281f64488a3ca9500c9c1a4eea67f5147af0450ee0deebf8601be",
        "voting_power": 25,
        "node_id": "2a806ca82d506a025d580d40600abc77a69e10e7"
      },
      {
        "name": "validator-1",
        "address": "sovra1664a83c922035ce28bb723e4e92aed1e60e26ea1",
        "pub_key": "a81cd7b53eb1edcfc9abce54679faf08ccaa002bd5898b63431f29cc964e67e3",
        "voting_power": 25,
        "node_id": "664a83c922035ce28bb723e4e92aed1e60e26ea1"
      },
      {
        "name": "validator-2",
        "address": "sovra1cb55be9a3d2afab1c9bcbffb88367bec797d11cb",
        "pub_key": "d6cbcf5c5acf4688995801c2993a53f4c5ff164bd897362909fb2f1a5ede7724",
        "voting_power": 25,
        "node_id": "cb55be9a3d2afab1c9bcbffb88367bec797d11cb"
      },
      {
        "name": "validator-3",
        "address": "sovra1d96f6140a4c4ae797d9e3a5badf467eb756d3d20",
        "pub_key": "b5fc366f668f7d6dfc43a9b2942895ccb9e4eea5d7b1ca46f1e8c710347977ec",
        "voting_power": 25,
        "node_id": "d96f6140a4c4ae797d9e3a5badf467eb756d3d20"
      }
    ]
  }
}
```

### 2.3 Post-Height-40,000 Block Commit Certificate Forensics
Inspection of the commit certificate on Block 44,900 (`http://127.0.0.1:26657/commit?height=44900`):
- **Block Height:** `44,900`
- **Block Hash:** `37a9cd7486b06f8ac5c34848fe6514f1e9717916e71a8513ff98cdaadf4454b0`
- **Signatures Present (4 of 4):**
  1. `sovra1d96f6140a4c4ae797d9e3a5badf467eb756d3d20` (validator-3) — 25 voting power
  2. `sovra12a806ca82d506a025d580d40600abc77a69e10e7` (validator-0) — 25 voting power
  3. `sovra1664a83c922035ce28bb723e4e92aed1e60e26ea1` (validator-1) — 25 voting power
  4. `sovra1cb55be9a3d2afab1c9bcbffb88367bec797d11cb` (validator-2) — 25 voting power
- **Accumulated Voting Power:** 100 / 100 (100.0%)

Every block from 40,000 through 44,900+ was signed and finalized exclusively by the original genesis validator keys.

---

## 3. Root Cause Analysis (RCA)

The root cause of this failure consists of three distinct protocol-level omissions:

1. **Lack of Runtime Wire-up in `chain/cmd/sovrad/main.go`:**
   In Phase 15.2, `ValidatorSchedule` and `VerifyCommitCertificateWithSchedule` were implemented in `chain/consensus/`. However, the running node entrypoint `chain/cmd/sovrad/main.go` was never modified to instantiate `ValidatorSchedule`. It retained static references to `canonicalValSet` constructed solely from `gen.Validators`.
2. **Missing In-Memory Schedule Registration:**
   The daemon had no code path that loaded recorded transitions from `app.GetValidatorTransitions()` into the consensus engine or vote pool.
3. **No Coordinated Node Cluster Restart:**
   The 4 running `sovrad` processes were spawned during Phase 10/11 and continued running continuously in the host background across subsequent phases without being restarted with updated binary logic.

---

## 4. Security Incident Classification

Under SOVRA Protocol Security Standards, this state is formally classified as:
**INCIDENT P15.4-SEC-01: UNMITIGATED RUNTIME VALIDATOR KEY EXPOSURE**

- **Severity:** High / Critical (Operational Network Integrity)
- **Scope:** Local testnet `sovra-testnet-0`
- **Impact:** The running network operated beyond the intended transition height using cryptographic keys that had been exposed in historical git commits prior to remediation.
- **Protocol Guarantee:** No funds were stolen, double-signing did not occur, and monetary supply remained strictly conserved ($30,000,000\text{ SOV}$). However, the blocks produced between 40,000 and 44,900+ were cryptographically signed by compromised keys.

---

## 5. Non-Negotiable Forensic Rules & Policy

1. **No Falsification of History:**  
   We strictly reject any proposal to retroactively rewrite, alter, re-sign, or falsify blocks 40,000–44,900+. In an immutable blockchain, history cannot be rewritten to match retroactive policy.
2. **No Falsified Upstream Claims:**  
   We do not claim that `sovra-testnet-0` transitioned at height 40,000. It did not.
3. **Forward Remediation Mandate:**  
   The consensus engine must be permanently remediated in source code, verified with live multi-node consensus test harnesses, and either forward-transitioned at a future height $H > 45,000$ or launched fresh on a dedicated recovery network.

---

*Certified as True and Accurate by the SOVRA Forensic Audit Team.*
