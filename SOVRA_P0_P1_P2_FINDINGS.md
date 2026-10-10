# SOVRA — P0, P1, P2 & P3 FORENSIC FINDINGS
**Audit Date:** October 8, 2026  
**Auditor:** Principal Software Architect & Staff Security Engineer  
**Classification:** STRICT PRODUCTION AUDIT (ZERO FIXES APPLIED)  

---

## EXECUTIVE FINDINGS OVERVIEW

| Severity | Count | Release Impact |
|---|---|---|
| **P0 (Catastrophic / Blocker)** | **6** | **ABSOLUTE RELEASE BLOCKERS — DO NOT SHIP** |
| **P1 (Serious Production Risk)** | **10** | **CRITICAL PRODUCTION & SECURITY GAPS** |
| **P2 (Controlled Risk / Inconsistency)** | **4** | **ARCHITECTURAL & TESTING DEFICIENCIES** |
| **P3 (Technical Debt / Optimization)** | **3** | **CODE QUALITY & PERFORMANCE DEBT** |

---

## 1. P0 FINDINGS (RELEASE BLOCKERS)

### FINDING-P0-01: Private Chat History Retrieval Bypass via `userDid` Parameter
- **Severity:** P0
- **Subsystem:** API / Messaging Security / Authorization
- **File:** `scripts/dev-server.ts`
- **Lines:** 30005–30018
- **Finding:** Unauthenticated callers can retrieve all private direct messages sent or received by any user by simply passing `?userDid=<targetDid>` to `/api/chat/messages` or `/api/chat/history`.
- **Why It Matters:** Direct message confidentiality is completely broken. Any eavesdropper or automated scraper can dump entire private conversation threads across all users without credentials.
- **Attack / Failure Scenario:**
  ```http
  GET /api/chat/messages?userDid=did:key:z6MksTargetVictim HTTP/1.1
  Host: localhost:3001
  ```
  The endpoint checks `if (!userDid) { const queryDid = url.searchParams.get('userDid'); if (queryDid) userDid = queryDid; }`. It bypasses `principal` check and dumps all conversations involving `did:key:z6MksTargetVictim`.
- **Evidence:**
  ```typescript
  // scripts/dev-server.ts:30006-30013
  const principal = resolvePrincipal(req);
  let userDid = principal?.did;
  if (!userDid) {
    const queryDid = url.searchParams.get('userDid');
    if (queryDid && (sovraDb.findUserByDid(queryDid) || queryDid.startsWith('did:sovra:'))) {
      userDid = queryDid;
    }
  }
  ```
- **Current Behavior:** Returns HTTP 200 with all messages matching `userDid` for unauthenticated requests.
- **Expected Behavior:** Return HTTP 401 Unauthorized unless verified via active bearer token / session cookie, strictly filtering messages to the authenticated principal.
- **Production Impact:** Catastrophic privacy failure, violation of end-to-end messaging guarantees.
- **Fix Recommendation:** Remove `queryDid` fallback entirely from `GET /api/chat/messages` and require `enforceAuth(req, res)`.
- **Validation Test:** Send unauthenticated `GET /api/chat/messages?userDid=...` and assert HTTP 401.

---

### FINDING-P0-02: Completely Unauthenticated Admin Channel & Page Deletion Endpoints
- **Severity:** P0
- **Subsystem:** Administrative API / RBAC
- **File:** `scripts/dev-server.ts`
- **Lines:** 31564–31617
- **Finding:** Administrative endpoints `/api/admin/channels/delete`, `/api/admin/pages/delete`, and `/api/admin/entities/purge-test` lack all authentication and authorization checks.
- **Why It Matters:** Any malicious party on the Internet can delete official broadcast channels, brand pages, or trigger database purges by sending an unauthenticated JSON POST request.
- **Attack / Failure Scenario:**
  ```http
  POST /api/admin/channels/delete HTTP/1.1
  Host: localhost:3001
  Content-Type: application/json

  {"channelId": "ch-alpha"}
  ```
  The server invokes `sovraDb.deleteChannel(channelId, 'did:sovra:system')` with system privileges and responds with `{ ok: true }`.
