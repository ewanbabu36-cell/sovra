# SOVRA — PHASE 1 ADMINISTRATIVE AUTHORIZATION MATRIX
**Task ID:** TSK-P0-01 (RBAC & Administrative Access Forensic Audit)  
**Auditor Role:** Senior Application Security Auditor  
**Primary Artifacts Inspected:**  
- `scripts/dev-server.ts` (Lines 89140–89350, 98700–101300)
- `scripts/routes/admin_features.routes.ts` (Lines 1–314)
- `scripts/database-sqlite.ts` (Lines 4240–4260, 4420–4490, 6235–6350)
**Evaluation Standard:** Zero-Trust Administrative Principle of Least Privilege  
**Overall Section Verdict:** ❌ **FAIL (CRITICAL PRIVILEGE ESCALATION & UNPROTECTED ROUTES)**

---

## 1. ADMINISTRATIVE ENDPOINT SECURITY REGISTER

An exhaustive audit of every route under the `/api/admin/` prefix in the SOVRA codebase was performed. 

| # | HTTP Method | Endpoint Path | Source File & Line | Expected Permission | Applied Protection | Audit Verdict |
| :- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `POST` | `/api/admin/ghost/impersonate` | `dev-server.ts#L99597` | SUPER_ADMIN | **NONE (Zero Auth)** | ❌ **CRITICAL BACKDOOR** |
| 2 | `POST` | `/api/admin/multisig/propose` | `dev-server.ts#L98923` | MULTISIG_PROPOSE | Fallback to `SUPER_ADMIN` | ❌ **CRITICAL ROOT FALLBACK** |
| 3 | `POST` | `/api/admin/multisig/sign` | `dev-server.ts#L98950` | MULTISIG_SIGN | Fallback to `SUPER_ADMIN` | ❌ **CRITICAL ROOT FALLBACK** |
| 4 | `POST` | `/api/admin/circuit-breaker/toggle` | `dev-server.ts#L98982` | SYSTEM_EMERGENCY | Fallback to `admin_root` | ❌ **CRITICAL ROOT FALLBACK** |
| 5 | `POST` | `/api/admin/revenue/take-rate` | `dev-server.ts#L99344` | SYSTEM_CONFIG | **NONE (Shadows hardened route)** | ❌ **CRITICAL UNPROTECTED** |
| 6 | `POST` | `/api/admin/revenue/transfer` | `dev-server.ts#L99408` | TREASURY_TRANSFER | **NONE (Direct token drain)** | ❌ **CRITICAL UNPROTECTED** |
| 7 | `GET` | `/api/admin/treasury/solvency` | `dev-server.ts#L98828` | TREASURY_AUDIT | **NONE (Open PII/Financials)** | ❌ **HIGH RISK EXPOSURE** |
| 8 | `GET` | `/api/admin/treasury/export-csv`| `dev-server.ts#L98835` | TREASURY_AUDIT | **NONE (Exposes all TXs)** | ❌ **HIGH RISK EXPOSURE** |
| 9 | `GET` | `/api/admin/treasury/stream` | `dev-server.ts#L98850` | TREASURY_AUDIT | **NONE (Realtime stream)** | ❌ **HIGH RISK EXPOSURE** |
| 10 | `POST` | `/api/admin/algorithm/dial` | `dev-server.ts#L99059` | CONTENT_ADMIN | **NONE (Virality control)** | ❌ **HIGH RISK EXPOSURE** |
| 11 | `POST` | `/api/admin/moderation/shadowban`| `dev-server.ts#L99097` | MODERATOR | **NONE (Censorship risk)** | ❌ **HIGH RISK EXPOSURE** |
| 12 | `POST` | `/api/admin/broadcast/publish` | `dev-server.ts#L99212` | BROADCAST_ADMIN | **NONE (Global banner injection)** | ❌ **HIGH RISK EXPOSURE** |
| 13 | `GET` | `/api/admin/compliance/dossier/:did`| `dev-server.ts#L99265` | COMPLIANCE_OFFICER | **NONE (Exposes full user PII)** | ❌ **HIGH RISK EXPOSURE** |
| 14 | `POST` | `/api/admin/panopticon/terminate` | `dev-server.ts#L99448` | SESSION_ADMIN | **NONE (Session hijacking/DoS)** | ❌ **HIGH RISK EXPOSURE** |
| 15 | `GET` | `/api/admin/panopticon/sessions`| `dev-server.ts#L99440` | SESSION_ADMIN | **NONE (Exposes active sessions)**| ❌ **HIGH RISK EXPOSURE** |
| 16 | `POST` | `/api/admin/rbac/assign` | `admin_features.routes.ts#L102`| ADMIN_WRITE | `checkAdminRbac(ADMIN_WRITE)` | ✅ **VERIFIED SECURE** |
| 17 | `POST` | `/api/admin/kill-switch` | `admin_features.routes.ts#L135`| EMERGENCY_SHUTDOWN | `checkAdminRbac(EMERGENCY_SHUTDOWN)` | ✅ **VERIFIED SECURE** |
| 18 | `POST` | `/api/admin/balance/adjust` | `admin_features.routes.ts#L168`| TREASURY_TRANSFER | `checkAdminRbac(TREASURY_TRANSFER)` | ✅ **VERIFIED SECURE** |
| 19 | `POST` | `/api/admin/badge/toggle` | `admin_features.routes.ts#L210`| BADGE_ADMIN | `checkAdminRbac(BADGE_ADMIN)` | ✅ **VERIFIED SECURE** |
| 20 | `POST` | `/api/admin/take-rate` | `admin_features.routes.ts#L248`| SYSTEM_CONFIG | `checkAdminRbac(SYSTEM_CONFIG)` | ✅ **VERIFIED SECURE** |
| 21 | `POST` | `/api/admin/compliance/freeze` | `admin_features.routes.ts#L282`| COMPLIANCE_FREEZE | `checkAdminRbac(COMPLIANCE_FREEZE)` | ✅ **VERIFIED SECURE** |

