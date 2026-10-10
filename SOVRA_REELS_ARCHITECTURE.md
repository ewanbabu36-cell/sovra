# SOVRA Reels Architecture & Vertical Media Engine

## 1. Executive Summary: `SovraReelsSurface`
The SOVRA Reels engine (`apps/sovra-app/src/ui/sovra-media/SovraReelsSurface.ts`) provides an ultra-fast, minimal 9:16 vertical video feed designed for sovereign short-form media.

```
+------------------------------------+
| [<- Back]          Reels        [X]|
+------------------------------------+
|                                    |
|                                    |
|             9:16 CANVAS            |
|             (Full Height)          |  [❤️ Like]
|                                    |   12.4k
|                                    |
|                                    |  [💬 Comment]
|                                    |   892
|                                    |
|                                    |  [🔖 Save]
|                                    |   310
|                                    |
|                                    |  [🔗 Share]
| @creator_did                       |
| Sovereign Mesh Nodes live demo...  |
| 🎵 Original Audio • Sovra Mesh     |
+------------------------------------+
```

---

## 2. Interaction Model & Gesture Handling

### Minimal Floating Overlay
- No permanent sidebar or bulky control decks.
- Floating right-aligned actions:
  - **Like**: Instant optimistic like toggle persisted to `/api/reels/like`.
  - **Comments**: Opens nested spatial drawer without interrupting video playback.
  - **Save**: Saves to personal collections via `/api/media/save`.
  - **Share**: Invokes native sharing or clipboard reference.

### Desktop & Mobile Controls
- **Touch Swipe**: Upward swipe advances to next reel; downward swipe returns to previous.
- **Mouse Wheel**: Throttled wheel detection switches reels with smooth spring inertia.
- **Keyboard Navigation**:
  - `ArrowDown` / `PageDown` $\rightarrow$ Next Reel.
  - `ArrowUp` / `PageUp` $\rightarrow$ Previous Reel.
  - `Space` $\rightarrow$ Toggle Play / Pause.
  - `M` $\rightarrow$ Toggle Mute.

---

## 3. Bounded Preloading & Resource Management
Unbounded video downloading consumes excessive client bandwidth and quickly crashes mobile browser hardware decoders. The SOVRA Reels engine enforces:

```
[ ... Detached ... ] <-> [ Reel i-1 ] <-> [ Reel i (Active) ] <-> [ Reel i+1 ] <-> [ ... Detached ... ]
                             Paused              Playing             Preloaded
```

1. **Active Item ($i$)**: Video is unmuted (or user muted) and playing with hardware acceleration.
2. **Next Item ($i+1$)**: Video element initialized with `preload="metadata"` or first slice buffering.
3. **Previous Item ($i-1$)**: Video element paused and kept at current scrub position.
4. **All Other Items ($|j - i| > 1$)**: Video elements detached from the DOM; `.src = ''` called; decoder contexts released.
5. **Surface Pop**: When user navigates back to Home or Watch, all active downloads are cancelled immediately.
