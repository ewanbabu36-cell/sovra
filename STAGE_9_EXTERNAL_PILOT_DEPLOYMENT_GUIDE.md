# Stage 9 — Phase 6 External Pilot Deployment Guide (`ORG-A`, `ORG-B`, `ORG-C`)

**Program:** SOVRA Stage 9 — Certification Blocker Closure Program  
**Baseline Preserved:** Stage 8 verdict remains **`NOT TESTED — External Field Certification`** ([STAGE_8_EXTERNAL_ORGANIZATION_REPORT.md](file:///d:/Sovra/STAGE_8_EXTERNAL_ORGANIZATION_REPORT.md)).  
**Canonical Field Test Plan:** [RECOVERY/EXTERNAL_MULTI_ORG_CERTIFICATION.md](file:///d:/Sovra/RECOVERY/EXTERNAL_MULTI_ORG_CERTIFICATION.md)

This guide defines exact, operator-reproducible provisioning instructions for three **genuinely independent** organizations (**ORG-A**, **ORG-B**, **ORG-C**) operating across distinct public Autonomous Systems (ASNs), plus carrier CGNAT client nodes and permanent founder infrastructure shutdown verification.

---

## 1. Strict Organization Independence Prerequisites

* **Separate Operators & Keys:** `ORG-A`, `ORG-B`, and `ORG-C` MUST be administered by separate individuals/teams with separate machines, separate OS accounts, and independently generated Ed25519 keypairs (`seed-node-keys.json` created locally on first start; never copied across orgs).
* **Distinct Public ASNs:** Each organization node MUST reside in a different public BGP AS Number and different geographic region (example: AS-A Tokyo / AWS-independent VPS, AS-B Frankfurt / Hetzner-OVH bare-metal, AS-C Toronto / residential-ISP or regional ISP). Do NOT run `ORG-A/B/C` on one host, VPC, or ASN.
* **Domainless Baseline (`SOVRA_NO_DNS=true`):** Do **NOT** require A/AAAA records or `*.sovra.network` DNS; exchange only raw `/ip4/.../tcp/.../p2p/<PeerID>` or `/ip6/.../tcp/.../p2p/<PeerID>` multiaddrs (and `sovra://peer-pex/v1?...` signed QR URIs).
* **Runtime Requirements per Host:** Node.js `v24.x` LTS (or workspace built `packages/*/dist` after `pnpm install --frozen-lockfile && pnpm -r build`), Git commit recorded via `git rev-parse HEAD`.

---

## 2. Firewall & Port Matrix

Based on [scripts/bootstrap-node.ts:211-563](file:///d:/Sovra/scripts/bootstrap-node.ts#L211-L563) and [scripts/volunteer-node.ts:33-109](file:///d:/Sovra/scripts/volunteer-node.ts#L33-L109):

| Port / Protocol | Direction | Purpose | Firewall Rule |
|---|---|---|---|
| **TCP `4001`** *(or custom `SOVRA_P2P_PORT`)* | Inbound + Outbound | P2P `tcp+noise_xx+yamux`, `/sovra/pex/1.0.0`, Kademlia DHT, GossipSub, Circuit Relay v2 (`/hop`, `/stop`), BitSwap | **Allow public TCP `4001`** on all Org hosts |
| **TCP `8080`** *(or custom `SOVRA_HTTP_PORT`)* | Inbound (Operator/LAN or Public HTTPS proxy) | Seed discovery & telemetry endpoints: `/health`, `/api/status`, `/api/peers`, `/api/peers/announce`, `/api/seeds`, `/metrics` | Restrict `/metrics` or bind telemetry safely per org policy; expose `/health` + `/api/peers` for pilot verification |
| **UDP `5353`** (`224.0.0.251`) | LAN Multicast *(Optional)* | IPv4 mDNS signed beacons (`sovra-mdns-v1`) when `--mdns` / `SOVRA_ENABLE_MDNS=true` is enabled | Local LAN subnet only (not required over WAN) |
| **UDP Ephemeral (`1024–65535`)** | Outbound + Reply | RFC 5389 UDP STUN reflexive IPv4/IPv6 probing (`probeStunUdp`) & WebRTC ICE/TURN candidate checks | Allow outbound UDP & stateful reply (`3478`/`19302` STUN) |
| **QUIC UDP (`4001`/udp)** | **NOT ENABLED** | Unimplemented in Node `v24` ([STAGE_9_QUIC_ENGINEERING_RFC.md](file:///d:/Sovra/STAGE_9_QUIC_ENGINEERING_RFC.md)) | Do **not** configure QUIC targets until RFC SOVRA-QUIC-001 ships |

---

## 3. Exact Node Launch Commands (`ORG-A`, `ORG-B`, `ORG-C`)

### Step 0 (Optional Pre-Coupled Founder Anchor for Shutdown Drill)
If executing **Phase D (Founder Disappearance Drill)**, temporarily start a separate Founder seed host (`FOUNDER_IP`, PeerID `FOUNDER_PEER_ID`) solely to populate initial PEX, then permanently `kill -9` it in Section 5. Otherwise start directly with `ORG-A` bootstrapping peer-to-peer.

### ORG-A — Independent Full + Relay + Storage Anchor (ASN-A)
```bash
git rev-parse HEAD
mkdir -p /var/lib/sovra-org-a
SOVRA_NO_DNS=true \
SOVRA_PUBLIC_IP=<ORG_A_PUBLIC_IP> \
SOVRA_P2P_HOST=0.0.0.0 \
SOVRA_P2P_PORT=4001 \
SOVRA_HTTP_PORT=8080 \
SOVRA_QUOTA_MB=10240 \
node --experimental-strip-types scripts/volunteer-node.ts \
  --role full \
  --data-dir /var/lib/sovra-org-a \
  --p2p-port 4001 \
  --http-port 8080 \
  --public-ip <ORG_A_PUBLIC_IP> \
  --quota-mb 10240
```
Record printed `PeerID`, `Sovereign DID`, `P2P Multiaddr` (`/ip4/<ORG_A_PUBLIC_IP>/tcp/4001/p2p/<ORG_A_PEER_ID>`), and `Circuit Relay` multiaddr (`.../p2p-circuit`).

### ORG-B — Independent Relay & Storage Replica Node (ASN-B)
Bootstraps directly from `ORG-A` raw IP multiaddr (zero DNS):
```bash
mkdir -p /var/lib/sovra-org-b
SOVRA_NO_DNS=true \
SOVRA_PUBLIC_IP=<ORG_B_PUBLIC_IP> \
SOVRA_P2P_HOST=0.0.0.0 \
SOVRA_P2P_PORT=4001 \
SOVRA_HTTP_PORT=8080 \
SOVRA_QUOTA_MB=10240 \
SOVRA_BOOTSTRAP_PEERS="/ip4/<ORG_A_PUBLIC_IP>/tcp/4001/p2p/<ORG_A_PEER_ID>" \
node --experimental-strip-types scripts/volunteer-node.ts \
  --role full \
  --data-dir /var/lib/sovra-org-b \
  --p2p-port 4001 \
  --http-port 8080 \
  --public-ip <ORG_B_PUBLIC_IP> \
  --peers "/ip4/<ORG_A_PUBLIC_IP>/tcp/4001/p2p/<ORG_A_PEER_ID>" \
  --quota-mb 10240
```

### ORG-C — Independent Volunteer Verifier Node (ASN-C)
Bootstraps from `ORG-B` raw IP multiaddr and learns `ORG-A` autonomously via `/sovra/pex/1.0.0`:
```bash
mkdir -p /var/lib/sovra-org-c
SOVRA_NO_DNS=true \
SOVRA_PUBLIC_IP=<ORG_C_PUBLIC_IP> \
SOVRA_P2P_HOST=0.0.0.0 \
SOVRA_P2P_PORT=4001 \
SOVRA_HTTP_PORT=8080 \
SOVRA_BOOTSTRAP_PEERS="/ip4/<ORG_B_PUBLIC_IP>/tcp/4001/p2p/<ORG_B_PEER_ID>" \
node --experimental-strip-types scripts/volunteer-node.ts \
  --role full \
  --data-dir /var/lib/sovra-org-c \
  --p2p-port 4001 \
  --http-port 8080 \
  --public-ip <ORG_C_PUBLIC_IP> \
  --peers "/ip4/<ORG_B_PUBLIC_IP>/tcp/4001/p2p/<ORG_B_PEER_ID>"
```

*(Dual-stack IPv6 validation: On hosts with native WAN IPv6, verify `[::]` / `SOVRA_P2P_HOST` IPv6 reachability with `/ip6/<ORG_IP6>/tcp/4001/p2p/<PEER_ID>` via `scripts/external-certification-check.ts`.)*

---

## 4. Health, Metrics, ASN & Peer Verification Commands

Execute on each org host and archive verbatim outputs:

1. **Identity & ASN Capture (Must prove 3 distinct ASNs):**
   ```bash
   curl -sS https://ipinfo.io/json   # Or whois <PUBLIC_IP> | grep -iE 'origin|asn|netname|org'
   ```
2. **Daemon `/health` & `/metrics` Checks ([bootstrap-node.ts:387-555](file:///d:/Sovra/scripts/bootstrap-node.ts#L387-L555)):**
   ```bash
   curl -sS http://127.0.0.1:8080/health
   curl -sS http://127.0.0.1:8080/api/peers
   curl -sS http://127.0.0.1:8080/metrics
   ```
   Verify `zeroDomainMode: true`, `connectedPeersCount >= 2`, `peerBookCount >= 2`, `sovra_seed_up 1`, and inspect persisted `/var/lib/sovra-org-*/peers.json` (verifying zero `*.sovra.network` `/dns` entries).
3. **Cross-Org Dial, PEX & Fail-Closed QUIC Probe (`ORG-C` -> `ORG-A` & `ORG-B`):**
   ```bash
   SOVRA_NO_DNS=true node --experimental-strip-types scripts/external-certification-check.ts \
     --peers "/ip4/<ORG_A_PUBLIC_IP>/tcp/4001/p2p/<ORG_A_PEER_ID>,/ip4/<ORG_B_PUBLIC_IP>/tcp/4001/p2p/<ORG_B_PEER_ID>" \
     | tee org-c-external-cert.json
   ```
   Confirm `ok: true`, `zeroDomainEnforced: true`, `quicRejectedFailClosed: true`, `dialOk: true`, `pexCount >= 1`, `signedRecordValid: true`, and WAN `rttMs > 1`.

---

## 5. Founder Shutdown, CGNAT Relay Failover & Evidence Bundle Checklist

1. **Founder Kill-Switch + DNS Sinkhole Drill:**
   * If a founder node was attached initially, `kill -9` founder process, wipe founder `/var/lib/sovra-founder`, and sinkhole `0.0.0.0 seed1.sovra.network seed2.sovra.network seed-us-east.sovra.network seed-eu-central.sovra.network seed-ap-east.sovra.network` in `/etc/hosts`.
   * Restart `ORG-B` with **empty** `SOVRA_BOOTSTRAP_PEERS=""` / no `--peers` flag; verify `ORG-B` recovers `ORG-A` and `ORG-C` solely from `/var/lib/sovra-org-b/peers.json`.
   * Boot a fresh `ORG-D` joiner referencing only `ORG-B`'s QR URI (`qrUri` from `/api/peers`) and verify PEX discovery of `ORG-A` and `ORG-C`.
2. **Real Cellular CGNAT Test (`100.64.0.0/10`):**
   * Connect client on physical carrier LTE/5G SIM (`ip addr` showing carrier NAT), record STUN reflexive port mapping (`probeStunUdp`), verify direct inbound dial to mobile fails, dial via `ORG-A` `/p2p-circuit`, then stop `ORG-A` relay mid-stream and measure failover latency to `ORG-B` `/p2p-circuit`.
3. **Mandatory Stage 8 Evidence Package per Org:**
   * Host ASN/ISP/Region proof (`whois` + traceroute between orgs).
   * `git rev-parse HEAD` & SHA-256 of running script sources.
   * Raw outputs from `/health`, `/api/peers`, `/metrics`, `peers.json`, `external-certification-check.ts`, and CGNAT relay failover timings.
   * **Note:** Mobile hardware & live FCM/APNs certification remain separate from org WAN pilot until Stage 9 mobile packaging/keystore and push blockers ([STAGE_9_MOBILE_RELEASE_READINESS.md](file:///d:/Sovra/STAGE_9_MOBILE_RELEASE_READINESS.md), [STAGE_9_LIVE_PUSH_READINESS.md](file:///d:/Sovra/STAGE_9_LIVE_PUSH_READINESS.md)) are closed.
