# SOVRA PHASE 15.5 — NETWORK STABILITY & FAULT-TOLERANCE REPORT

**Date:** November 22, 2026  
**Auditor:** Independent Release Verification Authority  
**Repository:** `D:\Sovra`  
**Network:** `sovra-recovery-1`  
**Evidence Artifact:** `phase15_5-sustained-stability-evidence.json`  
**Test Script:** `scripts/verify-sustained-stability.ts`

---

## 1. Executive Summary

A critical requirement of Phase 15.5 is proving that the recovered four-node consensus network is not merely compiling or passing unit tests, but operates with sustained Byzantine fault tolerance under continuous execution and partial network failure.

This report documents the results of:
1. **50-block continuous telemetry audit** under normal four-node operation.
2. **3-of-4 BFT fault-tolerance stress test** (1 node offline, 75% voting power).
3. **Dynamic restart catchup & state resynchronization** upon node reactivation.

---

## 2. 50-Block Continuous Telemetry Audit

Telemetry was collected across 50 consecutive blocks finalized between block 206 and block 255:

- **Total Consecutive Blocks Finalized:** 50
- **Start Height:** 206 | **End Height:** 255
- **Commit Certificate Quorum Power:** 100 / 100 (100.0%) on every single block.
- **Proposer Distribution:**
  - `validator-0`: 12 blocks (24.0%)
  - `validator-1`: 13 blocks (26.0%)
  - `validator-2`: 13 blocks (26.0%)
  - `validator-3`: 12 blocks (24.0%)
  - Demonstrates exact CometBFT deterministic round-robin proposer rotation.
- **Block Production Interval:** Average ~1.05 seconds per block with zero missed rounds.
- **AppHash Progression:** Deterministic cryptographic chain with zero orphan blocks or state rollbacks.

---

## 3. Byzantine Fault Tolerance (3-of-4 Operation)

At block 259, an intentional outage drill was executed to test the BFT threshold:
- **Node Terminated:** `validator-3` (PID 19276, listening on port 26787).
- **Cluster State:** 3 nodes online (`validator-0`, `validator-1`, `validator-2`).
- **Active Voting Power:** 75 / 100 (75.0%), strictly exceeding the BFT supermajority threshold of $2/3+1$ ($> 66.7\%$).

### Empirical Results:
1. **Consensus Continuity:** Consensus did **not** stall.
2. **Blocks Finalized Without Node 3:** 6 blocks produced (height advanced from 259 to 265).
3. **Commit Certificate Power:** The commit certificates for blocks produced during the outage contained exactly 3 valid signatures with accumulated power = 75/100 (75.0%).
4. **Round Fallback:** When `validator-3` was scheduled to propose at Round 0, the online validators detected the 4-second timeout, advanced to Round 1, selected `validator-0` as fallback proposer, and finalized the block with 75% quorum power.

---

## 4. Node Restart Catchup & State Resynchronization

Following the fault-tolerance drill, `validator-3` was restarted using `sovrad_v15_5.exe`:

- **Restart Attempt 1:** `validator-3` re-established P2P peering with `validator-0`, `validator-1`, and `validator-2`.
- **Fast-Sync Triggered:** Queried peer block heights (network height: 268).
- **Block Playback:** Replayed missing blocks 260 through 268 via P2P switch.
- **Catchup Latency:** Node 3 caught up to the network height of 268 on **Attempt 1** (< 2 seconds).
- **State Reconciliation:** Node 3 computed the exact identical AppHash (`101c73171e62e3f84a8ef0529b2b41f8ab0ce99487ea6a7ceea23fce004ce9a9`) as the rest of the cluster.
- **Quorum Restoration:** Subsequent block 269 finalized with 100/100 (100.0%) quorum power across all four nodes.

---

## 5. Stability Audit Conclusion

| Stability Metric | Required Specification | Observed Result | Status |
|---|---|---|---|
| Continuous Block Finality | $\ge 50$ blocks | 50 blocks audited | **MET** |
| Normal Commit Quorum Power | $100\%$ | $100/100$ ($100.0\%$) | **MET** |
| 1-Node Failure Fault Tolerance | Continuous production $\ge 67\%$ | 6 blocks produced @ $75\%$ power | **MET** |
| Dynamic Round Fallback | Round advance upon timeout | Round 1 fallback proposer succeeded | **MET** |
| Restart Resync Latency | Catchup without state desync | Synchronized on Attempt 1 | **MET** |
| Post-Recovery State Equality | Exact AppHash match across cluster | 100% byte-for-byte match | **MET** |
