# Sovra — System Architecture Inventory (Phase 1)

This document provides a comprehensive architectural inventory of all 17 subsystems in the Sovra decentralized social platform.

---

## 1. FRONTEND
* **Subsystems:**
  * Web Consumer App (`apps/sovra-app` + HTML client in `scripts/dev-server.ts`)
  * Web Ops Console (`apps/sovra-admin` + HTML dashboard in `scripts/admin-console.ts`)
  * Mobile Client (`apps/sovra-mobile`)
* **Entry Points:**
  * Web Consumer: `GET /` via `scripts/dev-server.ts`
  * Web Admin: `GET /admin` via `scripts/dev-server.ts`
  * Mobile: `apps/sovra-mobile/App.tsx`
* **Dependencies:** React 19, Lucide SVG icons, Native canvas image compression, WebSocket / EventSource.
* **APIs Used:** All `/api/*` endpoints.
* **Failure Handling:** Fallback offline placeholders, defensive modal display styles, authenticatedFetch error trap.
* **Production Risks:** Monolithic inline HTML/JS template string escaping collisions, client-side memory leaks in long-running tabs.

---

## 2. BACKEND / SERVER RUNTIME
* **Subsystem:** Node.js HTTP/P2P Server Daemon (`scripts/dev-server.ts`, `scripts/bootstrap-node.ts`).
* **Entry Points:** `scripts/dev-server.ts:main()` bound to OS TCP ports (3001 HTTP, 4001 P2P).
* **Dependencies:** Node built-in `http`, `crypto`, `fs`, `path`, `@libp2p/*`.
* **APIs:** 50+ REST endpoints covering identity, feed, reactions, chat, media, friends, follows, sessions, node status.
* **Authorization:** `resolvePrincipal()` / `enforceAuth()` verifying Bearer session tokens or Admin secret key.
* **Failure Handling:** HTTP 400/401/403/404/409/429/500 JSON responses with rate limiting and bounded body readers (max 64KB - 50MB).
* **Production Risks:** Single-process node event loop starvation under high compute loads (e.g. video transcoding or heavy crypto verification).

---

## 3. DATABASE & PERSISTENCE
* **Subsystem:** `SovraDatabaseEngine` (`scripts/database-engine.ts`).
* **Entry Points:** `new SovraDatabaseEngine(storageDir)`.
* **Persistence:** Atomic JSON file write to `.sovra-storage-dev/dynamic-social-state.json`.
* **Collections (15):** `users`, `posts`, `comments`, `direct_messages`, `channels`, `channel_messages`, `friend_relationships`, `reels`, `tip_vouchers`, `audit_logs`, `stories`, `notifications`, `call_sessions`, `follows`, `user_sessions`.
* **Production Risks:** Process crashes during non-atomic write without fsync/temp-rename, schema migrations across versions.

---

## 4. AUTHENTICATION (AUTH)
* **Subsystem:** Decentralized Identity (`packages/identity`) & Session Engine (`scripts/database-engine.ts`).
* **Entry Points:**
  * `POST /api/user/register`
  * `POST /api/user/login`
  * `POST /api/user/logout`
  * `GET /api/user/sessions`
  * `POST /api/user/sessions/revoke`
* **Tokens:** High-entropy 192-bit cryptographic bearer tokens (`stk_<48 hex chars>`).
* **Credentials:** W3C Ed25519 DID keys, passkeys, local pin authentication.
* **Production Risks:** Token theft if served over plain unencrypted HTTP instead of HTTPS/TLS.

---

## 5. AUTHORIZATION & ACCESS CONTROL (AUTHZ / BOLA / IDOR)
* **Subsystem:** Principal RBAC (`packages/identity/src/principal.ts`, `scripts/dev-server.ts`).
* **Policy:**
  * Public: Readable by everyone.
  * Friends: Bilateral `friend_relationships` status `'accepted'`.
  * Only-Me: Principal DID strictly equals Author DID.
