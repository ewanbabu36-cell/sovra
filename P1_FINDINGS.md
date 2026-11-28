# SOVRA — P1 Audit Findings

---

### P1-01: Mobile App Production Bundle (`apps/sovra-mobile/dist/bundle.js`) Is an Empty 1,031-Byte Placeholder Shell
- **Severity:** **P1 — Product & Distribution Blocker**
- **File Path & Line References:** [apps/sovra-mobile/src/main.tsx:6-29](file:///d:/Sovra/apps/sovra-mobile/src/main.tsx#L6-L29), [apps/sovra-mobile/dist/bundle.js:1-2](file:///d:/Sovra/apps/sovra-mobile/dist/bundle.js#L1-L2), [apps/sovra-mobile/src/services/api.ts:79-95](file:///d:/Sovra/apps/sovra-mobile/src/services/api.ts#L79-L95)
- **Actual Code Evidence:** `apps/sovra-mobile/dist/bundle.js` measured at exact size **`1,031` bytes** on disk (`Get-Item`). Inspecting `apps/sovra-mobile/src/main.tsx` shows `initMobileApp()` only appends an empty `<div class="sovra-mobile-shell">` (`backgroundColor = '#000'`) and logs to console; none of the screens under `apps/sovra-mobile/src/screens/` or offline sync/mesh services are imported into `main.tsx`.
- **Expected Spec Requirement:** Part P Phase 7 & Section 19: functional Android/mobile client sharing identities, offline UI, and peer connectivity without placeholder shells.
- **Reproduction Steps:** Run `node --experimental-strip-types apps/sovra-mobile/build-mobile-bundle.ts` or read `apps/sovra-mobile/src/main.tsx` and inspect `apps/sovra-mobile/dist/bundle.js` (`1,031` B).
- **Impact:** Packaging Capacitor `dist/` into an APK produces a black blank screen (`<div class="sovra-mobile-shell">`) with zero interactive UI or P2P functionality.
- **Recommended Minimal Fix:** Mount the real React Native / Web hybrid root navigator (`BottomTabNavigator`, `FeedScreen`, `ChatsScreen`, onboarding & mesh services) in `apps/sovra-mobile/src/main.tsx`.
- **Required Regression Test:** Bundle size/DOM mount test verifying `initMobileApp(root)` renders interactive navigation and offline outbox controls.

---

### P1-02: Hardcoded Fallback Android Keystore Passwords & Suppressed Lint Failures in `build.gradle`
- **Severity:** **P1 — Release Security**
- **File Path & Line References:** [apps/sovra-mobile/android/app/build.gradle:20-37](file:///d:/Sovra/apps/sovra-mobile/android/app/build.gradle#L20-L37)
- **Actual Code Evidence:** Lines 21 & 23 retain fallback `"sovraSecure2026!"`, line 20 falls back to `"sovra-release-key.jks"`, line 29 sets `minifyEnabled = false`, and lines 35–36 set `abortOnError = false` and `checkReleaseBuilds = false`.
- **Expected Spec Requirement:** `IA-01 Section 8` & Master Spec Section 18: no embedded secrets/passwords and strict reproducible release verification.
- **Reproduction Steps:** Inspect `apps/sovra-mobile/android/app/build.gradle` lines 18–37.
- **Impact:** Local/misconfigured Gradle release invocations silently fall back to publicly known repo passwords and ignore lint errors.
- **Recommended Minimal Fix:** Fail release builds cleanly when `SOVRA_RELEASE_KEYSTORE_*` env vars are unset (do not fall back to literal strings) and enable `checkReleaseBuilds = true`.
- **Required Regression Test:** Gradle signing config test rejecting unsigned release builds when env vars are missing.

---

### P1-03: `rotateSovraIdentityEpoch` Ignores Supplied `newEncryptionPrivateKey` & Breaks Deterministic Vector 6
- **Severity:** **P1 — Cryptography / Interoperability Bug**
- **File Path & Line References:** [packages/identity/src/sovra-id.ts:401-422](file:///d:/Sovra/packages/identity/src/sovra-id.ts#L401-L422), [packages/identity/test/sovra-id-v1.test.ts:189](file:///d:/Sovra/packages/identity/test/sovra-id-v1.test.ts#L189)
- **Actual Code Evidence:** Both branches of `const nextEncPair = params.newEncryptionPrivateKey ? generateX25519KeyPair() : generateX25519KeyPair();` generate a random X25519 keypair, ignoring `params.newEncryptionPrivateKey`. Because `new_encryption_public_key` is included in `unsignedRotation`, `previous_key_signature` changes randomly every run (`73c66d... != 5c3a70...` in `task-55054`).
- **Expected Spec Requirement:** `IA-01 Section 3` formal deterministic test vector 6 (`key_rotation`) & `RFC SOVRA-ID-v1.md`.
- **Reproduction Steps:** Run `vitest run packages/identity/test/sovra-id-v1.test.ts` (`1/4` failed).
- **Impact:** Vector 6 in `RFC/IDENTITY/SOVRA-ID-v1.md` is currently non-reproducible and custom/deterministic rotation key inputs are silently discarded.
- **Recommended Minimal Fix:** Import `x25519` public key derivation (`getX25519PublicKey`) in `@sovra/crypto` and derive `publicKey` deterministically when `params.newEncryptionPrivateKey` is passed; regenerate Vector 6 once fixed.
- **Required Regression Test:** `packages/identity/test/sovra-id-v1.test.ts` Vector 6 passing deterministically across consecutive runs.

---

### P1-04: Naive Regex `/26657/` Breaks `dependency-boundaries.test.ts` Against `zk.ts` BN254 Scalar
- **Severity:** **P1 — Boundary Guard Defect**
- **File Path & Line References:** [tests/security/dependency-boundaries.test.ts:126-151](file:///d:/Sovra/tests/security/dependency-boundaries.test.ts#L126-L151), [packages/crypto/src/zk.ts:187](file:///d:/Sovra/packages/crypto/src/zk.ts#L187)
- **Actual Code Evidence:** Line 187 of `zk.ts` contains BN254 curve coordinate `'4252822878758300859123897981450591353533073413197771768651442665752259397132'`, matching `/26657/` -> `AUDIT_VITEST_RC=1` in `task-55054`.
- **Expected Spec Requirement:** Accurate AST/import boundary verification isolating `SOVRA-EXT-CONSENSUS` without false-positive regex collisions.
- **Reproduction Steps:** Run `vitest run tests/security/dependency-boundaries.test.ts`. Exit code `1` (`1/6` failed).
- **Impact:** Boundary suite fails falsely on a valid BN254 constant.
- **Recommended Minimal Fix:** Match actual RPC URL/port boundaries (`/:26657\b|http:\/\/[^'"\s]*:26657/`) rather than unanchored digits.
- **Required Regression Test:** `tests/security/dependency-boundaries.test.ts` passing `6/6`.

---

### P1-05: 10-Step P2P Validation Benchmark Fails Under Full Test Suite Execution (`153.39 <= 200 ops/sec`)
- **Severity:** **P1 — Performance Target Regression**
- **File Path & Line References:** [packages/p2p/test/benchmark.test.ts:14-44](file:///d:/Sovra/packages/p2p/test/benchmark.test.ts#L14-L44)
- **Actual Code Evidence:** Measured `153.39 ops/sec` (`< 200`) during full suite `task-55054` (while description claims `(>2,000 ops/sec)`).
- **Expected Spec Requirement:** Documented honest performance targets (`Section 22.1`) without misleading labels vs assertions.
- **Reproduction Steps:** Run full offline matrix via `run-suites.mjs`.
- **Impact:** Under full-process load, `EventValidationPipeline.validate` throughput drops below even the relaxed `200 ops/sec` floor (an order of magnitude below the `>2,000` title).
- **Recommended Minimal Fix:** Profile hot signature/JSON parsing in `EventValidationPipeline.validate` and reconcile benchmark test title with actual target budgets.
- **Required Regression Test:** `packages/p2p/test/benchmark.test.ts` passing reliably with realistic SLA target.

---

### P1-06: Legacy Founder Council & Stake-Weighted Governance Coexist with Token-Free `CommunityGovernanceEngine`
- **Severity:** **P1 — Constitutional Governance Contradiction**
- **File Path & Line References:** [packages/identity/src/governance/multi-party-approval.ts:52-85](file:///d:/Sovra/packages/identity/src/governance/multi-party-approval.ts#L52-L85), [packages/identity/src/governance/voting-engine.ts:28,99-108,192](file:///d:/Sovra/packages/identity/src/governance/voting-engine.ts#L28), [packages/identity/src/governance/founder-identity.ts:57-97](file:///d:/Sovra/packages/identity/src/governance/founder-identity.ts#L57-L97)
- **Actual Code Evidence:** `@sovra/identity` still exports `GENESIS_SECURITY_COUNCIL` (5 hardcoded council keys documented *"Bound to CometBFT consensus parameters"*), `stakeMicroSov` voting weights in `VotingEngine`, and single-founder milestone registry `FounderIdentityRegistry`.
- **Expected Spec Requirement:** `IA-01 Section 1 & 11`: isolate legacy blockchain/founder/token mechanisms into `SOVRA-EXT-CONSENSUS` or deprecate them so core governance remains strictly non-plutocratic and founder-free.
- **Reproduction Steps:** Inspect `packages/identity/src/governance/index.ts` exports.
- **Impact:** Downstream integrators importing `@sovra/identity` can inadvertently instantiate token-weighted or static-council governance paths.
- **Recommended Minimal Fix:** Isolate `Genesis` council & `stakeMicroSov` voting into an explicit `experimental/ext-consensus` namespace or mark `@deprecated` while making `CommunityGovernanceEngine` default.
- **Required Regression Test:** Boundary check verifying core apps/nodes use `CommunityGovernanceEngine` with `compulsoryTokenVoting === false`.

---

### P1-07: Messaging Push Wakeups Stubbed & Mobile HTTP Fallback Defaults
- **Severity:** **P1 — Mobile Background Delivery & Zero-Cloud Gap**
- **File Path & Line References:** [packages/messaging/src/blind-push.ts:96-112](file:///d:/Sovra/packages/messaging/src/blind-push.ts#L96-L112), [apps/ios/App/App/capacitor.config.json:2,17-20](file:///d:/Sovra/apps/ios/App/App/capacitor.config.json#L2), [apps/sovra-mobile/src/services/multi-relay-manager.ts:33-95](file:///d:/Sovra/apps/sovra-mobile/src/services/multi-relay-manager.ts#L33-L95)
- **Actual Code Evidence:** `BlindPushRelayServer.dispatchBlindSignal()` discards push payloads (`void { ... }`) and fabricates `fcm_msg_*` IDs; mobile defaults include `stun.l.google.com`, `stun.cloudflare.com`, `/dns4/node0.libp2p.io`, and `appId: "app.sovra.network"`. `apps/sovra-mobile/src/services/api.ts:87` defaults to `/api/feed/list` HTTP relay calls unless switched to local mesh/offline.
- **Expected Spec Requirement:** `Master Spec Section 10, 19` & `IA-01 Section 2, 4`: honest separation of vendor push dependencies (APNs/FCM) from P2P background polling, and zero mandatory Google/Cloudflare/founder-domain reliance.
- **Reproduction Steps:** Inspect `blind-push.ts`, `multi-relay-manager.ts`, and `api.ts`.
- **Impact:** Closed-app mobile push notifications do not actually wake devices over APNs/FCM, and stock mobile builds probe third-party STUN/HTTP endpoints unless configured offline.
- **Recommended Minimal Fix:** Replace mock push return IDs with explicit `UNCONFIGURED_PUSH_PROVIDER` or pluggable webhook/HTTP2 transport, and flip mobile defaults to local P2P/zero-domain first.
- **Required Regression Test:** Integration test verifying `BlindPushRelayServer` does not report synthetic `success: true` without configured push transport.
