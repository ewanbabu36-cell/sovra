# SOVRA Source-Code Health, Functionality & Release Readiness Audit
## Deliverable 05: Security, Cryptography & Privacy Audit

**Audit Date:** 2026-10-09  
**Execution Environment:** Local Windows Workstation (`d:\Sovra`)  
**Operating Principle:** INSPECT FIRST. VERIFY SECOND. REPORT THE TRUTH. DO NOT MODIFY THE PRODUCT.

---

### 1. Cryptographic Primitive Inventory

Sovra strictly avoids insecure legacy algorithms (MD5, SHA-1, DES, RC4) and relies exclusively on modern, high-assurance cryptographic primitives implemented in `packages/crypto`:

| Primitive Domain | Algorithm / Standard | Specification / Parameters | Primary Files |
| :--- | :--- | :--- | :--- |
| **Asymmetric Signatures** | **Ed25519** (RFC 8032) | 256-bit Edwards-curve Digital Signature | `packages/crypto/src/ed25519.ts` |
| **Key Agreement (P2P / BLE)** | **X25519** (RFC 7748) | Montgomery curve Diffie-Hellman | `packages/crypto/src/x25519.ts` |
| **Authenticated Encryption** | **ChaCha20-Poly1305** (RFC 8439) | 256-bit key, 96-bit nonce, 128-bit MAC tag | `packages/crypto/src/chacha20.ts` |
| **Key Derivation** | **HKDF-SHA256** (RFC 5869) | HMAC-based Extract-and-Expand KDF | `packages/crypto/src/hkdf.ts` |
| **Cryptographic Hashing** | **SHA-256 / SHA-512** (FIPS 180-4) | Merkle-Damgård with standard padding | `packages/crypto/src/sha256.ts` |
| **Anti-Spam Proof of Work** | **Dynamic Target PoW** | SHA-256 leading-zero target difficulty | `packages/crypto/src/pow.ts` |
| **Entropy Source** | **CSPRNG** | Node `crypto.randomBytes` / Web Crypto API | `packages/crypto/src/random.ts` |

---

### 2. Identity, DID Specification & Key Management

1. **Decentralized Identifier (DID) Architecture:**
   - Sovra identities use the W3C standard `did:key` format (`did:key:z6Mku...`).
   - The DID string is formed by encoding the Ed25519 public key using Multicodec (`0xed01`) and Multibase base58btc (`z`).
   - Every message, post, vote, and channel membership contains the author's DID and an Ed25519 signature over canonical CBOR bytes.
2. **Account Security & 2FA (`scripts/database-engine.ts`):**
   - **PIN Protection:** 6-digit PIN hashed via SHA-256 (`securityPinHash`).
   - **Google Authenticator 2FA:** RFC 6238 Base32 TOTP secret key (`totpSecret`) with time-step drift tolerance of ±1 step (30 seconds).
   - **Disaster Recovery:** 12-word mnemonic phrase (`recoveryPhrase`) allowing offline account reconstruction.
3. **Session Token Lifecycle & Revocation:**
   - Sessions are bound to hardware metadata (`device_name`, `device_type`, `ip_address`, `user_agent`).
   - Token revocation is persisted immediately to the SQLite table `revoked_tokens` and checked on every authenticated request.

---

### 3. P2P Mesh Handshake & Forward Secrecy (`packages/p2p/src/mesh/ble-handshake.ts`)

The peer-to-peer BLE handshake implements a 3-step mutual authentication protocol providing **Full Forward Secrecy (PFS)** and **Anti-Replay Protection**:

```text
Peer A (Initiator)                                   Peer B (Responder)
   |                                                    |
   |---- STEP 1: Ephemeral Pubkey (E_A) + Nonce_A ----->|
   |                                                    |
   |<--- STEP 2: Ephemeral Pubkey (E_B) + Nonce_B ------|
   |     + Responder DID + Signature_B                  |
   |                                                    |
   |---- STEP 3: Initiator DID + Signature_A ---------->|
   |     + Key Confirmation Tag (HMAC)                  |
   |                                                    |
   [ Both Derive ChaCha20 Keys via HKDF(E_A * E_B) ]
```

