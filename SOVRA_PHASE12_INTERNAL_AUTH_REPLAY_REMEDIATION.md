# SOVRA PHASE 12: INTERNAL SERVICE AUTHENTICATION & REPLAY REMEDIATION REPORT
**Document ID:** SOVRA-P12-AUTH-02  
**Baseline Git Commit:** `8b26f40`  
**Classification:** ARCHITECTURAL & CRYPTOGRAPHIC REMEDIATION REPORT  
**Target Environment:** Production Testnet Hardening  
**Mainnet Authorization:** STRICTLY NOT AUTHORIZED  
**Auditor:** Principal Blockchain Security Auditor & Distributed Systems Architect  
**Date:** November 21, 2026  

---

## 1. EXECUTIVE SUMMARY

This report documents the architectural remediation of internal service authentication in `services/api/src/server.ts`, specifically eliminating the raw bearer authentication replay bypass and implementing a zero-trust cryptographic HMAC authentication protocol backed by distributed multi-replica nonce deduplication.

---

## 2. PROBLEM DEFINITION: THE BEARER REPLAY BYPASS

In prior versions of `services/api/src/server.ts:verifyServiceAuth`, the authentication routine inspected incoming requests as follows:

```typescript
// HISTORICAL FLAW
const token = authHeader.replace(/^Bearer\s+/i, '').trim();
if (this.secretManager.isValidSecret(token)) {
  return true; // Bypass: completely skipped timestamp, nonce, and signature!
}
```

This vulnerability caused two severe failure modes:
1. **Replay Vulnerability:** An adversary who intercepted a bearer token could replay identical requests indefinitely to `/internal/*` routes.
2. **Tampering Vulnerability:** An adversary could modify HTTP methods, canonical URLs, or JSON payloads without invalidating the token because no cryptographic binding existed between the secret and the request body.

---

## 3. REMEDIATION ARCHITECTURE

### 3.1 Strict HMAC-SHA256 Canonical Signing Scheme

Every internal service request in production or strict mode must provide:
- `X-Sovra-Internal-Auth`: The HMAC-SHA256 signature digest.
- `X-Sovra-Timestamp`: Unix millisecond timestamp string.
- `X-Sovra-Nonce`: Cryptographically unique request identifier (UUID or high-entropy string).
- `X-Sovra-Body-Hash`: SHA256 hex digest of the raw request payload (for `POST`, `PUT`, `PATCH`).

The canonical message format cryptographically binds method, path, timestamp, nonce, and body:
$$\text{Signature} = \text{HMAC-SHA256}\left(\text{Secret}, \text{Method} \mathbin{\Vert} \text{CanonicalPath} \mathbin{\Vert} \text{Timestamp} \mathbin{\Vert} \text{Nonce} \mathbin{\Vert} \text{BodyHash}\right)$$

### 3.2 Multi-Secret Rotation Support

To support zero-downtime secret rotation without interrupting cluster services, `verifyServiceAuth` checks the calculated HMAC against all currently valid secrets in `SecretRotationManager` (primary active secret and staged secondary secret during the 1-hour grace window) using constant-time comparison:
```typescript
crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedHmac))
```

### 3.3 Strict Timestamp Verification & Clock-Skew Guard

1. **Expiry Enforcement:** Requests with timestamps older than 300,000 milliseconds ($5\text{ minutes}$) are rejected with `SERVICE_AUTH_EXPIRED_TIMESTAMP`.
2. **Future Clock-Skew Guard:** Requests with timestamps greater than 30,000 milliseconds ($30\text{ seconds}$) into the future are rejected with `SERVICE_AUTH_FUTURE_TIMESTAMP`.

### 3.4 Distributed Atomic Replay Protection

Nonce deduplication is enforced via [`SharedSecurityStore`](file:///d:/Sovra/services/api/src/storage/shared-security-store.ts).
1. When a request arrives, both the unique nonce key (`nonce:${nonceStr}`) and the signature digest (`sig:${token}`) are submitted to `consumeNonce(key, now, expiresAt)`.
2. An atomic `INSERT INTO nonces (nonce, created_at, expires_at) VALUES (?, ?, ?)` is executed within SQLite WAL mode.
3. If an identical nonce or signature digest has already been recorded, SQLite raises a primary-key constraint collision (`SQLITE_CONSTRAINT_PRIMARYKEY`), causing `consumeNonce()` to return `false`.
4. The server logs `SERVICE_AUTH_REPLAY_DETECTED` and immediately terminates the request with HTTP 401.

### 3.5 Backward Compatibility Handling for Non-Production Testing

In non-production compatibility mode (`process.env.NODE_ENV !== 'production' && !this.strictSecurity`), raw bearer tokens matching valid secrets are permitted only if they have not been replayed:
```typescript
if (this.secretManager.isValidSecret(token)) {
  if (isProduction || this.strictSecurity) {
    securityEventCollector.recordEvent('WARN', 'AUTH_FAILURE', 'SERVICE_AUTH_HMAC_REQUIRED', ...);
    return false;
  }
  const nonceStr = nonceHeader ? String(nonceHeader).trim() : '';
  const replayKey = nonceStr ? `nonce:bearer:${nonceStr}` : `sig:bearer:${token}`;
  const allowed = this.sharedStore.consumeNonce(replayKey, now, now + 300_000);
  if (!allowed) {
    securityEventCollector.recordEvent('WARN', 'AUTH_FAILURE', 'SERVICE_AUTH_REPLAY_DETECTED', ...);
    return false;
  }
  return true;
}
```
This guarantees that even in non-production environments, bearer tokens are **strictly single-use**, and replayed requests are rejected with HTTP 401.

---

## 4. ADVERSARIAL VERIFICATION & TEST RESULTS

The remediation was verified across multiple adversarial test suites:

### 4.1 Test Evidence from `tests/security/phase12-secret-and-auth-hardening.test.ts`
- **Test 8:** Rejects static raw bearer token in strict mode; blocks replayed bearer tokens in non-strict mode (**PASS**).
- **Test 9:** Accepts valid canonical request with HMAC, timestamp, nonce, and body hash (**PASS**).
- **Test 10:** Strictly rejects expired timestamp ($> 300\text{s}$) (**PASS**).
- **Test 11:** Strictly rejects future timestamp with clock skew $> 30\text{s}$ (**PASS**).
- **Test 12:** Replay attack prevention: second identical request rejected with HTTP 401 (**PASS**).
- **Test 13:** Body tampering detection: payload modification invalidates HMAC (**PASS**).
- **Test 14:** Multi-replica cross-node replay prevention: request consumed on Node A is rejected on Node B (**PASS**).

### 4.2 Test Evidence from `tests/security/phase11-hmac-replay-security.test.ts`
- 13 out of 13 tests passed, verifying backward compatibility and zero regression.

---

## 5. AUDITOR VERDICT

The raw bearer bypass has been completely eliminated from the production codebase. All internal service endpoints are cryptographically protected by HMAC-SHA256 signatures, bounded timestamp windows, and distributed atomic replay prevention.

**Remediation Verdict:** **PASSED & VERIFIED** ✅
