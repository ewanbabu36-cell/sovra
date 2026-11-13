# SOVRA — PHASE 1 GIT DIFF FORENSIC REVIEW
**Task ID:** TSK-P0-01 (Code Modification & Integrity Forensic Audit)  
**Auditor Role:** Senior Application Security Auditor  
**Repository Branch:** `remediation/p0-phase4.0-database-modernization`  
**Evaluation Standard:** Zero-Trust Forensic Verification of Code Changes vs Stated Claims  
**Overall Section Verdict:** ⚠️ **INCONSISTENT (SUBSTANTIAL DEFICIENCIES & UNVERIFIED CLAIMS)**

---

## 1. REPOSITORY & WORKING TREE FORENSICS

### 1.1 Branch & Commit State
- **Active Branch:** `remediation/p0-phase4.0-database-modernization`
- **Working Tree Status:** Multiple untracked documentation files and security test suites; core runtime files modified.
- **Git Diff Volume:**
  - `scripts/dev-server.ts`: +1,120 lines / -164 lines
  - `scripts/database-sqlite.ts`: +148 lines / -32 lines
  - `scripts/routes/admin_features.routes.ts`: +203 lines / -21 lines
  - `tests/security/did_spoofing.test.ts`: +360 lines (new test suite)

---

## 2. LINE-BY-LINE FORENSIC ANALYSIS OF MODIFIED FILES

### 2.1 File: `scripts/dev-server.ts`

#### A. Introduction of `resolvePrincipal()` (`L89140–L89350`)
- **What was added:**
  - An in-memory replay cache `replayNonceCache` (Map) with periodic 60-second garbage collection.
  - Public key lookup from SQLite `dids` table.
  - Ed25519 signature verification using Node.js built-in `crypto.verify()`.
  - Timestamp freshness checks (5-minute expiration, 1-minute future drift).
  - Bearer session token verification via SQLite `user_sessions` table.