- **Evidence:**
  ```typescript
  // scripts/dev-server.ts:31564-31577
  if (url.pathname === '/api/admin/channels/delete' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return;
    try {
      const parsed = JSON.parse(body);
      const channelId = String(parsed.channelId || parsed.id || '');
      // NO resolvePrincipal, NO enforceAuth, NO adminSecurity check!
      const delRes = sovraDb.deleteChannel(channelId, 'did:sovra:system');
  ```
- **Current Behavior:** Executes deletion with system credentials for unauthenticated requests.
- **Expected Behavior:** Enforce `adminSecurity.authorize(principal, 'channels:delete')` and return HTTP 401/403.
- **Production Impact:** Total platform vandalism, service disruption, and unauthorized data destruction.
- **Fix Recommendation:** Wrap with `adminSecurity.resolveAdminSession` and verify `SUPER_ADMIN` or `ADMIN` role.
- **Validation Test:** Issue unauthenticated request to `/api/admin/channels/delete` and assert HTTP 401.

---

### FINDING-P0-03: Silent Automated Wiping of Real Users Containing Common Names or 6+ Digits
- **Severity:** P0
- **Subsystem:** Database / Data Integrity
- **File:** `scripts/database-engine.ts`
- **Lines:** 887–915
- **Finding:** The database sanitization routine (`sanitizeState`) permanently deletes any user from the database whose handle or name matches a test artifact regex once the account is older than 60 seconds.
- **Why It Matters:** Real users named "Alice", "Bob", "Charlie", or any user with 6 or more digits in their handle (e.g. `@john123456`) are silently purged from the platform 60 seconds after registration upon the next database reload.
- **Failure Scenario:**
  A user creates account `@charlie_smith` or `@user202610`. Sixty seconds later, the server restarts or reloads state. `isTestArtifact()` evaluates to `true`, and `uniqueUsers` discards their profile.
- **Evidence:**
  ```typescript
  // scripts/database-engine.ts:888-897
  const isTestArtifact = (handle?: string, name?: string, did?: string, createdAt?: number) => {
    if (createdAt && (Date.now() - createdAt < 60000)) return false;
    const h = (handle || '').toLowerCase().trim();
    const n = (name || '').toLowerCase().trim();
    const d = (did || '').toLowerCase().trim();
    if (h === '@laptop_host') return false;
    if (h === '@merajsharif' || h === '@ewan' || h === '@farhat' || h === '@meraj' || h === '@rahul_phone') return false;
    return /(alice|bob|charlie|bb_|muw|_mu|\d{6,}|attacker|victim|gate_|drill|dev_\w{3,}|probe|snoop|tipper_|phone_dev|laptop_dev|hacked|anonymous|_e2e|persona_author|test|meshcore|aimesh|mut_ch|guild_|alice_tech)/i.test(h + ' ' + n + ' ' + d);
  };
  ```
- **Current Behavior:** Real user profiles matching common names or standard numeric handles are deleted on next `load()`.
- **Expected Behavior:** Production database must never delete production users based on hardcoded developer name heuristics.
- **Production Impact:** Silent data loss, corrupted user sessions, inability for legitimate users to retain accounts.
- **Fix Recommendation:** Remove `isTestArtifact` filtering completely from production persistence code. Test isolation must occur in dedicated ephemeral test directories.
- **Validation Test:** Register `@charlie_test_user` with `createdAt = Date.now() - 120000`, invoke `db.load(true)`, and assert user remains intact.

---

### FINDING-P0-04: Missing Android Gradle Wrapper JAR Breaks Native APK Compilation
- **Severity:** P0
- **Subsystem:** Mobile / Android Build System
- **File:** `apps/sovra-mobile/android/gradle/wrapper/gradle-wrapper.jar`
- **Lines:** N/A (File missing)
- **Finding:** `gradle-wrapper.jar` is missing from `apps/sovra-mobile/android/gradle/wrapper/`.
- **Why It Matters:** Clean checkout cannot compile the Android application. Running `gradlew.bat` or `./gradlew` immediately terminates with `ClassNotFoundException: org.gradle.wrapper.GradleWrapperMain`.
- **Failure Scenario:**
  ```powershell
  cd apps/sovra-mobile/android
  .\gradlew.bat assembleRelease
  # Error: Could not find or load main class org.gradle.wrapper.GradleWrapperMain
  ```
