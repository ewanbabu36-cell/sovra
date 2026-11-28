# SOVRA — NAT Traversal Reality Report (AUDIT 2)

**Audit Date:** `2026-11-26T16:49:58+05:30`  
**Host Under Empirical Observation:** Windows workstation, Wi-Fi IPv4 `10.155.170.224/24` (RFC 1918 behind local NAT gateway `10.155.170.1`), global IPv6 `2401:4900:d242:3e84:b486:6509:1762:50b5/128`, Node `v24.22.0`, `tor.exe` absent (`127.0.0.1:9050` closed), `0` remote independent ASNs or cellular SIMs available.

---

## Summary Classification Matrix

| NAT / Transport Scenario | Code / Protocol Reality | Live Runtime Status Here | Classification |
|---|---|---|---|
| **Open NAT (Public IPv4 + Forwarding)** | Real TCP + Noise_XX + Yamux implemented | Host behind RFC 1918 NAT (`10.155.170.224`) | `PARTIAL` *(loopback tested; WAN open IP not available)* |
| **Restricted Cone / Port-Restricted Cone NAT** | `NatManager.evaluateStunProbes` classifies `cone_nat`; DCUtR handler **does not perform simultaneous dial-back** | Empirical STUN loopback probe verified; cross-NAT hole punch blocked locally | `PARTIAL` *(STUN only; no real bidirectional UDP/TCP hole punch)* |
| **Symmetric NAT** | Classified via multi-STUN port delta (`PortPredictionEngine`); host DCUtR uses one-way TCP dial so direct punch fails -> needs Relay v2 / Tor | Host STUN probes to external IPs timed out (`null`); symmetric cross-NAT untested on WAN | `PARTIAL` / `NOT TESTED` (WAN) |
| **CGNAT (`100.64.0.0/10`)** | `isCgnatAddress` + `AutoNatService` reject direct inbound dial (`E_DIAL_ERROR`) + Circuit Relay v2 hop/stop forwarding | `packages/p2p/test/cgnat-cellular-relay.test.ts` `8/8 PASS` (localhost); carrier SIM `NOT TESTED` | `PARTIAL` / `NOT TESTED` (Carrier SIM) |
| **Double NAT** | Handled identically to unmapped residential NAT (UPnP on inner router maps inner port only, not ISP/outer NAT); must use Tor `.onion` or public Circuit Relay v2 | Outer/carrier Double NAT external traversal `NOT TESTED` | `NOT TESTED` (External WAN) |
| **IPv4 Loopback / LAN TCP + WS** | Dual-stack TCP + RFC 6455 WebSocket + `Noise_XX` + `Yamux` | `packages/p2p/test/transport-interop.test.ts` `4/4 PASS` | `PASS` *(Loopback / LAN)* |
| **IPv6 Direct** | Requires valid `PeerIdentityBinding` on dialer (`node.ts:1087`); global IPv6 local bind works (`2401:4900:...`); external remote IPv6 peer `NOT TESTED` | `[::1]` dial w/ binding `ok: true`; without binding `ok: false`; host global IPv6 bind `ok: true` | `PARTIAL` *(Local bind & loopback PASS; remote WAN IPv6 NOT TESTED)* |
| **UPnP IGD Unavailable** | `AutoPortMapper.mapPort()` discovers SSDP -> SOAP `AddPortMapping` -> fallback to NAT-PMP | Live host probe on `10.155.170.224` received no SSDP UPnP response; gracefully fell through | `PASS` *(Mock UPnP tested `5/5`; real router unavailable -> fail graceful)* |
| **NAT-PMP Unavailable** | `requestNatPmpMapping()` probes `gateway:5351` (`inferNatPmpGatewayFromInterfaces` assumes `/24 .1`) | Live probe against `10.155.170.1:5351` timed out cleanly (`2434ms`, `ok: false`) | `PASS` *(RFC 6886 mock PASS; live `.1:5351` absent -> fail graceful)* |
| **Tor-only `.onion` Connections** | `Socks5TcpTransport` (`ATYP=0x03`) + fail-closed `ERR_TOR_PROXY_REQUIRED` without proxy | Local SOCKS5 + Noise_XX PASS (`upnp-socks5-zero-domain.test.ts`); `tor.exe` absent (`9050` closed) so live Tor circuit `NOT TESTED` | `PARTIAL` *(Local SOCKS5 PASS; live Tor network NOT TESTED)* |
| **Native UDP QUIC (RFC 9000)** | Explicitly unimplemented in Node `v24.22.0`; fails closed (`ERR_UNSUPPORTED_TRANSPORT`) | Verified `quicFailClosed.ok === false` | `NOT IMPLEMENTED` *(Fail-closed)* |

---

## Detailed Findings

