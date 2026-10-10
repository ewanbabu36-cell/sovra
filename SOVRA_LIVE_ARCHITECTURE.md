# SOVRA Live Streaming Architecture & State Machine

## 1. Executive Summary & Live State Machine
Live streaming on SOVRA bridges decentralized WebRTC media channels with persistent mesh telemetry. To eliminate client deception, live streams are governed by a **strict finite state machine (FSM)**.

```
       +--------------+
       |  SCHEDULED   |
       +-------+------+
               |
               v
       +--------------+
       |   STARTING   |
       +-------+------+
               |
               v
       +--------------+
       |     LIVE     | <----> [ Active WebRTC Broadcast & Swarm ]
       +-------+------+
               |
               v
       +--------------+
       |    ENDING    |
       +-------+------+
               |
               v
       +--------------+
       |    ENDED     |
       +-------+------+
               |
               v
       +--------------+
       |    REPLAY    |
       +--------------+
```

### Strict Transition Validation:
- `SCHEDULED` $\rightarrow$ `STARTING`, `LIVE`, `ENDED`.
- `STARTING` $\rightarrow$ `LIVE`, `ENDED`.
- `LIVE` $\rightarrow$ `ENDING`, `ENDED`.
- `ENDING` $\rightarrow$ `ENDED`, `REPLAY`.
- `ENDED` $\rightarrow$ `REPLAY`, `SCHEDULED`.
- `REPLAY` $\rightarrow$ `ENDED`.
- Any illegal transition (e.g. `LIVE` $\rightarrow$ `SCHEDULED`) is strictly rejected by the server with `HTTP 400 Bad Request`.
- **Zero Simulation Rule**: No `setTimeout(() => LIVE)` is permitted. Only authenticated host signaling can advance the session.

---

## 2. Live Viewer Surface (`SovraLiveViewerSurface`)

```
+------------------------------------------------------------------------+
| [<- Back]  🔴 LIVE (842 Viewers) • Tech Keynote               [Share] [X]
+---------------------------------------------------+--------------------+
|                                                   |  LIVE CHAT         |
|                                                   |  Moderator controls|
|                                                   |                    |
|             WEBRTC / HLS STREAM CANVAS            |  @alice: Amazing!  |
|                                                   |  @bob: Low latency |
|                                                   |                    |
|                                                   |  [X Delete Msg]    |
|                                                   |  (Host/Mod only)   |
|                                                   |                    |
+---------------------------------------------------+--------------------+
| [❤️ 429 Likes]   [Tip Host]   Channel: @sovra_alpha [Send chat input...]
+------------------------------------------------------------------------+
```

### Key Capabilities:
1. **Realtime Telemetry**: Active viewer count and audience reactions updated live.
2. **Moderated Realtime Chat**: Audience members can participate in live room chat.
3. **Role-Based Message Moderation**:
   - Host DID and channel moderators (`OWNER`, `ADMIN`, `MODERATOR`) can instantly delete abusive messages via `POST /api/live/chat/delete`.
   - Peer users attempting unauthorized message deletion receive `HTTP 403 Forbidden`.

---

## 3. Live Session Creation & Studio Integration
- Creators initialize live sessions via `POST /api/live/create`.
- Verifies hardware device permissions (WebRTC camera/mic) and generates signaling room tokens.
- Live sessions attach automatically to the creator's channel and appear on the Watch surface under the `Live` filter.
