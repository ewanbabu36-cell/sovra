# SOVRA PROTOCOL — FAILED ADVERSARIAL TESTS & GAPS REGISTER

**Date**: 2026-11-04  
**Auditor**: Independent Senior Security Auditor & Cryptographic Engineer  
**Status**: Critical Gaps, Simulation Stubs, and Failed Verification Scenarios

---

## 1. FAILED TEST: ZK-SNARK CIRCUIT PROOF FORGERY (SEC-01)

- **Test Name**: `zk_bogus_proof_acceptance_test`
- **Component**: [`scripts/routes/zk.routes.ts:55-107`](file:///d:/Sovra/scripts/routes/zk.routes.ts#L55-L107)
- **Claimed Guarantee**: Mathematical validation of Semaphore ZK-SNARK zero-knowledge personhood proof.
- **Test Executed**:
  An adversarial client generated completely fabricated, non-curve values:
  ```json
  {
    "subjectDid": "did:sovra:zk_attacker_forged",
    "nullifierHash": "nullifier_forged_9999",
    "proofSnarkJson": "{\"fake_field\":\"totally_bogus_math_123\",\"pi_a\":[\"0x00\"],\"pi_b\":[[\"0x00\"]],\"pi_c\":[\"0x00\"]}"
  }
  ```
- **Expected Outcome**: HTTP 400 or HTTP 422 with `Invalid zero-knowledge proof: pairing check failed`.
- **Actual Outcome**: **HTTP 200 OK**
  ```json
  {
    "ok": true,
    "badge": "🛡️ ZK-Human",
    "isHuman": true,
    "isVerifiedHuman": true
  }
  ```
- **Why It Failed**:
  The route controller does not invoke `snarkjs.groth16.verify()` or any elliptic curve bilinear pairing algorithm. It merely stores the string in database JSON. Any user can claim "🛡️ ZK-Human" with garbage input.
- **Audit Verdict**: **FAILED** (Proof Verification Stub).

---

## 2. FAILED TEST: WEBAUTHN PRF HARDWARE BROWSER DERIVATION (SEC-02)

- **Test Name**: `webauthn_prf_browser_invocation_test`
- **Component**: [`scripts/dev-server.ts:85167-85180`](file:///d:/Sovra/scripts/dev-server.ts#L85167-L85180)
- **Claimed Guarantee**: Seed-phrase-less master key derivation from TouchID/FaceID raw PRF bits.
- **Test Executed**:
  Invoked `loginWithHardwareEnclavePrf()` via headless browser agent and inspected client source code.
- **Expected Outcome**: Invocation of `navigator.credentials.get({ publicKey: { extensions: { prf: { eval: ... } } } })` followed by HKDF-SHA256 derivation of Ed25519 root seed.
- **Actual Outcome**:
  ```js
  // deriveKeyFromWebAuthnPrf transforms TouchID/FaceID raw PRF bits directly into root Ed25519 seed
  console.log('[Enclave] deriveKeyFromWebAuthnPrf active for seed-phrase-less master key derivation');
  ```
  Only a `console.log()` statement is executed. No WebAuthn credential retrieval or PRF evaluation takes place in the browser client.
- **Why It Failed**:
  The developer wrote a comment and a `console.log` message without implementing the actual WebAuthn Level 3 PRF extension calls.
- **Audit Verdict**: **FAILED** (Console.log Stub).

---

## 3. FAILED TEST: DISAPPEARING MESSAGES PHYSICAL DISK ERASURE (SEC-03)

- **Test Name**: `disappearing_messages_background_purging_test`
- **Component**: [`scripts/database-engine.ts:3377-3396`](file:///d:/Sovra/scripts/database-engine.ts#L3377-L3396)
- **Claimed Guarantee**: Permanent physical deletion of messages upon TTL expiration.
- **Test Executed**:
  1. Sent a message with `disappearingDurationSec: 1`.
  2. Waited 2.2 seconds without sending any HTTP requests.
  3. Inspected disk storage at `.sovra-storage-dev/dynamic-social-state.json`.
- **Expected Outcome**: Plaintext string completely absent from file system storage.
- **Actual Outcome**:
  The plaintext string remained on disk in cleartext. It was only soft-redacted when a subsequent client executed `GET /api/chat/messages`. Even after the API was called, the message record itself was never removed (it was merely overwritten with `"💨 Message disappeared"`).
- **Why It Failed**:
  Lack of an asynchronous background worker process and use of soft-redaction instead of physical record deletion (`array.splice`).
- **Audit Verdict**: **FAILED** (Delayed & Incomplete Deletion).

---

## 4. FAILED TEST: GHOST MODE NETWORK ANONYMITY (SEC-04)

- **Test Name**: `ghost_mode_network_obfuscation_test`
- **Component**: [`scripts/dev-server.ts:47245-47280`](file:///d:/Sovra/scripts/dev-server.ts#L47245-L47280)
- **Claimed Guarantee**: "Incognito Ephemeral Routing" and zero IP / location tracking.
- **Test Executed**:
  1. Toggled Ghost Mode via `toggleGhostMode()`.
  2. Inspected client requests, headers, and server logging.
- **Expected Outcome**: Network packet routing via onion relays or proxy tunnel; masking of client IP address and WebRTC ICE candidates.
- **Actual Outcome**:
  Ghost Mode simply sets `localStorage.setItem('sovra_ghost_mode', 'true')` and toggles `.is-ghost` on the avatar presence element. All HTTP requests, WebSocket packets, and WebRTC STUN/TURN traffic continue over the user's real public IP address.
- **Why It Failed**:
  Ghost Mode is purely an "Appear Offline" UI badge, not a network anonymity protocol.
- **Audit Verdict**: **FAILED** (Cosmetic UI Only).
