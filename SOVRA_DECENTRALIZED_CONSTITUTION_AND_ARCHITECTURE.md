# SOVRA — Decentralized Network Constitution, Technical Architecture & Failure Recovery Specification

> **"Sovra belongs to its network, not to its founder."**  
> **Architectural Baseline:** Zero-Domain, Cloud-Independent, Founder-Independent Peer-to-Peer Ecosystem

---

## 1. The 10 Non-Negotiable Constitutional Rules

Every protocol change, client build, node binary, and governance release MUST satisfy all ten rules. Any pull request introducing a violation fails architectural compliance automatically.

| Rule | Architectural Requirement | Operational Enforcement |
| :--- | :--- | :--- |
| **1** | **No mandatory central server** | All social actions, E2EE chat, media retrieval, and ledger queries must resolve without a founder-operated origin server. |
| **2** | **No purchased domain dependency** | Discovery, bootstrapping, links, and media resolution must operate via cryptographic keys, direct IPs/multiaddrs, LAN mDNS, QR payloads, Tor `.onion`, and Peer Exchange (`SOVRA_NO_DNS=true`). DNS seeds are strictly non-authoritative convenience hints. |
| **3** | **No AWS, Vercel or VPS dependency** | Zero hard dependency on cloud compute, managed databases, S3, Firebase, or centralized TURN/push gateways for core protocol operation. |
| **4** | **No founder-controlled master database** | User feeds, profiles, follows, peer books (`peers.json`), CID blocks (`TieredBlockstore`), and chain state (`SovraApp` KV/PebbleDB) live across distributed participant nodes. |
| **5** | **No founder-only private key** | No hardwired founder signing authority, master admin override, or centralized software update key may gate participation or upgrades. |
| **6** | **No mandatory central authentication** | User identity is derived strictly on-device from Ed25519 / BIP-39 keys (`did:key:...` / `did:sovra:...` / libp2p `PeerID`). Login never phones home. |
| **7** | **No single bootstrap node** | Nodes persist known peers (`peers.json` / snapshot), accept QR imports, run LAN mDNS discovery, and exchange signed `SignedPeerRecord` adverts via P2P PEX (`/sovra/pex/1.0.0`) & HTTP `/api/peers`. |
| **8** | **No single storage provider** | Media is sliced into content-addressed UnixFS Merkle DAG blocks (SHA-256/BLAKE3 CIDs), exchanged via BitSwap, and verified with cryptographic Proof-of-Retrievability (PoR). |
| **9** | **No unilateral founder-controlled protocol upgrades** | L1 validator transitions require >= 2/3 cryptographic quorum signatures (no unverified bearer bypasses in production). Software releases require M-of-N multi-maintainer signatures + CID/SHA-256 verification. |
| **10** | **Open-source protocol and independently operated nodes** | Anyone can inspect, compile, audit, and operate `sovrad` (L1), `volunteer-node` (`full`/`relay`/`storage`/`seed`), and native/desktop clients independently. |

### Three Core Development Mandates
1. **Zero Hidden Central Dependency:** No dead `.trycloudflare.com` URLs, `p2p-relay.sovra.net` defaults, or remote `server.url` mobile web wrappers.
2. **Zero Founder Kill Switch:** No revocation/transition endpoint or app bundle update flag controlled by a single key or env bypass token in production.
3. **Independent Bootstrap, Operate, Recover & Upgrade:** Any surviving subset of nodes can onboard peers, exchange state, heal under-replicated CIDs, finalize blocks, and distribute verified binary updates while the founder is permanently offline.

---

## 2. The Founder Disappears Test

> **Core Stress Question:** *If the founder deletes all founder servers, accounts, domains, cloud keys, and computers right now, does the surviving community network continue operating?*

