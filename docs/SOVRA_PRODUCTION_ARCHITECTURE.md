# SOVRA PROTOCOL — PRODUCTION ARCHITECTURE SPECIFICATION
**Document Version:** 1.0.0  
**Classification:** System Architecture & Topology  
**Target Audience:** Infrastructure Engineers, SREs, Security Auditors  

---

## 1. High-Level Architectural Topology

```
                         [ INTERNET / CLIENTS ]
                         Mobile PWA / Desktop Web
                                   │
                                   ▼
                   ┌───────────────────────────────┐
                   │   Caddy 2 Reverse Proxy       │ [CENTRALIZED INGRESS]
                   │   (TLS Term, HSTS, SSE Unbuf) │
                   └───────────────┬───────────────┘
                                   │ :3001 (HTTP)
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        SOVRA PRODUCTION NODE                           │ [LOCAL RUNTIME]
│                                                                        │
│   ┌────────────────────────┐         ┌─────────────────────────────┐   │
│   │ REST & SSE API Server  │         │ Noise_XX P2P Mesh Daemon    │   │
│   │ (Auth, Feed, Chat, UI) │         │ (TCP Port 4001, GossipSub)  │   │
│   └───────────┬────────────┘         └──────────────┬──────────────┘   │
│               │                                     │                  │
│               ▼                                     ▼                  │
│   ┌─────────────────────────────────────────────────────────────┐      │
│   │               Sovra Dual Persistence Engine                 │      │
│   │  ├── In-Memory State Cache (O(1) Map/Set Graph Filtering)   │      │
│   │  ├── SQLite WAL Relational DB (sovra-social.sqlite)         │      │
│   │  └── Atomic Snapshot Rollback (.json and .json.bak)         │      │
│   └─────────────────────────────┬───────────────────────────────┘      │
│                                 │                                      │
│                                 ▼                                      │
│   ┌─────────────────────────────────────────────────────────────┐      │
│   │              Content-Addressed Storage (CAS)                │      │
│   │  ├── /avatars, /covers, /posts, /reels, /attachments        │      │
│   │  └── HTTP 206 Partial Content Range Streaming Daemon        │      │
│   └─────────────────────────────────────────────────────────────┘      │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │
                                  │ UDP / TCP 3478, 5349
                                  ▼
                   ┌───────────────────────────────┐
                   │    Coturn TURN/STUN Relay     │ [OPTIONAL / EXTERNAL]
                   │   (WebRTC Symmetric NAT)      │
                   └───────────────────────────────┘
```

---

## 2. Component Classification Matrix

| Component | Responsibility | Operational Nature | Criticality | Scaling Model |
|-----------|----------------|--------------------|-------------|---------------|
| **Caddy Reverse Proxy** | TLS termination, HTTP → HTTPS redirect, security headers, unbuffered SSE streams | `CENTRALIZED` | High | Stateless (Horizontal) |
| **Node.js HTTP Server** | REST APIs, authentication, feed generation, WebRTC signaling, SSE multiplexer | `LOCAL` | Critical | Vertical (Event Loop) |
| **SQLite WAL Engine** | ACID relational storage, B-tree indexes, foreign keys, versioned migrations | `LOCAL` | Critical | Single-Writer / Multi-Reader |
| **Atomic JSON Engine** | Human-readable state snapshot, rolling `.bak` disaster recovery | `LOCAL` | Medium | In-Memory Cached |
| **Media CAS Store** | Local disk media files, chunked streaming, range request handler | `LOCAL` | High | Block Storage / PVC |
| **Noise_XX P2P Daemon** | Peer discovery, end-to-end encrypted node-to-node dispatches | `DECENTRALIZED` | High | P2P Swarm Topology |
| **BLE Mesh Router** | Store-and-forward outbox/inbox for offline/airgapped device sync | `DECENTRALIZED` | Medium | Ad-Hoc Bluetooth Mesh |
| **Coturn Relay** | STUN NAT discovery & TURN media relay for WebRTC calling | `EXTERNAL / OPTIONAL`| High (Calling) | Horizontal TURN Pool |

---

## 3. Subsystem Architectural Details

### 3.1 Security & Authentication Architecture
- **Cryptographic DID Identity:** Node identity is rooted in `did:key` Ed25519 cryptographic keypairs generated using native RFC 8032 cryptography.
- **Fail-Closed Principle:** When `NODE_ENV=production`, `ADMIN_SECRET_KEY` is strictly required to be at least 32 characters, and prototype keys (`sovra-operations-master-key`) cause the process to exit immediately.
- **Token Bucket Rate Limiting:** All incoming connections are rate-limited per client IP with distinct buckets for general traffic (200 capacity), authentication endpoints (30 capacity), and administrative operations (20 capacity).
- **OWASP Security Headers:** Every HTTP response enforces:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(self), microphone=(self), geolocation=()`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` (when on HTTPS)

### 3.2 Database Engine & Concurrency Model
- **SQLite WAL Mode:** Write-Ahead Logging allows concurrent reads without blocking writes and concurrent writes without blocking reads.
- **Statement Caching:** Prepared SQL statements (`StatementSync`) are cached in memory via `this.prepareCached(sql)`, delivering point query throughput exceeding 50,000 ops/sec.
- **Schema Migrations:** Managed deterministically by `SqliteMigrationRunner` using atomic transactions and checksum verification recorded in `schema_migrations`.
- **Single-Writer Constraint:** Because SQLite database locks cannot safely span multiple machines across a network filesystem, production nodes run as Kubernetes `StatefulSets` with 1 replica attached to a high-speed PersistentVolume (ReadWriteOnce).

### 3.3 WebRTC Signaling & Media Relay Architecture
- **Deterministic State Machine:** WebRTC calls progress through explicit states (`IDLE` → `RINGING` → `CONNECTING` → `CONNECTED` → `ENDED`).
- **Dynamic Ephemeral Credentials:** Ephemeral TURN credentials are generated on-demand per authenticated user DID using HMAC-SHA1 signatures with short TTLs (default 24h).
- **Real ICE Server Discovery:** Public Google STUN servers (`stun.l.google.com:19302`) provide primary STUN resolution, while dedicated Coturn relays provide symmetric NAT fallback.

### 3.4 Media Persistence & Streaming
- **Range Request Handler:** Video and audio assets support standard RFC 7233 byte-range requests (`Range: bytes=start-end`), responding with `206 Partial Content`, `Content-Range`, and `Accept-Ranges: bytes`.
- **Payload Bounds:** Uploads are strictly bounded by `readBoundedBody` with hard limits (50MB for media, 10MB for avatars/chat, 64KB for JSON metadata) to eliminate heap exhaustion.
