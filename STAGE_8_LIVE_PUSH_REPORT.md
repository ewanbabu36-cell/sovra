# Stage 8 — Live APNs & FCM Push Notification Report

**Phase:** Stage 8 — Independent External Field Certification  
**Timestamp:** `2026-11-26T12:50:55+05:30`  
**Overall Section Status:** **`BLOCKED`** *(Local fail-closed & local HTTP push wire test = `PASS` locally; live FCM HTTP v1 & APNs HTTP/2 delivery = **`BLOCKED`** due to absent push credentials and zero connected physical devices)*

---

## 1. Empirical Credential & Infrastructure Check

Observed environment variables (`2026-11-26T12:50:55+05:30`):
- `FCM_SERVER_KEY=UNSET`
- `GOOGLE_APPLICATION_CREDENTIALS=UNSET`
- `APNS_KEY_ID=UNSET`
- `APNS_TEAM_ID=UNSET`
- `VAPID_PUBLIC_KEY=UNSET`
- `VAPID_PRIVATE_KEY=UNSET`
- `SOVRA_PUSH_WEBHOOK_URL=UNSET`

No Firebase Cloud Messaging service-account credentials, Apple Push Notification service `.p8` auth keys, provisioned WebPush browser subscriptions, or attached physical mobile devices exist in this test environment.

---

## 2. Finding Matrix

| Finding ID | Detailed Verification Record |
|---|---|
| **S8-PUSH-01** | **Requirement ID:** `S8-SEC5-PUSH-01` — Fail-closed unconfigured behavior & blind channel DID redaction on wire dispatch<br>**Test methodology:** Execute [packages/messaging/test/blind-push.test.ts](file:///d:/Sovra/packages/messaging/test/blind-push.test.ts) against both an unconfigured `BlindPushRelayServer` and `HttpEndpointPushTransport` targeting a real local ephemeral `node:http` server<br>**Environment:** Single Windows host (`remediation-verified-120-final.log`, `task-55701`)<br>**Actual execution evidence:** `4/4` tests passed (`44ms`): unconfigured dispatch returned `ok: false` (fail-closed, no synthetic `fcm_msg_*` mock), and wire payload omitted sensitive user DID strings while delivering opaque `blindChannelId` & `opaqueWakeupHint` over local HTTP<br>**Result:** **`PASS`** *(Local unit/loopback HTTP wire behavior ONLY — explicitly NOT counted as live FCM/APNs delivery per Stage 8 Rule 1)*<br>**Evidence location:** [packages/messaging/src/blind-push.ts:66-215](file:///d:/Sovra/packages/messaging/src/blind-push.ts#L66-L215), [blind-push.test.ts](file:///d:/Sovra/packages/messaging/test/blind-push.test.ts)<br>**Remaining limitations:** Only local HTTP server transport is exercised; TLS ALPN HTTP/2 APNs (`api.push.apple.com:443`) and OAuth2 FCM HTTP v1 (`fcm.googleapis.com`) were not called. |
| **S8-PUSH-02** | **Requirement ID:** `S8-SEC5-PUSH-02` — Live end-to-end FCM HTTP v1 wakeup delivery to backgrounded/killed physical Android phone<br>**Test methodology:** Obtain real FCM device registration token from installed Sovra APK on physical Android phone, configure `GOOGLE_APPLICATION_CREDENTIALS`, dispatch `HttpEndpointPushTransport` wake-up, observe background/Doze wake & foreground sync<br>**Environment:** Missing `GOOGLE_APPLICATION_CREDENTIALS` / `FCM_SERVER_KEY` and `adb devices -l` = `0` devices<br>**Actual execution evidence:** Not executed; native fallback in [push.routes.ts:280-285](file:///d:/Sovra/scripts/routes/push.routes.ts#L280-L285) returns `{ ok: false, ... }` when live provider client unconfigured<br>**Result:** **`BLOCKED`**<br>**Evidence location:** Env probe `2026-11-26T12:50:55+05:30`, `adb devices -l`<br>**Remaining limitations:** Real Firebase project credentials, OAuth2 token exchange, and physical GMS-enabled Android phone required. |
| **S8-PUSH-03** | **Requirement ID:** `S8-SEC5-PUSH-03` — Live APNs HTTP/2 silent/VoIP push wakeup delivery to physical iOS device<br>**Test methodology:** Configure Apple Developer `.p8` key, `APNS_KEY_ID`, `APNS_TEAM_ID`, and dispatch over HTTP/2 to physical iPhone running Sovra iOS build<br>**Environment:** Windows host without macOS/Xcode, zero iOS devices, `APNS_KEY_ID=UNSET`, `APNS_TEAM_ID=UNSET`<br>**Actual execution evidence:** `0` APNs dispatches executed<br>**Result:** **`BLOCKED`**<br>**Evidence location:** Env probe `2026-11-26T12:50:55+05:30`<br>**Remaining limitations:** Requires macOS/Xcode toolchain, Apple Developer APNs key, and physical iPhone. |
