# SOVRA Master Architecture Specification

## 1. Executive Summary & Core Philosophy

**Sovra** is a decentralized, censorship-resistant, protocol-first social platform combining microblogging, short and long-form video, end-to-end encrypted messaging, decentralized communities, and native creator tools.

Sovra is fundamentally designed under the principle:

> **"Decentralize the protocol first. Build the user experience on top of it. Keep company administration separate from network operation. Eliminate single points of failure wherever technically practical."**

The platform consists of two strictly decoupled products:

1. **Product A (Sovra End-User Product):** The unified consumer application for regular users and creators. Includes feeds, media publishing, stories, communities, E2EE chat, calls, and an embedded Creator Studio. Functions autonomously over peer-to-peer protocols and decentralized storage.
2. **Product B (Sovra Company Admin Panel):** An internal operations and compliance console used strictly by authorized company staff for infrastructure observability, node telemetry, moderation queues, legal requests, and analytics.

**Zero Critical Dependency Invariant:**
If Product B (Admin Panel) and all company-hosted backend servers are completely terminated, taken offline, or blocked:

- End-users MUST continue communicating, posting, and discovering peers.
- Existing peer-to-peer connections and DHT routing MUST remain operational.
- Decentralized cryptographic identities MUST remain valid and verifiable.
- End-to-end encrypted messaging MUST proceed through fallback relays or direct P2P transports.
- Content distributed across independent storage providers MUST remain retrievable via content addressing (CIDs).

---

## 2. High-Level System Topology

```
+---------------------------------------------------------------------------------------------------------+
|                                        PRODUCT A: SOVRA CLIENT APP                                      |
|  (Web / Desktop / Mobile - Unified User & Embedded Creator Studio with Device-Side Screen-Time Engine)  |
+---------------------------------------------------------------------------------------------------------+
       |                           |                          |                          |
       | Cryptographic Keys        | Signed Events            | E2EE Sessions            | Video Segments
       v                           v                          v                          v
+------------------+     +--------------------+     +-------------------+     +-------------------------+
| Identity Engine  |     | Social Graph Core  |     | E2EE Messaging    |     | Media Pipeline          |
| (DID / Ed25519)  |     | (Event Verifier)   |     | (Double Ratchet)  |     | (HLS / Transcoding)     |
+------------------+     +--------------------+     +-------------------+     +-------------------------+
       |                           |                          |                          |
       +---------------------------+--------------------------+--------------------------+
                                               |
                                               v
                        +-----------------------------------------------+
                        |              SOVRA PROTOCOL CORE              |
                        |      (libp2p Transport, GossipSub, DHT)       |
                        +-----------------------------------------------+
                                 /             |              \
                                /              |               \
                               v               v                v
                 +-------------------+ +---------------+ +--------------------+
                 | Storage Providers | | Relay Network | | Community Nodes    |
                 |  (IPFS / Helia)   | | (Circuit v2)  | | (Topic Aggregators)|
                 +-------------------+ +---------------+ +--------------------+
                                               ^
                                               | (Read-only Telemetry & Node RPC)
+----------------------------------------------+----------------------------------------------------------+
|                                     PRODUCT B: SOVRA ADMIN CONSOLE                                      |
|    (Separate Internal Operations Web App: RBAC, Content Review, Node Telemetry, Audit Logs)             |
+---------------------------------------------------------------------------------------------------------+
```

---

## 3. The Protocol Stack Layers

Sovra adheres to a strict 7-layer decoupled protocol architecture:

