# SOVRA Video Viewer Architecture & Streaming Engine

## 1. Component Overview: `SovraVideoViewer`
`SovraVideoViewer` (`apps/sovra-app/src/ui/sovra-media/SovraVideoViewer.ts`) provides a production-grade 16:9 spatial media player designed for high-bitrate long-form video, tutorials, and decentralized broadcasts.

```
+-------------------------------------------------------------------------+
| [<- Back]    Video Title • Channel Name               [Share] [Save] [X]|
+-------------------------------------------------------------------------+
|                                                                         |
|                         16:9 HTML5 VIDEO CANVAS                         |
|                    (P2P BitSwap / Range Streaming)                      |
|                                                                         |
+-------------------------------------------------------------------------+
| [> Play]  03:14 / 12:45  [=======================O======]  [Vol] [1.0x] [FS]
+-------------------------------------------------------------------------+
| [Like: 1,420]   [Tip Creator]   [Subscribe]                             |
+-------------------------------------------------------------------------+
| Metadata & Description: RFC 8216 HLS & BitSwap Chunk Validation        |
+-------------------------------------------------------------------------+
| Realtime Comments & Audience Interactions (Double Ratchet Verified)     |
+-------------------------------------------------------------------------+
```

---

## 2. Playback Engine Capabilities

### Player Controls & UX
- **Play / Pause**: Click canvas, spacebar toggle, or primary control button.
- **Scrubbing & Seek Bar**: Interactive progress bar allowing instant seek across entire duration without pre-fetching unplayed portions.
- **Volume & Mute**: Fine slider control with audio node volume scaling ($0.0$ to $1.0$).
- **Playback Rate**: Granular rate switcher (`0.5x`, `0.75x`, `1.0x`, `1.25x`, `1.5x`, `2.0x`).
- **Native Fullscreen**: Cross-platform WebKit / Blink fullscreen request with custom player overlay.
- **Time Indicators**: Real formatted time display (`MM:SS` or `HH:MM:SS`) synced to `video.currentTime` and `video.duration`.

---

## 3. Byte-Range Streaming Pipeline (HTTP 206)

To support instant seeking and prevent network bandwidth exhaustion, the backend server implements full RFC 7233 byte-range slicing:

```
Browser Player                       Sovra Node / Daemon
      |                                       |
      |  GET /api/feed/video/{cid}            |
      |  Range: bytes=0-1023                  |
      |-------------------------------------->|
      |                                       |
      |  HTTP 206 Partial Content             |
      |  Content-Range: bytes 0-1023/16384    |
      |  Accept-Ranges: bytes                 |
      |<--------------------------------------|
      |                                       |
      |  (User scrubs to middle: 4096-8191)   |
      |  GET /api/feed/video/{cid}            |
      |  Range: bytes=4096-8191               |
      |-------------------------------------->|
      |                                       |
      |  HTTP 206 Partial Content             |
      |  Content-Range: bytes 4096-8191/16384 |
      |<--------------------------------------|
```

### Response Headers Specification:
- **Status Code**: `206 Partial Content` (when `Range` header is present), or `200 OK` (when no range is specified).
- **`Accept-Ranges`**: `bytes`.
- **`Content-Range`**: `bytes {start}-{end}/{totalLength}`.
- **`Content-Length`**: Exact length of the sliced chunk (`end - start + 1`).
- **`Content-Type`**: Video MIME type (`video/mp4`, `video/webm`, `video/quicktime`).
- **Out of Range (416)**: When requested offset $\ge \text{fileSize}$, server responds with `HTTP 416 Range Not Satisfiable` and `Content-Range: bytes */{totalLength}`.

---

## 4. Creator Monetization & Audience Engagement
- **Sovereign Tips**: Viewer can tip creator directly via `/api/watch/tip` with micro-settlement vouchers.
- **Channel Subscriptions**: Instant toggle with optimistic counter increment and server synchronization (`/api/youtube/subscribe`).
- **Comments Threading**: Supports nested responses and thread-level reactions without reload.
