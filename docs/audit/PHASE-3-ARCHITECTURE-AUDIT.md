# SOVRA PHASE 3: COMPREHENSIVE ARCHITECTURE & BOUNDARY AUDIT

## 1. System Architecture Map

The Sovra decentralized P2P networking stack is structured as a layered protocol stack from consumer applications down to the physical/OS network boundary.

```
+-------------------------------------------------------------------------+
|                              Application Layer                          |
|             apps/sovra-app (Consumer & Creator Studio)                  |
|             [Zero runtime dependency on apps/sovra-admin]               |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
|                            Master Identity                              |
|                packages/identity: SovraIdentityKey (Tier 1)             |
|                   DID: `did:sovra:<fingerprint>`                        |
|             (Offline Master Ed25519 Root Key, Root of Trust)            |
+-------------------------------------------------------------------------+
                                    │ Signs DeviceDelegation Certificate
                                    ▼
+-------------------------------------------------------------------------+
|                            Device Identity                              |
|                 packages/identity: SovraDeviceKey (Tier 2)              |
|                DID: `did:sovra:device:<fingerprint>`                    |
|             (Per-device Ed25519 Keypair in Secure Storage)              |
+-------------------------------------------------------------------------+
                                    │ Signs PeerIdentityBinding Statement
                                    ▼
+-------------------------------------------------------------------------+
|                             Peer Identity                               |
|                  packages/p2p/src/identity.ts (Tier 3)                  |
|                  libp2p Peer ID: `12D3KooW...`                          |
|    (Deterministic protobuf multihash from Device Ed25519 Public Key)    |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
|                           Discovery Engine                              |
|                 packages/p2p/src/discovery.ts                           |
|       - Tier 1: Local LAN Discovery (Multicast / UDP)                   |
|       - Tier 2: Static Geo-Distributed Community Seeds                  |
|       - Tier 3: Kademlia DHT Iterative Peer Routing                     |
|       - Tier 4: Circuit Relay v2 Peer Directory                         |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
|                           Transport Layer                               |
|              packages/p2p/src/transport.ts (TCP / Memory)               |
|            - OS TCP Socket Transport (node:net)                         |
|            - Connection state management & address resolution            |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
|                        Noise Protocol Security                          |
|       Noise_XX_25519_ChaChaPoly_SHA256 (Revision 34 State Machine)      |
|       - 3-Way Handshake: -> e, <- e, ee, s, es, -> s, se                |
|       - Ephemeral X25519 DH for PFS                                     |
|       - Encrypted Static Device Identities (Privacy)                    |
|       - Authenticated Framing: ChaCha20-Poly1305 AEAD                   |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
|                         Stream Multiplexing                             |
|                 packages/p2p/src/multiplex.ts                           |
|          - Yamux-Compatible 12-byte Big-Endian Framing                  |
|          - Stream types: DATA(0), WINDOW_UPDATE(1), PING(2), GO_AWAY(3) |
|          - Credit-based Flow Control & Backpressure                     |
|          - Stream ID allocation: Initiator (Odd), Responder (Even)      |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
|                         Connection Management                           |
|                 packages/p2p/src/connection.ts                          |
|          - Max active connection pool limits                            |
|          - Exponential backoff with jitter reconnect                    |
|          - Lifecycle states: connecting, connected, relayed, failed     |
|          - Idle connection pruning                                      |
+-------------------------------------------------------------------------+
                                    │
          ┌─────────────────────────┴────────────────────────┐
          ▼                                                  ▼
+------------------------------------+    +------------------------------------+
|            Kademlia DHT            |    |          GossipSub v1.2            |
|       packages/p2p/src/dht.ts      |    |      packages/p2p/src/gossipsub.ts |
| - 256-bit XOR Distance Metric      |    | - Mesh Topology (D=6, 4<=D<=12)    |
| - k=20 Buckets with LRS Eviction   |    | - Control: GRAFT, PRUNE, IHAVE,    |
| - Iterative Routing with alpha=3   |    |   IWANT, PING                      |
| - Signed Provider Records & TTL    |    | - Heartbeat & Fanout Management    |
| - Content-Addressed CIDs (Phase 4) |    | - Seen-Cache Deduplication         |
+------------------------------------+    +------------------------------------+
          │                                                  │
          ▼                                                  ▼
+------------------------------------+    +------------------------------------+
|      Request / Response RPC        |    |          NAT & Circuit Relay       |
|      packages/p2p/src/reqresp.ts   |    |    packages/p2p/src/nat.ts & relay.ts|
| - Correlated Request IDs           |    | - AutoNAT Reachability Probing     |
| - Timeouts, Cancellation & Retries |    | - Circuit Relay v2 Fallback        |
| - Payload Size Hard Limits (1MB)   |    | - End-to-End Encrypted Tunnels     |
| - Per-Peer Concurrency Quotas      |    | - Direct Elevation Upgrades        |
+------------------------------------+    +------------------------------------+
```

