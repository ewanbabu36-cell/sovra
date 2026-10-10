# SOVRA — MISSING TEST MATRIX & FALSE CONFIDENCE ANALYSIS
**Audit Date:** October 8, 2026  
**Auditor:** Principal Software Architect & QA/Adversarial Tester  
**Purpose:** Expose what the existing test suite does NOT test, where mocks hide real bugs, and what fails in production.  

---

## 1. FALSE CONFIDENCE & MOCK CLASSIFICATION AUDIT

Many tests in the repository report green status but test in-memory simulations rather than real production paths:

1. **Multi-Hop Mesh:** `tests/e2e/multi-hop-mesh-offline.test.ts` uses `MockMeshChannel` with in-memory synchronous method calls (`peer.onReceive(data)`). It passes 100%, but tests **zero** radio packets, **zero** MTU fragmentation, and **zero** Bluetooth controller interactions.
2. **WebRTC Media Flow:** `tests/e2e/real-webrtc-media-transfer.test.ts` launches Chromium with `--use-fake-device-for-media-stream` and connects two peers inside the same browser tab over local loopback. It passes, but does **not** test cellular NAT traversal, symmetric NAT, or TURN relaying on real devices.
3. **Admin Endpoints:** Security test `adversarial-bola-idor-matrix.test.ts` tests profile update role escalation, but does **not** test `POST /api/admin/channels/delete` or `POST /api/admin/pages/delete`, leaving catastrophic unauthenticated admin deletion untested.
4. **Chat Privacy:** Test tests Eve reading messages with her own session token, but **never** tests unauthenticated `GET /api/chat/messages?userDid=...` with no session token, allowing the BOLA bug to go undetected.

---

## 2. MISSING TEST MATRIX

| Feature | Current Test | Missing Test | Real-World Failure Scenario | Severity |
|---|---|---|---|---|
| **Direct Chat Privacy** | `CHAT-08` tests Eve's token cannot read Alice's thread. | Send `GET /api/chat/messages?userDid=AliceDID` with **no** auth headers. | Attacker dumps entire private direct message history without logging in. | **P0** |
| **Admin Channel Delete** | None. | Send `POST /api/admin/channels/delete` with unauthenticated payload. | Any attacker permanently wipes the system announcements channel. | **P0** |
| **Admin Page Delete** | None. | Send `POST /api/admin/pages/delete` with unauthenticated payload. | Any attacker permanently deletes verified brand pages. | **P0** |
| **User Persistence Lifespan** | Tests create user and check profile within 5 seconds. | Create user `@charlie_smith`, wait 65 seconds, invoke `db.load(true)`. | Real user profile is wiped by regex heuristic 60s after registration. | **P0** |
| **Android APK Compilation** | None. (TypeScript compilation only). | Execute `./gradlew assembleRelease` in clean checkout. | Build fails with `ClassNotFoundException: org.gradle.wrapper.GradleWrapperMain`. | **P0** |
| **iOS BLE Activation** | None. (Objective-C++ compiles in Xcode only). | Call `NativeModules.SovraBleNative.hasPermissions()`. | App reports permission denied on 100% of physical iPhones due to `"allowed"` vs `"authorized"`. | **P0** |
| **Mobile UI Boot** | Vitest verifies JSX functions return React elements. | Bundle with React Native Metro CLI for Android/iOS. | App crashes on startup: `Invariant Violation: View config getter for 'main' must be function`. | **P0** |
| **Reverse Proxy Rate Limit** | Tests run against localhost with single client. | Make 201 requests from IP A through reverse proxy, then 1 request from IP B. | User B receives 429 Too Many Requests because proxy IP bucket is exhausted. | **P1** |
| **Session Expiry** | Tests verify active session token authenticates. | Test token older than 30 days is rejected. | Stolen session tokens remain usable indefinitely. | **P1** |
| **Offline Like Reconcile** | Tests enqueue like once and sync. | Enqueue `LIKE_POST`, sync twice consecutively. | Post like is toggled off on second sync due to non-idempotent `toggleLike()`. | **P1** |
| **Media Orphan Leaks** | Tests verify post is removed from feed. | Delete post with 5MB image; inspect `.sovra-storage-dev`. | Orphaned image remains on disk permanently. | **P1** |
| **Channel SSE Live Updates** | Tests direct message SSE delivery. | User subscribes to channel; another sends post to channel; assert SSE event. | Channel subscribers never receive real-time updates over SSE. | **P1** |
| **Watch Video Persistence** | Tests publish video and check client DOM state. | Upload video, restart dev-server, fetch `/api/youtube/videos`. | Video disappears completely on server reboot. | **P1** |
| **Concurrent Whole-DB Writes** | Single test thread sends sequential requests. | 100 concurrent workers sending posts and messages simultaneously. | Event loop freeze and corrupted JSON state from concurrent `fs.writeFileSync`. | **P2** |
| **Hardware Keystore Extraction** | Tests vault encrypt/decrypt in memory. | Adversarial script extracts `sovra_device_entropy_seed` from `localStorage`. | Private key decrypted and stolen by client-side script. | **P1** |
| **Physical RF BLE Multi-Hop** | `multi-hop-mesh-offline.test.ts` uses `MockMeshChannel`. | 3 physical phones: Phone A $\to$ Phone B $\to$ Phone C over 2.4GHz BLE. | Packets lost to RF attenuation, MTU mismatch, GATT connection timeouts. | **P0** |