```
+----------------------------------------------------------------------------+
| Layer 7: Application & UI Layer                                            |
|   - Consumer Feed, Video Player, Story Viewer, Chat UI, Creator Studio     |
|   - Device-side Screen-Time Guardian & Local Content Policy Filter         |
+----------------------------------------------------------------------------+
| Layer 6: Local Engine & Cache Layer                                        |
|   - Chronological Local Feed Engine, Local SQLite/IndexedDB State Cache    |
|   - Ephemeral Memory Store, Keyring Storage (Keychain / DPAPI / WebCrypto) |
+----------------------------------------------------------------------------+
| Layer 5: Application Protocol & Services Layer                             |
|   - Sovra Event Schemas (Post, Reaction, Follow, Community, Moderation)    |
|   - E2EE Messaging Engine (X3DH Key Agreement + Double Ratchet)            |
|   - WebRTC Signaling over P2P PubSub for 1:1 and Group Calls               |
+----------------------------------------------------------------------------+
| Layer 4: Storage & Content Addressing Layer                                |
|   - IPFS / Helia Content Addressing (CIDv1, SHA-256 / BLAKE3)              |
|   - Video Segment Transcoder & HLS Manifest Generator (360p - 1080p)       |
|   - Encrypted Blob Storage for private attachments                         |
+----------------------------------------------------------------------------+
| Layer 3: P2P Network & Routing Layer (libp2p)                              |
|   - Transports: TCP, WebSockets, WebRTC Direct                             |
|   - Security: Noise Handshake Protocol (XX pattern)                        |
|   - Multiplexing: Yamux                                                    |
|   - Peer Discovery: Kademlia DHT, mDNS (LAN), Bootstrap List               |
|   - Messaging Broadcast: GossipSub v1.2 (Topic mesh with peer scoring)     |
|   - NAT Traversal: STUN, AutoNAT, Circuit Relay v2 Fallback                |
+----------------------------------------------------------------------------+
| Layer 2: Identity & Cryptographic Primitives Layer                        |
|   - Root Keypair: Ed25519 (Signing) & X25519 (Key Agreement)               |
|   - Decentralized Identifiers: did:key / did:sovra                         |
|   - Signed Event Verification (Canonical JSON + Ed25519 Signature)         |
|   - Multi-device linking through signed delegation delegations             |
+----------------------------------------------------------------------------+
| Layer 1: Physical / Network Transport                                      |
|   - Raw IP, Internet, Local Area Network, Mesh Radios                      |
+----------------------------------------------------------------------------+
```

---

## 4. Product A: Sovra End-User Application

### 4.1 Single Application Architecture

The consumer product is a single, unified client targeting Web, Desktop (Electron/Tauri), and Mobile (Capacitor/React Native).

**Integrated Creator Mode:**

- No separate "Creator App". Any user account can toggle Creator Mode inside Settings.
- Activating Creator Mode unlocks the **Creator Studio** route (`/studio`), which exposes:
  - Video upload, multi-track audio, and thumbnail configuration.
  - Multi-resolution segment processing previews.
  - Drafts and local scheduled publishing queues.
  - Decentralized analytics (locally aggregated engagement telemetry from signed interaction proofs).
  - Subscriber/follower management and community administration.
  - Channel branding, badges, and subscription tiers.

### 4.2 End-User Navigation Layout

```
/home           - Chronological & Following Feed (posts, photos, short clips)
/explore        - Trending topics, decentralized tag index, community spotlights
/videos         - Dedicated short-form ("Clips") and long-form video player
/communities    - Decentralized topic spaces and governance channels
/messages       - End-to-end encrypted direct & group messaging
/notifications  - Verified signed alerts (mentions, follows, replies)
/profile        - User identity, public keys, authored signed events, media gallery
/settings       - Identity keys, device linking, screen-time controls, safety filters
/studio         - Integrated Creator Studio (visible when Creator Mode is ON)
```

### 4.3 Device-Side Screen-Time Engine

Sovra enforces digital wellbeing at the client edge, removing dependence on central servers:

- **Local Budget Timers:**
  - Daily Global App Limit (e.g. 60 min/day).
  - Feed Time Limit (e.g. 30 min/day).
  - Short Video / Clips Limit (e.g. 20 min/day).
  - Explore Limit (e.g. 15 min/day).
- **Enforcement Mechanisms:**
  - Soft warning at 80% utilization.
  - Hard lock with break challenges (e.g. 5-minute cooldown timer).
  - Configurable "Quiet Hours" blocking notifications and media autoplay.
  - Autoplay defaults to OFF or respects cellular/Wi-Fi profiles.
  - Tamper-resistant local storage using monotonic clock offsets and secure local storage.

---

## 5. Product B: Sovra Company Admin Panel

### 5.1 Autonomous Operational Scope

