# SOVRA — RISK REGISTER & MITIGATION MATRIX
## Comprehensive Threat Modeling, Hardware Limitations & Operational Risks (Phase 0)

**Principal Architect:** Principal Security Auditor, Cryptographer & Distributed Systems Engineer  
**Date:** 2026-11-05  
**Evaluation Standard:** Zero-Trust Threat Modeling (STRIDE, CWE, OWASP Top 10)  

---

### 1. Risk Severity Classification

Risks are categorized by **Impact** (1–5) and **Likelihood** (1–5) to derive Risk Score ($Impact \times Likelihood$):
- **CRITICAL (Score 20–25):** Threatens cryptographic sovereignty, monetary hard caps, or causes universal network shutdown.
- **HIGH (Score 12–19):** Significant security or operational degradation; bypasses privacy or limits offline mesh functionality.
- **MEDIUM (Score 6–11):** Architectural inefficiency, temporary latency, or single-node disruption.
- **LOW (Score 1–5):** Minor cosmetic or edge-case platform variation.

---

### 2. Comprehensive Master Risk Register

| Risk ID | Risk Title & Description | Domain | Impact | Likelihood | Score | Severity | Engineered Mitigation Strategy |
|:---:|:---|:---:|:---:|:---:|:---:|:---:|:---|
| **RSK-SEC-01** | **Identity Spoofing via Header Forgery**<br>Untrusted callers inject forged `X-Sovra-DID` headers to impersonate victims. | Security | 5 | 5 | 25 | **CRITICAL** | Zero-trust authentication in `resolvePrincipal()`: strictly rejects raw headers. Requires valid session token, cookie with anti-CSRF, or signed Ed25519 payload with anti-replay nonce. |
| **RSK-SEC-02** | **Custodial Validator Key Exposure**<br>`scripts/dev-server.ts` holds `validator-0.key.json` locally to sign L1 transactions on behalf of users. | Security | 5 | 4 | 20 | **CRITICAL** | Replace custodial server-side signing in Phase 5 with client-side transaction signing in mobile secure enclave / WebAuthn authenticators. |
| **RSK-SEC-03** | **Unauthenticated Root Fallback (`did:sov:admin_root`)**<br>Privileged functions defaulting to genesis super-admin if caller DID is omitted. | Security | 5 | 4 | 20 | **CRITICAL** | Hardened in Phase 1: `hasPermission` strictly returns `false` on empty DID; `adjustBalance` and `treasuryTransfer` throw errors if verified admin DID is missing. |
| **RSK-ECON-01**| **Coin Supply Inflation Beyond 100M Cap**<br>Application-side deposit grants, referral bonuses, or unbacked mints violating 100M limit. | Economic | 5 | 4 | 20 | **CRITICAL** | Go Layer-1 blockchain is sole authoritative ledger. `GlobalLifetimeCap` enforced by `math.Int` in `x/issuance/keeper.go`. SQLite balances are non-authoritative read caches. |
| **RSK-ECON-02**| **Floating-Point Rounding & Dust Arbitrage**<br>Financial settlement using JavaScript IEEE 754 floats resulting in fractional leakage. | Economic | 4 | 4 | 16 | **HIGH** | Mandatory integer base units (`uSOV` = $10^{-6}$ SOV). All blockchain and ledger arithmetic executed with `cosmossdk.io/math.Int` or `BigInt`. |
| **RSK-PLAT-01**| **iOS Background BLE Suspension**<br>Apple iOS suspends background apps after 15–30 seconds, terminating BLE GATT peripheral advertising and killing background mesh. | Platform | 4 | 5 | 20 | **CRITICAL** | Acknowledge platform physical limitations honestly: BLE is used for foreground discovery and opportunistic rendezvous. Background sync uses Apple Push Notification service (APNs) silent background wakeups and VoIP entitlements. |
| **RSK-PLAT-02**| **Android Doze & Battery Optimization**<br>Android OEM aggressive battery managers terminate long-running BLE GATT scan loops. | Platform | 3 | 4 | 12 | **HIGH** | Use Android Foreground Service with persistent notification badge; implement exponential backoff scanning to preserve device battery. |
| **RSK-PRIV-01**| **Telemetry Leakage of Private Interactions**<br>Operational metrics inadvertently capturing message metadata, social graph links, or personal identifiers. | Privacy | 4 | 4 | 16 | **HIGH** | Architecture strictly decouples telemetry from user DIDs. Mandatory opt-in consent controls; client-side k-anonymity hashing; payload schema rejects text/media contents. |
| **RSK-NET-01** | **Sybil Flooding on P2P Swarm**<br>Attacker spins up 10,000 dummy nodes to eclipse routing tables or poison GossipSub topics. | Network | 4 | 4 | 16 | **HIGH** | Dynamic Proof-of-Work (PoW) ticketing required for peer registration; GossipSub v1.1 peer scoring isolates low-reputation nodes in < 3 seconds. |
| **RSK-NET-02** | **Network Partition & Divergent State**<br>Prolonged split between offline mesh clusters and global internet nodes. | Network | 4 | 3 | 12 | **HIGH** | CRDT state replication for social events (LWW-Element-Set); Delay-Tolerant Networking (DTN) epidemic outbox queues; idempotent transaction hashes. |
| **RSK-RES-01** | **Single Infrastructure Host Shutdown**<br>Cloud provider or VPS hosting central node is terminated, taking down public endpoints. | Resilience | 4 | 4 | 16 | **HIGH** | Litestream continuous WAL stream replication to multiple independent S3/MinIO buckets; multi-provider DNS fallback; reproducible Docker node images. |
| **RSK-RES-02** | **Domain Name Seizure or DNS Censorship**<br>Central domain registrar freezes `sovra.me` or DNS records. | Resilience | 4 | 3 | 12 | **HIGH** | Handshake / ENS decentralized naming support; direct IP/Port P2P bootstrap seeds (`seeds.txt`); Tor `.onion` and I2P gateway compatibility. |
| **RSK-AI-01**  | **Central Algorithmic Bias & Opaque AI Ranking**<br>Recommendation engine secretly manipulating feed contents or suppressing dissenting viewpoints. | AI | 4 | 3 | 12 | **HIGH** | `PersonalFeedRanker` executes 100% on-device with user-tunable weights (`topicWeights`, `noveltyWeight`); transparent explanation breakdown provided for every scored post. |
| **RSK-AD-01**  | **Invalid Traffic (IVT) & Click-Farm Fraud**<br>Botnets generating fake ad impressions to drain advertiser escrow balances. | Ad Exchange | 4 | 4 | 16 | **HIGH** | Attested Proof-of-Impression: requires Ed25519 cryptographic signature from verified consumer node with proof-of-humanity or biometric passkey binding. |

---

### 3. Risk Governance & Continuous Audit

1. **Gate Reviews:** Every phase transition (Phase 1 through Phase 10) must re-evaluate all 14 risk items.
2. **Zero-Trust Testing:** Automated adversarial tests in `tests/security/` run continuously on every Git push to prevent risk regression.
3. **Disclosure Policy:** Vulnerability bounties and transparent incident logs published to the tamper-evident audit ledger.
