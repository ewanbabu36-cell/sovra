# SOVRA INDEPENDENT SETTINGS BOLA/IDOR VERIFICATION
**Audit ID:** SOVRA-6MOD-INDEPENDENT-VERIFICATION-001  
**Target:** Settings Endpoints & Cross-Tenant Access Control  
**Mode:** ZERO-TRUST FORENSIC VERIFICATION

---

## 1. Vulnerability Background

Previously, `/api/user/settings` and `/api/profile/update` in `scripts/dev-server.ts` allowed unauthenticated callers to default to `masterKey.did` or allowed any authenticated user to supply `?did=attacker_target` and read or mutate the victim's settings (Broken Object Level Authorization / Insecure Direct Object Reference).

---

## 2. Source-Code Verification of Fix

### 2.1 GET /api/user/settings (`scripts/dev-server.ts:91131`)
```typescript
const principal = enforceAuth(req, res);
if (!principal) return;
const requestedDid = url.searchParams.get('did');
const targetDid = requestedDid || principal.did;
if (targetDid !== principal.did && principal.role !== 'SUPER_ADMIN' && principal.role !== 'ADMIN') {
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Forbidden: Cannot access another user\'s settings' }));
  return;
}
```

### 2.2 POST /api/user/settings (`scripts/dev-server.ts:91152`)
```typescript
const parsed = JSON.parse(body || '{}');
const principal = enforceAuth(req, res, parsed);
if (!principal) return;
const requestedDid = url.searchParams.get('did') || parsed.did;
const targetDid = requestedDid || principal.did;
if (targetDid !== principal.did && principal.role !== 'SUPER_ADMIN' && principal.role !== 'ADMIN') {
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Forbidden: Cannot modify another user\'s settings' }));
  return;
}
```

### 2.3 POST /api/profile/update (`scripts/dev-server.ts:91176`)
```typescript
const parsed = JSON.parse(body || '{}');
const principal = enforceAuth(req, res, parsed);
if (!principal) return;
const requestedDid = url.searchParams.get('did') || parsed.did;
const targetDid = requestedDid || principal.did;
if (targetDid !== principal.did && principal.role !== 'SUPER_ADMIN' && principal.role !== 'ADMIN') {
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Forbidden: Cannot modify another user\'s profile' }));
  return;
}
```

---

## 3. Adversarial Runtime Verification Results

Runtime tests executed against active server:

| Scenario | Tested Endpoint | Attacker Action | Expected Status | Actual Status | Verdict |
|---|---|---|---|---|---|
| Unauthenticated Read | `GET /api/user/settings` | No auth headers | 401 Unauthorized | 401 Unauthorized | **VERIFIED** |
| Unauthenticated Write | `POST /api/user/settings` | No auth headers | 401 Unauthorized | 401 Unauthorized | **VERIFIED** |
| BOLA Cross-User Read | `GET /api/user/settings?did=Alice` | Eve credentials | 403 Forbidden | 403 Forbidden | **VERIFIED** |
| IDOR Settings Mutation | `POST /api/user/settings` | Eve targeting Alice | 403 Forbidden | 403 Forbidden | **VERIFIED** |
| IDOR Profile Mutation | `POST /api/profile/update` | Eve targeting Alice | 403 Forbidden | 403 Forbidden | **VERIFIED** |
| Authorized Self-Access | `GET /api/user/settings` | Alice credentials | 200 OK | 200 OK | **VERIFIED** |

**Conclusion:** The BOLA / IDOR vulnerability on Settings and Profile endpoints is **COMPLETELY CLOSED & VERIFIED**.
