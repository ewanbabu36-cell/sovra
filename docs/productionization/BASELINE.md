# Sovra — Productionization Baseline (Phase 0)

## 1. Repository Structure Overview
* **Root Directory:** `d:\Sovra`
* **Monorepo Manager:** `pnpm` (v12.8.1 / >=9.0.0) with workspace configuration.
* **Orchestration:** `turbo` (v2.4.4).
* **Language Runtime:** Node.js `>=20.0.0` with `--experimental-strip-types` TypeScript execution.
* **Testing Framework:** Vitest (v3.x), 116 test files with 669+ test cases across unit, integration, and E2E suites.

---

## 2. Applications (`apps/`)
1. **`apps/sovra-app`**: Consumer Web Application (Product A).
   * Framework: React 19, TypeScript.
   * State / Hooks: Passkey session (`usePasskeySession.ts`), WebRTC calling (`useWebRtcCall.ts`), UI modal controllers (`CallModal.ts`).
2. **`apps/sovra-admin`**: Operations & Observability Console (Product B).
   * Dashboard, peer topologies, audit trail logs, moderation action views.
3. **`apps/sovra-mobile`**: Mobile Client (iOS / Android).
   * Framework: React Native / Expo.
   * Navigation: BottomTabNavigator (`FeedScreen`, `ReelsScreen`, `WatchScreen`, `ChatsScreen`, `MeScreen`).

---

## 3. Packages (`packages/`)
* **`packages/crypto`**: Ed25519, X25519, ChaCha20-Poly1305, Proof-of-Work (PoW) dynamic difficulty generator.
* **`packages/identity`**: W3C DID document generator (`did:key`, `did:sovra`), passkeys, principal RBAC, guardian recovery.
* **`packages/messaging`**: 1:1 chat engine, WebRTC voice/video signaling, BitChat zero-internet offline mesh engine, blind push notifications.
* **`packages/moderation`**: Local blocklists, report queues, keyword heuristic classifiers, sovereign filtering.
* **`packages/p2p`**: Libp2p node wrapper, TCP transport (port 4001), Noise_XX encryption, GossipSub pubsub, Kademlia DHT routing, BLE transport simulations.
* **`packages/protocol`**: Canonical wire envelope, signed operation authorization, CRDT projections, Merkle bandwidth receipts, replay defense.
* **`packages/shared`**: DTO schemas, utility functions, security hardening types.
* **`packages/social`**: Social graph (follows, friends, mutes, blocks), portable reputation, knowledge governance, HLC CRDT feed ordering.
* **`packages/storage`**: Content-addressed blockstore (CID v1), UnixFS chunker, Bitswap protocol engine, ABR cache, Reels transcoding adapters.
* **`packages/ui`**: Shared UI tokens and layout primitives.
* **`packages/ai`**: Local sovereign assistant and categorization models.

---

## 4. Services (`services/`) & Specialized Nodes (`nodes/`)
* **`services/search`**: Indexing service for users, hashtags, posts, and CIDs.
* **`services/transcoder`**: Video pipeline converting raw uploads to HLS and perceptual SSIM quality targets.
* **`services/moderation-worker`**: Background queue worker processing user reports and audit logs.
* **`nodes/community-node`**: Relay & pin node for neighborhood clusters.
* **`nodes/full-node`**: Full state validator maintaining gossipsub and DHT.
* **`nodes/index-node`**: Content catalog search indexer.
* **`nodes/relay-node`**: Circuit relay v2 NAT traversal helper.
* **`nodes/storage-node`**: Storage seeder node with bandwidth accounting and perceptual multisig.

---

## 5. Storage & Database Layer
* **Persistent DB Engine:** [`scripts/database-engine.ts`](file:///d:/Sovra/scripts/database-engine.ts)
* **Data File:** `.sovra-storage-dev/dynamic-social-state.json` (configurable via `SOVRA_STORAGE_DIR`).
* **Collections:**
  1. `users`: Sovereign user profiles, DIDs, handles, credentials, balances.
  2. `posts`: Multi-format posts (text, photos, video, reels, articles, polls, Q&A, quizzes, moods, events, ratings, ideas).
  3. `comments`: Post comments with threaded parent-child replies.
  4. `direct_messages`: 1:1 encrypted messages with read receipts and reactions.
  5. `channels`: Public/private channels with member rosters and roles.
  6. `channel_messages`: Channel broadcasts.
  7. `friend_relationships`: Bilateral friend requests and handshakes.
  8. `reels`: Short-form vertical video metadata with CIDs.
  9. `tip_vouchers`: Micro-tipping ledger.
  10. `audit_logs`: Operations and moderation activity audit trail.
  11. `stories`: 24-hour ephemeral stories.
  12. `notifications`: Real-time user notifications.
  13. `call_sessions`: WebRTC session state.
  14. `follows`: Asymmetric follower/following social graph.
  15. `user_sessions`: Multi-device active hardware sessions with remote revocation.

---

## 6. API & Network Entry Points
* **Primary Server Daemon:** [`scripts/dev-server.ts`](file:///d:/Sovra/scripts/dev-server.ts)
  * Default HTTP Port: `3001` (LAN bound, accessible via `http://localhost:3001` and local Wi-Fi IP).
  * Default P2P TCP Port: `4001` (Noise_XX encrypted libp2p mesh socket).
  * Web Application Routes:
    * `/`: Consumer Application (Product A).
    * `/admin`: Operations & Admin Console (Product B).
    * `/assets/bundle.js`: Compiled client asset bundle.
    * `/api/*`: REST API with JSON payloads and Bearer token authentication.

---

## 7. Build System & Deployment Assumptions
* Development & Node run: `node --experimental-strip-types scripts/dev-server.ts`.
* Client Bundler: `node --experimental-strip-types scripts/build-client-bundle.ts`.
* Tests: `vitest run` across monorepo packages and E2E suites.
* Key Environment Variables:
  * `PORT`: HTTP listener port (default 3001).
  * `P2P_PORT`: libp2p TCP port (default 4001).
  * `ADMIN_SECRET_KEY`: Secret string required for administrative authorization.
  * `SOVRA_STORAGE_DIR`: Directory path for persistent database and blockstore files.
  * `SOVRA_BASE_URL`: Base target URL for automated E2E test runs (default `http://localhost:3001`).
