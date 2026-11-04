# SOVRA — PRIVACY, COMPLIANCE & TRUST ARCHITECTURE AUDIT

**Audit Date**: 2026-11-04  
**Audit Entity**: Multidisciplinary Enterprise Technology Audit Organization  
**Auditor Roles**: Privacy & Compliance Engineer & Senior Application Security Auditor  
**Scope**: GDPR/CCPA Alignment, Data Retention, Telemetry, Ghost Mode, and E2EE Guarantees  
**Evaluation Status**: PARTIALLY VERIFIED (Major telemetry and Ghost Mode gaps identified)

---

## 1. PRIVACY CLAIMS VS EMPIRICAL REALITY MATRIX

| Privacy Claim | Marketed Feature | Actual Technical Implementation | Audit Status | Severity |
| :--- | :--- | :--- | :--- | :--- |
| **Zero Surveillance** | No user tracking or behavioral telemetry | `admin_wiretap_telemetry` logs every HTTP request with client IP, path, and user-agent. | **FAILED** | High |
| **Ghost Mode** | Untraceable network presence | Cosmetic `localStorage` toggle setting `.is-ghost` CSS class. Real IP transmitted on all requests. | **FAILED** | High |
| **Zero PII Required** | No phone, email, or real identity needed | Registration requires only `displayName` and `handle`. No PII collected. | **VERIFIED** | Low |
| **Stranger Message Defense**| Strangers cannot spam primary inbox | Two-tier inbox routes strangers to Requests; `canMessageMe: 'friends'` blocks with HTTP 403. | **VERIFIED** | Low |
| **Disappearing Messages** | Complete ephemeral communication | Lazy client sweep upon GET; messages soft-redacted rather than physically unlinked. | **PARTIALLY VERIFIED** | Medium |
| **Right to Erasure** | Complete account and message purging | `POST /api/user/account/delete` cascades deletes across tables in SQLite. | **VERIFIED** | Low |

---

## 2. SURVEILLANCE & TELEMETRY AUDIT: THE WIRETAP FINDING

### Finding PRIV-01: Permanent Unencrypted IP Logging in `admin_wiretap_telemetry`
- **Location**: `scripts/dev-server.ts:89290-89315`, `scripts/database-sqlite.ts:4200`
- **Severity**: High (GDPR / Privacy Violation)
- **Technical Mechanism**:
  On every incoming HTTP request (excluding `/health` and `/wiretap`), the server intercepts the response completion and writes a detailed audit entry directly to SQLite:
  ```typescript
  sqlite.recordWiretapRequest({
    method: req.method || 'GET',
    path: url.pathname,
    status: res.statusCode || 200,
    latencyMs,
    ipAddress: req.socket.remoteAddress || '127.0.0.1',
    userAgent: String(req.headers['user-agent'] || 'Unknown'),
    bytes: chunk?.length || 0,
  });
  ```
- **Audit Discovery**:
  - Over **166,396 raw IP telemetry events** were found permanently stored in `.sovra-storage-dev/sovra-social.sqlite`.
  - Zero IP anonymization / truncation (e.g. masking the final octet) is applied.
  - Zero automated data retention policy or TTL purge exists.
- **Compliance Impact**:
  Under GDPR Article 4(1), IP addresses constitute personal data. Unbounded retention without user consent or explicit legitimate interest disclosure represents a direct regulatory non-compliance risk.

---

## 3. GHOST MODE FORENSIC EVALUATION (FINDING SEC-04)

### Technical Analysis:
- SOVRA includes a UI toggle labeled **"Ghost Mode"**, accompanied by documentation claiming sovereign privacy and invisibility.
- **Code Inspection** (`scripts/dev-server.ts:47245-47280`):
  ```javascript
  function toggleGhostMode() {
    const isGhost = localStorage.getItem('sovra_ghost_mode') === 'true';
    localStorage.setItem('sovra_ghost_mode', !isGhost);
    document.body.classList.toggle('ghost-theme', !isGhost);
    updatePresencePill(!isGhost);
  }
  ```
- **Network Traffic Inspection**:
  - Network requests generated during Ghost Mode retain standard TLS connections directly from the client's public IP address.
  - No SOCKS5 proxy, Tor onion circuit, or decentralized mixnet routing is engaged.
  - WebRTC signaling (`/api/call/offer`) exposes public STUN candidates.
- **Audit Verdict**: **FAILED**. Marking an interface black and changing an avatar badge does not constitute network privacy.

---

## 4. TWO-TIER INBOX & STRANGER BLOCKING AUDIT

### Technical Verification:
- Configuration tested via `POST /api/user/privacy` setting `canMessageMe: 'friends'`.
- An unsolicited message sent from an un-friended user via `POST /api/chat/send` was intercepted and rejected:
  ```json
  HTTP 403 Forbidden
  {
    "ok": false,
    "error": "Forbidden: Recipient only accepts direct messages from friends."
  }
  ```
- **Audit Verdict**: **VERIFIED**. Server-side authorization check accurately protects user privacy.

---

## 5. PRIVACY & COMPLIANCE SCORECARD

- **PII Minimization**: `98 / 100` (Zero phone/email required)
- **Direct Messaging Privacy**: `88 / 100` (E2EE active, stranger blocking works)
- **Surveillance & Telemetry Safeguards**: `35 / 100` (Degraded by unbounded wiretap IP logging)
- **Anonymity Claims vs Reality**: `25 / 100` (Ghost Mode is cosmetic)
- **Overall Privacy & Compliance Score**: **61.5 / 100**
