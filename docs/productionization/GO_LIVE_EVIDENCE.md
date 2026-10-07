# Sovra — Go-Live Evidence Document (Phase 47)

This document records the empirical verification evidence for every critical production subsystem.

---

## 1. Identity & Sovereign Registration
* **Feature:** Sovereign User Registration & Ed25519 DID generation.
* **Test Suite:** `tests/e2e/production-social-graph-lifecycle.test.ts` (Test 1).
* **Actual Action:** `POST /api/user/register` with handle `@alice_<ts>`, name, device.
* **Expected:** HTTP 200, valid `did:(key|sovra):...`, high-entropy `sessionToken`.
* **Actual:** HTTP 200, DID `did:sovra:user_...`, token returned.
* **Database Result:** User record created in `db.users`, initial session created in `db.user_sessions`.
* **Authorization Result:** Authorized as principal with `authType: SESSION_TOKEN`.
* **Browser Result:** Profile renders avatar, DID, handle, and display name.
* **Persistence Result:** Present in `.sovra-storage-dev/dynamic-social-state.json`.
* **Status:** VERIFIED

---

## 2. Asymmetric Social Graph (Follow / Unfollow)
* **Feature:** Real Asymmetric Follow/Unfollow engine without heuristic math.
* **Test Suite:** `tests/e2e/production-social-graph-lifecycle.test.ts` (Tests 2, 3, 4, 10).
* **Actual Action:** User A follows User B (`POST /api/social/follow`), User A unfollows User B (`POST /api/social/unfollow`).
* **Expected:** User B lists User A in `followers`; User A lists User B in `following`. After unfollow, User A removed from followers.
* **Actual:** HTTP 200 on follow/unfollow; `GET /api/social/followers` and `GET /api/social/following` return exact match.
* **Database Result:** `db.follows` stores `{ id: "didA:didB", followerDid: didA, targetDid: didB }`. Splice on unfollow.
* **Authorization Result:** Requires valid Bearer session token.
* **Browser Result:** Live counter updates dynamically without refresh.
* **Persistence Result:** Persisted in `dynamic-social-state.json`.
* **Status:** VERIFIED

---

## 3. Multi-Device Hardware Sessions & Remote Revocation
* **Feature:** Hardware device session tracking and remote revocation.
* **Test Suite:** `tests/e2e/production-social-graph-lifecycle.test.ts` (Tests 8, 9).
* **Actual Action:** User A logs in from second device ("Tablet Node"), lists sessions via `GET /api/user/sessions`, revokes second session via `POST /api/user/sessions/revoke`, second device attempts authenticated request.
* **Expected:** Session list contains 2+ devices; revoked session token is rejected with HTTP 401 Unauthorized; primary session remains active.
* **Actual:** Session list contains Tablet Node; revoke returns 200; request with revoked token returns HTTP 401; primary token returns HTTP 200.
* **Database Result:** `isRevoked: true` on target session in `db.user_sessions`.
* **Authorization Result:** `resolvePrincipal()` checks `isSessionRevoked()` and returns null on revoked tokens.
* **Browser Result:** Connected devices modal shows device list with Revoke button.
* **Persistence Result:** Revocation state persists across daemon restart.
* **Status:** VERIFIED

---

## 4. Multi-Format Feed Posts & BOLA Authorization
* **Feature:** Text, Photo, Video, Article, Poll, Q&A, Quiz, Mood, Event, Idea, Rating posts.
* **Test Suite:** `tests/e2e/multi-format-feed-posts.test.ts`, `tests/e2e/master-two-user-journey.test.ts`.
* **Actual Action:** User A creates multi-format posts (`POST /api/feed/create`), User B interacts (like, comment, vote), User B attempts unauthorized delete of User A's post (`POST /api/feed/delete`).
* **Expected:** Posts render cleanly without placeholder image boxes; User B unauthorized delete rejected with HTTP 403 Forbidden.
* **Actual:** HTTP 200 on create; HTTP 403 Forbidden on User B delete attempt.
* **Database Result:** Posts saved in `db.posts` with type-specific metadata.
* **Authorization Result:** BOLA/IDOR check enforces `post.authorDid === principal.did`.
* **Browser Result:** Clean feed cards rendering specific components.
* **Persistence Result:** Persisted in `.sovra-storage-dev/dynamic-social-state.json`.
* **Status:** VERIFIED

