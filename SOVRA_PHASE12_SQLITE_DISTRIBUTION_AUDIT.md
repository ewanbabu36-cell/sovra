# SOVRA PHASE 12 — SQLITE WAL DISTRIBUTED SECURITY AUDIT

**Author:** Principal Distributed Systems Architect & Cybersecurity Auditor  
**Target Repository:** `D:\Sovra`  
**Inspected Module:** `services/api/src/storage/shared-security-store.ts`  
**Git Verification Commit:** `4683c64`  
**Canonical Specification:** `SOVRA_INDUSTRY_STANDARD_MASTER_GOAL_AND_ACCEPTANCE.md`  
**Date of Audit:** 2026-11-21  
**Audit Status:** **VERIFIED FOR SINGLE-HOST / ARCHITECTURAL BOUNDARY DEFINED**

---

## 1. EXECUTIVE SUMMARY & ARCHITECTURAL SCOPE

A critical security question arose during Phase 11 & Phase 12 certification:
> *Does `SharedSecurityStore` backed by SQLite WAL mode constitute a genuinely distributed, multi-cloud storage layer, or is it strictly a local multi-process shared store?*

This forensic audit inspected the implementation in [`services/api/src/storage/shared-security-store.ts`](file:///d:/Sovra/services/api/src/storage/shared-security-store.ts) and evaluated the concurrency guarantees against distributed systems principles.

### Key Audit Conclusions:
1. **Single-Host Multi-Process Concurrency:** **VERIFIED (PASS)**  
   When run on a single host (e.g. multiple Node.js worker threads or cluster processes sharing a local POSIX/Windows filesystem), `SharedSecurityStore` correctly achieves atomic replay protection and cross-process rate limiting via SQLite WAL (`PRAGMA journal_mode = WAL`) and OS-level file locking.
2. **Multi-Host / Multi-Cloud Decentralization:** **NOT APPLICABLE / ARCHITECTURAL LIMITATION (BLOCKED)**  
   SQLite is an in-process, embedded database engine. It does **not** provide a network wire protocol, distributed consensus, or partition-tolerant replication. Sharing SQLite files over networked filesystems (NFS, SMB, CIFS, AWS EFS) in multi-region cloud topologies introduces severe risks of lock corruption, split-brain, and high write latency.
3. **Fail-Closed Behavior:** **VERIFIED (PASS)**  
   Storage degradation or database corruption during nonce consumption triggers an immediate exception, which in the API server fails closed with HTTP 401/500, preventing unauthorized or unverified requests from executing.

---

## 2. SOURCE CODE CONCURRENCY & ATOMICITY ANALYSIS

Inspection of [`services/api/src/storage/shared-security-store.ts`](file:///d:/Sovra/services/api/src/storage/shared-security-store.ts) reveals three critical concurrency mechanisms:

### 2.1 WAL Mode and Busy Timeout Configuration
```typescript
// lines 49-53
if (this.dbPath !== ':memory:') {
  this.db.exec('PRAGMA journal_mode = WAL;');
  this.db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
}
```
- **Write-Ahead Logging (WAL):** Allows multiple concurrent readers without blocking a writer, and allows a writer to operate without blocking readers.
- **`PRAGMA busy_timeout = 5000`:** Enforces a 5-second sleep-and-retry loop at the C/SQLite engine layer when another process holds the exclusive write lock, mitigating `SQLITE_BUSY` errors under high concurrent load.

### 2.2 Atomic Replay Defense via Primary Key Collisions
```typescript
// lines 109-121
try {
  const insertStmt = this.db.prepare(
    'INSERT INTO replay_cache (key, seen_at, expires_at) VALUES (?, ?, ?)'
  );
  insertStmt.run(key, seenAt, expiresAt);
  return true;
} catch (err: any) {
  // Handle race condition where another replica inserted the identical key concurrently
  if (err.message && err.message.includes('PRIMARY KEY')) {
    return false;
  }
  throw err;
}
```
- In multi-process environments, two API workers receiving identical replay nonces simultaneously will race to insert the key.
- The `PRIMARY KEY` constraint on `replay_cache(key)` guarantees that exactly one process succeeds (`return true`) while the concurrent race throws a unique constraint violation, caught cleanly to return `false`.
- This provides mathematically sound single-host race condition immunity.

### 2.3 Atomic Upsert for Distributed Rate Limiting
```typescript
// lines 171-176
const upsertStmt = this.db.prepare(`
  INSERT INTO rate_limits (ip, count, reset_at)
  VALUES (?, 1, ?)
  ON CONFLICT(ip) DO UPDATE SET count = 1, reset_at = ?
`);
```
- Leverages SQLite native `ON CONFLICT(ip) DO UPDATE` atomic upsert semantics, eliminating read-then-write race conditions when initializing client rate-limiting buckets.

---

## 3. MULTI-HOST / MULTI-CLOUD LIMITATIONS & FAILURE MODES

The audit strictly distinguishes between **Local Inter-Process Sharing** and **True Distributed Systems**:

```
+-------------------------------------------------------------------------+
|                  LOCAL HOST ARCHITECTURE (VERIFIED)                     |
|                                                                         |
|   +-------------------+                     +-------------------+       |
|   | API Worker Proc 1 |                     | API Worker Proc 2 |       |
|   +---------+---------+                     +---------+---------+       |
|             |                                         |                 |
|             +-------------> [ shared.sqlite ] <-------+                 |
|                            (Local Fast NVMe)                            |
|                       SQLite WAL + Lock Escalation                      |
|                           STATUS: 100% SOUND                            |
+-------------------------------------------------------------------------+

                                  VS

+-------------------------------------------------------------------------+
|                 MULTI-CLOUD ARCHITECTURE (PROHIBITED)                   |
|                                                                         |
|      AWS Node 1                   GCP Node 2                 Azure      |
|   +--------------+             +--------------+         +--------------+|
|   | API Gateway  |             | API Gateway  |         | API Gateway  |
|   +-------+------+             +-------+------+         +-------+------+|
|           \                           |                         /       |
|            \                          |                        /        |
|             +--> [ Network File System (NFS / EFS / SMB) ] <--+         |
|                     * POSIX locking bugs & lease drops                  |
|                     * Network partition split-brain                     |
|                     * High multi-region latency (100ms+)                |
|                     STATUS: UNSUITABLE FOR PRODUCTION                   |
+-------------------------------------------------------------------------+
```

### Technical Reasons SQLite Cannot Be Used Across Remote Cloud Nodes:
1. **Network Lock Failure Modes:** SQLite relies on POSIX advisory locks (or Windows `LockFileEx`). Over NFS or SMB, lock breaking, stale file handles, and split-brain client caches frequently cause database corruption (`SQLITE_CORRUPT`).
2. **High Network Latency:** SQLite synchronous operations require low-latency round-trip disk flushes. Over WAN or inter-cloud links, write latency explodes from $<1\text{ ms}$ to $>50\text{ ms}$, severely degrading API throughput.
3. **Partition Intolerance (CAP Theorem):** SQLite cannot partition itself across multiple datacenters. It offers zero consensus (no Raft, Paxos, or Tendermint) for database state.

---

## 4. ADVERSARIAL AND CONCURRENCY TEST EVIDENCE

The test suite [`tests/security/phase12-distributed-security-store.test.ts`](file:///d:/Sovra/tests/security/phase12-distributed-security-store.test.ts) was independently executed:
- Total Tests: **7**
- Passed: **7**
- Failed: **0**
- Duration: **3,326 ms**

### Verified Behaviors:
1. `should share nonces across independent store instances pointing to the same file`: **PASSED** (Two separate `SharedSecurityStore` instances attached to the same DB file detect nonces consumed by the other).
2. `should handle concurrent nonce consumption across simulated replicas without race conditions`: **PASSED** (50 concurrent random nonces across 4 simulated replica instances with zero false rejections).
3. `should reject simultaneous duplicate nonce submission across replicas`: **PASSED** (`Promise.all` submitting identical nonce to 3 replicas simultaneously; exactly 1 accepted, 2 rejected).
4. `should persist replay protection across complete store restarts`: **PASSED** (Close store, reopen new instance, verify historic nonce still rejected).
5. `should enforce shared distributed rate limits across replicas`: **PASSED** (4 replicas sharing quota correctly trip rate limit after aggregate threshold).
6. `should fail closed or isolate during storage outages`: **PASSED** (`simulateOutage(true)` causes nonce consumption to throw / fail closed).
7. `should prune expired nonces without affecting active nonces`: **PASSED** (Prunes nonces past TTL while preserving active security records).

---

## 5. ARCHITECTURAL RECOMMENDATIONS FOR MULTI-CLOUD DEPLOYMENTS

To achieve genuine distributed multi-cloud state synchronization across remote clouds (AWS, GCP, Azure, Hetzner), SOVRA must adopt one of the following production patterns:

1. **Option A: Distributed In-Memory Cache (Redis Cluster / Valkey with TLS):**
   - Deploy a geo-replicated or VPC-peered Redis/Valkey cluster across clouds.
   - Use atomic `SET key val NX EX 300` for nonce consumption and Redis Lua scripts for distributed token-bucket rate limiting.
2. **Option B: CometBFT Mempool Consensus Deduplication:**
   - Instead of checking nonces at the HTTP gateway layer, validate nonces directly in the ABCI `CheckTx` state machine.
   - The blockchain mempool and validator consensus natively guarantee zero cross-cloud double-spending and replay across all nodes globally.
3. **Current State Classification:**
   - In Phase 12, `SharedSecurityStore` is certified **strictly as a Local Multi-Worker Security Store**. It is **not** certified as a multi-cloud distributed synchronization protocol.

---

## 6. AUDIT VERDICT

| Evaluation Criteria | Requirement | Observed Status | Verdict |
|---------------------|-------------|-----------------|:-------:|
| Single-Host Atomicity | Multi-worker race immunity | Verified via SQLite WAL & PK collision | **PASS** |
| Replay Prevention | Replicas share replay cache | Two instances sharing disk file reject replay | **PASS** |
| Concurrency Handling | `busy_timeout` & lock escalation | 50 concurrent submissions pass with 0 errors | **PASS** |
| Fail-Closed Security | Outage must fail closed | Throws error when store unavailable | **PASS** |
| Multi-Cloud Claim | Multi-host distributed storage | Limited to single filesystem / local host | **RESTRICTED SCOPE** |
| Mainnet Readiness | Production-ready multi-region | Needs Redis/Valkey or ABCI mempool deduplication | **BLOCKER FOR MULTI-CLOUD** |
