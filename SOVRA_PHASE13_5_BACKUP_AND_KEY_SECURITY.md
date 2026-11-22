# SOVRA PHASE 13.5 — BACKUP AND KEY SECURITY AUDIT

**Author:** Principal Cryptographic Security Auditor & Release Authority  
**Target Repository:** `D:\Sovra`  
**Git Baseline Commit:** `1899c27`  
**Implementation Commit:** `a793a44`  
**Backup Root:** [`backups/phase13_pre_migration_backup`](file:///d:/Sovra/backups/phase13_pre_migration_backup)  
**Machine Evidence:** [`phase13-pre-migration-financial-evidence.json`](file:///d:/Sovra/phase13-pre-migration-financial-evidence.json)  
**Audit Evaluation:** **CONDITIONAL PASS FOR LOCAL TESTNET; CRITICAL FINDING REGARDING COMMITTED TESTNET KEYS**  
**Mainnet Status:** **STRICTLY NOT AUTHORIZED**

---

## 1. BACKUP ARCHIVE VERIFICATION

Prior to the Phase 13 validator unification, an automated backup procedure archived the complete raw database state, configuration, and keystores of all four nodes.

### 1.1 Archive Integrity & Storage Metrics
- **Location:** `D:\Sovra\backups\phase13_pre_migration_backup`
- **Total File Count:** 54 database files (Pebble `.log`, `.sst`, `MANIFEST`, `OPTIONS`, `CURRENT`, `LOCK`, `.keystore`)
- **Total Volume:** 36,651,412 bytes (~34.95 MB)
- **Directory Breakdown:**
  - `node0`: 18 files, 12,477,885 bytes (11.90 MB)
  - `node1`: 12 files, 7,729,115 bytes (7.37 MB)
  - `node2`: 12 files, 8,222,231 bytes (7.84 MB)
  - `node3`: 12 files, 8,222,181 bytes (7.84 MB)
- **Cryptographic Verification:** Every archived file was hashed with SHA-256 and cataloged in the machine evidence manifest in [`phase13-pre-migration-financial-evidence.json`](file:///d:/Sovra/phase13-pre-migration-financial-evidence.json).

### 1.2 Git Tracking Exclusion
An audit of [`.gitignore`](file:///d:/Sovra/.gitignore) and `git check-ignore` confirms that the entire `backups/` directory tree is strictly ignored:
```
$ git check-ignore backups/phase13_pre_migration_backup/manifest.json
backups/phase13_pre_migration_backup/manifest.json
```
No database backups or migration dumps have been committed or pushed to remote repositories.

---

## 2. CRYPTOGRAPHIC KEY CUSTODY AUDIT

The audit inspected the key storage architecture across both the modern encrypted keystores and legacy configuration files.

### 2.1 Encrypted Keystores (Production Grade)
Each validator maintains an encrypted keystore file under `chain/mytestnet/node{i}/keyring/validator-{i}.keystore`. 
Inspection of `chain/mytestnet/node0/keyring/validator-0.keystore` confirms adherence to modern cryptographic standards:
- **Cipher:** AES-256-GCM (Authenticated Encryption with Associated Data).
- **Key Derivation Function (KDF):** Scrypt.
- **Scrypt Parameters:**
  - $N = 32,768$ (CPU/memory cost parameter)
  - $r = 8$ (block size parameter)
  - $p = 1$ (parallelization parameter)
  - $\text{keylen} = 32$ bytes
- **MAC Verification:** SHA-256 message authentication code enforcing ciphertext integrity.
- **Passphrase Protection:** Daemon requires `--passphrase` to decrypt keys into memory at startup.

---

## 3. CRITICAL AUDIT FINDING: TRACKED TESTNET PLAINTEXT KEYS

> [!CAUTION]
> **CRITICAL SECURITY FINDING (KEY-P13-01):**
> While modern keystores under `keyring/*.keystore` are encrypted, legacy plaintext JSON key files exist in the repository and are **tracked in Git history**:
> - `chain/mytestnet/node0/validator-0.key.json`
> - `chain/mytestnet/node1/validator-1.key.json`
> - `chain/mytestnet/node2/validator-2.key.json`
> - `chain/mytestnet/node3/validator-3.key.json`
> - `chain/mytestnet/node4/validator.key.json`

### Evidence:
Inspection of `chain/mytestnet/node0/validator-0.key.json`:
```json
{
  "name": "validator-0",
  "address": "sovra12a806ca82d506a025d580d40600abc77a69e10e7",
  "pub_key": "50dec499bc1281f64488a3ca9500c9c1a4eea67f5147af0450ee0deebf8601be",
  "priv_key": "8f0a75731a3e11fd716ab13704d734a649462b06e2e0e0e08f3fac0f5ae1db8150dec499bc1281f64488a3ca9500c9c1a4eea67f5147af0450ee0deebf8601be"
}
```
Git history inspection shows these files were originally committed in commit `9bc310b` for local testing convenience.

### Risk Assessment & Mainnet Blocker:
- **For Local Development Testnet:** Acceptable strictly for deterministic local test harnesses and development clusters.
- **For Remote Testnet / Mainnet:** **ABSOLUTE RELEASE BLOCKER.**
  - These keys are publicly accessible in git history.
  - Any node using these keys on a public network can be immediately impersonated, equivocated, or slashed.

---

## 4. REMEDIATION REQUIREMENTS FOR REMOTE TESTNET & MAINNET

Prior to deploying any public or federated testnet, and as a strict prerequisite for mainnet:
1. **Key Purge:** All `*.key.json` files containing plaintext `priv_key` fields must be deleted from working directories and added to `.gitignore`.
2. **Key Rotation:** Complete cryptographic rotation of all four validator identities.
3. **Hardware Security Module (HSM) / Remote Signer:**
   - Integrate `privval.RemoteSigner` over mTLS (e.g., Horcrux, YubiHSM2, AWS KMS, or HashiCorp Vault).
   - Ensure validator private keys never reside on the disk of the consensus node.
4. **Passphrase Hardening:** Passphrases must not be supplied via command-line flags (`--passphrase=...`), which can be inspected via process table listings (`ps -ef`), but via secure environment variables, UNIX domain sockets, or file descriptors.

---

## 5. AUDIT CONCLUSION & VERDICT

- **Backup Safety & Archival:** **PASSED.** Complete, verified, and git-ignored.
- **Keystore Encryption Architecture:** **PASSED (AES-256-GCM + Scrypt verified).**
- **Plaintext Key Separation:** **FAILED FOR PUBLIC NETWORKS (Tracked in Git history for local testnet).**
- **Mainnet Release:** **STRICTLY NOT AUTHORIZED.**
