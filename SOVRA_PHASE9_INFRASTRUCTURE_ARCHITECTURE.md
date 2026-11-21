# SOVRA Phase 9 — Production Decoupled Infrastructure Architecture Specification

**Document Reference:** `SOVRA-PH9-ARCH-001`  
**Classification:** Canonical Engineering Architecture Document  
**Target Git Commit:** `c1fa966` (Phase 9 Baseline)  
**Security & Systems Authority:** Principal Distributed Systems Architect & DevSecOps Lead  
**Date:** November 21, 2026  
**Status:** **RATIFIED FOR PRODUCTION DEPLOYMENT**

---

## 1. Architectural Mission & Core Objectives

The primary mission of Phase 9 is to decouple the monolithic dev-server architecture into an enterprise-grade, horizontally scalable, multi-cloud Byzantine Fault Tolerant topology, directly resolving `GAP-P1-02` (Application Layer Decoupling) and laying the complete infrastructure-as-code foundation for `GAP-P1-01` (Multi-Cloud Physical Federation).

### Architectural Invariants:
1. **Consensus Isolation:** Core validator nodes hold private validator signing keys (`priv_validator_key.json`) and operate on isolated subnets with **zero public internet ingress**. They communicate strictly with public Sentries over WireGuard.
2. **API Statelessness & Horizontal Scalability:** The Node.js API gateway is decoupled from validator daemons, enabling independent autoscaling across $K$ instances behind round-robin/least-connection reverse proxies.
3. **Multi-Validator RPC Redundancy:** API pods are equipped with dynamic failover drivers connecting to a pool of CometBFT RPC endpoints, eliminating dependency on any single local node process.
4. **Service-to-Service Zero-Trust:** Inter-service cluster communication (internal nodes, background transcoders, moderation workers) is authenticated via `X-Sovra-Internal-Auth` HMAC-SHA256 signatures with 5-minute replay windows.

---

## 2. End-to-End Production Topology Diagram

```mermaid
flowchart TD
    subgraph Tier_0_Edge ["Tier 0: Edge Ingress & DDoS Protection"]
        Clients[Web Browsers / Android Clients] --> DNS[Geo-DNS Anycast]
        DNS --> CF[Edge Reverse Proxy & WAF]
    end

    subgraph Tier_1_Ingress ["Tier 1: Load Balancing & Rate Limiting"]
        CF --> NGINX_LB[NGINX Load Balancer<br>Rate Limit: 30r/s | SSL Termination]
    end

    subgraph Tier_2_API ["Tier 2: Horizontally Scaled Decoupled API Tier"]
        NGINX_LB -->|Least Connections| API_1[API Pod 1 :3001<br>Health Probes | Graceful Draining]
        NGINX_LB -->|Least Connections| API_2[API Pod 2 :3002<br>Health Probes | Graceful Draining]
        NGINX_LB -->|Least Connections| API_N[API Pod N :300N<br>Health Probes | Graceful Draining]
    end

    subgraph Tier_3_Workers ["Tier 3: Asynchronous Background Workers"]
        WORKER_MOD[Moderation Worker<br>Community Jury Processor]
        WORKER_TRANS[Video Transcoder<br>HLS / Dash Pipeline]
        DB_WAL[(Shared Relational DB<br>SQLite WAL / HA PostgreSQL)]
        API_1 & API_2 & API_N --> DB_WAL
        WORKER_MOD & WORKER_TRANS --> DB_WAL
    end

    subgraph Tier_4_Mesh ["Tier 4: Encrypted WireGuard Overlay Mesh (10.42.0.0/24)"]
        API_1 & API_2 & API_N -.->|Dynamic Failover RPC| WG_NET((WireGuard Mesh<br>ChaCha20-Poly1305))
    end

    subgraph Tier_5_Validators ["Tier 5: 4-Node Multi-Cloud Consensus Federation"]
        subgraph AWS_Cluster ["Node 0: AWS eu-central-1"]
            Sentry0[AWS Sentry :26656 / :26657] <--> Val0[Core Val 0 :26656<br>Private Subnet]
        end
        subgraph GCP_Cluster ["Node 1: GCP us-east4"]
            Sentry1[GCP Sentry :26656 / :26657] <--> Val1[Core Val 1 :26656<br>Private Subnet]
        end
        subgraph Azure_Cluster ["Node 2: Azure eastus2"]
            Sentry2[Azure Sentry :26656 / :26657] <--> Val2[Core Val 2 :26656<br>Private Subnet]
        end
        subgraph Hetzner_Cluster ["Node 3: Hetzner fsn1"]
            Sentry3[Hetzner Sentry :26656 / :26657] <--> Val3[Core Val 3 :26656<br>Private Subnet]
        end

        WG_NET <--> Sentry0 & Sentry1 & Sentry2 & Sentry3
        Sentry0 <==P2P Gossip==> Sentry1 & Sentry2 & Sentry3
    end
```