- **Evidence:** Verified by running `.\gradlew.bat -v` in `apps/sovra-mobile/android`. Exit code 1:
  `Caused by: java.lang.ClassNotFoundException: org.gradle.wrapper.GradleWrapperMain`.
- **Current Behavior:** Android build is completely blocked on clean checkouts and CI environments.
- **Expected Behavior:** Gradle wrapper JAR must be checked in or generated via `gradle wrapper` to permit reproducible compilation.
- **Production Impact:** Android APK cannot be built from source by CI or release engineers.
- **Fix Recommendation:** Commit standard Gradle 8.2+ wrapper JAR to `apps/sovra-mobile/android/gradle/wrapper/`.
- **Validation Test:** Execute `./gradlew --version` from `apps/sovra-mobile/android` and assert exit code 0.

---

### FINDING-P0-05: Native iOS BLE Permission Check Always Evaluates to False
- **Severity:** P0
- **Subsystem:** Mobile / iOS Native BLE Bridge
- **File:** `apps/sovra-mobile/ios/SovraMobile/SovraBleNativeModule.mm` & `SovraBleBridge.mm`
- **Lines:** `SovraBleNativeModule.mm`: 75–78; `SovraBleBridge.mm`: 57–68
- **Finding:** `SovraBleBridge.mm` returns authorization strings (`"allowed"`, `"denied"`, `"restricted"`, `"not_determined"`), but `SovraBleNativeModule.mm` strictly tests `[status isEqualToString:@"authorized"]`.
- **Why It Matters:** Because `"allowed"` is never equal to `"authorized"`, `hasPermissions()` always resolves to `false` on iOS. Any JavaScript runtime checking `await ble.hasPermissions()` on iOS is permanently blocked from starting scanning or advertising.
- **Failure Scenario:**
  User grants Bluetooth permissions on iPhone. App calls `hasPermissions()`. Bridge returns `false`. App displays "Bluetooth Permission Denied" and halts mesh stack.
- **Evidence:**
  ```objc
  // SovraBleBridge.mm:57-67
  - (NSString *)getAuthorizationStatus {
      if (@available(iOS 13.1, *)) {
          CBManagerAuthorization auth = CBManager.authorization;
          switch (auth) {
              case CBManagerAuthorizationAllowedAlways: return @"allowed";
              case CBManagerAuthorizationDenied: return @"denied";
              ...
          }
      }
      return @"allowed";
  }

  // SovraBleNativeModule.mm:75-78
  RCT_EXPORT_METHOD(hasPermissions:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
      NSString *status = [[SovraBleBridge sharedInstance] getAuthorizationStatus];
      resolve(@([status isEqualToString:@"authorized"])); // ALWAYS FALSE!
  }
  ```
- **Current Behavior:** iOS BLE native bridge always reports permissions as denied.
- **Expected Behavior:** `hasPermissions()` returns `true` when authorization status is `allowed`.
- **Production Impact:** 100% of iOS physical devices cannot activate the Bluetooth mesh.
- **Fix Recommendation:** Change string comparison to `[status isEqualToString:@"allowed"]`.
- **Validation Test:** Unit test `SovraBleNativeModule.hasPermissions` against mocked `CBManagerAuthorizationAllowedAlways`.

---

### FINDING-P0-06: React Native Mobile App Uses Web HTML DOM Elements Incompatible with Native React Native
- **Severity:** P0
- **Subsystem:** Mobile Runtime / Frontend Architecture
- **File:** `apps/sovra-mobile/App.tsx`, `BottomTabNavigator.tsx`, and all screen components
- **Lines:** `App.tsx`: 15–29; `BottomTabNavigator.tsx`: 149–165
- **Finding:** The React application inside `apps/sovra-mobile/` is authored using standard HTML web DOM tags (`<main>`, `<div>`, `<span>`, `<button>`) with CSS string properties rather than React Native native primitives (`<View>`, `<Text>`, `<TouchableOpacity>`).
- **Why It Matters:** React Native does not contain a DOM renderer. Bundling this code with React Native Metro for Android (`MainApplication.kt`) or iOS crashes immediately with `Invariant Violation: View config getter callback for component 'main' must be a function`.
- **Failure Scenario:**
  APK launches `MainApplication`. Metro evaluates `App.tsx`. React Native engine encounters `<main>` and terminates the app with a red-screen fatal crash.