The Sovra Admin Panel (`apps/sovra-admin`) is an isolated, internal dashboard used solely for infrastructure monitoring, legal compliance, and community health.

**Admin Features & Sections:**

1. **Dashboard:** Global network health, active bootstrap node uptime, storage capacity, indexing load.
2. **Users & Creators Operations:** Lookup of indexed public keys, verification badge grant workflows, moderation flags.
3. **Content & Reports:** Review queues for reported CIDs, automated safety scan quarantine list.
4. **Moderation Queue:** High-confidence automated violations, human reviewer escalations, policy audit trail.
5. **Appeals:** User-submitted signed appeal requests and reinstatement workflows.
6. **Communities:** Supervised communities directory, policy enforcement for hosted relays.
7. **Node & Network Operations:** Real-time health of company-run full nodes, bootstrap relays, and indexers.
8. **Storage Operations:** Pinning service metrics, IPFS cluster storage utilization, bandwidth counters.
9. **Security & Incidents:** Sybil attack detection heuristics, GossipSub flood alerts, suspicious administrative login telemetry.
10. **Policies & Config:** Dynamic platform safety thresholds, perceptual hash lists, blacklists for company-operated bootstrap nodes.
11. **Audit Logs:** Tamper-evident administrative action ledger (signed by moderator key).
12. **RBAC & Staff:** Multi-tier role permissions and credential lifecycle management.

### 5.2 Role-Based Access Control (RBAC)

```
+------------------+--------------------------------------------------------------------------+
| Role             | Allowed Permissions                                                      |
+------------------+--------------------------------------------------------------------------+
| SUPER_ADMIN      | System config, staff management, emergency circuit breakers, key actions |
| SECURITY_ADMIN   | Node firewalls, Sybil mitigation rules, threat logs, session revocation  |
| MODERATOR        | Process report queues, quarantine illegal media CIDs, review appeals     |
| SUPPORT          | Ticket triage, public key lookups, non-destructive account assistance   |
| ANALYST          | Aggregated analytics, performance graphs, anonymized usage metrics       |
| INFRA_OPERATOR   | Node deployment, transcoder health, relay restarts, storage pinning     |
+------------------+--------------------------------------------------------------------------+
```

### 5.3 Single Point of Failure (SPOF) Safeguard

- The Admin Panel communicates only with **Company-Operated Observer Nodes** and **Admin Gateway APIs**.
- The decentralized network protocol does **not** query the Admin API for authentication, event validation, or routing.
- If the Admin Panel fails or its database is corrupted, consumer apps experience zero downtime.

---

## 6. Decentralized Protocol Specification

### 6.1 Cryptographic Identity Model

Every user account is rooted in an asymmetric cryptographic keypair.

- **Primary Identity Key:** `Ed25519` keypair for digital signatures.
- **Messaging Key:** `X25519` keypair for Diffie-Hellman key agreement.
- **Identifier Format:** `did:key:z6Mku...` derived directly from the Ed25519 public key using multicodec and multibase (base58btc).
- **Identity Document (DID Doc):**
  ```json
  {
    "@context": ["https://www.w3.org/ns/did/v1"],
    "id": "did:key:z6MkwSUsZ2Z3...pubkey...",
    "verificationMethod": [
      {
        "id": "did:key:z6MkwSUsZ2Z3...#key-1",
        "type": "Ed25519VerificationKey2020",
        "controller": "did:key:z6MkwSUsZ2Z3...",
        "publicKeyMultibase": "z6MkwSUsZ2Z3..."
      }
    ],
    "authentication": ["did:key:z6MkwSUsZ2Z3...#key-1"],
    "keyAgreement": [
      {
        "id": "did:key:z6MkwSUsZ2Z3...#dh-1",
        "type": "X25519KeyAgreementKey2020",
        "controller": "did:key:z6MkwSUsZ2Z3...",
        "publicKeyMultibase": "z6LSb5rV..."
      }
    ]
  }
  ```
