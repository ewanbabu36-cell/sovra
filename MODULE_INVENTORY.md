# SOVRA — MODULE INVENTORY & SUBSYSTEM REGISTRY

**Audit Date**: 2026-11-04  
**Audit Entity**: Enterprise Architecture & Code Quality Audit Group  
**Auditor Roles**: Principal Software Architect & Senior Code Auditor  
**Scope**: All Apps, Packages, Services, Nodes, and Core Script Controllers

---

## 1. APPS MODULE INVENTORY

| App Module | Path | Tech Stack | Responsibility | Status |
| :--- | :--- | :--- | :--- | :--- |
| **sovra-app** | `apps/sovra-app` | React 18, Vite, TypeScript, Tailwind | Main web application client for feed, chat, studio, watch, and settings. | **VERIFIED** |
| **sovra-admin** | `apps/sovra-admin` | React, Vite, Tailwind, Recharts | Protocol administration, telemetry monitoring, moderation queues, dial controls. | **VERIFIED** |
| **sovra-mobile** | `apps/sovra-mobile` | React Native, Expo, TypeScript | Native mobile application for Android & iOS platforms. | **VERIFIED** |
| **ios** | `apps/ios` | Swift, SwiftUI, WebKit | Native iOS shell and Apple Secure Enclave hardware binding. | **PARTIALLY VERIFIED** |
| **twa** | `apps/twa` | Vite, Vanilla TS, Telegram SDK | Telegram Web App embedded client for mini-app onboarding. | **VERIFIED** |

---

## 2. PACKAGES INVENTORY (`@sovra/*`)

| Package Name | Path | Core Dependencies | Primary Interfaces | Status |
| :--- | :--- | :--- | :--- | :--- |
| **@sovra/crypto** | `packages/crypto` | `@noble/curves`, `@noble/ciphers` | Ed25519 signatures, X25519 ECDH, ChaCha20-Poly1305, HKDF. | **VERIFIED** |
| **@sovra/identity** | `packages/identity` | `@sovra/crypto`, `@scure/bip39` | W3C `did:key`, Passkey WebAuthn manager, Mnemonic seed. | **VERIFIED** |
| **@sovra/messaging** | `packages/messaging` | `@sovra/crypto`, `@sovra/identity`| Two-tier inbox classifier, disappearing envelope, ratchet. | **VERIFIED** |
| **@sovra/p2p** | `packages/p2p` | `libp2p`, `@chainsafe/libp2p-noise` | Noise_XX handshake, TCP transport, DHT peer discovery. | **VERIFIED** |
| **@sovra/protocol** | `packages/protocol` | Protobuf, `@noble/hashes` | Binary serialization, message envelopes, wire framing. | **VERIFIED** |
| **@sovra/storage** | `packages/storage` | `multiformats`, `blockstore-core` | Content addressing (CIDv1), chunking, Merkle DAG storage. | **VERIFIED** |
| **@sovra/social** | `packages/social` | Internal algorithms | Graph algorithms, Sovereign Rank, taste vector similarity. | **VERIFIED** |
| **@sovra/moderation**| `packages/moderation`| Internal math | Decentralized jury consensus, Community Notes Bayesian logic. | **VERIFIED** |
| **@sovra/ai** | `packages/ai` | Vector embeddings | On-device NLP categorization, sentiment & safety screening. | **VERIFIED** |
| **@sovra/ui** | `packages/ui` | React, Tailwind, Lucide Icons | Common UI design system components (buttons, modals, cards). | **VERIFIED** |
| **@sovra/shared** | `packages/shared` | None | Shared errors (`SovraError`), type guards, validation schemas. | **VERIFIED** |

---

## 3. MODULAR CONTROLLER INVENTORY (`scripts/routes/`)

The monolithic `scripts/dev-server.ts` delegates domain-specific logic to 24 modular route controllers in `scripts/routes/`:

| Controller File | Handled Route Patterns | Security Guardrails | Status |
| :--- | :--- | :--- | :--- |
| `admin_features.routes.ts` | `/api/admin/features/*`, `/api/admin/flags/*` | Requires `admin` role header / session. | **VERIFIED** |
| `agent.routes.ts` | `/api/agents/*`, `/api/agents/deploy` | Agent runtime execution sandboxing. | **VERIFIED** |
| `ai.routes.ts` | `/api/ai/*`, `/api/ai/speech/*` | Rate limited, mock fallback when offline. | **VERIFIED** |
| `call.routes.ts` | `/api/call/*`, `/api/call/offer`, `/candidate` | WebRTC SDP signaling exchange. | **VERIFIED** |
| `chat.routes.ts` | `/api/chat/*`, `/api/chat/send`, `/conversations`| BOLA authorization checks, two-tier inbox. | **VERIFIED** |
| `dapp.routes.ts` | `/api/dapps/*`, `/api/mini-dapps/*` | CSP sandboxing verification. | **VERIFIED** |
| `depin.routes.ts` | `/api/depin/*`, `/api/depin/mesh-sessions` | Bandwidth proof-of-relay validation. | **VERIFIED** |
| `explorer.routes.ts` | `/api/explorer/*`, `/api/blockchain/*` | Cosmos SDK block/tx proxy. | **VERIFIED** |
| `feed.routes.ts` | `/api/feed/*`, `/api/explore/grid` | Taste vector ranking, feed pagination. | **VERIFIED** |
| `live.routes.ts` | `/api/live/*`, `/api/stream/*` | RTMP/WHIP live streaming signaling. | **VERIFIED** |
| `media.routes.ts` | `/api/media/*`, `/api/upload/*` | MIME sniffing, image dimension verification. | **VERIFIED** |
| `media_player.routes.ts` | `/api/player/*`, `/api/videos/hls/*` | HLS m3u8 playlist streaming. | **VERIFIED** |
| `notes.routes.ts` | `/api/notes/*`, `/api/community-notes/*` | Bayesian helpfulness scoring algorithm. | **VERIFIED** |
| `offline-pay.routes.ts` | `/api/offline-pay/*`, `/api/wallet/offline/*` | Ed25519 offline voucher signature verification. | **VERIFIED** |
| `push.routes.ts` | `/api/push/*`, `/api/notifications/*` | WebPush VAPID key delivery. | **VERIFIED** |
| `quadratic.routes.ts` | `/api/quadratic/*`, `/api/studio/quadratic/*`| Quadratic voting match calculation ($(\sum \sqrt{c})^2$).| **VERIFIED** |
| `referral.routes.ts` | `/api/referral/*`, `/api/user/referrals/*` | Loop detection in referral tree. | **VERIFIED** |
| `spaces.routes.ts` | `/api/spaces/*`, `/api/space/*` | Multi-user audio room signaling. | **VERIFIED** |
| `studio.routes.ts` | `/api/studio/*`, `/api/channel/*` | Creator monetization, analytics, NFT drops. | **VERIFIED** |
| `trading.routes.ts` | `/api/trading/*`, `/api/orderbook/*` | Limit order matching engine, circuit breakers. | **VERIFIED** |
| `video.routes.ts` | `/api/video/*`, `/api/watch/*` | Video transcoding status, chunked uploads. | **VERIFIED** |
| `wallet.routes.ts` | `/api/wallet/*`, `/api/token/*` | Balance queries, bridge transfers, atomic swaps. | **VERIFIED** |
| `wellbeing.routes.ts` | `/api/wellbeing/*`, `/api/screen-time/*` | On-device usage timers and break challenges. | **VERIFIED** |
| `zk.routes.ts` | `/api/zk/*`, `/api/zk/humanity/verify` | Nullifier deduplication (snarkjs verify missing).| **PARTIALLY VERIFIED** |

---

## 4. INACTIVE / ORPHANED / LEGACY ARTIFACTS

1. **`scratch/` Directory**: Contains obsolete test scripts (`apply_visual_and_ux_audit_fixes.cjs`, `fix_quotes.cjs`, `fix_yt_comments_count.cjs`).
2. **`services/moderation-worker`**: Lacks integration with `scripts/dev-server.ts`. When running dev-server, moderation runs in-process rather than via Redis worker queue.
3. **`apps/ios`**: Minimal Swift scaffolding (`AppDelegate.swift`, `ContentView.swift`); lacks complete App Store distribution configuration.
4. **`chain/` vs Node Runtime**: The Cosmos chain code is fully formed Go code, but the dev server defaults to an in-memory token ledger (`token_transfers` table in SQLite) rather than submitting Cosmos transactions.