- **Evidence:**
  ```tsx
  // apps/sovra-mobile/App.tsx:13-29
  export default function App(): React.JSX.Element {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', ... }}>
        <BottomTabNavigator />
      </main>
    );
  }
  ```
- **Current Behavior:** Web React DOM code is placed in a native React Native project directory without a React Native DOM shim.
- **Expected Behavior:** Native mobile app must use React Native core components (`View`, `Text`, `StyleSheet`) or run within an explicit WebView container.
- **Production Impact:** Native mobile app cannot boot on physical Android or iOS devices.
- **Fix Recommendation:** Migrate screens to standard React Native primitives or encapsulate within a dedicated WebView wrapper.
- **Validation Test:** Run React Native bundle analyzer / headless Hermes parser to verify zero DOM tag dependencies.

---

## 2. P1 FINDINGS (SERIOUS PRODUCTION RISKS)

### FINDING-P1-01: Reverse Proxy IP Collision Causes Global 429 Outages
- **Severity:** P1
- **Subsystem:** SRE / Networking / Rate Limiting
- **File:** `scripts/dev-server.ts`
- **Lines:** 26108–26120
- **Finding:** `rateLimiter` tracks request quotas using `req.socket.remoteAddress || '127.0.0.1'`.
- **Why It Matters:** In production behind Caddy or Kubernetes ingress, `req.socket.remoteAddress` is always the proxy's IP. All users worldwide share a single token bucket. A single high-volume client triggers `429 Too Many Requests` for all legitimate platform users.
- **Evidence:**
  ```typescript
  // scripts/dev-server.ts:26108-26112
  const clientIp = req.socket.remoteAddress || '127.0.0.1';
  if (!rateLimiter.consume(clientIp)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Too Many Requests: Rate limit exceeded. Please back off.' }));
    return;
  }
  ```
- **Production Impact:** Denial of Service for all users behind reverse proxies.
- **Fix Recommendation:** Parse trusted proxy headers (`X-Forwarded-For`) with IP validation, or rate limit by authenticated principal session ID.

---

### FINDING-P1-02: Permanent Session Lifetime (Zero Expiration TTL)
- **Severity:** P1
- **Subsystem:** Authentication / Session Management
- **File:** `scripts/database-engine.ts`
- **Lines:** 595–606, 1105–1115
- **Finding:** `UserSessionRecord` contains no expiration timestamp (`expiresAt`), and `findUserBySessionToken` does not validate session age.
- **Why It Matters:** Stolen, leaked, or intercepted session tokens remain permanently valid forever.
- **Evidence:**
  ```typescript
  // scripts/database-engine.ts:595-606
  export interface UserSessionRecord {
    sessionId: string;
    userDid: string;
    token: string;
    createdAt: number;
    lastActiveAt: number;
    isRevoked: boolean;
    // Missing: expiresAt
  }
  ```
- **Production Impact:** High security exposure window; inability to enforce session timeouts.
- **Fix Recommendation:** Add `expiresAt` with default 30-day sliding TTL and check `Date.now() < s.expiresAt`.

---

### FINDING-P1-03: Key Derivation Entropy Seed Stored Alongside Encrypted Vault in LocalStorage
- **Severity:** P1
- **Subsystem:** Cryptography / Mobile Keystore
- **File:** `apps/sovra-mobile/src/services/secure-keystore.ts`
- **Lines:** 215–233
- **Finding:** `SecureKeyStore` generates a 32-byte device entropy seed and stores it in plaintext `localStorage` under `sovra_device_entropy_seed`.
- **Why It Matters:** Both the key derivation material (`sovra_device_entropy_seed`) and the ciphertext vault (`sovra_secure_key_vault_v1`) reside in the same unencrypted storage medium. Anyone with filesystem or XSS access can derive the HKDF key and decrypt the private keys.
- **Production Impact:** Misleading security guarantee; private keys are not protected by hardware-backed Keystore or Keychain.
- **Fix Recommendation:** Bridge to Android Keystore / iOS Keychain via `react-native-keychain` or Expo SecureStore.

---

