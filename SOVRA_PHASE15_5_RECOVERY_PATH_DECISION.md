# SOVRA PHASE 15.5 — RECOVERY PATH ARCHITECTURAL DECISION

**Date:** November 22, 2026  
**Auditor:** Independent Release Verification Authority  
**Repository:** `D:\Sovra`  
**Decision Authority:** Core Consensus & Cryptographic Security Architecture  

---

## 1. Context & Problem Statement

Phase 15.1 and Phase 15.2 proved that the four genesis Ed25519 validator private keys for `sovra-testnet-0` had been committed to Git history in plaintext (`val-0.key.json` through `val-3.key.json`).

While Phase 15.2 generated clean encrypted replacement keystores and Phase 15.4 integrated `ValidatorSchedule` into the consensus engine, the running local network (`sovra-testnet-0`) continued advancing past height 47,800 using the compromised identities.

Two primary remediation pathways were proposed:
- **Option A:** Coordinate an in-place validator rotation on `sovra-testnet-0` at height 50,000+.
- **Option B:** Stand up a clean recovery network (`sovra-recovery-1`) starting with 100% replacement validator keys from genesis, while preserving `sovra-testnet-0` as an immutable historical archive.

---

## 2. Comparative Analysis Matrix

| Evaluation Dimension | Option A: In-Place Rotation (`sovra-testnet-0`) | Option B: Clean Recovery Chain (`sovra-recovery-1`) | Architectural Advantage |
|---|---|---|---|
| **Cryptographic Root of Trust** | Compromised: Blocks 0 to 50,000+ signed by leaked keys; light clients must trust leaked keys to sync. | Pure: 100% replacement keys from block 0; zero leaked keys in commit certificates. | **Option B** (Absolute Cryptographic Hygiene) |
| **Historical Ledger Preservation** | High Risk: In-place upgrades risk accidental state mutation, AppHash desync, or retroactive history rewrites. | Complete: `sovra-testnet-0` remains running untouched; zero historical state modified. | **Option B** (Adheres to Rule 1) |
| **Light Client & Fast Sync Security** | Vulnerable: Anyone possessing the historical leaked keys could forge alternative forks for blocks 0–50,000. | Impervious: Leaked keys have zero voting power across the entire chain history. | **Option B** (Zero Attack Surface) |
| **Operational Complexity** | High: Requires atomic multi-node restart at exact block height under live block production. | Controlled: Deterministic genesis instantiation, verified P2P mesh, and isolated verification. | **Option B** (Deterministic Reproducibility) |
| **Audit Transparency** | Complex: Requires justifying why leaked keys were permitted to sign 50,000 blocks. | Clean: Clear separation between legacy prototype network and certified recovery network. | **Option B** (Clear Audit Trail) |

---

## 3. Formal Architectural Decision: OPTION B (Canonical Recovery Network)

The Independent Release Verification Authority has formally selected **Option B** as the primary recovery and authorization pathway for SOVRA, while retaining `sovra-testnet-0` in parallel.

### Key Justifications:

1. **Light Client Security Invariant:**  
   In a Proof-of-Authority or BFT consensus protocol, light clients and state-syncing peers verify headers by checking commit certificates against known validator public keys. If blocks 0–50,000 depend on compromised keys, any adversary with access to Git reflogs could forge arbitrary state transitions for the first 50,000 blocks. Option B eliminates this vulnerability entirely.

2. **Compliance with Non-Negotiable Safety Rules:**  
   Rule 1 strictly forbids erasing historical state or replacing genesis on an existing network to "make tests pass". By maintaining `sovra-testnet-0` on ports 26657–26687 and deploying `sovra-recovery-1` on ports 26757–26787, both networks operate transparently without history suppression or retroactive claims.

3. **Production-Grade Standard:**  
   Industry standard practice in major L1 ecosystems (e.g., Cosmos, Ethereum, Solana) following a catastrophic root-key compromise at genesis is to launch a secure replacement chain ID (`sovra-recovery-1`) with fresh cryptographically secure credentials.

---

## 4. Operational Topology & Network Coexistence

Both networks run concurrently without resource conflict:

```
[Local Host 127.0.0.1]
├── Canonical Legacy Network (sovra-testnet-0)
│   ├── Node 0: RPC 26657, P2P 26656 (PID 12240)
│   ├── Node 1: RPC 26667, P2P 26666 (PID 10176)
│   ├── Node 2: RPC 26677, P2P 26676 (PID 5492)
│   └── Node 3: RPC 26687, P2P 26686 (PID 13196)
│   └── Role: Immutable Historical Ledger Archive (Preserved)
│
└── Certified Recovery Network (sovra-recovery-1)
    ├── Node 0: RPC 26757, P2P 26756 (PID 17436 / Background Task)
    ├── Node 1: RPC 26767, P2P 26766 (PID 3296 / Background Task)
    ├── Node 2: RPC 26777, P2P 26776 (PID 20176 / Background Task)
    └── Node 3: RPC 26787, P2P 26786 (PID 248 / Background Task)
    └── Role: Official Recovery Network Candidate for Testnet Authorization
```
