# SOVRA — Zero-Cloud Messaging & Push Audit (AUDIT 4)

**Audit Date:** `2026-11-26T16:45:22+05:30`

---

## Foreground Connectivity vs True Background Push Distinction

- **Foreground / Active-Socket Streaming (Works Locally):** When a browser or app holds an active HTTP connection open to `GET /api/push/stream`, `emitSseWakeup()` delivers opaque `blind_wakeup` hints immediately (`receivedLiveHint1: true`). Android `SovraBleForegroundService` keeps a sticky notification (`FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE`) alive for local BLE mesh when not force-stopped by OEM battery killers.
- **True Background / Killed-App Push (Unverified on Physical Devices & Has Software Gaps):**
  - SSE `/api/push/stream` drops when mobile OS Doze/screen-off suspends sockets and **does NOT buffer or replay missed wakeups (`replayedMissedEventOnReconnect: false`, `hasSseEventId: false`)**.
  - On mobile JS startup, `subscribeZeroCloudWakeupStream()` is **only wired inside `AccountSettingsModal.tsx:116` with an empty no-op callback `() => {}`** — it is NOT active globally at app launch and does NOT invoke `syncEngine.triggerSync()`.
  - Android APK contains **zero native UnifiedPush connector BroadcastReceiver/Intent filters**; using UnifiedPush without FCM requires external UnifiedPush distributor HTTP setup, while Google FCM & Apple APNs remain gated on external OS vendor credentials (failing closed when absent).

---

## Detailed Findings

