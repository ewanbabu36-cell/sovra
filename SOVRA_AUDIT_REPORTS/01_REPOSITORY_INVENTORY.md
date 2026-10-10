# SOVRA Source-Code Health, Functionality & Release Readiness Audit
## Deliverable 01: Complete Repository Source-Code Inventory

**Audit Date:** 2026-10-09  
**Total Source Files:** 423  
**Total Lines of Code:** ~140,000  

---

### 1. Monorepo Structural Inventory

The repository is structured as a pnpm multi-package workspace with four top-level groupings (`apps`, `packages`, `nodes`, `services`), alongside root-level orchestration scripts and comprehensive end-to-end test suites.

| Subsystem / Workspace | Directory | Files | Lines of Code | Key Role / Primary Responsibility |
| :--- | :--- | :--- | :--- | :--- |
| **Consumer Web & Spatial App** | `apps/sovra-app` | 57 | 5,059 | Holographic Spatial Surface UI, Holo Core navigation, multi-modal creator suite |
| **Operations & Admin App** | `apps/sovra-admin` | 3 | 72 | Ops Console workspace definitions and administrative entry points |
| **Mobile Super-App** | `apps/sovra-mobile` | 28 | 9,329 | React Native super-app, Android Kotlin BLE module, iOS Objective-C++ bridge |
| **Cryptography Core** | `packages/crypto` | 9 | 892 | Ed25519, X25519, ChaCha20-Poly1305, Dynamic PoW, HKDF-SHA256 primitives |
| **Decentralized Identity** | `packages/identity` | 30 | 4,560 | `did:key`, device keys, passkeys, RBAC permissions, AdminSecurityEngine |
| **Protocol & Serialization** | `packages/protocol` | 31 | 8,631 | Signed operations, canonical envelopes, CBOR serialization, replay store |
| **P2P Transport & Mesh** | `packages/p2p` | 61 | 17,564 | Noise_XX, GossipSub, Kademlia DHT, BLE store-and-forward mesh router |
| **Social Graph & CRDT** | `packages/social` | 24 | 5,733 | HLC timestamps, Observed-Remove Set (OR-Set) CRDTs, feed ranking |
| **Content Storage & IPFS** | `packages/storage` | 25 | 5,106 | Content-addressable storage (CID), IPFS blocks, token-gated blockstore |
| **Secure Messaging & Calls** | `packages/messaging` | 12 | 2,179 | Double Ratchet session protocol, blind push tokens, WebRTC signaling |
| **Content Moderation** | `packages/moderation` | 3 | 128 | Automated taxonomy, perceptual hashing, moderation queue interfaces |
| **Sovereign Local AI** | `packages/ai` | 6 | 872 | On-device embeddings, semantic search, local LLM prompt orchestrators |
| **Design System Components** | `packages/ui` | 3 | 65 | Shared UI component interfaces, design tokens, responsive styles |
| **Common Utilities** | `packages/shared` | 8 | 374 | Result types, rate limiters, security policies, token buckets |
| **P2P Community Node** | `nodes/community-node` | 2 | 187 | Node daemon for private community servers and local federations |
| **P2P Full Node** | `nodes/full-node` | 2 | 185 | Standalone sovereign node daemon running storage, relay, and index |
| **P2P Index Node** | `nodes/index-node` | 2 | 234 | DHT indexing, peer discovery rendezvous, and query routing daemon |
| **P2P Relay Node** | `nodes/relay-node` | 2 | 146 | Circuit Relay v2 daemon for CGNAT traversal and TURN fallbacks |
| **P2P Storage Node** | `nodes/storage-node` | 11 | 2,559 | Dedicated storage daemon, BitSwap swarm provider, storage compliance |
| **Moderation Worker Service** | `services/moderation-worker` | 2 | 387 | Background quarantine evaluation worker, async hashing pipeline |
| **Search Index Service** | `services/search` | 2 | 390 | BM25 + semantic hybrid search service for profiles, channels, posts |
| **Media Transcoder Service** | `services/transcoder` | 3 | 317 | Video transcoding pipeline (RFC 8216 HLS segmentation, multi-bitrate) |
| **Development & Engine Scripts** | `scripts` | 16 | 56,339 | Unified HTTP/HTTPS/P2P dev server, SQLite WAL database engine, backup drills |
| **Root E2E & Security Tests** | `tests` | 56 | 16,220 | Multi-device E2E, WebRTC media transfer, RBAC matrices, durability drills |

---

### 2. Runtime Entry Points & Core Orchestration

1. **Local Development & Integration Runtime (`scripts/dev-server.ts`):**
   - Size: 41,435 lines (2,002 KB).
   - Serves dual HTTP (`:3001`) and HTTPS (`:3443`), alongside P2P Noise_XX TCP (`:4001`).
   - Hosts Product A (Consumer Social App), Product B (Admin Console), REST APIs, and SSE endpoints.
2. **Authoritative Persistence Engines:**
   - In-Memory / Hybrid Engine: `scripts/database-engine.ts` (7,052 lines, 263 KB).
   - Relational SQLite WAL Engine: `scripts/database-sqlite.ts` (396 lines, 14.5 KB).
   - SQLite Path: `.sovra-storage-dev/sovra-social.sqlite` (WAL enabled, 10 active relational tables).
3. **Mobile Super-App Entry Points:**
   - React Native App Shell: `apps/sovra-mobile/App.tsx`.
   - Android Native Module: `apps/sovra-mobile/android/app/src/main/java/network/sovra/mobile/ble/SovraBleModule.kt`.
   - iOS Native Module: `apps/sovra-mobile/ios/SovraMobile/SovraBleNativeModule.mm` and `SovraBleBridge.mm`.
4. **P2P Mesh Coordinator:**
   - P2P Subsystem: `packages/p2p/src/mesh/coordinator.ts`.
   - Mesh Router: `packages/p2p/src/mesh/mesh-router.ts`.
   - Handshake & Security: `packages/p2p/src/mesh/ble-handshake.ts`.

---

### 3. Source-Code Pattern Analysis & Health Signals

A repository-wide AST and regex scan revealed the following occurrences across non-test production files:
- **`TODO` comments:** 0 (zero open TODO tags).
- **`FIXME` comments:** 0 (zero open FIXME tags).
- **`stub` references:** 0 (zero stubbed functions).
- **`placeholder` occurrences:** 127 (all 127 are standard HTML/JSX input placeholder attributes, e.g. `placeholder="Search..."`).
- **`mock` occurrences in production code:** 5 occurrences, specifically:
  1. `apps/sovra-mobile/src/services/mobile-mesh-coordinator.ts:9` — comment asserting zero mock data.
  2. `packages/messaging/src/webrtc-call.ts:206,282` — fallback SDP template for headless integration tests.
  3. `scripts/database-engine.ts:1727` — set of deprecated mock DIDs filtered out from active peer tables.
  4. `scripts/dev-server.ts:9336` — CSS HTML markup comment for device frame mockup.
  5. `services/moderation-worker/src/index.ts:6` — comment asserting real algorithmic evaluation.