1. **Founder Shuts Down Everything:** All founder domains (`*.sovra.network`, `*.sovra.net`), founder cloud relays/APIs, and founder nodes become permanently unreachable (`NXDOMAIN` / `ECONNREFUSED`).
2. **Independent Nodes Continue:** Surviving volunteer `full`, `relay`, and `storage` nodes connect using persisted `peers.json`, LAN mDNS, QR pairing, and P2P PEX (`/sovra/pex/1.0.0`), continuing GossipSub propagation and BFT block finality.
3. **Users Retain Identities:** Local BIP-39 / Ed25519 keys on phones/PCs authenticate posts, reactions, E2EE chats, and transactions locally without contacting any auth server.
4. **Data Remains Accessible:** Posts, social graphs, and media blocks remain retrievable from volunteer peers/storage nodes holding replicas (`BitSwap` + `TieredBlockstore`), provided >= 1 replica survives online.
5. **Network Continues Evolving:** Validator changes execute only via >= 2/3 BFT quorum signatures; software updates verify M-of-N threshold maintainer signatures + SHA-256/CID hashes and replicate P2P.

---

## 3. Technical Stack & Honest Engineering Boundaries

| Layer | Protocol / Technology | Role & Scope Boundary |
| :--- | :--- | :--- |
| **Identity** | Ed25519 (`@sovra/crypto`, `@sovra/identity`), BIP-39 mnemonics | Self-sovereign `did:key` & libp2p `PeerID` verification without central directory. |
| **Transport & NAT** | TCP + `Noise_XX` + Yamux (`@sovra/p2p`), RFC 5389 UDP STUN probe, IPv4 + IPv6, Circuit Relay v2 forwarding (`/hop` + `/stop` tunnel) | Direct connections when cone NAT/public; **Circuit Relay v2 is mandatory under symmetric NAT / strict CGNAT** (STUN alone cannot guarantee direct traversal). True QUIC UDP transport is flagged explicitly if absent. |
| **Bootstrap & Discovery** | Multi-seed static list (optional/no-DNS mode), UDP LAN mDNS beacon, Signed QR (`sovra://peer/...`), P2P `/sovra/pex/1.0.0`, HTTP `/api/peers`, persisted `peers.json`, Kademlia DHT | Subnet diversity (`/24` IPv4, `/48` IPv6) + Ed25519-signed `SignedPeerRecord` verification to resist Sybil/Eclipse injection. |
| **Messaging & Social** | `SovraEvent` (Ed25519-signed RFC 8785 canonical JSON), GossipSub (`/sovra/gossipsub/1.2.0`), CRDT HLC + LWW tombstones + PNCounter, Double Ratchet ChaCha20-Poly1305 E2EE | Ordinary social events replicate via signed GossipSub + P2P sync rather than clogging L1 consensus blocks. |
| **Storage** | Content-addressed UnixFS Merkle DAGs (`CID`), `TieredBlockstore`, `BitSwapEngine` (`/sovra/bitswap/1.2.0`), `ReplicaVerificationEngine`, Ed25519-signed `ProofOfRetrievabilityEngine` | Creators can go offline once chunks replicate to independent volunteer storage nodes; corrupted/lazy chunks fail CID & PoR verification. |
| **Consensus & Incentives** | Go L1 (`sovrad`) custom BFT consensus + Merkle AppHash + Pebble/KV store + CosmWasm (`wazero`), strict 100M lifetime cap with Bitcoin-inspired bit-shift halving | Consensus used strictly for shared ordering, scarce token transfers, staking/slashing, and **cryptographically co-signed PoR/bandwidth/relay reward verification** (zero self-reported yields). |
| **Distribution** | Standalone Android APK / offline Web bundle (`webDir: "dist"`), Desktop/CLI Daemons (`sovrad`, `volunteer-node`), M-of-N signed update manifests distributed over P2P/BitSwap | Unavoidable platform walls (Apple iOS App Store/notarization/APNs, Play Integrity/Store review, OS firewall/carrier ports) are documented explicitly rather than hidden. |

---

## 4. Failure Recovery Specification

