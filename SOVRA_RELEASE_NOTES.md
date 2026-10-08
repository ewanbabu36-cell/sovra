# SOVRA PRODUCTION RELEASE NOTES
**Version: v1.0.0-production — Genuine Decentralized Social Network Release**

---

## 1. Overview & Release Mission

Sovra v1.0.0-production marks the transition of the Sovra project from development prototypes to a deployable production release. Every component has been evaluated against real-world criteria:
- **No Mock Functionality:** Canned peer responses and simulated BLE states have been purged.
- **Genuine Media Pipelines:** Real avatar uploads, HLS video streams, and WebRTC audio/video calling verified with real packet exchange.
- **Durable Persistence:** ACID-compliant SQLite WAL database and atomic JSON persistence survive process termination.
- **Multi-Client Verification:** Real multi-user interaction paths (User A ↔ User B) verified end-to-end.

---

## 2. Key Highlights & Certified Subsystems

### 2.1 Cryptographic Identity & Authentication
- **W3C Decentralized Identifiers (DIDs):** Native `did:sovra:` identifiers generated using Ed25519 public keys.
- **Passkey / WebAuthn Support:** Hardware-backed biometric authentication supported alongside cryptographic key generation.
- **RFC 6238 TOTP 2FA:** Two-factor authentication with rolling QR code secrets and secure recovery codes.

### 2.2 Social Feed & Content Publishing
- **Multi-Format Social Feed:** Text posts, photo carousels, polls, Q&As, and quizzes.
- **Bilateral Friendship Graphs:** Cryptographic friendship handshakes with mutual friend discovery.
- **Sovereign Reels & Long-Form Video:** 9:16 vertical video player and 16:9 HLS ABR player with buffer health monitoring.
- **Deterministic Content Addressing:** All uploaded media ingested as SHA-256 DAG-PB CIDs.

### 2.3 Signal-Grade Realtime Chat
- **Signal Double Ratchet Protocol:** End-to-end encrypted messaging with X3DH pre-keys and ChaCha20-Poly1305 encryption.
- **Realtime Push:** Server-Sent Events (SSE) connections deliver incoming messages instantaneously without polling.
- **Monotonic Receipts:** 3-state delivery progression (`sent` -> `delivered` -> `read`) with emoji reaction bars.

### 2.4 Real WebRTC Calling Engine
- **Audio & Video Streams:** Genuine hardware media capture via `getUserMedia()`.
- **DTLS-SRTP Transport:** End-to-end encrypted voice and video streaming over `RTCPeerConnection`.
- **Honest Diagnostics:** Live bandwidth and frame telemetry gathered every 1,000ms via `getStats()`.

### 2.5 Truthful Diagnostic Telemetry & Mock Purging
- **Removed Synthetic Bot Responses:** Purged automated canned replies previously injected for demo DIDs.
- **Truthful Server Transport Telemetry:** `/api/mesh/status` now reports genuine IP host transport states (`ONLINE_IP_MESH` / `ONLINE_IP`).
- **Truthful Mobile HUD:** Mobile client honestly displays `OFFLINE` with 0 peers and 0 bytes transferred when disconnected from the server.

---

## 3. Security & Operational Hardening

- **BOLA / IDOR Protection:** Content mutators (`/api/feed/delete`, `/api/feed/edit`) strictly enforce that `principal.did === authorDid` or `SUPER_ADMIN`.
- **Permissions-Policy Hardening:** Production `Caddyfile` updated to grant `camera=(self), microphone=(self)` enabling secure WebRTC calling over HTTPS.
- **Memory Caps & Bounded Streams:** HTTP body reader enforces strict payload boundaries (64KB for JSON, 100MB for media) preventing memory exhaustion attacks.
- **ACID WAL Persistence:** SQLite database operates with Write-Ahead Logging (`PRAGMA journal_mode = WAL`) ensuring crash resilience.

---

## 4. Production Deployment Stack

- **Container Runtime:** Multi-stage hardened Alpine Node.js 22 container (`docker/Dockerfile.production`).
- **TLS Reverse Proxy:** Caddy v2 Alpine container with automatic TLS, HTTP/2, Zstandard compression, and unbuffered SSE stream proxies (`docker/Caddyfile`).
- **Orchestration:** Multi-container production stack configured in `docker/docker-compose.production.yml`.
- **Health Probes:** Kubernetes-compatible `/healthz`, `/livez`, `/readyz`, and Prometheus `/metrics` probes.

---

## 5. Post-Launch Roadmap & Milestones

- **Phase 2: Mobile Native Radio Bridge:** Wire native Kotlin `SovraBleModule.kt` and iOS `SovraBleBridge.mm` into React Native TurboModules for physical phone-to-phone ad-hoc mesh networking without cellular or Wi-Fi.
- **Phase 3: Wi-Fi Direct High-Throughput Media:** Implement native Android `WifiP2pManager` to transfer 50MB+ video files directly between peers over local Wi-Fi.
- **Phase 4: Hardware Enclave Private Key Storage:** Migrate private key storage from browser memory to Android Keystore and iOS Keychain.