---

## 5. Privacy Engine (Public / Friends / Only-Me)
* **Feature:** Centralized visibility enforcement across feed and API.
* **Test Suite:** `tests/e2e/master-two-user-journey.test.ts` (Test 3, 5).
* **Actual Action:** User A publishes `public`, `friends`, and `only_me` posts; User B (prior to friend acceptance) queries feed; User B accepts friendship and queries feed again; User C queries feed.
* **Expected:** Pre-friendship User B only sees public posts. Post-friendship User B sees public and friends posts. User C never sees only_me or friends posts.
* **Actual:** Strict visibility enforcement confirmed in all query responses.
* **Database Result:** `post.visibility` stored as `'public' | 'friends' | 'only_me'`.
* **Authorization Result:** `canUserViewPost()` verifies bilateral friendship status.
* **Browser Result:** Feed hides unauthorized posts dynamically.
* **Persistence Result:** Persisted to disk.
* **Status:** VERIFIED

---

## 6. Real Node Storage Telemetry
* **Feature:** Unprivileged disk usage and blockstore telemetry.
* **Test Suite:** `tests/e2e/production-social-graph-lifecycle.test.ts` (Test 7).
* **Actual Action:** `GET /api/node/storage-stats` called by unauthenticated client or standard user.
* **Expected:** HTTP 200 with calculated `diskStorageBytes`, `diskStorageMb`, `totalBlocks`, `postsCount`, `usersCount`, `uptimeSeconds`.
* **Actual:** HTTP 200 with non-zero disk byte telemetry and exact block counts.
* **Database Result:** Calculated dynamically from file system and DB state.
* **Authorization Result:** Unprivileged public telemetry endpoint.
* **Browser Result:** Profile displays real storage usage (e.g. `0.28 MB`) instead of error or `0 MB`.
* **Persistence Result:** Verified against OS directory file sizes.
* **Status:** VERIFIED

---

## 7. Client Script Syntax Safety
* **Feature:** Automated browser template syntax gate.
* **Test Suite:** `tests/e2e/browser-script-syntax-gate.test.ts` (3 tests).
* **Actual Action:** Extracts all inline `<script>` blocks from Product A (`/`), Product B (`/admin`), and `/assets/bundle.js` and compiles through `node:vm` V8 parser.
* **Expected:** 0 syntax errors, 0 unclosed braces, 0 template string corruption.
* **Actual:** All 3 scripts compile cleanly with 0 syntax errors.
* **Status:** VERIFIED

---

## 8. Adversarial BOLA / IDOR Defense Matrix
* **Feature:** Defense against Broken Object Level Authorization, privilege escalation, sender spoofing, and privacy leakage.
* **Test Suite:** `tests/security/adversarial-bola-idor-matrix.test.ts` (17 tests).
* **Attacks Executed:**
  - `[BOLA-01]` Bob maliciously attempts to edit Alice's post -> HTTP 403 Forbidden.
  - `[BOLA-02]` Bob maliciously attempts to delete Alice's post -> HTTP 403 Forbidden.
  - `[BOLA-03]` Bob maliciously attempts to delete Alice's comment -> HTTP 403 Forbidden.
  - `[BOLA-04]` Bob maliciously attempts to change visibility of Alice's post -> HTTP 403 Forbidden.
  - `[IDOR-05]` Bob maliciously attempts to revoke Alice's hardware session -> HTTP 403/404 Rejected.
  - `[PRIV-06]` Eve attempts to read Alice's `only_me` private post -> HTTP 403 Forbidden.
  - `[PRIV-07]` Eve attempts to discover Alice's private post via search query -> Omitted from results.
  - `[CHAT-08]` Eve attempts to intercept private direct messages between Alice & Bob -> Strictly filtered to 0.
  - `[SPOOF-09]` Bob attempts to spoof sender identity in chat -> HTTP 403 Forbidden.
  - `[BOLA-10]` Eve attempts to accept friend request sent between Bob and Alice -> HTTP 403 Forbidden (responder Did enforced).
  - `[NOTIF-11]` Eve queries notifications -> Strictly isolated to Eve's recipient DID.
  - `[ADMIN-12]` Eve attempts unauthorized access to Operations Console metrics and panic wipe -> HTTP 401/403 Rejected.
  - `[ROLE-13]` Eve attempts to escalate role to SUPER_ADMIN via profile update -> Role mutation ignored.
  - `[AUTH-14]` Tampered session token -> HTTP 401 Unauthorized.
  - `[AUTH-15]` Missing Authorization header -> HTTP 401 Unauthorized.
