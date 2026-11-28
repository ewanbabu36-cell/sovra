# RFC SOVRA-MSG v1.0
## End-to-End Encrypted Messaging & Delivery Lifecycle (`SOVRA-MSG`)

**Protocol Identifier:** `SOVRA-MSG`  
**Namespace:** `/sovra/msg/1.0.0`  
**Version:** `1.0`

---

## 1. Security & Cryptographic Construction

- Separate signing identity (Ed25519) and encryption identity (X25519 / Double Ratchet HKDF + ChaCha20-Poly1305 AEAD).
- Relays and storage nodes operate blindly on ciphertext envelopes and MUST NEVER possess decryption keys or group keys.
- Replay protection via monotonic session sequence counters and unique `message_id`.
- Revoked devices immediately lose authorization to submit valid envelopes under the identity.
- Explicit optional message expiry (`expires_at`) deletes ciphertext/plaintext cleanly from local DBs once elapsed.

---

## 2. Delivery State Lifecycle (Distinct Semantics)

`CREATED -> ENCRYPTED -> PUBLISHED -> DELIVERED -> ACKNOWLEDGED` (plus optional `READ` if user-enabled, and `FAILED` / `EXPIRED`):

| State | Meaning | Non-Equivalence |
|---|---|---|
| `CREATED` | Outbox item queued locally offline | Not yet encrypted or sent |
| `ENCRYPTED` | AEAD ciphertext sealed for recipient ratchet | Relay cannot inspect |
| `PUBLISHED` | Uploaded to P2P node or accepted by blind relay (`relay_accepted_at`) | **Does NOT prove recipient received it** |
| `DELIVERED` | Retrieved & decrypted/verified by recipient device | Distinct from relay hop acceptance |
| `ACKNOWLEDGED` | Signed delivery receipt returned by recipient device | Cryptographic proof of device receipt |
| `READ` | Optional privacy-gated signed read receipt | Never inferred from delivery |

Reference implementation: [packages/messaging/src/lifecycle.ts](file:///d:/Sovra/packages/messaging/src/lifecycle.ts) & [packages/messaging/src/chat-engine.ts](file:///d:/Sovra/packages/messaging/src/chat-engine.ts).
