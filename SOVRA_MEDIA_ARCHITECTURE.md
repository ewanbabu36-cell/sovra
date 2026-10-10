# SOVRA — Phase 5: Media Experience Architecture

## 1. Executive Summary & Design Vision
The SOVRA Phase 5 Media Experience integrates video, audio, image, and real-time streaming pipelines directly into SOVRA's **Spatial Surface Engine**. Unlike legacy social platforms that trap media inside fragmented page reloads or rigid modal dialogs, SOVRA treats media playback as first-class holographic surfaces that maintain fluid spatial continuity, bounded resource utilization, and peer-to-peer data provenance.

```
+-------------------------------------------------------------------------+
|                           SOVRA COMMAND CORE                            |
+------------------------------------+------------------------------------+
                                     |
           +-------------------------+-------------------------+
           |                                                   |
           v                                                   v
   [ WATCH SURFACE ]                                  [ REELS SURFACE ]
  (16:9 Long-Form & Channels)                        (9:16 Vertical Canvas)
           |                                                   |
           v                                                   v
+-----------------------+                             +-----------------------+
|  Video Viewer Surface |                             |  Reel Viewer Surface  |
|  - Play / Seek / Rate |                             |  - Gesture / Swipe    |
|  - Bounded 206 Stream |                             |  - Floating Actions   |
|  - Real Tips & Chat   |                             |  - 3-Item Preload Max |
+-----------------------+                             +-----------------------+
           ^                                                   ^
           |                                                   |
           +-------------------------+-------------------------+
                                     |
                       [ LIVE STREAMING ENGINE ]
                   (FSM: SCHEDULED -> LIVE -> REPLAY)
                   (WebRTC Mesh & Moderated Chat)
```

---

## 2. Spatial Surface Hierarchy & Navigation Flows

### Core Media Entry Points
1. **Command Core $\rightarrow$ Watch $\rightarrow$ Media Surface $\rightarrow$ Video Viewer**:
   - Radial selection opens `SovraWatchSurface` centered on the viewport.
   - Categorized real feeds (`All`, `Tech`, `Gaming`, `Decentralized`, `Live`).
   - Clicking any video card opens `SovraVideoViewerSurface` with spatial zoom-in transition.
2. **Command Core $\rightarrow$ Reels $\rightarrow$ Vertical Media Surface $\rightarrow$ Reel Viewer**:
   - Radial selection opens `SovraReelsSurface` directly in full-height 9:16 layout.
   - Minimalist gesture stack: mouse wheel, touch swipe, keyboard arrows $\uparrow$/$\downarrow$.
3. **Channel / Space $\rightarrow$ Videos $\rightarrow$ Playlists $\rightarrow$ Video Viewer**:
   - Channels expose their curated video repository and categorized playlists (`SovraPlaylistSurface`).
   - Clicking a playlist opens `SovraPlaylistViewSurface` with ordered items and one-click viewer launch.
4. **Feed Post $\rightarrow$ Media Thumbnail $\rightarrow$ Media Viewer Surface**:
   - Single-item and multi-asset posts open `SovraMediaViewerSurface` for high-resolution image/video inspection.

---

## 3. Strict Media Lifecycle & Performance Rules

### A. Memory Leak Prevention & Hardware Decoders
- Browser hardware video decoders are strictly limited. Keeping dozens of video elements mounted or playing in background tabs degrades frame rates and triggers decoder crashes.
- **Rule**: When any video or reel surface pops or loses active visibility, the underlying `<video>` element is immediately paused, its `.src` is cleared, and `.load()` is invoked to release GPU decoder contexts.
- **Rule**: At any moment in the Reels experience, exactly **one** primary video is playing.

### B. Bounded Preload Limits
- The Reels engine enforces a window of $[-1, 0, +1]$:
  - Position $0$: actively playing.
  - Position $+1$: preloaded with `preload="metadata"` or low-chunk partial buffer.
  - Position $-1$: preserved in DOM for instant reverse scrub.
  - All items $|i| > 1$: detached from active network decoding pipelines.

---

## 4. Unified Data Schema & Endpoints Matrix

| Capability | HTTP Route | Method | Access Control |
|---|---|---|---|
| Watch Catalog | `/api/youtube/videos` | `GET` | Public |
| Video Details | `/api/youtube/video?id={id}` | `GET` | Public / Verified DID |
| Video Streaming | `/api/feed/video/{cid}` | `GET` | RBAC & BOLA Enforced |
| Reels Feed | `/api/reels/list` | `GET` | Public |
| Reel Like | `/api/reels/like` | `POST` | Authenticated Bearer |
| Reel Comment | `/api/reels/comment` | `POST` | Authenticated Bearer |
| Playlists List | `/api/playlists` | `GET` | Channel / Public |
| Playlist View | `/api/playlists/view?id={id}` | `GET` | Public / Space Member |
| Playlist CRUD | `/api/playlists/{create,reorder,delete}` | `POST` | Playlist Creator / Channel Admin |
| Live Sessions | `/api/live/sessions` | `GET` | Public |
| Live State Machine | `/api/live/status` | `POST` | Host DID / Channel Admin |
| Live Chat | `/api/live/chat` | `GET` / `POST` | Room Audience |
| Live Moderation | `/api/live/chat/delete` | `POST` | Channel Moderator / Super Admin |
| Watch History | `/api/watch/history` | `GET` / `POST` | User DID ($\ge 5$s Threshold) |
| Saved Media | `/api/media/save`, `/api/media/saved` | `GET` / `POST` | User DID (Deduplicated) |

---

## 5. Back Navigation & Spatial Stacking
- Video playback surfaces maintain non-destructive spatial history.
- Clicking the back button (`← Back`) or pressing `Escape` pops the viewer surface and restores focus to the originating catalog or channel surface without triggering full-page reload or re-fetching network catalogs.
