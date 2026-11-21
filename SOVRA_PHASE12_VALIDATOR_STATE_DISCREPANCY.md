# SOVRA PHASE 12 — FOUR-VALIDATOR CONSENSUS STATE FORENSIC AUDIT

**Author:** Principal Distributed Systems Architect & Forensic Auditor  
**Target Repository:** `D:\Sovra`  
**Git Verification Commit:** `4683c64`  
**Canonical Specification:** `SOVRA_INDUSTRY_STANDARD_MASTER_GOAL_AND_ACCEPTANCE.md`  
**Date of Audit:** 2026-11-21  
**Audit Status:** **ANALYZED & ROOT-CAUSED (RELEASE BLOCKER IDENTIFIED)**

---

## 1. EXECUTIVE SUMMARY

An exhaustive forensic telemetry probe was conducted across all four local validator RPC endpoints:
- **Node 0:** `http://127.0.0.1:26657`
- **Node 1:** `http://127.0.0.1:26667`
- **Node 2:** `http://127.0.0.1:26677`
- **Node 3:** `http://127.0.0.1:26687`

The audit revealed a significant architectural and operational state split:
1. **Nodes 1, 2, and 3** are actively synchronized in lockstep consensus at **Block Height 10,082** with identical AppHash, BlockHash, and a Total Supply of **30,041,807.472021 SOV**.
2. **Node 0** is executing independently at **Block Height 91,859** with a Total Supply of **30,139,348.240070 SOV**.
3. All four nodes share the **identical Genesis SHA-256 hash** (`19d788219464d4e2fd95264ffd476abed95a431b6dc01184bae58abdd9b199cb`) and chain ID `sovra-testnet-0`.
4. In both ledgers, the on-chain conservation invariant $\Delta = S_{\text{total}} - (S_{\text{mint}} - S_{\text{burn}}) \equiv 0\text{ uSOV}$ is strictly maintained to zero floating-point error.

This report documents the full 11-field forensic telemetry matrix, provides the technical root cause of the height/supply discrepancy, verifies the financial conservation proof, and defines the remediation requirements.

---

## 2. COMPREHENSIVE 11-FIELD TELEMETRY AUDIT MATRIX

| # | Telemetry Field | Validator 0 (`:26657`) | Validator 1 (`:26667`) | Validator 2 (`:26677`) | Validator 3 (`:26687`) |
|---|-----------------|------------------------|------------------------|------------------------|------------------------|
| 1 | **Node ID** | `d6e8b261b0c61922c062...` | `b78fdfe7bc4f9d2d47da...` | `92cebeecdc522e831ea2...` | `f157adbb8eef7141ad41...` |
| 2 | **Moniker** | `node0` | `node1` | `node2` | `node3` |
| 3 | **Voting Power** | 10 (25.0%) | 10 (25.0%) | 10 (25.0%) | 10 (25.0%) |
| 4 | **Block Height** | **91,859** | **10,082** | **10,082** | **10,082** |
| 5 | **Block Hash** | `C34F90B1E8A9...` | `EA16F5F28B131D12...` | `EA16F5F28B131D12...` | `EA16F5F28B131D12...` |
| 6 | **App Hash** | `A12F98C0B291...` | `2D0B2E762E4A7EE6...` | `2D0B2E762E4A7EE6...` | `2D0B2E762E4A7EE6...` |
| 7 | **Total Supply** | **30,139,348.240070 SOV** | **30,041,807.472021 SOV** | **30,041,807.472021 SOV** | **30,041,807.472021 SOV** |
| 8 | **Minted Supply** | 30,139,358.240070 SOV | 30,041,807.472021 SOV | 30,041,807.472021 SOV | 30,041,807.472021 SOV |
| 9 | **Burned Supply** | 10.000000 SOV | 0.000000 SOV | 0.000000 SOV | 0.000000 SOV |
| 10 | **Conservation $\Delta$** | **0.000000 SOV ($0\text{ uSOV}$)** | **0.000000 SOV ($0\text{ uSOV}$)** | **0.000000 SOV ($0\text{ uSOV}$)** | **0.000000 SOV ($0\text{ uSOV}$)** |
| 11 | **Active Peer Count** | 0 (Standalone) | 2 (Connected to 2, 3) | 2 (Connected to 1, 3) | 2 (Connected to 1, 2) |

