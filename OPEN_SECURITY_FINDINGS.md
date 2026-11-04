# SOVRA — OPEN SECURITY FINDINGS & FUTURE HARDENING TRACKER

**Audit & Remediation Date**: 2026-11-04  
**Audit Entity**: Multidisciplinary Enterprise Technology Audit Organization  
**Git Branch**: `remediation/critical-security-hardening`  
**Status**: ACTIVE TRACKING REGISTER

---

## 1. OPEN FINDINGS SUMMARY

All **Critical (CVSS 9.0+)** vulnerabilities blocking production go-live have been **remediated and verified**. The following non-blocking findings remain tracked for upcoming engineering sprints:

| Finding ID | Title | Severity | CVSS v3.1 | Planned Sprint | Target Remediation Path | Status |
| :--- | :--- | :---: | :---: | :---: | :--- | :---: |
| **SEC-07** | Session Token & Master Key Persistence in `localStorage` | **HIGH** | 7.2 | Sprint 2 (Week 3) | Migrate bearer tokens to `HttpOnly`, `SameSite=Strict` cookies; encapsulate client keys in non-exportable WebCrypto SubtleCrypto objects. | **OPEN** |
| **NET-01** | Simultaneous Plaintext HTTP & HTTPS Without Strict HSTS Redirect | **MEDIUM** | 5.3 | Sprint 3 (Week 5) | Enforce automated 301 redirection from `:3001` to `:3443` with `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`. | **OPEN** |
| **NET-02** | Missing Ingress TCP Socket Concurrency Cap on P2P Port 4001 | **MEDIUM** | 5.3 | Sprint 3 (Week 5) | Set `server.maxConnections = 500` and implement a 5-second handshake timeout on incoming Noise_XX sockets. | **OPEN** |
| **PERF-01** | Synchronous `fs.writeFileSync` on JSON State Backup | **MEDIUM** | 5.1 | Sprint 3 (Week 5) | Migrate JSON state serialization to asynchronous streaming (`fs.promises.writeFile`) to prevent event-loop latency jitter during high load. | **OPEN** |

---

## 2. RISK ANALYSIS OF OPEN FINDINGS

### SEC-07: LocalStorage Token Storage
- **Current Mitigations**:
  - The frontend implements strict output escaping and template sanitization to prevent DOM-based Cross-Site Scripting (XSS).
  - CORS policy is restricted to origin-verified requests (`DEFAULT_SECURITY_POLICY`).
  - Session tokens are checked against the server-side `revoked_tokens` table on logout.
- **Residual Risk**:
  In the event of a client-side third-party script injection or malicious browser extension, tokens stored in `localStorage` can be accessed.
- **Target Milestone**: Sprint 2 hardening.

---

## 3. OPEN FINDINGS SCORECARD

- **Critical Vulnerabilities Open**: `0`
- **High Vulnerabilities Open**: `1` (Non-blocking: SEC-07 tracked for Sprint 2)
- **Medium Vulnerabilities Open**: `3` (Infrastructure/Networking enhancements)
- **Overall Post-Remediation Security Posture**: **STRONG & PRODUCTION CLEARED**
