# SOVRA PHASE 14 — VALIDATOR KEY ROTATION & REPOSITORY SECURITY AUDIT

**Canonical Reference:** `SOVRA_INDUSTRY_STANDARD_MASTER_GOAL_AND_ACCEPTANCE.md`  
**Phase:** 14 — Production-Grade BFT Consensus & Cryptographic Finality  
**Subsystem:** Cryptographic Key Custody, Keystore Encryption, and Secret Hygiene  
**Audit Script:** `scripts/phase14-rotate-validator-keys.ts`  
**Machine Evidence File:** `phase14-validator-key-security-evidence.json`  
**Execution Timestamp:** 2026-11-22T01:32:46.000Z  
**Total Repository Files Scanned:** 2,904  
**Status:** AUDITED, ROTATED, COMPREHENSIVE RUNBOOK DOCUMENTED  

---

## 1. INVESTIGATION OF HISTORICAL PLAINTEXT VALIDATOR KEYS

During Phase 10 and Phase 11 development, four initial testnet validator nodes were initialized with both encrypted keystores and legacy plaintext JSON key files (`validator-*.key.json`).

### 1.1 Forensic Findings
1. **Plaintext Key Files:** `chain/mytestnet/node0` through `node3` contained `.key.json` files storing hex-encoded Ed25519 private keys.
2. **Keystore Precedence:** Analysis of `chain/cmd/sovrad/main.go` lines 835-865 confirms that the node software prioritizes unlocking encrypted keystores from the node keyring (`keyring/validator-*.keystore`). Plaintext keys were only accessed as a backward-compatibility fallback.
3. **Forensic Backup:** The pre-migration backup (`backups/phase13_pre_migration_backup`) preserves the full historical chain state and original key configurations for non-repudiation and forensic continuity. In accordance with Non-Negotiable Rule 6, this backup has been preserved completely intact.

---

## 2. GENERATION-2 VALIDATOR SET ROTATION

To prepare for production testnet federation and eliminate dependence on legacy test keys, Phase 14 engineered an automated cryptographic key rotation mechanism (`scripts/phase14-rotate-validator-keys.ts`).

### 2.1 Cryptographic Identity Generation
Four new Generation-2 validator identities were generated using Ed25519 cryptographic key pairs:

| Moniker | Address | Public Key (Hex) | Key File Location |
| :--- | :--- | :--- | :--- |
| **validator-0** | `sovra1ae36a8254cae76a28ef4aa82a347761e523c50a4` | `417442f034e9aa68e9e623ec6132a4e21a81dc1c2514f77c0792134aa6ffceae` | `chain/rotated_keys/validator-0.keystore` |
| **validator-1** | `sovra18b7424760a12f880d42ee4a49a7ceb185c01c527` | `0fa95b0c82ee66f5c6ad90c6a5df3ce9e3b97b1ca6dcab8360d5bfa78082697b` | `chain/rotated_keys/validator-1.keystore` |
| **validator-2** | `sovra158eef3f0ef9805909109e5bba9c505ac90a84f0b` | `e18c05f8668bf44cd48a37f5a0e98031e4e6d3cfc1ca9157297e55dae06f1e56` | `chain/rotated_keys/validator-2.keystore` |
| **validator-3** | `sovra14d56d88075ddd8a8e0e0112bdc9bf323284d7a6d` | `abbc6c1abdc3e239257bb523ec39a48ce686a7603c4f74d08a1c97034b7fef5c` | `chain/rotated_keys/validator-3.keystore` |

### 2.2 Keystore Encryption Standard (AES-256-GCM + Scrypt)
Every Generation-2 keystore adheres to the SOVRA Enterprise Keystore Standard:
- **Cipher:** `aes-256-gcm` authenticated encryption with 96-bit random IV and 128-bit authentication tag.
- **KDF:** `scrypt` password-based key derivation.
- **KDF Parameters:**
  - $N = 32,768$ (CPU/memory cost factor)
  - $r = 8$ (Block size parameter)
  - $p = 1$ (Parallelization parameter)
  - $\text{Keylen} = 32$ bytes (256-bit derived key)
  - $\text{Salt} = 32$ cryptographically secure random bytes
