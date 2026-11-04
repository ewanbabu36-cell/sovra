# SOVRA PROTOCOL — ADVERSARIAL SECURITY FINDINGS REGISTER

**Date**: 2026-11-04  
**Auditor**: Independent Senior Security Auditor & Cryptographic Engineer  
**Classification**: High-Risk Adversarial & Architectural Findings  
**Assessment Target**: Sovra Monorepo (`scripts/dev-server.ts`, `packages/`, `scripts/routes/`, `scripts/database-engine.ts`)

---

## EXECUTIVE SUMMARY OF FINDINGS

During the adversarial verification audit, 5 security and implementation findings were identified, ranging from **Critical** to **Medium** severity. These findings represent discrepancies between claimed security guarantees and actual code implementation.

| Finding ID | Title | Severity | Impacted Component | Audit Status |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | Missing Cryptographic Circuit Pairing / Groth16 Verification in ZK Humanity Route | **CRITICAL** | `scripts/routes/zk.routes.ts:55-107` | **PARTIALLY VERIFIED** |
| **SEC-02** | WebAuthn PRF Hardware Key Derivation is a Console.log Stub in Browser Client | **HIGH** | `scripts/dev-server.ts:85167-85180` | **FAILED** |
| **SEC-03** | Disappearing Messages Soft-Redacted & Depend on Client Read Trigger; No Background Prune Daemon | **HIGH** | `scripts/database-engine.ts:3377-3396` | **PARTIALLY VERIFIED** |
| **SEC-04** | Ghost Mode is a Cosmetic LocalStorage / CSS Toggle with Zero Transport Layer Anonymity | **MEDIUM** | `scripts/dev-server.ts:47245-47280` | **FAILED** |
| **SEC-05** | Fallback In-Memory Auto-Login Uses Hardcoded Development Pin (`123456`) | **LOW** | `scripts/dev-server.ts:94944` | **PARTIALLY VERIFIED** |

---

## DETAILED FINDING SHEETS

### SEC-01: Missing Cryptographic Pairing / Groth16 Verification in ZK Humanity Route