---

## 2. Cross-Boundary Dependency Inspection

### 2.1 Central Services & Databases
- **Result:** **NONE**.
- There are **no central databases** (PostgreSQL, MongoDB, SQLite, Redis), no central directory services, and no central registration authorities.
- State is held in cryptographic data structures:
  - In-memory Kademlia DHT routing table (`KademliaBucket[]`).
  - GossipSub topic mesh sets.
  - Seen cache LRU sets.
  - Monotonic sequence numbers and replay sets.

### 2.2 DNS Dependencies
- **Result:** **ZERO HARD DNS DEPENDENCIES**.
- Nodes are identified and addressed via libp2p Multiaddresses:
  - Numerical IP addresses: `/ip4/198.51.100.1/tcp/4001/p2p/12D3KooW...`
  - Local addresses: `/ip4/127.0.0.1/tcp/4101/p2p/12D3KooW...`
- The system functions fully offline or across air-gapped ad-hoc LANs without DNS resolution.
- Domain names in multiaddresses (`/dns4/seed.sovra.net/...`) are optional convenience wrappers, with fallback to hardcoded IP multiaddresses and LAN multicast.

### 2.3 HTTP & Admin APIs
- **Result:** **ZERO PROTOCOL DEPENDENCY ON ADMIN APIS**.
- Static AST and package analysis verifies that `packages/p2p` imports:
  - `@sovra/crypto`
  - `@sovra/identity`
  - `@sovra/protocol`
  - `@sovra/shared`
- `packages/p2p` has **no import statements** referencing `apps/sovra-admin`, `services/moderation-worker`, `services/search`, or `services/transcoder`.
- If the Company Admin Panel (`apps/sovra-admin`) is taken offline, powered down, or blocked, all P2P nodes continue discovering peers, routing DHT queries, gossiping events, and handling requests without degradation.

### 2.4 Cloud & Infrastructure Dependencies
- **Result:** **ZERO PROPRIETARY CLOUD DEPENDENCIES**.
- No AWS (S3, DynamoDB, SQS), Google Cloud, Azure, Cloudflare, or proprietary vendor SDKs are imported or required by `@sovra/p2p`.
- The system runs on bare-metal servers, desktop computers, mobile devices, or virtual machines running standard Node.js/Edge runtimes.

### 2.5 Bootstrap Dependencies
- **Audit Finding (P1 Hardening Required):**
  - While nodes can accept arbitrary bootstrap lists, hardcoded bootstrap nodes can form an operational availability bottleneck if they are monopolized by a single entity.
  - The stack architecture includes:
    1. Multi-operator bootstrap configuration (`bootstrapNodes`, `communityNodes`, `userConfiguredNodes`, `cachedKnownPeers`).
    2. Local LAN discovery (`LocalDiscoverySource`).
    3. Cached peer persistence so a node that has connected once does not require bootstrap nodes on restart.

### 2.6 External Package Dependencies
- `@noble/curves` (`2.4.0`): Audited, zero-dependency Ed25519 & X25519 primitives.
- `@noble/hashes` (`2.4.0`): Audited, zero-dependency SHA-256 & HKDF primitives.
- `@noble/ciphers` (`2.4.0`): Audited, zero-dependency ChaCha20-Poly1305 AEAD primitive.
- `@scure/base` (`2.4.0`): Audited, zero-dependency Base58btc and multihash encoding.
- `node:net`: Standard Node.js networking library for real OS TCP socket connections.
- `vitest`: Development test runner.
- **Zero untrusted or unvetted external dependencies**.