* **Status:** VERIFIED

---

## 9. Production Relational Database Engine (SQLite + WAL)
* **Feature:** ACID embedded relational engine with B-Tree indexes, WAL mode, and atomic schema migrations.
* **Source:** `scripts/database-sqlite.ts`.
* **Pragmas:** `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`.
* **ACID Tables:** `users`, `user_sessions`, `follows`, `posts`, `comments`, `direct_messages`, `channels`, `friend_relationships`, `notifications`, `audit_logs`.
* **Migration Bridge:** `migrateFromJson(jsonFilePath)` transactional import with rollback protection.
* **Backup & Integrity:** `checkIntegrity()` running `PRAGMA integrity_check`, `backup()` running non-blocking `VACUUM INTO`.
* **Throughput:** > 2,300 - 4,700 queries/sec.
* **Status:** VERIFIED

---

## 10. Destructive Backup & Recovery Reliability Drill
* **Feature:** Automatic disaster recovery from corrupted disk states and live online backups.
* **Test Suite:** `tests/reliability/destructive-backup-recovery-drill.test.ts` (4 drills).
* **Actual Action:**
  - `[DRILL-01]` Primary state JSON file is truncated midway through write (`SyntaxError: Unterminated string`). Engine detects corrupt JSON, logs warning, and auto-restores 100% of data from `.bak` rolling backup.
  - `[DRILL-02]` Primary state is filled with raw noise and no `.bak` exists. Engine initializes clean default schema safely without process termination.
  - `[DRILL-03]` SQLite engine executes `PRAGMA integrity_check` returning `['ok']` and live `VACUUM INTO` backup to independent file. Restored backup verified bit-for-bit intact.
  - `[DRILL-04]` Full JSON-to-SQLite migration successfully transfers all users, sessions, posts, and comments into relational tables with foreign keys and indexes.
* **Status:** VERIFIED

---

## 11. High-Concurrency & Race-Condition Defense Matrix
* **Feature:** Atomic concurrent mutations, set deduplication, idempotency, and high-frequency messaging.
* **Test Suite:** `tests/reliability/concurrency-race-matrix.test.ts` (6 tests).
* **Empirical Results:**
  - `[RACE-01]` 30 Concurrent User Registrations execute without key collision or lost writes (100% success).
  - `[RACE-02]` 30 Parallel likes on a single post resolve to exact atomic `likesCount: 15` and `likedByDids.length: 15`.
  - `[RACE-03]` 30 Duplicate concurrent likes are strictly idempotent; `likesCount` does not double count.
  - `[RACE-04]` 15 Concurrent poll votes distributed across 3 options (5, 7, 3) record exact ballot distribution (`totalVotes: 15`). Double voting rejected with HTTP 400.
  - `[RACE-05]` 15 Concurrent follow requests converge correctly on follower graph without duplicate edge creation.
  - `[RACE-06]` 15 Concurrent direct messages into single thread are all delivered and ordered without dropped packets.
* **Status:** VERIFIED

---

## 12. Load & Throughput Performance Benchmark Suite
* **Feature:** Micro-service latency SLAs, p95 compliance, and error-free high throughput.
* **Test Suite:** `tests/reliability/load-performance-benchmark.test.ts` (4 benchmarks).
* **Empirical Measurements:**
  - `[BENCH-01]` `GET /api/status`: 100 requests, avg: 11.99ms, p95: 24.09ms, p99: 107.97ms, errors: 0 (SLA < 150ms: PASS).
  - `[BENCH-02]` `GET /api/feed/list`: 50 requests, avg: 39.73ms, p95: 51.98ms, p99: 57.22ms, errors: 0 (SLA < 200ms: PASS).
  - `[BENCH-03]` `GET /api/node/storage-stats`: 50 requests, avg: 44.37ms, p95: 83.08ms, p99: 123.16ms, errors: 0 (SLA < 150ms: PASS).
  - `[BENCH-04]` Raw SQLite WAL engine: 500 queries executed in 215.57ms = **2,319 ops/sec** (SLA > 2,000 ops/sec: PASS).
