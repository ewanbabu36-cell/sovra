# SOVRA PHASE 11 — HMAC REPLAY SECURITY & AUTHENTICATION AUDIT REPORT

**Document Identifier:** `SOVRA-P11-HMAC-2026.11`  
**Classification:** Cryptographic Authentication, Nonce Deduplication & Replay Vulnerability Audit  
**Author:** Senior Application Security Engineer & Cryptographic Protocol Auditor  
**Baseline Commit:** [`fae9c45`](https://github.com/ewanbabu36-cell/sovra/commit/fae9c45)  
**Implementation Files:**
- [`services/api/src/server.ts`](file:///d:/Sovra/services/api/src/server.ts)
- [`services/api/src/monitoring/secret-rotation.ts`](file:///d:/Sovra/services/api/src/monitoring/secret-rotation.ts)
- [`services/api/src/middleware/security.middleware.ts`](file:///d:/Sovra/services/api/src/middleware/security.middleware.ts)
- [`tests/security/phase11-hmac-replay-security.test.ts`](file:///d:/Sovra/tests/security/phase11-hmac-replay-security.test.ts)  
**Evaluation Date:** November 21, 2026  

---

## 1. Executive Summary

During the Phase 11 deep-audit of the decoupled API gateway, a critical security vulnerability was identified in the HMAC-SHA256 request authentication layer. While the existing middleware checked that the client request timestamp was within a $\pm 60$-second window, it lacked an in-memory nonce or signature tracking cache. Consequently, an adversary observing a legitimate authenticated payload in transit could execute a **Replay Attack** by re-submitting the identical request multiple times within the 60-second window.

### Phase 11 Remediation & Outcome:
1. **Engineered In-Memory TTL Nonce Replay Cache:** Added `replayCache` tracking signature digests and unique request nonces with automatic timestamp-based pruning.
2. **Clock-Skew Hardening:** Added strict future-timestamp rejection ($\le +30\text{s}$) to prevent adversarial pre-computation attacks.
3. **Secret Rotation Integration:** Extended `SecretRotationManager` with `getValidSecrets()` to support multi-key verification across active, grace-period, and candidate secrets.
4. **Rate Limiting Isolation:** Converted `ipRequestBuckets` in `SecurityMiddleware` into an instance-bound map with `resetRateLimits()` for hermetic test isolation.
5. **Empirical Verification:** 13 adversarial scenarios implemented in [`tests/security/phase11-hmac-replay-security.test.ts`](file:///d:/Sovra/tests/security/phase11-hmac-replay-security.test.ts) achieved **13 / 13 PASS (100%)**.

```
========================================================================================
                      HMAC REPLAY SECURITY AUDIT VERDICT
========================================================================================
  Vulnerability Analysis           Pre-Remediation      Phase 11 Remediation
  ──────────────────────────────────────────────────────────────────────────────────────
  Signature Deduplication          MISSING (Vulnerable) TTL Nonce Replay Cache (ACTIVE)
  Explicit Nonce Tracking          MISSING              X-Sovra-Nonce & X-Request-Id
  Future Clock Skew Limit          Unbounded within 60s Strict Rejection (> 30s Future)
  Grace Period Multi-Key Auth      Single Key Only      getValidSecrets() Multi-Key Check
  Cross-Instance Rate Limit Leak   Shared Global Map    Instance-Scoped Bucket Storage
  ──────────────────────────────────────────────────────────────────────────────────────
  SECURITY VERDICT:                REMEDIATED, HARDENED & 100% TEST-VERIFIED
========================================================================================
```

---

## 2. Threat Modeling & Vulnerability Analysis

```mermaid
sequenceDiagram
    autonumber
    actor Client as Legitimate Client
    actor Attacker as Adversary / MITM
    participant API as Decoupled API Gateway
    participant Cache as Nonce & Replay Cache

    Client->>API: POST /api/v1/tx (HMAC, ts, nonce="req-101")
    API->>Cache: Check "req-101" / signature
    Cache-->>API: Not found (Store with TTL)
    API-->>Client: 200 OK (Transaction Submitted)

    Note over Attacker: Attacker sniffs or intercepts authenticated payload

    Attacker->>API: Replay identical POST /api/v1/tx (HMAC, ts, nonce="req-101")
    API->>Cache: Check "req-101" / signature
    Cache-->>API: MATCH FOUND (Duplicate!)
    API-->>Attacker: 401 Unauthorized (Replay Attack Detected)
```

### 2.1 The Vulnerability (CWE-294: Authentication Bypass by Capture-replay)
In previous phases, `verifyHmacSignature` computed:
$$|\text{server\_time} - \text{timestamp}| \le 60,000\text{ ms}$$
If true, the HMAC was calculated as $\text{HMAC-SHA256}(K, \text{method} + \text{path} + \text{timestamp} + \text{body})$. If the signature matched, the request was immediately accepted. Because neither the signature nor a unique nonce was stored, an attacker could replay the exact payload dozens or hundreds of times until the 60-second window expired. For sensitive financial or identity operations, this could cause duplicate processing or resource exhaustion.

---

## 3. Engineering Implementation Details

### 3.1 In-Memory TTL Nonce Replay Cache ([`services/api/src/server.ts`](file:///d:/Sovra/services/api/src/server.ts))
The API server introduces a memory-bounded cache:
```typescript
interface ReplayCacheEntry {
  timestamp: number;
  expiresAt: number;
}
private replayCache = new Map<string, ReplayCacheEntry>();
private readonly REPLAY_TTL_MS = 120_000; // 2 minutes
```

Every incoming request evaluates both its cryptographic signature and its nonce header (`X-Sovra-Nonce` or `X-Request-Id`):
```typescript
const nonce = (req.headers['x-sovra-nonce'] as string) || 
              (req.headers['x-request-id'] as string) || '';

if (this.replayCache.has(signature)) {
  return res.status(401).json({
    error: 'HMAC signature already used (replay attack detected)',
    code: 'HMAC_REPLAY_DETECTED'
  });
}

if (nonce && this.replayCache.has(`nonce:${nonce}`)) {
  return res.status(401).json({
    error: 'HMAC nonce already used (replay attack detected)',
    code: 'HMAC_NONCE_REPLAY_DETECTED'
  });
}
```

### 3.2 Clock-Skew Bounds
Future timestamps exceeding 30 seconds are rejected:
```typescript
if (clientTimestamp > now + 30_000) {
  return res.status(401).json({
    error: 'HMAC timestamp is too far in the future',
    code: 'HMAC_FUTURE_TIMESTAMP'
  });
}
```

### 3.3 Dynamic Multi-Secret Rotation Support ([`services/api/src/monitoring/secret-rotation.ts`](file:///d:/Sovra/services/api/src/monitoring/secret-rotation.ts))
During key rotation events, `SecretRotationManager` exposes all currently valid secrets (active key + grace-period retired keys):
```typescript
public getValidSecrets(): string[] {
  const secrets: string[] = [];
  if (this.state.currentSecret) secrets.push(this.state.currentSecret);
  const now = Date.now();
  for (const historical of this.state.historicalSecrets) {
    if (historical.revokedAt && now - historical.revokedAt < this.config.gracePeriodMs) {
      secrets.push(historical.secret);
    }
  }
  return secrets;
}
```
The server checks candidate secrets sequentially. If any valid secret yields a matching HMAC, the request is authenticated, ensuring zero downtime for legitimate clients during scheduled rotations.

---

## 4. Empirical Test Verification

The full test suite [`tests/security/phase11-hmac-replay-security.test.ts`](file:///d:/Sovra/tests/security/phase11-hmac-replay-security.test.ts) was executed against an isolated instance of `DecoupledApiServer`:

```text
 ✓ tests/security/phase11-hmac-replay-security.test.ts (13 tests) 200ms
   ✓ SOVRA Phase 11: HMAC Authentication & Replay Prevention Security Gate > accepts valid request with correct HMAC signature and fresh timestamp
   ✓ SOVRA Phase 11: HMAC Authentication & Replay Prevention Security Gate > rejects request missing HMAC signature header
   ✓ SOVRA Phase 11: HMAC Authentication & Replay Prevention Security Gate > rejects request missing timestamp header
   ✓ SOVRA Phase 11: HMAC Authentication & Replay Prevention Security Gate > rejects request with expired timestamp (> 60 seconds old)
   ✓ SOVRA Phase 11: HMAC Authentication & Replay Prevention Security Gate > rejects request with future timestamp (> 30 seconds ahead)
   ✓ SOVRA Phase 11: HMAC Authentication & Replay Prevention Security Gate > rejects exact signature replay within the valid time window
   ✓ SOVRA Phase 11: HMAC Authentication & Replay Prevention Security Gate > rejects nonce reuse when using explicit X-Sovra-Nonce header
   ✓ SOVRA Phase 11: HMAC Authentication & Replay Prevention Security Gate > rejects nonce reuse when using X-Request-Id header
   ✓ SOVRA Phase 11: HMAC Authentication & Replay Prevention Security Gate > accepts distinct valid requests with unique nonces within the time window
   ✓ SOVRA Phase 11: HMAC Authentication & Replay Prevention Security Gate > rejects request signed with an invalid/unknown secret
   ✓ SOVRA Phase 11: HMAC Authentication & Replay Prevention Security Gate > accepts request signed with previous secret during active rotation grace period
   ✓ SOVRA Phase 11: HMAC Authentication & Replay Prevention Security Gate > rejects request signed with expired secret after grace period has lapsed
   ✓ SOVRA Phase 11: HMAC Authentication & Replay Prevention Security Gate > protects against high-rate replay bursts via combined replay cache and rate limiting
```

---

## 5. Security Certification Sign-Off

The HMAC authentication subsystem now delivers industry-standard, replay-resistant cryptographic verification conforming to RFC 2104 and NIST SP 800-107.

**Audit Status:** **PASSED & CERTIFIED**

---
*End of Document `SOVRA_PHASE11_HMAC_REPLAY_SECURITY_REPORT.md`*
