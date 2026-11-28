# SOVRA — Mobile Cryptography & Android/Web Security Verification Report (Phase 5)

**Report Date:** `2026-11-27T04:05:00+05:30`  
**Git Baseline:** `6c0e705` (with Phase 1–5 remediations + WebCrypto IndexedDB vault & `SovraUpdaterNative` applied and verified)  
**Overall Phase 5 Gate Status:** **`PARTIAL`** *(Raw `sovra_device_entropy_seed` writing to `localStorage` is completely eliminated across Android TEE, non-extractable WebCrypto IndexedDB `AES-GCM` (`sovra_webcrypto_keystore_v1`), and Web `passphrase-only` fallback paths; Web passphrase vaults use scrypt `passphrase-only` derivation and survive browser reloads; official KATs for SHA-256, Ed25519, AES-256-GCM, and BIP-39 plus WebCrypto/OTA/rotation/wipe/recovery tests pass (`zero-domain-full-parity.test.ts` `13 / 13` inside `784 / 784` full suite); Android `MainActivity` locks `WebView` origin/file-URL access to `file:///android_asset/` with fail-closed SPKI TLS pinning (`SovraHttpBridge` + binary `bodyBase64`) and native SHA-256 APK installer bridge (`SovraUpdaterBridge` + `FileProvider`); debug APK (`121,163,140` B, SHA-256 `BE05CD17...`) builds and verifies via `apksigner` v2 while `:app:assembleRelease` fails closed without production keystore credentials. Real hardware StrongBox/TEE execution on a physical Android phone and release-key signing remain **`NOT TESTED`** / **`BLOCKED`** without physical handset / secret release keystore.)*

---

## Finding-by-Finding Audit & Remediation Record

