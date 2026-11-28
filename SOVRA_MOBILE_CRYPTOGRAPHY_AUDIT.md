# SOVRA — Mobile Cryptography Independent Audit (AUDIT 5)

**Audit Date:** `2026-11-26T16:49:58+05:30`

---

## Cryptographic Primitive & Custody Verification Matrix

| Component | Algorithm / Mechanism | Test / KAT Executed | Observed Result | Verdict |
|---|---|---|---|---|
| **Browser/Mobile Shim SHA-256** | Synchronous pure-JS RFC 6234 `sha256Sync` inside `esbuild-node-shim.ts` | NIST FIPS 180-4 KATs (`""`, `"abc"`, `448-bit`, `1000*a`, `10^6*a`) + minified bundle check (`1116352408` = `0x428a2f98`) | **5/5 NIST KATs bit-for-bit PASS**; active in both `sovra-app` (`221,025` B) and `sovra-mobile` (`744,674` B) dist bundles | `PASS` |
| **BIP39 Seed Gen & Recovery** | 12/24-word entropy + SHA-256 checksum + `HKDF-SHA256` Ed25519 derivation | `packages/crypto/test/bip39.test.ts` (`12/12 PASS`) + direct `generateMnemonic`/`validateMnemonic`/`mnemonicToIdentity` | Deterministic DID, bad checksum rejected, passphrase domain-separated | `PASS` |
| **Ed25519 Signatures** | `@noble/curves/ed25519` + Node `crypto` fast-path | RFC 8032 Vector 1 (`9d61b19d...`, empty msg) | Exact signature & verify match (`sigMatch: true, verifyOk: true`) | `PASS` |
| **AES-256-GCM & ChaCha20-Poly1305** | Android `KeyStore` `AES/GCM/NoPadding` (`256-bit`, `128-bit` tag); JS `ChaCha20-Poly1305` (`@noble/ciphers`) w/ `HKDF`/`scrypt` | NIST AES-256-GCM Test Case (`00*32` key, `00*12` IV, `00*16` pt) + `SecureKeyStore` AEAD tamper checks | NIST AES-256-GCM **PASS** (`ct = cea7403d...`, `tag = d0d1c8a7...`); vault tamper rejected | `PASS` *(Software + Host)* |
| **Android Hardware Keystore** | `SovraHardwareKeystore.kt` `KeyGenParameterSpec` (`AES/GCM/NoPadding`) | Kotlin compiled in `app-debug.apk`; JS bridge mock test (`zero-domain-full-parity.test.ts` Test 4) | Compiles & JS mock wrap/unwrap passes; **physical TEE/StrongBox on real phone `NOT TESTED` (`adb` empty)** | `PARTIAL / NOT TESTED` (Device) |
| **Browser Non-Hardware Seed Custody** | `SecureKeyStore.getOrGenerateDeviceSeed()` fallback | Simulated browser `localStorage` without `SovraKeystoreNative` | **`sovra_device_entropy_seed` stored plaintext hex in same `localStorage` alongside vault** | `PARTIAL` *(Web XSS risk)* |
| **Protocol Identity Key Rotation & Backup** | `SovraIdentityModule.rotateKey()`, `exportBackup()`, `restoreBackup()` (`scrypt` + ChaCha20-Poly1305) | Epoch `1 -> 2` rotation + `verifySovraKeyEpochRotation` + encrypted backup restore | Epoch rotation & backup/restore **PASS** in `packages/identity`; **NOT exposed on mobile `SecureKeyStore`!** | `PARTIAL` *(Protocol PASS; Mobile UI/Store gap)* |
| **Android Release Signing** | `build.gradle` `signingConfigs.release` fail-closed env check | `apksigner verify --print-certs` on `app-debug.apk` + `:app:assembleRelease` w/o env secrets | Debug APK signed ONLY with **`CN=Android Debug`** (`b6db17f7...`); release build fails closed (`Exit 1`) | `BLOCKED` *(Keystore secrets unset)* |

---

## Detailed Findings

