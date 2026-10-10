# SOVRA — Core / Logo as Global Spatial Command Center (Phase 2)

**Status:** Production Grade • Validated & Certified  
**Scope:** SOVRA Logo as Single Global Command Core + Radial Spatial Architecture + Contextual Surface Engine Integration  
**Monorepo Packages:** `@sovra/app` (`apps/sovra-app/src/ui/sovra-core/`, `apps/sovra-app/src/ui/sovra-surface/`), `scripts/dev-server.ts`, `scripts/database-engine.ts`  
**Test Suites:** 
- `tests/e2e/sovra-core-spatial-command-phase2.test.ts` (21/21 tests passing)
- `tests/e2e/spatial-surface-engine-phase1.test.ts` (23/23 tests passing)
- `tests/e2e/holographic-navigation.test.ts` (5/5 tests passing)
- `tests/e2e/spatial-surface-navigation.test.ts` (14/14 tests passing)
- `tests/e2e/browser-script-syntax-gate.test.ts` (3/3 tests passing)

---

## 1. Executive Summary & Design Philosophy

SOVRA Phase 2 unifies the **SOVRA Spatial Surface Engine** (Phase 1) with the **SOVRA central logo** to form the application's single, universal, global command core.

Traditional web applications clutter user viewports with permanent navigation bars, vertical icon sidebars, and nested accordion menus. These persistent navigation widgets steal screen real estate, create visual noise, and compete with content.

SOVRA replaces all permanent peripheral navigation with a **minimal idle state**:
1. **Normal/Idle State:** The central SOVRA logo header button is clean and uncluttered. There are **zero** permanent sidebars, **zero** bottom tab bars, and **zero** permanent radial buttons surrounding the logo.
2. **Activation:** Clicking or tapping the SOVRA logo triggers the Holographic Command Core. The animation originates directly from the logo's physical screen coordinates, releasing a subtle energy pulse, dual concentric acoustic shockwave rings, and holographic energy pathways that smoothly push primary command nodes into an orbital radial configuration.
3. **Contextual Spatial Navigation:** Primary commands do not dump the user into nested menus or trigger abrupt full-page reloads. Instead, contextual destinations (Profile, Notifications, Create, Chat) transition seamlessly into **Spatial Surfaces** powered by the Phase 1 engine, while the Core smoothly recedes into the background (`surface-active` state).

```
                      ┌────────────────────────┐
                      │   SOVRA LOGO (IDLE)    │
                      └───────────┬────────────┘
                                  │ Click / Activate
                                  ▼
                      ┌────────────────────────┐
                      │    SOVRA CORE (FSM)    │
                      │  [Radial Orbital Ring] │
                      └─────┬─────┬─────┬──────┘
             ┌──────────────┘     │     └──────────────┐
             ▼                    ▼                    ▼
     [ Feed / Reels / Watch ]  [ Chat ]       [ Profile / Create / Notif ]
             │                    │                    │
             ▼                    ▼                    ▼
     Direct Tab Switch     Spatial Chat Surface  Contextual Spatial Surface
     (Closes Core)         (Core: surface-active) (Core: surface-active)
                                                       │
                                                       ▼
                                            [ Sub-Surfaces in Stack ]
                                            (e.g., Settings → Privacy → Visibility)
```

---

## 2. Core State Machine & Lifecycle (FSM)

