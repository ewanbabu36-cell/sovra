# SOVRA PHASE 15.5 — CURRENT NETWORK FORENSIC AUDIT

**Date:** November 22, 2026  
**Auditor:** Independent Release Verification Authority  
**Repository:** `D:\Sovra`  
**Branch:** `main`  
**Baseline Commit:** `7dc7b7b` (Phase 15.4)  
**Target Subject:** Canonical Local Blockchain (`sovra-testnet-0`)

---

## 1. Executive Summary & Forensic Scope

Before altering any process or state in Phase 15.5, an independent zero-trust forensic audit was conducted on the running canonical SOVRA network in accordance with **Rule 1 (Preserve Evidence and Existing Chain State)**.

The audit verified the live operating state of the four canonical nodes running on loopback ports 26657–26687, recorded their process parameters, cryptographic state, height progression, commit certificate signatures, and financial supply invariants, and generated a complete offline backup prior to launching recovery operations.

---

## 2. Running Process Telemetry

The canonical network was observed running under four separate Go daemon processes (`sovrad.exe`) hosting the four genesis validator monikers:

| Node Moniker | Process ID (PID) | Executable Path | Working Set Memory | Command Line / Home Directory | RPC Port | P2P Port |
|---|---|---|---|---|---|---|
| `validator-0` | 12240 | `D:\Sovra\chain\sovrad.exe` | 69.7 MB | `start --home=chain/mytestnet/node0` | 26657 | 26656 |
| `validator-1` | 10176 | `D:\Sovra\chain\sovrad.exe` | 29.5 MB | `start --home=D:\Sovra\chain\mytestnet\node1` | 26667 | 26666 |
| `validator-2` | 5492 | `D:\Sovra\chain\sovrad.exe` | 29.3 MB | `start --home=D:\Sovra\chain\mytestnet\node2` | 26677 | 26676 |
| `validator-3` | 13196 | `D:\Sovra\chain\sovrad.exe` | 66.6 MB | `start --home=D:\Sovra\chain\mytestnet\node3` | 26687 | 26686 |

All four nodes were confirmed active, producing blocks continuously via P2P consensus.

---

## 3. Cryptographic State & Chain Invariants

At the initial forensic freeze (snapshot recorded in `phase15_5-current-network-forensics.json`):

- **Chain ID:** `sovra-testnet-0`
- **Observed Initial Height:** 47,823
- **Observed Height at Phase 15.5 Conclusion:** 52,389+
- **Genesis Block Time:** 1792070000 (Unix timestamp)
- **Total Supply Invariant:**
  - Initial observed supply: `30,055,743,296,028` uSOV (~30,055,743 SOV)
  - Lifetime mint: `30,055,743,296,028` uSOV
  - Lifetime burn: `0` uSOV
  - `supply_correct`: `true` across all four nodes
- **Height 50,000 Finding:** At initial audit inception, height was 47,823; height 50,000 had **not** yet been reached by the canonical daemon. As the canonical nodes continued running, height crossed 50,000 without a coordinated scheduled transition occurring because the running daemons were executing un-restarted Phase 15.3 binaries.

---

## 4. Commit Certificate Forensic Analysis

Inspection of blocks on `sovra-testnet-0` revealed two distinct eras:

1. **Blocks 0 to ~40,000 (Early Prototype Era):**
   - Blocks queried via `/block?height=H` have `last_commit: null`.
   - Blocks were produced by an early single-threaded prototype without commit certificates.
2. **Blocks 40,000 to 52,000+ (Phase 14 BFT Era):**
   - Blocks contain structured `last_commit` certificates signed with 100% voting power (4 signatures).
   - **Crucial Forensic Finding:** Every commit certificate in this era was signed using the **compromised genesis Ed25519 validator keys** (`val-0`: `sovra1x...`, `val-1`: `sovra1y...`, etc.) that were publicly leaked in early Git commits.
   - The running nodes had **not** executed a validator transition at height 40,000 or height 50,000.

This empirical finding conclusively demonstrates why `sovra-testnet-0` cannot be authorized for remote testnet deployment: its ledger history contains thousands of blocks signed by leaked keys.

---

## 5. Pre-Recovery Backup Verification

Prior to performing recovery operations, a non-destructive offline backup was created:

- **Backup Directory:** `D:\Sovra\backups\phase15_5_pre_recovery_backup`
- **Total Files Backdropped:** 82 files (including `genesis.json`, `config.json`, keystores, Pebble database logs, manifests, and tables across `node0`, `node1`, `node2`, `node3`).
- **Cryptographic Backup Manifest:** Written to `phase15_5-pre-recovery-backup-manifest.json` with individual SHA-256 digests for every file.
- **Ledger Invariant:** Zero historical blocks on `sovra-testnet-0` were erased, overwritten, or re-signed.
