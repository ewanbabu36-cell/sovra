# SOVRA — SINGLE POINT OF FAILURE (SPOF) REGISTER & REMEDIATION MATRIX

> **Standard:** Zero-Single-Point-of-Failure Architectural Audit  
> **Status:** Phase 0 Architecture Deliverable  
> **Repository Commit:** `6306538` | **Date:** 2026-11-05  

---

## 1. Zero-SPOF Audit Methodology

In a true decentralized architecture, no individual server, cloud provider, domain name, database disk, or human administrator can unilaterally halt operations, alter financial balances, or permanently destroy network data.

Every subsystem is evaluated against this standard:
$$\text{Single Point of Failure Threshold: Does the failure of this component collapse the network?}$$

---

## 2. Master Single Point of Failure Register

| SPOF ID | Subsystem Component | Current Single Point of Failure Description | Impact if Component Fails | Current Resilience Level | Target Zero-SPOF Remediation Architecture | Verification Reference |
|:---:|:---|:---|:---|:---:|:---|:---|
| **SPOF-01** | **Custodial Validator Key in Dev Gateway** | `scripts/dev-server.ts#L89410` loads validator disk key to sign L1 transactions for web API callers. | Key theft compromises validator; gateway crash halts user transactions. | **CRITICAL RISK** | Mandatory Client-Side DID Signing (`packages/crypto/src/wallet.ts`). User device signs transaction; gateway only relays serialized `TxRaw` to RPC. | [`chain/x/auth/`](file:///d:/Sovra/chain/x/auth) |
| **SPOF-02** | **Primary Web Domain (`sovra.network`)** | Hardcoded domain in CORS, Coturn, and mobile configs. | Registrar seizure or DNS freeze disconnects web/mobile users. | **HIGH RISK** | Multi-Domain Anycast (`sovra.network`, `sovra.io`, `sovra.app`) + Cryptographically Signed Service Discovery Manifest over P2P DHT. | [`docs/SOVRA_DOMAIN_DNS_RESILIENCE.md`](file:///d:/Sovra/docs/SOVRA_DOMAIN_DNS_RESILIENCE.md) |
| **SPOF-03** | **Single SQLite Disk Lock Contention** | `docker-compose.prod.yml` mounts single SQLite volume across multiple potential container replicas. | Multiple write processes cause `SQLITE_BUSY` crash or database lockup. | **HIGH RISK** | Single-Writer Gateway Architecture: only one primary process writes to SQLite; satellite workers use internal IPC or read-only replicas. | [`scripts/database-sqlite.ts`](file:///d:/Sovra/scripts/database-sqlite.ts) |
| **SPOF-04** | **Single Cloud VPS Hosting Instance** | Primary gateway running on a single Hetzner or bare-metal VPS host. | Datacenter fire, network partition, or billing suspension drops API. | **MEDIUM RISK** | Multi-Provider Active-Standby VPS cluster (Hetzner + OVHcloud) with automated Litestream WAL promotion ($< 45\text{s}$ failover). | [`docs/SOVRA_MULTI_PROVIDER_DEPLOYMENT_PLAN.md`](file:///d:/Sovra/docs/SOVRA_MULTI_PROVIDER_DEPLOYMENT_PLAN.md) |
| **SPOF-05** | **Third-Party Google STUN Dependency** | `.env.example#L35` defaults to `stun.l.google.com:19302`. | Google blocking or rate-limiting fails WebRTC NAT hole punching. | **HIGH RISK** | Decentralized Coturn relay pool across community nodes with dynamic DHT / manifest discovery. | [`docker/turnserver.conf`](file:///d:/Sovra/docker/turnserver.conf) |
| **SPOF-06** | **Single Local Validator Set** | `chain/mytestnet/` contains 3 validators running on local developer loopback ports. | Local machine shutdown halts testnet block production. | **MEDIUM RISK** | Deploy public testnet federation across at least 4 independent physical hosts in distinct geographic regions. | [`chain/seeds.txt`](file:///d:/Sovra/chain/seeds.txt) |
| **SPOF-07** | **Single Administrator Kill Switch** | Insecure deployments with a single `ADMIN_SECRET_KEY` holding god-mode access. | Compromised admin key allows unauthorized system configuration changes. | **HIGH RISK** | Multi-Party Cryptographic Authorization (3-of-5 Multisig for admin actions) + Hardware Passkeys + Tamper-Evident Audit Logging. | [`scripts/admin-security.ts`](file:///d:/Sovra/scripts/admin-security.ts) |
| **SPOF-08** | **Unpinned BitSwap Media Block Eviction** | Media blocks stored on single node without automated pinning quorum. | Seeder node offline causes HTTP 404 on video/photo requests. | **HIGH RISK** | Continuous Pinning Manager (`nodes/storage-node/src/pinning.ts`) enforcing $k \ge 3$ replica quorum across distinct ASNs. | [`nodes/storage-node/src/pinning.ts`](file:///d:/Sovra/nodes/storage-node/src/pinning.ts) |

---

## 3. The "No Single Administrator Shutdown" Protocol

In accordance with Section 7 of the Mandate, SOVRA eliminates unilateral administrative kill switches:
1. **No Master Ledger Override:** The Go blockchain state machine rejects arbitrary balance changes; coin transfers require valid Ed25519 signatures from the source account.
2. **Multi-Admin Consensus for Sensitive Operations:** Critical operations (validator set updates, treasury disbursements, contract upgrades) require an $M\text{-of-}N$ multisig threshold recorded on-chain.
3. **Immutable Audit Trailing:** All administrative sessions generate an HMAC-SHA256 sealed audit record stored in SQLite table `audit_logs` and replicated to external backup targets.
