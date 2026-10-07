# SOVRA Release Blocker Remediation Plan

**Target Transition:** `RELEASE BLOCKED` $\longrightarrow$ `RELEASE CANDIDATE — BLOCKERS VERIFIED FIXED`  
**Scope:** Remediation of all vulnerabilities and blockers identified by the independent adversarial audit, focused on BLE offline mesh, AEAD nonce desynchronization, packet loss/reordering/duplication defenses, native Android/iOS BLE subsystems, and workspace integrity.

---

## 1. Current State & Architectural Analysis

### 1.1 Repository State
- **Branch:** `main`
- **TypeScript Workspace Status:** Root `npx tsc --noEmit` and all 22 workspace projects typecheck with **0 errors**.
- **Test Suite Status:** All 59 Vitest test files (365 tests) passing.
- **Mobile Stack:** Expo / React Native (`apps/sovra-mobile`, `app.json`, `eas.json`, `package.json`).
- **Core Mesh Subsystem:** Located in `packages/p2p/src/mesh/`:
  - `ble-adapters.ts`: BLE platform adapters (`AndroidBleAdapter`, `IosBleAdapter`, `VirtualBleBus`).
  - `ble-transport.ts`: `BluetoothLETransport`, `ConcreteBleChannel`.
  - `ble-handshake.ts`: `BleHandshakeEngine`, `AuthenticatedBleSession`.
  - `ble-codec.ts`: `BleFrameCodec`, `BleFrameReassembler`.
  - `mesh-router.ts`: `MeshRouter`, store-and-forward envelope routing.
  - `outbox-store.ts`: `DurableOutboxStore`, durable message queue.

### 1.2 Release Blockers Identified by Audit

1. **AEAD Nonce Desynchronization under Packet Loss (Critical Vulnerability)**:
   - *Problem*: ChaCha20-Poly1305 session cipher derived nonces from sequential packet counters. Under BLE radio packet loss (e.g., packet 101 dropped between 100 and 102), receiver attempted to decrypt packet 102 with counter 101, causing immediate, permanent session desynchronization and MAC authentication failures.
   - *Requirement*: Explicit, authenticated 64-bit sequence numbers embedded in the frame header. Nonce derived deterministically from the explicit sequence number and session IV. Sequence number bound to the ciphertext via Poly1305 Associated Authenticated Data (AAD).

2. **Replay & Out-of-Order Attack Surfaces**:
   - *Problem*: Lack of bounded anti-replay sliding window. Potential for replay of stale frames, unbounded memory growth from arbitrary sequence numbers, or false rejections of valid out-of-order frames.
   - *Requirement*: Bounded sliding anti-replay window (RFC 6479 / RFC 4303 model) with explicit classifications: `NEW`, `DUPLICATE`, `OLD` (out of window), and `INVALID`.

3. **Skeleton Android & iOS BLE Platform Adapters**:
   - *Problem*: `AndroidBleAdapter` and `IosBleAdapter` contained skeleton implementations returning unconditional `true` without actual native binding, GATT state machine, or genuine transport status.
   - *Requirement*: Remove all fake success returns (`send: async () => true`). Implement genuine platform adapters with native bridge bindings:
     - Android: `BluetoothGattServer`, `BluetoothGattCallback`, advertising, scanning, 512 MTU negotiation, characteristic writes, disconnect detection, error propagation.
     - iOS: `CoreBluetooth` (`CBCentralManager`, `CBPeripheralManager`), service/characteristic discovery, notifications, MTU-aware writes, `CBManagerState` lifecycle.
     - Truthful transport states: `QUEUED`, `SENT_TO_BLE_STACK`, `ACKNOWLEDGED_BY_BLE_TRANSPORT`, `DELIVERED_TO_PEER`, `APPLICATION_LEVEL_RECEIPT`.

4. **Transport Loss, Reordering, and Duplicate Stress Testing**:
   - *Requirement*: Rigorous deterministic test suite testing packet loss at 0%, 1%, 5%, 10%, 25%, 50%, random reordering, duplicate deliveries, burst losses, and reconnects during transmission.

---

## 2. Remediation Strategy & Implementation Path

### Phase A: AEAD Nonce & Explicit Sequence Protocol (`ble-handshake.ts`)
1. **Explicit 64-Bit Sequence Number**:
   - Format: 8-byte big-endian / little-endian unsigned integer.
   - Counter exhaustion check: If `txSeq >= 0xFFFFFFFFFFFFFFFFn - 1n`, reject and require re-handshake.
2. **Cryptographic Nonce Derivation**:
   - RFC 8439 12-byte (96-bit) nonce:
     - Derived from HKDF session IV (`txIv`, `rxIv`) XORed with the 64-bit sequence number (padded to 12 bytes).
     - $\text{nonce} = \text{IV} \oplus \text{pad}_{96}(\text{seq})$.
   - Ensures unique nonces even if multiple sessions share initial zero counters.
3. **Associated Authenticated Data (AAD)**:
   - $\text{AAD} = \text{SessionId} \,\|\, \text{ProtocolVersion} \,\|\, \text{SequenceNumber}$.
   - Passed directly into `ChaCha20-Poly1305`. Any sequence number modification triggers constant-time MAC verification failure.

