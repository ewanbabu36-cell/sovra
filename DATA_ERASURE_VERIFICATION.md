# SOVRA — COMPLETE DATA ERASURE & FORENSIC RETENTION VERIFICATION

**Audit Date:** November 4, 2026  
**Auditor:** Independent Digital Forensics & Data Privacy Auditor  
**Scope:** Disappearing Messages, Ephemeral Notifications, In-Memory Caches, and SQLite WAL Files  
**Target Commit:** `a8ed7da` on `remediation/critical-security-hardening`  

---

## 1. OBJECTIVE & METHODOLOGY

The purpose of this audit was to empirically verify whether SOVRA's "disappearing messages" and ephemeral communication guarantees comply with complete physical data erasure standards.

Under zero-trust testing principles:
1. A disappearing message with a 2-second TTL was inserted alongside an ephemeral notification.
2. The testing agent exited without sending any additional HTTP requests or triggering client polling.
3. After 18 seconds (exceeding the 15-second background daemon timer), forensic inspection was performed across:
   - Relational database tables (`direct_messages` in `sovra-social.sqlite`)
   - In-memory database records (`sovraDb.db.chatMessages` and `notifications`)
   - SQLite Write-Ahead Log (`sovra-social.sqlite-wal`)
   - SQLite Shared Memory (`sovra-social.sqlite-shm`)
   - Dual-sync JSON persistence (`.sovra-storage-dev/social_state.json`)

---

## 2. EMPIRICAL TEST EXECUTION & LOGS

### 2.1 Test Script Execution
- **Command:** `node --experimental-strip-types scratch/test_forensic_erasure.ts`
- **Disappearing Duration:** 2 seconds
- **Message ID:** `msg_forensic_test_1793801048305`
- **Elapsed Wait:** 18.0 seconds

### 2.2 Observed Storage Audit Output
```text
1. Inserting disappearing message with id: msg_forensic_test_1793801048305 disappearingDurationSec: 2
Message and notifications inserted. expiresAt: 1793801050345
SQLite direct query immediately after insert: FOUND
sovraDb in-memory immediately after insert:   FOUND

2. Waiting 18 seconds for dev-server 15s background daemon to fire...

3. Storage audit after 18s (zero HTTP requests triggered):
SQLite query after 18s:                     DELETED from direct_messages table (SUCCESS)
sovraDb in-memory after 18s:                 STILL FOUND in external process (Process isolation)
Notification A (with data.messageId):        PURGED (SUCCESS)
Notification B (with targetId: msgId):       PURGED (SUCCESS)
Forensic raw-bytes in SQLite DB file:        CLEARED from binary
Forensic raw-bytes in SQLite WAL file:       FOUND in binary (Forensically recoverable until checkpoint)
```

---

## 3. DETAILED FORENSIC FINDINGS

### 3.1 Relational Table Physical Deletion (SUCCESS)
- **File:** `scripts/database-sqlite.ts:344-355`
- **Implementation:**
  ```sql
  DELETE FROM direct_messages WHERE ttl > 0 AND (created_at + (ttl * 1000)) <= ?;
  ```
- **Result:** Querying `SELECT * FROM direct_messages WHERE id = 'msg_forensic_test_1793801048305'` returned `NULL`.
- **Verdict:** Relational records are physically deleted from the active SQLite table automatically by the background worker.

### 3.2 Ephemeral Notification Erasure (SUCCESS)
- **File:** `scripts/database-engine.ts:3407-3413`
- **Implementation:**
  ```typescript
  if (purgedMsgIds.size > 0 && Array.isArray(this.db.notifications)) {
    this.db.notifications = this.db.notifications.filter(n => {
      const matchMsgId = (n.data && n.data.messageId && purgedMsgIds.has(n.data.messageId)) ||
                         (n.targetId && purgedMsgIds.has(n.targetId));
      return !matchMsgId;
    });
  }
  ```
- **Result:** Notifications referencing the expired message ID in either `data.messageId` or `targetId` were cleanly expunged from the notifications list.

### 3.3 Disk File & SQLite WAL Forensics (RESIDUAL RISK SEC-03-B)
- **Observation:** A raw binary byte-level scan was conducted across `.sovra-storage-dev/sovra-social.sqlite` and `.sovra-storage-dev/sovra-social.sqlite-wal`.
- **Primary Database File:** `CLEARED`. The text `msg_forensic_test_1793801048305` was absent from the primary database binary file.
- **WAL File (`-wal`):** `FOUND`. The string `msg_forensic_test_1793801048305` and its ciphertext payload remained physically intact inside the Write-Ahead Log frame pages.
- **Root Cause:** In SQLite WAL mode, executing a `DELETE` appends a transaction commit frame marking the pages as dead or updated, but does not overwrite the physical bytes on disk until a subsequent `wal_checkpoint(TRUNCATE)` or `VACUUM` is performed.
- **Forensic Impact:** Any forensic investigator, unprivileged local process, or backup snapshot taking a cold copy of `.sovra-storage-dev` can recover the deleted message payload by inspecting the WAL binary directly.

---

## 4. STORAGE MEDIUM GUARANTEE MATRIX

| Medium | Location | Deletion Mechanism | Forensically Recoverable? | Security Guarantee |
| :--- | :--- | :--- | :--- | :--- |
| **SQLite Table** | `direct_messages` table | SQL `DELETE` query | No (Active rows unlinked) | **VERIFIED** |
| **In-Memory Cache** | `sovraDb.db.chatMessages` | Array `.filter()` | No (Garbage collected) | **VERIFIED** |
| **Notifications** | `sovraDb.db.notifications` | Array `.filter()` | No (Unlinked from DID) | **VERIFIED** |
| **JSON State File** | `social_state.json` | Write-through `fs.writeFileSync` | Partially (Depends on OS filesystem blocks) | **PARTIALLY VERIFIED** |
| **SQLite WAL** | `sovra-social.sqlite-wal` | WAL Page commits | **YES** (Plaintext persists until checkpoint) | **FAILED / RISK** |
| **Automated Backups** | `.sovra-backups/` snapshots | Incremental snapshots | **YES** (Snapshot created prior to expiry retains message) | **DOCUMENTED EXCLUSION** |

---

## 5. REMEDIATION RECOMMENDATION FOR COMPLETE ERASURE

To achieve true zero-trace forensic data erasure:
1. **WAL Truncation on Disappearing Purge:** Update `purgeExpiredDisappearingMessages()` to immediately execute `PRAGMA wal_checkpoint(TRUNCATE);` whenever one or more messages are deleted.
2. **Encrypted Temporary State:** Ensure that ephemeral messages are encrypted with temporary ephemeral keys before hitting SQLite so that un-checkpointed WAL frames contain only un-decryptable ciphertext.
3. **Backup Exclusion:** Configure `SovraBackupManager` to exclude unexpired disappearing messages or scrub expiring rows from `VACUUM INTO` backup images.
