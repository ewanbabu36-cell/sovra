# SOVRA — Live Global Network Field Test Report (AUDIT 7)

**Audit Timestamp:** `2026-11-26T16:29:21+05:30` to `2026-11-26T16:50:38+05:30`  
**Honesty Disclosure:** All multi-node tests executed in this audit ran **locally on one Windows host (`127.0.0.1` loopback & local interface `2401:4900:d242:3e84:b486:6509:1762:50b5`)**. Because zero independently operated external physical hosts, zero remote ASNs, zero live Tor daemons, and zero physical Android smartphones were attached to this workstation (`adb devices -l` empty; `tor.exe` absent), **external physical-network WAN tests are strictly reported as `NOT TESTED`**.

---

## 1. Host Environment Measurement (`task-56821`)

- **OS & Runtime:** Windows, Node `v24.22.0`, Go `go1.27.0 windows/amd64`, Rust `1.101.0-nightly`
- **Compilers Missing:** `cl.exe` = absent, `link.exe` = absent (blocks offline Rust `quinn`/C++ native builds)
- **Active Network Interfaces:**
  - Wi-Fi IPv4: `10.155.170.224/24` (RFC 1918 behind local NAT gateway)
  - Wi-Fi IPv6: `2401:4900:d242:3e84:b486:6509:1762:50b5/128`, `2401:4900:d242:3e84:7c76:f841:4486:e86f/64`, link-local `fe80::135e:e6fe:7808:548d`
- **Live UPnP / NAT-PMP Probe (`10.155.170.224`):** Failed in `2434ms` (`{ ok: false, reason: "NAT-PMP gateway 10.155.170.1:5351 did not respond" }`)
- **Live External Public STUN UDP Probes (`142.250.190.46:19302` & `104.16.132.229:3478`):** `p1: null, p2: null` (UDP outbound timeout/blocked in local firewall/ISP path)
- **Tor Daemon Status:** `where.exe tor` = empty; `127.0.0.1:9050` = `false`; `127.0.0.1:9150` = `false`
- **Physical Android Devices (`adb devices -l`):** `List of devices attached` (0 devices)

---

## 2. Local Isolated Multi-Node Churn, Discovery & Malicious Peer Drill (Executed Locally)

1. **Actual source code exercised:** [volunteer-node.ts](file:///d:/Sovra/scripts/volunteer-node.ts), [bootstrap-node.ts](file:///d:/Sovra/scripts/bootstrap-node.ts), [node.ts](file:///d:/Sovra/packages/p2p/src/node.ts), [scoring.ts](file:///d:/Sovra/packages/p2p/src/scoring.ts).
2. **Recorded Node Identifiers (`runAudit3And7DiscoveryChurn` at `2026-11-26T11:12:06.255Z`):**
   - Clean zero-seed node `N_clean`: `12D3KooWKfZVqvXrPWM2VyjLVtS8TFrreAQeEPDnSkanmGrJZtUC` (`/ip4/127.0.0.1/tcp/59339`) -> `peerBookCount: 0`
   - Drill Node `N1` (`seed` + built-in STUN): `12D3KooWLFz2tB4cT2AYvw8kH65Yb9Mud5fG6z1S4y1AX1EapNdL`
   - Drill Node `N2` (`relay`): `12D3KooWGxjYdt5gQvByPKd5vyaSqgGtqh5uMmrZi4o4rrMrcBYd`
   - Drill Node `N3` (`full` + `StorageNodeDaemon`): `12D3KooWNajpawwPjHcJ5tu8fbNgdADTWBatmDhU5KihLKY3D93z`
   - Drill Node `N4` (`relay`, started **after** `N1.stop()`): `12D3KooWSGjkh9CwtbTKMqhzdeVBSFNMrhAjUDgE1DMCkr1oFVW8`
3. **Observed Local Drill Results:**
   - **Direct P2P Noise_XX + PEX + Bundle Import:** `N1` exported signed bundle (`bundleN1Peers: 3`); `N2` & `N3` cross-announced and imported peers with `enableDnsFallback: false`.
   - **Bootstrap Node Failure (`N1` shutdown) + Late Joiner Recovery:** After `await n1.stop()` permanently killed the seed, `N4` started with `bootstrapPeers: [n2.multiaddr]`, fetched & verified `/api/seeds/bundle` from `N2` (`n4BootstrappedWithoutN1Ok: true`), and transitively discovered both `N2` (`true`) and `N3` (`true`).
   - **Malicious Peer Scoring:** `scoring.onInvalidSignature('malicious-peer')` deducted `-50` -> `isBlacklisted: true` (`node.ts:1027` refuses blacklisted dials).
   - **Clean Socket Teardown (TcpTransport `activeSockets`):** Stopping `N4`, `N3`, `N2` completed cleanly in **`60ms`** total with zero hanging sockets or leaked timers.
   - **Ephemeral `dev-server.ts` Mobile Sync (`SOVRA_NO_DNS=true`):** `durable-offline-mesh.test.ts` passed `10/10` (`586ms`), reconciling offline outbox operations against local zero-domain HTTP relay.

---

## 3. External Physical Network Scenarios — Honest Classification

| Field Scenario | Status | Exact Reason / Observed Evidence |
|---|---|---|
| **Cross-ASN Direct IPv4/IPv6 Peer Discovery & Sync (3+ Independent Operators)** | **`NOT TESTED`** | Only 1 local workstation available; zero independent remote ASNs (`ORG-A/B/C`) deployed |
| **Live Tor `.onion` v3 Hidden Service Connectivity Across Internet** | **`NOT TESTED`** | `tor.exe` absent on host (`127.0.0.1:9050` closed); only local mock SOCKS5 (`upnp-socks5-zero-domain.test.ts`) ran |
| **Live Carrier CGNAT / Symmetric NAT / Double NAT WAN Traversal** | **`NOT TESTED`** | Local host behind `10.155.170.224` failed UPnP/NAT-PMP (`ok: false`) & external UDP STUN timed out (`null`); no remote carrier SIM pair available |
| **Long-Duration Multi-Day WAN Stability & Churn** | **`NOT TESTED`** | Only short local regression & multi-node churn drills executed; long-duration real-internet soak not conducted |
| **Physical Android Device Field Test (BLE / Wi-Fi Direct / TEE / Doze)** | **`NOT TESTED`** | `adb devices -l` returned 0 connected handsets |

---

## Required Remediation for Live Field Sign-Off
1. Provision 3+ independently operated nodes on separate physical networks / home broadband routers (UPnP + IPv6) + Tor hidden services (`tor` + `HiddenServicePort`), and run [external-certification-check.ts](file:///d:/Sovra/scripts/external-certification-check.ts) per [EXTERNAL_MULTI_ORG_CERTIFICATION.md](file:///d:/Sovra/RECOVERY/EXTERNAL_MULTI_ORG_CERTIFICATION.md).
2. Connect 2+ physical Android phones on distinct carrier SIMs (CGNAT LTE/5G) running signed APKs to verify BLE GATT, Wi-Fi Direct, Doze/SSE/UnifiedPush wakeup recovery, and SPKI-pinned self-signed TLS relay fetches end-to-end.