---

## 2. DEEP FORENSIC INVESTIGATION OF CRITICAL VULNERABILITIES

### 2.1 The Ghost Impersonation Backdoor (`POST /api/admin/ghost/impersonate`)
- **Location:** `scripts/dev-server.ts#L99597-L99626`
- **Source Code Forensic:**
  ```typescript
  if (req.method === 'POST' && pathname === '/api/admin/ghost/impersonate') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const { targetDid, reason } = parsed;
        if (!targetDid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'targetDid is required' }));
        }
        const ghostToken = 'gst_' + crypto.randomBytes(24).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        db.prepare(`
          INSERT INTO user_sessions (session_token, user_did, expires_at, revoked, created_at)
          VALUES (?, ?, ?, 0, datetime('now'))
        `).run(ghostToken, targetDid, expiresAt);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ghostToken, impersonating: targetDid }));
      } catch (err: any) { ... }
    });
    return;
  }
  ```
- **Auditor Analysis:**
  This endpoint permits **unrestricted, unauthenticated account takeover** of ANY user in the system, including `did:sovra:admin_root` and `did:sovra:admin_alpha`.
  - No check on `req.headers.authorization`.
  - No Ed25519 cryptographic signature check.
  - No RBAC or admin user check.
  - Simply sending `{"targetDid": "did:sovra:admin_root"}` generates an active session token conferring full super-admin access.
- **Risk Severity:** **CRITICAL (CVSS 9.8)**.

---

### 2.2 Synthetic Root Privilege Fallbacks
- **Location:** `scripts/dev-server.ts#L98923-L98990`
- **Source Code Forensic:**
  ```typescript
  // Line 98923 - Multisig Propose
  const principal = resolvePrincipal(req, parsed) || {
    did: parsed.proposerDid || 'did:sovra:admin_alpha',
    role: parsed.role || 'SUPER_ADMIN',
    authType: 'legacy_header'
  };

  // Line 98950 - Multisig Sign
  const principal = resolvePrincipal(req, parsed) || {
    did: parsed.signerDid || 'did:sovra:admin_alpha',
    role: parsed.role || 'SUPER_ADMIN',
    authType: 'legacy_header'
  };

  // Line 98982 - Circuit Breaker Emergency Kill-Switch
  const principal = resolvePrincipal(req, parsed) || {
    did: parsed.adminDid || 'did:sovra:admin_root',
    role: 'SUPER_ADMIN',
    authType: 'legacy_header'
  };
  ```
- **Auditor Analysis:**
  The developer attempted to integrate `resolvePrincipal()`, but retained an insecure fallback. When an attacker supplies NO credentials at all:
  1. `resolvePrincipal(req, parsed)` evaluates to `null`.
  2. The logical OR operator `||` catches the `null` and assigns the fallback object.
  3. The caller is automatically elevated to `SUPER_ADMIN` with DID `did:sovra:admin_root` or whatever `adminDid` they placed in the unverified request body!
  4. The emergency circuit breaker, system kill-switch, and multisig treasury governance can be triggered by anyone.
- **Risk Severity:** **CRITICAL (CVSS 9.8)**.

