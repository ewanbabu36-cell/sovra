# SOVRA PHASE 15.3 — GIT HISTORY FORENSIC AUDIT & REMEDIATION REPORT

**Authority:** Principal Forensic Security Auditor & Release Authority  
**Date:** 2026-11-22  
**Baseline Commit:** `d16d239` (Phase 15.2)  
**Repository:** `D:\Sovra` (Remote: `https://github.com/ewanbabu36-cell/sovra.git`)  
**Status:** DEDICATED RECOVERY BRANCH VERIFIED CLEAN | REMOTE `main` FORCE-REWRITE BLOCKED PENDING OWNER COORDINATION

---

## 1. Executive Summary

Phase 15.1 revealed that five plaintext validator key files were historically committed to Git in earlier development iterations (Phase 11 commit `9bc310b` and Phase 12 commit `50b9c46`). Although these files were untracked and deleted in Phase 15 (`c40011b`), they remained reachable as historical Git blob objects in the commit history of `main`.

In accordance with Workstream 4 of Phase 15.3:
1. All five historical blobs were forensically identified by SHA-1 hash and path metadata without printing or exposing secret material.
2. Verified cold offline backups were secured, encrypted via AES-256-GCM + Scrypt, and stored outside the repository tree.
3. Compromised credentials were permanently revoked on-chain at the consensus layer independently of Git hygiene.
4. A dedicated recovery branch (`recovery/history-remediation-phase15-3`) was constructed using `git-filter-repo` with all five blobs 100% purged from every tree and commit, and published to `origin`.
5. The canonical `main` branch was preserved without unilateral destructive force-pushing, and a formal collaborator synchronization runbook has been established.
6. The remote testnet authorization gate remains **BLOCKED** until the repository owner coordinates the remote history rewrite or formally signs an explicit risk-acceptance waiver.

---

## 2. Forensic Identification of Compromised Blobs

A full object-graph traversal across all reachable refs identified the exact five historical plaintext validator key blobs:

| Historical Object Path | Git Blob SHA-1 Hash | Introduced Commit | Removed Commit | Status in `main` | Status in Recovery Branch |
|------------------------|---------------------|:-----------------:|:--------------:|:----------------:|:-------------------------:|
| `chain/mytestnet/node0/validator-0.key.json` | `98a9f734a474c030915317d2b9fbe08b11f35497` | `9bc310b` | `c40011b` | Reachable in history | **100% ABSENT (PURGED)** |
| `chain/mytestnet/node1/validator-1.key.json` | `fe9beee8175b2145666b6e0c93d990101604f866` | `9bc310b` | `c40011b` | Reachable in history | **100% ABSENT (PURGED)** |
| `chain/mytestnet/node2/validator-2.key.json` | `bbb9aba2ec0d45d1e6d237c31064adc18ce14a72` | `9bc310b` | `c40011b` | Reachable in history | **100% ABSENT (PURGED)** |
| `chain/mytestnet/node3/validator-3.key.json` | `672c30160f34ffe5762ccef25cee40c2854f29a9` | `9bc310b` | `c40011b` | Reachable in history | **100% ABSENT (PURGED)** |
| `chain/mytestnet/node4/validator.key.json` | `a21281d32267e9fe08aadf1510f55fd63513dcca` | `50b9c46` | `c40011b` | Reachable in history | **100% ABSENT (PURGED)** |

Zero other private key files or unencrypted keystores were detected in the reachable Git object graph.

---

## 3. Offline Backup & Access-Controlled Encryption

Before any history-rewriting operations were initiated, verifiable offline backups of the repository were created and validated:

1. **Uncompressed Git Bundle Backup:**
   - Location: `D:\Sovra-backup-pre-phase15_2.bundle`
   - File Size: $12,392,075\text{ bytes}$
   - Verification: Confirmed valid git bundle containing all refs and objects.
