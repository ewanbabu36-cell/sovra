# SOVRA CORE PROTOCOL SPECIFICATION (v1.0)
*Status: Formal Protocol Contract*  
*Scope: Cross-platform client, daemon, transport, and mesh compatibility*

---

## 1. Protocol Architecture & Invariants

Sovra is a decentralized, internet-independent social and knowledge network. Every operation is structured as a cryptographically signed, content-addressed protocol event. There is no centralized authority: client devices, offline BLE nodes, and internet P2P nodes validate events using identical deterministic rules.

### Core Invariants
1. **Source of Truth:** Immutable signed events (`SovraProtocolEvent`). All profile views, follower graphs, and reaction tallies are pure deterministic state projections.
2. **Authority Decoupling:** `SIGNATURE VALID ≠ OPERATION AUTHORIZED`. A valid digital signature only authenticates the author; operation validity requires verified capabilities, object ownership, valid current state, and replay uniqueness.
3. **Transport Neutrality:** Protocol events exist independently of the transport over which they travel (Local, BLE, TCP, WebSocket, WebRTC).
4. **Deterministic Serialization:** RFC 8785 JSON canonicalization guarantees bit-for-bit identical serialization and cryptographic hashes across all programming languages and architectures.

---

## 2. Identity & Key Hierarchy

Sovra separates persona identity, physical devices, transport sessions, and confidentiality:

| Key Role | Cryptographic Primitive | Identifier Format | Lifecycle & Scope |
|:---|:---|:---|:---|
| **Identity Key** | Ed25519 (256-bit) | `did:key:z6Mk...` | Root controller of persona. Offline root of trust. Never exposed on ordinary network transports. |
| **Device Key** | Ed25519 (256-bit) | `did:key:z...` / `dev-<uuid>` | Bound to physical hardware. Authorized via root delegation assertion (`DeviceDelegationAssertion`). Can be revoked without changing the root DID. |
| **Encryption Key** | X25519 (Diffie-Hellman) | 32-byte public key | End-to-end encryption of direct messages, media keys, and private knowledge twins. |
| **Session Key** | Ephemeral Symmetric (ChaCha20) | Ratchet state | Ephemeral forward-secrecy transport sessions. |

### Device Delegation & Revocation
- **Delegation:** Root Identity Key signs `DeviceDelegationAssertion`:
  $$\text{Sig}_{\text{Identity}}\big(\text{canonical}(\text{parentDid}, \text{deviceId}, \text{devicePubkey}, \text{validUntil}, \text{nonce})\big)$$
- **Revocation:** Root Identity Key signs `RevocationAssertion`:
  $$\text{Sig}_{\text{Identity}}\big(\text{canonical}(\text{targetDid}, \text{revokedKeyHex}, \text{reason}, \text{revocationSequence}, \text{timestamp})\big)$$
  *Security Invariant:* Once revoked, new state-changing operations from the device are rejected (`INVALID_IDENTITY`), while historical events created prior to revocation remain verifiable.

---

## 3. Canonical Event Model (`SovraProtocolEvent`)

All protocol events conform to this single canonical schema:

```typescript
interface SovraProtocolEvent<T = unknown> {
  // Protocol Versioning
  protocolVersion: { major: 1; minor: 0 };
  
  // Cryptographic Event Identity (SHA-256 of RFC 8785 canonical unsigned event)
  eventId: string;
  
  // Event Classification
  eventType: string; // e.g. "post.create", "social.follow", "knowledge.claim"
  
  // Authenticated Author
  author: {
    did: string;          // Controller DID (did:key:z...)
    deviceId?: string;    // Physical device identifier
    pubkeyHex: string;    // 64-character hex Ed25519 public key
  };
  
  // Target Object (for mutations, comments, reactions, disputes)
  object?: {
    id: string;           // Target identifier (e.g. "post-100")
    type: string;         // "profile" | "post" | "comment" | "media" | "community" | "knowledge"
    ownerDid?: string;    // Authoritative owner DID
  };
  
  // Causal Predecessor DAG (Vector Clock / Ancestor References)
  parents: readonly string[];
  
  // Logical Time
  logicalClock: {
    sequence: number;     // Monotonically increasing per (authorDid, deviceId)
    lamport?: number;     // Lamport timestamp
  };
  
  // Anti-Replay Nonce & Timestamps
  nonce: string;          // Cryptographic random 128-bit hex nonce
  createdAt: number;      // Unix timestamp (seconds)
  expiresAt?: number;     // Optional expiry timestamp (seconds)
  
  // Typed Domain Payload
  payload: T;
  
  // Required Capability Assertion
  capability?: string;    // e.g. "social:write", "admin:moderate"
  
  // Digital Signature
  signature: string;      // Ed25519 signature over eventId bytes
}
```