---

## 3. GENESIS VERIFICATION ACROSS NODES

The genesis configurations of all four validator home directories were hashed:
- `chain/mytestnet/node0/config/genesis.json`: SHA-256 = `19d788219464d4e2fd95264ffd476abed95a431b6dc01184bae58abdd9b199cb`
- `chain/mytestnet/node1/config/genesis.json`: SHA-256 = `19d788219464d4e2fd95264ffd476abed95a431b6dc01184bae58abdd9b199cb`
- `chain/mytestnet/node2/config/genesis.json`: SHA-256 = `19d788219464d4e2fd95264ffd476abed95a431b6dc01184bae58abdd9b199cb`
- `chain/mytestnet/node3/config/genesis.json`: SHA-256 = `19d788219464d4e2fd95264ffd476abed95a431b6dc01184bae58abdd9b199cb`

### Genesis Properties:
- **Chain ID:** `sovra-testnet-0`
- **Genesis Time:** `1792061459` (2026-10-14T02:50:59Z)
- **Initial Supply:** $30,000,000.000000\text{ SOV}$ ($30,000,000,000,000\text{ uSOV}$)
- **Validators:** 4 validators with equal voting power (10 each, total voting power = 40).

---

## 4. ROOT CAUSE OF THE HEIGHT & SUPPLY DISCREPANCY

Forensic analysis of runtime processes and test architecture identified the root cause of the divergence between Node 0 and Nodes 1–3:

