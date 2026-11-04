# SOVRA PROTOCOL — INDEPENDENT ADVERSARIAL VERIFICATION AUDIT REPORT

**Date of Audit**: 2026-11-04  
**Audit Type**: Independent Adversarial Verification, Source Code Inspection & Penetration Testing  
**Auditor Roles**: Senior Security Auditor, Cryptographic Engineer, Backend Security Researcher, QA Engineer  
**Target Repository**: Sovra Monorepo (`scripts/dev-server.ts`, `packages/*`, `scripts/routes/*`, `scripts/database-engine.ts`)  
**Assessment Protocol**: Zero-Trust Adversarial Review (No developer assertions, comments, or console logs accepted as proof)

---

## 1. EXECUTIVE AUDIT SUMMARY

This independent security audit was commissioned to objectively investigate and rigorously verify the cryptographic, architectural, and security claims made regarding the **SOVRA Sovereign Mesh Protocol**.

### Summary of Findings:
- **Real Cryptographic Strengths**:
  - W3C `did:key` Ed25519 identity generation (RFC 8032) is **fully implemented** using `@noble/curves`. Private keys are properly isolated within private class fields (`#privateKey`).
  - Zero Phone / Zero Email onboarding is **verified**. The registration schema neither prompts for nor stores telephone numbers or email addresses.
  - Two-Tier Inbox classification and BOLA/IDOR cross-account message authorization are **enforced** with HTTP 403 Forbidden.
  - Stranger Message Blocking via `/api/user/privacy` (`canMessageMe: 'friends'`) is **active and enforced**.
  - A real TCP socket listener is **actively bound on `127.0.0.1:4001`**, and the `Noise_XX_25519_ChaChaPoly_SHA256` protocol framework is implemented in `packages/p2p/src/transport.ts`.
- **Identified Gaps & Simulation Stubs**:
  - **ZK-SNARK Humanity Proof (SEC-01)**: The endpoint `/api/zk/humanity/verify` enforces Nullifier deduplication (preventing replay attacks), but **completely lacks elliptic curve bilinear pairing checks (`snarkjs.groth16.verify`)**. Forged proofs with bogus inputs are accepted. Status: **PARTIALLY VERIFIED**.
  - **WebAuthn PRF Extension (SEC-02)**: The client function `loginWithHardwareEnclavePrf()` in `scripts/dev-server.ts` is a **stub containing a `console.log` statement**. It does not invoke `navigator.credentials.get` with the PRF extension. Status: **FAILED**.
  - **Disappearing Messages (SEC-03)**: Message purging relies on synchronous client GET requests rather than an active background worker daemon. When expired, messages are **soft-redacted** rather than physically removed from disk records. Status: **PARTIALLY VERIFIED**.
  - **Ghost Mode (SEC-04)**: Ghost Mode is a **client-side `localStorage` visual toggle** that modifies CSS classes. It provides zero IP address masking, zero onion routing, and zero transport-layer anonymity. Status: **FAILED**.

---

## 2. MANDATORY CLAIM-BY-CLAIM VERIFICATION MATRIX

