# SOVRA — M-of-N Decentralized Release Security Audit (AUDIT 6)

**Audit Date:** `2026-11-26T16:45:22+05:30`

---

## Release Security Verification Matrix

| Control Requirement | Implementation | Empirical Test Result | Classification |
|---|---|---|---|
| **M-of-N Threshold Signature Validation** | Canonical JSON + SHA-256 + Ed25519 (`verifySignedSoftwareRelease`) | `2-of-3` valid PASS (`validSigners.length: 2`); `1-of-3` rejected `403` | `PASS` |
| **Independent Signer Deduplication** | `verifiedSigners = new Set<string>()` ignores duplicate pubkeys | Submitting `sig1` twice for `threshold=2` rejected (`duplicateKeyRejected: true`) | `PASS` |
| **Key Revocation** | `revokedSignerPubKeysHex` Set checked before signature add | Revoked signer `s1` signature invalidates quorum (`revokedSignerRejected: true`) | `PASS` |
| **Replay & Anti-Rollback Protection** | `compareSemver(manifest.version, policy.currentVersion) <= 0` + `protocolVersion` check | Updating `2.1.0` when `currentVersion='2.1.0'` rejected (`antiRollbackRejected: true`) | `PASS` |
| **Artifact Binary Tamper Resistance** | `byteLength` + `sha256(artifactBytes)` check when binary provided | 1-byte tamper rejected (`tamperedArtifactRejected: true`) | `PASS` *(When `artifactBytes` supplied)* |
| **Multi-Operator Mirror Diversity** | `verifyIndependentUpdateMirrors` enforces `minIndependentOperators >= 2` | 1-operator mirror rejected; 2-operator mirror accepted | `PASS` |
| **`reproducibleBuild` Provenance & Mirror Endpoint Gap** | Metadata fields serialized under signature; **attestations NOT verified**; HTTP mirror stores JSON only | `build-mobile-bundle.ts` produces bit-for-bit identical SHA-256 (`803d2d5f...`) across runs; Android APK not tested across clean machines | `PARTIAL` |
| **In-App Decentralized Auto-Updater Client** | No Android/Desktop UI client calls `/api/releases/latest` -> downloads APK -> verifies binary SHA-256 | Inspected `apps/sovra-mobile/` & `enterprise-protocol.routes.ts` | `NOT IMPLEMENTED` |

---

## Detailed Findings

### REL-01: M-of-N Threshold Cryptography, Deduplication, Revocation & Anti-Rollback Work Correctly (`software-update.ts`)
1. **Actual source code evidence:** `buildCanonicalReleasePayload()` hashes canonical JSON (`artifactCid`, lowercase `artifactSha256Hex`, `byteLength`, `issuedAt`, `minCompatibleVersion`, `mirrors`, `platform`, `protocolVersion`, `releaseNotes`, `reproducibleBuild`, `signerThreshold`, `version`). `verifySignedSoftwareRelease()` enforces `manifest.version > currentVersion`, `currentVersion >= minCompatibleVersion`, `protocolVersion >= currentProtocolVersion`, deduplicates pubkeys via `verifiedSigners` Set, drops keys in `revokedSignerPubKeysHex`, and checks `sha256(artifactBytes)` & `byteLength` when supplied.
2. **Exact file and line references:** [software-update.ts:76-235](file:///d:/Sovra/packages/crypto/src/software-update.ts#L76-L235), [enterprise-protocol.routes.ts:901-971](file:///d:/Sovra/scripts/routes/enterprise-protocol.routes.ts#L901-L971).
3. **Actual runtime test:** Ran `runAudit6Release()` (`audit-empirical-results.json`), `packages/protocol/test/cbor-sovra-evt-nodedb.test.ts` (`5/5 PASS`), and `tests/security/zero-domain-full-parity.test.ts` Test 4 & Test 5 (`5/5 PASS`).
4. **Expected result:** `2-of-3` valid passes; duplicate signatures, revoked keys, equal/older versions, tampered binary bytes, and single-operator mirrors all fail closed.
5. **Observed result:** All checks matched expected fail-closed behavior (`valid2of3.valid: true`, `duplicateKeyRejected: true`, `revokedSignerRejected: true`, `antiRollbackRejected: true`, `tamperedArtifactRejected: true`, `singleMirrorRejected: true`, `twoMirrorsAccepted: true`).
6. **Remaining dependency:** Maintainer quorum key ceremonies outside dev/test environments.
7. **Remediation required:** Publish real M-of-N maintainer public keys (with community governance policy) in client binary defaults.

### REL-02: `reproducibleBuild.builderAttestations` Signatures Are Unverified Metadata; Mirror Does Not Host Verified Binary Stream
1. **Actual source code evidence:** `ReproducibleBuildProvenance.builderAttestations` is included in `buildCanonicalReleasePayload()`, so maintainers attest to it symbolically, **however** `verifySignedSoftwareRelease()` never cryptographically verifies individual builder attestations (`lines 89, 189-205`). Likewise `POST /api/releases/publish` (`enterprise-protocol.routes.ts:920-951`) verifies and stores only the JSON manifest (not the `.apk` artifact bytes themselves), and `apps/sovra-mobile` has **no built-in updater client** fetching `/api/releases/latest`, downloading the APK from BitSwap/P2P mirrors, and invoking `verifySignedSoftwareRelease(..., artifactBytes)`.
2. **Exact file and line references:** [software-update.ts:20-24, 89, 189-205](file:///d:/Sovra/packages/crypto/src/software-update.ts#L20-L24), [enterprise-protocol.routes.ts:920-971](file:///d:/Sovra/scripts/routes/enterprise-protocol.routes.ts#L920-L971).
3. **Actual runtime test:** Inspected `software-update.ts` + tested two consecutive runs of `apps/sovra-mobile/build-mobile-bundle.ts` (`runAudit6Release()`).
4. **Expected result:** JS mobile bundle should compile reproducibly across builds; full APK reproducibility & end-to-end auto-update verification require deterministic Gradle APK packaging + in-app verifier.
5. **Observed result:** `apps/sovra-mobile/build-mobile-bundle.ts` produced **bit-for-bit reproducible** SHA-256 `803d2d5fcd2e3ed76da956738d16e0beac397311ab044a33ba289919b6a6fa2e` across consecutive builds (`mobileBundleReproducibleBitForBit: true`), whereas APK-level cross-host deterministic build & in-app APK updater execution are **`NOT TESTED` / `NOT IMPLEMENTED`**.
6. **Remaining dependency:** Deterministic APK packaging config (normalized ZIP timestamps/Gradle buildflags) + Android `PackageInstaller` intent + in-app P2P mirror fetcher.
7. **Remediation required:** Add in-app update checker that fetches `/api/releases/latest` from >=2 independent community relays, downloads the APK bytes over P2P/HTTP, verifies `verifySignedSoftwareRelease(manifest, policy, apkBytes)` client-side before prompting install, and verify Android APK ZIP timestamp normalization (`archiveFileTime`/deterministic DEX).
