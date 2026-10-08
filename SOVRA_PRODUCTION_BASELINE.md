# SOVRA PRODUCTION BASELINE
**Baseline Architecture, Workspace Topology, and Frozen Operational State**

---

## 1. Monorepo & Workspace Topology

Sovra is organized as a pnpm monorepo using Turborepo orchestration and TypeScript project references.

```
Sovra Workspace Topology
├── apps/
│   ├── sovra-app/          (React / TypeScript web client bundle & hooks)
│   ├── sovra-mobile/       (Mobile client directory containing Expo scaffold & native trees)
│   └── sovra-admin/        (Governance & moderation dashboard)
├── packages/
│   ├── crypto/             (Cryptographic primitives: Ed25519, X25519, ChaCha20-Poly1305, Argon2, PoW)
│   ├── identity/           (W3C DID key resolution, credential delegation, passkey registration)
│   ├── protocol/           (Canonical envelopes, CRDT operations, payment mesh channels)
│   ├── messaging/          (Signal Double Ratchet chat engine, BitChat mesh router)
│   ├── p2p/                (Mesh router, BLE codec, frame reassembler, transport abstractions)
│   ├── social/             (Graph feed, HLC clocks, CRDT projection, reputation scoring)
│   ├── storage/            (IPFS blockstore, BitSwap, UnixFS chunker, HLS video segmenter)
│   ├── shared/             (Result<T,E> monads, invariant guards, type guards)
│   ├── ui/                 (Shared design system tokens & web components)
│   ├── ai/                 (Local embedding vector store & on-device AI helpers)
│   └── moderation/         (Perceptual hashing, blocklists, community rule sets)
├── nodes/
│   ├── community-node/     (Autonomous community host node)
│   ├── full-node/          (Full archive & validation daemon)
│   ├── index-node/         (Search and indexing engine)
│   ├── relay-node/         (Opaque packet routing relay)
│   └── storage-node/       (Decentralized block storage provider)
├── services/
│   ├── moderation-worker/  (Background moderation worker)
│   ├── search/             (Inverted index search microservice)
│   └── transcoder/         (FFmpeg video transcoding service)
├── docker/
│   ├── Caddyfile           (Caddy TLS reverse proxy configuration)
│   ├── Dockerfile.production (Multi-stage Node 22 Alpine production container)
│   └── docker-compose.production.yml (Multi-container production stack)
└── scripts/
    ├── dev-server.ts       (Full-stack Node.js HTTP server hosting REST, SSE, WebRTC, PWA)
    ├── database-engine.ts  (Atomic disk-backed JSON engine with rolling backup)
    ├── database-sqlite.ts  (ACID SQLite engine using node:sqlite in WAL mode)
    └── build-client-bundle.ts (Esbuild client bundler producing apps/sovra-app/dist/bundle.js)
```

---

## 2. Subsystem Baseline Inventory

### 2.1 Database & Persistence Layer
- **Engine 1 (`scripts/database-engine.ts`):** Atomic file persistence targeting `.sovra-storage-dev/dynamic-social-state.json`. Utilizes atomic temporary file write (`.tmp`) and atomic rename (`fs.renameSync`). Automatically maintains rolling `.bak` backup.
- **Engine 2 (`scripts/database-sqlite.ts`):** High-concurrency SQL engine using Node.js built-in `node:sqlite` in WAL mode (`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;`). Maintains tables for `users`, `posts`, `comments`, `messages`, `channels`, `reels`, and `audit_logs`.

### 2.2 Authentication & Identity
- **DID Architecture:** W3C `did:sovra:` identifiers backed by Ed25519 public keys.
- **Authentication:** Bearer token session authorization resolved against active sessions in database.
- **2FA:** RFC 6238 TOTP two-factor authentication supported via speakeasy/otplib logic.
- **WebAuthn / Passkeys:** Supported in `packages/identity/src/passkey.ts` for biometrics.

### 2.3 Media Pipeline
- **Profile Avatars & Images:** Ingested via base64 Data URLs and stored as CIDs / content hashes.
- **Video & Reels:** 16:9 long-form video and 9:16 vertical reels ingested with HLS multi-bitrate segmenting logic in `@sovra/storage`.
- **IPFS Addressing:** SHA-256 DAG-PB CIDv1 generated deterministically for all uploaded binary media.

### 2.4 Chat & Realtime Messaging
- **Encryption:** Signal Double Ratchet algorithm (`DoubleRatchetChatEngine`) with X3DH pre-keys and ChaCha20-Poly1305 encryption.
- **Realtime Dispatch:** Server-Sent Events (SSE) connections at `/api/chat/stream` and `/api/notifications/stream`.
- **Receipts:** 3-state delivery progression (`sent` -> `delivered` -> `read`).

### 2.5 WebRTC Calling Engine
- **Media Capture:** Live hardware access via `navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo })`.
- **Transport:** Standard `RTCPeerConnection` with STUN candidate discovery (`stun:stun.l.google.com:19302`) and DTLS-SRTP encryption.
- **Diagnostics:** Verified live via `getStats()` gathering real packet flows (`bytesSent`, `bytesReceived`, `framesDecoded`).

### 2.6 Offline Mesh & Transport Layer
- **Protocol Core:** `MeshRouter`, `BleTransport`, `DurableOutboxStore` implemented in `packages/p2p/src/mesh/`.
- **Native Radio Code:** Android Kotlin `SovraBleModule.kt` and iOS Objective-C++ `SovraBleBridge.mm` exist in `apps/sovra-mobile/`.
- **Hardware Integration Status:** Native modules are not yet bridged to React Native; mobile app operates over HTTP API when online.

### 2.7 Observability & Production Monitoring
- **Kubernetes / Health Probes:** `/healthz`, `/livez`, `/readyz` endpoints.
- **Prometheus Metrics:** `/metrics` endpoint exposing uptime, memory, users count, posts count, and storage bytes.
- **Admin Dashboard:** `/api/admin/metrics` endpoint protected by `ADMIN_SECRET_KEY` and `SUPER_ADMIN` role.
