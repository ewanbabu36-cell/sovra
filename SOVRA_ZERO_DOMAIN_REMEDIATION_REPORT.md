# SOVRA — Zero-Domain Purification Remediation Report (Phase 1)

**Report Date:** `2026-11-26T20:48:00+05:30`  
**Git Baseline:** `6c0e705` (with working-tree Phase 1 remediations verified prior to Phase 2)  
**Overall Phase 1 Gate Status:** **`PARTIAL`** *(All zero-domain runtime DNS, STUN, TURN, and UI leaks are purified and verified `100/100` passing in automated tests with `0` DNS lookups; autonomous cold-start WAN connectivity without an out-of-band community IP/`.onion`/QR/seed bundle remains `BLOCKED` until long-lived community seed operators publish signed raw-IP / `.onion` bundles.)*

---

## Whole-Repository Domain/STUN/IP Scan Comparison (`audit1-scan.mjs`)

| Metric | Pre-Phase-1 Baseline | Post-Phase-1 Runtime State | Notes |
|---|---|---|---|
| `sovra.network` matches (`runtime`) | `69` (`24` files) | `51` (`21` files) | Remaining hits are reverse-DNS app IDs (`app.sovra.network`), genesis JSON snapshots (`chain/genesis*.json`), deploy/verification helpers (`deploy-production-vps.sh`, `verify-dns-ssl.ts`), gated fallback arrays (`bootstrap-seeds.ts`, `multi-relay-manager.ts`), passive UI RTMP value (`layout.view.ts:7938` required by `creator-studio-parity.test.ts:400`), and opt-in `DEFAULT_PRODUCTION_ORIGINS` (`security.middleware.ts:27`) |
| `publicStunTurn` defaults | Unconditional in `MultiRelayManager`, `SOVRA_RTC_CONFIGURATION`, `WatchScreen.tsx`, `scripts.view.ts` | Default `[]` (`0` Google/Cloudflare/Mozilla/Twilio/openrelay servers returned when zero-domain is active) | Opt-in only via `setZeroDomainOnly(false)` / `SOVRA_ALLOW_PUBLIC_STUN=true` / `SOVRA_ENABLE_PUBLIC_TURN=true` |
| `hardcodedIp` UI/runtime leaks | Included `192.168.31.144/189/202` and `10.42.22.224` in HTML templates | Scrubbed from UI templates | Remaining IP literals are documented test/mask constants (`chameleon.ts`, `wifi-adapters.ts`, `nat.ts`) or opt-in `HARDCODED_PUBLIC_DHT_SEEDS` |

---

## Finding-by-Finding Audit & Remediation Record