- **Key Storage Security:**
  - Web: Non-extractable WebCrypto API keys in encrypted IndexedDB using a master key derived via Argon2id.
  - Desktop: OS-level secure storage (Windows DPAPI / Credential Manager, macOS Keychain, Linux Secret Service).
  - Mobile: iOS Keychain with Secure Enclave / Android Keystore.
  - **Zero Server-Side Storage:** Private keys NEVER touch network requests or server memory.

### 6.2 Signed Event Specification

All social graph actions (posts, follows, reactions, community memberships) are serialized as canonical JSON and signed by the author's Ed25519 private key.

**Canonical Event Schema:**

```json
{
  "id": "sha256_hash_of_canonical_payload",
  "pubkey": "ed25519_public_key_hex",
  "created_at": 1780000000,
  "kind": 1,
  "tags": [
    ["e", "reply_to_event_id"],
    ["p", "target_pubkey"],
    ["t", "hashtag"]
  ],
  "content": "Text body or CID reference",
  "media": [
    {
      "cid": "bafybeic5...720p.m3u8",
      "mime": "application/x-mpegURL",
      "type": "video",
      "variants": ["360p", "720p", "1080p"],
      "hash": "sha256_media_content_hash"
    }
  ],
  "sig": "ed25519_hex_signature"
}
```

**Standard Event Kinds:**

- `0`: Metadata / User Profile (display name, bio, avatar CID).
- `1`: Short-form Post / Microblog.
- `2`: Follow / Unfollow assertion.
- `3`: Reaction / Like (reference event ID).
- `4`: Comment / Reply.
- `10`: Video Publication (HLS manifest CID + metadata).
- `20`: Community Creation & Membership assertion.
- `30`: Moderation Assertion (signed flagging or blocklist assertion).
- `40`: Creator Subscription Assertion.

### 6.3 P2P Network Architecture (libp2p)

- **Peer ID:** Multi-format hash of the peer's public key.
- **Transports:**
  - WebSocket (with WSS) for browser clients.
  - TCP + QUIC for desktop, mobile, and server nodes.
  - WebRTC Direct for browser-to-browser P2P without intermediate servers.
- **Security & Multiplexing:**
  - Noise protocol (Noise_XX_25519_ChaChaPoly_BLAKE2s).
  - Yamux stream multiplexer.
- **Peer Discovery & Routing:**
  - Kademlia DHT (`/sovra/kad/1.0.0`) for decentralized routing and peer lookup.
  - Local Peer Discovery (mDNS) for LAN environments.
  - Configurable seed/bootstrap nodes (distributed geographically, run by multiple independent entities).
