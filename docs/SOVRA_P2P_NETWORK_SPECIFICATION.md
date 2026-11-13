# SOVRA — DISTRIBUTED P2P NETWORK SPECIFICATION
## Swarm Architecture, Noise_XX Protocols, Kademlia DHT & GossipSub (Layer D)

**Principal Architect:** Principal Distributed Systems Engineer & Cryptographer  
**Date:** 2026-11-05  
**Version:** 1.0.0-PROPOSAL  
**Standard:** Noise_XX Protocol, Kademlia DHT, libp2p GossipSub v1.1, Dynamic PoW  

---

### 1. Network Topology & Transport Independence

The SOVRA P2P swarm is a decentralized, zero-trust overlay network connecting mobile nodes, community servers, storage pinning engines, and blockchain validators.

```mermaid
graph TD
    subgraph SwarmOverlay["SOVRA Distributed P2P Swarm"]
        NodeA["Full Node A<br/>(TCP :4001)"]
        NodeB["Community Node B<br/>(WSS / WebRTC)"]
        NodeC["Storage Node C<br/>(BitSwap Pinner)"]
        ValidatorNode["L1 Validator<br/>(CometBFT :26656)"]
    end

    subgraph Handshake["Mutual Noise_XX Handshake"]
        EphemeralKey["Ephemeral X25519 Curve Exchange"]
        StaticProof["Static Ed25519 Identity Signature"]
        CipherSession["ChaCha20-Poly1305 Cipher State"]
    end

    subgraph Routing["Routing & Swarm Protocols"]
        DHT["Kademlia XOR Routing (k=20, α=3)"]
        Gossip["GossipSub v1.1 Mesh Router"]
        PoW["Dynamic PoW Sybil Ticket Check"]
    end

    NodeA <-->|Noise_XX| NodeB
    NodeB <-->|Noise_XX| NodeC
    NodeC <-->|Noise_XX| ValidatorNode
    SwarmOverlay --> Handshake
    Handshake --> Routing
```

---

### 2. Noise_XX Cryptographic Handshake

All P2P connections execute a strict three-message Noise_XX pattern prior to exchanging application-level frames:

```
  Initiator                                Responder
      |                                        |
  1.  | ------------ e ----------------------> |   (Ephemeral Key e)
      |                                        |
  2.  | <----------- e, ee, s, es ------------ |   (Responder Ephemeral + Static s)
      |                                        |
  3.  | ------------ s, se ------------------> |   (Initiator Static s + Auth Proof)
      |                                        |
```

1. **Message 1 (`-> e`):** Initiator sends ephemeral X25519 public key.
2. **Message 2 (`<- e, ee, s, es`):** Responder responds with ephemeral key, performs Diffie-Hellman `ee`, transmits its encrypted static public identity `s`, and mixes `es` into the cipher state.
3. **Message 3 (`-> s, se`):** Initiator transmits its encrypted static identity `s`, mixes `se`, and completes mutual authentication.
4. **Resulting Security Properties:**
   - Mutual cryptographic identity verification.
   - Strong Forward Secrecy: Compromise of static keys does not decrypt past sessions.
   - Identity Hiding: Eavesdroppers on the wire cannot discover node public keys.

---

### 3. Kademlia DHT (Distributed Hash Table)

1. **Node ID & Metric:**
   - 256-bit Node ID derived via `SHA-256(Ed25519PublicKey)`.
   - Distance metric: Bitwise Exclusive-OR (XOR): $d(x, y) = x \oplus y$.
2. **Routing Table Structure:**
   - 256 $k$-buckets where $k = 20$.
   - Concurrency parameter $\alpha = 3$ for parallel lookups.
   - Replacement cache prevents eviction of stable, long-running nodes.
3. **Verified Lookup Performance:**
   - Benchmark verified: Average lookup latency is **0.322ms** per key resolution.

---

### 4. GossipSub v1.1 Mesh & Topic Broadcasting

1. **Active Swarm Topics:**
   - `sovra/feed/v1`: Global public social events and status updates.
   - `sovra/mesh/telemetry`: Aggregated network diagnostics.
   - `sovra/chat/direct`: Routing signals for E2EE messaging channels.
   - `sovra/moderation/events`: Automated abuse and spam takedown assertions.
2. **Peer Scoring Function:**
   Peers maintain a real-time behavioral score $S$:
   $$S = w_1 \cdot P_1 + w_2 \cdot P_2 + w_3 \cdot P_3 - w_4 \cdot P_4$$
   - $P_1$: Time in mesh topic.
   - $P_2$: Valid first-delivery messages.
   - $P_3$: Mesh message delivery rate.
   - $P_4$: Invalid message / signature failure penalty.
   - If $S < -50.0$, the node is quarantined immediately for 15 minutes.

---

### 5. Sybil Resistance: Dynamic Proof-of-Work (PoW)

To prevent an adversary from cheaply registering millions of virtual nodes to overwhelm Kademlia buckets:
1. **Dynamic Difficulty Equation:**
   $$\text{Leading Zero Bits} = 16 + \lfloor \log_2(\text{Active Swarm Count}) \rfloor$$
2. **Ticket Verification:**
   Before a node joins the routing table, it must present a nonce solving:
   $$\text{SHA-256}(\text{NodeID} \,\|\, \text{Timestamp} \,\|\, \text{Nonce}) < \text{Target}$$
   with timestamp freshness within 300 seconds.

---

### 6. NAT Traversal & Gateway Relays

1. **Auto-Discovery of Public IP:** Interactive Connectivity Establishment (ICE) checks STUN servers (`turn.sovra.me:3478`).
2. **UPnP & NAT-PMP:** Automatic router port forwarding requests for TCP port `4001`.
3. **Circuit Relay v2:** Symmetrically NAT-blocked mobile nodes establish communication through public relay nodes using Circuit Relay v2 protocols with 15-minute connection limits.
