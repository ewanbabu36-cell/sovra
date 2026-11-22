# SOVRA PHASE 15 — OPERATIONAL SECURITY & REMOTE TESTNET HARDENING REPORT

**Author:** Principal Distributed Systems Security Engineer, Network Architect, Release Certification Authority  
**Repository:** `D:\Sovra`  
**Target:** Production Remote Testnet Security Hardening  
**Date:** November 22, 2026  
**Status:** COMPLETE & VERIFIED  
**Evidence Artifact:** [`phase15-operational-security-evidence.json`](file:///D:/Sovra/phase15-operational-security-evidence.json)

---

## EXECUTIVE SUMMARY

In Phase 15 Workstream 6, we conducted an operational security audit and established firewall, transport encryption, DDoS mitigation, and telemetry baselines for remote testnet deployment.

A secure remote testnet requires strict segregation of public and private surfaces:
1. **P2P Gossip Surface:** Must be exposed to authenticated peers via authenticated AEAD transport.
2. **RPC / Management Surface:** Must never be exposed directly to public internet without rate limiting, authentication, and reverse-proxy termination.
3. **PrivValidator Signer Surface:** Must remain isolated in secure enclaves or private VPCs with zero public routability.
4. **Health & Telemetry Surface:** Probes (`/health`, `/health/consensus`, `/status`) provide real-time visibility into validator lag and cluster health.

---

## 1. NETWORK EXPOSURE & FIREWALL SEGREGATION

The network exposure policy for SOVRA remote testnet nodes is defined as follows:

```
+---------------------------------------------------------------------------------+
|                                 NETWORK PERIMETER                               |
|                                                                                 |
|   PORT RANGE             PROTOCOL       ACCESS SCOPE           SECURITY POLICY  |
|   ------------------     --------       ------------           ---------------  |
|   26656, 26666, ...      TCP (P2P)      Public Internet        AEAD Encrypted   |
|   26657, 26667, ...      HTTP (RPC)     Localhost / Private    Reverse Proxy    |
|   26659                  TCP (Signer)   Isolated Enclave       mTLS / No WAN    |
|   3000 / 3001            HTTP (API)     Public (via NGINX)     OWASP + Rate Lmt |
|                                                                                 |
+---------------------------------------------------------------------------------+
```

### Port-by-Port Exposure Audit:
- **P2P Listeners (`0.0.0.0:26656-26686`):** Open to peer connections. All framing is encrypted using ChaCha20-Poly1305 / AES-256-GCM authenticated handshakes.
- **Validator RPC Listeners (`127.0.0.1:26657-26687`):** Bound to `127.0.0.1` or internal VPC subnet. Direct external access blocked. Public traffic routes through `DecoupledApiServer` with rate limiting.
- **PrivValidator Socket (`127.0.0.1:26659`):** Bound strictly to localhost or private cloud interconnect. Zero WAN exposure.

---

## 2. RPC RATE LIMITING & DDOS MITIGATION

The `DecoupledApiServer` (`services/api/src/server.ts`) integrates sliding-window rate limiting:
- **Mechanism:** Sliding-window counter per IP address (`RateLimiter` middleware).
- **Default Threshold:** 100 requests per minute per IP.
- **Response:** HTTP `429 Too Many Requests` with `Retry-After: 60` and JSON error body.
- **Verification Result:** Verified in `scripts/phase15-financial-and-ops-audit.ts` where rapid bursts returned `429` as expected (`rateLimitTrippedHttpCode: 429`).

---

## 3. TRANSPORT ENCRYPTION & MUTUAL AUTHENTICATION

1. **P2P Transport Security:** Nodes negotiate session keys using ephemeral X25519 key exchange authenticated with validator node identities. Wire traffic is AEAD encrypted.
2. **PrivValidator Signer Transport:** The signer socket connects over loopback TCP or Unix Domain Socket. In multi-host setups, mTLS with mutual client certificate validation is required.
3. **Cluster Internal Authentication:** Cross-replica API communication uses HMAC-SHA256 signatures with high-entropy cluster secrets and replay prevention (`X-Sovra-Timestamp` + `X-Sovra-Nonce` TTL cache).

---

## 4. TELEMETRY, HEALTH PROBES & ALERTING

The operational monitoring stack provides complete observability:
- **L1 Validator Status (`/status`):** Real-time JSON telemetry reporting `height`, `app_hash`, `node_id`, `total_supply`, `lifetime_mint`, `lifetime_burn`.
- **API Liveness Probe (`/health/liveness`):** Reports `{ alive: true, pid }` for container orchestrator health checks.
- **API Readiness Probe (`/health/readiness`):** Queries validator RPC failover pool; returns 200 only if at least one CometBFT validator is responsive.
- **Consensus Health (`/health/consensus`):** Monitors validator lag across all 4 nodes; raises alert if lag exceeds 5 blocks or if quorum is lost.
- **Prometheus Metrics (`/health/monitoring`):** Exports standard Prometheus gauges:
  - `sovra_consensus_healthy`: 1 when consensus active and lag within threshold; 0 otherwise.
  - `sovra_block_height`: Current chain tip height.
  - `sovra_connected_peers`: Number of active P2P peer connections.

---

## 5. CONCLUSION & GATE STATUS

The operational security controls and network segmentation requirements for remote testnet deployment are fully verified.

- **RPC Rate Limiting:** ENFORCED (PASSED)
- **Firewall & Network Segregation:** VERIFIED (PASSED)
- **TLS / AEAD Transport Security:** VERIFIED (PASSED)
- **Health Probes & Telemetry:** ACTIVE & HEALTHY (PASSED)
- **Evidence File:** [`phase15-operational-security-evidence.json`](file:///D:/Sovra/phase15-operational-security-evidence.json)

**Gate Status: VERIFIED & PASSED**
