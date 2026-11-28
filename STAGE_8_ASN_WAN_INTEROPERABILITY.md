# Stage 8 — ASN & Public WAN Interoperability Report

**Phase:** Stage 8 — Independent External Field Certification  
**Timestamp:** `2026-11-26T12:58:04+05:30` (`2026-11-26T07:28:04.122Z`)  
**Overall Section Status:** **`PARTIAL`** *(Single-host local dual-stack socket interop = `PASS` locally; single-vantage public UDP STUN IPv4 + global IPv6 reachability observed; cross-ASN public peer-to-peer `tcp+noise_xx+yamux` / `ws` WAN interop = **`NOT TESTED`**)*

---

## 1. Empirical Single-Vantage Network Observations (`D:\Sovra`)

- **Network Interfaces Probe (`node -e os.networkInterfaces()` at `2026-11-26T12:49:50+05:30`):**
  - `Wi-Fi` IPv4: `10.155.170.224/24` (RFC 1918 local NAT interface)
  - `Wi-Fi` IPv6: `2401:4900:d27c:19cc:b486:6509:1762:50b5/128` & `.../64` (Public global unicast IPv6 + link-local `fe80::135e:e6fe:7808:548d`)
- **Live Outbound RFC 5389 UDP STUN Probe (`scratch/stun-probe.mjs` at `2026-11-26T07:28:04.122Z`, single socket):**
  - **IPv4 (`udp4`, local port `54356`):**
    - `stun.l.google.com:19302` -> reflexive `223.238.130.171:6562`
    - `stun1.l.google.com:19302` -> reflexive `223.238.130.171:6562`
    - `stun.cloudflare.com:3478` -> reflexive `223.238.130.171:6562`
  - **IPv6 (`udp6`, local port `58167`):**
    - `stun.l.google.com:19302` -> reflexive `2401:4900:d27c:19cc:b486:6509:1762:50b5:58167`
    - `stun.cloudflare.com:3478` -> reflexive `2401:4900:d27c:19cc:b486:6509:1762:50b5:58167`

---

## 2. Finding Matrix

| Finding ID | Detailed Verification Record |
|---|---|
| **S8-WAN-01** | **Requirement ID:** `S8-WAN-01` — Outbound IPv4 + IPv6 dual-stack public internet transport reachability<br>**Test methodology:** Real read-only UDP RFC 5389 Binding Request from single bound sockets (`udp4`/`udp6`) to `stun.l.google.com:19302`, `stun1.l.google.com:19302`, `stun.cloudflare.com:3478` via `stun-probe.mjs`<br>**Environment:** Windows Wi-Fi uplink (`10.155.170.224` IPv4; `2401:4900:d27c:19cc:b486:6509:1762:50b5` IPv6)<br>**Actual execution evidence:** All 3 IPv4 queries returned consistent `223.238.130.171:6562`; both IPv6 queries returned direct un-NATted `2401:4900:d27c:19cc:b486:6509:1762:50b5:58167` (Exit `0`)<br>**Result:** **`PARTIAL`** *(Single-host outbound STUN works over IPv4+IPv6; no peer Sovra nodes across external ASNs tested)*<br>**Evidence location:** `scratch/stun-probe.mjs` output in Stage 8 log<br>**Remaining limitations:** Does NOT verify bidirectional TCP/WebSocket connections across separate public ASNs. |
| **S8-WAN-02** | **Requirement ID:** `S8-WAN-02` — Local IPv4 + IPv6 (`/ip6/::1`) + WebSocket `/ws` + `Circuit Relay v2` Sovra protocol interop<br>**Test methodology:** Vitest integration suites [transport-interop.test.ts](file:///d:/Sovra/packages/p2p/test/transport-interop.test.ts) (`4` tests, `507ms`) and [ia01-networking-and-storage.test.ts](file:///d:/Sovra/tests/integration/ia01-networking-and-storage.test.ts) (`2` tests, `1213ms`)<br>**Environment:** Single Windows host (`127.0.0.1` / `::1` loopback OS TCP & WS sockets)<br>**Actual execution evidence:** `task-55780` (`stage8-section7-verify.log` lines 9–11): `PASS`<br>**Result:** **`PASS`** *(Strictly scoped as localhost OS socket interoperability; explicitly excluded as WAN evidence)*<br>**Evidence location:** [stage8-section7-verify.log](file:///C:/Users/alamr/.gemini/antigravity/brain/d329ae1a-a8d0-40b2-b024-24d29195a2f5/scratch/stage8-section7-verify.log)<br>**Remaining limitations:** Loopback latency (`< 5ms`) and kernel routing do not reflect cross-ASN WAN hops or ISP middleboxes. |
| **S8-WAN-03** | **Requirement ID:** `S8-WAN-03` — Multi-ASN (`>= 3` external ASNs) live TCP/`Noise_XX`/WS/IPv6 cross-provider peer dial & PEX convergence<br>**Test methodology:** Planned execution of `SOVRA_NO_DNS=true node --experimental-strip-types scripts/external-certification-check.ts --peers <ORG-A,ORG-B,ORG-C>`<br>**Environment:** External public servers unavailable (`SOVRA_EXTERNAL_PEERS=UNSET`)<br>**Actual execution evidence:** CLI ready check returned `"READY_FOR_EXTERNAL_EXECUTION"` (Exit `0`); 0 external ASN multiaddrs supplied<br>**Result:** **`NOT TESTED`**<br>**Evidence location:** [external-certification-check.ts](file:///d:/Sovra/scripts/external-certification-check.ts)<br>**Remaining limitations:** External operators across separate ASNs required. |