- **PubSub Event Distribution:**
  - **GossipSub v1.2** with peer scoring to resist spam, message amplification, and Sybil injection.
  - Topics:
    - `/sovra/feed/global` (global announcements/sync).
    - `/sovra/user/<pubkey>` (user's outbound signed events).
    - `/sovra/community/<id>` (community events and discussion).
    - `/sovra/moderation/telemetry` (node-level reputation updates).
- **NAT Traversal:**
  - STUN / AutoNAT service to determine public address and dialability.
  - **Circuit Relay v2:** Hop and reserve protocol allowing firewalled nodes to receive traffic via intermediate relays without trusting the relay with payload data.

### 6.4 Distributed Storage Architecture (IPFS & Content Addressing)

- **Content Addressing:** Every public media asset is hashed to a `CIDv1` (base32, raw-leaves, blake3 or sha2-256).
- **Chunking & DAG:** Media files are split into 256KB chunks represented as UnixFS v2 DAGs.
- **Provider System:**
  - Creator nodes pin their own content.
  - Community nodes pin content for members.
  - Independent storage nodes and pinning gateways provide high availability.
- **Transcoding Pipeline for Video:**
  ```
  Raw Input (MP4/MOV)
       |
       v
  Safety & Resolution Validation
       |
       v
  Local/Service Transcoding Worker (FFmpeg)
       |
       +---> 360p (H.264/AAC segment chunks .ts + 360p.m3u8)
       +---> 720p (H.264/AAC segment chunks .ts + 720p.m3u8)
       +---> 1080p (H.264/AAC segment chunks .ts + 1080p.m3u8)
       +---> master.m3u8 adaptive manifest
       |
       v
  Content Addressing (CIDs generated per chunk and manifest)
       |
       v
  PubSub / DHT Provider Record Broadcast
  ```

### 6.5 End-to-End Encrypted Messaging (E2EE)

- **Zero Public IPFS Storage for Private Chat:** Chat messages and private file attachments are strictly prohibited from entering public DHT/IPFS networks.
- **Protocol:** Signal-compatible protocol using:
  - **X3DH (Extended Triple Diffie-Hellman):** Asynchronous cryptographic handshake for establishing shared session keys.
  - **Double Ratchet Algorithm:** Continuous KDF ratchet per message ensuring **Forward Secrecy (FS)** and **Post-Compromise Security (PCS)**.
  - Symmetric Encryption: `AES-256-GCM` or `ChaCha20-Poly1305` with authenticated encryption.
- **Encrypted Media in Messaging:**
  - Attachments are encrypted locally with a randomly generated 256-bit symmetric key ($K_{media}$).
  - Encrypted ciphertext blob is sent directly P2P or deposited at an ephemeral encrypted relay buffer.
  - $K_{media}$ and blob hash are transmitted inside the E2EE ratchet payload.
- **Voice & Video Calling:**
  - WebRTC mesh (1:1) and SFU/MCU (for group calls).
  - Signaling occurs over encrypted P2P GossipSub or direct libp2p streams.
  - Media stream protected by standard DTLS-SRTP with verified fingerprint exchange.

---

## 7. Node Ecosystem Taxonomy

The Sovra ecosystem supports 5 distinct node roles:

```
+----------------------------------------------------------------------------------------------------+
| 1. Full Node (`nodes/full-node`)                                                                   |
|    - Runs libp2p, Kademlia DHT, GossipSub validator, local indexer, IPFS storage.                 |
|    - Fully verifies every signed event. Validates cryptographic signatures and event integrity.   |
+----------------------------------------------------------------------------------------------------+
| 2. Relay Node (`nodes/relay-node`)                                                                 |
|    - Lightweight, high-bandwidth server with public static IP.                                     |
|    - Implements libp2p Circuit Relay v2, STUN, AutoNAT assistance for browser and mobile peers.   |
|    - Does not read or inspect encrypted payload data. Zero knowledge of message plaintext.         |
+----------------------------------------------------------------------------------------------------+
| 3. Storage Node (`nodes/storage-node`)                                                             |
|    - High-capacity disk node running IPFS/Helia bitswap provider.                                  |
|    - Pins public video segments, image caches, and UnixFS trees.                                   |
|    - Can be operated by creators, communities, or third-party pinning providers.                   |
+----------------------------------------------------------------------------------------------------+
| 4. Index Node (`nodes/index-node`)                                                                 |
|    - Reads public GossipSub event feeds and builds fast query indexes (PostgreSQL, SQLite, Tantivy)|
|    - Exposes read-only search and discovery APIs for low-power mobile/web clients.                 |
|    - Untrusted: Client applications always verify event signatures from index queries.             |
+----------------------------------------------------------------------------------------------------+
| 5. Community Node (`nodes/community-node`)                                                         |
|    - Dedicated node for a specific community / channel.                                            |
|    - Pins community media, caches member lists, coordinates governance ballots, runs moderation.   |
+----------------------------------------------------------------------------------------------------+
```

---

## 8. Failure Resilience & SPOF Elimination Matrix

| Scenario / Outage                 | Traditional Centralized Social App  | Sovra Decentralized Protocol Behavior                                                              |
| :-------------------------------- | :---------------------------------- | :------------------------------------------------------------------------------------------------- |
| **Admin Panel Down**              | System unaffected or partial outage | **Zero impact.** Protocol has no admin dependency.                                                 |
| **Company API Servers Offline**   | Total platform outage               | **Zero impact.** Clients communicate P2P via DHT & relays.                                         |
| **Company Domain / DNS Seized**   | Complete platform outage            | **Zero impact.** Identity uses `did:key` (cryptographic), discovery uses DHT & multiaddrs.         |
| **Primary Relay Node Down**       | Regional connectivity drop          | **Auto-fallback.** libp2p switches to secondary relays in peer table.                              |
| **Storage Provider Partition**    | Media 404 errors                    | **Multi-provider BitSwap.** Content retrieved from any peer pinning the CID.                       |
| **Database Corruption**           | Massive data loss & outage          | **Zero network failure.** Source of truth is signed events; local DBs reconstruct from peers.      |
| **Network Partition / ISP Block** | Complete regional censorship        | **Mesh & Local Routing.** Local nodes continue exchanging events via LAN mDNS or alternate relays. |

---

## 9. Technology Stack & Workspace Structure

### 9.1 Recommended Core Technologies

- **Runtime:** Node.js 24 LTS
- **Package Management & Monorepo Tooling:** pnpm workspaces + Turborepo
- **Language:** TypeScript 5.x (Strict mode, ES2022 target)
- **Cryptography:** `@noble/curves` (Ed25519, Secp256k1), `@noble/hashes` (SHA-256, BLAKE3), `@noble/ciphers` (ChaCha20-Poly1305, AES-GCM)
- **P2P Stack:** `libp2p` v2.x (with `@libp2p/websockets`, `@libp2p/webrtc`, `@libp2p/gossipsub`, `@libp2p/kad-dht`, `@libp2p/noise`)
- **Storage:** `helia` / `ipfs-unixfs` / `@helia/block-brokers`
- **Client Frontend:** React 19, TailwindCSS, Vite
- **Admin Frontend:** React 19, TailwindCSS, Vite, TanStack Query, Lucide Icons
- **Local Storage:** SQLite (Desktop/Nodes via `better-sqlite3`), IndexedDB (Browser via `idb`)
- **Testing:** Vitest (Unit & Integration), Playwright (E2E), Chaos testing harness

### 9.2 Monorepo Directory Layout

```
sovra/
├── apps/
│   ├── sovra-app/                   # Product A: End-User Application + Creator Studio
│   └── sovra-admin/                 # Product B: Company Operations & Moderation Console
├── packages/
│   ├── crypto/                      # Audited cryptographic primitives & hashing
│   ├── identity/                    # DID, keypair generation, signing, verification
│   ├── protocol/                    # Canonical event definitions, schemas, validation
│   ├── p2p/                         # libp2p node wrapper, GossipSub topics, discovery
│   ├── storage/                     # Helia/IPFS chunking, CIDs, retrieval, pinning
│   ├── messaging/                   # E2EE Double Ratchet, X3DH, session store
│   ├── social/                      # Social graph, following engine, feed generator
│   ├── moderation/                  # Multi-stage safety classifier, perceptual hashing
│   ├── shared/                      # Types, errors, logging, telemetry abstractions
│   └── ui/                          # Shared Design System, UI components, themes
├── nodes/
│   ├── full-node/                   # Standalone peer node
│   ├── relay-node/                  # High-capacity Circuit Relay v2 daemon
│   ├── storage-node/                # IPFS pinning provider daemon
│   ├── index-node/                  # Read-optimized search and query indexer
│   └── community-node/              # Dedicated community server
├── services/
│   ├── transcoder/                  # Video multi-resolution segmentation service
│   ├── search/                      # Distributed index search worker
│   └── moderation-worker/           # Backend visual/audio safety scanner
├── tests/
│   ├── unit/                        # Package-level unit tests
│   ├── integration/                 # Multi-package protocol tests
│   ├── e2e/                         # Browser & app end-to-end tests
│   ├── security/                    # Cryptographic & fuzzing test suites
│   ├── reliability/                 # Network partition & churn tests
│   └── chaos/                       # Adversarial peer & Sybil injection tests
├── docs/
│   ├── architecture/                # Architecture specifications & roadmap
│   ├── protocol/                    # Event schemas & wire specs
│   ├── security/                    # Threat models & audit reports
│   ├── moderation/                  # Content policies & review procedures
│   └── operations/                  # Node operator & deployment guides
├── package.json                     # Monorepo root workspace configuration
├── pnpm-workspace.yaml              # pnpm workspace definition
├── turbo.json                       # Turbo build/test pipeline pipeline
└── tsconfig.base.json               # Root TypeScript configuration
```
