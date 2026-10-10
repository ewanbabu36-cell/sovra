# SOVRA — CURRENT REPOSITORY BASELINE
**Audit Date:** October 8, 2026  
**Auditor:** Principal Software Architect & Staff Security Engineer  
**Repository Working Directory:** `D:\Sovra`  

---

## 1. Git & Version Control State

### Branch & HEAD
- **Current Branch:** `main`
- **Current HEAD Commit:** `77eb009` (`fix(webrtc): add dual HTTPS server and mobile secure context guidance for LAN calls`)
- **Remote Tracking:** Ahead of `origin/main` by 4 commits (`77eb009`, `aed2ad8`, `1867c14`, `23c20c2`).

### Working Tree Status
```
Changes not staged for commit:
  modified:   docker/docker-compose.production.yml
  modified:   scripts/database-engine.ts
  modified:   scripts/dev-server.ts

Untracked files:
  apps/sovra-mobile/android/gradle.properties
  apps/sovra-mobile/android/gradle/
  apps/sovra-mobile/android/gradlew.bat
  deploy/kubernetes/sovra-coturn.yaml
  docker/turnserver.conf
  tests/e2e/chat-attachment-file-serving.test.ts
  tests/e2e/production-turn-ice-servers.test.ts
```

### Recent Commit History (Last 20 Commits)
```
77eb009 fix(webrtc): add dual HTTPS server and mobile secure context guidance for LAN calls
aed2ad8 feat(mobile): implement genuine offline mesh, native bridges, durable outbox, crdt sync and secure keystore
1867c14 chore(production): go-live hardening, purge fake mocks, and add master runbooks
23c20c2 fix(webrtc): implement real end-to-end media transfer pipeline without simulation
38b592d fix(mobile): show video call button on all mobile screens and add direct send button for file uploads
34dc941 fix(call): eliminate beep sound and continuous oscillator noise in audio calls
59fa34d fix(call): resolve WebRTC audio voice and video transmission pipeline
c21ae4d feat(ui): streamline search bar to fresh and neat pill design
18abcd0 feat(chat, call): real p2p file attachments in chat and full webrtc e2ee video/audio call streaming
bd8fb21 feat(ui): refine SOVRA header logo button and branding typography to match reference design
bb45214 feat(ui): refine header search bar to match exact reference design with inner cyan frame and stacked Ctrl-K badge
ea5ee51 feat(ui): implement 9-node 3D glass orb holographic navigation matching reference design
161c689 fix(call): implement dual-mode E2EE video calling with remote stream and local PiP camera
e676474 feat(ui): refine central holographic radial navigation with prominent core and energy pathways
44b5634 feat(ui): alien holographic central command core navigation and clean production UI
674b064 fix(call): bidirectional call termination synchronization, hangup tone, and syntax gates
4b60cff feat(entities): isolate broadcast registry to admin console and sanitize test channels from user panel
929d06a feat(ui): compact smart sovereign control hub and dynamic data-driven direct messages
b01fde3 fix(friends): purge 1264 mock test artifacts and make peer discovery 100% dynamic
a414a07 feat(composer): convert format tabs into smart attachments with auto photo/reel detection and clean + More menu
```

### Git Diff Summary
```
 docker/docker-compose.production.yml |  27 ++
 scripts/database-engine.ts           |   3 +-
 scripts/dev-server.ts                | 659 +++++++++++++++++++++++++++++++++--
 3 files changed, 661 insertions(+), 28 deletions(-)
```

---

## 2. Host Runtime & Toolchain Baseline