### CRYPT-01: Browser/Mobile SHA-256 Shim Now Uses Verified RFC 6234 Implementation (Passes NIST FIPS 180-4 KATs)
1. **Actual source code evidence:** `scripts/esbuild-node-shim.ts` intercepts `node:crypto`/`crypto` during esbuild bundling and implements `sha256Sync` (`SHA256_K` initial `0x428a2f98` = decimal `1116352408` in minified output). Earlier pre-remediation `'00'.repeat(32)` placeholder is gone from SHA-256 shim; note a separate `localNoiseXxKey: '0x00..00'` UI offline error fallback remains in `apps/sovra-mobile/src/services/api.ts:886`.
2. **Exact file and line references:** [esbuild-node-shim.ts:14-95](file:///d:/Sovra/scripts/esbuild-node-shim.ts#L14-L95), [api.ts:884-886](file:///d:/Sovra/apps/sovra-mobile/src/services/api.ts#L884-L886).
3. **Actual runtime test:** Extracted `cryptoShimContents` in `vm.runInNewContext` (`audit-empirical-battery.mjs` + `audit-ipv6-and-kat.mjs`) against 5 NIST FIPS 180-4 vectors and scanned both compiled `dist/bundle.js` files.
4. **Expected result:** Exact SHA-256 hex digest match for all 5 vectors and presence of minified `1116352408` (`0x428a2f98`) constant in both web and mobile bundles.
5. **Observed result:** All `5/5` NIST KATs (`empty`, `"abc"`, `448-bit`, `1000*'a'`, `1,000,000*'a'`) matched Node OpenSSL bit-for-bit (`match: true`); both `apps/sovra-app/dist/bundle.js` (`221,025` B) and `apps/sovra-mobile/dist/bundle.js` (`744,674` B) contain `1116352408`.
6. **Remaining dependency:** Notice `esbuild-node-shim.ts:68` `randomUUID()` falls back to `'uuid-' + Math.random()` if `crypto.randomUUID` is unavailable (insecure HTTP IP contexts), and `net.isIP()` shim (`line 109`) returns `0` unconditionally.
7. **Remediation required:** Implement `randomUUID()` fallback using `getRandomValues()` (RFC 4122 v4) instead of `Math.random()`, and implement real IPv4/IPv6 syntax checks inside `net.isIP()` shim.

### CRYPT-02: Web/Non-TEE Fallback Persists Both Vault & Wrapping Seed in Same `localStorage` + Mobile `SecureKeyStore` Lacks Key Rotation
1. **Actual source code evidence:**
   - On Android, `SovraHardwareKeystore.kt` uses `AndroidKeyStore` (`AES/GCM/NoPadding`, 256-bit key, 128-bit GCM tag) to wrap/unwrap `sovra_hw_wrapped_seed_v1`, and `SecureKeyStore.getOrCreateDeviceSeed()` scrubs `sovra_device_entropy_seed`. **However**, when `window.SovraKeystoreNative` is absent (desktop browser / iOS WebView), `SecureKeyStore` writes raw hex `sovra_device_entropy_seed` into `localStorage` alongside `sovra_secure_key_vault_v1` (`lines 343-351`).
   - Also `SovraHardwareKeystore.isHardwareBacked()` (`lines 44-51`) returns `true` whenever Android `KeyStore` generates an AES key — it does **not** verify `KeyInfo.isInsideSecureHardware` (`TEE`/`StrongBox` attestation), and `SecureKeyStore` has no epoch rotation wrapper matching `SovraIdentityModule.rotateKey()`.
2. **Exact file and line references:** [secure-keystore.ts:135-194, 309-352](file:///d:/Sovra/apps/sovra-mobile/src/services/secure-keystore.ts#L309-L352), [SovraHardwareKeystore.kt:25-75](file:///d:/Sovra/apps/sovra-mobile/android/app/src/main/java/network/sovra/mobile/security/SovraHardwareKeystore.kt#L25-L75), [sovra-id.ts:673-719](file:///d:/Sovra/packages/identity/src/sovra-id.ts#L673-L719).
3. **Actual runtime test:** Ran `SecureKeyStore` without `SovraKeystoreNative`, ran `SovraIdentityModule` epoch `1 -> 2` rotation + `scrypt` backup/restore, and verified `zero-domain-full-parity.test.ts` Test 4 HW mock.
4. **Expected result:** Browser custody should require an optional user passphrase (`scrypt` + WebCrypto non-extractable `CryptoKey` in IndexedDB), Android should verify `KeyInfo.isInsideSecureHardware`, and mobile should expose epoch key rotation.
5. **Observed result:** `browserStoresRawEntropyInLocalStorage: true`; `SovraIdentityModule` epoch rotate/backup `restoredIdMatch: true` (`epoch0: 1 -> epoch1: 2`), while `SecureKeyStore` has no rotation method; physical Android TEE execution is **`NOT TESTED`** (`adb` empty).
6. **Remaining dependency:** Physical Android hardware for `KeyInfo.isInsideSecureHardware` verification + user/CI keystore for release signing.
7. **Remediation required:** In Web/browser runtime, derive vault key via IndexedDB non-extractable AES-GCM `CryptoKey` (or mandatory user passphrase `scrypt`), verify `KeyInfo.isInsideSecureHardware` in `SovraHardwareKeystore.kt`, and wire `rotateSovraIdentityEpoch` + `exportEncryptedIdentityBackup` into mobile `SecureKeyStore`.

### CRYPT-03: Android APK Build Enforces Fail-Closed Release Signing Gate, Currently Signed Only with Debug Key
1. **Actual source code evidence:** `build.gradle` throws `GradleException` if `release`/`bundle` Gradle tasks run without `SOVRA_RELEASE_KEYSTORE_FILE`, `SOVRA_RELEASE_KEYSTORE_PASSWORD`, `SOVRA_RELEASE_KEY_ALIAS`, `SOVRA_RELEASE_KEY_PASSWORD`.
2. **Exact file and line references:** [build.gradle:18-48](file:///d:/Sovra/apps/sovra-mobile/android/app/build.gradle#L18-L48).
3. **Actual runtime test:** Verified `app-debug.apk` with Android SDK `apksigner.bat verify --print-certs` and invoked `:app:assembleRelease --no-daemon` without keystore env vars.
4. **Expected result:** Debug APK works locally with Android Debug cert; release builds fail closed until production keystore is provisioned.
5. **Observed result:** `apksigner` reported `Signer #1 certificate DN: C=US, O=Android, CN=Android Debug` (SHA-256 `b6db17f7...`), ZIP holds `classes.dex..classes6.dex` + `assets/{index.html,bundle.js,bundle.js.map}` (`121,102,705` B); `:app:assembleRelease` exited `1` failing closed on missing keystore env vars.
6. **Remaining dependency:** Offline M-of-N maintainer signing ceremony & Android release keystore provisioning + physical phone install test (`NOT TESTED`).
7. **Remediation required:** Provision offline hardware/airgapped Android release keystore in CI/release maintainers before distributing end-user APKs.