- **MAC Verification:** $\text{SHA256}(\text{DerivedKey}[16..32] \,\|\, \text{Ciphertext} \,\|\, \text{Tag})$ provides tamper-evident integrity before decryption attempt.

---

## 3. REPOSITORY-WIDE SECRET SCAN RESULTS

The automated scanner analyzed 2,904 files across all directories (excluding `node_modules`, `.git`, `dist`, `coverage`).

### 3.1 Scan Findings Summary
- **Total Scanned Files:** 2,904
- **Active Code Findings:** 0 unauthorized plaintext production credentials.
- **Blocklist & Test References (Expected):**
  - `services/api/src/server.ts`: Contains `sovra_internal_cluster_secret_default_key_2026` inside `FORBIDDEN_FALLBACK_SECRETS` blocklist (remediation from Phase 12).
  - `tests/security/phase12-secret-and-auth-hardening.test.ts`: Test asserting that the forbidden secret is rejected.
  - `SOVRA_PHASE12_*`: Forensic audit documents recording the historical Phase 12 vulnerability remediation.
  - `backups/phase13_pre_migration_backup/`: Forensic snapshot preserved per protocol.

Zero operational secrets or private keys are exposed in unencrypted form in active application code.

---

## 4. GIT HISTORY SECRET REMEDIATION RUNBOOK

In accordance with Phase 14 Non-Negotiable Rule 8 ("Never authorize public testnet or mainnet automatically") and Non-Negotiable Rule 9 ("Do not rewrite shared Git history without first preserving and documenting the recovery procedure"), the following runbook establishes the exact procedure for scrubbing historical testnet keys prior to any remote or public deployment.

### Step 1: Secure Archive Creation
Before executing any history rewrite, create an immutable, detached clone in cold storage:
```bash
git clone --mirror D:\Sovra D:\Sovra_Forensic_Mirror_PreScrub.git
tar -czvf sovra_git_history_forensic_backup_2026.tar.gz D:\Sovra_Forensic_Mirror_PreScrub.git
sha256sum sovra_git_history_forensic_backup_2026.tar.gz > sovra_git_history_forensic_backup_2026.tar.gz.sha256
```

### Step 2: History Scrubbing using `git-filter-repo`
```bash
# Install git-filter-repo
pip install git-filter-repo

# Scrub legacy plaintext validator key files across all historical commits
git filter-repo --path-glob 'chain/mytestnet/*.key.json' --invert-paths --force
git filter-repo --path-glob 'backups/**/*.key.json' --invert-paths --force
```

### Step 3: Replace Hardcoded Secret References
Create an expression file `secret-expressions.txt`:
```
sovra_internal_cluster_secret_default_key_2026==>REDACTED_HISTORICAL_DEFAULT_SECRET
```
Execute replacement:
```bash
git filter-repo --replace-text secret-expressions.txt --force
```

### Step 4: Verification & Git Garbage Collection
```bash
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git log -S "sovra_internal_cluster_secret_default_key_2026" --all
# (Must return zero commits)
```

---

## 5. PRODUCTION KEY MANAGEMENT ARCHITECTURE (REMOTE HSM)

For Remote Testnet and Mainnet deployments:
1. **Zero Keys on Validator Nodes:** No private keys or keystores may exist on validator host disks.
2. **Remote PrivValidator Daemon (`--priv_val_laddr`):** Each validator connects over mutually authenticated TLS (mTLS) to an isolated signing service (e.g., Tendermint KMS, AWS CloudHSM, or YubiHSM).
3. **Hardware Monotonicity:** High-water mark state is enforced inside the HSM hardware security module to eliminate double-signing risk even if the node host is compromised.

---

## 6. COMPLIANCE & ACCEPTANCE VERDICT

Phase 14.4 requirements are fully satisfied:
- Existing keystores audited and verified.
- Gen-2 rotated identities generated with AES-256-GCM + Scrypt.
- 2,904 files scanned with zero active credential leaks.
- Git history remediation runbook fully documented with backup preservation.
- Status: **PASSED**.
