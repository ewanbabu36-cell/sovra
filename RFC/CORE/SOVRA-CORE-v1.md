# RFC SOVRA-CORE v1.0
## 12-Layer Logical System Architecture, Domainless Access & Economics

**Specification:** `SOVRA-CORE` (`v1.0`)  
**Status:** Frozen Baseline

---

## 1. 12-Layer Logical System Architecture

| Layer | Component | Responsibility | Independence Contract |
|---:|---|---|---|
| 1 | Application | Social, Business, Marketplace, Third-Party Apps | Client UI & app logic replaceable |
| 2 | Application Services | Search, user-controlled feeds, notifications | Rebuildable local indexes; no global algo |
| 3 | Identity | `SOVRA-ID` user & device identities | Pure client-side cryptography |
| 4 | Authorization | Device grants, capability scopes, revocations | Offline signature verification |
| 5 | Event Engine | `SOVRA-EVT` signed immutable event creation/verify | Deterministic CBOR + Ed25519 |
| 6 | Messaging | `SOVRA-MSG` E2EE envelopes & ratchets | Relay-blind confidentiality |
| 7 | Storage | `SOVRA-STORE` CID content-addressed blocks & DB | Interchangeable blockstores & providers |
| 8 | Synchronization | `SOVRA-SYNC` CRDTs, causal vectors, state machines | Deterministic convergence across forks |
| 9 | Discovery | `SOVRA-NET` DHT, PEX, mDNS, QR, signed bundles | Zero DNS requirement |
| 10 | Transport | Noise_XX / TLS 1.3, TCP, relay tunnels | Transport-agnostic framing |
| 11 | Governance | `SOVRA-GOV` community proposals, reviews, forks | No founder veto, no compulsory coin vote |
| 12 | Recovery | `SOVRA-OPS` partition survival, replica repair | Autonomous node & user key recovery |

Each layer communicates across open contracts so an alternative client, transport, storage daemon, or governance verifier can replace any single layer independently.

---

## 2. Protocol Namespaces (`/sovra/*/1.0.0`)

| Namespace | Protocol Layer |
|---|---|
| `/sovra/id/1.0.0` | Identity key/device/rotation resolution |
| `/sovra/net/1.0.0` | Capabilities, signed bootstrap, PEX, peer status |
| `/sovra/event/1.0.0` | Canonical CBOR event publish & query |
| `/sovra/store/1.0.0` | CID storage objects, pins, providers, PoR & repair |
| `/sovra/sync/1.0.0` | CRDT change exchange & causal version vectors |
| `/sovra/msg/1.0.0` | E2EE envelope submission & delivery acknowledgements |
| `/sovra/gov/1.0.0` | Governance proposals, reviews, votes & release manifests |
| `/sovra/app/1.0.0` | Scoped third-party capability negotiation |

Local Application APIs (`identity.*`, `peer.*`, `event.*`, `storage.*`, `sync.*`, `governance.*`) operate strictly between the local client and its user-controlled local node — NEVER as a founder-hosted backend.

---

## 3. Domainless & Cloudless Access & Economic Independence

- **Domainless Operation:** Discovery relies on public keys, PeerIDs, CIDs, direct IPs/multiaddrs, LAN mDNS, QR invites, DHT, and signed bootstrap bundles. Human-readable names are optional aliases.
- **Browser vs Native:** Browsers use cached SPAs/PWAs and browser-compatible transports, while native mobile/desktop applications serve as the full independent-node reference implementations.
- **Optional Incentives / No Mandatory Token:** Node participation (`full`, `storage`, `relay`, `community`, `light`, `browser`), social interactions, business profiles, marketplace state transitions, messaging, and governance all operate cleanly with **zero cryptocurrency or blockchain requirement**. Any optional token/escrow ledger (e.g., optional local sidecar or settlement adapter) remains strictly non-mandatory.
