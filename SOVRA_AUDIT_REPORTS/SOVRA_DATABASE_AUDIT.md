# SOVRA — DATABASE INTEGRITY, PERSISTENCE & MIGRATION AUDIT REPORT

**Workspace:** `D:\Sovra`  
**Engines Audited:** Document Store (`scripts/database-engine.ts`) & Native SQLite (`scripts/database-sqlite.ts`)  
**Data Directory:** `.sovra-storage-dev/`  
**Auditor:** Principal Database Architect & Data Systems Reliability Engineer  
**Date:** November 24, 2026  

---

## 1. DUAL-ENGINE ARCHITECTURE OVERVIEW

Sovra employs a hybrid dual-engine persistence model:
1. **Dynamic Social Document Store (`dynamic-social-state.json`):**
   - High-throughput in-memory state serialized with atomic disk writes (`save()` with debounced flush, and `save(true)` for synchronous critical writes).
   - Rolling automated `.bak` backups with corruption auto-detection and recovery.
2. **Native SQLite Relational Database (`sovra-social.sqlite`):**
   - Built on Node 24 native `node:sqlite` (`DatabaseSync`).
   - WAL (Write-Ahead Logging) journal mode with synchronous `NORMAL`.
   - Stores financial transactions, CometBFT blocks, user identities, and audit ledgers.

---

## 2. FORENSIC PERSISTENCE DEFECT & REMEDIATION (GAP-03)

### The Defect:
During the forensic audit of `scripts/database-engine.ts`, a critical state-loss vulnerability was identified in `load()`:
1. When reading `dynamic-social-state.json` from disk, the loader parsed the JSON content into `parsed`.
2. In lines 2574–2775, the schema assignment constructed `this.db = { ... }` with individual fields mapped from `parsed`.
3. **Critical Omission:** `zk_nullifiers` and `archival_pins` were completely absent from this assignment object!
4. Consequently, when `this.sanitizeState()` was executed at line 2785, line 2834 evaluated:
   `if (!Array.isArray(this.db.zk_nullifiers)) this.db.zk_nullifiers = [];`
5. Because `this.db.zk_nullifiers` was `undefined`, it was re-initialized to an empty array `[]` on every single disk load!
6. Additionally, `registerZkAttestation` and `recordZkNullifier` were invoking debounced `this.save()`, which risked being discarded if `load(true)` was called before the timer expired.

### The Remediation:
1. **Explicit Schema Hydration:** Added `zk_nullifiers` and `archival_pins` to `this.db = { ... }` in `load()`:
   ```typescript
   zk_nullifiers: Array.isArray(parsed.zk_nullifiers) ? parsed.zk_nullifiers : [],
   archival_pins: Array.isArray(parsed.archival_pins) ? parsed.archival_pins : [],
   ```
2. **Synchronous Critical Flushes:** Updated `registerZkAttestation` and `recordZkNullifier` to invoke `this.save(true)` so nullifiers and credentials are synchronously committed to disk before returning to callers.
3. **Safe Multi-Process Loading:** Ensured `load(forceReload)` safely synchronizes any pending in-memory write buffer before re-reading disk state.

---

## 3. SQLITE RELATIONAL TABLES & TRANSACTION INTEGRITY

The native SQLite engine manages the following core tables:
- `users`: DID, handle, public key, encrypted private key, role, created_at.
- `financial_ledger`: Transaction ID, sender DID, receiver DID, amount SOV, transaction type, hash, block height, timestamp.
- `zk_nullifiers`: Nullifier hash, epoch, external nullifier, subject DID, spent timestamp (with UNIQUE constraint preventing double-spending).
- `zk_attestations`: Attestation ID, subject DID, attestation type, proof JSON, issuer DID, nullifier hash, expires_at.
- `audit_logs`: Sequence ID, actor DID, event type, metadata, timestamp.

All financial transfers in `scripts/routes/enterprise-protocol.routes.ts` execute within an ACID transaction block, rolling back fully if any consensus or balance invariant fails.
