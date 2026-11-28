# SOVRA — Real-World vs Lab Verification Matrix

---

## 1. Exact Observed Baseline Verification Runs (`AUDIT-ONLY`, No Code/Test Edits)

| # | Command Executed | Working Dir | Exit Code | Counts Observed | Environment & Caveats |
|---|---|---|---|---|---|
| 1 | `go test -count=1 ./...` | `D:\Sovra\chain` | `0` | `10` packages passed (`cmd/sovrad`, `consensus`, `node`, `p2p`, `privval`, `store`, `x/auth`, `x/issuance/keeper`, `x/issuance/types`, `x/wasm`); `5` subpackages `[no test files]` | Local Go unit/consensus tests (`SOVRA-EXT-CONSENSUS`) |
| 2 | `tsc -p <tsconfig> --noEmit` across all `19` workspace configs | `D:\Sovra` | `0` | `19/19` passed (`0` errors) | Static typecheck only |
| 3 | `& "C:\Program Files\nodejs\node.exe" "...\run-suites.mjs" "...\audit-observed-full.log" packages/identity ... apps/sovra-mobile/test/mnemonic-and-multi-relay.test.ts` | `D:\Sovra` | `1` | **`112` passed \| `4` failed (`116` files); `739` passed \| `5` failed (`744` tests)** | Single Windows host; `127.0.0.1` loopback |
| 4 | Pure `node:crypto` + reference Bech32m independent check (`SOVRA-ID`, `SOVRA-ENC-ID`, `SOVRA-EVT` CBOR) | `D:\Sovra` | `0` | `idMatch=true`, `encMatch=true`, `evtIdMatch=true`, `evtSigOk=true` | Vector 6 rotation NOT deterministic under current code |
| 5 | Artifact disk size audit (`Get-Item apps/sovra-app/dist/*, apps/sovra-mobile/dist/*`) | `D:\Sovra` | `0` | `apps/sovra-app/dist/bundle.js` = `219,355` B; `apps/sovra-mobile/dist/bundle.js` = `1,031` B | `sovra-mobile` bundle is an empty black `<div>` stub |

---

## 2. Observed Failing Tests in Baseline Matrix (`AUDIT_VITEST_RC=1`)
1. [tests/integration/ia01-networking-and-storage.test.ts:107](file:///d:/Sovra/tests/integration/ia01-networking-and-storage.test.ts#L107) — `AssertionError: expected undefined to be false` (`verifySignedPeerRecord` returns `boolean`, caller checked `.ok`).
2. [tests/integration/ia01-networking-and-storage.test.ts:200,208](file:///d:/Sovra/tests/integration/ia01-networking-and-storage.test.ts#L200) -> [packages/storage/src/blockstore.ts:207](file:///d:/Sovra/packages/storage/src/blockstore.ts#L207) — `TypeError: The "path" argument must be of type string... Received undefined` (incorrect `StorageNodeDaemon` positional call + missing `rootDir` guard).
3. [tests/security/dependency-boundaries.test.ts:149](file:///d:/Sovra/tests/security/dependency-boundaries.test.ts#L149) — Naive `/26657/` match collided with BN254 constant in [packages/crypto/src/zk.ts:187](file:///d:/Sovra/packages/crypto/src/zk.ts#L187).
4. [packages/identity/test/sovra-id-v1.test.ts:189](file:///d:/Sovra/packages/identity/test/sovra-id-v1.test.ts#L189) — Deterministic Vector 6 mismatch (`73c66d... != 5c3a70...`) caused by ignored `newEncryptionPrivateKey` in [packages/identity/src/sovra-id.ts:420-422](file:///d:/Sovra/packages/identity/src/sovra-id.ts#L420-L422).
5. [packages/p2p/test/benchmark.test.ts:43](file:///d:/Sovra/packages/p2p/test/benchmark.test.ts#L43) — Validation throughput measured `153.39 ops/sec` (`< 200`, title states `>2,000 ops/sec`).

---

## 3. Environment Separation Matrix (Simulation vs Real World)

| Scenario Required (`IA-01 Sec 4, 5, 8, 9`) | Local / Automated Status | Real-World Field Test Status |
|---|---|---|
| **Direct IPv4 TCP + `Noise_XX` + Yamux** | Exercised on `127.0.0.1` loopback | **NOT EXECUTED** across public routable WAN |
| **Direct IPv6 (`/ip6/::1` & public WAN IPv6)** | **FAILED/UNREACHED** in `ia01-networking-and-storage.test.ts` (aborted at line 107) | **NOT EXECUTED** across dual-stack ISPs |
| **LAN UDP mDNS (`sovra-mdns-v1`)** | Verified locally (`founder-disappears-and-adversarial.test.ts`) | **NOT EXECUTED** across separate Wi-Fi LAN hardware devices |
| **Symmetric CGNAT / Multi-Relay Failover** | Verified via loopback STUN + `relay` in `founder-disappears`, **FAILED** in `ia01` | **NOT EXECUTED** over carrier LTE/5G CGNAT vs broadband |
| **True UDP / QUIC Transport** | **NOT IMPLEMENTED** (`node:net` TCP only) | **NOT IMPLEMENTED** |
| **Physical Mobile BLE & Wi-Fi Direct** | Stubbed/unavailable in Node (`NativeMobileBleAdapter.isAvailable() === false`) | **NOT EXECUTED** on physical Android/iOS hardware |
| **3-Organization Geo-Separated Mesh (`IA-01 Sec 9`)** | Simulated labels (`op-coop-tokyo/berlin/toronto`) on localhost | **NOT EXECUTED** (`0` independent external operators deployed) |
| **Android Signed APK & iOS App Store/TestFlight** | `mobile/dist/bundle.js` is `1,031` B placeholder; hardcoded `build.gradle` fallback password | **NOT EXECUTED** on device/Play/TestFlight |
| **Reproducible Builds & P2P Auto-Update Delivery** | Library checks in `software-update.ts` pass unit tests | **NOT EXECUTED** end-to-end across mirror URLs / OS binaries |
