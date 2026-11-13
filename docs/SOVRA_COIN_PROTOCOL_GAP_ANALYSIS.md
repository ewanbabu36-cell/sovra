# SOVRA — COIN AND MONETARY PROTOCOL GAP ANALYSIS

**Document ID:** `SOVRA-AUDIT-DOC-05`  
**Classification:** Cryptoeconomic Invariant & Monetary Protocol Audit  
**Standard:** Zero-Trust Financial Systems Audit Standard  
**Repository Working Directory:** `d:\Sovra`  
**Evaluation Date:** November 5, 2026  

---

## 1. Executive Summary

This document performs an exhaustive audit of the **SOVRA Coin Monetary Protocol**, contrasting confirmed protocol design constraints against the actual implementations across the Go blockchain (`chain/x/issuance`, `chain/x/bank`), SQLite relational schema (`database-migrations.ts`, `database-sqlite.ts`), and the active HTTP runtime (`dev-server.ts`).

### Confirmed Protocol Invariants
1. **Lifetime Supply Cap:** Exactly `100,000,000 SOVRA` (`100,000,000,000,000 uSOV`). Under no circumstance may total circulating coins + unminted reserves exceed this number.
2. **Participation-Based Mining (PoU):** 24 cumulative verified usage hours are strictly required before any mining reward eligibility can unlock. Computational Proof-of-Work is prohibited.
3. **Zero Advertising-Related Minting:** Advertiser escrow must be funded with existing coins; payouts and burns must settle atomically from that escrow.
4. **Permanent Deflationary Burns:** Burned coins are permanently destroyed and never reminted.
5. **No Arbitrary Admin Minting:** Administrator balances cannot be inflated outside consensus rules.

---

## 2. Invariant Reconciliation & Implementation Reality

| Invariant Requirement | Go Blockchain (`chain/`) | SQLite Database (`scripts/`) | Status & Discrepancy |
| :--- | :--- | :--- | :---: |
| **Max 100M Lifetime Cap** | `GlobalLifetimeCap = 100_000_000_000_000 uSOV` enforced in `x/issuance`. | `MAX_LIFETIME_SOV_CAP = 100_000_000` enforced in `database-sqlite.ts:6245`. | **BROKEN in DB:** User registration gives 500 SOV for free; deposits and referrals mint unconstrained tokens. |
| **Base-Unit Precision** | `usov` (integer micro-denominations: 1 SOV = 10^6 uSOV). Exact integer math. | `balance_sov REAL` (IEEE-754 64-bit float). | **INCONSISTENT:** SQLite floating-point arithmetic incurs rounding errors. |
| **Mining Duration** | 25 Years (9,125 daily epochs) hardcoded in `emission.go:16`. | Faucet route `claim` checks PoU gate; emission schedule unbuilt. | **PROTOCOL CONFLICT:** 25-year Cosmos code vs. 20-year target vision vs. proposed 4-year schedule. |
| **24-Hour Proof-of-Usage Gate** | Not yet modeled in Go ABCI application. | Fail-closed gate in `dev-server.ts:91250` returns HTTP 403. | **PARTIALLY VERIFIED:** Gate blocks claims, but 24h accumulation engine is 0% implemented. |
| **Ad Campaign Escrow & Burn** | `x/bank.BurnCoins()` burns from module account; updates total supply. | `database-engine.ts:16742` splits 95% creator / 5% platform / 0% burn / 2% unbacked mint. | **BROKEN:** 0% burn executed; inflationary referral minting. |
| **Public Supply Auditability** | `sovrad query supply` returns bank supply and pool reserves. | `GET /api/admin/sovra-supply` returns SQLite sum. | **UNCOUPLED:** Two independent supply totals that do not match. |

---

## 3. Detailed Audit of Coin Issuance & Minting Paths

