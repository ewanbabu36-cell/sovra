# SOVRA Decentralized P2P Networking Specification

**Document Version:** 1.0.0  
**Layer:** Layer 3 (P2P Network & Routing Layer)  
**Status:** Approved & Verified

---

## 1. Architectural Philosophy & Zero-SPOF Guarantee

Sovra's P2P networking layer eliminates single points of failure (SPOF) at every architectural boundary. The network operates autonomously without requiring:

- A central bootstrap coordinator
- A central peer directory or relay router
- A corporate STUN/TURN server
- A central authentication or session authority
- The Sovra Company Admin Panel (`apps/sovra-admin`)

If company-operated infrastructure goes completely offline, peer discovery, direct transport, encrypted pub/sub event distribution, and DHT routing continue across all reachable nodes.

---

## 2. Peer Identity & DID ↔ Device ↔ Peer ID Binding

### 2.1 The Three-Tier Identity Model

Sovra cleanly decouples root identity, physical hardware devices, and network peer addressing:

```
+-------------------------------------------------------------------------+
| Tier 1: Sovra Master Identity DID                                       |
| - Root Ed25519 public key (did:key:z6Mkt...)                            |
| - Offline / Secure Hardware Enclave Storage                             |
| - Signs Device Delegation Assertions & Key Revocations                  |
+-------------------------------------------------------------------------+
                                    |
                                    | Signs Device Delegation Assertion
                                    v
+-------------------------------------------------------------------------+
| Tier 2: Device Key                                                      |
| - Operational Ed25519 keypair local to device hardware                  |
| - Valid for finite validity duration (e.g. 30 days)                    |
| - Can be immediately revoked without abandoning Master DID              |
+-------------------------------------------------------------------------+
                                    |
                                    | Deterministic Protobuf Identity Multihash
                                    v
+-------------------------------------------------------------------------+
| Tier 3: libp2p Network Peer ID                                          |
| - 12D3KooW... base58btc string                                          |
| - Derived directly from Device Key's 32-byte Ed25519 public key         |
| - Header: [0x00, 0x24, 0x08, 0x01, 0x12, 0x20] + 32-byte pubkey       |
+-------------------------------------------------------------------------+
```

### 2.2 Peer Identity Binding Schema

When connecting over the network, peers exchange and verify a `PeerIdentityBinding`:

```typescript
export interface PeerIdentityBinding {
  readonly peerId: string; // e.g. "12D3KooW..."
  readonly deviceId: string; // e.g. "dev-laptop-01"
  readonly devicePublicKeyHex: string; // 32-byte hex string
  readonly masterDid: string; // e.g. "did:key:z6Mkt..."
  readonly delegation: DeviceDelegationAssertion; // Signed by Master DID
  readonly timestamp: number; // Unix seconds
  readonly signatureHex?: string; // Signed by Device Key
}
```

### 2.3 Verification & Revocation Flow

1. **Derivation Check:** Peer re-derives `peerId` from `devicePublicKeyHex` using the standard protobuf identity multihash header.
2. **Delegation Check:** Verifies that `delegation.devicePublicKeyHex === devicePublicKeyHex` and `delegation.parentDid === masterDid`.
3. **Master Signature Check:** Verifies the Master DID's Ed25519 digital signature over the delegation assertion.
4. **Device Signature Check:** Verifies the device signature covering the binding timestamp and transcript.
5. **Revocation Registry:** Verifies against the local `RevocationRegistry` that neither the device key nor the master key has been revoked.

---

## 3. Secure Transport Handshake & Session Encryption

Sovra implements mutual peer authentication and end-to-end forward secrecy based on the **Noise_XX** handshake pattern (`Noise_XX_25519_ChaChaPoly_BLAKE2s`):

### 3.1 Handshake Sequence

```
Initiator (A)                                      Responder (B)
     |                                                   |
     | ---- Message 1: [e_A pubkey, nonce_A] ----------> |
     |                                                   | (Derives DH1 = e_A * e_B)
     |                                                   | (Signs transcript with DevKey_B)
     | <--- Message 2: [e_B pubkey, nonce_B, ----------- |
     |                  Binding_B, Sig_B]                |
     |                                                   |
(Verifies Binding_B & Sig_B)                             |
(Derives DH1, signs transcript)                          |
     | ---- Message 3: [Binding_A, Sig_A] -------------> |
     |                                                   | (Verifies Binding_A & Sig_A)
     |                                                   |
     +=========== Session Established (AEAD) ===========+
```

### 3.2 Session Cipher Properties

- **Encryption Algorithm:** ChaCha20-Poly1305 AEAD (RFC 8439).
- **Directional Session Keys:** Inbound and outbound keys derived via HKDF-SHA256 with handshake transcript salt.
- **Forward Secrecy:** Ephemeral X25519 keypairs discarded immediately after session establishment. Compromise of long-term identity keys cannot decrypt past sessions.
- **Replay Protection:** 64-bit strictly monotonic sequence counters in each frame header. Frames arriving out-of-order or with duplicate sequence numbers are immediately dropped.

---

## 4. Multiplexing Architecture (Yamux Model)

Sovra supports multiple concurrent logical streams over a single secure connection using lightweight framing:

### 4.1 Frame Header Format (9 bytes)

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                           Stream ID                           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|      Flag     |                 Payload Length                |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Payload Length (cont.)        | Payload Data ...              |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

- **Flags:** `SYN (1)`, `DATA (2)`, `FIN (4)`, `RST (8)`.
- **Stream Isolation:** A stream reset (`RST`) or parsing error on Stream $N$ terminates only Stream $N$; unrelated concurrent streams continue without degradation.
- **Resource Boundary:** Capped at `maxStreamsPerConnection` (default: 32). Exceeding streams trigger clean `RST` frames.