### NAT-01: Built-In STUN Reflexive Binding Does Not Guarantee Bidirectional Inbound Connectivity
1. **Actual source code evidence:** `startLocalStunServer()` and `probeStunUdp()` implement RFC 5389 UDP Binding Request/Response (`XOR-MAPPED-ADDRESS`). Separately, `AutoNatService` falls back to `!isPrivateOrCgnatAddress(remoteObservedIp)` when no `dialBackTester` is supplied (`this.autoNat = new AutoNatService()` in `SovraP2PNode`).
2. **Exact file and line references:** [nat.ts:424-468, 512-702](file:///d:/Sovra/packages/p2p/src/nat.ts#L424-L468), [node.ts:257, 571-591](file:///d:/Sovra/packages/p2p/src/node.ts#L257).
3. **Actual runtime test:** Executed `startLocalStunServer(0, '127.0.0.1')` -> `probeStunUdp('127.0.0.1', 55121, 1200)` followed by raw TCP dial to `127.0.0.1:49991`, plus external UDP STUN probes to `142.250.190.46:19302` and `104.16.132.229:3478`.
4. **Expected result:** STUN discovery reports observed reflexive UDP mapping (`ip:port`), which does not by itself open stateful NAT/firewall TCP/UDP inbound pinholes; live WAN STUN probes may also fail/drop on restrictive networks.
5. **Observed result:** Local STUN probe returned `{ serverAddr: "127.0.0.1:55121", observedIp: "127.0.0.1", observedPort: 55122 }`, while inbound TCP connect to unbound port `49991` returned `{ reachable: false, errorCode: "ECONNREFUSED" }`. External public STUN UDP probes both timed out (`p1: null, p2: null`).
6. **Remaining dependency:** External public-IP Circuit Relay v2 nodes, Tor `.onion` hidden services, or dial-back AutoNAT verifiers across independent ASNs.
7. **Remediation required:** Always wire `dialBackTester` inside `SovraP2PNode` (`AutoNatService`) to actively test inbound TCP reachability from remote peers before advertising public dialability; never treat STUN `observedIp` as reachable without UPnP lease or verified dial-back.

### NAT-02: Live Host UPnP IGD & NAT-PMP Probe + `/24 .1` Gateway Heuristic Limit
1. **Actual source code evidence:** `AutoPortMapper.mapPort()` broadcasts SSDP `M-SEARCH` to `239.255.255.250:1900`, parses XML `controlURL`, sends SOAP `AddPortMapping`, and falls back to `inferNatPmpGatewayFromInterfaces()` which hardcodes `${a}.${b}.${c}.1` on UDP `5351`.
2. **Exact file and line references:** [upnp.ts:56-62, 296-399](file:///d:/Sovra/packages/p2p/src/upnp.ts#L56-L62).
3. **Actual runtime test:** Executed live `AutoPortMapper.mapPort({ internalPort: 41999, externalPort: 41999, protocol: 'TCP', timeoutMs: 1200 })` on host (`10.155.170.224/24`) + `upnp-socks5-zero-domain.test.ts` mock SOAP & RFC 6886 tests.
4. **Expected result:** Mock UPnP/NAT-PMP succeeds in controlled tests; on a residential/hotspot NAT without UPnP/NAT-PMP responder, probe fails cleanly without throwing.
5. **Observed result:** Live host probe took `2434ms` and returned `{ ok: false, reason: "NAT-PMP gateway 10.155.170.1:5351 did not respond" }`. `packages/p2p/test/upnp-socks5-zero-domain.test.ts` passed `5/5` against local mock SOAP & UDP NAT-PMP servers.
6. **Remaining dependency:** Residential routers with UPnP/NAT-PMP enabled (for direct clearnet port forwarding); non-`.1` gateways must pass `upnpOptions.natPmpGateway`.
7. **Remediation required:** Parse OS default gateway (`ip route` / `netstat -rn`) instead of guessing `.1` on the first non-loopback IPv4 interface; keep fallback to Circuit Relay v2 / Tor `.onion` mandatory when UPnP fails.

### NAT-03: DCUtR Hole-Punch Handler Only Performs One-Way Delayed TCP Dial (No Simultaneous Hole-Punch)
1. **Actual source code evidence:** On `DCUTR_PROTOCOL` (`/libp2p/dcutr`) responder side, `handleInbound` replies `{ type: 'SYNC', addrs, delayMs: 100 }` without dialing the initiator. On initiator side, `attemptDcutrUpgrade` waits `delayMs` and calls one-way `this.dial(directCand)` over TCP.
2. **Exact file and line references:** [node.ts:593-609, 1355, 1665-1692](file:///d:/Sovra/packages/p2p/src/node.ts#L593-L609), [nat.ts:478-510](file:///d:/Sovra/packages/p2p/src/nat.ts#L478-L510).
3. **Actual runtime test:** Static protocol path inspection + `packages/p2p/test/cgnat-cellular-relay.test.ts` (`8/8 PASS` circuit relay forwarding tests).
4. **Expected result:** True DCUtR hole punching requires synchronized simultaneous TCP/QUIC outbound dials from **both** peers at the exact `SYNC` deadline (`RTT/2`) using bound local source ports (`reusePort`/`reuseAddr`).
5. **Observed result:** Responder never dials initiator upon `CONNECT`/`SYNC`, so two peers both behind Restricted/Symmetric NAT cannot punch bidirectional state through NAT solely via `DCUTR_PROTOCOL`; connectivity remains relayed via `CircuitRelayV2` (`/p2p-circuit/`).
6. **Remaining dependency:** External public Circuit Relay v2 operators or Tor `.onion` hidden services whenever both peers are NATed.
7. **Remediation required:** Implement true synchronized responder+initiator dual-dial on bound listening sockets (with `SO_REUSEADDR` / QUIC/UDP simultaneous open) or explicitly classify `DCUTR_PROTOCOL` as relay-assisted one-way upgrade only when one peer has open/UPnP port.

### NAT-04: IPv6 Dial Requires `PeerIdentityBinding`; Native UDP QUIC Remains Disabled
1. **Actual source code evidence:** `SovraP2PNode.dial()` gates real socket dialing on `this.binding` (`if (... && this.binding && allowRealTcpDial)`), and explicitly rejects any `/quic` multiaddr with `ERR_UNSUPPORTED_TRANSPORT`.
2. **Exact file and line references:** [node.ts:665-707, 1031-1040, 1083-1089](file:///d:/Sovra/packages/p2p/src/node.ts#L1031-L1089).
3. **Actual runtime test:** Ran `audit-ipv6-and-kat.mjs` (without `binding`) and `audit-extra-kat.mjs` (with `createPeerIdentityBinding` + host global IPv6 bind test `2401:4900:d242:3e84:b486:6509:1762:50b5`).
4. **Expected result:** `SovraP2PNode` with valid `PeerIdentityBinding` completes Noise_XX + Yamux over IPv6; unauthenticated `SovraP2PNode` without `binding` rejects real dials; `/quic` fails closed.
5. **Observed result:** Without `binding`, `[::1]` dial returned `ok: false` (`"No reachable transport path..."`). With `binding`, `[::1]` Noise_XX handshake succeeded (`ok: true`, port `49786`) and host global IPv6 bind succeeded (`/ip6/2401:4900:d242:3e84:b486:6509:1762:50b5/tcp/49788`). `/quic-v1` failed closed with `ERR_UNSUPPORTED_TRANSPORT`.
6. **Remaining dependency:** External dual-stack IPv6 peers to test cross-ASN firewall traversal, and native `quinn`/`quic-go` + MSVC linker if QUIC is desired.
7. **Remediation required:** Reject `start()` or emit an explicit missing-binding error rather than silently returning `"No reachable transport path"` when `strictTransport: true` and `binding` is omitted; treat TCP/WS + Circuit Relay v2 + Tor `.onion` as the supported transport baseline.

### NAT-05: Tor `.onion` Transport Verified Locally via Mock SOCKS5; No Live Tor Daemon on Host
1. **Actual source code evidence:** `Socks5TcpTransport` implements RFC 1928 `ATYP=0x03` (`DOMAINNAME`) remote `.onion` dialing and fails closed (`ERR_TOR_PROXY_REQUIRED`) when `socks5ProxyUrl` is unset. `bootstrap-node.ts` reads `SOVRA_TOR_SOCKS5` and `SOVRA_ONION_HOSTNAME_FILE`.
2. **Exact file and line references:** [socks5.ts:24-150](file:///d:/Sovra/packages/p2p/src/socks5.ts#L24-L150), [node.ts:1042-1055, 1097-1100](file:///d:/Sovra/packages/p2p/src/node.ts#L1042-L1055), [bootstrap-node.ts:192-200, 283-289](file:///d:/Sovra/scripts/bootstrap-node.ts#L192-L200).
3. **Actual runtime test:** `upnp-socks5-zero-domain.test.ts` (`5/5 PASS` against local mock SOCKS5 server) + host probe (`where.exe tor` empty; TCP `127.0.0.1:9050` & `9150` `TcpTestSucceeded: false`).
4. **Expected result:** SOCKS5 tunnel carries Noise_XX + Yamux frames without clearnet DNS leakage; missing proxy fails closed.
5. **Observed result:** Missing proxy failed closed with `"Tor SOCKS5 proxy is required to dial aaaa...onion:4001"`; mock SOCKS5 Noise_XX succeeded; live Tor onion routing is `NOT TESTED` because `tor.exe` is absent on host.
6. **Remaining dependency:** External `tor` daemon (or Orbot / embedded `arti` sidecar) configuring both SOCKS5 (`9050`) and `HiddenServicePort`.
7. **Remediation required:** When CGNAT or Symmetric NAT blocks UPnP and STUN (as observed on host `10.155.170.224`), Tor `.onion` or a public-IP `CircuitRelayV2` is **mandatory** for bidirectional connectivity.
