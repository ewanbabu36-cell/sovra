# SOVRA — Updated Real-World vs Local Verification Matrix

**Program Comparison Baseline:** [REAL_WORLD_TEST_MATRIX.md](file:///d:/Sovra/REAL_WORLD_TEST_MATRIX.md)  
**Date:** 2026-11-26

---

## 1. Exact Post-Remediation Executed Runs (Verified After Final Edit)

| # | Command / Scope | Working Dir | Exit Code | Exact Observed Results | Environment & Scope |
|---|---|---|---|---|---|
| 1 | `go test -count=1 ./...` (`task-55676`) | `D:\Sovra\chain` | `0` | **`10` packages passed**, `5` subpackages `[no test files]` | Local Go `SOVRA-EXT-CONSENSUS` tests |
| 2 | `tsc -p <tsconfig> --noEmit` across all `23` configs in `apps/*`, `nodes/*`, `packages/*`, `services/*` (`task-55701`) | `D:\Sovra` | `0` | **`WORKSPACE_TSCONFIGS=23 WORKSPACE_TSCONFIG_FAILED=0`** | Static TypeScript check across all 23 workspace packages |
| 3 | Client & Mobile production bundlers (`scripts/build-client-bundle.ts` & `apps/sovra-mobile/build-mobile-bundle.ts`) (`task-55701`) | `D:\Sovra` | `0` | `apps/sovra-app/dist/bundle.js` = **`219,993` B** + `sovra.css` = **`369,968` B**; `apps/sovra-mobile/dist/bundle.js` = **`739,092` B** (vs previous `1,031` B stub) | Browser & mobile esbuild production bundles |
| 4 | Comprehensive 120-file Vitest offline/multi-process regression (`116` baseline + `4` new Stage 2/3/4/5 suites; `remediation-verified-120-final.log`, `task-55701`) | `D:\Sovra` | `0` | **`120 passed (120)` files; `758 passed (758)` tests** in `124.51s` (vs baseline `112 passed \| 4 failed` / `739 passed \| 5 failed`) | Single Windows host; real OS TCP/WS/UDP sockets + 4-process `child_process.spawn` (`127.0.0.1` / `::1`) |
| 5 | Additional 6 Stage-5 offline security/unit/app suites (`task-55726`) | `D:\Sovra` | `0` | **`6 passed (6)` files; `21 passed (21)` tests** (`blinded-push-relay`, `phase9-security-isolation`, `founder-governance-simulation`, `sovra-app/index`, `mobile-app`, `failure-resilience`) | Local standalone Vitest suites |
| 6 | Stage 7 probe CLI self-check (`node --experimental-strip-types scripts/external-certification-check.ts`) (`task-55687`) | `D:\Sovra` | `0` | `status: "READY_FOR_EXTERNAL_EXECUTION"`, `supportedTransports` listed, `quicStatus: "FAIL_CLOSED_NOT_IMPLEMENTED"`, `cidCheckReady: true` | CLI readiness probe without `--peers` |
| 7 | Non-matrix HTTP/Legacy check earlier in Stage 5 (`task-55647`, pre-`quicPenalty` tweak) | `D:\Sovra` | `1` | `governance_p0_remediation.test.ts`: `24` unit tests passed, `8` `P0-C` HTTP tests failed (`ECONNREFUSED 127.0.0.1:3001` — dev-server stopped); `phase7-governance-e2ee-adversarial.test.ts`: `11/13` passed, `2/13` failed on pre-existing `SovraDatabaseEngine.appendMessage` badge text | Documents remaining dev-server / legacy JSON-store test failures |

---

## 2. Fixed Baseline Failures (5 -> 0 in Core Matrix)

1. [tests/integration/ia01-networking-and-storage.test.ts](file:///d:/Sovra/tests/integration/ia01-networking-and-storage.test.ts) (`0/2` -> **`2/2` passed**) — Contract mismatch + `DiskBlockstore` / `StorageNodeDaemon` validation fixed.
2. [packages/identity/test/sovra-id-v1.test.ts](file:///d:/Sovra/packages/identity/test/sovra-id-v1.test.ts) (`3/4` -> **`4/4` passed**) — Deterministic X25519 key derivation + Vector 6 fixed & cross-checked with OpenSSL.
3. [tests/security/dependency-boundaries.test.ts](file:///d:/Sovra/tests/security/dependency-boundaries.test.ts) (`5/6` -> **`7/7` passed**) — BN254 decimal regex false-positive fixed + Stage 5 boundary assertions added.
4. [packages/p2p/test/benchmark.test.ts](file:///d:/Sovra/packages/p2p/test/benchmark.test.ts) (`2/3` -> **`3/3` passed**) — Validation throughput jumped from `153.39 ops/sec` -> **`4,238 ops/sec`** (`task-55701`) / `10,715 ops/sec` isolated.

---

## 3. Honest Classification Separation Matrix (Stage 7 Taxonomy)

| Scenario | Evidence Level Achieved | What Is Still Missing for `REAL-WORLD VERIFIED` |
|---|---|---|
| Direct IPv4 & IPv6 `tcp+noise_xx+yamux` + `/ws` | **`INTEGRATION VERIFIED`** | Cross-ASN dual-stack WAN runs via [external-certification-check.ts](file:///d:/Sovra/scripts/external-certification-check.ts) (**`NOT VERIFIED`**) |
| True UDP / QUIC Transport | **`NOT IMPLEMENTED`** | Native Node QUIC runtime support (`ERR_UNKNOWN_BUILTIN_MODULE` for `node:quic`); `/quic` fails closed |
| Symmetric CGNAT / Multi-Relay Failover | **`INTEGRATION VERIFIED`** (loopback + multi-relay) | Real LTE/5G carrier CGNAT behind operator firewalls (**`NOT VERIFIED`**) |
| LAN UDP mDNS (`sovra-mdns-v1`) | **`INTEGRATION VERIFIED`** | Separate physical phones/laptops across hardware Wi-Fi router (**`NOT VERIFIED`**) |
| Physical Mobile BLE & Wi-Fi Direct | **`UNIT TEST VERIFIED`** (handover/loss state machine) | Physical Android/iOS hardware radios (**`NOT VERIFIED`**) |
| Distributed Storage, BitSwap, PoR & Replica Repair | **`INTEGRATION VERIFIED`** (local daemons + FS) | Multi-organization long-duration churn & repair across continents (**`NOT VERIFIED`**) |
| Multi-Process Pre-Coupled Founder Shutdown (`Section 27`) | **`INTEGRATION VERIFIED`** (4 OS child processes + `SIGKILL`) | `>= 3` independent organizations across public ASNs with DNS sinkhole (**`NOT VERIFIED`**) |
| Blind Push Transport (`HttpEndpointPushTransport`) | **`UNIT TEST VERIFIED`** (ephemeral local HTTP server) | Live FCM HTTP v1 / APNs HTTP/2 production tokens & wake-up delivery (**`NOT VERIFIED`**) |
| Mobile Bundle (`739,092` B) & Android Release `build.gradle` | **`UNIT TEST VERIFIED`** (esbuild bundle + static policy checks) | Full Android Gradle `./gradlew assembleRelease` + APK/IPA device installation (**`NOT VERIFIED`**) |