### ZD-P1-01 — `MultiRelayManager` Leaked Public STUN, `/dns4/node0.libp2p.io`, and Google/Cloudflare IPs Under `zeroDomainOnly = true`
- **Original Finding & Severity:** `ZD-01` (**High**) — Even with `zeroDomainOnly = true`, `MultiRelayManager.getStunServers()`, `getPublicDhtSeeds()`, `getRtcIceServers()`, `isAutonomousSwarmReady()`, and `getAutonomousMeshStatus()` returned Google/Cloudflare/Mozilla STUN servers, `142.250.190.46:19302`, `104.16.132.229:3478`, and `/dns4/node0.libp2p.io/tcp/443/wss`.
- **Exact Source File & Line:** [multi-relay-manager.ts:27, 783-853](file:///d:/Sovra/apps/sovra-mobile/src/services/multi-relay-manager.ts#L783-L853), [WatchScreen.tsx:524-536](file:///d:/Sovra/apps/sovra-mobile/src/screens/WatchScreen.tsx#L524-L536), [chat-webrtc.ts:20-38](file:///d:/Sovra/apps/sovra-app/src/modules/chat-webrtc.ts#L20-L38).
- **Root Cause:** Methods read static `HARDCODED_FREE_STUN_SERVERS` and `HARDCODED_PUBLIC_DHT_SEEDS` directly without checking `this.zeroDomainOnly`.
- **Code Change:** Updated `getStunServers()`, `getPublicDhtSeeds()`, `getRtcIceServers()`, `isAutonomousSwarmReady()`, and `getAutonomousMeshStatus()` in `multi-relay-manager.ts` to check `this.zeroDomainOnly` (`true` by default): in zero-domain mode they return **only** operator/peer-configured custom STUN (`sovra_custom_stun_v1`) and zero-domain IP/`.onion` relays (`[]` when none configured). Wired `WatchScreen.tsx` & `chat-webrtc.ts` to prefer zero-domain ICE config (`[]` default, or `sovra_custom_stun_v1`), and added `setZeroDomainOnly(false)` explicit opt-in framing to legacy Section 4 of `mnemonic-and-multi-relay.test.ts` plus a strict default Section 5.
- **Tests Executed:**
  - `apps/sovra-mobile/test/mnemonic-and-multi-relay.test.ts`
  - `tests/security/zero-domain-full-parity.test.ts`
- **Actual Output (`task-57481`):**
  - `mnemonic-and-multi-relay.test.ts`: **`15/15 PASS`** (confirms `new MultiRelayManager()` defaults to `isZeroDomainOnly() === true`, `getStunServers() === []`, `getRtcIceServers() === []`, zero `/dns4/` or third-party IPs in `getPublicDhtSeeds()`, and accepts custom LAN/self-hosted STUN via `addCustomStunServer`).
- **Status:** **`PASS`** *(Runtime leak eliminated; opt-in fallback still available only when explicitly enabled via `setZeroDomainOnly(false)`).*

### ZD-P1-02 — Unconditional Third-Party STUN / TURN / `*.sovra.network` Leakage in `webrtc-config.ts`, `webrtc.routes.ts`, and `dev-server.ts`
- **Original Finding & Severity:** `ZD-02` (**High**) — `SOVRA_RTC_CONFIGURATION` unconditionally exported `SOVRA_DEFAULT_STUN_SERVERS` (Google, Cloudflare, Mozilla) + `openrelay.metered.ca` TURN into `/api/webrtc/config` and HTML `window.SOVRA_RTC_CONFIGURATION`, `getWebRtcConfiguration()` emitted `*.sovra.network` TURN without explicit zero-cloud suppression, and `dev-server.ts` left `SOVRA_NO_DNS` undefined at live startup.
- **Exact Source File & Line:** [webrtc-config.ts:75-167](file:///d:/Sovra/scripts/webrtc-config.ts#L75-L167), [webrtc.routes.ts:30-38](file:///d:/Sovra/scripts/routes/webrtc.routes.ts#L30-L38), [dev-server.ts:2024-2075, 2130-2134, 10384-10395](file:///d:/Sovra/scripts/dev-server.ts#L2024-L2075).
- **Root Cause:** Static constant `SOVRA_RTC_CONFIGURATION` bypassed zero-domain guards; `getWebRtcConfiguration()` ignored `SOVRA_NO_DNS !== 'false'`; `startDevServer()` did not default `SOVRA_NO_DNS = 'true'` at daemon launch.
- **Code Change:** Gated `SOVRA_DEFAULT_TURN_SERVERS`, `SOVRA_RTC_CONFIGURATION`, and `getWebRtcConfiguration()` on `zeroDomainDefault` (`SOVRA_NO_DNS !== 'false'`), returning `iceServers: []` unless `SOVRA_STUN_SERVERS`, `SOVRA_TURN_SERVERS`, `SOVRA_ALLOW_PUBLIC_STUN=true`, or `zeroCloudMode: false` is supplied; switched `/api/webrtc/config` in `webrtc.routes.ts` to call `getWebRtcConfiguration(principal?.did)` dynamically; defaulted `process.env.SOVRA_NO_DNS = 'true'` inside `startDevServer()` when `SOVRA_ALLOW_DNS !== 'true'`; replaced `https://sovra.network/errors/route-not-found` with `/errors/route-not-found` in `dev-server.ts`.
- **Tests Executed:**
  - `tests/security/zero-domain-full-parity.test.ts` (Test 9)
  - `tests/e2e/production-turn-ice-servers.test.ts`
  - `tests/integration/multi-region-seed-mesh.test.ts`
- **Actual Output (`task-57481`):**
  - `zero-domain-full-parity.test.ts` (`9/9 PASS`): verified `SOVRA_RTC_CONFIGURATION.iceServers === []` and `getWebRtcConfiguration({ userDid: 'did:key:z6MksPhase1Test' }).iceServers === []`.
  - `production-turn-ice-servers.test.ts` (`4/4 PASS`) & `multi-region-seed-mesh.test.ts` (`3/3 PASS`, with `verify-dns-ssl.ts:109` explicitly opting in via `zeroCloudMode: false`).
- **Status:** **`PASS`**

### ZD-P1-03 — Clean Cold-Start Without DNS, Domain, or Central Bootstrap Server
- **Original Finding & Severity:** `ZD-03` (**Medium-High**) — `GLOBAL_DEFAULT_SEEDS` without `/dns*` contains only `/ip4/127.0.0.1/tcp/4001/p2p/...`, so an internet cold start without DNS or out-of-band peers starts with an empty routing table.
- **Exact Source File & Line:** [bootstrap-seeds.ts:20-61, 142-153](file:///d:/Sovra/packages/p2p/src/bootstrap-seeds.ts#L20-L153), [volunteer-node.ts:45-51](file:///d:/Sovra/scripts/volunteer-node.ts#L45-L51).
- **Root Cause:** Intentional avoidance of hardcoded centralized seed IPs owned by a founder; without published community operator raw-IP/`.onion` seed bundles, a clean WAN installation requires one out-of-band seed input (signed bundle JSON, CLI `--peers`/`--seed-registry`, QR `sovra://peer-pex/v1`, `.onion`, or LAN mDNS).
- **Code Change:** Preserved `getZeroDomainBootstrapMultiaddrs([], false)` strict `/dns*` filtering (verified against `dns.lookup` spy), kept signed community seed registry support (`parseSignedBootstrapRegistryJson`, `--seed-registry`, `--export-seed-bundle`), and verified clean two-node cold-start with `enableDnsFallback: false, enableMdns: false` bootstrapping purely via `/api/seeds/bundle` + `/api/seeds/import` + Noise_XX dial with zero DNS lookups.
- **Tests Executed:** `tests/security/zero-domain-full-parity.test.ts` (Tests 2 & 9), `tests/integration/zero-domain-p2p-volunteer-mesh.test.ts` (`5/5 PASS`).
- **Actual Output (`task-57481`):**
  - Both cold-start nodes booted with `0` connections and `0` `.sovra.network` addresses; `dns.lookup` call count for non-loopback hostnames was strictly **`0`** during bundle import and Noise_XX TCP handshake (`dialRes.ok === true`).
- **Remaining Limitation:** Fresh installations cannot autonomously discover remote WAN peers over the public internet without either LAN mDNS or at least one community-operated IPv4/IPv6/`.onion`/QR seed supplied out-of-band (`BLOCKED` on live community operator seed deployment).
- **Status:** **`PARTIAL`** *(Cold-start zero-DNS bundle/IP/`.onion` bootstrap = `PASS`; unseeded public WAN discovery without external seeds = `BLOCKED` by nature of true decentralization without central servers).*

### ZD-P1-04 — UI View Templates, Mobile Screens, `AndroidManifest.xml` App Links, and CORS Distinction
- **Original Finding & Severity:** `ZD-04` (**Medium**) — UI HTML/JS views (`layout.view.ts`, `scripts.view.ts`), mobile screens (`ReelsScreen.tsx`, `SecuritySettingsScreen.tsx`), and `AndroidManifest.xml` (`android:autoVerify="true"` against `sovra.network`) contained leaked LAN IPs (`192.168.31.*`, `10.42.22.224`), fallback Google STUN/domain URLs, and manifest assetlinks verification pings.
- **Exact Source File & Line:** [AndroidManifest.xml:41-88](file:///d:/Sovra/apps/sovra-mobile/android/app/src/main/AndroidManifest.xml#L41-L88), [layout.view.ts:2245-2247, 2647, 5272, 7825, 10923, 12664](file:///d:/Sovra/scripts/views/layout.view.ts#L2244-L2248), [scripts.view.ts:30187, 30335, 44543-44562, 49276, 49313, 56003, 63619](file:///d:/Sovra/scripts/views/scripts.view.ts#L44543-L44562), [ReelsScreen.tsx:342](file:///d:/Sovra/apps/sovra-mobile/src/screens/ReelsScreen.tsx#L342), [SecuritySettingsScreen.tsx:42](file:///d:/Sovra/apps/sovra-mobile/src/screens/settings/SecuritySettingsScreen.tsx#L42), [security.middleware.ts:25-88](file:///d:/Sovra/services/api/src/middleware/security.middleware.ts#L25-L88).
- **Root Cause:** Pre-zero-domain frontend strings and manifest App Links persisted in static views and mobile components.
- **Code Change:** Removed `android:autoVerify="true"` HTTPS App Links to `sovra.network` in `AndroidManifest.xml` (retaining `sovra://` custom scheme), scrubbed `192.168.31.*` and `10.42.22.224` hardcoded LAN IPs and `https://sovra.network` UI URL fallbacks across `layout.view.ts`, `scripts.view.ts`, `ReelsScreen.tsx`, and `SecuritySettingsScreen.tsx`, and wired `scripts.view.ts` WebRTC initialization to check `sovra_custom_stun_v1` first (returning `[]` unless `SOVRA_ALLOW_PUBLIC_STUN === true`).
- **Tests Executed:**
  - `node --experimental-strip-types scripts/build-client-bundle.ts` (`sovra-app/dist/bundle.js` `221,288` B, synced to `chain/cmd/sovrad/static`)
  - `node --experimental-strip-types apps/sovra-mobile/build-mobile-bundle.ts` (`sovra-mobile/dist/bundle.js` `758,946` B, synced to Android assets)
  - `tests/e2e/modern-ui-ux.test.ts`, `tests/e2e/creator-studio-parity.test.ts`, `tests/security/phase12-cors-validation.test.ts`, `services/api/test/security.test.ts`
- **Actual Output (`task-57481`):**
  - `modern-ui-ux.test.ts`: **`26/26 PASS`**
  - `creator-studio-parity.test.ts`: **`18/18 PASS`**
  - `phase12-cors-validation.test.ts`: **`10/10 PASS`**
  - `security.test.ts`: **`10/10 PASS`**
- **Remaining Limitation:**
  - `layout.view.ts:7938` retains passive readonly input default `value="rtmp://live.sovra.network/live"` because `creator-studio-parity.test.ts:400` explicitly asserts that DOM attribute string (it triggers zero outbound network calls).
  - `app.sovra.network` / `network.sovra.mobile` remain as static reverse-DNS application identifiers in `apps/twa/twa-manifest.json`, `apps/ios/App/App/capacitor.config.json`, `public/.well-known/assetlinks.json`, and Kotlin package namespaces (`dev/packaging IDs`, not runtime DNS queries).
  - `services/api/src/middleware/security.middleware.ts:27` keeps `['https://sovra.network', 'https://app.sovra.network']` as production fallback only if both `SOVRA_ALLOWED_ORIGINS` is unset and `SOVRA_ZERO_DOMAIN_CORS` is not `'true'`.
- **Status:** **`PASS`** *(For runtime zero-domain behavior)* / **`PARTIAL`** *(For dev/compatibility identifiers intentionally preserved)*.

---

## Phase 1 Consolidated Regression Matrix (`task-57481`, Exit `0`)

| Suite File | Passed / Total | Status |
|---|---|---|
| `tests/security/zero-domain-full-parity.test.ts` | `9 / 9` | `PASS` |
| `apps/sovra-mobile/test/mnemonic-and-multi-relay.test.ts` | `15 / 15` | `PASS` |
| `tests/integration/zero-domain-p2p-volunteer-mesh.test.ts` | `5 / 5` | `PASS` |
| `tests/integration/multi-region-seed-mesh.test.ts` | `3 / 3` | `PASS` |
| `tests/e2e/production-turn-ice-servers.test.ts` | `4 / 4` | `PASS` |
| `tests/e2e/modern-ui-ux.test.ts` | `26 / 26` | `PASS` |
| `tests/e2e/creator-studio-parity.test.ts` | `18 / 18` | `PASS` |
| `tests/security/phase12-cors-validation.test.ts` | `10 / 10` | `PASS` |
| `services/api/test/security.test.ts` | `10 / 10` | `PASS` |
| **Total Phase 1 Suite** | **`100 / 100`** | **`PASS`** |
