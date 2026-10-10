# SOVRA — PRODUCTION REMEDIATION ROADMAP
**Audit Date:** October 8, 2026  
**Auditor:** Principal Software Architect & Lead Systems Engineer  
**Strategy:** Phased, actionable remediation plan addressing every finding without breaking existing architecture.  

---

## ROADMAP OVERVIEW

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──► Phase 6 ──► Phase 7 ──► Phase 8
Blockers    Security    Core User   Offline/BLE Media/WebRTC Mobile       Scale/Perf  Observability Physical RF
```

---

## PHASE 0: RELEASE BLOCKERS (P0)

### REM-01: Secure Chat Message Retrieval Endpoint (BOLA Fix)
- **Priority:** P0 (Blocker)
- **Files:** `scripts/dev-server.ts` (lines 30005–30035)
- **Exact Defect:** `queryDid` fallback allows unauthenticated users to read any user's messages (`FINDING-P0-01`).
- **Required Implementation:** Remove lines 30008–30013. Require `principal = enforceAuth(req, res)` and strictly filter messages to `m.senderDid === principal.did || m.recipientDid === principal.did || m.recipientDid.startsWith('channel:')`.
- **Required Test:** Add negative test in `adversarial-bola-idor-matrix.test.ts` asserting unauthenticated `GET /api/chat/messages?userDid=...` returns HTTP 401.
- **Acceptance Criteria:** Zero messages returned without valid session token; no cross-user thread disclosure.
- **Dependency:** None.
- **Complexity:** Low (1 hour).

### REM-02: Enforce Admin RBAC on Channel & Page Deletions
- **Priority:** P0 (Blocker)
- **Files:** `scripts/dev-server.ts` (lines 31564–31617)
- **Exact Defect:** `/api/admin/channels/delete`, `/pages/delete`, `/entities/purge-test` lack authentication (`FINDING-P0-02`).
- **Required Implementation:** Validate session token via `adminSecurity.resolveAdminSession(token)` and check `adminSecurity.authorize(principal, 'admin:manage')`. Return HTTP 401/403 on authorization failure.
- **Required Test:** Assert unauthenticated POST to `/api/admin/channels/delete` returns HTTP 401.
- **Acceptance Criteria:** Only authenticated `SUPER_ADMIN` or `ADMIN` can delete broadcast channels and pages.
- **Dependency:** None.
- **Complexity:** Low (1 hour).

### REM-03: Remove Destructive Developer Name Filter Heuristics from Production DB
- **Priority:** P0 (Blocker)
- **Files:** `scripts/database-engine.ts` (lines 887–915)
- **Exact Defect:** `isTestArtifact()` regex deletes real users matching common names (Alice, Bob, Charlie) after 60 seconds (`FINDING-P0-03`).
- **Required Implementation:** Delete `isTestArtifact()` and user filter loop in `sanitizeState()`. Preserve all registered users across reloads.
- **Required Test:** Register user `@charlie_real`, wait 65 seconds, call `sovraDb.load(true)`, and assert user remains present in `getAllUsers()`.
- **Acceptance Criteria:** Production database never purges users based on name regexes.
- **Dependency:** None.
- **Complexity:** Low (30 minutes).

### REM-04: Restore Android Gradle Wrapper Archive
- **Priority:** P0 (Blocker)
- **Files:** `apps/sovra-mobile/android/gradle/wrapper/gradle-wrapper.jar`
- **Exact Defect:** Wrapper JAR is missing, breaking `./gradlew.bat` (`FINDING-P0-04`).
- **Required Implementation:** Run `gradle wrapper --gradle-version 8.2.2` in `apps/sovra-mobile/android` and commit `gradle-wrapper.jar`.
- **Required Test:** Run `.\gradlew.bat -v` in CI and assert exit code 0.
- **Acceptance Criteria:** `.\gradlew.bat assembleRelease` generates `app-release.apk`.
- **Dependency:** None.
- **Complexity:** Low (30 minutes).

### REM-05: Correct iOS BLE Bridge Authorization Check
- **Priority:** P0 (Blocker)
- **Files:** `apps/sovra-mobile/ios/SovraMobile/SovraBleNativeModule.mm` (line 77)
- **Exact Defect:** Bridge checks `@"authorized"` instead of `@"allowed"`, causing `hasPermissions()` to always return `false` (`FINDING-P0-05`).
- **Required Implementation:** Change comparison to:
  ```objc
  resolve(@([status isEqualToString:@"allowed"]));
  ```
- **Required Test:** Native XCTest mocking `CBManagerAuthorizationAllowedAlways` and asserting `hasPermissions` resolves to `@YES`.
- **Acceptance Criteria:** `hasPermissions()` resolves to `true` when Bluetooth is permitted by iOS.
- **Dependency:** None.
- **Complexity:** Low (15 minutes).

### REM-06: Resolve React Native Mobile DOM Element Incompatibility
- **Priority:** P0 (Blocker)
- **Files:** `apps/sovra-mobile/App.tsx`, `BottomTabNavigator.tsx`
- **Exact Defect:** HTML tags (`<main>`, `<div>`) crash React Native runtime (`FINDING-P0-06`).
- **Required Implementation:** Replace web tags with React Native native primitives (`View`, `Text`, `StyleSheet`) or encapsulate UI within a native React Native WebView component.
- **Required Test:** Run `npx react-native bundle --platform android --dev false` and assert compilation success.
- **Acceptance Criteria:** App boots on physical Android/iOS device without `Invariant Violation`.
- **Dependency:** REM-04.
- **Complexity:** Medium (1 day).

---

## PHASE 1: SECURITY & DATA INTEGRITY (P1)

### REM-07: Implement Session Expiration & Token Rotation
- **Priority:** P1
- **Files:** `scripts/database-engine.ts`, `scripts/dev-server.ts`
- **Defect:** Session tokens never expire (`FINDING-P1-02`).
- **Implementation:** Add `expiresAt: number` to `UserSessionRecord`. Default to 30 days. Check `Date.now() < session.expiresAt` on resolution. Add sliding renewal on activity.
- **Complexity:** Low (2 hours).

### REM-08: Resolve Reverse Proxy Rate Limiting DoS Vulnerability
- **Priority:** P1
- **Files:** `scripts/dev-server.ts` (lines 26108–26120)
- **Defect:** Rate limiter consumes proxy IP, blocking all users globally (`FINDING-P1-01`).
- **Implementation:** Parse `X-Forwarded-For` with trusted proxy validation, or key rate limits by authenticated `sessionId` / client DID.
- **Complexity:** Medium (3 hours).

### REM-09: Secure Docker & Coturn Production Secrets
- **Priority:** P1
- **Files:** `docker/docker-compose.production.yml`, `docker/turnserver.conf`
- **Defect:** Default hardcoded admin and TURN secrets in production manifests (`FINDING-P1-04`).
- **Implementation:** Remove hardcoded defaults; require non-empty environment variables at container startup.
- **Complexity:** Low (1 hour).

### REM-10: Upgrade Mobile Keystore to Hardware TEE / Keychain
- **Priority:** P1
- **Files:** `apps/sovra-mobile/src/services/secure-keystore.ts`
- **Defect:** Key derivation seed colocated with encrypted vault in plaintext `localStorage` (`FINDING-P1-03`).
- **Implementation:** Integrate `react-native-keychain` or Expo SecureStore to store keys in Android Keystore / iOS Keychain.
- **Complexity:** Medium (1 day).

---

## PHASE 2: CORE USER FUNCTIONALITY (P1)

### REM-11: Idempotent Offline Sync for Likes
- **Priority:** P1
- **Files:** `scripts/dev-server.ts` (line 30618)
- **Defect:** Offline reconcile toggles like rather than setting it idempotently (`FINDING-P1-05`).
- **Implementation:** Change operation payload to explicit `action: 'LIKE' | 'UNLIKE'` and verify user DID in post's `likedByDids` set.
- **Complexity:** Low (1 hour).

### REM-12: Channel Message Realtime SSE Broadcasting
- **Priority:** P1
- **Files:** `scripts/dev-server.ts` (lines 25940–25952)
- **Defect:** Channel messages dropped from SSE broadcast (`FINDING-P1-08`).
- **Implementation:** Track channel subscribers in `channelSubscribers` registry; fan out channel messages to all connected subscribers.
- **Complexity:** Medium (3 hours).

### REM-13: Watch Video Catalog Persistence
- **Priority:** P1
- **Files:** `scripts/dev-server.ts`, `scripts/database-engine.ts`
- **Defect:** Uploaded Watch videos stored only in transient memory (`FINDING-P1-09`).
- **Implementation:** Add `videos: YoutubeVideoRecord[]` to `sovraDb` schema; persist uploads to disk.
- **Complexity:** Medium (4 hours).

### REM-14: Implement Account and Message Deletion (GDPR Right to Erasure)
- **Priority:** P1
- **Files:** `scripts/dev-server.ts`, `scripts/database-engine.ts`
- **Defect:** No endpoints for account or message deletion (`FINDING-P1-06`).
- **Implementation:** Add `POST /api/user/delete` and `POST /api/chat/delete` with cascade removal and tombstone broadcast.
- **Complexity:** Medium (1 day).

### REM-15: Unpin and Clean Up Orphaned Media on Post Deletion
- **Priority:** P1
- **Files:** `scripts/database-engine.ts` (line 2218)
- **Defect:** Deleted posts leave media blocks on disk (`FINDING-P1-07`).
- **Implementation:** Unpin CID from blockstore and unlink file from disk storage on post deletion.
- **Complexity:** Low (2 hours).

---

## PHASE 3 TO PHASE 8: ADVANCED PRODUCTIONIZATION

| Phase | Milestone | Primary Deliverable |
|---|---|---|
| **Phase 3** | **Offline / BLE / Mesh** | Physical BLE frame testing; replace `MockMeshChannel` with physical multi-device test fixture. |
| **Phase 4** | **Media & WebRTC** | Multi-carrier cellular NAT traversal test using verified Coturn relay. |
| **Phase 5** | **Mobile Productionization** | Full native UI implementation; background Bluetooth service persistence on Android 14+ / iOS 17+. |
| **Phase 6** | **Performance & Scale** | Complete migration of whole-database JSON rewrites to native SQLite WAL relational tables. |
| **Phase 7** | **Observability & DR** | Prometheus metrics export; structured audit log streaming; automated hourly snapshot backups. |
| **Phase 8** | **Final Physical Release Gate** | Verification on two physical Android phones and one physical iPhone; formal sign-off for release. |
