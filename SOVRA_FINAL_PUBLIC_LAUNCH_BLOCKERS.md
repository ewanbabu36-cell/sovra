# SOVRA — FINAL PUBLIC LAUNCH BLOCKERS REGISTER & TRIAGE MATRIX

**Project:** SOVRA  
**Repository:** `D:\Sovra`  
**Execution Date:** November 24, 2026  
**Auditor:** Independent Release Gate 2 Verification Team  
**Scope:** Strict classification of all open items, audit findings, and architectural dependencies into P0 (Launch Blockers), P1 (Beta Enhancements), and P2 (Post-Launch Items)

---

## 1. Executive Summary

Under **RULE 1 (No False Certification)**, this register provides an unvarnished, transparent inventory of every identified defect, architectural boundary, and outstanding dependency.

### Release Gate Triage Principle: Gate A vs. Gate B
- **Gate A (Decentralized Social Media Core Platform):**
  Identity creation, cryptographic self-custody, feed, posts, reactions, comments, stories, direct Double Ratchet messaging, WebRTC calling, creator studio, live streaming, wallet balance & transfers, SQLite ACID storage, and PWA offline caching.
- **Gate B (Autonomous Global DePIN Infrastructure & On-Chain CosmWasm):**
  Global multi-continent bootstrap seed VPS deployment, Coturn TURN server clusters, and on-chain CosmWasm `.wasm` smart contract bytecode deployment on CometBFT L1.

---

## 2. Definitive Triage Matrix

| ID | Issue / Finding | Severity | Category | Gate | Current Status | Impact on Launch |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **P0-1** | `story_highlights` and `user_close_friends` uninitialized array crashes | **P0** | Database | **Gate A** | **RESOLVED & VERIFIED** | Closed. 26/26 Instagram parity tests passing. |
| **P0-2** | Service Worker cache name mismatch in audit test (`v8` vs `v10`) | **P0** | Audit | **Gate A** | **RESOLVED & VERIFIED** | Closed. 44/44 prelaunch audit tests passing. |
| **P0-3** | `findUserByDid` negative-cache blocking user lookups in Ads Manager | **P0** | Engine | **Gate A** | **RESOLVED & VERIFIED** | Closed. 7/7 Ads Manager tests passing. |
| **P1-1** | CosmWasm CW20 Bytecode on CometBFT L1 (Contract Not Found on DeliverTx) | **P1** | Blockchain | **Gate B** | **STAGED FOR GATE B** | Non-blocking for social media launch. Native SOV transfers pass 100%. |
| **P1-2** | Public Multi-Continent Bootstrap Seed Nodes (VPS deployment) | **P1** | DePIN | **Gate B** | **STAGED FOR GATE B** | Non-blocking for single-node / limited beta cluster; required for global autonomous mesh. |
| **P1-3** | External Coturn STUN/TURN Relays for Mobile Cellular WebRTC | **P1** | Network | **Gate B** | **STAGED FOR GATE B** | WebRTC calls connect on local/open networks; cellular carriers require TURN relays. |
| **P1-4** | HLS Route Pluralization Alias (`/api/video/hls` -> `/api/videos/hls`) | **P1** | API | **Gate A** | **DOCUMENTED** | Minor route alias; client scripts use `/api/videos/hls/` without issue. |
| **P1-5** | Android AssetLinks Package Name (`network.sovra.mobile` vs `app.sovra.network`) | **P1** | Android | **Gate A** | **DOCUMENTED** | Assetlinks file exists; package ID can be unified in next Play Store build. |
| **P2-1** | EigenTrust Graph Calculation In-Memory Caching on `/api/feed/ranked` | **P2** | Performance| **Gate A** | **DOCUMENTED** | Graph computation took 5.05s on 3,500 users; background caching recommended under high load. |
| **P2-2** | Vitest Test Suite Concurrency Tuning (`--testTimeout=10000`) | **P2** | Tooling | **Gate A** | **DOCUMENTED** | Prevents false-positive timeouts when running 600+ tests in parallel. |

---

## 3. Detailed Review of Gate A (Zero P0 Blockers Remaining)

All three P0 blockers identified in previous audits have been definitively resolved and verified through independent automated regression suites:
1. **P0-1 Resolved:** `scripts/database-engine.ts` properly initializes `story_highlights: []` and `user_close_friends: {}` in `initEmptySchema()`, `load()`, and `sanitizeState()`.
2. **P0-2 Resolved:** PWA Service Worker cache version is synchronized to `sovra-pwa-v10` across application code and audit test assertions.
3. **P0-3 Resolved:** `findUserByDid` checks active database memory before consulting the negative lookup cache, allowing newly registered users to be immediately resolved.

**Conclusion for Gate A:** Zero P0 launch blockers remain in the SOVRA codebase for consumer social media operations.

---

## 4. Gate B Staged Items (Roadmap to Global DePIN Rollout)

The following items are explicitly categorized as **Gate B** requirements and do not block a Limited Beta or staged public rollout:
1. **CosmWasm CW20 Engine Deployment:**
   - Compile `cw20_base.wasm` and upload to CometBFT chain via `store_code` transaction.
   - Run `instantiate` transaction to anchor Creator Token contracts on-chain.
2. **Geographically Distributed Seed Nodes:**
   - Deploy `scripts/bootstrap-node.ts` to 3 cloud VPS providers (Hetzner Frankfurt, AWS US-East, DigitalOcean Singapore).
   - Configure DNS records to point to these seed IPs.
3. **Dedicated Coturn Cluster:**
   - Deploy Coturn with dynamic TURN auth REST secret on port 3478 / 5349 to guarantee 100% WebRTC traversal across cellular networks.