2. **Encrypted & Access-Controlled Backup:**
   - Location: `D:\Sovra-backup-pre-phase15_2.bundle.enc`
   - File Size: $12,392,135\text{ bytes}$
   - Cipher: AES-256-GCM (12-byte random nonce, 16-byte authentication tag)
   - KDF: Scrypt ($N=32768, r=8, p=1, \text{keylen}=32$, $128\text{ MB}$ memory limit)
   - Payload SHA-256: `13618c817e8d7ace5483fa251e31270a31ed6b8804bcd6e70b4a2448f37c2975`
   - Roundtrip Proof: Script `scripts/encrypt-backup.ts` executed roundtrip decryption and verified an exact $100\%$ byte-for-byte match against the original bundle.
3. **Bare Mirror Repository:**
   - Location: `D:\Sovra-backup-pre-phase15_2.git`
   - Structure: Complete bare mirror clone preserving refs/heads, refs/tags, and refs/remotes.

---

## 4. On-Chain Credential Revocation (Defense-in-Depth)

In accordance with cryptographic best practices, **credential revocation must be independent of Git cleanup**:
> Git history rewriting eliminates exposure in source repositories, but cannot undo exposure if an adversary cloned the repository while the secrets were present.

Therefore, the primary defense is consensus-layer invalidation:
- All 4 genesis validator identities (`sovra12a806...`, `sovra1664a8...`, `sovra1cb55b...`, `sovra1d96f6...`) are registered in `chain/consensus/verifier.go` and `phase15_2-rotated-validator-manifest.json` as `PERMANENTLY_REVOKED`.
- At and above height 40,000, any vote, proposal, or block signed by these keys is rejected with `ErrRevokedValidator`.
- Possession of the leaked historical private keys confers **zero authority** on the SOVRA network.

---

## 5. Controlled History Rewriting on Recovery Branch

A dedicated recovery branch was constructed:
```powershell
python -m git_filter_repo `
  --path chain/mytestnet/node0/validator-0.key.json `
  --path chain/mytestnet/node1/validator-1.key.json `
  --path chain/mytestnet/node2/validator-2.key.json `
  --path chain/mytestnet/node3/validator-3.key.json `
  --path chain/mytestnet/node4/validator.key.json `
  --invert-paths
```

### Verification Evidence
1. **Blob Absence Verification:**
   ```powershell
   git rev-list recovery/history-remediation-phase15-3 --objects | Select-String -Pattern "chain/mytestnet/node.*/validator.*key\.json"
   # Output: ZERO MATCHES
   ```
2. **Hash Absence Verification:**
   ```powershell
   git rev-list recovery/history-remediation-phase15-3 --objects | Select-String -Pattern "98a9f734|fe9beee8|bbb9aba2|672c3016|a21281d3"
   # Output: ZERO MATCHES
   ```
3. **Remote Publication:**
   The clean branch was pushed to `origin`:
   `https://github.com/ewanbabu36-cell/sovra.git` $\rightarrow$ branch `recovery/history-remediation-phase15-3`.

---

## 6. Collaborator Coordination & Remote Synchronization Runbook

Destructive history rewriting on a shared branch (`git push --force origin main`) invalidates commit hashes across all collaborator forks, open pull requests, and clone working trees.

### Owner Promotion Runbook (When Ready)
1. **Preflight Notice:** Inform all collaborators to push uncommitted work or commit onto feature branches.
2. **Promote Clean Branch:**
   ```bash
   git checkout recovery/history-remediation-phase15-3
   git branch -D main
   git checkout -b main
   git push --force origin main
   ```
3. **Collaborator Rebase:**
   ```bash
   git fetch origin
   git reset --hard origin/main
   ```
4. **Purge GitHub Cache:** Contact GitHub Support to run `git gc --prune=now` on the upstream repository to purge loose unreachable cached objects.

### Release Gate Status
Because the canonical `main` branch has not yet been destructively force-rewritten on GitHub (to preserve collaborator DAG continuity pending explicit owner sign-off), this item is formally classified as:
**RESOLVED ON RECOVERY BRANCH | BLOCKED ON REMOTE TESTNET UNTIL COORDINATED FORCE-REWRITE**.