---

### 2.3 Shadowing & Unauthenticated Revenue Endpoints
- **Location:** `scripts/dev-server.ts#L99344` & `L99408`
- **Source Code Forensic:**
  While `admin_features.routes.ts#L248` implements a secured take-rate route (`POST /api/admin/take-rate`) protected by `checkAdminRbac(SYSTEM_CONFIG)`, `scripts/dev-server.ts#L99344` registers a duplicate route:
  ```typescript
  // Line 99344 - dev-server.ts
  if (req.method === 'POST' && pathname === '/api/admin/revenue/take-rate') {
    // ZERO AUTHENTICATION OR RBAC CHECK
    const { newRate, category } = parsed;
    db.prepare('UPDATE system_configs SET value = ? WHERE key = ?').run(newRate, `take_rate_${category}`);
    ...
  }
  ```
  Furthermore, `POST /api/admin/revenue/transfer` at line 99408 allows atomic balance manipulation:
  ```typescript
  // Line 99408 - dev-server.ts
  if (req.method === 'POST' && pathname === '/api/admin/revenue/transfer') {
    // ZERO AUTHENTICATION OR RBAC CHECK
    const { fromDid, toDid, amount } = parsed;
    db.prepare('UPDATE balances SET amount = amount - ? WHERE did = ?').run(amount, fromDid);
    db.prepare('UPDATE balances SET amount = amount + ? WHERE did = ?').run(amount, toDid);
    ...
  }
  ```
- **Auditor Analysis:** Any anonymous actor on the network can siphon arbitrary funds or alter system revenue parameters without logging into the platform.
- **Risk Severity:** **CRITICAL (CVSS 9.1)**.

---

## 3. DATABASE LEDGER & PERMISSION METHOD INTEGRITY

### 3.1 Forensic Trace of `hasPermission()`
- **Location:** `scripts/database-sqlite.ts#L4240-L4255`
- **Code:**
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
- **Auditor Finding:** `hasPermission()` is well-constructed and strictly checks `admin_users` status and permissions. However, it is **never called** by the legacy route handlers in `scripts/dev-server.ts`.

### 3.2 The Non-Existent `executeTreasuryTransfer()` Claim
- **Developer Report Claim:** The developer's Phase 1 report asserted:
  > *"Secured `executeTreasuryTransfer()` on lines 4880–4920 of `scripts/database-sqlite.ts` by requiring adminDid and checking hasPermission()."*
- **Forensic Truth:**
  - A comprehensive search of the repository confirms that **no function named `executeTreasuryTransfer` exists**.
  - Lines 4880–4920 of `scripts/database-sqlite.ts` actually contain `detectWashTradingCyclesDFS()` (a graph-traversal algorithm for fraud detection).
  - The actual ledger transfer function in `database-sqlite.ts` is `executeAtomicLedgerTransfer()` at line 4422:
    ```typescript
    executeAtomicLedgerTransfer(fromDid: string, toDid: string, amount: number, memo: string, adminDid?: string)
    ```
  - While `executeAtomicLedgerTransfer()` records `adminDid` in audit logs if provided, it **does not call `hasPermission()`**. It relies entirely on callers to enforce authorization, which multiple routes fail to do.

---

## 4. REMEDIATION REQUIREMENTS

To achieve an authorized PASS for Administrative Authorization:

1. **Delete Backdoor:** Completely remove `POST /api/admin/ghost/impersonate` from `scripts/dev-server.ts`.
2. **Remove Fallbacks:** Rewrite all multisig and circuit breaker handlers to unconditionally reject any request where `resolvePrincipal(req)` is null or lacking the verified `SUPER_ADMIN` role:
   ```typescript
   const principal = resolvePrincipal(req, parsed);
   if (!principal) {
     res.writeHead(401, { 'Content-Type': 'application/json' });
     return res.end(JSON.stringify({ error: 'Authentication required' }));
   }
   if (!hasPermission(principal.did, 'SYSTEM_EMERGENCY')) {
     res.writeHead(403, { 'Content-Type': 'application/json' });
     return res.end(JSON.stringify({ error: 'Forbidden' }));
   }
   ```
3. **Unify Routing:** Deprecate and remove legacy `/api/admin/` routes in `scripts/dev-server.ts` and ensure all administrative traffic is mediated by `scripts/routes/admin_features.routes.ts` using `checkAdminRbac()`.
4. **Enforce Ledger Guard:** Add mandatory `hasPermission(adminDid, 'TREASURY_TRANSFER')` checks inside `executeAtomicLedgerTransfer()`.
