# SOVRA P2P Security Architecture & Adversarial Threat Model

**Document Version:** 1.0.0  
**Focus:** Layer 3 Peer-to-Peer Threat Taxonomy, Attack Mitigation, & Residual Risk Analysis  
**Status:** Approved & Verified

---

## 1. Threat Taxonomy Matrix

| Threat ID         | Attack Vector                 | Severity | Mitigation Architecture                                                    | Verification Gate                  |
| :---------------- | :---------------------------- | :------- | :------------------------------------------------------------------------- | :--------------------------------- |
| **THREAT-P2P-01** | Sybil Mesh Pollution          | High     | Proof of cryptographic identity binding + behavior-based peer scoring      | Graylisting/Blacklisting test      |
| **THREAT-P2P-02** | Eclipse Attack                | Critical | Multi-bootstrap hierarchy + Kademlia $k$-bucket peer diversity ($k=20$)    | Routing table bucket capacity test |
| **THREAT-P2P-03** | Handshake Replay / Forgery    | Critical | Noise_XX ephemeral keys + monotonic 64-bit sequence counters               | Replay detection test              |
| **THREAT-P2P-04** | GossipSub Message Flooding    | High     | Per-peer rate limiting (50 msg/s) + size caps (1MB) + score penalties      | DoS resilience test                |
| **THREAT-P2P-05** | Malicious Relay Eavesdropping | High     | End-to-end AEAD encryption (ChaCha20-Poly1305) over relay hops             | Relay confidentiality test         |
| **THREAT-P2P-06** | Rogue Relay Drop / DoS        | Medium   | Multi-relay fallback with automatic route elevation                        | Relay failover test                |
| **THREAT-P2P-07** | Network Partition Hijack      | Medium   | Self-contained local cluster operations + cryptographic continuity healing | Partition healing test             |
| **THREAT-P2P-08** | Secret Leakage in Telemetry   | Critical | Redaction of private keys and session keys from metrics                    | Metrics collector audit            |

---

## 2. Detailed Threat Analysis & Mitigations

### 2.1 Sybil Mesh Pollution (THREAT-P2P-01)

#### Threat Description

An attacker generates thousands of ephemeral Ed25519 keypairs to flood GossipSub topic meshes, amplify duplicate traffic, or dilute honest peers.

#### Mitigations

1. **Device Delegation Requirement:** Devices must present a valid `DeviceDelegationAssertion` signed by a Master Identity DID to form trusted connections.
2. **Behavioral Peer Scoring:** Peers that spam, exceed rate limits, or send invalid events accumulate negative score deltas.
3. **Threshold Graylisting & Blacklisting:** Peers reaching $-20$ points are pruned from topic meshes. Peers reaching $-50$ points are disconnected and blocked.
4. **Residual Limitation:** Pure identity creation cannot be completely prevented without centralized gatekeepers. Honest nodes defend locally through resource limits and peer diversity.

---

### 2.2 Eclipse Attack Mitigation (THREAT-P2P-02)

#### Threat Description

A coordinated set of malicious peers attempts to isolate an honest node by occupying all slots in its routing table and connection pool, censoring incoming and outgoing network traffic.

#### Mitigations

1. **Kademlia Bucket Capacity Bound ($k=20$):** No single peer cluster can monopolize a distance bucket. Stale peers are probed before eviction.
2. **Multi-Bootstrap Redundancy:** Nodes query independent community and user-configured bootstrap nodes, preventing a single compromised seed node from dictating the routing table.
3. **Local Peer Discovery:** LAN discovery (mDNS) provides independent connectivity even if wide-area DHT discovery is compromised.

---

### 2.3 Handshake Replay & Forgery Defense (THREAT-P2P-03)

#### Threat Description

An eavesdropper records previously exchanged handshake messages or frame payloads and replays them to hijack sessions or trigger duplicate state transitions.

#### Mitigations

1. **Fresh Ephemeral Keys:** Every connection handshake creates fresh X25519 ephemeral keys ($e_I, e_R$) and 16-byte random nonces.
2. **Monotonic Frame Nonces:** Every frame increments a 64-bit Big-Endian sequence counter. Frames with counter values $\le$ the last seen sequence number are immediately rejected.
3. **Cryptographic Transcript Binding:** Handshake signatures cover the complete concatenation of ephemeral keys and random nonces.

---

### 2.4 Malicious Relay Protection (THREAT-P2P-05 & THREAT-P2P-06)

#### Threat Description

An untrusted intermediary node operating a Circuit Relay v2 service attempts to inspect user payloads, alter protocol messages, or drop traffic selectively.

#### Mitigations

1. **Zero Payload Trust:** Circuit relays only forward opaque ciphertext frames. The symmetric session keys are negotiated directly between endpoints using Diffie-Hellman; the relay never possesses decryption keys.
2. **Immutability of Signatures:** Even if a relay modifies ciphertext bytes, the receiving endpoint's AEAD MAC verification fails and the connection is dropped.
3. **Multi-Relay Dynamic Failover:** If Relay A drops connections or fails, the client automatically re-routes traffic through Relay B. Direct connections are always preferred when reachable.

---

### 2.5 Denial of Service (DoS) & Resource Exhaustion (THREAT-P2P-04)

#### Threat Description

An adversary attempts to crash or stall a node by initiating connection floods, opening unbounded concurrent streams, or broadcasting massive payloads.

#### Mitigations

- `maxConnections`: Hard cap of 100 active connections. Exceeding connections are rejected with `ERR_P2P_RESOURCE_EXCEEDED`.
- `maxStreamsPerConnection`: Hard cap of 32 concurrent streams. Additional streams receive a `RST` frame.
- `maxMessageSizeBytes`: Hard cap of 1 MB. Payloads larger than 1 MB are dropped before JSON decoding.
- `rateLimitMsgsPerSec`: Max 50 messages/sec per peer. Exceeding peers are penalized in the Peer Scoring Engine.

---

### 2.6 Privacy Properties & Network Metadata Exposure

| Metadata               | Visible to Direct Peer | Visible to Circuit Relay | Visible to DHT Peer | Visible to GossipSub Mesh |
| :--------------------- | :--------------------- | :----------------------- | :------------------ | :------------------------ |
| Real IP Address        | Yes                    | Yes                      | Yes (if dialed)     | Yes (to mesh neighbors)   |
| Device Key Hex         | Yes (in handshake)     | No (encrypted)           | No                  | Yes (event author)        |
| Master DID             | Yes (in delegation)    | No (encrypted)           | No                  | Yes (delegation tag)      |
| E2EE Content           | No (encrypted)         | No (encrypted)           | No                  | No (encrypted)            |
| Plaintext Public Posts | Yes                    | No (encrypted hop)       | No                  | Yes (after validation)    |

**Privacy Disclosure:** P2P networks disclose IP addresses to directly connected peers. Users desiring network-level IP anonymity must operate Sovra over Tor, I2P, or VPN transports.
