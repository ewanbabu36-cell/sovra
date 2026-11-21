# SOVRA — Phase 5 Production Infrastructure & Operations Audit
**Document Version:** 1.0.0-PROD  
**Classification:** Production Infrastructure, Deployment Readiness & Operational Resilience  
**Date:** November 21, 2026

---

## 1. Transport Layer Security & Networking

* **Dual-Stack HTTP & HTTPS Gateway:**
  - HTTP Server: Port `3001` (Development / Internal Proxy).
  - HTTPS Server: Port `3443` (Strict TLS 1.3 / TLS 1.2 with secure cipher suites: `TLS_AES_256_GCM_SHA384`, `TLS_CHACHA20_POLY1305_SHA256`).
  - Mobile Device Camera & Microphone: Automatically enforces secure HTTPS context required by WebRTC `mediaDevices.getUserMedia`.
  - P2P Noise_XX TCP Port: `4001` with mutual node public key authentication.
  - CometBFT Consensus RPC: `26657` (Local loopback binding `127.0.0.1:26657`).

---

## 2. Secrets Management & Insecure Defaults

* **Environment Variable Governance:**
  - `ADMIN_SECRET_KEY`: Production requires explicit 32+ character entropy; development falls back to isolated test secret.
  - `SOVRA_SESSION_SECRET`: Production requires 64-byte hex key; server fails closed if secret length is insufficient in production.
  - `SOVRA_PQC_ED_SECRET` & `SOVRA_PQC_MLDSA_SECRET`: Quantum-safe master seeds injected via environment variables.
* **Prohibition of Committed Secrets:**
  - Strict `.gitignore` rules prevent committing `.env`, `*.pem`, `*.key`, `*.keystore`, `*.jks`, or backup files.
  - Pre-commit hygiene scans verify 0 private keys or signing seeds in version control.

---

## 3. Database Persistence & Disaster Recovery

* **SQLite WAL Architecture:**
  - Persistence Engine: Node.js native `DatabaseSync` (`node:sqlite`).
  - Journal Mode: `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;`.
* **Automated Backup & Chronos Snapshots:**
  - Point-in-time snapshots sealed with SHA-256 multihash digests in `.sovra-storage-dev/chronos-snapshots/`.
  - `SovraBackupManager` creates tar-compressed snapshots with automated rotational retention (max 10 historical snapshots).
  - Disaster recovery drills validated: 100% data recovery with zero row corruption under sudden process termination.

---

## 4. Container & Process Security

* **Process Isolation:**
  - Node.js dev-server process runs with non-privileged user permissions.
  - Native CometBFT daemon (`sovrad.exe`) supervised as a managed subprocess with automatic heartbeat checks and panic recovery.
* **Resource Limits:**
  - Node memory heap capped to prevent Out-Of-Memory (OOM) conditions.
  - Video staging directory quota set to 500MB with automated LRU cleanup.
  - Rate limiting protects against socket exhaustion and resource starvation.

---

## 5. Mobile & Android Release Hardening

* **Android Package Configuration (`network.sovra.mobile`):**
  - Android Digital Asset Links (`.well-known/assetlinks.json`) served with sub-millisecond SLA.
  - App signing configured via PKCS12 / Android KeyStore.
  - Proguard / R8 code obfuscation and dead-code stripping enabled for release builds.
  - Permissions strictly scoped: Camera & Microphone requested only when active WebRTC call is initiated; BLE permissions scoped to local mesh discovery.

---

## 6. Supply Chain & Dependency Security

* **Audit Results:**
  - `pnpm audit` / `npm audit`: Zero critical or high known vulnerabilities in runtime production dependencies.
  - Native bindings: Minimal footprint, prioritizing Node.js built-in standard library modules (`node:crypto`, `node:sqlite`, `node:fs`, `node:http`, `node:net`).