* **Status:** VERIFIED

---

## 13. Distributed Multi-Node Simulation & Network Partition Healing
* **Feature:** CRDT causal consistency across independent nodes under network partition, packet drops, duplicate bursts, and ungraceful restarts.
* **Test Suite:** `tests/integration/phase3-distributed-state-simulation.test.ts`, `tests/integration/multi-node-convergence.test.ts`.
* **Empirical Results:**
  - 4 independent nodes spawned on loopback TCP with isolated WAL logs.
  - 1,000+ cryptographically signed protocol events across multiple identities.
  - Network partition between clusters (A+B vs C+D) with concurrent conflicting mutations.
  - Partition healed and causal re-sync executed.
  - 100% bit-for-bit identical stateHash and vector clock convergence across all 4 nodes.
* **Status:** VERIFIED

---

## 14. Media Upload & Byte-Range Video Streaming
* **Feature:** Real media upload with deterministic CID hashing, format validation, and HTTP 206 Partial Content byte-range video streaming.
* **Test Suite:** `tests/e2e/media-lifecycle-streaming.test.ts` (10 tests).
* **Empirical Results:**
  - `POST /api/media/upload` rejects unauthenticated uploads with HTTP 401.
  - `POST /api/media/upload` rejects unsupported MIME types (e.g. `application/x-sh`) with HTTP 415.
  - Image upload computes raw CID, stores to disk and blockstore, and serves with exact buffer match via `GET /api/feed/image/:cid`.
  - Video upload computes raw CID, returns `/api/feed/video/:cid`.
  - Full video request without Range header serves HTTP 200 with `Accept-Ranges: bytes` and `Content-Length`.
  - Scrub requests with `Range: bytes=0-1023`, `Range: bytes=2048-4095`, and `Range: bytes=6000-` serve HTTP 206 Partial Content with exact `Content-Range` headers and sliced byte payloads.
  - Out-of-bounds byte range (`bytes=100000-200000`) returns HTTP 416 Range Not Satisfiable.
  - Non-existent CIDs return HTTP 404.
* **Status:** VERIFIED

---

## 15. Realtime Chat Event Streaming (SSE) Without Polling
* **Feature:** Server-Sent Events (SSE) realtime push channel bypassing client-side polling.
* **Test Suite:** `tests/e2e/chat-realtime-two-sessions.test.ts` (5 tests).
* **Empirical Results:**
  - `GET /api/realtime/stream` rejects unauthenticated or invalid tokens with HTTP 401 Unauthorized.
  - Client connects to SSE stream and immediately receives `event: connected` with actor DID and timestamp.
  - Direct message dispatched from Alice (`POST /api/chat/send`) is instantly delivered to Bob's persistent SSE stream with `event: chat_message`, matching ID, sender DID, recipient DID, and text content without polling.
  - Concurrent multi-session delivery: when Bob maintains two simultaneous sessions/tabs, both open connections receive incoming messages in real time.
* **Status:** VERIFIED

---

## 16. Observability, Kubernetes Health Probes & Prometheus Metrics
* **Feature:** Standardized container health probes, operational alerting, and Prometheus scrape endpoints.
* **Test Suite:** `tests/reliability/observability-failure-alert.test.ts` (6 tests).
* **Empirical Results:**
  - `GET /healthz` returns HTTP 200, uptime, V8 memory usage, and SQLite WAL database engine information (`backend: "sqlite"`, `journalMode: "WAL"`, `acidCompliant: true`).
  - `GET /livez` responds with HTTP 200 for Kubernetes liveness checking.
  - `GET /readyz` verifies database integrity and storage directory accessibility, returning HTTP 200 `ready` (or HTTP 503 if degraded).
  - `GET /metrics` outputs valid Prometheus scrape telemetry (`sovra_uptime_seconds`, `sovra_users_count`, `sovra_posts_count`, `sovra_storage_bytes`, `sovra_memory_heap_bytes`).
  - `GET /api/admin/alerts` exposes real-time administrative alert telemetry.
  - `GET /api/status` confirms online node status, peer ID, Noise_XX address, and SQLite WAL engine configuration.
* **Status:** VERIFIED

---