---

## 3. Tier-by-Tier Specification & Component Responsibilities

### Tier 1: Ingress Load Balancer (`docker/nginx.conf`)
- **Software:** NGINX 1.27 Alpine.
- **Port Bindings:** `80` (HTTP redirect), `443` (TLS termination).
- **Load Balancing Algorithm:** `least_conn` with active passive failure detection (`max_fails=3 fail_timeout=10s`).
- **Rate Limiting:** `limit_req_zone $binary_remote_addr zone=api_rate_limit:10m rate=30r/s;` with burst buffer of 60.
- **WebSocket Gateway:** Native `Upgrade` and `Connection` header proxying with 3600-second idle keepalive.
- **Security Headers:** HSTS (2 years), CSP strict framing, X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin.

### Tier 2: Decoupled API Server (`services/api/src/server.ts`)
- **Runtime:** Node.js 22 LTS on Debian Bookworm Slim (`docker/Dockerfile.api`).
- **Process Isolation:** Runs as non-root unprivileged user `sovra:sovra` (UID 10001, GID 10001).
- **Health Check Endpoints:**
  - `GET /health`: Overall microservice telemetry, active in-flight request count, uptime.
  - `GET /health/liveness`: Instant process response for Kubernetes / Docker Swarm liveness probes.
  - `GET /health/readiness`: Queries active CometBFT validator RPC to ensure L1 readiness. Returns 200 OK or 503.
  - `GET /health/consensus`: Returns active block height, chain ID, moniker, and total supply.
- **Graceful Draining:** Traps `SIGTERM` / `SIGINT`. Rejects new requests with 503 (`Retry-After: 5`), drains existing requests within a 10,000ms grace timeout, checkpoints database WAL, and terminates cleanly.

### Tier 3: Asynchronous Workers
- **Moderation Worker:** Processes Community Jury slash actions, dispute escalations, and moderation reports.
- **Transcoding Worker:** Decoupled FFmpeg pipeline converting uploaded user reels and videos into chunked UnixFS Merkle DAGs.

### Tier 4: Encrypted WireGuard Overlay Mesh (`10.42.0.0/24`)
- **Transport:** UDP port 51820.
- **Encryption:** Curve25519 key exchange, ChaCha20 authenticated encryption, Poly1305 MACs.
- **Addressing Plan:**
  - Sentry Nodes (Public DMZs): `10.42.0.101` – `10.42.0.104`
  - Core Validators (Private Subnets): `10.42.0.1` – `10.42.0.4`
- **Zero-Trust Access:** Core validators reject all incoming packets whose source IP is not their designated local Sentry node.

### Tier 5: 4-Node Multi-Cloud Consensus Federation
- **Software:** Go CometBFT Daemon (`chain/cmd/sovrad`).
- **Independent Providers:** AWS (Frankfurt), GCP (Virginia), Azure (Virginia), Hetzner (Falkenstein).
- **Quorum Mathematics:** $N=4, w=25\%$, Quorum $= 67\%$. Tolerates $f=1$ crash fault. Halts safely without fork at $f=2$.

---

## 4. Single Points of Failure (SPOF) Elimination Audit

| Subsystem Component | Pre-Phase 9 Architecture | Phase 9 Decoupled Architecture | SPOF Status |
| :--- | :--- | :--- | :--- |
| **API Entrypoint** | Single monolithic `dev-server.ts` process | Multi-container pool (`api-1`, `api-2`) behind NGINX | **ELIMINATED** |
| **Validator RPC** | Hardcoded loopback `http://127.0.0.1:26657` | Multi-validator RPC pool with automatic failover driver | **ELIMINATED** |
| **Node Termination** | Abrupt process kill causing SQLite locks | Graceful shutdown handler draining connections (10s) | **ELIMINATED** |
| **Cluster Auth** | Unauthenticated administrative endpoints | HMAC-SHA256 authenticated `X-Sovra-Internal-Auth` | **ELIMINATED** |
| **Consensus Key Exposure**| Keys present in local workspace | Core validators in private subnets with zero public IP | **ELIMINATED** |

---

## 5. Architectural Verdict

```
================================================================================
       SOVRA PHASE 9 PRODUCTION DECOUPLING ARCHITECTURE VERDICT
================================================================================
Application Layer Decoupling (GAP-P1-02):  [x] FULLY RESOLVED & CODIFIED
Multi-Validator Failover Driver:           [x] VERIFIED & TESTED
Health Check & Draining Lifecycle:         [x] VERIFIED (/health/* endpoints active)
WireGuard Multi-Cloud Topology:            [x] ARCHITECTED & PROVISIONED IN IAC
Compromised API Blast Radius:              [x] ZERO VALIDATOR PRIVATE KEY ACCESS
--------------------------------------------------------------------------------
OVERALL ARCHITECTURAL VERDICT:             APPROVED FOR PRODUCTION DEPLOYMENT
================================================================================
```