### Path 1: User Registration Grant (P0 Defect)
- **Code Location:** `scripts/database-migrations.ts:55`, `scripts/database-engine.ts:3062`, `scripts/database-engine.ts:3144`
- **Mechanism:** When a user registers via `POST /api/auth/register`, the database schema defaults `balance_sov` to `500.0`, and the engine sets `balanceSov: 500.0`.
- **Flaw:** This creates 500 SOV out of thin air without deducting from any Genesis reserve pool or checking `MAX_LIFETIME_SOV_CAP`. At 200,001 users, the 100M cap is silently breached.

### Path 2: Administrative Balance Adjustment
- **Code Location:** `scripts/database-sqlite.ts:6245-6300` (`adjustUserBalanceWithAudit`)
- **Mechanism:** Validates `(currentTotalSupply + amount) <= MAX_LIFETIME_SOV_CAP` within an exclusive SQLite transaction, checks financial idempotency keys, and logs to `audit_ledger`.
- **Status:** **Secure within SQLite**, but exposed via unauthenticated route `/api/admin/user/adjust-balance` (as documented in `AUTH-P0-02`).

### Path 3: Mining Faucet / Claim Route
- **Code Location:** `scripts/dev-server.ts:91250-91300` (`/api/wallet/faucet/claim`)
- **Mechanism:** Computes system supply, verifies cap, checks user usage accumulator.
- **Status:** **Fail-Closed Verified.** Rejects any request when `verifiedUsageHours < 24` with HTTP 403 `Proof-of-Usage Invariant Failed`.

### Path 4: Referral Rewards (P0 Defect)
- **Code Location:** `scripts/routes/referral.routes.ts:233, 247`, `scripts/database-engine.ts:16757`
- **Mechanism:** When a referred user activates, the system credits `+50 SOV` and `+25 SOV` to referrer and referee; during ad release, it credits `+2%` to referrer.
- **Flaw:** These bonuses are minted as unconstrained balance increments without cap checks or escrow deductions.

### Path 5: L1 Blockchain Consensus Issuance (`chain/x/issuance`)
- **Code Location:** `chain/x/issuance/keeper/keeper.go:1-120`
- **Mechanism:** Triggered at each block header transition via ABCI `BeginBlock()`. Resolves epoch from `blockTime - genesisTime`. If `epoch <= 9125`, mints daily allowance to `validator`, `community`, and `seeder` pools in strict integer `uSOV` at a 2:4:1 ratio.
- **Status:** **Cryptographically sound**, but completely idle because the daemon is not running.

---

## 4. Proof-of-Usage (PoU) Architecture & Anti-Sybil Reality

### 4.1 Target Specification
- Users must accumulate **24 verified eligible usage hours** before unlocking token mining rewards.
- Usage must be participation-driven (viewing verified content, relaying mesh packets, participating in governance).
- Anti-Sybil validation must incorporate hardware-backed attestation (WebAuthn / Secure Enclave) and Bluetooth Low Energy proximity co-witnessing.

### 4.2 Current Repository Reality
1. **The Fail-Closed Gate:** Active on `/api/wallet/faucet/claim` (returns HTTP 403 if hours < 24).
2. **Usage Accumulator Database Table:** `user_usage_accumulators` is **MISSING**.
3. **Client Heartbeat Daemon:** No background client task exists in `apps/sovra-app` to emit 60-second ping beacons.
4. **BLE Witness Verification:** BLE mesh frames exist in `ble-mesh-engine.ts`, but no cryptographic witness attestation pipeline exists to translate BLE co-presence into verified usage hours.
5. **Conclusion:** PoU tracking is **0% implemented** beyond the rejection gate.

---

## 5. Monetary Emission Schedule Conflict Analysis

A major architectural discrepancy exists across the project documentation and codebase regarding the token emission schedule:

```
[Target Vision Blueprint]       [Go Blockchain Implementation]       [Proposed Economic Draft]
       20 Years                             25 Years                             4 Years
  Participation Mining               9,125 Daily Epochs                    Declining Halving
  (Unspecified Curve)               Exact 2:4:1 Pool Ratio               (Unfinalized Proposal)
```