---

## 5. Peer Discovery Architecture

To prevent discovery centralization, Sovra employs four concurrent discovery vectors:

1. **Local LAN Discovery (`LocalDiscoverySource`):** Broadcasts announcements over local network interfaces, enabling offline local community synchronization.
2. **Kademlia DHT Discovery (`DHTDiscoverySource`):** Queries closest peers for random keys and topic provider records.
3. **Static Peer Addresses (`StaticDiscoverySource`):** Operator-configured multiaddrs and community seed lists.
4. **Relay-Assisted Discovery (`RelayDiscoverySource`):** Discovers peers maintaining reservations on common circuit relays.

---

## 6. Kademlia DHT (`/sovra/kad/1.0.0`)

### 6.1 Routing Table Structure

- **Distance Metric:** 256-bit XOR metric computed using SHA-256 hashes of Peer IDs.
- **Buckets:** 256 $k$-buckets with capacity $k = 20$.
- **Stale Peer Replacement:** When a bucket is full and a new candidate peer arrives, the least recently seen peer is probed. If unresponsive, it is evicted and the new peer is inserted; if responsive, the candidate is discarded per Kademlia specification.

### 6.2 Multi-Bootstrap Hierarchy

Bootstrap peers are network accelerators, NOT authorities. The node evaluates candidates in priority order:

1. Primary bootstrap peers
2. Community-operated nodes
3. User-configured custom peers
4. Locally discovered peers
5. Locally cached previously known peers

If any bootstrap peer is unreachable, the node falls back immediately to subsequent candidates.

---

## 7. NAT Traversal & Circuit Relay v2

### 7.1 Connection States

- **`direct`:** Peer possesses a publicly dialable IPv4/IPv6 address confirmed by AutoNAT reflection.
- **`relayed`:** Peer is behind NAT or strict firewall; communication is proxied via Circuit Relay v2.
- **`unreachable`:** Both direct dial and relay reservation attempts have failed.

### 7.2 Circuit Relay v2 Protocol (`/sovra/relay/0.2.0`)

- **Untrusted Forwarding:** Relays only forward encrypted ciphertext frames. Relays possess zero decryption keys and cannot forge signatures.
- **Dynamic Failover:** If Relay A becomes unreachable, the client automatically re-routes traffic through Relay B.
- **Direct Elevation:** If a direct path becomes available, connections upgrade from relayed to direct.

---

## 8. GossipSub v1.2 Protocol (`/sovra/gossipsub/1.2.0`)

### 8.1 Topic Mesh Parameters

- Target Degree: $D = 6$
- Lower Bound: $D_{low} = 4$ (triggers graft operations when peer count falls)
- Upper Bound: $D_{high} = 12$ (triggers prune operations when mesh becomes crowded)

### 8.2 Ten-Step Protocol Message Validation Pipeline

Every inbound event is validated before acceptance or mesh forwarding:

```
Inbound Payload
      |
      v
[Step 4: Size Limit Check (<= 1MB)]
      |
      v
[Step 1: Safe JSON Decoding]
      |
      v
[Step 2: Schema Conformance]
      |
      v
[Step 3: Protocol Event Kind Validation]
      |
      v
[Step 5: Author Key Format (32-byte hex)]
      |
      v
[Step 6: Device Delegation Check]
      |
      v
[Step 7: Canonical RFC 8785 Hash & Ed25519 Signature Verification]
      |
      v
[Step 8: RevocationRegistry Check]
      |
      v
[Step 9: Timestamp Drift (+-5m) & Seen Cache Deduplication]
      |
      v
[Step 10: Topic Policy Check]
      |
      v
Accepted & Broadcast to Mesh
```

Any step failure drops the message and penalizes the sender in the Peer Scoring Engine.

---

## 9. Defensive Peer Scoring Engine

All peer scoring is computed locally based on observable behavior:

| Behavior Signal                 | Score Delta       | Category          |
| :------------------------------ | :---------------- | :---------------- |
| Valid message delivery          | $+1.0$            | Positive          |
| Time in topic mesh              | $+0.1$ / interval | Positive          |
| Successful request completion   | $+0.5$            | Positive          |
| Request timeout                 | $-2.0$            | Negative          |
| Message rate limit exceeded     | $-10.0$           | Negative          |
| Malformed message               | $-25.0$           | Negative          |
| Protocol policy violation       | $-30.0$           | Negative          |
| Invalid cryptographic signature | $-50.0$           | Critical Negative |

- **Graylist Threshold ($-20$):** Peer is dropped from GossipSub mesh; receives gossip summaries only.
- **Blacklist Threshold ($-50$):** Connection terminated immediately; peer address blocked during cooldown.
- **Score Decay:** Scores decay exponentially toward $0.0$ over time to allow reformed peers to regain standing.

---

## 10. Connection Manager & Resource Limits

| Resource                    | Default Limit | Behavioral Failure Response                        |
| :-------------------------- | :------------ | :------------------------------------------------- |
| Max active peer connections | 100           | Rejects new dials with `ERR_P2P_RESOURCE_EXCEEDED` |
| Max streams per connection  | 32            | Resets exceeding stream with `RST` frame           |
| Max payload size            | 1 MB          | Drops payload with `ERR_SIZE_LIMIT_EXCEEDED`       |
| Max pending requests        | 50            | Returns `ERR_P2P_RESOURCE_EXCEEDED` to caller      |
| Max GossipSub rate          | 50 msgs/sec   | Drops messages and penalizes peer score            |
| Max reconnect attempts      | 5             | Exponential backoff capped at 10s with jitter      |
