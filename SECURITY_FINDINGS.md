# SOVRA — COMPREHENSIVE SECURITY VULNERABILITY REGISTER

**Audit Date**: 2026-11-04  
**Audit Entity**: Multidisciplinary Enterprise Technology Audit Organization  
**Auditor Roles**: Chief Information Security Officer (CISO) & Senior AppSec Researcher  
**Standard**: Common Vulnerability Scoring System (CVSS v3.1) & OWASP Top 10  
**Scope**: Entire Sovra Monorepo & Active Runtime Node

---

## 1. EXECUTIVE VULNERABILITY SUMMARY MATRIX

| Finding ID | Title | Severity | CVSS v3.1 | Affected Component | Exact File & Line | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | Zero-Knowledge SNARK Humanity Verification Circuit Bypass | **CRITICAL** | 9.1 | ZK Humanity Verifier | `scripts/routes/zk.routes.ts:55-107` | **CONFIRMED** |
| **SEC-02** | WebAuthn PRF Hardware Enclave Key Derivation Incomplete Stub | **HIGH** | 7.4 | WebAuthn Client Module | `scripts/dev-server.ts:85167-85180` | **CONFIRMED** |
| **SEC-03** | Reactive-Only Message Expiration & Incomplete Disk Sanitization | **HIGH** | 7.1 | Ephemeral Messaging Engine | `scripts/database-engine.ts:3377` | **CONFIRMED** |
| **SEC-04** | Ghost Mode Anonymity Claim Discrepancy & Network IP Leak | **MEDIUM** | 5.3 | Client Privacy Surface | `scripts/dev-server.ts:47245-47280` | **CONFIRMED** |
| **SEC-05** | Rate Limiter Backdoor Header (`x-sovra-benchmark`) | **HIGH** | 7.5 | Rate Limiting Middleware | `scripts/dev-server.ts:89390-89400` | **CONFIRMED** |
| **SEC-06** | Unbounded Disk Growth via Permanent Wiretap Telemetry | **HIGH** | 7.5 | Telemetry Recorder | `scripts/database-sqlite.ts:4200` | **CONFIRMED** |
| **SEC-07** | Session Token & Private Key Persistence in `localStorage` | **HIGH** | 7.2 | Client Authentication Store | `scripts/dev-server.ts:47100` | **CONFIRMED** |

---

## 2. DETAILED VULNERABILITY DOSSIERS

### Finding SEC-01: Zero-Knowledge SNARK Proof Bypass
- **Vulnerability Type**: Incomplete Cryptographic Verification (CWE-347 / OWASP API6:2023)
- **CVSS Vector**: `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:H` (**Score: 9.1**)
- **Affected Module**: `scripts/routes/zk.routes.ts`, lines 55–107
- **Technical Mechanism**:
  The route `/api/zk/humanity/verify` checks for duplicate nullifier hashes in the database. However, it does not invoke `snarkjs.groth16.verify()` to validate the cryptographic bilinear pairing of `proof` and `publicSignals`.
- **Business Impact**: Sybil attackers can script the automated generation of dummy proofs with random nullifiers, claiming millions of verified human badges and compromising sybil-resistant quadratic funding and jury voting.
- **Recommended Remediation**:
  ```typescript
  import * as snarkjs from 'snarkjs';
  const isProofValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);
  if (!isProofValid) {
    return sendError(res, 400, 'Invalid ZK proof');
  }
  ```

---

### Finding SEC-05: Rate Limiter Debug Header Backdoor
- **Vulnerability Type**: Security Misconfiguration / Authentication Bypass (CWE-200 / OWASP API4:2023)
- **CVSS Vector**: `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H` (**Score: 7.5**)
- **Affected Module**: `scripts/dev-server.ts`, line 89390
- **Technical Mechanism**:
  ```typescript
  const isBenchmarkRequest = isBenchmarkMode || req.headers['x-sovra-benchmark'] === 'true';
  if (!isRealtimeCallOrEvent && !isBenchmarkRequest && !rateLimiter.consume(rateLimitKey)) { ... }
  ```
- **Business Impact**: Attackers can launch Denial of Service (DoS) attacks or brute force PINs/passwords across all endpoints by appending `x-sovra-benchmark: true` to bypass the token bucket.
- **Remediation**: Strip this condition entirely from production builds.

---

### Finding SEC-06: Unbounded Disk Growth via Permanent Wiretap Telemetry
- **Vulnerability Type**: Uncontrolled Resource Consumption (CWE-400 / OWASP API8:2023)
- **CVSS Vector**: `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H` (**Score: 7.5**)
- **Affected Module**: `scripts/database-sqlite.ts:4200`, `scripts/dev-server.ts:89295`
- **Technical Mechanism**: Every HTTP request is written to `admin_wiretap_telemetry`. Without a purge worker or TTL index, the table has already accumulated **166,396 records** consuming 38+ MB.
- **Remediation**: Establish an automatic rolling deletion window capped at 7 days or 10,000 maximum entries.

---

### Finding SEC-07: Secret Key & Bearer Token Exposure in `localStorage`
- **Vulnerability Type**: Sensitive Data Exposure in Insecure Storage (CWE-922 / OWASP A02:2021)
- **CVSS Vector**: `CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:N` (**Score: 7.2**)
- **Affected Module**: `scripts/dev-server.ts`, line 47100
- **Technical Mechanism**: Authentication bearer tokens and raw private keys are written to browser `localStorage`, making them vulnerable to DOM XSS exfiltration.
- **Remediation**: Store tokens in `HttpOnly`, `SameSite=Strict` cookies. Use WebCrypto SubtleCrypto with non-exportable keys for cryptographic credentials.
