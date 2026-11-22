# SOVRA PHASE 15.1 — GIT HISTORY & SECRET RECOVERY FORENSIC AUDIT

**Author:** Principal Cryptographic Security Auditor & Forensic Investigator  
**Repository:** `D:\Sovra`  
**Branch:** `main`  
**Baseline Commits:** `2f3e017` (Phase 14) $\to$ `c40011b` (Phase 15)  
**Date:** November 22, 2026  
**Classification:** HIGH RISK — EXPOSED HISTORICAL KEY OBJECTS  
**Evidence Artifact:** [`phase15_1-git-history-audit-evidence.json`](file:///d:/Sovra/phase15_1-git-history-audit-evidence.json)

---

## EXECUTIVE SUMMARY

In Phase 15, commit `c40011b` removed five plaintext validator key files (`validator-0.key.json` through `validator-3.key.json` and `validator.key.json`) from the Git index and active working tree, and updated `.gitignore`. 

However, under this Zero-Trust Audit, an inspection of the reachable Git DAG demonstrates:
1. **The actual `main` branch history was NOT rewritten.** Only an isolated testing branch (`test-scrub-verification`) had its history filtered via `git filter-branch`.
2. **Historical Git Objects Remain Fully Reachable on `main`:** Any contributor, clone, or fork can inspect commits prior to `c40011b` (e.g. `2f3e017`, `50b9c46`, `9bc310b`) or run `git cat-file -p` to extract the plaintext Ed25519 private keys directly from the packfiles.
3. **Historical Keys Are Permanently Compromised:** Because the repository has public and distributed remotes, those historical keys must be treated as public knowledge.
4. **Mandatory Remediation:** A strict key rotation and revocation protocol is mandated. The historical genesis addresses cannot be used in a public remote testnet or mainnet.

---

## 1. REACHABLE GIT DAG & OBJECT ANALYSIS

### Reachability via Git Log
Running `git log --all --full-history --oneline -- chain/mytestnet/node0/validator-0.key.json` reveals the exact commit chain where plaintext secrets were introduced and carried forward:
- `c40011b` (HEAD): Deletion of `validator-0.key.json` through `validator-3.key.json`.
- `50b9c46`: Tracked in Phase 12 remediation.
- `9bc310b`: Committed into repository history.

### Object Tree Inspection
Inspecting the tree of commit `2f3e017` directly:
```bash
git ls-tree 2f3e017 chain/mytestnet/node0/
# Output:
# 100644 blob 0f608bc014af0b122c9031b408e3056138431dc2  chain/mytestnet/node0/config.json
# 100644 blob 1d1f619e1542dc426a3a99bfe0ba7c8dd527ebc7  chain/mytestnet/node0/genesis.json
# 100644 blob 98a9f734a474c030915317d2b9fbe08b11f35497  chain/mytestnet/node0/validator-0.key.json
```
Blob `98a9f734a474c030915317d2b9fbe08b11f35497` remains physically stored inside `.git/objects/` and is accessible in every clone of the repository.

---

## 2. AUDIT OF HISTORY REWRITING CLAIMS

| Scope | Method Tested | Target Branch | Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Working Tree (HEAD)** | `git rm --cached` | `main` | Files deleted from index; `.gitignore` enforced | **VERIFIED** |
| **Historical Verification Branch** | `git filter-branch` | `test-scrub-verification` | History rewritten cleanly; 0 plaintext keys in DAG | **VERIFIED (ISOLATED)** |
| **Production `main` Branch** | N/A (Preserved) | `main` | **NOT REWRITTEN**. DAG intact; historical commits unchanged | **NOT REWRITTEN** |

### Justification for Preserving `main` DAG History:
Force-pushing a rewritten `main` branch would break every existing clone, upstream pull request, and CI pipeline without synchronized coordination. Under blockchain security best practices, **never rewrite shared Git history without explicit multi-party authorization, a cold offline backup, and an agreed cutover window.**

---

## 3. KEY COMPROMISE & MANDATORY ROTATION PROTOCOL

Because historical commits were pushed to upstream remotes, all four legacy validator keypairs must be formally classified as **DIRTY / COMPROMISED**:

| Validator Identity | Compromised Public Address | Exposure Vector | Operational Mandate |
| :--- | :--- | :--- | :--- |
| **validator-0** | `sovra12a806ca82d506a025d580d40600abc77a69e10e7` | Git historical blob `98a9f734...` | **REVOKE & ROTATE** before Remote Testnet |
| **validator-1** | `sovra1664a83c922035ce28bb723e4e92aed1e60e26ea1` | Git historical blob in `node1/` | **REVOKE & ROTATE** before Remote Testnet |
| **validator-2** | `sovra1cb55be9a3d2afab1c9bcbffb88367bec797d11cb` | Git historical blob in `node2/` | **REVOKE & ROTATE** before Remote Testnet |
| **validator-3** | `sovra1d96f6140a4c4ae797d9e3a5badf467eb756d3d20` | Git historical blob in `node3/` | **REVOKE & ROTATE** before Remote Testnet |

### Mandatory Remote Testnet Genesis Cutover:
1. For any real remote testnet deployment, a fresh genesis file (`genesis.json`) must be created with newly generated Ed25519 keys created inside isolated PrivValidator memory enclaves.
2. The legacy local testnet keys are permitted strictly for **offline local development testing** and must never be permitted on internet-exposed validator nodes.

---

## 4. GATE CLASSIFICATION

- **Working Tree / Staged Index:** VERIFIED (Clean)
- **Historical Git DAG on `main`:** FAILED FOR SECRET ISOLATION (Reachable objects exist)
- **Key Rotation Prerequisite:** UNRESOLVED BLOCKER FOR REMOTE TESTNET

**Classification: PARTIALLY VERIFIED — REMOTE TESTNET AUTHORIZATION BLOCKED**
