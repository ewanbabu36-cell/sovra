# SOVRA PHASE 15.2 — FORENSIC AUDIT & STATE INTEGRITY BASELINE

**Author:** Principal Consensus Protocol Architect & Lead Cryptographic Security Auditor  
**Repository:** `D:\Sovra`  
**Baseline Commits:** `2f3e017` (Phase 14) $\to$ `c40011b` (Phase 15) $\to$ `3864380` (Phase 15.1)  
**Date:** November 22, 2026  
**Classification:** MANDATORY PRE-REMEDIATION AUDIT — ZERO-RESET PROTOCOL  
**Backup Provenance:** 
- Git Bundle: `D:\Sovra-backup-pre-phase15_2.bundle` (SHA-256 verified)
- Bare Mirror: `D:\Sovra-backup-pre-phase15_2.git`

---

## 1. EXECUTIVE SUMMARY & PHASE 15.2 MANDATE

The Zero-Trust Audit conducted in Phase 15.1 definitively proved that while the Phase 14 Byzantine Fault Tolerant (BFT) consensus logic and test suites are mathematically sound (100% pass rate across 20 suites, 197/197 tests), critical security gaps exist in key custody and repository history:
1. **Compromised Validator Private Keys:** The original four validator private keys were committed to Git history in plaintext (`chain/mytestnet/node*/validator*.key.json`), making them permanently compromised across public forks and clones.
2. **Software-Only HSM Masquerade:** `chain/privval/hsm.go` implemented an in-memory Go struct holding plaintext Ed25519 private keys in process heap memory while claiming to provide CloudHSM / YubiHSM hardware isolation.
3. **Reachable Git Objects on Main:** The actual `main` branch DAG was not rewritten, leaving historical plaintext key blobs accessible via Git object traversal.

**The Phase 15.2 Mandate:** Remediate all security findings, execute a protocol-compliant validator identity rotation and revocation ceremony, implement a genuine hardware-ready signing architecture, rewrite Git history with full backup preservation, and verify complete financial and consensus continuity.

---

## 2. RULE 1 — PRESERVATION OF THE EXISTING BLOCKCHAIN STATE

In strict accordance with **Rule 1**, the active blockchain state is preserved. The blockchain is **not** reset, the genesis block is **not** wiped, and historical accounts are **not** altered.

### Audited Chain State Baseline:
- **Chain ID:** `sovra-testnet-0`
- **Active Consensus Height:** $36,159+$ blocks
- **Consensus AppHash:** `30dca207387e8d2d2d024c8be1c51d294891cf3458924354228a3c87a26a8172`
- **Total Coin Supply:** $30,000,000,000,000\text{ uSOV}$ ($30,000,000\text{ SOV}$)
- **Account Ledger Balances:**
  - `sovra12a806ca82d506a025d580d40600abc77a69e10e7`: $7,500,000,000,000\text{ uSOV}$
  - `sovra1664a83c922035ce28bb723e4e92aed1e60e26ea1`: $7,500,000,000,000\text{ uSOV}$
  - `sovra1cb55be9a3d2afab1c9bcbffb88367bec797d11cb`: $7,500,000,000,000\text{ uSOV}$
  - `sovra1d96f6140a4c4ae797d9e3a5badf467eb756d3d20`: $7,500,000,000,000\text{ uSOV}$
  - **Sum:** $\sum \text{Balances} = 30,000,000,000,000\text{ uSOV}$ ($\text{Supply Equation: Exact Match}$).
- **Historical Commit Certificate Continuity:** Every block from Height $1$ to current height has been cryptographically committed by the authorized consensus quorum. These historical certificates must remain verifiable by light clients and syncing nodes.

---

## 3. AUDIT OF COMPROMISED VALIDATOR IDENTITIES

The four genesis validator identities whose private keys were exposed in commits `9bc310b` and `50b9c46` are formally enumerated below:

