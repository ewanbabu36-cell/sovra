# SOVRA WebRTC Security & Defense Architecture

## 1. Threat Model & Security Boundaries

The SOVRA WebRTC signaling and media architecture enforces zero-trust boundaries across decentralized peer communication:

```
  Threat Vector                          Mitigation Mechanism
  ─────────────────────────────────────  ───────────────────────────────────────────────────────
  1. Signaling Identity Spoofing         Identity derived strictly from Bearer Session Token (DID)
  2. BOLA / IDOR Cross-Session Access    Caller/Recipient validation on every call operation
  3. SDP Bomb / Memory Exhaustion        Strict payload size limits (≤ 64 KB) and format checks
  4. ICE Candidate Flooding / DoS        100 candidates per peer cap & exact deduplication
  5. Replay Attacks                      Stale nonces (600s) & stateful call transition checks
  6. Eavesdropping / Media Tampering     Mandatory DTLS-SRTP encryption with ECDSA/Ed25519
  7. Harassment / Stalking               Bidirectional block enforcement across all call routes
  8. Concurrent Call Desynchronization   Single active call per DID gate (486 Busy / 409 Conflict)
```

---

## 2. BOLA / IDOR Defense Matrix

Every call-related HTTP API endpoint derives the acting user's DID from the authenticated cryptographic session token. Caller-provided identity fields in JSON request payloads are strictly ignored:

| API Endpoint | Method | Permitted Actors | Unauthorized Attempt Response |
| :--- | :---: | :--- | :--- |
| `/api/call/offer` | `POST` | Authenticated Caller | `401 Unauthorized` without token; `403` if blocked |
| `/api/call/incoming` | `GET` | Callee only (`recipientDid === userDid`) | `401 Unauthorized` |
| `/api/call/poll` | `GET` | Caller or Callee only | `403 Forbidden: Unauthorized access to call session` |
| `/api/call/answer` | `POST` | Designated Callee only (`recipientDid === userDid`) | `403 Forbidden: Only the designated recipient can answer` |
| `/api/call/candidate` | `POST` | Caller or Callee only | `403 Forbidden: Unauthorized candidate submission` |
| `/api/call/restart-ice` | `POST` | Caller or Callee only | `403 Forbidden: Unauthorized ICE restart` |
| `/api/call/end` | `POST` | Caller or Callee only | `403 Forbidden: Unauthorized call termination` |
| `/api/call/metrics` | `GET` | Session participants or Platform Admins | Filtered strictly to caller's calls |

---

## 3. Payload Integrity & Validation Bounds

### SDP Offer / Answer Validation:
* Maximum allowed size: **65,536 bytes (64 KB)**.
* Header verification: Must start with `v=0` and include media section markers (`m=audio` or `m=video`).
* Line ending preservation: Trailing CRLF (`\r\n`) sequences are strictly retained to prevent SDP parser corruption in Chromium/WebKit engines.

### ICE Candidate Validation:
* Maximum allowed size: **4,096 bytes (4 KB)**.
* Deduplication: Exact matching against existing `(senderDid, candidateString)` pairs prevents array bloating.
* Candidate allocation limit: Maximum **100 candidates** accepted per peer leg.
* Late candidate rejection: Candidates received after call status has transitioned to `ended` or `rejected` are dropped with `409 Conflict`.

---

## 4. Concurrency & State Machine Integrity

To prevent ghost calls and race conditions:
1. **Busy State Enforcement**: If User B receives a call offer while already in an active session (`status === 'offering' | 'ringing' | 'answered' | 'connected'`), the server rejects the incoming attempt with `486 Busy Here` (`code: 'BUSY'`).
2. **Caller Conflict Gate**: If User A attempts to initiate a new call while an existing call remains open, the server rejects the attempt with `409 Conflict` (`code: 'ALREADY_IN_CALL'`).
3. **Anti-Replay**: An answered call cannot be answered a second time (`409 Conflict`). An ended call cannot receive further signaling mutations.
