# SOVRA — PHASE 1: AUTHENTICATION REMEDIATION
## Task TSK-P0-01 Technical Architecture & Implementation Report

**Auditor/Engineer:** Principal Security Auditor & Senior Backend Engineer  
**Standard:** Zero-Trust Cryptographic Enforcement (CWE-287, CWE-290, CWE-345)  
**Status:** COMPLETE & VERIFIED  
**Date:** 2026-11-05  

---

### 1. Executive Summary

In Task `TSK-P0-01` of Phase 1, the critical identity spoofing vulnerability where arbitrary caller-supplied `X-Sovra-DID` headers were accepted as authoritative proof of identity was completely eliminated. The authentication layer has been transitioned to a strict Zero-Trust model where every request principal is established solely through cryptographic proof (valid Bearer session token, cookie-based session with CSRF protection, or Ed25519 cryptographic request signature with anti-replay nonce and timestamp bounding).

---

### 2. Vulnerability Analysis & Baseline Defect

#### 2.1 The Vulnerability (CWE-290: Authentication Bypass via Spoofed Header)
Prior to this remediation, `resolvePrincipal()` in `scripts/dev-server.ts` contained an unsafe header fallback:
```typescript
// VULNERABLE LEGACY PATTERN:
if (!token) {
  const didHeader = (req.headers['x-sovra-did'] as string)?.trim();
  if (didHeader) {
    const user = sovraDb.findUserByDid(didHeader);
    return createAuthenticatedPrincipal({
      did: didHeader,
      sessionId: 'header_fallback',
      role: user?.role || 'USER',
      authenticationMethod: 'HEADER_DID',
    });
  }
}
```
Because HTTP request headers are entirely under the control of untrusted network clients, an attacker could forge `X-Sovra-DID: <victim_did>` to read private notifications, publish social posts, initiate calls, or access sensitive endpoints under the victim's sovereign identity without possessing the victim's private key, session token, or security PIN.

#### 2.2 Attack Surface Impact
The header fallback undermined the core sovereign identity premise of SOVRA. Specifically:
- **Private Data Access:** Any unauthenticated caller could read notifications (`/api/notifications`), conversation histories, and profile states.
- **Unauthorized Mutating Operations:** An attacker could craft channel creation or post actions claiming any registered DID.
- **Account Masquerading:** Audit logs recorded the spoofed DID rather than an anonymous or attacker identifier.

---

### 3. Zero-Trust Remediation Implementation

The remediation was implemented directly in `scripts/dev-server.ts` across lines `89156–89305`, adhering to least-privilege zero-trust cryptographic verification.

#### 3.1 Strict Elimination of Direct `X-Sovra-DID` Header Trust
Direct trust in `X-Sovra-DID` without credentials has been completely removed:
```typescript
// Direct trust of X-Sovra-DID without session or signature is strictly eliminated
return null;
```
If a request presents only `X-Sovra-DID` without a verified Bearer token, session cookie, or cryptographic request signature, `resolvePrincipal()` returns `null`, causing authentication middleware to reject the request with `HTTP 401 Unauthorized`.

#### 3.2 Request-Level Principal Memoization
To prevent duplicate authentication parsing and eliminate race conditions against replay nonce stores during the request lifecycle, `resolvePrincipal` was refactored with request memoization:
```typescript
function resolvePrincipal(
  req: http.IncomingMessage,
  _parsedBody?: Record<string, any>,
): AuthenticatedPrincipal | null {
  if ((req as any)._resolvedPrincipal !== undefined) return (req as any)._resolvedPrincipal;
  const p = _doResolvePrincipal(req, _parsedBody);
  (req as any)._resolvedPrincipal = p;
  return p;
}
```

#### 3.3 Ed25519 Cryptographic Request Signing & Anti-Replay
For decentralized API clients, mobile devices, and peer nodes operating without centralized bearer tokens, an RFC-compliant Ed25519 cryptographic request signature mechanism was integrated into `_doResolvePrincipal`:
1. **Header Extraction:** Expects `X-Sovra-Signature`, `X-Sovra-DID` (or `did:key:`), `X-Sovra-Timestamp`, and `X-Sovra-Nonce`.
2. **Timestamp Window Verification:** Rejects any request where `Math.abs(Date.now() - ts) > 300_000` (5-minute maximum drift).
3. **Anti-Replay Nonce Enforcement:** Enforces single-use nonces via `checkAndRecordReplayNonce(nonce, timestamp)` stored in the durable replay store.
4. **Public Key Binding:**
   - If `did:key:`, public key is derived via `decodeEd25519DidKey(sigDid)` (multicodec `0xed01` prefix verified).
   - If `did:sov:`, public key is fetched from `sovraDb.findUserByDid(sigDid).publicKey`.
5. **Canonical Message Signing:** The signature is verified over the canonical string:
   ```
   METHOD:CANONICAL_PATH:NONCE:TIMESTAMP
   ```
   using `verifyEd25519(pubKey, canonicalBytes, sigBytes)`.
6. **Principal Binding:** Upon successful verification, the principal is bound with `authenticationMethod: 'ED25519_SIGNATURE'`.

#### 3.4 Protected Notification Endpoints
In `scripts/dev-server.ts:90838-90860`, the notifications endpoints were hardened:
```typescript
if (url.pathname === '/api/notifications' && req.method === 'GET') {
  const principal = resolvePrincipal(req);
  if (!principal) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Valid authentication required to access notifications' }));
    return;
  }
  const notifications = sovraDb.getNotifications(principal.did);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, notifications }));
  return;
}
```

---

### 4. Preservation of Legitimate Authentication Flows

All legitimate authentication paths were rigorously tested and confirmed functional:
1. **Security PIN Login:** `POST /api/user/login` with handle + 6-digit PIN derives scrypt verifier and issues authenticated session tokens.
2. **Session Bearer Tokens:** `Authorization: Bearer <sessionToken>` correctly resolves the authenticated user principal.
3. **Session Cookies:** `sovra_session_token` cookie authentication functions with CSRF origin validation.
4. **Cryptographic Ed25519 Signatures:** Verified key-signed requests succeed on first submission and fail on replay.
5. **Profile and Discovery Access:** `/api/user/me` accurately resolves the authenticated caller.

---

### 5. Architectural Boundaries & Phase 2 Roadmap

- **Active Runtime:** The active dev-server monolith (`scripts/dev-server.ts`) is fully remediated and enforces Zero-Trust identity verification.
- **Decoupled Package (`services/api/`):** The `@sovra/api` package in `services/api/src/controllers/` contains controller templates with legacy `req.headers['x-sovra-did']` fallbacks. Because this package is currently decoupled from the active server runtime, it did not impact runtime security. However, as part of Phase 2 microservices separation, the centralized `resolvePrincipal` middleware must be imported and enforced across `@sovra/api`.