| Claim | Source Evidence (File & Line) | Independent Adversarial Test | Result | Risk Severity |
| :--- | :--- | :--- | :--- | :--- |
| **1. ZK Humanity Verification** | [`scripts/routes/zk.routes.ts:55-107`](file:///d:/Sovra/scripts/routes/zk.routes.ts#L55-L107) | Sent fabricated SNARK proof (`0x00` values). Replay attack tested with identical nullifier. Concurrent race condition executed (5 threads). | **PARTIALLY VERIFIED** | **CRITICAL** (Replay blocked, but proof circuit is unverified) |
| **2. Cryptographic DID** | [`packages/identity/src/did.ts:18-62`](file:///d:/Sovra/packages/identity/src/did.ts#L18-L62)<br>[`packages/identity/src/keypair.ts:16-65`](file:///d:/Sovra/packages/identity/src/keypair.ts#L16-L65)<br>[`scripts/dev-server.ts:94883-94975`](file:///d:/Sovra/scripts/dev-server.ts#L94883-L94975) | Provisioned test account via `POST /api/user/register`. Verified multicodec `0xed01` base58 encoding. Inspected DB schema for phone/email fields. | **VERIFIED** | **LOW** |
| **3. Two-Tier Inbox** | [`scripts/routes/chat.routes.ts:103-145`](file:///d:/Sovra/scripts/routes/chat.routes.ts#L103-L145)<br>[`scripts/routes/chat.routes.ts:208-235`](file:///d:/Sovra/scripts/routes/chat.routes.ts#L208-L235) | Sent messages from un-friended peer; queried `/api/chat/conversations`. Executed BOLA/IDOR attempt to read foreign user's inbox. | **VERIFIED** | **LOW** |
| **4. Stranger Message Blocking** | [`scripts/routes/chat.routes.ts:305-318`](file:///d:/Sovra/scripts/routes/chat.routes.ts#L305-L318)<br>[`scripts/dev-server.ts:95530-95565`](file:///d:/Sovra/scripts/dev-server.ts#L95530-L95565) | Set User B `canMessageMe: 'friends'`. Sent unsolicited message from User A to User B via `POST /api/chat/send`. | **VERIFIED** | **LOW** |
| **5. Disappearing Messages** | [`scripts/database-engine.ts:3377-3396`](file:///d:/Sovra/scripts/database-engine.ts#L3377-L3396)<br>[`scripts/routes/chat.routes.ts:222`](file:///d:/Sovra/scripts/routes/chat.routes.ts#L222) | Sent 1s TTL message. Checked disk at t=2.2s before API call. Checked disk after client API trigger. Inspected deletion type. | **PARTIALLY VERIFIED** | **HIGH** (Reactive trigger & soft redaction) |
| **6. Ghost Mode** | [`scripts/dev-server.ts:47245-47280`](file:///d:/Sovra/scripts/dev-server.ts#L47245-L47280) | Toggled Ghost Mode. Monitored network traffic, client headers, and server logs. Analyzed code for proxy/onion relay mechanics. | **FAILED** | **MEDIUM** (Cosmetic localStorage toggle only) |
| **7. Noise_XX and P2P** | [`packages/p2p/src/transport.ts:20-80`](file:///d:/Sovra/packages/p2p/src/transport.ts#L20-L80)<br>[`packages/p2p/src/node.ts:258-272`](file:///d:/Sovra/packages/p2p/src/node.ts#L258-L272)<br>[`scripts/dev-server.ts:808-815`](file:///d:/Sovra/scripts/dev-server.ts#L808-L815) | Tested live TCP connection to `127.0.0.1:4001`. Inspected `Noise_XX_25519_ChaChaPoly_SHA256` state machine implementation. | **VERIFIED** | **LOW** |
| **8. WebAuthn PRF (Phase 3)** | [`scripts/dev-server.ts:85167-85180`](file:///d:/Sovra/scripts/dev-server.ts#L85167-L85180)<br>[`packages/identity/src/passkey.ts:48-115`](file:///d:/Sovra/packages/identity/src/passkey.ts#L48-L115) | Invoked `loginWithHardwareEnclavePrf()`. Inspected client script for `navigator.credentials.get` PRF inputs. | **FAILED** | **HIGH** (Stubbed with console.log) |

*(Allowed Statuses strictly used: VERIFIED, PARTIALLY VERIFIED, FAILED, NOT TESTED, INCONCLUSIVE)*

---

## 3. PHASE-BY-PHASE AUDIT ANALYSIS

### Phase 1 — Source Code Verification
- Package structure: Clean monorepo managed via Turbo.
- Dependencies: `@noble/ciphers`, `@noble/curves`, `@noble/hashes`, `@scure/base` are authentic, well-regarded cryptographic primitives.
- Crucially, neither `snarkjs` nor `@semaphore-protocol/proof` is declared in `package.json`. Consequently, full in-circuit Zero-Knowledge SNARK proof verification cannot occur at the server runtime.

### Phase 2 — Detailed Verification of the 7 Claims
1. **ZK Humanity Verification**:
   - The application maintains a `nullifierHash` database in `zk_attestations`.
   - **Replay Protection**: Confirmed working. Replaying an identical nullifier results in `HTTP 409 Conflict: Nullifier has already been spent`.
   - **Concurrency**: Confirmed atomic. 5 simultaneous parallel requests using the same nullifier resulted in exactly 1 acceptance (`HTTP 200`) and 4 rejections (`HTTP 409`).
   - **Vulnerability**: Proof mathematical verification is missing. Any string is accepted as long as the nullifier is new.
2. **Cryptographic DID**:
   - Ed25519 keys are generated using `@noble/curves/ed25519`.
   - Public keys are encoded to canonical W3C `did:key:z...` strings.
   - Private keys are stored strictly in private fields (`#privateKey`).
   - Registration requires no phone number and no email address.
3. **Two-Tier Inbox**:
   - Conversations are dynamically partitioned: accepted friends -> `primary`, unaccepted contacts -> `requests`.
   - BOLA / IDOR protection verified: querying another user's inbox returns `HTTP 403 Forbidden`.
4. **Stranger Message Blocking**:
   - When a recipient configures `canMessageMe: 'friends'`, non-friends attempting `POST /api/chat/send` receive `HTTP 403 Forbidden: Recipient only accepts direct messages from friends`.
5. **Disappearing Messages**:
   - TTL timestamps (`expiresAt`) are calculated upon message creation.
   - However, cleanup only occurs when `/api/chat/messages` is actively requested. Plaintext remains on disk until that moment.
   - Deletion is soft: the text is replaced with `"💨 Message disappeared"`, but the record metadata is not purged from database JSON.
6. **Ghost Mode**:
   - Inspected lines 47245-47280 of `scripts/dev-server.ts`.
   - The feature is solely a client-side `localStorage` flag that toggles visual CSS (`is-ghost`) on the avatar presence pill.
   - Zero network-layer anonymity, zero onion routing, zero IP masking.
7. **Noise_XX and P2P**:
   - Verified that `packages/p2p/src/transport.ts` contains a complete Noise Protocol Framework Revision 34 implementation (`Noise_XX_25519_ChaChaPoly_SHA256`).
   - Verified that the TCP socket listener is active and responsive on `127.0.0.1:4001`.

### Phase 3 — WebAuthn PRF Audit
- `packages/identity/src/passkey.ts` implements a conceptual `PasskeyManager` with ChaCha20-Poly1305 cloud vault encryption.
- However, the browser integration in `scripts/dev-server.ts:85167-85180` is an incomplete stub:
  ```js
  async function loginWithHardwareEnclavePrf() {
    // deriveKeyFromWebAuthnPrf transforms TouchID/FaceID raw PRF bits directly into root Ed25519 seed
    console.log('[Enclave] deriveKeyFromWebAuthnPrf active for seed-phrase-less master key derivation');
  }
  ```
- **Verdict**: Unimplemented stub. A console.log statement is not cryptographic implementation proof.

### Phase 4 & Phase 5 — Independent Live Testing & Adversarial Results
- Executed via independent test suite: [`scratch/audit_scripts/adversarial_test_runner.cjs`](file:///d:/Sovra/scratch/audit_scripts/adversarial_test_runner.cjs).
- Results recorded:
  - Bogus ZK Proof submission: `HTTP 200` (Vulnerable to proof forgery).
  - Nullifier Replay: `HTTP 409` (Defended against replay).
  - BOLA / IDOR message snooping: `HTTP 403` (Defended against unauthorized read).
  - Stranger message to friends-only: `HTTP 403` (Defended against spam).
  - Disappearing message disk retention before read: Plaintext present (Vulnerable to disk forensics).
  - Raw TCP port 4001 handshake: Connected successfully.

---

## 4. REMEDIATION ROADMAP

1. **Implement Real Groth16 Circuit Verification**:
   Install `snarkjs` and compile Semaphore verification keys to perform true bilinear pairing verification before issuing the `"🛡️ ZK-Human"` attestation.
2. **Implement Real WebAuthn PRF Browser API**:
   Replace the `console.log` stub in `scripts/dev-server.ts` with authentic `navigator.credentials.get({ publicKey: { extensions: { prf: ... } } })` calls.
3. **Add Continuous Background Pruning Daemon**:
   Add `setInterval(() => sovraDb.purgeExpiredDisappearingMessages(), 5000)` to ensure expired messages are physically erased from disk even when no clients are reading messages. Replace soft-redaction with physical array deletion.
4. **Clarify Ghost Mode in UI**:
   Update UI labels to accurately describe Ghost Mode as "Appear Offline" status rather than cryptographic network anonymity, or implement a real multi-hop SOCKS5/Tor routing layer.

---

## 5. AUDITOR ATTESTATION

> [!WARNING]
> **Final Security Disclaimer**: No system is 100% secure. This audit confirms that while core W3C DID cryptography, two-tier authorization, P2P Noise_XX TCP transport, and nullifier replay defenses are robustly implemented, the project cannot be certified as fully production-ready until the ZK proof verification stub (SEC-01), WebAuthn PRF stub (SEC-02), and disappearing message physical purge (SEC-03) are fully remediated and verified under production deployment conditions.

**Auditor Sign-off**: Independent Senior Security Auditor & Cryptographic Engineer (Nov 4, 2026)