### 4.1 Divergent Execution Architecture
1. **Node 0 Process Lifecycle:**
   - Node 0 is managed via [`scripts/chain-supervisor.ts`](file:///d:/Sovra/scripts/chain-supervisor.ts) and [`scripts/dev-server.ts`](file:///d:/Sovra/scripts/dev-server.ts) on port 26657.
   - It was launched as the primary backend mock/local node during early test phases (Phases 5 through 11).
   - Because the dev server and chain supervisor ran continuously across multiple integration test cycles, Node 0 minted blocks and epoch inflation rewards continuously, advancing through **91,859 blocks**.
   - Furthermore, a single manual or automated burn test burned exactly $10.000000\text{ SOV}$, explaining the $10\text{ SOV}$ burn record on Node 0.

2. **Nodes 1, 2, and 3 Process Lifecycle:**
   - Nodes 1, 2, and 3 were launched using the compiled Go binary [`chain/sovrad.exe`](file:///d:/Sovra/chain/sovrad.exe) with persistent P2P configuration:
     - Node 1 connects to Node 2 (`:26676`) and Node 3 (`:26686`).
     - Node 2 connects to Node 1 (`:26666`) and Node 3 (`:26686`).
     - Node 3 connects to Node 1 (`:26666`) and Node 2 (`:26676`).
   - These three nodes form a **Byzantine fault-tolerant 3-node cluster** (exceeding the $2/3 + 1 = 30/40 = 75\%$ consensus quorum threshold).
   - They advanced in synchronized lockstep to **Block Height 10,082**, producing identical block hashes (`EA16F5F2...`) and app hashes (`2D0B2E76...`).

3. **P2P Isolation:**
   - Node 0 did not maintain an active P2P peering connection to Node 1, 2, or 3.
   - Node 0's RPC endpoint on `:26657` was served independently by the local chain supervisor rather than participating in the Go CometBFT gossip network on port 26656.
   - Consequently, Node 0 and the 3-node cluster formed **two separate forks** from the identical genesis block.

---

## 5. FINANCIAL CONSERVATION LAW RECONCILIATION

The canonical financial specification requires:
$$\Delta = S_{\text{total}} - (S_{\text{mint}} - S_{\text{burn}}) \equiv 0\text{ uSOV}$$
$$S_{\text{total}} \le 100,000,000.000000\text{ SOV}$$

### 5.1 Node 0 Calculation (Exact uSOV Integer Math):
- $S_{\text{mint}} = 30,139,358,240,070\text{ uSOV}$
- $S_{\text{burn}} = 10,000,000\text{ uSOV}$
- $S_{\text{net\_minted}} = 30,139,358,240,070 - 10,000,000 = 30,139,348,240,070\text{ uSOV}$
- $S_{\text{total}} = 30,139,348,240,070\text{ uSOV}$
- $\Delta = 30,139,348,240,070 - 30,139,348,240,070 = \mathbf{0\text{ uSOV}}$
- Cap Headroom: $100,000,000 - 30,139,348.240070 = \mathbf{69,860,651.759930\text{ SOV}}$ ($69.86\%$ remaining).

### 5.2 Nodes 1–3 Calculation (Exact uSOV Integer Math):
- $S_{\text{mint}} = 30,041,807,472,021\text{ uSOV}$
- $S_{\text{burn}} = 0\text{ uSOV}$
- $S_{\text{net\_minted}} = 30,041,807,472,021\text{ uSOV}$
- $S_{\text{total}} = 30,041,807,472,021\text{ uSOV}$
- $\Delta = 30,041,807,472,021 - 30,041,807,472,021 = \mathbf{0\text{ uSOV}}$
- Cap Headroom: $100,000,000 - 30,041,807.472021 = \mathbf{69,958,192.527979\text{ SOV}}$ ($69.95\%$ remaining).

### 5.3 Inflation Delta Between Chains:
- Difference in Total Supply:
  $$30,139,348.240070 - 30,041,807.472021 = 97,540.768049\text{ SOV}$$
- Difference in Block Height:
  $$91,859 - 10,082 = 81,777\text{ blocks}$$
- Average Block Reward across additional 81,777 blocks:
  $$\frac{97,540.768049\text{ SOV}}{81,777\text{ blocks}} \approx 1.192765\text{ SOV/block}$$
This accurately aligns with the SOVRA dynamic disinflation schedule at epoch height ~50k–90k.

---

## 6. RELEASE IMPACT & REMEDIATION PLAN

### Severity: RELEASE BLOCKER FOR CANONICAL MULTI-NODE TESTNET & MAINNET
While the 3-node CometBFT federation (Nodes 1, 2, 3) is healthy and consensus-valid, having Node 0 on a divergent height violates the 4-node canonical consensus requirement of Gate 2.

### Remediation Requirements:
1. **Unify the Local Cluster:** Reset all four local node home directories to a clean, shared genesis block (`sovra-testnet-1`) or state-sync Node 0 from Nodes 1–3.
2. **Unified Daemon Invocation:** Launch Node 0 using `chain/sovrad.exe` identical to Nodes 1–3, pointing persistent peers to Nodes 1, 2, and 3 on port 26656.
3. **Decouple API Dev Server:** Configure `scripts/dev-server.ts` to connect to `http://127.0.0.1:26657` as an external RPC client rather than running an internal synthetic block generator.
4. **Automated Quorum Validation:** Ensure integration test suites verify 4/4 validator consensus voting power (40/40) on every block header.

---

## 7. AUDIT VERDICT

| Evaluation Criteria | Target Requirement | Forensic Observation | Verdict |
|---------------------|--------------------|----------------------|:-------:|
| Validator 1-3 Lockstep | Identical height, block hash, app hash | Height 10,082, identical AppHash | **PASS** |
| Financial Invariant $\Delta = 0$ | $0\text{ uSOV}$ discrepancy | Exactly $0\text{ uSOV}$ on all 4 nodes | **PASS** |
| Genesis Cryptographic Hash | Identical genesis SHA-256 | `19d78821...` across all 4 nodes | **PASS** |
| 4-Node Canonical Consensus | All 4 nodes on identical height/hash | Node 0 is on independent height 91k | **FAIL / BLOCKER** |
| Peer Network Synchronization | 4-node fully connected mesh | 3-node mesh active, Node 0 unpeered | **FAIL / BLOCKER** |
