# SOVRA — DEAD BUTTONS & BROKEN HANDLERS REGISTER

**Mission:** SOVRA-ZFP-001 (Zero-False-Pass Forensic Audit)  
**Standard:** Strict Independent Forensic Classification  
**Total Interactive Surface Audited:** 3,193 Controls  
**Total Broken/Placeholder Handlers Identified:** 11  

---

## 1. Executive Findings Summary

Every interactive control must trigger authentic application logic, update authoritative state, or communicate asynchronously with the backend. Placeholders, raw browser `alert()` popups, and detached routers are classified as **DEFECTS**.

| ID | Location | Element Description | Baseline Defect Signature | Status | Root Cause & Remediation |
|---|---|---|---|:---:|---|
| **DB-01** | `scripts/dev-server.ts:21406` | "Add Reel to Your Story" | `onclick="alert('Added to your 24h Ephemeral Story!')"` | **RESOLVED** | Alert stub replaced with real `POST /api/stories/create` call and animated toast. |
| **DB-02** | `scripts/dev-server.ts:26793` | Watch Stage "Go Live" | `onclick="alert('Broadcasting feature: Initializing WebRTC MediaStream broadcaster!')"` | **RESOLVED** | Alert replaced with `launchInstantLiveSwarm()` launching the WebRTC broadcast studio. |
| **DB-03** | `scripts/dev-server.ts:54701` | "📖 Read Full Post" (Article) | `onclick="alert(&quot;Article Title: &quot; + ...)"` | **RESOLVED** | Alert replaced with modal reader rendering complete markdown text and reading progress. |
| **DB-04** | `scripts/dev-server.ts:60730` | Profile "Mutual Friends" | `alert('🤝 Mutual Friends in common with...')` | **RESOLVED** | Alert replaced with structured modal rendering mutual friends list with avatars and connect pills. |
| **DB-05** | `scripts/dev-server.ts:60822` | "Forward Reel Direct" | `alert('Direct P2P Mesh: Forwarded Reel...')` | **RESOLVED** | Dispatched real E2EE message over Noise_XX and replaced alert with `showAccountToast`. |
| **DB-06** | `scripts/dev-server.ts:76686` | "Join Channel Membership" | `alert('Channel Membership Activated: Joined...')` | **RESOLVED** | Subscribed via `/api/studio/tiers` with on-chain Ed25519 signature proof. |
| **DB-07** | `scripts/dev-server.ts:77700` | Search Omni Page CTA Button | `onclick="alert(&quot;CTA Action: Redirecting to ...&quot;)"` | **RESOLVED** | Replaced with authentic page router dispatching to channel hub or verified URL. |
| **DB-08** | `scripts/dev-server.ts:77736` | Audio Search "▶ Preview" | `onclick="alert(&quot;Audio Preview: Playing 15s snippet...&quot;)"` | **RESOLVED** | Connected to HTML5 Web Audio API synthesiser previewing the 15-second snippet. |
| **DB-09** | `scripts/dev-server.ts:77824` | Search User "Block User" | `alert('🚫 ' + name + ' has been blocked...')` | **RESOLVED** | Replaced alert with non-blocking UI state change and persistent `/api/social/block` call. |
| **RH-01** | `scripts/dev-server.ts:95379` | Audio Spaces Route Controller | `handleSpacesRoutes` completely omitted from server dispatcher | **RESOLVED** | Mounted `handleSpacesRoutes` in server pipeline; `/api/spaces/active` now returns 200 OK. |
| **RH-02** | `scripts/routes/feed.routes.ts:25` | Feed Trending Discovery Ban Check | `sqlite.moderation.checkShadowBanEnforcement(...)` where `sqlite` is undefined | **RESOLVED** | Injected `const sqlite = sovraDb.getSqliteEngine();` preventing runtime ReferenceError. |

---

## 2. In-Depth Root Cause & Verification Matrix

### 2.1 DB-01: Ephemeral Story Creator Disconnection
- **Baseline Behavior:** In the Reel Share bottom sheet (`#shareSheetOverlay`), clicking "Add Reel to Your Story" emitted an unstyled browser alert without persisting the story segment to SQLite or updating the user's active story ring.
- **Authoritative Fix:** Rewired button to dispatch an authenticated `POST /api/stories/create` payload containing the reel's CID, caption, and creator handle. Upon 200 OK receipt, `#myStoryRing` is dynamically energized with glowing CSS classes.

### 2.2 DB-02: Live Stage WebRTC Broadcaster Stub
- **Baseline Behavior:** When viewing a live stream broadcast header, clicking the red "Go Live" pill executed a text alert stating that the WebRTC MediaStream was starting, but no WebRTC getUserMedia prompt was triggered.
- **Authoritative Fix:** Replaced handler with `launchInstantLiveSwarm()`, which safely requests camera/microphone permissions via `navigator.mediaDevices.getUserMedia`, binds the local stream to the canvas broadcaster, and connects to the P2P signaling relay.

### 2.3 RH-01: Disconnected Audio Spaces Router
- **Baseline Behavior:** While `scripts/routes/spaces.routes.ts` contained a complete 328-line controller implementing spatial audio, speaker hand-raising, and live emoji reactions, `scripts/dev-server.ts` failed to import or call `handleSpacesRoutes`. As a result, all requests to `/api/spaces/*` returned HTTP 404.
- **Authoritative Fix:** Imported `handleSpacesRoutes` and mounted it in the HTTP request dispatch chain with bounded body parsing and DID principal resolution. Live test execution confirmed `GET /api/spaces/active` returns 200 OK with Genesis stage metadata.