| Component | Repository Requirement | Actual Host State | Audit Determination |
|---|---|---|---|
| **Node.js** | `>=20.0.0` (in `package.json`) | `v24.20.0` | **COMPLIANT** |
| **npm** | Not specified | `11.17.0` | **AVAILABLE** |
| **pnpm** | `pnpm@12.8.1` (`packageManager`) | **NOT INSTALLED** in host PATH | **DEFECT**: Monorepo specifies `pnpm` but cannot run `pnpm` natively |
| **Lockfile** | `pnpm-lock.yaml` (v9/v12 format) | Present (`83,651 bytes`), no `package-lock.json` | **PARTIAL**: `npm audit` fails with `ENOLOCK` |
| **Java Development Kit** | JDK 17 (in `build.gradle`) | JDK 17 installed at `C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot` | **AVAILABLE** (not in default PATH) |
| **Android SDK** | Compile SDK 34, Target SDK 34 | Installed at `C:\Users\alamr\AppData\Local\Android\Sdk` (build-tools: `36.0.0`, platforms: `android-37.0`) | **AVAILABLE** |
| **Android Gradle Wrapper** | `gradlew.bat` | `gradle-wrapper.jar` **MISSING** from `gradle/wrapper` | **CRITICAL BUILD DEFECT**: `./gradlew.bat` throws `ClassNotFoundException: org.gradle.wrapper.GradleWrapperMain` |
| **Turborepo** | `^2.4.4` (`turbo.json`) | `2.11.7` in `node_modules` | **BROKEN ON WINDOWS**: `npx turbo run build` fails with `unable to spawn child process: program not found` |
| **TypeScript** | `^5.8.2` | `5.9.3` (`npx tsc`) | **COMPLIANT** |
| **Vitest** | `^3.0.7` | `3.2.7` | **COMPLIANT** |

---

## 3. Workspace Architecture & Project Structure

The monorepo contains **23 workspace projects** defined across 4 directories via `pnpm-workspace.yaml`:

### Apps (`apps/` - 3 projects)
1. `@sovra/app` (`apps/sovra-app`): Web client dashboard and UI bundle.
2. `@sovra/admin` (`apps/sovra-admin`): Operations and administration console.
3. `@sovra/mobile` (`apps/sovra-mobile`): Mobile client shell with Android (`android/app`) and iOS (`ios/SovraMobile`) native bridges.

### Packages (`packages/` - 11 projects)
1. `@sovra/shared` (`packages/shared`): Core utilities, constants, and common types.
2. `@sovra/crypto` (`packages/crypto`): Ed25519, ChaCha20-Poly1305, HKDF, BLAKE3, SHA-256.
3. `@sovra/identity` (`packages/identity`): DID (`did:key`), credentials, TOTP, passkeys.
4. `@sovra/protocol` (`packages/protocol`): Canonical wire protocol, signed operations, CRDT models.
5. `@sovra/p2p` (`packages/p2p`): Libp2p node, GossipSub, Noise_XX, MeshRouter, BLE transports.
6. `@sovra/storage` (`packages/storage`): UnixFS, Bitswap, blockstore, CIDv1, HLS transcoding.
7. `@sovra/messaging` (`packages/messaging`): Double-ratchet, BitChat mesh, blind push, WebRTC signaling.
8. `@sovra/social` (`packages/social`): Graph, feeds, HLC clocks, reputation, omni-search.
9. `@sovra/moderation` (`packages/moderation`): Perceptual hashing, content filtering, report pipeline.
10. `@sovra/ui` (`packages/ui`): Reusable UI tokens and atomic component library.
11. `@sovra/ai` (`packages/ai`): Edge inference and personal recommendation interfaces.

### Nodes (`nodes/` - 5 projects)
1. `@sovra/full-node` (`nodes/full-node`): Headless P2P sovereign daemon.
2. `@sovra/relay-node` (`nodes/relay-node`): Circuit relay v2 transport node.
3. `@sovra/storage-node` (`nodes/storage-node`): Distributed blockstore seeder daemon.
4. `@sovra/index-node` (`nodes/index-node`): Graph query and search indexer.
5. `@sovra/community-node` (`nodes/community-node`): Managed community hub.

### Services (`services/` - 3 projects)
1. `@sovra/moderation-worker` (`services/moderation-worker`): Asynchronous content scanning queue.
2. `@sovra/search` (`services/search`): In-memory inverted index and vector search engine.
3. `@sovra/transcoder` (`services/transcoder`): Video segmenting and ABR pipeline.

---

## 4. Key Executables, Daemons & Configuration

- **Development Server & Monolithic API:** `scripts/dev-server.ts` (1,497,750 bytes). Hosts HTTP (`:3001`), HTTPS (`:3443`), Noise_XX P2P (`:4001`), WebSockets, SSE, and all 169 HTTP endpoints.
- **Operations Console:** `scripts/admin-console.ts` (74,808 bytes).
- **Core Persistence Engine:** `scripts/database-engine.ts` (151,098 bytes). Manages `dynamic-social-state.json` and SQLite bridge.
- **Production Orchestration:** `docker/docker-compose.production.yml`, `docker/Dockerfile.production`, `docker/Caddyfile`, `docker/turnserver.conf`, `deploy/kubernetes/sovra-coturn.yaml`.
