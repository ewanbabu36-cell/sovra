# Google Play Store Release & Submission Readiness Checklist

## Generated & Verified Local Build Artifacts
- **Application ID (`applicationId`):** `network.sovra.mobile` (Companion TWA Manifest: `app.sovra.network`)
- **Signed Release APK:** `apps/sovra-mobile/android/app/build/outputs/apk/release/app-release.apk`
- **Signed Play Store Bundle (`.aab`):** `apps/sovra-mobile/android/app/build/outputs/bundle/release/app-release.aab`
- **Upload Keystore:** `apps/sovra-mobile/android/app/sovra-release-key.jks` (Alias: `sovra-upload`)
- **Verified Keystore SHA-256 Fingerprint:** `5F:E9:60:5F:17:55:F2:0A:9E:6C:F9:55:9D:3A:DF:B2:EC:88:23:25:18:32:9C:45:57:E4:66:A6:33:D6:2B:1C`
- **Digital Asset Links:** `public/.well-known/assetlinks.json` (contains exact SHA-256 fingerprint) + `<intent-filter android:autoVerify="true">` configured in `AndroidManifest.xml`.

## Remaining Actions Required in Google Play Console (User Account Only)
1. **Google Play App Signing Key Enrollment:**
   - Upload `apps/sovra-mobile/android/app/build/outputs/bundle/release/app-release.aab` to the **Internal Testing** or **Production** track in [Google Play Console](https://play.google.com/console).
   - Once Play App Signing is enrolled, copy the **Google-signed App Signing Key Certificate SHA-256 fingerprint** from *Setup -> App signing* and append it to `public/.well-known/assetlinks.json`.
2. **Rotate Keystore Secrets for CI/CD:**
   - Replace the dev keystore with a cold-stored production upload key and supply `SOVRA_RELEASE_KEYSTORE_FILE`, `SOVRA_RELEASE_KEYSTORE_PASSWORD`, `SOVRA_RELEASE_KEY_ALIAS`, and `SOVRA_RELEASE_KEY_PASSWORD` via CI environment secrets (never commit production keystores or Play service account keys).
3. **Store Listing & Policy Declarations:**
   - Complete the **Data Safety** form (Sovra stores keys client-side via Ed25519/BIP-39; E2EE Double Ratchet messages are encrypted end-to-end).
   - Provide privacy policy URL (`https://sovra.network/privacy`) and target API 35/36 if required by current Play Store annual deadline (`compileSdk`/`targetSdk` bump in `apps/sovra-mobile/android/app/build.gradle` when Play mandates next SDK level).
   - Supply `google-service-account.json` when using `eas submit --platform android`.