To prevent impossible states (such as `coreClosed = true` while `nodesVisible = true` or `surfaceActive = true`), the command center is governed by a deterministic Finite State Machine implemented in [`SovraCoreStateMachine.ts`](file:///d:/Sovra/apps/sovra-app/src/ui/sovra-core/SovraCoreStateMachine.ts) and mirrored in the client runtime.

### 2.1 State Definitions

| State | Description | Overlay Class | Visual Appearance |
|---|---|---|---|
| `closed` | Core is inactive. Zero animations running. Minimal DOM footprint. | (none) | Hidden (`display: none; opacity: 0; pointer-events: none`) |
| `opening` | Logo pulse active, expanding rings, nodes projecting outwards from origin `(x, y)`. | `.is-active` | Origin burst expanding outward |
| `open` | Nodes settled in radial orbit. Fully interactive, keyboard focusable. | `.is-active.is-open` | Full radial command center with live badges and energy lines |
| `transitioning` | User clicked a node; handoff to Spatial Surface is in progress. | `.is-active.is-open` | Smooth cross-fade to surface |
| `surface-active` | A Spatial Surface is open above the Core. | `.is-active.is-open.is-surface-active` | Receded into background (`opacity: 0.15`, `pointer-events: none`, `filter: blur(2px)`) |

### 2.2 Allowed Transition Graph

```
  ┌──────────┐      open()       ┌───────────┐      settle       ┌────────┐
  │  closed  │ ────────────────> │  opening  │ ────────────────> │  open  │
  └──────────┘                   └───────────┘                   └───┬────┘
       ▲                                                             │
       │                         close()                             │ surface handoff
       ├─────────────────────────────────────────────────────────────┤
       │                                                             ▼
       │     closeAll() / unwind stack       ┌────────────────┐  transitionToSurface
       ├──────────────────────────────────── │ surface-active │ <───────────────────
       │                                     └───────┬────────┘
       │                                             │ pop root surface
       │                                             ▼
       │                                          returnFromSurface()
       └───────────────────────────────────────── (Restores `open`)
```

- `closed` $\rightarrow$ `opening` (via `open()`)
- `opening` $\rightarrow$ `open` (on animation completion)
- `opening` $\rightarrow$ `closed` (on early cancel or interrupt)
- `open` $\rightarrow$ `closed` (via `close()`, ESC, logo toggle, outside click)
- `open` $\rightarrow$ `transitioning` (via `transitionToSurface()`)
- `transitioning` $\rightarrow$ `surface-active` (when surface mounts)
- `surface-active` $\rightarrow$ `open` (via `returnFromSurface()` when root surface pops)
- `surface-active` $\rightarrow$ `closed` (when surfaces are dismissed completely)

Any invalid transition attempt is strictly intercepted and rejected by the FSM guards.

---

## 3. Radial Orbital Geometry & Responsive Mechanics

The primary command nodes are arranged in polar coordinates $(r, \theta)$ centered on the SOVRA core.

### 3.1 Polar Coordinate Engine

Given the origin center $(x_0, y_0)$, each node $i$ with angle $\theta_i$ (in degrees) is positioned using:
$$\Delta x = r \cdot \sin(\theta_i \cdot \frac{\pi}{180})$$
$$\Delta y = -r \cdot \cos(\theta_i \cdot \frac{\pi}{180})$$

When the Core is opening, each node starts with $\Delta x = 0, \Delta y = 0$ (at the exact logo trigger coordinates) and animates outward along its designated energy pathway vector to its radial position.

### 3.2 Responsive Radial Breakpoints

To prevent screen edge clipping, node overlap, and unreachable touch targets, the orbital radius $r$ scales dynamically based on the viewport:

| Viewport Category | Screen Width / Device | Orbit Radius ($r$) | Node Size | Minimum Touch Target |
|---|---|---|---|---|
| Compact Mobile | $\le 380\text{px}$ (e.g. 360x800) | `118px` | `44px` | $48 \times 48\text{px}$ |
| Standard Mobile | $381\text{px} - 480\text{px}$ (e.g. 390x844, 430x932) | `136px` | `48px` | $48 \times 48\text{px}$ |
| Tablet / Foldable | $481\text{px} - 768\text{px}$ (e.g. 768x1024) | `172px` | `54px` | $54 \times 54\text{px}$ |
| Desktop / Ultra | $> 768\text{px}$ (1280x720, 1440x900, 1920x1080) | `212px` | `58px` | $58 \times 58\text{px}$ |

### 3.3 Angular Distribution of Nodes

| Node Action | Angle ($\theta$) | Visual Label | Capability Classification |
|---|---|---|---|
| **Feed / Home** | $0^\circ$ (Top) | Feed | Direct Route Switch |
| **Notifications** | $40^\circ$ | Notifications | Contextual Spatial Surface |
| **Reels** | $80^\circ$ | Reels | Direct Route Switch |
| **Watch** | $120^\circ$ | Watch | Direct Route Switch |
| **Chat** | $160^\circ$ | Chat | Contextual Spatial Surface |
| **Create** | $200^\circ$ | Create | Contextual Spatial Surface (9 modalities) |
| **Profile** | $240^\circ$ | Profile | Contextual Spatial Surface (7 options) |
| **Logout** | $310^\circ$ | Logout | Sovereign Auth Revocation |

---

## 4. Contextual Spatial Surfaces

Rather than overwhelming the global orbital core with every secondary sub-feature (avoiding HUD clutter and sitemap bloat), the command core uses **Contextual Spatial Surfaces**.

### 4.1 Profile Surface Hierarchy

Clicking the `Profile` node activates `window.openSpatialProfileSurface(originEl)`:
- Core enters `surface-active` state.
- The Profile Surface emerges with clean sovereign biometric styling and reveals the 7 contextual actions:
  1. **Edit Profile:** Name, bio, avatar, and cryptographic sovereign identifiers.
  2. **Settings:** Pushes the Phase 1 Settings Surface stack:
     - `SOVRA SETTINGS` $\rightarrow$ `Privacy` $\rightarrow$ `Profile Visibility` (persisting directly to `POST /api/user/privacy`).
  3. **Saved:** Pushes Saved Collections surface (bookmarks, media, audio, posts).
  4. **Activity:** Pushes Sovereign Activity Log surface (session history, mesh relay logs).
  5. **My Channels:** Direct navigation to managed broadcast channels.
  6. **My Pages:** Direct navigation to sovereign organization pages.
  7. **My Groups:** Direct navigation to sovereign peer groups.

### 4.2 Create Surface (9 Creation Modalities)

Clicking the `Create` node activates `window.openSpatialCreateSurface(originEl)`:
- All 9 creation modalities are presented cleanly within a single contextual surface:
  1. **Post:** Standard feed text / rich markdown update.
  2. **Photo:** High-resolution spatial photo with cryptographic metadata.
  3. **Video:** P2P distributed video upload with multi-bitrate transcode.
  4. **Reel:** Vertical full-screen short-form sovereign reel.
  5. **Poll:** Cryptographically tallied decentralized poll.
  6. **Question:** Q&A peer inquiry surface.
  7. **Channel:** Broadcast channel creator.
  8. **Page:** Organization / brand profile creation surface.
  9. **Group:** Encrypted sovereign group creator.

### 4.3 Notifications & Chat Surfaces

- **Notifications (`holo-node-notif`):** Opens `openSpatialNotificationSurface()` showing sovereign peer alerts, mentions, and cryptographic attestations.
- **Chat (`holo-node-chat`):** Opens `openSpatialChatSurface()` showing active encrypted DM threads and peer discovery.

---

## 5. Surface + Core Symbiosis & Stack Unwinding

A fundamental requirement of Phase 2 is that **the Core and Surfaces do not conflict**:

1. **When Surface Opens:**
   - The Core does not unmount or abruptly disappear; it transitions to `surface-active`.
   - `.holo-nav-overlay.is-surface-active` applies `opacity: 0.15`, `pointer-events: none`, and `filter: blur(2px)`.
   - The surface stack mounts with high priority (`z-index: 100000+`).
2. **When Surface Stack Unwinds:**
   - **Multi-Level Stack (`depth > 1`):** Pressing `ESC` or clicking `← Back` pops the topmost surface and restores the preceding surface.
   - **Root Surface (`depth === 1`):** Pressing `ESC`, clicking `✕ Close`, or clicking the backdrop dismisses the root surface and automatically calls `SovraCore.returnFromSurface()`, cleanly returning the user to the active orbital Core.
   - **Core Open:** Pressing `ESC` while the Core is active cleanly closes the Core and restores focus to the SOVRA logo header trigger.

---

## 6. Accessibility & Motion Standards

1. **Semantic HTML & ARIA:**
   - Central Core button: `role="button"`, `aria-haspopup="true"`, `aria-expanded="false"`, `aria-label="Open SOVRA holographic command center"`.
   - Holographic container: `role="dialog"`, `aria-modal="true"`, `aria-label="SOVRA Holographic Command Center"`.
   - Node controls: `role="menuitem"`, with descriptive `aria-label`s and visible contextual labels.
2. **Keyboard Navigation:**
   - `Tab` / `Shift+Tab`: Full cyclic focus trap across radial nodes and center core close button.
   - `ESC`: Intuitive step-by-step unwinding (Surface Depth $N \rightarrow 1 \rightarrow$ Core $\rightarrow$ Closed).
3. **Reduced Motion (`prefers-reduced-motion: reduce`):**
   - Shockwave expanding rings and orbital trails are completely suppressed.
   - Transform transitions drop to instant ($0.01\text{ms}$).
   - Particle simulations and continuous rotations are disabled.
4. **Performance:**
   - Zero CPU/GPU animation loops while `closed`.
   - Hardware-accelerated CSS `transform` and `opacity` properties only.

---

## 7. Automated Test Suite Certification

The implementation has been verified with **66/66 (100%) passing automated E2E tests**:

```
✓ tests/e2e/sovra-core-spatial-command-phase2.test.ts  (21 passed)
✓ tests/e2e/spatial-surface-engine-phase1.test.ts     (23 passed)
✓ tests/e2e/spatial-surface-navigation.test.ts         (14 passed)
✓ tests/e2e/holographic-navigation.test.ts             (5 passed)
✓ tests/e2e/browser-script-syntax-gate.test.ts         (3 passed)
===================================================================
Total: 66 tests passing | 0 failures | 0 regressions
```

### Verified Scenarios:
- [x] SOVRA logo acts as sole navigation trigger in minimal idle state.
- [x] Permanent left rail and bottom navigation bar suppressed in normal state.
- [x] Core state machine strictly validates all transitions (`closed` $\rightarrow$ `opening` $\rightarrow$ `open` $\rightarrow$ `surface-active` $\rightarrow$ `open`/`closed`).
- [x] Radial nodes emerge from logo screen origin coordinates.
- [x] Profile node pushes Profile Surface with all 7 options.
- [x] Profile $\rightarrow$ Settings $\rightarrow$ Privacy $\rightarrow$ Profile Visibility maintains 100% Phase 1 compatibility.
- [x] Create node pushes Create Surface with all 9 creation modalities.
- [x] Core recedes to `surface-active` while surfaces are active, and restores when surfaces close.
- [x] ESC key and back button correctly unwind surface stack before closing Core.
- [x] Reduced motion preferences are strictly respected across all viewports.
- [x] Responsive orbital radius scales safely down to 360x800 without clipping.