| Failure Mode | Automatic Detection | Recovery Protocol | Residual Limit |
| :--- | :--- | :--- | :--- |
| **All Bootstrap Seeds Offline** | Dial timeout / `ENOTFOUND` on static seeds | Load local `peers.json` / `PeerDiscoveryManager` snapshot -> scan LAN UDP mDNS -> prompt/accept QR peer scan (`sovra://peer/...`) -> PEX fanout from first reachable peer | Zero-peer cold device with empty `peers.json`, isolated behind restrictive AP/LAN needs at least 1 out-of-band peer hint (QR, hotspot/LAN peer, manual IP:port). |
| **All Relay Nodes Offline** | Relay `HOP` stream fails / socket close | Attempt direct IPv4/IPv6 TCP connections, switch to secondary volunteer relays from PEX book, queue E2EE/social operations in `DurableOutboxStore` / SQLite until relay reconnects | Two peers both stuck behind strict Symmetric NATs cannot communicate real-time until >= 1 non-NAT relay comes online. |
| **>= 50% Peer Churn / Partition** | Heartbeat / `socket.on('close')` + DHT probe failures | Automatic exponential-backoff reconnect via `ConnectionManager`, Kademlia bucket refresh, HLC/CRDT deterministic state merge on partition heal | Messages queued locally sync in monotonic causal order upon partition heal. |
| **Creator Disconnects After Publishing** | Origin PeerID offline on DHT/BitSwap | Client fetches DAG blocks from surviving `StorageNodeDaemon` providers discovered via DHT `findProviders` + BitSwap `WANT_BLOCK` | Requires >= 1 online seeder/storage node still pinning the CID. |
| **Under-Replicated / Failing Storage Node** | `ReplicaVerificationEngine` detects `actualReplicas < targetReplicationFactor` | Actively pushes missing DAG chunks via BitSwap to healthy connected storage peers (`actualReplicas` updates only on verified peer acceptance) | Bounded by available aggregate storage capacity among surviving volunteer nodes. |
| **Byzantine / Missing Validator(s)** | Missed precommits / equivocation / CommitCertificate check | `>= 2/3` quorum continues chain if `< 1/3` power offline; `SlashValidator` burns stake & jails offender; `valSchedule` transitions via `2/3+` quorum | `< 1/3` Byzantine fault limit per BFT math: if `> 1/3` voting power goes permanently offline simultaneously, finality halts until honest quorum recovers or social-consensus chain restart. |
| **Malicious Software Update / Key Compromise** | M-of-N threshold check, version monotonicity, SHA-256 / CID mismatch | Client rejects unsigned, single-signer (when threshold >= 2), tampered, or downgrade manifests; healthy peers stop seeding invalid artifacts | Requires fewer than `M` out of `N` maintainer keys compromised simultaneously. |

---

## 5. SOVRA MILESTONE 01 — Founder-Independent Network Proof (FINP)

Certification Criteria (honestly separating **reproducible local/multi-process test harness proof** from **physical multi-continent WAN deployment**):

1. >= 5 independent node identities run concurrently on distinct directories, ports, keystores, and peer books (`node-0`..`node-N`), cleanly separating founder processes from surviving community nodes.
2. Founder-designated bootstrap/relay/storage infrastructure is terminated completely (`SOVRA_NO_DNS=true`).
3. Fresh zero-DB / empty-peer-book new node joins exclusively via surviving independent peers (QR / mDNS / PEX `peers.json`), rejecting unsigned/forged/blacklisted announcements.
4. Existing users sign in purely with local keys (no HTTP auth server) and publish posts, follows, reactions, and E2EE messages replicated over P2P.
5. Media uploaded before creator disconnect stays retrievable from surviving volunteer storage nodes; corrupted chunks are rejected.
6. Killing active relay/storage/validator nodes triggers real failover, reconnect, and consensus/state survival among remaining nodes.
7. Validator set evolution & software update verification proceed strictly via multi-party cryptographic quorums without any founder-only secret key or env bypass.
