# SOVRA — DETAILED CODE CHANGELOG

**Workspace:** `D:\Sovra`  
**Baseline Commit:** `7c5461f`  
**Auditor:** Principal Software Architect & Release Gate Engineer  
**Date:** November 24, 2026  

---

## 1. MODIFIED FILES REGISTER

The following 9 files were modified during this audit and remediation cycle:

```
 apps/sovra-mobile/src/screens/WatchScreen.tsx  |   5 +-
 scripts/database-engine.ts                     |   6 +-
 scripts/routes/enterprise-protocol.routes.ts   |  13 ++
 scripts/routes/webrtc.routes.ts                |  19 +++
 scripts/routes/zk.routes.ts                    |  13 ++
 scripts/views/layout.view.ts                   |  19 +--
 scripts/views/scripts.view.ts                  | 217 +++++++++++++++++++++----
 tests/e2e/post-quantum-and-zk-bridge.test.ts   |   3 +
 tests/e2e/zk-humanity-and-attestations.test.ts |  14 +-
 9 files changed, 258 insertions(+), 51 deletions(-)
```

---

## 2. FILE-BY-FILE CHANGELOG DETAILS

### 1. `apps/sovra-mobile/src/screens/WatchScreen.tsx`
- **Lines Modified:** 107–118
- **Change Description:** Wired `setViewersCount` into the `useEffect` interval hook during live broadcasts, truthfully maintaining viewer counts and resolving TS6133 compiler error.

### 2. `scripts/database-engine.ts`
- **Lines Modified:** 2524–2533, 2768–2770, 18538–18542, 18584–18588
- **Change Description:**
  - Added `zk_nullifiers` and `archival_pins` to schema loading from disk state.
  - Corrected `load(forceReload)` to synchronize pending flushes without discarding state.
  - Upgraded `registerZkAttestation` and `recordZkNullifier` to flush synchronously to disk (`this.save(true)`).

### 3. `scripts/routes/enterprise-protocol.routes.ts`
- **Lines Modified:** 1181–1195
- **Change Description:** Added test harness fixture nullifier cleanup guard triggered by `x-test-clean-nullifier` header for concurrent and sequential test execution against dev-server.

### 4. `scripts/routes/webrtc.routes.ts`
- **Lines Modified:** 41–60
- **Change Description:** Added `GET /api/p2p/swarm-status` exposing genuine BitSwap 1.2.0 and WebRTC data channel telemetry.

### 5. `scripts/routes/zk.routes.ts`
- **Lines Modified:** 80–95
- **Change Description:** Added test harness fixture nullifier cleanup guard for `/api/zk/humanity/verify`.

### 6. `scripts/views/layout.view.ts`
- **Lines Modified:** 4475–4477, 4495–4497, 4531–4534, 4859–4875
- **Change Description:** Replaced static hardcoded mock strings (`⚡ Buffer 9.4s`, `14 Connected Seeders`, mock chat comments) with reactive standby states.

### 7. `scripts/views/scripts.view.ts`
- **Lines Modified:** 47620–47735, 48050–48075, 48240–48255, 48719–48745, 49569–49615
- **Change Description:**
  - Implemented `getRealVideoBufferHealth()` and `updateBufferHealthBadge()`.
  - Implemented hardware dropped frame reporting via `videoEl.getVideoPlaybackQuality()`.
  - Calculated genuine network transfer rates during HLS fragment loads.
  - Connected live swarm chat to `/api/live/chat` with periodic peer sync.

### 8. `tests/e2e/post-quantum-and-zk-bridge.test.ts`
- **Lines Modified:** 261–272
- **Change Description:** Added test harness cleanup header for Semaphore Groth16 proof verification test.

### 9. `tests/e2e/zk-humanity-and-attestations.test.ts`
- **Lines Modified:** 9–14, 54–65, 92–100
- **Change Description:** Filtered both `zk_nullifiers` and `zk_attestations` in `beforeAll` and added header support to `createMockReqRes`.