### FINDING-P1-04: Default Production Admin and TURN Secrets in Docker Compose
- **Severity:** P1
- **Subsystem:** DevOps / Infrastructure Security
- **File:** `docker/docker-compose.production.yml`, `docker/turnserver.conf`
- **Lines:** Compose: 21, 71–72; Turnserver: 26
- **Finding:** Docker Compose and Coturn configs fall back to hardcoded default credentials:
  `ADMIN_SECRET_KEY=${ADMIN_SECRET_KEY:-sovra-production-admin-secret-key-32chars!}`
  `SOVRA_TURN_SECRET=${SOVRA_TURN_SECRET:-sovra-dev-turn-secret-change-in-prod-replace-with-env!}`
- **Why It Matters:** Operators spinning up the production stack without setting environment variables expose full root admin controls to anyone who knows the default codebase key.
- **Production Impact:** Unauthorized administrative access on default deployments.
- **Fix Recommendation:** Remove fallback defaults; abort startup if environment secrets are unset.

---

### FINDING-P1-05: Non-Idempotent Offline Sync Flips Post Likes Between Liked and Unliked
- **Severity:** P1
- **Subsystem:** Offline Sync / CRDT Reconciliation
- **File:** `scripts/dev-server.ts`
- **Lines:** 30616–30623
- **Finding:** Reconciling an offline `LIKE_POST` operation executes `sovraDb.toggleLike(postId, principal.did)`.
- **Why It Matters:** If a network blip causes an operation to be submitted twice or replayed, the post is un-liked rather than idempotently maintained.
- **Evidence:**
  ```typescript
  // scripts/dev-server.ts:30616-30619
  case 'LIKE_POST': {
    const postId = String(op.payload?.postId || '');
    if (postId) {
      sovraDb.toggleLike(postId, principal.did);
  ```
- **Production Impact:** Likes oscillate wildly during intermittent network connectivity.
- **Fix Recommendation:** Implement explicit `SET_LIKE` (liked: true/false) or an OR-Set CRDT.

---

### FINDING-P1-06: Total Absence of Account Deletion & Message Deletion Endpoints
- **Severity:** P1
- **Subsystem:** Privacy / Regulatory Compliance (GDPR Article 17)
- **File:** `scripts/dev-server.ts`
- **Finding:** There is no endpoint for user account deletion (`/api/user/delete`) or message deletion (`/api/chat/delete`).
- **Why It Matters:** Users have no ability to delete their data or account, creating non-compliance with privacy regulations.
- **Production Impact:** Legal and regulatory non-compliance in EU and California jurisdictions.
- **Fix Recommendation:** Implement tombstone broadcast and database cascade deletion for user accounts and messages.

---

### FINDING-P1-07: Post Deletion Leaves Stored Media Blocks Permanently Orphaned on Disk
- **Severity:** P1
- **Subsystem:** Storage / Garbage Collection
- **File:** `scripts/database-engine.ts`
- **Lines:** 2218–2228
- **Finding:** `deletePost(postId)` removes the record from `db.posts` but does not unpin or delete media files from `.sovra-storage-dev` or the blockstore.
- **Why It Matters:** Deleted media files remain publicly accessible via direct CID URL and consume storage indefinitely.
- **Production Impact:** Storage exhaustion over time; deleted media remains accessible.
- **Fix Recommendation:** Hook `deletePost` into `storageDaemon.unpin` and unlink files from media directories.

---

### FINDING-P1-08: Channel Messages Omitted from Real-Time SSE Stream
- **Severity:** P1
- **Subsystem:** Real-Time / SSE / Chat
- **File:** `scripts/dev-server.ts`
- **Lines:** 25940–25952
- **Finding:** `broadcastChatEvent` only routes to `realtimeSubscribers.get(recipientDid)`. Because channel IDs start with `channel:`, no connected user session matches, and events are dropped.
- **Why It Matters:** Channel participants never receive live messages over SSE and must manually refresh the page.
- **Production Impact:** Broken real-time experience in community channels.
- **Fix Recommendation:** Map channel subscribers to active SSE connections and fan out channel messages.

---

### FINDING-P1-09: Watch Tab Video Catalog Exists Only in Transient Process Memory
- **Severity:** P1
- **Subsystem:** Media / Video Catalog
- **File:** `scripts/dev-server.ts`
- **Lines:** 777–880, 24911–24922
- **Finding:** `longFormVideosCatalog` is a static in-memory array. Uploading a video only mutates client memory.
- **Why It Matters:** User-uploaded videos vanish on page refresh or server restart.
- **Production Impact:** Non-functional video upload in the Watch tab.
- **Fix Recommendation:** Persist long-form video records in `sovraDb` schema with disk storage.

