# Stage 8 — Physical Android Hardware Certification Report

**Phase:** Stage 8 — Independent External Field Certification  
**Timestamp:** `2026-11-26T12:57:12+05:30`  
**Overall Section Status:** **`NOT TESTED`** *(Build toolchain exists on host, `adb devices -l` = `0` connected physical devices, release signing keystore env vars UNSET causing fail-closed Gradle exit `1`)*

---

## 1. Empirical Hardware, SDK & Build Verification

- **`adb devices -l` (`D:\Self-X\tools\platform-tools\adb.exe`):** Started daemon on `tcp:5037`; **`List of devices attached` = empty (`0` physical Android phones connected)**.
- **Host Android SDK & JDK (`2026-11-26T12:50:55+05:30`):**
  - `JAVA_HOME`: `C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot\`
  - Android SDK: `%LOCALAPPDATA%\Android\Sdk` (`build-tools/34.0.0`, `platforms`, `platform-tools`, `emulator`, `sources`), `gradlew.bat` present.
- **Release Signing Keystore Credentials Check:**
  - `SOVRA_RELEASE_KEYSTORE_FILE=UNSET`, `SOVRA_RELEASE_KEYSTORE_PASSWORD=UNSET`, `SOVRA_RELEASE_KEY_ALIAS=UNSET`, `SOVRA_RELEASE_KEY_PASSWORD=UNSET`.
  - Executed read-only `./gradlew.bat :app:assembleRelease --dry-run --no-daemon` (`task-55770`): **FAILED CLOSED as designed (`GRADLE_DRY_EXIT=1`)** at `build.gradle:29` with `Release builds require SOVRA_RELEASE_KEYSTORE_FILE, SOVRA_RELEASE_KEYSTORE_PASSWORD, SOVRA_RELEASE_KEY_ALIAS, and SOVRA_RELEASE_KEY_PASSWORD environment variables.`
- **Pre-Existing Stale APK Inspection (`2026-11-25`, Pre-Stage-5):**
  - `apps/sovra-mobile/android/app/build/outputs/apk/release/app-release.apk` (`44,653,583` bytes, timestamp `11/25/2026 8:10:22 AM`) contains only `assets/index.html` (`101,275` bytes) + `assets/dexopt/baseline.prof`, predates Stage 5 remediation (`739,092`-byte [apps/sovra-mobile/dist/bundle.js](file:///d:/Sovra/apps/sovra-mobile/dist/bundle.js) built `11/26/2026`), and does **not** constitute post-remediation signed APK evidence.

---

## 2. Finding Matrix (`Section 5`)

| Finding ID | Detailed Verification Record |
|---|---|
| **S8-MOB-01** | **Requirement ID:** `S8-SEC5-01` — Post-Stage-5 release APK build & signing check enforcement<br>**Test methodology:** Run `gradlew.bat :app:assembleRelease --dry-run --no-daemon` without hardcoded credentials and inspect existing APK contents read-only via `apksigner` + zip inspection<br>**Environment:** Windows host, JDK `17.0.20`, Android SDK `build-tools 34.0.0`, release env vars unset<br>**Actual execution evidence:** `task-55770` failed closed cleanly with `GRADLE_DRY_EXIT=1` at [build.gradle:29](file:///d:/Sovra/apps/sovra-mobile/android/app/build.gradle#L29); fresh release APK cannot be built without real release keystore credentials (`0` new APKs produced)<br>**Result:** **`BLOCKED`** *(Missing production `SOVRA_RELEASE_KEYSTORE_*` secrets by design; fails closed safely)*<br>**Evidence location:** `task-55770.log`, [build.gradle:18-50](file:///d:/Sovra/apps/sovra-mobile/android/app/build.gradle#L18-L50)<br>**Remaining limitations:** Real CI/operator release keystore needed to build post-Stage-5 release APK. |
| **S8-MOB-02** | **Requirement ID:** `S8-SEC5-02` — Real Android device installation, app startup, identity creation/import & Android Keystore/key persistence<br>**Test methodology:** `adb install` on physical hardware + interactive startup, mnemonic import/create & app restart key persistence<br>**Environment:** `adb devices -l` = `0` connected devices<br>**Actual execution evidence:** No device attached over USB/Wi-Fi ADB<br>**Result:** **`NOT TESTED`**<br>**Evidence location:** `adb devices -l` output (`List of devices attached` empty)<br>**Remaining limitations:** Requires physical Android smartphone with Developer Options/USB Debugging connected. |
| **S8-MOB-03** | **Requirement ID:** `S8-SEC5-03` — Physical Android BLE GATT discovery, Wi-Fi Direct NAN handover & offline flight-mode operation<br>**Test methodology:** Pair two physical Android phones in airplane mode (Wi-Fi/BLE only) running Sovra APK and transfer peer messages/media<br>**Environment:** `0` physical phones; in Node, `NativeMobileBleAdapter.isAvailable()` returns `false`<br>**Actual execution evidence:** Physical RF discovery not tested (`0` radio transfers executed)<br>**Result:** **`NOT TESTED`**<br>**Evidence location:** `adb devices -l` output<br>**Remaining limitations:** Real Android Doze, BLE MAC rotation, and OEM Wi-Fi Direct permission prompts remain unverified on silicon. |
| **S8-MOB-04** | **Requirement ID:** `S8-SEC5-04` — Android background Doze behavior, network switching (LTE <-> Wi-Fi) & process-kill state recovery<br>**Test methodology:** Background app under Doze / force-stop via `am force-stop`, switch networks, verify wake & SQLite/keychain recovery<br>**Environment:** `0` physical devices attached<br>**Actual execution evidence:** Not executed on device<br>**Result:** **`NOT TESTED`**<br>**Evidence location:** `adb devices -l` output<br>**Remaining limitations:** OS-level battery optimization, background WebSocket suspension, and cold-boot state restoration unverified on real OEM ROMs. |
