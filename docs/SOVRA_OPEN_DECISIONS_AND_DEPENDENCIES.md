# SOVRA — OPEN DECISIONS AND SYSTEM DEPENDENCIES

**Document ID:** `SOVRA-AUDIT-DOC-09`  
**Classification:** Product, Protocol, Economic & Governance Policy Register  
**Standard:** Unresolved Strategic Decisions & Dependency Tracking  
**Repository Working Directory:** `d:\Sovra`  
**Evaluation Date:** November 5, 2026  

---

## 1. Executive Summary

This register explicitly catalogs all **unresolved product, cryptographic, economic, and governance decisions** that cannot be implemented autonomously by engineering without executive stakeholder alignment. Treating unapproved proposals as finalized rules risks severe economic and legal liabilities.

---

## 2. Unresolved Cryptoeconomic & Protocol Decisions

### Decision ECO-01: Final Monetary Emission Curve & Duration
- **Current Ambiguity:** Three conflicting schedules exist in project artifacts and code:
  1. *Go Blockchain Code (`emission.go`):* 25-Year (9,125 daily epochs) geometric decay.
  2. *Confirmed Design Constraint:* 20-Year participation-based mining starting from Genesis.
  3. *Unapproved Proposal:* 4-Year Bitcoin-style declining halving schedule.
- **Impact:** Dictates daily minting allowances, validator rewards, and mining pool longevity.
- **Required Resolution:** Formal ratification of either the 20-year curve or a specific alternative before Genesis block initialization.

### Decision ECO-02: Exact Genesis Timestamp Anchor
- **Current Ambiguity:** Local testnets use transient system clock times. No canonical mainnet Genesis Unix timestamp has been selected.
- **Impact:** `ResolveEpoch(blockTime, genesisTime)` relies on this fixed point in time. Any post-launch modification would corrupt historical epoch allowances.
- **Required Resolution:** Selection of an exact UTC timestamp (e.g. `1773000000`) for the canonical Genesis block.

### Decision ECO-03: Proof-of-Usage 24-Hour Milestone Recurrence
- **Current Ambiguity:** Does the 24-hour verified eligible usage milestone act as:
  - *Option A (One-Time FTUX Unlock):* Once achieved, the account is permanently eligible to claim participation rewards across future epochs.
  - *Option B (Epoch-Bounded Active Requirement):* Users must maintain 24 verified hours during *every active 30-day epoch* to remain eligible for that epoch's distribution.
- **Impact:** Option A encourages one-time account activation farming; Option B requires continuous active user engagement.
- **Required Resolution:** Product policy determination on one-time vs. recurring PoU eligibility.

### Decision ECO-04: Handling of Unmined / Unclaimed Epoch Allocations
- **Current Ambiguity:** If the eligible user pool does not claim the full daily or monthly PoU emission quota, what happens to the residual tokens?
  - *Option A (Permanent Burn):* Unclaimed coins are burned, reducing lifetime issuance below 100M.
  - *Option B (Carry-Forward):* Unclaimed coins roll into the next epoch's pool.
  - *Option C (Community Treasury Escrow):* Held in `community_pool` governance custody.
- **Impact:** Directly affects token scarcity and inflation rates.
- **Required Resolution:** Economic governance policy adoption.

### Decision ECO-05: Commercial Ad Revenue Split Ratio
- **Current Ambiguity:**
  - *Code Reality (`database-engine.ts:16742`):* 95% creator / 5% platform / 0% burn + 2% unbacked referral mint.
  - *Vision Proposal:* 70% creator / 20% platform / 10% permanent burn.
- **Impact:** Dictates platform runway and deflationary velocity.
- **Required Resolution:** Ratification of the revenue split and formal deprecation of the 95/5/0 code default.

---

## 3. Unresolved Governance & Moderation Decisions

### Decision GOV-01: Government Censorship Appeals Quorum & Threshold
- **Current Ambiguity:** A proposed 66% juror supermajority has been proposed for political takedown appeals, but quorum parameters (minimum juror pool size, staking requirement, and appeal timelock duration) are unspecified.
- **Impact:** Low quorum allows Sybil voting rings to censor lawful political speech; excessively high quorum leads to deadlock.
- **Required Resolution:** Formalization of the Community Jury Charter defining exact quorum percentages ($Q \ge 100$ jurors) and voting windows (72 hours).

### Decision GOV-02: Multi-Admin Approval Policy & Emergency Kill-Switch
- **Current Ambiguity:** Phase 38 implemented the `ENGAGE FREEZE` kill-switch with single-admin authorization in SQLite. The target vision requires multi-admin threshold signatures (e.g. 3-of-5 anonymous admin keys) for system freezes or emergency code migrations.
- **Impact:** Single compromised admin credential could trigger a platform-wide freeze.
- **Required Resolution:** Implementation of multi-signature M-of-N threshold requirements for all sensitive console operations.

---

## 4. Unresolved Identity & Cryptographic Decisions

### Decision CRYP-01: Master Key Recovery Window & Guardian Inactivity Policy
- **Current Ambiguity:** `packages/identity/src/recovery.ts` implements a 72-hour timelock (`timelockSeconds = 259200`), but does not specify how guardian death or permanent offline status is handled if the threshold $M$ cannot be reached.
- **Impact:** Users could be permanently locked out if sufficient guardians become unresponsive.
- **Required Resolution:** Definition of guardian rotation policies and fallback dead-man's switch timelocks.

---

## 5. System Dependency Matrix

| Downstream Subsystem | Upstream Required Component | Blocking Dependency | Severity |
| :--- | :--- | :--- | :---: |
| **Proof-of-Usage Mining** | Client Heartbeat Ingestion | `TSK-P1-05` (Accumulators Table) | **BLOCKING** |
| **Signal Double Ratchet** | Prekey Ingress & Schema | `TSK-P0-05` (Curve25519 Keys) | **BLOCKING** |
| **Authoritative Balances** | L1 Node Supervisor Daemon | `TSK-P1-04` (sovrad Execution) | **BLOCKING** |
| **Multi-Validator Testnet** | 20-Year Emission Curve | `TSK-P1-03` (Constants Alignment) | **BLOCKING** |
| **Non-Inflationary Ads** | Supply Cap Enforcement | `TSK-P0-03` (Zero Registration Mint)| **BLOCKING** |
| **Resumable Chunk Uploads**| Ingress Auth Hardening | `TSK-P0-01` (Remove Header Bypass)| **BLOCKING** |
