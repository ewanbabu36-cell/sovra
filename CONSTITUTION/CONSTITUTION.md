# SOVRA CONSTITUTION
## Version 1.0 | Frozen Architecture Baseline

**Status:** Frozen Baseline  
**Governance:** Community-owned and open  
**Principle:** *"Sovra belongs to everyone who runs it."*

---

## 1. Fundamental Objective

Sovra must continue operating permanently and independently of its founder, original developers, founding company, servers, domains, cloud accounts, signing keys, and computers.

The founder is a contributor, not a permanent authority.

---

## 2. The 20 Non-Negotiable Constitutional Principles

1. **No mandatory central server.**
2. **No mandatory commercial cloud.**
3. **No mandatory purchased domain.**
4. **No central account-registration service.**
5. **No founder-controlled master database.**
6. **No global blockchain requirement.**
7. **No mandatory cryptocurrency.**
8. **No founder-only signing authority.**
9. **No single bootstrap dependency.**
10. **No single storage-provider dependency.**
11. **No mandatory official application.**
12. **No proprietary protocol lock-in.**
13. **No unilateral founder protocol changes.**
14. **No centralized network-wide shutdown mechanism.**
15. **Open specifications and implementation rights.**
16. **User-controlled cryptographic identity.**
17. **Independent community-operated infrastructure.**
18. **User-controlled data export and migration.**
19. **Graceful operation during network partitions.**
20. **Independent implementation and fork rights.**

---

## 3. Frozen Architectural Decisions

| Category | Decision |
|---|---|
| Identity | Sovra-native cryptographic identity (`SOVRA-ID`, Bech32m `sovra1...`) |
| Data | Hybrid signed events (`SOVRA-EVT`, Deterministic CBOR) + distributed storage (`SOVRA-STORE`) + CRDTs (`SOVRA-SYNC`) |
| Consensus | No global blockchain required; local consensus/state machines where needed |
| Economics | Optional community incentives; no mandatory token at launch |
| Governance | Open community governance (`SOVRA-GOV`) with unrestricted fork rights |
| Access | Browser/PWA + Android + Desktop (native node as reference daemon) |
| Networking | Peer-to-peer (`SOVRA-NET`) |
| Naming | Domain-independent identity and discovery |
| Hosting | Community-operated infrastructure |
| Source | Open-source reference implementations |

---

## 4. Five Independently Versioned Specifications

| Spec ID | Version | Scope | Authoritative RFC(s) |
|---|---|---|---|
| **SOVRA-CORE** | `1.0` | Identity, keys, P2P networking, security | [SOVRA-CORE-v1.md](file:///d:/Sovra/RFC/CORE/SOVRA-CORE-v1.md), [SOVRA-ID-v1.md](file:///d:/Sovra/RFC/IDENTITY/SOVRA-ID-v1.md), [SOVRA-NET-v1.md](file:///d:/Sovra/RFC/NETWORK/SOVRA-NET-v1.md) |
| **SOVRA-DATA** | `1.0` | Events, content storage, CRDT sync, E2EE messaging | [SOVRA-EVT-v1.md](file:///d:/Sovra/RFC/EVENTS/SOVRA-EVT-v1.md), [SOVRA-STORE-v1.md](file:///d:/Sovra/RFC/STORAGE/SOVRA-STORE-v1.md), [SOVRA-SYNC-v1.md](file:///d:/Sovra/RFC/SYNC/SOVRA-SYNC-v1.md), [SOVRA-MSG-v1.md](file:///d:/Sovra/RFC/MESSAGING/SOVRA-MSG-v1.md) |
| **SOVRA-APP** | `1.0` | Social, Marketplace, Business, App capabilities | [SOVRA-APP-v1.md](file:///d:/Sovra/RFC/APPLICATIONS/SOVRA-APP-v1.md) |
| **SOVRA-GOV** | `1.0` | Proposals, technical review, community decisions, forks | [SOVRA-GOV-v1.md](file:///d:/Sovra/RFC/GOVERNANCE/SOVRA-GOV-v1.md) |
| **SOVRA-OPS** | `1.0` | Node operations, monitoring, partition recovery, DR | [SOVRA-OPS-v1.md](file:///d:/Sovra/RECOVERY/SOVRA-OPS-v1.md), [THREAT-MODEL-v1.md](file:///d:/Sovra/SECURITY/THREAT-MODEL-v1.md) |

Every compatible implementation MUST advertise its supported `(spec_id, version)` capabilities during peer handshake.

---

## 5. Sovereignty, Fork Rights & The Ultimate 12-Step Test

1. Communities and implementers may fork the protocol, software, or network state at any stage without founder permission.
2. No protocol upgrade or contribution reward grants automatic governance control or compulsory token voting.
3. At any point, passing the **12-Step Founder-Disappears Experiment** (disabling all founder machines, accounts, bootstrap sources, storage, and relays, while new independent nodes boot from open specs, discover peers, verify local user keys, exchange CBOR signed events, synchronize CRDT state, retrieve surviving replicas, and release independent compatible clients) is mandatory for full constitutional compliance.