---

## 4. Deterministic Serialization & Event ID Derivation

1. **Serialization Standard:** RFC 8785 Canonical JSON.
   - Keys sorted lexicographically by UTF-16 code units.
   - Whitespace stripped.
   - Numbers formatted canonically with no exponential notation for standard integers.
   - Null fields included explicitly where required; undefined fields excluded.
2. **Event ID Computation:**
   $$\text{canonicalBytes} = \text{RFC8785}(\text{unsignedEvent})$$
   $$\text{eventId} = \text{hex}\big(\text{SHA-256}(\text{canonicalBytes})\big)$$
3. **Digital Signature:**
   $$\text{sigBytes} = \text{Sign}_{\text{Ed25519}}\big(\text{privateKey}, \text{UTF8}(\text{eventId})\big)$$
   $$\text{signature} = \text{hex}(\text{sigBytes})$$

---

## 5. Reusable Authorization Engine

Every mutation evaluates through 8 sequential gates returning an explicit `AuthorizationDecision`:

```text
Incoming Event
      ↓
Gate 1: Cryptographic Integrity   → INVALID_SIGNATURE / MALFORMED
      ↓
Gate 2: Clock Skew & Expiration    → EXPIRED (tolerance: ±300 seconds)
      ↓
Gate 3: Replay & Nonce Store       → REPLAY (checks duplicate ID, nonce reuse, monotonic sequence)
      ↓
Gate 4: Identity & Device State    → INVALID_IDENTITY (checks revocation registry)
      ↓
Gate 5: Capability Least Privilege → INVALID_CAPABILITY (checks granted capabilities)
      ↓
Gate 6: Target Object Existence    → INVALID_STATE (rejects deleted / tombstoned targets)
      ↓
Gate 7: Object Ownership           → NOT_OWNER (author must match object owner unless Admin override)
      ↓
Gate 8: Community / Node Policy    → POLICY_DENIED
      ↓
DECISION: AUTHORIZED
```

---

## 6. Durable Event Store (`DurableEventStore`)

- **Persistence Mode:** Append-only write-ahead log (WAL) with atomic rename/fsync.
- **Duplicate Handling:** Idempotent. Appending an existing `eventId` is a no-op and does not duplicate state.
- **Cryptographic Corruption Detection:** Upon reading any record from disk, the store recomputes `computeProtocolEventId(event)`. If the hash does not match, a `StorageFailureError` is thrown immediately to isolate corrupted blocks.
- **State Hash Checkpoint:** Merkle-style SHA-256 digest over ordered event stream:
  $$\text{stateHash} = \text{SHA-256}\big(e_1.\text{id} \parallel ':' \parallel e_2.\text{id} \parallel \dots \parallel e_n.\text{id}\big)$$

---

## 7. Transport-Neutral Message Envelope (`TransportEnvelope`)

```typescript
interface TransportEnvelope<T = unknown> {
  envelopeVersion: number;
  transportType: 'LOCAL' | 'BLE' | 'TCP' | 'WEBSOCKET' | 'WEBRTC';
  senderPeerId: string;
  recipientPeerId?: string; // undefined = mesh gossip broadcast
  event: SovraProtocolEvent<T>;
  hopCount: number;
  maxHops: number;          // Default: 7
  relayedBy: readonly string[];
  sentAt: number;
  transportMetadata?: Record<string, unknown>;
}
```

The protocol payload is invariant across all transports. Changing transports advances `hopCount` and appends `relayedBy` without modifying the underlying signed `SovraProtocolEvent`.

---

## 8. Standardized Protocol Error Codes

```typescript
type ProtocolErrorCode =
  | 'MALFORMED'            // Event structure invalid or JSON corrupted
  | 'INVALID_SIGNATURE'    // Cryptographic signature mismatch
  | 'UNKNOWN_IDENTITY'     // Unresolvable public key or DID
  | 'UNAUTHORIZED'         // Operation not permitted for principal
  | 'REPLAY'               // Duplicate event ID, reused nonce, or sequence regression
  | 'EXPIRED'              // Event timestamp exceeds drift window or expiration
  | 'UNSUPPORTED_VERSION'  // Incompatible major protocol version
  | 'INVALID_STATE'        // Target object is deleted, tombstoned, or missing
  | 'POLICY_DENIED'        // Rejected by local moderation or safety policy
  | 'STORAGE_FAILURE'      // Disk corruption, I/O failure, or write error
  | 'TRANSPORT_FAILURE'    // Physical link failure or MTU violation
  | 'SYNC_FAILURE';        // CRDT partition digest mismatch
```