- **Forensic Assessment:**
  - The positive change is that `resolvePrincipal()` no longer returns a principal when only `X-Sovra-DID` is supplied.
  - **Forensic Flaw 1 (Body Integrity):** Line 89275 constructs `const canonicalPayload = `${req.method}:${canonicalPath}:${nonce}:${timestamp}`. The developer omitted the request body, creating a critical tampering vector.
  - **Forensic Flaw 2 (Nonce Scoping):** Line 89141 defines `replayNonceCache` as global. It fails to scope nonces by DID (`${did}:${nonce}`), creating a cross-user DoS risk.

#### B. Administrative Route Modifications (`L98700–L101300`)
- **What was modified:**
  - The developer attempted to wrap certain endpoints with `resolvePrincipal()`.
- **Forensic Discrepancy & Omissions:**
  - **The Multisig & Circuit Breaker Fallback:** On lines 98923, 98950, and 98982, the developer introduced:
    ```typescript
    const principal = resolvePrincipal(req, parsed) || {
      did: parsed.adminDid || 'did:sovra:admin_root',
      role: 'SUPER_ADMIN',
      authType: 'legacy_header'
    };
    ```
    This change nullified the security benefit of `resolvePrincipal()` by creating an unauthenticated super-admin fallback branch!
  - **Ghost Impersonation Ignored:** The developer left `POST /api/admin/ghost/impersonate` completely untouched on lines 99597–99626.
  - **Shadowing Routes Ignored:** Legacy unauthenticated routes for take-rate (L99344) and balance transfer (L99408) were left in `dev-server.ts`, even though a hardened route was created in `admin_features.routes.ts`.

---

### 2.2 File: `scripts/database-sqlite.ts`

#### A. RBAC Permission Engine (`L4240–L4255`)
- **What was added:**
  ```typescript
  hasPermission(did: string, requiredPermission: string): boolean {
    const admin = this.db.prepare(
      'SELECT role, active FROM admin_users WHERE did = ?'
    ).get(did) as { role: string; active: number } | undefined;
    if (!admin || !admin.active) return false;
    const permissions = ROLE_PERMISSIONS[admin.role] || [];
    return permissions.includes(requiredPermission) || permissions.includes('ALL');
  }
  ```
- **Forensic Assessment:**
  - This is a well-designed, clean implementation. It correctly checks both role membership and active status.
  - It handles the `ALL` wildcard for `SUPER_ADMIN`.

#### B. Audit Logging & Balance Adjustment (`L6235–L6346`)
- **What was added:**
  - `adjustUserBalanceWithAudit(adminDid, targetDid, delta, reason)`:
    - Verifies `hasPermission(adminDid, 'TREASURY_TRANSFER')`.
    - Updates balances atomically within a transaction.
    - Writes an immutable record to `audit_logs`.
- **Forensic Assessment:**
  - High quality implementation with strict transaction rollbacks and tamper-evident audit logging.

#### C. Forensic Investigation of Developer's Claim Regarding `executeTreasuryTransfer`
- **Developer Stated Claim:**
  > *"Hardened `executeTreasuryTransfer()` on lines 4880–4920 of `scripts/database-sqlite.ts` by requiring adminDid and checking hasPermission()."*
- **Forensic Analysis of Git Diff:**
  - An inspection of git diff and file contents between lines 4850 and 4950 reveals:
    ```typescript
    // Lines 4880-4920 in scripts/database-sqlite.ts:
    detectWashTradingCyclesDFS(startDid: string, maxDepth: number = 4): string[][] {
      const visited = new Set<string>();
      const recursionStack = new Set<string>();
      const cycles: string[][] = [];
      ...
    }
    ```
  - **There is no `executeTreasuryTransfer` method.**
  - The actual ledger transfer method is `executeAtomicLedgerTransfer` at line 4422, which was **not modified** to check `hasPermission()`.
  - **Verdict:** The developer's claim is an inaccurate documentation statement.

---

### 2.3 File: `scripts/routes/admin_features.routes.ts`

- **What was added:**
  - Created modular handler `handleAdminFeatureRoute()` covering:
    - `/api/admin/rbac/assign`
    - `/api/admin/kill-switch`
    - `/api/admin/balance/adjust`
    - `/api/admin/badge/toggle`
    - `/api/admin/take-rate`
    - `/api/admin/compliance/freeze`
  - Integrated `checkAdminRbac(req, requiredPermission)` across each of these routes.
- **Forensic Assessment:**
  - The implementation in this file represents good architectural design. It enforces RBAC and rejects unauthenticated callers with HTTP 401/403.
  - **Limitation:** This file only handles 6 endpoints. It leaves the remaining ~15 administrative endpoints in `scripts/dev-server.ts` completely unprotected.

---

## 3. SUMMARY OF FORENSIC DISCREPANCIES

| Developer Documentation Assertion | Verified Git Reality | Severity |
| :--- | :--- | :--- |
| "All administrative endpoints protected by RBAC" | Over 50% of admin endpoints remain in `scripts/dev-server.ts` with zero auth or insecure fallbacks. | **CRITICAL** |
| "Modified `executeTreasuryTransfer()` in `database-sqlite.ts`" | Method does not exist. Lines 4880-4920 are wash trading DFS. Real transfer method lacks RBAC. | **HIGH** |
| "`tests/e2e/admin-systems-security-api.test.ts` passed 7/7" | Fails with exit code 1 (2 failing tests due to unauthenticated fixtures). | **HIGH** |
| "Ed25519 signatures protect request integrity" | Omits request body from canonical string. Vulnerable to payload tampering. | **HIGH** |

---

## 4. FORENSIC AUDITOR CONCLUSION

The Git diff reveals a bifurcation in code quality:
1. Newly authored modules (`admin_features.routes.ts` and `tests/security/did_spoofing.test.ts`) exhibit solid defensive security patterns.
2. The core monolithic runtime (`scripts/dev-server.ts`) was only superficially patched, leaving active backdoors (`ghost/impersonate`), critical root fallbacks in multisig/kill-switch handlers, and shadowed unauthenticated endpoints.

The codebase is not yet in a safe or auditable state for production or Phase 2 progression.
