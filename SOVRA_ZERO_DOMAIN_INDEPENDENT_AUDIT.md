# SOVRA — Independent Zero-Domain Architecture Reality Audit (AUDIT 1)

**Audit Date:** `2026-11-26T16:45:22+05:30`  
**Methodology:** Whole-repository automated regex scan (`audit1-scan.mjs`, excluding `node_modules`, `dist`, `build`, `.git`, `.gradle`, `*.map`) across `packages/`, `apps/`, `nodes/`, `scripts/`, `services/`, `public/`, `deploy/`, `docker/`, `chain/`, `.github/`, paired with direct source inspection and isolated runtime execution.

---

## Whole-Repository Zero-Domain Scan Inventory (`audit1-domain-scan.json`)

| Scan Category | Total Repo Matches | Non-Test/Non-Deploy Runtime Hits | Primary Runtime Files & Verdict |
|---|---|---|---|
| **`sovra.network` / `.sovra.network`** | `91` | `69` hits (`24` files) | `PARTIAL` *(Gated in daemon core; active in `AndroidManifest.xml`, `apps/ios`, `twa-manifest.json`, `views/`, `bootstrap-seeds.ts`, `multi-relay-manager.ts`, `chain/genesis*.json`)* |
| **`/dns*` Multiaddrs** | `16` | `12` hits (`6` files) | `PARTIAL` *(Filtered when `enableDnsFallback=false` on daemons; unconditional `/dns4/node0.libp2p.io` leak in `MultiRelayManager.getPublicDhtSeeds()`)* |
| **Public STUN/TURN** | `29` | `25` hits (`8` files) | `FAIL` (Mobile `MultiRelayManager`) / `PARTIAL` (`dev-server.ts` omits `openrelay` by default, still returns Google/Cloudflare/Twilio STUN) |
| **External Push (`ntfy.sh`, APNs, FCM)** | `3` | `3` hits (`2` files) | `PASS` (`ntfy.sh` disabled, APNs fail-closed `503`) / `NOT TESTED` (physical Doze / UnifiedPush app) |
| **External Web3/IPFS Gateways** | `1` | `1` hit (`enterprise-protocol.routes.ts:1801`) | `PARTIAL` *(Gated off in default zero-domain mode; legacy EVM/Solana/Arweave routes generate synthetic hashes)* |
| **Hardcoded Non-Loopback IPs** | `137` | `31` hits (`14` files) | `FAIL` (`MultiRelayManager` lines 80,87 Google `142.250.190.46`, Cloudflare `104.16.132.229`; `layout.view.ts` `192.168.31.*`/`10.42.22.224`) |

---

## Detailed Findings

