# Sovra L1 — On-Chain CosmWasm Creator Revenue-Sharing Split Guide

> **Module**: `x/wasm`  
> **Contract Standard**: `CW-Split-v1`  
> **Target Asset**: Native `uSOV` integer base units (`1 SOVRA = 10^18 base units`)

---

## 1. Overview & Problem Statement

Traditional creator economies rely on centralized platforms (e.g. YouTube, Spotify, Patreon) that take 15%–45% commissions and delay payouts by 30–60 days. In contrast, Sovra Layer 1 integrates on-chain **CosmWasm Creator Revenue Splits** directly into the state machine:

- **Instant Atomic Settlement**: When supporters, DAOs, or automated streaming protocols send funds, the smart contract immediately emits atomic `Bank.Send` submessages to distribute earnings directly to all collaborators.
- **Zero Platform Cut**: 100% of the funds go to the creators and their chosen team members.
- **Strict Integer Conservation**: No floating-point roundoff errors. Any dust remainder resulting from integer division is deterministically allocated to the primary creator, preserving master ledger invariants.
- **Spam Defense**: Enforces a configurable `MinPayout` threshold (in `uSOV`) to protect recipients from un-economical dust transactions.
- **Secure Access Control**: Only designated creator admin keys can modify recipient weight distributions or transfer administration.

---

## 2. Smart Contract Message Schema

### 2.1 Instantiate Message (`SplitInstantiateMsg`)
Initializes a new revenue split contract.
```json
{
  "admin": "sovra1creator_alice...",
  "title": "Podcast Co-Hosts & Sound Producer Split",
  "recipients": [
    { "address": "sovra1creator_alice...", "weight": 7000 },
    { "address": "sovra1cohost_bob...",    "weight": 2000 },
    { "address": "sovra1producer_charlie","weight": 1000 }
  ],
  "min_payout": "100"
}
```
* `weight`: Relative share weight (e.g., basis points where 7,000 / 10,000 = 70.00%, or arbitrary proportional integers).
* `min_payout`: Minimum distributable amount in `uSOV`.

---

### 2.2 Execution Messages

#### A. Distribute Revenue (`distribute`)
Executed by supporters, tippers, or monetization aggregators with attached `uSOV` funds:
```json
{
  "distribute": {}
}
```
*The contract divides the attached funds proportionally according to recipient weights, creates atomic `Bank.Send` submessages, updates cumulative earnings, and deposits remainder dust into the primary recipient's account.*

#### B. Update Recipients (`update_recipients`)
Admin-only. Updates recipient addresses and weight proportions:
```json
{
  "update_recipients": {
    "recipients": [
      { "address": "sovra1creator_alice...", "weight": 5000 },
      { "address": "sovra1cohost_bob...",    "weight": 5000 }
    ]
  }
}
```

#### C. Transfer Admin (`update_admin`)
Admin-only. Hands off management to a new creator or multi-sig DAO address:
```json
{
  "update_admin": {
    "new_admin": "sovra1dao_treasury..."
  }
}
```

---

### 2.3 Query Messages

#### A. Contract Configuration (`config`)
```json
{ "config": {} }
```
**Response:**
```json
{
  "admin": "sovra1creator_alice...",
  "title": "Podcast Co-Hosts & Sound Producer Split",
  "recipients": [
    { "address": "sovra1creator_alice...", "weight": 7000 },
    { "address": "sovra1cohost_bob...", "weight": 2000 },
    { "address": "sovra1producer_charlie", "weight": 1000 }
  ],
  "total_weight": 10000,
  "min_payout": "100",
  "total_distributed": "10000000"
}
```

#### B. Recipient Share & Earnings (`recipient_share`)
```json
{
  "recipient_share": {
    "address": "sovra1cohost_bob..."
  }
}
```
**Response:**
```json
{
  "address": "sovra1cohost_bob...",
  "is_recipient": true,
  "weight": 2000,
  "total_weight": 10000,
  "percentage_bps": 2000,
  "total_earned_usov": "2000000"
}
```

#### C. Simulate Distribution (`simulate_distribute`)
Simulates how an amount will be divided prior to committing a transaction:
```json
{
  "simulate_distribute": {
    "amount": "10000000"
  }
}
```
**Response:**
```json
{
  "distributable_amount": "10000000",
  "payouts": [
    { "address": "sovra1creator_alice...", "amount": "7000000" },
    { "address": "sovra1cohost_bob...", "amount": "2000000" },
    { "address": "sovra1producer_charlie", "amount": "1000000" }
  ]
}
```

---

## 3. CLI Quickstart (`sovrad wasm split`)

The `sovrad` binary provides dedicated CLI subcommands for split operations:

### 1. Initialize a Split Contract
```bash
# Instantiate a 70/20/10 split between Alice, Bob, and Charlie
sovrad wasm split init alice "Music Video Production Split" \
  "sovra1alice:7000,sovra1bob:2000,sovra1charlie:1000" \
  --code-id 1 \
  --min-payout 100
```

### 2. Distribute Revenue to the Split Pool
```bash
# Supporter distributes 10,000,000 uSOV (10 SOVRA)
sovrad wasm split distribute dave sovra1contract456... 10000000
```

### 3. Query Real-Time Configuration & Stats
```bash
# Query full pool status
sovrad wasm split query sovra1contract456...

# Query specific contributor's earnings
sovrad wasm split query sovra1contract456... recipient sovra1bob...
```

### 4. Simulate Payout Division
```bash
# Preview payout breakdown for 500,000 uSOV
sovrad wasm split simulate sovra1contract456... 500000
```

---

## 4. Automated Test Verification

The split contract implementation is covered by unit, storage, and full blockchain lifecycle tests:
* [`chain/x/wasm/vm/cw_split.go`](file:///d:/Sovra/chain/x/wasm/vm/cw_split.go) — Contract execution and query logic.
* [`chain/x/wasm/split_test.go`](file:///d:/Sovra/chain/x/wasm/split_test.go) — VM-level tests for distributions, dust remainder conservation, and admin security.
* [`chain/x/wasm/split_app_test.go`](file:///d:/Sovra/chain/x/wasm/split_app_test.go) — End-to-end full blockchain application tests verifying atomic multi-party account balances on the live state machine.
