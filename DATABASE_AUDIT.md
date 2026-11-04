# SOVRA — DATABASE & STORAGE LAYER AUDIT

**Audit Date**: 2026-11-04  
**Audit Entity**: Multidisciplinary Enterprise Technology Audit Organization  
**Auditor Roles**: Database & Data Integrity Engineer & Systems Architect  
**Engines Audited**: `node:sqlite` (SQLite 3.45+ Embedded), In-Memory Social Graph (`sovraDb`), and Content-Addressed Storage (`.sovra-storage-dev/`)  
**Evaluation Status**: VERIFIED (with telemetry retention warning)

---

## 1. STORAGE ARCHITECTURE & TOPOLOGY

SOVRA employs a hybrid tiered storage architecture:

```mermaid
flowchart TD
    subgraph Execution Layer
        App[Dev Server & API Controllers]
    end

    subgraph Hot Tier [In-Memory State]
        MEM_GRAPH[sovraDb: Maps & Sets for Social Graph]
        MEM_CACHE[LRU Feed & Session Cache]
    end

    subgraph Warm Relational Tier [ACID SQLite Engine]
        SQLITE[sovra-social.sqlite - 38.6 MB]
        WAL[sovra-social.sqlite-wal - 4.1 MB]
        SHM[sovra-social.sqlite-shm - 32 KB]
    end

    subgraph Cold Content-Addressable Tier [CAS Filesystem]
        CAS_MEDIA[.sovra-storage-dev/media/ - Chunked Video & Images]
        CAS_POSTS[.sovra-storage-dev/posts/ - Content Blobs]
        CAS_ATTACH[.sovra-storage-dev/attachments/ - Encrypted Files]
    end

    App --> Hot Tier
    Hot Tier <--> Warm Relational Tier
    App --> Cold Content-Addressable Tier
```

---

## 2. RELATIONAL SCHEMA & STORAGE METRICS

Direct querying of the live production SQLite database (`.sovra-storage-dev/sovra-social.sqlite`) yielded the following statistics across the 56 active tables:

| Table Category | Tables Included | Total Records | Index Strategy | Foreign Key Constraints |
| :--- | :--- | :--- | :--- | :--- |
| **Identity & Sessions** | `users`, `user_sessions`, `revoked_tokens` | 4,028 | B-tree index on `did`, `handle`, `session_token` | Enforced on `user_sessions.did -> users.did` |
| **Social Graph** | `posts`, `comments`, `follows`, `friend_relationships` | 4,395 | Indexes on `author_did`, `created_at`, `target_did` | Cascading delete on child comments |
| **Direct Messaging** | `direct_messages`, `channels`, `ephemeral_stories` | 2,507 | Indexes on `(sender_did, recipient_did)`, `expires_at` | Enforced |
| **Governance & Jury** | `jury_cases`, `jury_appeals`, `community_notes` | 62 | Indexes on `case_id`, `accused_did`, `status` | Enforced |
| **Economy & Vouchers** | `offline_payment_vouchers`, `token_transfers` | 1,561 | Unique index on `voucher_nonce`, `signature` | Enforced |
| **Admin & Wiretap** | `admin_wiretap_telemetry`, `admin_tamper_evident_audit_ledger` | 166,415 | Composite index on `(timestamp, path)` | None |

---

## 3. DATABASE CONFIGURATION AUDIT

| Pragma Setting | Target Value | Actual Runtime Value | Security & Performance Implication |
| :--- | :--- | :--- | :--- |
| `PRAGMA journal_mode` | `WAL` | `wal` | **VERIFIED**: Concurrent readers do not block writers. |
| `PRAGMA synchronous` | `NORMAL` | `NORMAL` (1) | **VERIFIED**: Optimal balance between durability and write throughput. |
| `PRAGMA foreign_keys`| `ON` | `1` | **VERIFIED**: Referential integrity actively enforced by engine. |
| `PRAGMA temp_store` | `MEMORY` | `2` (MEMORY) | **VERIFIED**: Temporary sort tables held in RAM. |
| `PRAGMA busy_timeout`| `5000` | `5000ms` | **VERIFIED**: Mitigates `SQLITE_BUSY` contention during bursts. |

---

## 4. STORAGE VULNERABILITY & INTEGRITY FINDINGS

### Finding DB-01: Unbounded Growth in `admin_wiretap_telemetry`
- **Location**: `scripts/database-sqlite.ts:4200-4220`, `scripts/dev-server.ts:89295`
- **Severity**: High (Disk Exhaustion DoS)
- **Technical Observation**:
  The dev-server records an entry into `admin_wiretap_telemetry` for every single HTTP request. No retention window, rotation schedule, or pruning query (`DELETE FROM admin_wiretap_telemetry WHERE timestamp < ...`) exists.
  The table has ballooned to **166,396 rows**, representing over 85% of total database disk footprint (38.6 MB).
- **Remediation**:
  1. Add a scheduled rolling purge: `DELETE FROM admin_wiretap_telemetry WHERE timestamp < unixepoch('now', '-7 days')`.
  2. Implement a hard maximum row cap (e.g., maintain only the latest 10,000 entries).

---

### Finding DB-02: Dual-Write Inconsistency Between In-Memory Graph and SQLite
- **Location**: `scripts/database-engine.ts:850-890`
- **Severity**: Medium
- **Technical Observation**:
  `sovraDb` maintains in-memory state while periodically syncing to SQLite and flushing `dynamic-social-state.json`. In the event of an abrupt process crash (`SIGKILL` or power outage), mutations committed to memory during the interval before flush can be lost, causing drift between memory and SQLite state.
- **Remediation**:
  Adopt SQLite as the single authoritative source of truth, treating the in-memory maps purely as a read-through / write-through cache backed by ACID transactions.

---

## 5. DATABASE & STORAGE LAYER SCORECARD

- **Schema Design & Normalization**: `94 / 100`
- **Transaction Atomicity & ACID Conformance**: `92 / 100`
- **Data Lifecycle & Pruning Automation**: `58 / 100` (Degraded by wiretap retention gap)
- **Query Performance & Indexing**: `90 / 100`
- **Overall Database & Storage Score**: **83.5 / 100**