- **Severity**: **CRITICAL** (CWE-347: Improper Verification of Cryptographic Signature / ZK Proof)
- **Location**: [`scripts/routes/zk.routes.ts`](file:///d:/Sovra/scripts/routes/zk.routes.ts#L55-L107)
- **Technical Explanation**:
  The endpoint `POST /api/zk/humanity/verify` claims to validate Semaphore ZK-SNARK zero-knowledge proofs of personhood. However, inspection of the source code reveals that neither `snarkjs`, `circomlibjs`, nor any elliptic curve pairing library (e.g. `groth16.verify(vk, publicSignals, proof)`) is imported or called.
  The server merely accepts any arbitrary JSON passed in `proofSnarkJson`:
  ```ts
  const proofSnark = body.proofSnarkJson || JSON.stringify({ pi_a: ['0x1', '0x2'], pi_b: [['0x3'], ['0x4']], pi_c: ['0x5'] });
  ```
  While the **Nullifier deduplication logic works** (preventing re-use of an identical nullifier), the mathematical validity of the proof is completely unchecked.
- **Reproduction Steps**:
  1. Craft a payload with completely fabricated SNARK proof:
     ```json
     {
       "subjectDid": "did:sovra:attacker_fake_math",
       "nullifierHash": "nullifier_random_nonce_999",
       "proofSnarkJson": "{\"fake_field\":\"totally_bogus_math_123\",\"pi_a\":[\"0x00\"],\"pi_b\":[[\"0x00\"]],\"pi_c\":[\"0x00\"]}"
     }
     ```
  2. Send `POST /api/zk/humanity/verify`.
  3. Observe response HTTP 200 with `"isHuman": true` and `"isVerifiedHuman": true`.
- **Actual Test Output**:
  ```json
  HTTP 200 OK
  {
    "ok": true,
    "badge": "🛡️ ZK-Human",
    "isHuman": true,
    "isVerifiedHuman": true,
    "attestation": {
      "attestationType": "proof_of_humanity",
      "proofSnarkJson": "{\"fake_field\":\"totally_bogus_math_123\",\"pi_a\":[\"0x00\"],\"pi_b\":[[\"0x00\"]],\"pi_c\":[\"0x00\"]}"
    }
  }
  ```
- **Remediation**:
  Integrate `snarkjs` and Semaphore verification key verification (`groth16.verify(verificationKey, [nullifierHash, externalNullifier], proofSnark)`). Reject the request if the cryptographic verification fails.

---

### SEC-02: WebAuthn PRF Hardware Key Derivation is a Console.log Stub in Browser Client

- **Severity**: **HIGH** (CWE-546: Suspicious Comment / Unimplemented Cryptographic Routine)
- **Location**: [`scripts/dev-server.ts`](file:///d:/Sovra/scripts/dev-server.ts#L85167-L85180)
- **Technical Explanation**:
  The application claims hardware-enclave biometric key derivation via the WebAuthn PRF (Pseudo-Random Function) extension (HMAC-SHA256 derived from TouchID/FaceID). In `packages/identity/src/passkey.ts`, an in-memory PasskeyManager models attestation proofs and ChaCha20Poly1305 cloud vaults.
  However, in the browser application controller (`scripts/dev-server.ts`), the actual implementation function `loginWithHardwareEnclavePrf()` is a non-functional stub:
  ```js
  async function loginWithHardwareEnclavePrf() {
    if (!window.PublicKeyCredential) {
      alert('WebAuthn Secure Enclave not supported on this browser.');
      return;
    }
    try {
      if (typeof showAccountToast === 'function') {
        showAccountToast('🔐 Authenticating via Hardware Secure Enclave PRF...');
      }
      // deriveKeyFromWebAuthnPrf transforms TouchID/FaceID raw PRF bits directly into root Ed25519 seed
      console.log('[Enclave] deriveKeyFromWebAuthnPrf active for seed-phrase-less master key derivation');
    } catch (_) {}
  }
  ```
  The code emits a `console.log()` statement and does not execute `navigator.credentials.get({ publicKey: { extensions: { prf: { eval: { first: salt } } } } })`.
- **Reproduction Steps**:
  1. Inspect `scripts/dev-server.ts` lines 85167 to 85180.
  2. Call `window.loginWithHardwareEnclavePrf()` in the browser developer console.
  3. Observe that no WebAuthn biometric prompt is triggered by the browser; only a console message is printed.
- **Remediation**:
  Implement true WebAuthn PRF extension bindings using `navigator.credentials.create()` with `prf: {}` and `navigator.credentials.get()` with `prf: { eval: { first: new Uint8Array(32) } }`. Derive the Ed25519 seed using HKDF-SHA256 from the resulting PRF byte array.

---

### SEC-03: Disappearing Messages Soft-Redacted & Depend on Client Read Trigger; No Background Prune Daemon

- **Severity**: **HIGH** (CWE-226: Sensitive Information in Resource Not Removed Before Reuse / Delayed Erasure)
- **Location**: [`scripts/database-engine.ts`](file:///d:/Sovra/scripts/database-engine.ts#L3377-L3396) & [`scripts/routes/chat.routes.ts`](file:///d:/Sovra/scripts/routes/chat.routes.ts#L222)
- **Technical Explanation**:
  The protocol advertises disappearing messages that vanish upon TTL expiration.
  Inspection of `purgeExpiredDisappearingMessages()` reveals two critical architectural gaps:
  1. **Soft Redaction**: Expired messages are not removed from `this.db.chatMessages`. Instead, `msg.text` is replaced with `'💨 Message disappeared'` and `msg.isDisappeared = true`. The metadata record (sender DID, recipient DID, timestamp, message ID) remains in database storage indefinitely.
  2. **Reactive Execution Only**: The purge function is only invoked when an authenticated client requests `/api/chat/messages` or `/api/chat/history`. There is no standing background cron or worker timer (e.g. `setInterval`) continuously expunging expired data while nodes are idle.
- **Reproduction Steps**:
  1. Send a disappearing message with `disappearingDurationSec: 1` (1-second TTL).
  2. Wait 3 seconds without requesting `/api/chat/messages`.
  3. Inspect `.sovra-storage-dev/dynamic-social-state.json` on disk.
  4. Observe that the confidential plaintext is still physically present on disk until `/api/chat/messages` is requested.
- **Remediation**:
  1. Implement physical record splicing: `this.db.chatMessages = this.db.chatMessages.filter(m => !isExpired(m));`.
  2. Add an active background pruning interval: `setInterval(() => sovraDb.purgeExpiredDisappearingMessages(), 10000)`.
  3. Execute `sqlite.prepare('DELETE FROM direct_messages WHERE expires_at <= ?').run(Date.now())` for SQLite WAL storage.

---

### SEC-04: Ghost Mode is a Cosmetic LocalStorage / CSS Toggle with Zero Transport Layer Anonymity

- **Severity**: **MEDIUM** (CWE-319: Cleartext Transmission of Sensitive Information / Misleading Privacy Controls)
- **Location**: [`scripts/dev-server.ts`](file:///d:/Sovra/scripts/dev-server.ts#L47245-L47280)
- **Technical Explanation**:
  The UI offers a "Ghost Mode" toggle in user settings described as "Incognito Ephemeral Routing".
  The implementation is solely a client-side localStorage flag:
  ```js
  function isGhostModeActive() {
    return localStorage.getItem('sovra_ghost_mode') === 'true';
  }
  function toggleGhostMode(e) {
    localStorage.setItem('sovra_ghost_mode', next ? 'true' : 'false');
    applyGhostModeVisuals();
  }
  ```
  `applyGhostModeVisuals()` only toggles the CSS class `.is-ghost` on the avatar presence pill.
  All network requests continue to use plain HTTP/WebSocket without Tor, I2P, multi-hop onion routing, or IP masking. WebRTC ICE candidates continue to leak the user's real local and public IP addresses.
- **Reproduction Steps**:
  1. Enable Ghost Mode in the UI.
  2. Inspect HTTP network traffic in browser DevTools or Wireshark.
  3. Observe that source IP headers, user-agent, and bearer tokens are sent normally to the dev server with zero packet-level obfuscation.
- **Remediation**:
  Clarify UI text to accurately indicate that Ghost Mode is an "Appear Offline" presence status rather than a network-layer anonymizing tunnel, or integrate an actual multi-hop Sphinx packet relay / Tor SOCKS5 transport adapter.

---

### SEC-05: Fallback In-Memory Auto-Login Uses Hardcoded Development Pin (`123456`)

- **Severity**: **LOW** (CWE-798: Use of Hard-coded Credentials)
- **Location**: [`scripts/dev-server.ts`](file:///d:/Sovra/scripts/dev-server.ts#L94944)
- **Technical Explanation**:
  In the user registration endpoint `POST /api/user/register`, if no `securityPin` is passed in the request body, the server assigns a default PIN:
  ```ts
  const securityPin = parsed.securityPin ? String(parsed.securityPin).trim() : (parsed.pin ? String(parsed.pin).trim() : '123456');
  ```
- **Remediation**:
  Enforce mandatory PIN specification or require an explicit Passkey WebAuthn registration credential upon account creation.
