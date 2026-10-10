# SOVRA WebRTC Architecture

## 1. Overview & Architectural Principles

SOVRA provides a peer-to-peer (P2P), end-to-end encrypted (E2EE) real-time voice and video calling architecture designed for sovereign decentralization with high-reliability NAT/firewall traversal.

```
Caller (Alice)                                 Signaling Relay / Dev Server               Callee (Bob)
     │                                                     │                                    │
     ├────── 1. Authenticate (Session Token) ─────────────►│                                    │
     ├────── 2. getUserMedia() [Local Stream]              │                                    │
     ├────── 3. Create RTCPeerConnection                   │                                    │
     ├────── 4. Create SDP Offer (v=0...)                  │                                    │
     ├────── 5. POST /api/call/offer ─────────────────────►│                                    │
     │          (Checks Block, Active Call, Bounds)        ├────── Notification Dispatched ────►│
     │                                                     │◄───── GET /api/call/incoming ──────┤
     │                                                     │       (Receives SDP Offer)         ├────── getUserMedia()
     │                                                     │                                    ├────── Create RTCPeerConnection
     │                                                     │                                    ├────── setRemoteDescription(offer)
     │                                                     │                                    ├────── Flush queued ICE candidates
     │                                                     │                                    ├────── createAnswer() -> setLocalDescription()
     │                                                     │◄───── POST /api/call/answer ───────┤
     │◄───── GET /api/call/poll (Receives Answer) ─────────┤                                    │
     ├────── setRemoteDescription(answer)                  │                                    │
     ├────── Flush queued ICE candidates                   │                                    │
     │                                                     │                                    │
     │◄═════════════════════════ Trickle ICE Candidates (Host / SRFLX / Relay) ════════════════►│
     │                                                     │                                    │
     │◄═════════════════════════ DTLS-SRTP Secure Media Session (Voice/Video) ═════════════════►│
     │                                                     │                                    │
     ├────── POST /api/call/restart-ice (On Network Loss) ─►│                                   │
     │                                                     │                                    │
     ├────── POST /api/call/end (Hangs Up) ───────────────►│◄───── POST /api/call/end ──────────┤
     └────── Stop Tracks, Close PC, Teardown ──────────────┴────── Stop Tracks, Close PC ───────┘
```

---

## 2. Deterministic Call State Machine

The client and server maintain synchronized, deterministic call states. The `CALL_CONNECTED` state is never synthesized from timers or button clicks; it is derived strictly from real WebRTC underlying states:

```
  ┌──────────────┐
  │     IDLE     │
  └──────┬───────┘
         │
         ▼
  ┌────────────────────────┐
  │ PERMISSION_REQUESTING  │ (getUserMedia camera/mic prompt)
  └──────┬─────────────────┘
         │
         ▼
  ┌────────────────────────┐
  │   SIGNALING_OFFERING   │ (Local SDP Offer generated)
  └──────┬─────────────────┘
         │
         ▼
  ┌────────────────────────┐
  │   SIGNALING_RINGING    │ (Offer delivered, awaiting peer answer)
  └──────┬─────────────────┘
         │
         ▼
  ┌────────────────────────┐
  │   SIGNALING_ANSWERED   │ (SDP Answer applied as remote description)
  └──────┬─────────────────┘
         │
         ▼
  ┌────────────────────────┐
  │     ICE_CONNECTING     │ (Trickle ICE candidate pair evaluation)
  └──────┬─────────────────┘
         │
         ▼
  ┌────────────────────────┐
  │     ICE_CONNECTED      │ (ICE transport succeeded)
  └──────┬─────────────────┘
         │
         ▼
  ┌────────────────────────┐
  │    MEDIA_CONNECTING    │ (Waiting for ontrack remote media stream)
  └──────┬─────────────────┘
         │
         ├───► (Requires: iceConnectionState === 'connected' AND
         │              ontrack fired AND incoming RTP packets > 0)
         ▼
  ┌────────────────────────┐
  │     CALL_CONNECTED     │ ◄─────────────────────────┐
  └──────┬─────────────────┘                           │
         │                                             │
         ├───► [Network Disconnection]                 │
         │     │                                       │
         │     ▼                                       │
         │  ┌──────────────┐                           │
         │  │ RECONNECTING │ ───► [ICE Restart OK] ────┘
         │  └──────┬───────┘
         │         │
         │         ▼ (Recovery Timeout)
         │  ┌──────────────┐
         │  │    FAILED    │
         │  └──────┬───────┘
         │         │
         ▼         ▼
  ┌────────────────────────┐
  │         ENDED          │ (Teardown: tracks stopped, PC closed)
  └────────────────────────┘
```

---

## 3. SDP Offer / Answer Negotiation & Trickle ICE

1. **Offer Generation**:
   - `RTCPeerConnection.createOffer()` with `offerToReceiveAudio: true` and `offerToReceiveVideo: (callType === 'video')`.
   - `pc.setLocalDescription(offer)` starts local ICE gathering.
2. **SDP Integrity**:
   - Offers and answers are validated for standard `v=0` session descriptors and length bounds ($\le 64\text{ KB}$).
   - CRLF (`\r\n`) line terminations are preserved end-to-end to prevent parser failure in Chromium/Edge/WebKit engines.
3. **Trickle ICE & Candidate Queuing**:
   - ICE candidates arriving prior to `setRemoteDescription` are queued in `_iceCandidateQueue`.
   - Upon `setRemoteDescription` resolution, `flushQueuedIceCandidates()` asynchronously applies all queued candidates via `pc.addIceCandidate()`.
   - Identical candidates from the same peer leg are deduplicated to avoid redundant processing.
   - Per-leg candidate count is capped at 100 to prevent allocation exhaustion.

---

## 4. Media Track Management & Teardown

1. **Hardware Acquisition**:
   - Requests real `MediaStreamTracks` via `navigator.mediaDevices.getUserMedia`.
   - Fallback hierarchy: If video requested but camera fails, automatically falls back to audio-only with informative toast feedback.
2. **Mute / Unmute**:
   - Audio: `track.enabled = !_callIsMuted`.
   - Video: `track.enabled = _callVideoEnabled`.
3. **Teardown & Cleanup**:
   - When a call ends (normal hangup, rejection, failure, or timeout):
     1. Stop ringing audio oscillators/buffers.
     2. Stop all local `MediaStreamTrack` instances (`track.stop()`).
     3. Clear `srcObject` on local and remote `<video>` and `<audio>` DOM elements.
     4. Remove event listeners (`ontrack`, `onicecandidate`, `onconnectionstatechange`).
     5. Close `RTCPeerConnection` (`pc.close()`).
     6. Terminate WebRTC statistics polling intervals.
     7. Transition state machine to `ENDED` $\to$ `IDLE`.
