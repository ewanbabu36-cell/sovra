# SOVRA Source-Code Health, Functionality & Release Readiness Audit
## Deliverable 06: Platform Capabilities & Decentralization Audit

**Audit Date:** 2026-10-09  
**Execution Environment:** Local Windows Workstation (`d:\Sovra`)  
**Operating Principle:** INSPECT FIRST. VERIFY SECOND. REPORT THE TRUTH. DO NOT MODIFY THE PRODUCT.

---

### 1. Web Platform & Spatial Interface Audit (`apps/sovra-app`)

1. **Spatial Architecture & Navigation Hub:**
   - Framework: React 18 / TypeScript with native HTML5 Canvas rendering.
   - Design Principle: Zero persistent left navigation drawers.
   - Core Navigation Engine: `apps/sovra-app/src/ui/spatial/holo-core-navigation.ts` renders a high-performance central glowing orb.
   - Interaction Model: Clicking the central orb triggers an expanding energy pulse ring and radial node menu:
     - Feed (`/app`)
     - Reels (`/reels`)
     - Watch (`/watch`)
     - Chat (`/chat`)
     - Profile (`/profile`)
     - Notifications (`/notifications`)
     - Create Post (`/create`)
     - Logout (`/logout`)
2. **Offline Web Readiness & Service Worker:**
   - Manifest: `manifest.webmanifest` / `manifest.json` configured as a Progressive Web App (PWA) with standalone display.
   - Service Worker (`sw.js`): Caches static application assets, holographic shaders, and icons.
   - Gap: Persistent client outbox in IndexedDB for offline post queuing is missing in the browser app; currently relies on server connectivity.

---

### 2. Mobile Platform Audit (Android & iOS)

#### A. Android Architecture (`apps/sovra-mobile/android`)
- **SDK Target & Toolchain:** Compile SDK 34 (Android 14), Target SDK 34, Min SDK 24. Android Gradle Plugin 8.2.2, Gradle 8.3.
- **Native BLE Implementation:** `SovraBleModule.kt` (562 lines).
  - Uses `BluetoothLeScanner` with strict `ScanFilter` on Service UUID `00005356-0000-1000-8000-00805f9b34fb`.
  - Uses `BluetoothLeAdvertiser` with `ADVERTISE_MODE_LOW_LATENCY` and `ADVERTISE_TX_POWER_HIGH`.
  - Implements `BluetoothGattServer` and `BluetoothGatt` client with 512-byte MTU negotiation (`requestMtu(512)`).
  - Listens to Android hardware broadcasts (`ACTION_STATE_CHANGED`) to handle Bluetooth toggle events gracefully.
- **Android Manifest & Permissions (`AndroidManifest.xml`):**
  - Android 12+ (API 31+): `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`.
  - Android 11-: `BLUETOOTH`, `BLUETOOTH_ADMIN`, `ACCESS_FINE_LOCATION`.
  - Background Execution: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `WAKE_LOCK`.
- **Build Status:**
  - Debug APK: Generated and verified at `apps/sovra-mobile/android/app/build/outputs/apk/debug/app-debug.apk` (119,718,890 bytes, SHA256: `a0176094087da0634b5936e128f79b06db3826dbff7854a5cd2431f56e457519`).
  - Release APK: Not yet compiled in current workspace.
  - ADB Device Connectivity: **0 physical devices connected** (`adb devices -l` returns empty).

#### B. iOS Architecture (`apps/sovra-mobile/ios`)
- **Native BLE Implementation:** `SovraBleBridge.mm` (Objective-C++) and `SovraBleNativeModule.mm`.
  - Central Manager: `CBCentralManager` scanning for peripheral service UUID `00005356-0000-1000-8000-00805f9b34fb`.
  - Peripheral Manager: `CBPeripheralManager` advertising service and characteristics with `CBCharacteristicWriteWithResponse`.
  - Event Bridge: Emits `onDeviceDiscovered`, `onIncomingDataReceived`, and `onPeerDisconnected` to React Native.
- **iOS Platform Limitations & Real-World Constraints:**
  - **Foreground Mesh:** Fully supported.
  - **Background Mesh:** CoreBluetooth background execution allows continued connection to known peripherals, but iOS **halts BLE advertising** when the app is in the background or the screen is locked, unless specific state restoration is active. Continuous background mesh relay on iOS without user interaction is constrained by Apple iOS sandbox policy.

---

### 3. Decentralized Networking & P2P Mesh Architecture (`packages/p2p`)

#### A. Multi-Hop BLE Mesh Protocol (`packages/p2p/src/mesh/mesh-router.ts`)
- **Routing Strategy:** Distance-vector / source-routed hybrid mesh with hop-count metrics.
- **Loop Prevention:** Every packet carries a 64-bit unique packet ID and a SHA-256 payload digest. Nodes maintain a bounded cache of recently processed packet hashes; seen packets are discarded immediately.
- **Hop Limit (TTL):** Default `TTL = 5`. Packets are decremented at each intermediary hop (`ttl = ttl - 1`); packets reaching `ttl = 0` are dropped to prevent broadcast storms.
- **Cryptographic Immobility:** Intermediary relay nodes forward packets without modifying or re-signing author payloads; end-to-end signatures remain valid from source to final recipient.

#### B. Durable Store-and-Forward Outbox (`packages/p2p/src/mesh/outbox-store.ts`)
- **Durable Storage:** Outbox packets are serialized to disk/SQLite with state metadata (`PENDING`, `TRANSMITTING`, `DELIVERED`, `EXPIRED`).
- **Resilience Across Restarts:** Packets survive process crashes and power cycles.
- **Retry Policy:** Exponential backoff with jitter on failed transmission attempts.
- **Delivery Acknowledgement (ACK):** When the recipient processes a packet, it signs an ACK envelope back to the sender. Upon receiving the ACK, the sender transitions the outbox state to `DELIVERED` and schedules disk compaction.

#### C. IPFS / BitSwap Blockstore (`packages/storage`)
- **Content Addressing:** Files are split into 256 KB chunks, hashed via SHA-256, and addressed via Content Identifiers (CID v1).
- **Block Exchange:** BitSwap swarm implementation allows local peers to request missing blocks from neighbors.

---

### 4. WebRTC Audio & Video Calling Stack

1. **Signaling Mechanism:**
   - REST endpoints `/api/call/offer`, `/api/call/answer`, `/api/call/candidate`, `/api/call/end`.
   - Event delivery via Server-Sent Events (`/api/events/stream`) or polling fallback (`/api/call/poll`).
2. **Secure Context & Browser Media Access:**
   - Dual server architecture: HTTP on `:3001` and HTTPS on `:3443`.
   - Modern browsers (Chrome, Firefox, Safari) strictly require HTTPS or localhost for `navigator.mediaDevices.getUserMedia`.
3. **Automated Media Transfer Test Evidence:**
   - 5 WebRTC test suites with **45 passing automated tests**:
     - `tests/webrtc-signaling-e2e.test.ts` (12 tests)
     - `tests/webrtc-connection-flow.test.ts` (8 tests)
     - `tests/webrtc-media-transfer.test.ts` (10 tests)
     - `tests/webrtc-error-recovery.test.ts` (8 tests)
     - `tests/webrtc-security.test.ts` (7 tests)
   - Real media exchange verified in loopback and local network contexts.
4. **Physical Deployment Blockers:**
   - **Zero physical mobile devices attached:** Physical hardware microphone/camera tests on mobile unverified.
   - **Carrier CGNAT:** Traversal over 4G/5G mobile carriers requires a deployed public coturn server.