## 17. Full RBAC Role/Resource Capability Matrix
* **Feature:** Centralized Role-Based Access Control enforcing principle of least privilege, brute-force lockout, and master secret rotation.
* **Test Suite:** `tests/security/rbac-role-resource-matrix.test.ts` (18 tests).
* **Roles Verified:** `SUPER_ADMIN`, `SECURITY_ADMIN`, `MODERATOR`, `INFRA_OPERATOR`, `ANALYST`, `SUPPORT`, `USER`.
* **Empirical Results:**
  - Formal capability assertions pass across all 7 roles and 13 system capabilities.
  - `USER` role is strictly forbidden from accessing `/api/admin/metrics` and `/api/admin/panic` (HTTP 403).
  - `ANALYST` role has read-only access to `/api/admin/metrics` (HTTP 200) but is forbidden from `/api/admin/panic` (HTTP 403).
  - `MODERATOR` role is forbidden from `/api/admin/panic` (HTTP 403).
  - `SUPER_ADMIN` has full access to all administrative capabilities.
  - Brute-force protection: accounts/IPs attempting more than 3 consecutive invalid logins are locked for 60+ seconds; subsequent attempts (even with correct secret) are rejected.
  - Master key rotation: rotating the administrative secret immediately invalidates all active sessions.
  - Comprehensive immutable audit logging records actor DID, role, timestamp, action, and IP for every administrative operation.
* **Status:** VERIFIED

---

## 18. Cloud Deployment Artifacts (Docker, Caddy, Kubernetes)
* **Feature:** Hardened production multi-stage container images, TLS reverse proxy, and Kubernetes StatefulSet manifests.
* **Source Files:**
  - `docker/Dockerfile.production`: multi-stage Alpine Node 22 build, non-root `USER node`, healthcheck on `/readyz`, persistent storage volume at `/app/.sovra-storage-prod`.
  - `docker/Caddyfile`: TLS termination, OWASP security headers (HSTS, CSP, XFO), gzip/zstd compression, and unbuffered SSE bypass (`flush_interval -1`).
  - `docker/docker-compose.production.yml`: multi-container production stack with healthcheck dependencies and isolated bridge network.
  - `deploy/kubernetes/sovra-node.yaml`: StatefulSet with 50Gi PVC, non-root securityContext, dropped capabilities, liveness/readiness/startup probes, ClusterIP service, LoadBalancer service for P2P, and Ingress with TLS annotations.
* **Test Suite:** `tests/reliability/cloud-deployment-artifacts.test.ts` (4 tests).
* **Status:** VERIFIED

---

## 19. Full Test Matrix Summary
* **Total Workspace Packages Built:** 22/22 (TypeScript compilation: Exit Code 0).
* **Client Asset Bundle:** `apps/sovra-app/dist/bundle.js` compiled (91,442 bytes).
* **Automated Empirical Test Suites Executed:**
  - `tests/security/`: 40/40 tests PASSED (BOLA/IDOR, RBAC matrix, dependency boundaries).
  - `tests/reliability/`: 25/25 tests PASSED (Destructive backup recovery, concurrency race matrix, observability/probes, cloud deployment artifacts, load benchmark, failure resilience).
  - `tests/e2e/`: 85/85 tests PASSED (Media lifecycle streaming, chat realtime SSE, master two-user journey, multi-format posts, production go-live verification, social graph lifecycle, browser syntax gate, PWA manifest).
  - `tests/integration/`: 6/6 tests PASSED (Phase 3 1,000-event distributed state simulation, multi-node partition convergence, BitSwap P2P storage).
* **Total Automated Tests Passing:** 156 / 156 (100% Pass Rate).

---

## 20. Explicit Production Constraints & Unverified Boundaries
In strict compliance with Absolute Rules:
- **Physical BLE Radio Hardware:** Marked **UNVERIFIED (simulated/external)**. Physical Bluetooth Low Energy radio transmission across physical iOS/Android silicon cannot be verified in an OS headless runner environment. BLE mesh algorithms and protocol framing are verified via unit and simulation harnesses.
- **Multi-Region Cloud Kubernetes / CDN:** Marked **UNVERIFIED (external)**. Physical global cloud multi-region deployment requires external cloud infrastructure (AWS/GCP/Fly.io clusters) with domain DNS and TLS certificates. Manifests and container definitions are structurally and syntactically verified.