### 5.1 The Go Blockchain Schedule (`chain/x/issuance/types/emission.go`)
- **Total Epochs:** 9,125 (exactly 25 years × 365 days).
- **Pool Breakdown:**
  - Genesis Pool: `30,000,000 SOV` (Instant allocation)
  - Community Pool: `40,000,000 SOV` (Decaying daily distribution)
  - Validator Pool: `20,000,000 SOV` (Decaying daily distribution)
  - Seeder / PoU Pool: `10,000,000 SOV` (Decaying daily distribution)
- **Recurrence Relation:** `S[y] = (S[y-1]*189 + 100) / 200` (5.5% annual decay). Year 25 absorbs the exact residual dust down to 1 `uSOV`.

### 5.2 The 20-Year Blueprint Constraint
The user requirements explicitly state:
- "Treat as confirmed design constraint: Mining duration: 20 years starting from official Genesis timestamp."
- "A proposed four-year declining emission schedule exists, but it is not yet a finalized protocol decision. Do not silently treat it as approved."

### 5.3 Required Resolution Strategy
The Go codebase must be adjusted to map the `100,000,000 SOV` cap over **7,300 daily epochs (20 years × 365 days)** rather than 9,125 epochs, recalculating the annual seeder schedule array while preserving integer `uSOV` precision.

---

## 6. Unresolved Protocol Decisions

The following economic parameters remain unfinalized and require executive governance determination before Genesis launch:

1. **Exact Genesis Timestamp:** No official Unix epoch anchor has been selected (currently uses placeholder testnet timestamps).
2. **Final Emission Epoch Cadence:** Whether rewards are minted daily (86,400s), weekly (604,800s), or monthly.
3. **PoU 24-Hour Milestone Interpretation:**
   - Option A: A one-time FTUX account activation requirement.
   - Option B: A recurring threshold (e.g. 24 hours of active participation required per 30-day epoch to qualify for ongoing mining shares).
4. **Unclaimed Mining Allocation Handling:** Whether unmined rewards in an epoch expire (burned), roll forward into the next epoch pool, or remain in escrow indefinitely.
5. **Mining Reward Distribution Curve:** How active daily reward pools are divided among eligible users (pro-rata by verified hours vs. equal distribution among qualified accounts).
6. **Key Custody & Recovery Policy:** Threshold M-of-N parameters and timelocks for lost-key recovery without admin intervention.

---

## 7. Supply Explorer & Public Auditability Assessment

### 7.1 Current Explorer Endpoints
- `GET /api/admin/sovra-supply`: Returns live SQLite aggregation:
  ```json
  {
    "ok": true,
    "supply": {
      "totalUserBalancesSov": 1775944.5,
      "treasuryReserveSov": 8,
      "totalSystemAccountingSov": 1775952.5,
      "maxLifetimeCapSov": 100000000,
      "remainingMintableSov": 98224047.5,
      "isWithinCap": true
    }
  }
  ```
- `scripts/blockchain-explorer.ts`: Exposes UI dashboard on `/explorer`, displaying block heights, validator lists, and transaction hashes.

### 7.2 Deficiencies
1. Explorer queries local memory or SQLite rather than querying Merkle state roots from `chain/sovrad.exe`.
2. No zero-knowledge supply proof (e.g. Bulletproofs or Merkle sum tree) is published to prove circulating supply without exposing individual user balances.
3. Public explorer lacks permanent burn transaction tracking (`sov_burn_tx`).

---

## 8. Immediate Implementation Imperatives

1. **IMPERATIVE #1 (P0):** Set default registration balance in SQLite to `0.0 SOV` and eliminate unbacked referral minting.
2. **IMPERATIVE #2 (P0):** Route all coin creations through an atomic, centralized `issueTokens()` method enforcing the 100M cap globally.
3. **IMPERATIVE #3 (P1):** Recalculate Go emission constants in `chain/x/issuance` from 25 years (9,125 epochs) to exactly 20 years (7,300 epochs).
4. **IMPERATIVE #4 (P1):** Build the client heartbeat ingestion route and `user_usage_accumulators` SQLite table to make PoU functional.
