# SOVRA — Remediation Baseline Report

## Baseline Timestamp: October 2026
**Repository Commit**: `d9754e3` ("fix(core): permanently resolve state rollback, modal lockout, and UI unresponsiveness")  
**Branch**: `main`  
**Host Environment**: Windows 11 / Node.js v24.13.0 / pnpm v10.5.2  

---

## 1. Baseline Test Suite Count & Results

| Test Category | Suite File Count | Total Tests | Passing | Failing |
| :--- | :---: | :---: | :---: | :---: |
| **Monorepo Vitest Suite** | 112 | 639 | 639 | 0 |
| **Typecheck (`pnpm -r run typecheck`)** | 22 pkgs | N/A | 22 pkgs passed | 0 |
| **Build Engine (`pnpm -r run build`)** | 22 pkgs | N/A | 22 pkgs passed | 0 |
| **Real-World Integration Audit** | 1 | 67 | 67 | 0 |
| **Production Go-Live E2E** | 1 | 15 | 15 | 0 |
| **Section 34 Multi-User Live Journey** | 1 | 15 | 15 | 0 |
| **Milestones 1–4 Suite** | 1 | 4 | 4 | 0 |
| **Phase 5 & 6 Integration Suite** | 1 | 10 | 10 | 0 |

---

## 2. Modified & Uncommitted Files Inventory

From `git status --short`:
- **Apps**:
  - `apps/sovra-app/src/hooks/usePasskeySession.ts`, `useWebRtcCall.ts`, `ui/CallModal.ts`
  - `apps/sovra-mobile/app.json`, `BottomTabNavigator.tsx`, `AccountSettingsModal.tsx`, `CallScreen.tsx`, `ChatsScreen.tsx`, `FeedScreen.tsx`, `MeScreen.tsx`, `OnboardingModal.tsx`, `ReelsScreen.tsx`, `WatchScreen.tsx`, `types.ts`, `tsconfig.json`
  - `apps/sovra-mobile/android/` (Native Android Kotlin BLE Module)
  - `apps/sovra-mobile/ios/` (Native iOS Objective-C++ BLE Bridge)
- **Nodes**:
  - `nodes/community-node/`, `nodes/full-node/`, `nodes/index-node/`, `nodes/relay-node/`
- **Packages**:
  - `packages/identity/` (Admin credentials, principal RBAC, onboarding, passkey)
  - `packages/messaging/` (BitChat mesh, blind push, WebRTC call engine, chat engine)
  - `packages/p2p/` (GossipSub, node, validation, BLE mesh adapters, codecs, handshakes)
  - `packages/protocol/` (Errors, events, distributed state, CRDT projections, replays)
  - `packages/shared/` (Hardening, validation)
  - `packages/social/` (Graph, governance, knowledge graph)
  - `packages/storage/` (Reels, ABR, blockstore)
- **Services & Scripts**:
  - `scripts/database-engine.ts`, `scripts/dev-server.ts`, `scripts/test-milestones.mjs`, `scripts/test-phase5-6.mjs`
  - `services/moderation-worker/`, `services/search/`, `services/transcoder/`

---

## 3. Known Audit Findings & Remediations Required

1. **P0: Web Authentication Wiring**:
   - 56 client-side `fetch` calls in `scripts/dev-server.ts` lacked explicit `Authorization: Bearer <session-token>` headers at call sites.
   - Remedy: Implement centralized `authenticatedFetch()` in client scripts, intercepting and enforcing authorization headers and providing uniform 401/403 session expiration handling.
2. **P0: Stories In-Memory vs Persistence**:
   - `scripts/dev-server.ts` initialized with in-memory `multiSegmentStories` array, and the story viewer UI was updating in-memory state rather than calling `/api/stories/create` and `/api/stories/seen`.
   - Remedy: Wire the frontend story tray directly to `sovraDb`'s persistent disk-backed stories collection via `/api/stories/list`, `/api/stories/create`, and `/api/stories/seen`.
3. **P0: E2EE Chat Contradiction**:
   - UI displayed "End-to-End Encrypted / Double-Ratchet Session Active", while plaintext was transmitted over `/api/chat/send` and stored in JSON.
   - Remedy: Either wire client-side ciphertext encryption/decryption into the runtime so server stores only ciphertext (Option A), or adjust UI claims to prevent misleading security assertions (Option B).
4. **P0: WebRTC Call Simulation**:
   - `startE2eeCall()` used an arbitrary `setInterval(..., 1000)` counter to display "Connected" after 3 seconds without actual WebRTC peer connection.
   - Remedy: Remove simulation counter; integrate real `navigator.mediaDevices.getUserMedia` and `RTCPeerConnection` with backend signaling endpoints `/api/call/offer`, `/api/call/poll`, `/api/call/answer`, `/api/call/candidate`, `/api/call/end`.
5. **P0: Watch / Long-Form Video Static vs Dynamic**:
   - Curated videos catalog was statically populated.
   - Remedy: Transparently classify and badge as "Curated Protocol Broadcasts & Technical Documentaries (Official Network Catalog)" to eliminate false dynamic UGC claims.
6. **P1: Search Service Integration**:
   - `services/search/src/index.ts` was implemented as a standalone package with tests, but `/api/search` in `dev-server.ts` manually filtered arrays.
   - Remedy: Connect `SearchWorker` directly to the active server runtime to index entities on creation/update.
7. **P1: Moderation Service Integration**:
   - `services/moderation-worker/src/index.ts` was standalone.
   - Remedy: Integrate `ContentSafetyEngine` into post and comment creation pipelines to evaluate content safety before persistence.
8. **P0: Physical BLE Handset Verification**:
   - Native Kotlin and Objective-C++ modules are implemented, but physical over-the-air BLE radio bench tests cannot run in a headless Windows dev environment without physical handsets. Formally classified as `RELEASE BLOCKED` pending bench testing.