### ZD-01: `MultiRelayManager` Leaks Third-Party STUN & `/dns4/node0.libp2p.io` Despite `zeroDomainOnly = true`
1. **Actual source code evidence:** While `getEligibleRelays()` excludes `https://seed1.sovra.network` and `https://seed2.sovra.network` when `zeroDomainOnly === true`, `getStunServers()`, `getPublicDhtSeeds()`, `getRtcIceServers()`, `isAutonomousSwarmReady()`, and `getAutonomousMeshStatus()` unconditionally return `HARDCODED_FREE_STUN_SERVERS` (Google/Cloudflare/Mozilla) and `HARDCODED_PUBLIC_DHT_SEEDS` (`142.250.190.46:19302`, `104.16.132.229:3478`, `/dns4/node0.libp2p.io/tcp/443/wss`).
2. **Exact file and line references:** [multi-relay-manager.ts:33-98, 122-141, 586-631](file:///d:/Sovra/apps/sovra-mobile/src/services/multi-relay-manager.ts#L33-L98).
3. **Actual runtime test:** Loaded `apps/sovra-mobile/src/services/multi-relay-manager.ts` cleanly via esbuild and called `mgr.isZeroDomainOnly()`, `mgr.getStunServers()`, `mgr.getPublicDhtSeeds()`.
4. **Expected result:** Under `zeroDomainOnly = true`, zero third-party Google/Cloudflare/Mozilla STUN or `/dns4/` seeds should be emitted unless explicitly opted in.
5. **Observed result:** `multiRelayZeroDomainFlag: true`, **`multiRelayStunCountReturnedDespiteZeroDomain: 4`**, **`multiRelayDhtDnsSeedsReturnedDespiteZeroDomain: ["142.250.190.46:19302", "104.16.132.229:3478", "/dns4/node0.libp2p.io/tcp/443/wss"]`** -> **FAIL**.
6. **Remaining dependency:** Self-hosted volunteer node STUN (`startLocalStunServer`) or zero-cloud host-candidate ICE (`[]`) + community `.onion`/IPv4/IPv6 seeds.
7. **Remediation required:** Gate `getStunServers()`, `getPublicDhtSeeds()`, and `getRtcIceServers()` on `!this.zeroDomainOnly` (returning only operator-supplied STUN/DHT seeds from `importBootstrapUrls()` / local node `/api/seeds` when zero-domain mode is active).

### ZD-02: `dev-server.ts` & `webrtc-config.ts` Default to Third-Party Public STUN When Override Env Is Unset
1. **Actual source code evidence:** `dev-server.ts` `getIceServers()` suppresses `openrelay.metered.ca` TURN by default (`!allowThirdPartyTurn`), **but** still returns `defaultStunServers` (`stun.l.google.com`, `stun1.l.google.com`, `stun2.l.google.com`, `stun.cloudflare.com`, `global.stun.twilio.com`) unless `SOVRA_STUN_SERVERS` is set. `webrtc-config.ts` exports `SOVRA_REGIONAL_TURN_SERVERS` referencing `turn-*.sovra.network`.
2. **Exact file and line references:** [dev-server.ts:2024-2072](file:///d:/Sovra/scripts/dev-server.ts#L2024-L2072), [webrtc-config.ts:34-77](file:///d:/Sovra/scripts/webrtc-config.ts#L34-L77).
3. **Actual runtime test:** Checked `getIceServers()` in `tests/e2e/production-turn-ice-servers.test.ts` (asserting Google STUN presence by default) and `tests/security/zero-domain-full-parity.test.ts` Test 5 (asserting `openrelay.metered.ca` exclusion).
4. **Expected result:** Pure zero-cloud node defaults should either bind a local node UDP STUN port (`startLocalStunServer`) and inject that STUN endpoint or omit external Google/Cloudflare/Twilio STUN unless opted in.
5. **Observed result:** `openrelay.metered.ca` is disabled by default (`PASS`), while public Google/Cloudflare/Twilio STUN still returns by default (`PARTIAL`).
6. **Remaining dependency:** `tests/e2e/production-turn-ice-servers.test.ts:23` currently asserts `stun.l.google.com` unless `SOVRA_NO_DNS=true` mode is tested separately.
7. **Remediation required:** When `SOVRA_NO_DNS !== 'false'`, return local node STUN (when enabled) or `[]` from `getIceServers()` unless `SOVRA_ALLOW_PUBLIC_STUN === 'true'`, and update E2E expectations accordingly.

### ZD-03: Zero Non-Loopback Default Seeds Available on Clean Installation Without DNS
1. **Actual source code evidence:** `GLOBAL_DEFAULT_SEEDS` & `GLOBAL_DEFAULT_RELAYS` hold only `/dns4/*.sovra.network` addresses plus `/ip4/127.0.0.1/tcp/4001/p2p/...`. `bootstrap-node.ts` filters out `/dns` when `enableDnsFallback === false`.
2. **Exact file and line references:** [bootstrap-seeds.ts:20-90, 142-153](file:///d:/Sovra/packages/p2p/src/bootstrap-seeds.ts#L20-L90), [bootstrap-node.ts:235, 306, 419-423, 718-719](file:///d:/Sovra/scripts/bootstrap-node.ts#L419-L423).
3. **Actual runtime test:** Started `startVolunteerNodeDaemon({ role: 'relay', dataDir: tmpClean, p2pPort: 0, httpPort: 0 })` without `--peers`.
4. **Expected result:** Clean node has zero DNS resolution (`PASS`), and zero WAN peers until fed an IP, `.onion`, QR, signed seed bundle, or mDNS peer (`FAIL` for autonomous WAN bootstrap parity with Bitcoin/BitTorrent).
5. **Observed result:** `zeroDomainDefaultSeeds` contained `["/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWFttriL8bpBR4xjjG6wHZDvM49zVmcJgneyCZaanXSyAX"]`; `nClean.getPeerBook().length === 0`.
6. **Remaining dependency:** At least one community-run seed IP/Tor `.onion` address or signed `SignedBootstrapBundle` distributed out-of-band.
7. **Remediation required:** Maintain an open community-signed `bootstrap-bundle.json` containing multiple independent operator raw IPv4/IPv6 and `.onion` v3 addresses and enable mDNS by default on LANs.

### ZD-04: Android WebView Origin (`file://`), Self-Signed TLS, Legacy CORS & View Template Domain Remnants
1. **Actual source code evidence:**
   - Android `MainActivity.kt` loads `file:///android_asset/index.html` (`Origin: null`), `AndroidManifest.xml` lacks `usesCleartextTraffic="true"` while `capacitor.config.json` sets `"cleartext": false`, and `services/api` CORS explicitly rejects `Origin: null` (`security.middleware.ts:70`) while requiring `SOVRA_ZERO_DOMAIN_CORS=true` for raw IP/onion origins (`line 83`).
   - Hardcoded `sovra.network` UI strings, sample contacts, DeepLink App Links (`AndroidManifest.xml:69-70`), TWA manifest (`apps/twa/twa-manifest.json`), iOS `appId` (`apps/ios/App/App/capacitor.config.json:2`), offline fallback stub peer (`apps/sovra-mobile/src/services/api.ts:884`), stale LAN IP hints (`scripts/views/layout.view.ts:2245-2247, 12664`), and synthetic EVM/Solana/Arweave stubs (`scripts/routes/enterprise-protocol.routes.ts:1669, 1762, 1794-1857`) remain in runtime files.
   - `chain/cmd/sovrad/static/sovra.bundle.js` still embeds an un-updated static bundle containing older STUN references.
2. **Exact file and line references:** [MainActivity.kt:91-95, 209](file:///d:/Sovra/apps/sovra-mobile/android/app/src/main/java/network/sovra/mobile/MainActivity.kt#L91-L95), [AndroidManifest.xml:65-71](file:///d:/Sovra/apps/sovra-mobile/android/app/src/main/AndroidManifest.xml#L65-L71), [capacitor.config.json:5-8](file:///d:/Sovra/apps/sovra-mobile/capacitor.config.json#L5-L8), [security.middleware.ts:67-89](file:///d:/Sovra/services/api/src/middleware/security.middleware.ts#L67-L89), [api.ts:884-886](file:///d:/Sovra/apps/sovra-mobile/src/services/api.ts#L884-L886), [enterprise-protocol.routes.ts:1669-1857](file:///d:/Sovra/scripts/routes/enterprise-protocol.routes.ts#L1669-L1857).
3. **Actual runtime test:** `audit1-scan.mjs` repo scan + `phase12-cors-validation.test.ts` (`PASS`) + direct WebView/Manifest inspection (`adb` = `0` devices so on-device WebView HTTPS/cleartext fetch is `NOT TESTED`).
4. **Expected result:** Android APK should communicate seamlessly with IP/self-signed/Tor volunteer nodes without DNS or commercial CA certs.
5. **Observed result:** APK loads offline `file:///android_asset/index.html` (`PASS`), whereas fetching remote HTTP (`cleartext: false`), self-signed HTTPS IPs (no SPKI cert pinner in `MainActivity.kt`), or `.onion` HTTP (no Tor proxy in Android OkHttp/WebView) is **`PARTIAL / BLOCKED`** in live WAN use.
6. **Remaining dependency:** Native OkHttp/Tor bridge in Android Kotlin with TOFU/SPKI certificate pinning, plus scrubbing remaining UI/view/chain-static legacy strings.
7. **Remediation required:** Add native Android `SovraHttpBridge` (`JavascriptInterface`) supporting optional SOCKS5 Tor proxy (`127.0.0.1:9050`) and SPKI-pinned self-signed TLS certs, rebuild `chain/cmd/sovrad/static/sovra.bundle.js`, and fail-close unconfigured EVM/Solana/Arweave stubs.