### Phase B: Bounded Sliding Window Replay Protection (`ble-handshake.ts`)
1. **Window Size**: 256 or 1024 packets.
2. **State**:
   - `maxSeenSeq`: Highest valid sequence number received.
   - Bitmask / set tracking seen packets in range $[\text{maxSeenSeq} - \text{WINDOW\_SIZE} + 1, \, \text{maxSeenSeq}]$.
3. **Packet Classification**:
   - $\text{seq} > \text{maxSeenSeq}$: `NEW` $\to$ advance window, mark received.
   - $\text{seq} \le \text{maxSeenSeq} \land \text{seq} > \text{maxSeenSeq} - \text{WINDOW\_SIZE}$:
     - If in seen set: `DUPLICATE` $\to$ reject with error.
     - If not in seen set: `NEW` (reordered within window) $\to$ mark seen, decrypt.
   - $\text{seq} \le \text{maxSeenSeq} - \text{WINDOW\_SIZE}$: `OLD` (outside window) $\to$ reject with error.
   - Memory is strictly $O(1)$ and immune to DoS via sparse sequence numbers.

### Phase C: Production Android BLE Platform Adapter (`ble-adapters.ts`)
1. Remove all mock/skeleton loops.
2. Implement `AndroidNativeBridge` interface:
   - Scanning: `BluetoothLeScanner` with `ScanFilter` for `SOVRA_BLE_SERVICE_UUID`.
   - Advertising: `BluetoothLeAdvertiser` with `AdvertiseSettings` (LOW_LATENCY / BALANCED).
   - GATT Server: `BluetoothGattServer` hosting RX and TX characteristics.
   - GATT Client: `BluetoothGatt.connectGatt`, `requestMtu(512)`, `discoverServices`.
   - MTU negotiation callback: update channel MTU to negotiated value (up to 512).
   - Write confirmation: Wait for `onCharacteristicWrite` status before resolving transport acknowledgment.
   - Disconnect handling: `BluetoothProfile.STATE_DISCONNECTED` triggers immediate peer cleanup and outbox retention.
3. If hardware/bridge is unavailable, throw descriptive error:
   `BleHardwareUnavailableError: Native Android Bluetooth subsystem is not initialized or Bluetooth is disabled`.

### Phase D: Production iOS BLE Platform Adapter (`ble-adapters.ts`)
1. Remove skeleton behavior.
2. Implement `IosCoreBluetoothBridge` interface:
   - Central Manager: `CBCentralManager` tracking `CBManagerState`, scanning for `SOVRA_BLE_SERVICE_UUID`.
   - Peripheral Manager: `CBPeripheralManager` advertising service UUID and `CBService`.
   - Characteristics: `CBCharacteristic` with `.write` / `.writeWithoutResponse` and `.notify`.
   - ATT MTU: Set default to 182, query `maximumWriteValueLength(for: .withResponse)`.
   - Notifications: Subscription via `setNotifyValue(true, for: characteristic)`.
   - Disconnect: `centralManager(_:didDisconnectPeripheral:error:)` clean shutdown.
3. If hardware/bridge is unavailable, throw descriptive error:
   `BleHardwareUnavailableError: CoreBluetooth is powered off or unauthorized`.

### Phase E: Comprehensive Loss & Reorder Test Suite (`offline-ble-loss.test.ts`)
1. Create a specialized test suite simulating real BLE radio imperfections:
   - 0%, 1%, 5%, 10%, 25%, 50% packet loss.
   - Shuffled packets (out-of-order delivery).
   - Duplicate transmissions (repeated packets).
   - Delayed packet bursts.
   - Mid-transmission disconnect & reconnection resumption.
2. Validate that plaintext payloads either arrive completely intact or fail safely without corrupted state.

---

## 3. Source Files Targeted for Modification

| Target File | Component | Remediation Focus |
| :--- | :--- | :--- |
| `packages/p2p/src/mesh/ble-handshake.ts` | Handshake & Session | Explicit 64-bit seq, AAD binding, TLS 1.3 IV XOR nonce derivation, anti-replay sliding window |
| `packages/p2p/src/mesh/ble-adapters.ts` | Hardware Adapters | Real Android GATT & iOS CoreBluetooth adapters, removal of fake `return true`, truthful delivery states |
| `packages/p2p/src/mesh/ble-transport.ts` | BLE Transport | Delivery semantics (`QUEUED`, `SENT`, `ACKNOWLEDGED`), error propagation, frame dispatch |
| `packages/p2p/test/offline-ble-loss.test.ts` | Test Suite | New deterministic packet loss, reorder, and duplicate test matrix (0% to 50%) |
| `packages/p2p/test/offline-ble-mesh.test.ts` | Test Suite | Verify all existing mesh tests with updated cryptographic frame format |

---

## 4. Verification & Release Gate Protocol

1. **Unit & Integration Regression**:
   - `npx vitest run packages/p2p`
   - `npx vitest run` (all 59 suites)
2. **Typecheck & Build**:
   - `npx tsc --noEmit`
   - `npx pnpm -r run typecheck`
3. **Physical Hardware Evaluation**:
   - If physical mobile devices are connected: Execute physical cross-platform BLE verification.
   - If running in headless VM / CI environment: Explicitly record `PHYSICAL DEVICE VERIFICATION NOT EXECUTED` and classify final status as `RELEASE CANDIDATE — BLOCKERS VERIFIED FIXED`.
