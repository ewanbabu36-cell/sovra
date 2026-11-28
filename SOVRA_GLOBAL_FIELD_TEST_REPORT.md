# SOVRA — Global Field Testing Matrix Report (Phase 7)

**Report Date:** `2026-11-27T02:08:00+05:30`  
**Execution Timestamp:** `2026-11-26T20:37:22.146Z` (`task-57912`, `9,834 ms`) & `task-57889` (`11 / 11` integration/partition suites)  
**Overall Phase 7 Gate Status:** **`NOT TESTED`** *(External Cross-ASN Global Field)* / **`PASS`** *(Local Multi-Node Churn, Seed Shutdown, Partition Recovery, Sybil Rejection & Same-Host IPv4/IPv6 Interface Matrix)*

> [!IMPORTANT]
> **Explicit Boundary Disclosure:** All executed Phase 7 network tests ran on **one physical Windows host (`Node v24.22.0`, `go1.27.0 windows/amd64`)** across `127.0.0.1`, LAN IPv4 `10.155.170.224`, and global Wi-Fi IPv6 `2401:4900:b577:da2c:6a54:92af:3238:9fd6`. Zero independently operated external WAN nodes, zero remote ASNs, zero live Tor daemons (`127.0.0.1:9050` & `9150` closed), and zero physical Android handsets (`adb devices -l` empty) were present. External global field metrics are strictly marked **`NOT TESTED`** or **`BLOCKED`**.

---

## 1. Real Host Environment & Interface Measurements (`task-57912`)

| Probe / Interface | Measured Live Value | Status |
|---|---|---|
| **Runtime Versions** | Node `v24.22.0`, Go `go version go1.27.0 windows/amd64`, `cl.exe` absent (`false`) | Observed |
| **LAN IPv4 Interface (`Wi-Fi`)** | `10.155.170.224` (Gateway `10.155.170.243`); Noise_XX direct dial across bound `10.155.170.224` sockets = `true` | **`PASS`** *(Same host LAN IPv4)* |
| **Global IPv6 Interface (`Wi-Fi`)** | `2401:4900:b577:da2c:6a54:92af:3238:9fd6`; Noise_XX direct dial across bound global IPv6 sockets = `true` | **`PASS`** *(Same host IPv6 bind & Noise_XX)* / **`NOT TESTED`** *(Remote WAN peer)* |
| **Live Gateway UPnP / NAT-PMP / PCP Probe** | `AutoPortMapper` targeting `10.155.170.243:5351` -> `{ ok: false, reason: "PCP gateway 10.155.170.243:5351 did not return a valid MAP v2 response" }` | **`BLOCKED`** *(Gateway router lacks UPnP/NAT-PMP/PCP)* |
| **Tor SOCKS5 Daemon (`9050` / `9150`)** | `tor9050: false`, `tor9150: false` | **`BLOCKED`** *(No running Tor daemon on host)* |
| **Connected Physical Android Handsets (`adb devices -l`)** | `List of devices attached` (`0` devices) | **`BLOCKED`** *(No physical device attached)* |

---

## 2. Executed Local Multi-Node Churn, Seed Shutdown, Partition & Sybil Drill (`task-57912`)

