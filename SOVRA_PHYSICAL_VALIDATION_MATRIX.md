# SOVRA — PHYSICAL HARDWARE & DEVICE VALIDATION MATRIX
**Audit Date:** October 8, 2026  
**Auditor:** Mobile & Native Systems Engineer  
**Classification:** PHYSICAL RF & HARDWARE VALIDATION GAPS  

---

## 1. HARDWARE TESTING PRINCIPLE

> **Passing in-memory mock tests (`MockMeshChannel`, `VirtualBleBus`, `InMemoryBleAdapter`, headless Chrome loopback) does NOT prove that software functions on physical smartphones in real RF environments.**

The software implementation includes native bridges for Android (`SovraBleModule.kt`) and iOS (`SovraBleBridge.mm`), but physical device execution is currently blocked or unverified due to software discrepancies identified in this audit.

---

## 2. PHYSICAL VALIDATION MATRIX

| Hardware Test Scenario | Target Environment | Current Status | Blocker / Root Cause | Required Physical Test Protocol |
|---|---|---|---|---|
| **Android APK Build & Launch** | Physical Android Device (API 34) | **BLOCKED** | Missing `gradle-wrapper.jar` (`FINDING-P0-04`) & DOM `<main>` in React Native (`FINDING-P0-06`). | 1. Restore Gradle wrapper.<br>2. Build `app-release.apk`.<br>3. Install via `adb install`.<br>4. Capture `adb logcat` on launch. |
| **Android BLE Permissions Flow** | Android 12+ (API 31–34) | **UNVERIFIED** | Build blocked. | Prompt user for `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`. Verify runtime grant. |
| **Android BLE Advertising & Scan** | Phone A & Phone B (Real RF) | **UNVERIFIED** | Build blocked. | Phone A advertises service `00005356-...`; Phone B scans and discovers Phone A via real radio RSSI. |
| **Android GATT 512 MTU Negotiation** | Phone A & Phone B (Real RF) | **UNVERIFIED** | Build blocked. | Phone B connects to Phone A; request `requestMtu(512)`; verify callback returns negotiated MTU $\ge 247$. |
| **iOS BLE Permission & Activation** | Physical iPhone (iOS 17+) | **BROKEN** | `hasPermissions()` always evaluates to `false` due to string mismatch (`FINDING-P0-05`). | Fix `SovraBleNativeModule.mm`; compile in Xcode; deploy via TestFlight/development provisioning. |
| **Real BLE A $\leftrightarrow$ B Message & ACK** | Two Physical Smartphones | **UNVERIFIED** | Blocked by build and bridge bugs. | Phone A sends 500-byte encrypted frame to Phone B; Phone B returns ACK; record latency and packet loss. |
| **Three-Phone Multi-Hop Relay (A $\leftrightarrow$ B $\leftrightarrow$ C)** | Three Physical Smartphones | **UNVERIFIED (MOCKED ONLY)** | Test suite uses `MockMeshChannel` in memory (`FINDING-P2-03`). | Place A and C out of direct RF range; verify B genuinely receives packet over BLE and relays to C. |
| **Store-and-Forward across Phone Reboot** | Physical Phone B | **UNVERIFIED** | Tested in Node.js unit tests only. | A sends to offline C via B; B persists in local database; reboot Phone B; bring C online; verify B flushes outbox. |
| **WebRTC Cellular NAT Traversal** | Two Phones on 4G/5G Cellular | **UNVERIFIED** | Default Coturn secrets in compose (`FINDING-P1-04`); cellular ICE unverified. | Connect two phones on different carrier networks; initiate video call; assert candidate pair is `relay` (TURN). |
| **HTTPS Mobile Camera/Mic Access** | Mobile Chrome & Safari | **VERIFIED ON LAN** | Requires HTTPS certificate trust on mobile. | Access `https://<LAN_IP>:3443`; accept self-signed dev certificate; verify `getUserMedia()` streams live camera. |

---

## 3. LOGGING & EMPIRICAL EVIDENCE CHECKLIST

Before declaring physical release readiness, operators must capture and record:

1. **`adb logcat` Trace:**
   ```
   D/SovraBleModule: Advertising started successfully
   D/SovraBleModule: Device discovered: Address=XX:XX:XX:XX:XX:XX RSSI=-62
   D/SovraBleModule: GATT Connection State Change: status=0 newState=2 (CONNECTED)
   D/SovraBleModule: MTU negotiated: 512
   D/SovraBleModule: Characteristic write confirmed: 498 bytes
   ```
2. **WebRTC `getStats()` Metrics on Cellular Network:**
   ```json
   {
     "candidateType": "relay",
     "protocol": "udp",
     "relayProtocol": "udp",
     "bytesSent": 1845920,
     "bytesReceived": 1920440,
     "packetsLost": 4
   }
   ```
3. **Multi-Hop Relay Proof:**
   Phone B logs showing transit envelope with `hopCount: 1`, `originDid: AliceDID`, `targetDid: CharlieDID`, forwarded without modifying cryptographic payload signature.