#### Replay Attack Mitigation
- **Sliding Replay Window:** Uses a 256-packet bitmask window (`SlidingReplayWindow`). Sequence numbers must be strictly monotonic or within the 256-step window. Old or duplicate sequence numbers are rejected with `ReplayStatus.OLD` or `ReplayStatus.DUPLICATE`.
- **Authenticated Additional Data (AAD):** Every BLE packet includes AAD containing `ProtocolVersion (0x01) || SessionID || SequenceNumber`, preventing packet splicing or cross-session injection.

---

### 4. Broken Object-Level Authorization (BOLA / IDOR) Verification

Audit of route handlers in `scripts/dev-server.ts`:

1. **Direct Messaging Endpoint (`/api/chat/messages`):**
   - Resolves the caller's principal from the session token: `const principal = resolvePrincipal(req)`.
   - Compares the caller's DID against the requested thread's bilateral participants (`fromDid === principal.did || toDid === principal.did`).
   - Unauthorized attempts return **HTTP 403 Forbidden** with zero metadata leakage.
2. **Post Lifecycle Endpoints (`/api/feed/edit`, `/api/feed/delete`):**
   - Checks `post.authorDid === principal.did`. Non-owners receive HTTP 403 unless the caller holds an administrative role verified by `AdminSecurityEngine`.
3. **Space & Group Admin Operations:**
   - Role verification enforces hierarchy: `owner` > `admin` > `moderator` > `member`. Ordinary members cannot modify rules or ban members.

---

### 5. WebRTC Transport Security & Calling Privacy

1. **Dual HTTPS Server Configuration:**
   - Modern browsers require a **Secure Context** (`window.isSecureContext === true`) to access camera and microphone hardware via `navigator.mediaDevices.getUserMedia`.
   - The development server runs dual HTTP (`http://localhost:3001`) and HTTPS (`https://localhost:3443`) with TLS certificates.
2. **SDP Sanitization & Ephemeral Signaling:**
   - Session Description Protocol (SDP) offers and answers exchanged over `/api/call/offer` and `/api/call/answer` are stored in ephemeral memory and discarded upon call termination (`/api/call/end`).
3. **ICE Candidate Privacy:**
   - **Local Area Network (LAN):** ICE candidates contain local RFC 1918 private IP addresses (`10.x.x.x`, `192.168.x.x`).
   - **Production Carrier Traversal:** A deployed public TURN server with short-lived HMAC-SHA1 credentials is required to prevent leaking carrier IP addresses and bypass symmetric CGNAT firewalls.

---

### 6. Vulnerability Assessment & Security Risk Scorecard

| Threat Vector | Assessed Risk | Mitigating Control in Source Code | Residual Gap |
| :--- | :--- | :--- | :--- |
| **Identity Impersonation** | **LOW** | All events signed with Ed25519; verified against `did:key` | None |
| **BLE Packet Sniffing** | **LOW** | ChaCha20-Poly1305 forward-secret session encryption | None |
| **Replay Attacks** | **LOW** | 256-step sliding replay window + fresh handshake nonces | None |
| **BOLA / IDOR in Chat** | **LOW** | Strict session-derived principal matching on thread IDs | None |
| **Cross-Site Scripting (XSS)** | **LOW** | Canvas-based Spatial UI + text sanitization on post captions | HTML escaping in rich article render |
| **Denial of Service (BLE Spam)** | **MEDIUM** | Dynamic Target PoW on incoming connection requests | Physical radio flooding unmitigated |
| **Carrier WebRTC Leaks** | **MEDIUM** | Ephemeral signaling memory teardown | Public TURN required for production WAN |
| **Hardware Key Extraction** | **HIGH** | Web app stores keys in memory / localStorage | Mobile Keystore integration needed for release |