### PUSH-01: SSE Wakeup Stream Drops Events During Doze/Disconnect (`No Event ID, No Replay Queue, No Dedup/ACK`)
1. **Actual source code evidence:** `GET /api/push/stream` registers `sub` in `sseSubscribers` (`Set`) and `emitSseWakeup` iterates currently connected `sseSubscribers`, writing `event: wakeup\ndata: ${payload}\n\n` with **no `id:` line**, **no per-channel replay ring buffer**, **no `Last-Event-ID` handling**, and **no client acknowledgment/deduplication ledger**.
2. **Exact file and line references:** [push.routes.ts:227-253, 594-624, 872-876](file:///d:/Sovra/scripts/routes/push.routes.ts#L227-L253).
3. **Actual runtime test:** Ran `runAudit4Push()` (`audit-empirical-results.json`): connected SSE client (`live-hint-1` received), closed SSE socket, dispatched `missed-during-doze` while disconnected, then reconnected with `Last-Event-ID: 1`.
4. **Expected result:** Either SSE maintains a bounded encrypted per-channel wakeup queue keyed by monotonic event `id:` and replays missed wakeups upon `Last-Event-ID` reconnect, OR documentation/UI explicitly treats SSE as foreground-only signaling while queued messages rely solely on `/api/sync/reconcile` polling.
5. **Observed result:** `receivedLiveHint1: true`, **`hasSseEventId: false`**, **`offlineDispatchSseCount: 0`**, **`replayedMissedEventOnReconnect: false`**. Meanwhile `durable-offline-mesh.test.ts` (`10/10 PASS`) confirmed client outbox CRDT persistence + HTTP `/api/sync` reconciliation works once connectivity resumes.
6. **Remaining dependency:** Monotonic ring buffer or persistent per-blindChannel wakeup mailbox on relay + physical Android Doze soak test (`NOT TESTED`).
7. **Remediation required:** Add monotonic sequence `id:` + bounded in-memory/SQLite per-channel wakeup buffer (e.g. last 64 opaque hints with TTL) served on `Last-Event-ID` reconnect, plus idempotent message-ID dedup on mobile sync.

### PUSH-02: Mobile SSE Wakeup Consumer Is Wired Only as a No-Op Inside Settings Modal
1. **Actual source code evidence:** `subscribeZeroCloudWakeupStream()` is exported in `api.ts` and imported ONLY in `AccountSettingsModal.tsx`, where `handleEnableNotifications` registers `subscribeZeroCloudWakeupStream(() => {})` — an empty callback stored only in a transient handler variable `let sseUnsub`.
2. **Exact file and line references:** [api.ts:1660-1678](file:///d:/Sovra/apps/sovra-mobile/src/services/api.ts#L1660-L1678), [AccountSettingsModal.tsx:23, 114-117](file:///d:/Sovra/apps/sovra-mobile/src/screens/AccountSettingsModal.tsx#L114-L117).
3. **Actual runtime test:** Whole-repo symbol search (`task-56873`) + direct code inspection of `AccountSettingsModal.tsx`.
4. **Expected result:** App root (`main.tsx` / `sync-engine.ts`) should maintain a managed wakeup listener across relay failover switches that invokes `syncEngine.triggerSync()` and deduplicates hints.
5. **Observed result:** Opening the app normally never opens `/api/push/stream`; even clicking Enable Push in settings attaches a no-op callback `() => {}` and never tears it down cleanly on unmount or relay switch.
6. **Remaining dependency:** None (pure client lifecycle wiring).
7. **Remediation required:** Subscribe in `MobileSyncEngine` / app root using the currently active zero-domain relay URL, trigger `triggerSync()` on `wakeup` events, and close/resubscribe on `multiRelayManager` relay change.

### PUSH-03: Persistent Disk VAPID/Registrations, Bounded `429` Retry & `410` Prune Work; Android/iOS OS Background Push Remains Dependent on Distributors/Vendor Keys
1. **Actual source code evidence:** `push.routes.ts` persists `vapid-keys.json` & `push-registrations.json`, retries HTTP `429`/`5xx` (`PUSH_MAX_RETRIES = 2`), auto-prunes `404`/`410` expired tokens (`removePushEndpoint`), and rejects `ntfy.sh` hardcoded fallback (`line 541`). `enterprise-protocol.routes.ts` returns `503 ERR_APNS_NOT_CONFIGURED` when `.p8` credentials are absent (`lines 187-194`). `AndroidManifest.xml` declares `SovraBleForegroundService` (`connectedDevice`) but contains **no `org.unifiedpush.android.connector` distributor Intent-filter/Receiver**, and `apps/ios/` lacks Xcode/Swift PushKit code.
2. **Exact file and line references:** [push.routes.ts:65-106, 293-355, 528-588](file:///d:/Sovra/scripts/routes/push.routes.ts#L65-L106), [blind-push.ts:79-163, 208-276](file:///d:/Sovra/packages/messaging/src/blind-push.ts#L79-L163), [enterprise-protocol.routes.ts:171-261](file:///d:/Sovra/scripts/routes/enterprise-protocol.routes.ts#L171-L261), [SovraBleForegroundService.kt:21-95](file:///d:/Sovra/apps/sovra-mobile/android/app/src/main/java/network/sovra/mobile/ble/SovraBleForegroundService.kt#L21-L95), [AndroidManifest.xml:82-86](file:///d:/Sovra/apps/sovra-mobile/android/app/src/main/AndroidManifest.xml#L82-L86).
3. **Actual runtime test:** `zero-domain-full-parity.test.ts` Test 3 & Test 5 + `blind-push.test.ts` (`4/4 PASS`); `adb devices -l` = `0` connected physical devices (`Doze` and process-kill behavior `NOT TESTED`).
4. **Expected result:** Self-hosted relay persistence/pruning/fail-closed guarantees work; OS-level background wakeups after app kill require UnifiedPush distributor integration (Android FOSS) or vendor push relays (FCM/APNs).
5. **Observed result:** Local `vapid-keys.json` persistence, `429->200` retry (`retryHits: 2`), `410` token eviction, `unregister`, and APNs `503` fail-closed all **PASSED** locally. Live Android Doze, process termination, UnifiedPush distributor Intent delivery, and iOS APNs background push are **`NOT TESTED`** (no physical devices / no iOS Swift app / no UnifiedPush Android receiver).
6. **Remaining dependency:** Physical Android/iOS phones, user-installed UnifiedPush distributor app + Android Manifest/BroadcastReceiver (for zero-Google Android background wakeup), and Apple `.p8` credentials + Xcode project (for iOS background push).
7. **Remediation required:** Implement Android `org.unifiedpush.android.connector` BroadcastReceiver in Kotlin (registering endpoint into `/api/push/register-native` as `'unifiedpush'`), keep `SovraBleForegroundService` for BLE mesh continuity, and run physical Android Doze + force-stop verification.
