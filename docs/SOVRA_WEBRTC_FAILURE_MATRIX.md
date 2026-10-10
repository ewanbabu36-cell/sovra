# SOVRA WebRTC Failure Matrix & Recovery Pathways

## 1. Failure Injection Scenarios & Recovery Responses

The table below catalogs system behavior across anomalous network, hardware, signaling, and security conditions:

| Scenario ID | Injected Failure Condition | Expected System Behavior | Actual Implementation & Recovery Pathway | Status |
| :--- | :--- | :--- | :--- | :---: |
| **FAIL-01** | **Camera Permission Denied** | Inform user; fallback gracefully to voice-only call. | `initCallLocalMediaStream` catches `NotAllowedError`, shows warning toast, requests audio-only stream, and proceeds with voice calling. | **PASS** |
| **FAIL-02** | **Microphone Hardware Missing** | Display informative error; abort negotiation cleanly. | Throws descriptive error (`No audio recording devices found`), sets call state to `FAILED`, cleans up DOM and active call ID after 3s. | **PASS** |
| **FAIL-03** | **Signaling Disconnection During Ringing** | Ringing timeout triggers; clean state teardown. | 45-second timer (`ringSeconds >= 45`) triggers automatic hangup (`no_answer`), emits disconnect tone, and cleans up peer connection. | **PASS** |
| **FAIL-04** | **ICE Gathering / Traversal Failure** | Transition state to `FAILED`; close peer connection. | `oniceconnectionstatechange` detects `failed`, sets state `FAILED`, displays "ICE connection could not be established", and calls `endE2eeCall('ice_failed')`. | **PASS** |
| **FAIL-05** | **Transient Network Disconnect (Wi-Fi drop)** | Detect disconnection; initiate ICE restart. | `oniceconnectionstatechange` detects `disconnected`, sets state `RECONNECTING`, invokes `pc.restartIce()`, and calls `POST /api/call/restart-ice`. | **PASS** |
| **FAIL-06** | **Remote Peer Tab Closed / Killed** | Polling detects session end or heartbeat drop. | `pollIncomingCalls` detects absence of active session, cleans up local media tracks, pauses video/audio players, and sets state to `ENDED`. | **PASS** |
| **FAIL-07** | **Expired / Invalid Session Token** | Rejection of signaling requests with HTTP 401. | Dev-server `enforceAuth` rejects with `401 Unauthorized`. Client redirects to sign-in modal. | **PASS** |
| **FAIL-08** | **Oversized / Malformed SDP Bomb** | Server rejects payload before deserialization. | Server bounds body to 64 KB and validates `v=0` header; rejects with `400 Bad Request`. | **PASS** |
| **FAIL-09** | **Simultaneous Call Attempt (Callee Busy)** | Inbound caller receives 486 Busy Here. | Server `getActiveCallForUser` detects existing non-expired session and returns `{ ok: false, error: 'User is currently busy', code: 'BUSY' }` (486). | **PASS** |
| **FAIL-10** | **Caller Attempting Second Call** | Outbound caller receives 409 Conflict. | Server detects caller already in active session and returns `{ ok: false, error: 'Caller is already engaged in an active call', code: 'ALREADY_IN_CALL' }` (409). | **PASS** |

---

## 2. Recovery Pathway State Transitions

```
               [Active Connected Call]
                          │
            Network Anomaly / NAT Change
                          │
                          ▼
            iceConnectionState == 'disconnected'
                          │
                          ▼
             setCallState(RECONNECTING)
                          │
             pc.restartIce() + POST /api/call/restart-ice
                          │
         ┌────────────────┴────────────────┐
         │                                 │
   ICE Reconnected                  Timeout Exceeded
   (iceState == 'connected')        (iceState == 'failed')
         │                                 │
         ▼                                 ▼
   setCallState(CALL_CONNECTED)     setCallState(FAILED)
         │                                 │
   Resume Media Streams             endE2eeCall('connection_failed')
                                           │
                                           ▼
                                    Full Teardown
```

---

## 3. Resource Cleanup Audit

For every failure scenario, automated testing in `sovra-webrtc-production-phase9.test.ts` and `call-termination-sync.test.ts` confirms:
1. All local media tracks are stopped (`track.readyState === 'ended'`).
2. `RTCPeerConnection.signalingState === 'closed'`.
3. Event listeners are unbound (`null`).
4. Timers and interval handles (`callTimerInterval`, `_statsInterval`) are cleared.
5. Inactive call sessions are marked `ended` or `rejected` with appropriate reasons.