| Moniker | Address | Ed25519 Public Key Hex | Historical Exposure File | Status |
| :--- | :--- | :--- | :--- | :--- |
| `validator-0` | `sovra12a806ca82d506a025d580d40600abc77a69e10e7` | `50dec499bc1281f64488a3ca9500c9c1a4eea67f5147af0450ee0deebf8601be` | `chain/mytestnet/node0/validator-0.key.json` | **COMPROMISED — TO BE REVOKED** |
| `validator-1` | `sovra1664a83c922035ce28bb723e4e92aed1e60e26ea1` | `a81cd7b53eb1edcfc9abce54679faf08ccaa002bd5898b63431f29cc964e67e3` | `chain/mytestnet/node1/validator-1.key.json` | **COMPROMISED — TO BE REVOKED** |
| `validator-2` | `sovra1cb55be9a3d2afab1c9bcbffb88367bec797d11cb` | `d6cbcf5c5acf4688995801c2993a53f4c5ff164bd897362909fb2f1a5ede7724` | `chain/mytestnet/node2/validator-2.key.json` | **COMPROMISED — TO BE REVOKED** |
| `validator-3` | `sovra1d96f6140a4c4ae797d9e3a5badf467eb756d3d20` | `b5fc366f668f7d6dfc43a9b2942895ccb9e4eea5d7b1ca46f1e8c710347977ec` | `chain/mytestnet/node3/validator-3.key.json` | **COMPROMISED — TO BE REVOKED** |

### Threat Vector:
An adversary with access to Git historical packfiles holds the Ed25519 seeds for all 4 genesis validators. In an un-rotated network, this allows arbitrary double-signing, equivocation attacks, and invalid state commitments. Simply removing the files from HEAD is insufficient; the consensus protocol itself must explicitly revoke their authority for all future block heights.

---

## 4. ARCHITECTURAL GAPS IN CONSENSUS & SIGNING ENGINE

### Gap 1: Static Validator Set in Consensus Engine
`chain/consensus/engine.go` and `chain/consensus/verifier.go` assumed a single, immutable `ValidatorSet`. The system lacked:
- A `ValidatorSetProvider` or height-indexed validator transition tracker.
- An explicit revocation registry rejecting signatures from compromised keys at heights $H > H_{transition}$.
- Dual-mode verification: verifying historical blocks $\le H_{transition}$ against the genesis set, while verifying blocks $> H_{transition}$ against the rotated set.

### Gap 2: In-Memory Mock Driver Labeled as CloudHSM
`chain/privval/hsm.go` contained misleading comments claiming AWS CloudHSM v3 and YubiHSM2 deployment. Key material was stored in user-space Go heap memory. A genuine architecture must:
- Differentiate between production hardware signers (PKCS#11) and local software emulators.
- Define a strict PKCS#11 driver interface supporting Ed25519 (`CKM_EDDSA` / curve `1.3.101.112`).
- Enforce non-exportable key handles (`CKA_EXTRACTABLE=false`).
- Provide tamper-evident cryptographic signing audit logs.

### Gap 3: Unscrubbed Historical Git Packfiles
Although files were untracked in commit `c40011b`, commit objects `9bc310b` and `50b9c46` remain reachable in `.git/objects/`. A controlled history purge must be performed after creating offline backups and revoking the keys on-chain.

---

## 5. RECOVERY & REMEDIATION PLAN

The remediation follows a strict 9-step execution pipeline:
```
[1. Forensic Audit]           [2. Offline Backup]          [3. Key Generation & Revocation]
        |                             |                                  |
        v                             v                                  v
[4. Dynamic Transition]       [5. Signing Backend]         [6. Git History Rewriting]
        |                             |                                  |
        v                             v                                  v
[7. Adversarial Tests]        [8. Full Regression]         [9. Final Authorization Gate]
```

**Next Immediate Actions:**
1. Generate 4 fresh, unexposed Ed25519 validator keypairs with scrypt-encrypted keystores.
2. Implement `ValidatorTransitionRegistry` in `chain/consensus/` and `chain/node/` to enforce atomicity and permanent revocation.
3. Overhaul `chain/privval/hsm.go` to provide a genuine PKCS#11 hardware specification and explicit development mode classification.