* **Protection:** `enforceAuth()` verifies caller token matches requested mutation actor (prohibits forging another user's DID).
* **Production Risks:** BOLA/IDOR if endpoints read user identity from body parameters instead of authenticated session token.

---

## 6. MEDIA & BLOCKSTORE PLATFORM
* **Subsystem:** Content-Addressed Storage (`packages/storage`, `services/transcoder`).
* **Entry Points:** `POST /api/media/upload`, `POST /api/storage/pin`, `GET /api/media/:cid`.
* **Persistence:** Raw blocks indexed by SHA2-256 CID v1 in `.sovra-storage-dev/blocks`.
* **Processing:** Client-side canvas compression (1280x720 max), Base64 data URL handling, SSIM perceptual hash validation.
* **Production Risks:** Memory bloat when handling multi-megabyte video streams in memory buffers.

---

## 7. CHAT & MESSAGING
* **Subsystem:** Direct Messaging (`packages/messaging`, `scripts/database-engine.ts`).
* **Entry Points:**
  * `POST /api/messages/send`
  * `GET /api/messages/thread?peerDid=...`
  * `POST /api/messages/reaction`
  * `POST /api/messages/receipt`
* **Realtime:** HTTP long-polling and libp2p pubsub channels with delivery receipts and blue ticks.
* **Persistence:** `direct_messages` collection with sender/recipient DIDs and timestamps.
* **Production Risks:** Out-of-order message delivery across distributed hops.

---

## 8. REALTIME & WEBRTC
* **Subsystem:** P2P Signaling & Mesh Transport (`packages/messaging/src/webrtc-call.ts`, `packages/p2p`).
* **Entry Points:**
  * `POST /api/call/signal`
  * `GET /api/call/poll?peerDid=...`
  * `POST /api/call/end`
* **Signal States:** `OFFER`, `ANSWER`, `ICE_CANDIDATE`, `RINGING`, `CONNECTED`, `ENDED`.
* **Production Risks:** Symmetric NAT traversal without configured STUN/TURN relays.

---

## 9. P2P MESH NETWORKING
* **Subsystem:** Libp2p Node Engine (`packages/p2p/src/node.ts`).
* **Transports:** TCP socket on port 4001, Noise_XX security handshake, Yamux stream multiplexer.
* **PubSub:** GossipSub v1.1 topics (`sovra/social/graph/v1`, `sovra/feed/v1`).
* **Routing:** Kademlia DHT peer routing and discovery.
* **Production Risks:** Firewall blocks on raw TCP port 4001; needs WebSocket fallback.

---

## 10. BLE (BLUETOOTH LOW ENERGY) MESH
* **Subsystem:** BitChat Zero-Internet Mesh (`packages/messaging/src/bitchat-mesh.ts`).
* **Status:** Automated / Simulated tests verified; Physical BLE hardware layer is **UNVERIFIED (simulated)**.
* **Framing:** 512-byte MTU chunking, Reed-Solomon forward error correction, hop-limit gossip.

---

## 11. NOTIFICATIONS
* **Subsystem:** Persistent Notification Center (`scripts/database-engine.ts`).
* **Events:** `FOLLOW`, `LIKE`, `COMMENT`, `FRIEND_REQUEST`, `FRIEND_ACCEPT`, `TIP`, `CHAT`.
* **Persistence:** `notifications` collection with unread counters and batch mark-read.

---

## 12. SEARCH
* **Subsystem:** Omni-Search (`services/search`, `packages/social/src/omni-search.ts`).
* **Endpoints:** `GET /api/search?q=...&category=...`
* **Indices:** User handles, display names, post captions, hashtags `#tag`.
* **Production Risks:** Unindexed substring searches on very large databases; needs trigram index.

---

## 13. MODERATION & REPORTING
* **Subsystem:** Community Moderation (`packages/moderation`, `services/moderation-worker`).
* **Endpoints:** `POST /api/social/report`, `POST /api/social/block`, `POST /api/social/mute`.
* **Audit Trail:** Immutable `audit_logs` collection recording action, target, actor, timestamp.

---

## 14. ADMIN & OPERATIONS CONSOLE
* **Subsystem:** Ops Dashboard (`apps/sovra-admin`, `scripts/admin-console.ts`).
* **Entry Point:** `GET /admin` on port 3001.
* **Security:** Gated behind `ADMIN_SECRET_KEY` via `adminSecurity.resolveAdminSession()`.
* **Features:** Node health status, real-time memory/CPU metrics, peer list, audit logs, storage inspection.

---

## 15. ANALYTICS & TELEMETRY
* **Subsystem:** Node Telemetry (`GET /api/status`, `GET /api/node/storage-stats`).
* **Metrics:** Active blocks, disk bytes/MB, uptime, online peer count, total registered users, total posts.

---

## 16. BUILD & ASSETS
* **Subsystem:** Build Bundler (`scripts/build-client-bundle.ts`).
* **Output:** `dist/bundle.js` served at `/assets/bundle.js`.
* **Scripts:** TypeScript typechecking, Vitest runner, ESLint, Prettier.

---

## 17. TESTING
* **Suites:** 116 test files.
  * Unit tests: `packages/*/test`
  * Node tests: `nodes/*/test`
  * Service tests: `services/*/test`
  * E2E tests: `tests/e2e/*.test.ts`
  * Security boundary tests: `tests/security/*.test.ts`
* **Syntax Verification Gate:** `tests/e2e/browser-script-syntax-gate.test.ts`.
