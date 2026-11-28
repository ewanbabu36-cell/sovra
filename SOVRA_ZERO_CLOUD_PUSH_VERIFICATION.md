# SOVRA — Zero-Cloud Push & Wakeup Verification Report (Phase 4)

**Report Date:** `2026-11-26T22:59:00+05:30`  
**Git Baseline:** `6c0e705` (with Phase 1–4 remediations applied and verified)  
**Overall Phase 4 Gate Status:** **`PARTIAL`** *(Server-side durable monotonic SSE event IDs, disk-backed replay ring buffers across relay restarts, `Last-Event-ID` cursor missed-event recovery, Android Kotlin `SovraUnifiedPushReceiver` + `SovraUnifiedPushJsBridge` <-> `MobileSyncEngine` wiring, and explicit UI/telemetry separation of foreground vs background channels all pass `18 / 18` standalone tests + `6 / 6` live `field-push-and-mute` E2E tests. Physical Android Doze / killed-process wakeup is **`NOT TESTED`** (`adb devices` = empty), and iOS APNs is **`BLOCKED`** / unsupported because `apps/ios/` contains only `capacitor.config.json` with zero native Swift/Xcode push code.)*

---

## Foreground SSE vs Background Native Push Distinction

| Channel | Lifecycle / OS Behavior | Implementation & File Refs | Status |
|---|---|---|---|
| **Foreground SSE Wakeup (`/api/push/stream`)** | Active only while mobile app / WebView / browser tab holds HTTP stream open (or Android Foreground Service keeps process awake); replays missed events across temporary disconnects & relay restarts using persistent monotonic `id:` + `Last-Event-ID` cursor (`sovra_sse_last_event_id_v1` <-> `sse-wakeup-buffer.json`) | [push.routes.ts:182-345, 700-760](file:///d:/Sovra/scripts/routes/push.routes.ts#L182-L345), [sync-engine.ts:33-195](file:///d:/Sovra/apps/sovra-mobile/src/services/sync-engine.ts#L33-L195) | **`PASS`** *(Local HTTP restart & cursor replay verified; UI copy explicitly distinguishes foreground SSE from background delivery)* |
| **Android Background Push (UnifiedPush)** | Google-free open `org.unifiedpush.android.*` receiver (`SovraUnifiedPushReceiver`) + `SovraUnifiedPushJsBridge` (`listDistributors`, `registerDistributor`, `unregisterDistributor`, `getLastEndpointJson`) + DOM events (`sovraUnifiedPushEndpoint`, `sovraUnifiedPushMessage`) synced by `MobileSyncEngine` to `/api/push/register-native` (`provider: 'unifiedpush'`) and dispatched via HTTP POST with bounded 429/5xx retries & 404/410 pruning | [SovraUnifiedPushReceiver.kt:1-242](file:///d:/Sovra/apps/sovra-mobile/android/app/src/main/java/network/sovra/mobile/push/SovraUnifiedPushReceiver.kt#L1-L242), [MainActivity.kt:135-137](file:///d:/Sovra/apps/sovra-mobile/android/app/src/main/java/network/sovra/mobile/MainActivity.kt#L135-L137), [AndroidManifest.xml:75-85](file:///d:/Sovra/apps/sovra-mobile/android/app/src/main/AndroidManifest.xml#L75-L85), [sync-engine.ts:55-150](file:///d:/Sovra/apps/sovra-mobile/src/services/sync-engine.ts#L55-L150) | **`PARTIAL`** *(Kotlin receiver + JS bridge + HTTP relay dispatch `PASS`; physical device background / OEM battery killer / Doze `NOT TESTED` — `adb devices` attached count = `0`)* |
| **WebPush (VAPID P-256)** | Disk-persisted `vapid-keys.json` & `push-registrations.json` in `SOVRA_STORAGE_DIR`; standard ES256 VAPID JWT signing without centralized vendor gateways | [push.routes.ts:65-215, 390-440](file:///d:/Sovra/scripts/routes/push.routes.ts#L65-L215), [AccountSettingsModal.tsx:90-120](file:///d:/Sovra/apps/sovra-mobile/src/screens/AccountSettingsModal.tsx#L90-L120) | **`PASS`** *(Self-hosted VAPID + `429` retry + `410` pruning verified locally)* |
| **iOS Native APNs** | Requires Apple Developer Team `.p8` key + native iOS `AppDelegate` Swift `UNUserNotificationCenter` / `PushKit` code (`enterprise-protocol.routes.ts` returns fail-closed `503 ERR_APNS_NOT_CONFIGURED`) | `apps/ios/` (`apps/ios/App/App/capacitor.config.json` only — no Xcode `.xcodeproj` or Swift sources present) | **`BLOCKED`** *(No native iOS Xcode/Swift target or Apple APNs `.p8` credentials in environment)* |

---

## Finding-by-Finding Remediation Record

### PUSH-P4-01 — Non-Durable SSE Sequence IDs & Lost Events Across Relay Restarts (`Last-Event-ID` Cursor Gap)
- **Original Finding & Severity:** `PUSH-01` (**High**) — Earlier in-memory `sseReplayBuffer` and `sseNextEventId` lost buffered wakeups and reset `sseNextEventId` back to `1` whenever the relay daemon restarted, breaking cursor-based `Last-Event-ID` replay for reconnecting clients.
- **Exact Source File & Line:** [push.routes.ts:131-345, 718-745](file:///d:/Sovra/scripts/routes/push.routes.ts#L131-L345).
- **Root Cause:** `sseReplayBuffer` and `sseNextEventId` were held exclusively in RAM with no backing persistence under `SOVRA_STORAGE_DIR`, and `/api/push/stream` queried only one `blindChannelId` key without deduplicating `did` matches.
- **Code Change:**
  - Added disk-backed `sse-wakeup-buffer.json` hydration inside `ensureStoreLoaded()` and atomic write-through in `persistSseReplayBuffer()` called from `emitSseWakeup()`, preserving unexpired (`<= 3600s`, max `100`/channel) wakeup events and monotonic `nextEventId` across full cache/server restarts (`Math.max(1, storedNext, maxSeenId + 1)`).
  - Hardened `/api/push/stream` cursor recovery (`Last-Event-ID` header or `?lastEventId=`) to collect, deduplicate, and chronologically sort missed events (`id > afterId`) across `blindChannelId` and `did` mappings.
  - Persisted client-side `sovra_sse_last_event_id_v1` in `MobileSyncEngine` ([sync-engine.ts:41-46, 175-184](file:///d:/Sovra/apps/sovra-mobile/src/services/sync-engine.ts#L41-L46)) across WebView reloads.
- **Tests Executed:** `tests/security/zero-domain-full-parity.test.ts` (Test 10) + `tests/e2e/field-push-and-mute.test.ts`.
- **Actual Output (`task-57783`):**
  - Emitted 3 offline wakeups -> verified `sse-wakeup-buffer.json` persisted `nextEventId: 4` and IDs `[1, 2, 3]`.
  - Cleared RAM via `resetPushStoreCacheForTests()`, emitted 4th wakeup -> verified monotonic `nextEventId: 5` and `[1, 2, 3, 4]` (never resetting to `1`).
  - Reconnected via HTTP `GET /api/push/stream` with `Last-Event-ID: 1` -> replayed strictly `[2, 3, 4]`.
- **Status:** **`PASS`**

### PUSH-P4-02 — Android UnifiedPush JavaScript Bridge & Honest Telemetry Separation
- **Original Finding & Severity:** `PUSH-02` / `PUSH-03` (**High**) — While Kotlin `SovraUnifiedPushReceiver` & `SovraUnifiedPushJsBridge` existed, the TypeScript app (`sync-engine.ts` and `AccountSettingsModal.tsx`) never invoked `window.SovraUnifiedPushNative`, never subscribed to `sovraUnifiedPushEndpoint` / `sovraUnifiedPushMessage` DOM events, and returned failure in WebView when `window.Notification` was absent without checking UnifiedPush.
- **Exact Source File & Line:** [sync-engine.ts:33-195](file:///d:/Sovra/apps/sovra-mobile/src/services/sync-engine.ts#L33-L195), [AccountSettingsModal.tsx:87-125](file:///d:/Sovra/apps/sovra-mobile/src/screens/AccountSettingsModal.tsx#L87-L125).
- **Root Cause:** Native Android UnifiedPush Kotlin bridge was disconnected from mobile JS lifecycle and settings UI.
- **Code Change:**
  - Added `listUnifiedPushDistributors()`, `registerUnifiedPushDistributor()`, `syncUnifiedPushEndpoint()` (POSTing `provider: 'unifiedpush', platform: 'android'` to `/api/push/register-native`), `attachUnifiedPushListeners()`, and `getPushDeliveryTelemetry()` to `MobileSyncEngine`.
  - Updated `AccountSettingsModal.tsx` notification setup to detect installed UnifiedPush distributors first, register asynchronously with the relay, fall back cleanly to foreground SSE (`startZeroCloudWakeup()`), and explicitly message foreground SSE vs background UnifiedPush capability.
- **Tests Executed:**
  - Rebuilt standalone Android mobile bundle (`apps/sovra-mobile/build-mobile-bundle.ts` -> `761,578` bytes synced to Android assets, exit `0`).
  - `tests/security/zero-domain-full-parity.test.ts` (Tests 3, 5, 10).
- **Actual Output (`task-57783`):**
  - Mocked Android `SovraUnifiedPushNative` bridge detected `['io.heckel.ntfy']`, registered `sovra-default`, synced endpoint to `/api/push/register-native`, and delivered live HTTP wakeup via `/api/push/dispatch-native` (`status: 200`); `getPushDeliveryTelemetry()` reported `{ unifiedPushBridgeAvailable: true, backgroundAndroidChannel: 'unifiedpush', backgroundIosChannel: 'unsupported' }`.
- **Remaining Limitation:** Live broadcast intent roundtrip from a third-party FOSS UnifiedPush app (`ntfy` / `Sunup`) to a backgrounded/killed Android device under Doze is **`NOT TESTED`** (`adb devices` = `0`).
- **Status:** **`PARTIAL`**

### PUSH-P4-03 — Fail-Closed Behavior on Legacy Dummy-Token Dispatch (`universal-links-and-blind-push.test.ts` Observation)
- **Observation (`task-57783`):** Running `tests/e2e/universal-links-and-blind-push.test.ts` against live `dev-server.ts` passed **`3 / 4`** checks (`/.well-known/assetlinks.json`, `/.well-known/apple-app-site-association`, `/api/push/register` + `/api/push/status`) and failed Test 4 (`POST /api/push/dispatch` line 72 `ok: false`).
- **Root Cause:** Test 3 of that legacy E2E file registers a non-HTTP dummy string `'fcm_test_token_sample_123'` without opening an SSE stream or setting `SOVRA_PUSH_WEBHOOK_URL`; `dev-server.ts:2198` constructs `new BlindPushRelayServer()` with no fake/mock push transport, so `dispatchBlindSignal()` intentionally fails closed (`Rule 4 & Rule 7`).
- **Status:** **`PASS`** *(Fail-closed security posture preserved in production server)* / Legacy test Test 4 reported honestly as **`FAIL`** against fail-closed server.

---

## Phase 4 Verification Matrix (`task-57783`)

| Suite File | Passed / Total | Status | Mode |
|---|---|---|---|
| `tests/security/zero-domain-full-parity.test.ts` | `10 / 10` | `PASS` | Standalone Vitest (Exit `0`) |
| `packages/messaging/test/blind-push.test.ts` | `4 / 4` | `PASS` | Standalone Vitest (Exit `0`) |
| `tests/unit/blinded-push-relay.test.ts` | `4 / 4` | `PASS` | Standalone Vitest (Exit `0`) |
| `tests/e2e/field-push-and-mute.test.ts` | `6 / 6` | `PASS` | Live `dev-server.ts` (`PORT=3001`, isolated storage) |
| `tests/e2e/universal-links-and-blind-push.test.ts` | `3 / 4` | `FAIL` *(Test 4 fails closed on dummy token without transport/SSE)* | Live `dev-server.ts` (`PORT=3001`, isolated storage) |
| `adb devices` physical Android check | `0` devices | `NOT TESTED` | Host CLI |
