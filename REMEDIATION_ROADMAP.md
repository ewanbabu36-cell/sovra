# SOVRA — STRATEGIC REMEDIATION ROADMAP & ENGINEERING SPRINT PLAN

**Audit Date**: 2026-11-04  
**Audit Entity**: Multidisciplinary Enterprise Technology Audit Organization  
**Auditor Roles**: Chief Technology Officer (CTO) & Chief Information Security Officer (CISO)  
**Target Goal**: Path to Full Production Readiness & Public Network Launch  
**Total Estimated Remediation Time**: 3 Sprints (6 Weeks)

---

## 1. SPRINT TIMELINE & REMEDIATION PHASING

```mermaid
flowchart TD
    subgraph Sprint 1: Critical Security Gates [Week 1 - 2]
        P0_1[SEC-01: Integrate snarkjs Groth16 circuit verifier in zk.routes.ts]
        P0_2[SEC-05: Remove x-sovra-benchmark rate limit backdoor]
        P0_3[SEC-06: Implement rolling 7-day TTL purge on admin_wiretap_telemetry]
        P0_4[DEV-01: Generate package.json & tsconfig.json for services/api]
    end

    subgraph Sprint 2: Cryptographic & Privacy Hardening [Week 3 - 4]
        P1_1[SEC-02: Implement real WebAuthn PRF extension with SubtleCrypto]
        P1_2[SEC-04: Implement actual WireGuard/Tor onion proxy for Ghost Mode]
        P1_3[SEC-03: Implement background worker daemon for disappearing messages]
        P1_4[SEC-07: Migrate session tokens from localStorage to HttpOnly cookies]
    end

    subgraph Sprint 3: Resilience, Performance & Pre-Launch [Week 5 - 6]
        P2_1[PERF-01: Replace synchronous fs.writeFileSync with async streaming]
        P2_2[NET-01: Enforce automatic HTTP to HTTPS 301 redirect with HSTS]
        P2_3[NET-02: Implement TCP connection limits and handshake timeouts on port 4001]
        P2_4[QA-01: Re-execute complete end-to-end regression and adversarial suite]
    end

    Sprint 1: Critical Security Gates --> Sprint 2: Cryptographic & Privacy Hardening
    Sprint 2: Cryptographic & Privacy Hardening --> Sprint 3: Resilience, Performance & Pre-Launch
```

---

## 2. DETAILED REMEDIATION ACTION ITEMS

### Sprint 1: Critical Release Blockers (P0 — Weeks 1–2)

#### Action Item 1.1: Fix ZK-SNARK Humanity Verification (SEC-01)
- **Assignee**: Cryptographic Engineer
- **Steps**:
  1. Add `snarkjs` and `circomlibjs` to workspace dependencies.
  2. Load the Semaphore verification key (`semaphore_vkey.json`).
  3. In `scripts/routes/zk.routes.ts`, call `await snarkjs.groth16.verify(vKey, publicSignals, proof)`.
  4. Only commit `nullifier_hash` and grant verification badge if mathematical verification returns `true`.

#### Action Item 1.2: Eliminate Rate Limiter Backdoor Header (SEC-05)
- **Assignee**: Backend Security Engineer
- **Steps**:
  1. Open `scripts/dev-server.ts` at line 89390.
  2. Remove `|| req.headers['x-sovra-benchmark'] === 'true'`.
  3. Restrict benchmark mode to an explicit CLI flag (`--benchmark`) set strictly at server startup in isolated test environments.

#### Action Item 1.3: Enforce Automated Purge on Wiretap Telemetry (SEC-06)
- **Assignee**: Database Engineer
- **Steps**:
  1. Add an index on `admin_wiretap_telemetry(timestamp)`.
  2. Implement an automated hourly maintenance query:
     ```sql
     DELETE FROM admin_wiretap_telemetry WHERE timestamp < unixepoch('now', '-7 days') * 1000;
     ```
  3. Add a configuration flag `TELEMETRY_LOGGING_ENABLED=false` to allow operators to disable raw IP logging entirely.

#### Action Item 1.4: Resolve Package Scaffolding in `services/api`
- **Assignee**: DevOps Engineer
- **Steps**:
  1. Add valid `package.json` and `tsconfig.json` in `services/api`.
  2. Ensure `tests/security/dependency-boundaries.test.ts` passes with zero errors.

---

### Sprint 2: Privacy & Cryptographic Hardening (P1 — Weeks 3–4)

#### Action Item 2.1: Implement Functional WebAuthn PRF Derivation (SEC-02)
- Replace stub in `scripts/dev-server.ts:85167` with genuine `navigator.credentials.get` using `extensions: { prf: { eval: { first: salt } } }`.
- Derive root Ed25519 seed from raw PRF output using HKDF-SHA256.

#### Action Item 2.2: True Anonymity Routing for Ghost Mode (SEC-04)
- Connect Ghost Mode to a real local SOCKS5 proxy (e.g. Tor daemon) or decentralized mixnet node.
- Block all direct WebRTC STUN host candidate gathering while Ghost Mode is active.

#### Action Item 2.3: Active Daemon for Disappearing Messages (SEC-03)
- Instantiate a background interval timer in `dev-server.ts` running every 60 seconds.
- Execute `DELETE FROM direct_messages WHERE expires_at > 0 AND expires_at < unixepoch('now') * 1000`.

---

## 3. VERIFICATION & RE-AUDIT GATE

Upon completion of Sprint 1, an automated adversarial re-audit will be triggered:
- Proof forgery test must fail with HTTP 400.
- Burst test with `x-sovra-benchmark` must return HTTP 429.
- Wiretap count must respect rolling maximum retention.
- Boundary test suite must pass with 100% success.