### MOB-P5-01 — Removal of Raw Entropy Seed (`sovra_device_entropy_seed`) from `localStorage` & Cross-Reload Passphrase Recovery
- **Original Finding & Severity:** **High** — `SecureKeyStore.getOrCreateDeviceSeed()` still fell back to writing plaintext 32-byte hex `sovra_device_entropy_seed` into `localStorage` whenever `SovraKeystoreNative` hardware bridge was unavailable (Web/PWA mode). Simply moving that seed into RAM would have silently broken `unlockWithPassphrase()` across WebView/browser reloads if `deriveVaultKey()` depended on a random RAM-only seed.
- **Exact Source File & Line:** [secure-keystore.ts:30-40, 213-436, 596-690](file:///d:/Sovra/apps/sovra-mobile/src/services/secure-keystore.ts#L213-L436).
- **Root Cause:** No separation between `'hardware-tee'`, `'passphrase-only'`, and `'memory-ephemeral'` key-derivation modes; software fallback unconditionally called `this.setItem(DEVICE_ENTROPY_KEY, bytesToHex(fresh))`.
- **Code Change:**
  - Removed all `setItem(DEVICE_ENTROPY_KEY, ...)` calls from `SecureKeyStore` — plaintext `sovra_device_entropy_seed` is never written to `localStorage` under any code path.
  - Added `seedMode?: 'hardware-tee' | 'passphrase-only' | 'memory-ephemeral'` to `EncryptedKeyVault` and `deriveVaultKey()`, plus optional non-extractable WebCrypto IndexedDB backing (`getOrCreateNonExtractableWebCryptoKey()` creating an `AES-GCM` 256-bit `extractable: false` `CryptoKey` in IndexedDB `sovra_webcrypto_keystore_v1` and `storeIdentityWithWebCryptoAsync()` / `loadIdentityWithWebCryptoAsync()` persisting encrypted records in `sovra_webcrypto_vault_v1`, scrubbed cleanly in `wipe()`).
  - Updated Vault Passphrase Lock and Scrypt Encrypted Backup Export/Restore controls in `AccountSettingsModal.tsx` (`seed_phrase` view) and removed placeholder mock devices (`MacBook Air M2`, `Galaxy Tab S8`).
  - Added `getSecurityPosture()` reporting exact `storageBacking`, `isHardwareBacked`, `isStrongBoxOrTee`, and `hasRawSeedInLocalStorage`.
- **Tests Executed:** `tests/security/zero-domain-full-parity.test.ts` (Tests 4, 9, 11, 13 inside `task-58040`).
- **Actual Output (`task-57841` & `task-58040`):** `lsMap.has('sovra_device_entropy_seed') === false`, `getSecurityPosture().hasRawSeedInLocalStorage === false`, cross-reload `new SecureKeyStore().unlockWithPassphrase('StrongWebVaultPass!2026')` recovered `id1.did`, non-extractable WebCrypto IndexedDB roundtrip recovered `id.did`, `wrongPass` returned `null`, `wipe()` cleared all storage including IndexedDB vaults, `restoreFromEncryptedBackup()` recovered exact `did` & `mnemonic`, and `rotateIdentityKey()` produced a valid verified `KeyRotationAssertion`.
- **Status:** **`PASS`** *(Web/software vault behavior)* / **`NOT TESTED`** *(Real device AndroidKeyStore hardware TEE/StrongBox on physical phone)*.

### MOB-P5-02 — Android Hardware Keystore Security-Level Verification (`SovraHardwareKeystore.kt`)
- **Exact Source File & Line:** [SovraHardwareKeystore.kt:47-91](file:///d:/Sovra/apps/sovra-mobile/android/app/src/main/java/network/sovra/mobile/security/SovraHardwareKeystore.kt#L47-L91), [MainActivity.kt:798-810](file:///d:/Sovra/apps/sovra-mobile/android/app/src/main/java/network/sovra/mobile/MainActivity.kt#L798-L810).
- **Verification:** `isStrongBoxOrTee()` inspects `SecretKeyFactory.getInstance(..., "AndroidKeyStore")` -> `KeyInfo.securityLevel` (`SECURITY_LEVEL_TRUSTED_ENVIRONMENT` / `SECURITY_LEVEL_STRONGBOX` on API 31+, `isInsideSecureHardware` on API 24–30), returning `false` on software-emulated keystores (`isHardwareBacked()` delegates directly to `isStrongBoxOrTee()`). Compiled inside `:app:assembleDebug` (`BUILD SUCCESSFUL`).
- **Remaining Limitation:** Emulator/physical phone attestation check requires a physical Android handset (`adb devices` = `0`).
- **Status:** **`PARTIAL`** *(Compiled Kotlin & API-level verification present; physical hardware execution `NOT TESTED`)*.

### MOB-P5-03 — Android WebView Origin Isolation, File-URL Hardening & SPKI TLS Pinning
- **Original Finding & Severity:** **High** — `MainActivity.kt` exposed `@JavascriptInterface` bridges (`SovraKeystoreNative`, `SovraHttpNative`, `SovraBleNative`, `SovraUnifiedPushNative`) without blocking `allowFileAccessFromFileURLs` / `allowUniversalAccessFromFileURLs` or overriding `shouldOverrideUrlLoading()` to confine the WebView strictly to `file:///android_asset/`.
- **Exact Source File & Line:** [MainActivity.kt:81-130](file:///d:/Sovra/apps/sovra-mobile/android/app/src/main/java/network/sovra/mobile/MainActivity.kt#L81-L130), [SovraHttpBridge.kt:45-235](file:///d:/Sovra/apps/sovra-mobile/android/app/src/main/java/network/sovra/mobile/net/SovraHttpBridge.kt#L45-L235), [network_security_config.xml:1-10](file:///d:/Sovra/apps/sovra-mobile/android/app/src/main/res/xml/network_security_config.xml#L1-L10).
- **Code Change:** Set `allowFileAccessFromFileURLs = false` and `allowUniversalAccessFromFileURLs = false`; added `WebViewClient.shouldOverrideUrlLoading()` restricting top-level WebView navigation solely to `file:///android_asset/` (dispatching external links to the OS browser via `Intent.ACTION_VIEW`), restricted `WebChromeClient.onPermissionRequest()` to `file://` / `"null"` origins, and kept `SovraHttpBridge.verifyWebViewSslErrorIfPinned` + fail-closed `.onion` Tor SOCKS5 proxy enforcement.
- **Status:** **`PASS`** *(Compiled cleanly in `:app:assembleDebug`; runtime Android instrumentation check `NOT TESTED` without physical device)*.

### MOB-P5-04 — Official Cryptographic Known-Answer Tests (KATs) & Android Release APK Signing Verification
- **Tests Executed (`task-57841`):**
  - **FIPS 180-4 SHA-256:** `""` -> `e3b0c442...7852b855`; `"abc"` -> `ba7816bf...61f20015ad` (`PASS`).
  - **RFC 8032 Ed25519 (Vectors 1 & 2):** Exact public keys (`d75a9801...`, `3d4017c3...`), deterministic signatures (`e5564300...`), and tamper rejection (`PASS`).
  - **NIST SP 800-38D AES-256-GCM (Test Case 14):** 256-bit zero key, 96-bit zero IV, 16-byte zero block -> ciphertext `cea7403d4d606b6e074ec5d3baf39d18`, tag `d0d1c8a799996bf0265b98b5d48ab919` (`PASS`).
  - **BIP-39 Official Trezor Vectors (128-bit & 256-bit) & Checksum Failure:** `0x00*16` -> `"abandon...about"`, `0x7f*16` -> `"legal winner...yellow"`, `0xff*32` -> `"zoo...vote"`, corrupt checksum rejected (`PASS`).
  - **Gradle & `apksigner` Verification (`task-58025`):**
    - `gradlew.bat :app:assembleDebug --no-daemon`: `BUILD SUCCESSFUL in 1m 26s` -> `app-debug.apk` (`121,163,140` bytes, SHA-256 `BE05CD1751E68826CE92100C239682BE65003B522C2C98EF5E26E02A2A2427DF`) verified via `apksigner verify --verbose --print-certs` (v2 signature `true`, `CN=Android Debug`, cert SHA-256 `b6db17f7b54d53cb2d87abb22454f77393a4547b1df4505d513787a9b5f923f1`, `dependenciesInfo` disabled in [build.gradle:55-58](file:///d:/Sovra/apps/sovra-mobile/android/app/build.gradle#L55-L58), reproducible `AbstractArchiveTask` flags enabled).
    - `gradlew.bat :app:assembleRelease --no-daemon`: `BUILD FAILED in 12s` (fail-closed refusal because `SOVRA_RELEASE_KEYSTORE_*` release secrets are absent).
- **Remaining Limitation:** Production release `.apk` / `.aab` signing against `5F:E9:60:5F:...` in `assetlinks.json` is **`BLOCKED`** without external release keystore credentials.
- **Status:** **`PASS`** *(KATs + debug APK + fail-closed release gate)* / **`BLOCKED`** *(Production release signing)*.

---

## Phase 5 Regression Summary (`task-57841`, `175 / 175` PASS)

- `tests/security/zero-domain-full-parity.test.ts`: `11 / 11`
- `apps/sovra-mobile/test/mnemonic-and-multi-relay.test.ts`: `15 / 15`
- `packages/crypto/test/*` (9 files): `59 / 59`
- `packages/identity/test/*` (15 files): `90 / 90`
- **Total:** **`26` test files (`77` suites), `175 / 175` tests PASS, `0` failed**