Using [volunteer-node.ts](file:///d:/Sovra/scripts/volunteer-node.ts) and [node.ts](file:///d:/Sovra/packages/p2p/src/node.ts) with `strictTransport: true` and `enableDnsFallback: false`:

- **Deployed Nodes:**
  - `N1` Seed (`12D3KooWEAXoCaAoEsXTCMYkthB4jWvStef3Ch6pZycgmGWbN76L`)
  - `N2` Relay (`12D3KooWCAVNuXtWenWfAZVjg68Q9HSMGzWycddkn5Vkii8Zj43U`)
  - `N3` Full + Storage (`12D3KooWSTvCQsc6ekTvWD2WnCjVyYoXCBZ8J5777anQTwVfpKN1`)
  - `N4` Late Joiner (`12D3KooWNFMXQS8EE9W6p5BcxGHJS1V4c4J4759CGiYivpz2Vu8g`, started **after** permanent `N1` shutdown)
  - `Evil` Attacker (`12D3KooWHwWgDW12o6zjXGYXUSj2aD4wckLkpeBdt3q32ra7945g`)
- **Observed Outcomes:**
  - **Bootstrap Shutdown + Transitive PEX Recovery:** After `await n1.stop()` permanently killed `N1`, fresh `N4` imported `N2`'s `/api/seeds/bundle` (`n4BundleImportOk: true`), dialed `N2` (`n4DialN2WithoutN1Ok: true`), executed `requestPeerExchange`, accepted `1` peer record (`pexAcceptedCount: 1`), and discovered `N3` (`n4DiscoveredN3AfterN1Death: true`) with zero DNS and zero seed `N1`.
  - **Partition Recovery:** Disconnecting `N4` from `N2` and re-dialing restored connectivity cleanly (`recoveredAfterPartition: true`).
  - **Adversarial Forgery / Sybil Isolation:** Sending unsigned forged `PUT_VALUE` on `/sovra/dht/1.0.0` from `Evil` to `N2` returned `success: false` (`evilForgedDhtRejected: true`) and immediately blacklisted `Evil` (`evilBlacklistedByHonestNode: true`).
  - **Clean Socket & Timer Shutdown:** Simultaneous teardown of `Evil`, `N4`, `N3`, and `N2` completed in **`15 ms`**.
- **Backing Vitest Integration Suites (`task-57889`, `11 / 11 PASS`):**
  - `tests/integration/zero-domain-p2p-volunteer-mesh.test.ts`: `5 / 5 PASS`
  - `tests/integration/multi-region-seed-mesh.test.ts`: `3 / 3 PASS`
  - `packages/p2p/test/reliability-partition.test.ts`: `3 / 3 PASS`

---

## 3. Global Field Matrix — Local/Simulated vs External Evidence Separation

| Matrix Cell | Evidence Scope | Classification | Notes |
|---|---|---|---|
| **Zero-DNS Bundle Cold-Start & Seed Shutdown** | Local loopback / same-host daemons | **`PASS`** *(Local)* | Verified in `task-57912` & `zero-domain-full-parity.test.ts` |
| **Network Partition Recovery & Malicious DHT Peer Isolation** | Local Noise_XX mesh | **`PASS`** *(Local)* | Verified in `task-57912` (`15ms` teardown) & `reliability-partition.test.ts` |
| **Symmetric NAT / CGNAT Relay Reservation & Direct-vs-Relayed Distinction** | Simulated `100.64.0.0/10` + loopback Relay v2 | **`PASS`** *(Simulated)* | Verified in `cgnat-cellular-relay.test.ts` & `transport-interop.test.ts` |
| **Wi-Fi <-> 5G Session Migration Token Handling** | Simulated connection migration | **`PASS`** *(Simulated)* | `SovraP2PNode.migrateSession` / `light-client` tests (`p2p` suite) |
| **3+ Independent Operators Across Separate External ASNs & Geographies** | External public internet | **`NOT TESTED`** | Single workstation only (`ORG-A/B/C` unprovisioned) |
| **Live Public IPv4 / IPv6 / Home-Router NAT / Symmetric Carrier CGNAT WAN Traversal** | External carrier/broadband links | **`NOT TESTED`** | Host gateway `10.155.170.243` blocked UPnP/NAT-PMP/PCP (`BLOCKED`); no remote WAN peer |
| **Live Tor `.onion` v3 Hidden Service Circuit Over Public Tor Network** | External Tor circuit | **`NOT TESTED`** | `tor.exe` absent (`127.0.0.1:9050` closed) |
| **Real Physical Android Handsets, Carrier SIMs & Multi-Hour Wi-Fi/Cellular Switching** | Physical hardware / field | **`NOT TESTED`** | `adb devices -l` empty (`0` physical handsets) |
| **Long-Duration Multi-Day WAN Churn & Soak Stability** | Extended live network runtime | **`NOT TESTED`** | Only short automated suites & `9.8s` local chaos drill executed |
