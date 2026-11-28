# Stage 9 — Phase 4 Live Push Readiness Report

**Program:** SOVRA Stage 9 — Certification Blocker Closure Program  
**Baseline Preserved:** Stage 8 verdict remains **`NOT TESTED — External Field Certification`** ([STAGE_8_LIVE_PUSH_REPORT.md](file:///d:/Sovra/STAGE_8_LIVE_PUSH_REPORT.md)).  
**Inspection Date:** `2026-11-26`  
**Overall Live Push Readiness:** **`BLOCKED`** *(Local loopback HTTP blind-push relay & fail-closed rejection verified; live FCM HTTP v1, live APNs HTTP/2, persistent VAPID keys, token expiration/unregistration, and retry backoff are either unconfigured, unimplemented, or stubbed)*

---

## 1. Environment & Credential Audit

Live environment inspection (`2026-11-26`, matching Stage 8 `EV-02`):
* `FCM_SERVER_KEY=UNSET`
* `GOOGLE_APPLICATION_CREDENTIALS=UNSET`
* `APNS_KEY_ID=UNSET`
* `APNS_TEAM_ID=UNSET`
* `VAPID_PUBLIC_KEY=UNSET`
* `VAPID_PRIVATE_KEY=UNSET`
* `SOVRA_PUSH_WEBHOOK_URL=UNSET`

---

## 2. Transport & Lifecycle Audit

| Capability | Status | Exact Codebase Evidence & Findings |
|---|---|---|
| **Blind Push Core (`@sovra/messaging`)** | **`PASS` (Local Core)** / **`NOT WIRED` (Prod Providers)** | [packages/messaging/src/blind-push.ts:66-226](file:///d:/Sovra/packages/messaging/src/blind-push.ts#L66-L226) implements `BlindPushRelayServer` + `HttpEndpointPushTransport`, redacting DIDs in favor of `blindChannelId` (`SHA-256`) and `opaqueWakeupHint`, and fails closed when no `PushTransportProvider` is configured (`No push delivery transport configured; BlindPushRelayServer refuses mock delivery and fails closed`). In `dev-server.ts:2179`, `new BlindPushRelayServer()` is constructed **without a `transport`**, so HTTP `/api/push/dispatch` relay calls return `dispatchedCount: 0` unless paired with explicit WebPush endpoints. |
| **FCM (Android)** | **`BLOCKED` (Not Integrated in App or Server)** | **Client:** Zero `google-services.json`, zero `com.google.firebase:firebase-messaging`, and zero `FirebaseMessagingService` classes exist anywhere in `apps/sovra-mobile/android/`.<br>**Server:** [scripts/routes/push.routes.ts:229-284](file:///d:/Sovra/scripts/routes/push.routes.ts#L229-L284) (`sendNativePushNotification`) has **no FCM HTTP v1 OAuth2 client** (`fcm.googleapis.com`) and fails closed for `provider === 'fcm'` (`"Native push provider 'fcm' is not configured with a live delivery client; mock delivery disabled"`).<br>**UI Masking Note:** [scripts/views/scripts.view.ts:2793](file:///d:/Sovra/scripts/views/scripts.view.ts#L2793) synthesizes a fallback string `'fcm_tok_...'` on Web if `PushManager` is unavailable. |
| **APNs (iOS)** | **`BLOCKED` & `MOCK STUB PRESENT`** | **Client:** `apps/ios/` contains only [capacitor.config.json](file:///d:/Sovra/apps/ios/App/App/capacitor.config.json); zero Xcode project, zero `GoogleService-Info.plist`, zero `UNUserNotificationCenter` / `didRegisterForRemoteNotificationsWithDeviceToken` native Swift handlers exist.<br>**Server ([push.routes.ts:279-283](file:///d:/Sovra/scripts/routes/push.routes.ts#L279-L283)):** Fails closed for `provider === 'apns'` cleanly.<br>**Server Defect ([enterprise-protocol.routes.ts:146-187](file:///d:/Sovra/scripts/routes/enterprise-protocol.routes.ts#L146-L187)):** Routes `/api/push/apns/register` and `/api/push/apns/dispatch-wakeup` (tested by [tests/e2e/global-commercial-expansion.test.ts:105-125](file:///d:/Sovra/tests/e2e/global-commercial-expansion.test.ts#L105-L125)) perform **zero `.p8` ECDSA JWT signing and zero HTTP/2 calls to `api.push.apple.com`**, unconditionally returning synthetic `{ ok: true, dispatched: true, apnsId: 'apns-uuid-...' }`. **Must NOT be counted as live APNs delivery.** |
| **VAPID / WebPush** | **`PARTIAL` (Ephemeral Keys & No Hard Persistence)** | [push.routes.ts:26-122](file:///d:/Sovra/scripts/routes/push.routes.ts#L26-L122) implements real ES256 VAPID JWT signing (`generateVapidJwt`) and HTTP/HTTPS POSTs with `Authorization: vapid t=..., k=...`, `TTL: 86400`, `Urgency: high`. **Gaps:** (1) When `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` are unset, `getOrCreateVapidKeys()` generates ephemeral in-memory keys lost on every restart (invalidating all stored browser `PushManager` subscriptions); (2) [push.routes.ts:65](file:///d:/Sovra/scripts/routes/push.routes.ts#L65) and [api.ts:1635](file:///d:/Sovra/apps/sovra-mobile/src/services/api.ts#L1635) retain a fallback public key string (`BEl62iUY...`), and `api.ts:1655` returns `{ ok: true }` silently on network error during `registerWebPushSubscription()`. |
| **`ntfy` / `UnifiedPush`** | **`IMPLEMENTED` (Best-Effort Only / Untested Live)** | [push.routes.ts:239-277](file:///d:/Sovra/scripts/routes/push.routes.ts#L239-L277) posts JSON directly to `https://ntfy.sh/${topic}` with `Priority: urgent` (`4000ms` timeout). Depends on public third-party `ntfy.sh` host (`zero-domain` conflict unless self-hosted UnifiedPush endpoint is configurable) and was **not exercised** against live `ntfy.sh` in Stage 8/9. |
| **Token Lifecycle & Persistence** | **`FAIL` (Volatile Memory Only; No Expiry/Unregister)** | Tokens live strictly in process memory (`pushTokensByDid`, `pushTokensByChannel`, `nativePushRegistry`, `BlindPushRelayServer.deviceRegistry`, `apnsDeviceStore`) and vanish on restart. No HTTP `/api/push/unregister` endpoint exposes `BlindPushRelayServer.unregisterDevice()` ([blind-push.ts:146](file:///d:/Sovra/packages/messaging/src/blind-push.ts#L146)), no TTL/staleness eviction runs, and HTTP `404`/`410 Gone` responses do not prune dead tokens. |
| **Delivery Failures & Retry Policy** | **`FAIL` (Zero Retry/Backoff)** | `sendWebPush` (`5000ms` timeout), `sendNativePushNotification` (`4000ms`), and `HttpEndpointPushTransport` (`5000ms`) execute **single-shot requests** with **no retry/exponential backoff** for transient `429`/`5xx`/timeouts. Callers in [call.routes.ts:227](file:///d:/Sovra/scripts/routes/call.routes.ts#L227) (`void dispatchCallWebPush(...)`) and [push.routes.ts:505](file:///d:/Sovra/scripts/routes/push.routes.ts#L505) (`.catch(() => {})`) silently drop delivery errors without queueing retries. |

---

## 3. Exact Prerequisites to Unblock Live Push Delivery

1. **Persist Push Subscriptions & Configure VAPID Keys:** Store subscriptions/tokens + `updatedAt`/`expiresAt` in `sovraDb` SQLite, add `/api/push/unregister`, prune tokens on HTTP `404`/`410`, and provision persistent `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY`.
2. **Integrate Real FCM HTTP v1 & APNs HTTP/2 Transports:**
   * Android: Add `google-services.json`, `firebase-messaging`, `FirebaseMessagingService` wakeup handler triggering `MobileSyncEngine.triggerSync()`, and implement server OAuth2 service-account dispatch to `https://fcm.googleapis.com/v1/projects/<id>/messages:send` (or genuine self-hosted UnifiedPush distributor for zero-Google Android builds).
   * iOS: Scaffold real Xcode project (`AppDelegate` APNs token registration) and replace the mock handler in [enterprise-protocol.routes.ts:168-187](file:///d:/Sovra/scripts/routes/enterprise-protocol.routes.ts#L168-L187) with fail-closed `http2.connect('https://api.push.apple.com')` + `.p8` ES256 provider JWT.
3. **Add Bounded Retry & Dead-Letter Handling:** Retry transient `429`/`5xx`/network failures with exponential backoff while respecting strict `Retry-After` headers.
4. **Live Field Verification:** Obtain end-to-end delivery telemetry against real backgrounded/Doze physical Android & iOS handsets.