---

### FINDING-P1-10: Missing Lockfile and Package Manager Blocks Automated Supply Chain Audits
- **Severity:** P1
- **Subsystem:** Supply Chain Security
- **File:** Root repository
- **Finding:** `package-lock.json` is missing and `pnpm` is not in the system environment, causing `npm audit` to fail with `ENOLOCK`.
- **Why It Matters:** CI pipelines cannot evaluate known CVEs in upstream dependencies.
- **Production Impact:** Undetected vulnerable third-party dependencies in production runtime.
- **Fix Recommendation:** Check in standardized lockfile or ensure `pnpm` is pinned via Corepack.

---

## 3. P2 FINDINGS (IMPORTANT ARCHITECTURAL & TESTING DEFICIENCIES)

### FINDING-P2-01: Monolithic Synchronous Whole-Database JSON File Rewrites
- **Severity:** P2
- **Subsystem:** Database Engine / Performance
- **File:** `scripts/database-engine.ts`
- **Lines:** 1050–1080
- **Finding:** `SovraDatabaseEngine.save()` serializes the entire database into formatted JSON with `fs.writeFileSync` on every write operation.
- **Production Impact:** Event loop blocking at scale; risk of write contention under concurrent load.
- **Fix Recommendation:** Fully transition write operations to SQLite relational tables.

---

### FINDING-P2-02: Database Engine Falsely Claims SQLite WAL Backend
- **Severity:** P2
- **Subsystem:** Database Reporting / Observability
- **File:** `scripts/database-engine.ts`
- **Lines:** 666–674
- **Finding:** `getDbInfo()` reports `acidCompliant: true, journalMode: WAL, backend: sqlite`, but all application reads and queries use the in-memory JSON object `this.db`.
- **Production Impact:** Misleading telemetry during operational audits.
- **Fix Recommendation:** Align `getDbInfo()` with actual read/write storage engine paths.

---

### FINDING-P2-03: Multi-Hop Mesh Automated Tests Use In-Memory Mock Transports
- **Severity:** P2
- **Subsystem:** Testing Quality / BLE Mesh
- **File:** `tests/e2e/multi-hop-mesh-offline.test.ts`
- **Lines:** 31–49
- **Finding:** Automated multi-hop mesh verification uses `MockMeshChannel` with direct in-process method invocation rather than actual radio packets or GATT negotiation.
- **Production Impact:** False confidence: passing tests do not validate physical BLE RF behavior.
- **Fix Recommendation:** Clearly distinguish software route testing from physical hardware validation.

---

### FINDING-P2-04: Hardcoded Story Persona Consolidation Hijacks User Identity
- **Severity:** P2
- **Subsystem:** Social / Stories Pipeline
- **File:** `scripts/database-engine.ts`
- **Lines:** 3289–3293
- **Finding:** `getStories()` merges any user whose name or handle starts with "Alice" into `alice_creator`.
- **Production Impact:** Real users named Alice lose individual profile attribution in stories.
- **Fix Recommendation:** Remove demo-specific name consolidation logic.

---

## 4. P3 FINDINGS (TECHNICAL DEBT & MINOR DEFICIENCIES)

### FINDING-P3-01: Unbounded In-Memory Activity Audit Log
- **Severity:** P3
- **Subsystem:** Admin Logging
- **File:** `scripts/database-engine.ts`, line 3139
- **Finding:** Audit log array is capped at 500 records in memory, dropping older compliance records without archiving to durable cold storage.

### FINDING-P3-02: Unbounded Search Body Request Size
- **Severity:** P3
- **Subsystem:** Search Service
- **File:** `scripts/dev-server.ts`, line 26500
- **Finding:** In-memory omni-search queries scan the full database without pagination cursor limits.

### FINDING-P3-03: Redundant Duplicate Event Listeners in Dev Server
- **Severity:** P3
- **Subsystem:** Node Runtime
- **File:** `scripts/dev-server.ts`
- **Finding:** Multiple process shutdown listeners registered without deduplication.
