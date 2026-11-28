# SOVRA — NAT Traversal & Transport Verification Report (Phase 3)

**Report Date:** `2026-11-26T22:41:00+05:30`  
**Git Baseline:** `6c0e705` (with Phase 1–3 remediations applied and verified)  
**Overall Phase 3 Gate Status:** **`PARTIAL`** *(All local NAT mapping protocols — UPnP IGD, RFC 6886 NAT-PMP, and RFC 6887 PCP v2 MAP — plus IPv4/IPv6 dual-stack TCP, RFC 6455 WebSocket, Tor SOCKS5 ATYP=DOMAINNAME Noise_XX tunneling, Circuit Relay v2 forwarding, honest `'direct' | 'relayed' | 'tor-onion'` ConnectionType labeling, and fail-closed QUIC rejection pass `36 / 36` automated tests. Live WAN NAT hole-punching across external Symmetric/CGNAT routers, live Tor hidden-service circuits (`127.0.0.1:9050` closed), and gateway UPnP/NAT-PMP/PCP (`10.155.170.243` silent) remain `NOT TESTED` / `BLOCKED` by host environment.)*

---

## Capability & Honest Protocol Verification Matrix

| Capability | Implementation & Evidence | Local Verification (`task-57722`) | External / Live Network Status | Verdict |
|---|---|---|---|---|
| **UPnP IGD (SSDP + SOAP Add/Delete)** | [upnp.ts:200-465](file:///d:/Sovra/packages/p2p/src/upnp.ts#L200-L465) | Local HTTP SOAP responder `AddPortMapping`, `GetExternalIPAddress` (`198.51.100.42`), `DeletePortMapping` verified | Host gateway `10.155.170.243` did not answer SSDP | `PARTIAL` *(Protocol `PASS` / LAN gateway `BLOCKED`)* |
| **RFC 6886 NAT-PMP** | [upnp.ts:91-186](file:///d:/Sovra/packages/p2p/src/upnp.ts#L91-L186) | UDP gateway IP query + TCP mapping (`203.0.113.77`) + lifetime=0 unmap on `node.stop()` | Host gateway `10.155.170.243:5351` did not respond | `PARTIAL` *(Protocol `PASS` / LAN gateway `BLOCKED`)* |
| **RFC 6887 PCP (v2 MAP)** | [upnp.ts:240-360, 466-510](file:///d:/Sovra/packages/p2p/src/upnp.ts#L240-L360) | Implemented 60-byte PCP v2 MAP request, 96-bit nonce verification, `::ffff:a.b.c.d` + IPv6 decode, fallback order (`UPnP -> NAT-PMP -> PCP`), and lifetime=0 delete with matching nonce (`upnp-socks5-zero-domain.test.ts` PASS) | Host gateway `10.155.170.243:5351` did not return PCP v2 MAP | `PARTIAL` *(Protocol `PASS` / LAN gateway `BLOCKED`)* |
| **IPv4 & IPv6 Dual-Stack TCP + WebSocket** | [node.ts:750-813, 1180-1204](file:///d:/Sovra/packages/p2p/src/node.ts#L750-L813) | Simultaneous bind + Noise_XX + Yamux RPC over `/ip4/127.0.0.1/tcp/...`, `/ip6/::1/tcp/...`, and `/ip4/127.0.0.1/tcp/.../ws` (`transport-interop.test.ts` `4/4 PASS`) | Host Wi-Fi holds live global IPv6 `2401:4900:...` & IPv4 `10.155.170.224` (`Wi-Fi`); remote WAN peer IPv6 dial `NOT TESTED` | `PARTIAL` |
| **Symmetric NAT & CGNAT (`100.64.0.0/10`)** | [nat.ts:10-120](file:///d:/Sovra/packages/p2p/src/nat.ts#L10-L120), [node.ts:1602-1672](file:///d:/Sovra/packages/p2p/src/node.ts#L1602-L1672) | `isCgnatAddress` + `isCgnatActive()` + `CircuitRelayV2` Hop/Stop reservations & `dialWithRelayFallback` (`cgnat-cellular-relay.test.ts` `8/8 PASS`) | Real dual-carrier CGNAT (Jio/Airtel/T-Mobile) hole-punch & relay latency `NOT TESTED` | `PARTIAL` |
| **Tor SOCKS5 & Onion-to-Onion Tunneling** | [socks5.ts](file:///d:/Sovra/packages/p2p/src/socks5.ts), [node.ts:1130-1197, 1388](file:///d:/Sovra/packages/p2p/src/node.ts#L1130-L1197) | Fails closed (`ERR_TOR_PROXY_REQUIRED`) without proxy; real RFC 1928 `ATYP=0x03` (`DOMAINNAME`) Noise_XX + ReqResp `ONION_ACK` verified locally with `connectionType: 'tor-onion'` (`upnp-socks5-zero-domain.test.ts` `9/9 PASS`) | Host `127.0.0.1:9050` closed (`tor9050Open: false`), live Tor circuit `NOT TESTED` | `PARTIAL` |
| **Circuit Relay v2 Fallback & Honest ConnectionType** | [types.ts:14](file:///d:/Sovra/packages/p2p/src/types.ts#L14), [connection.ts:78-105](file:///d:/Sovra/packages/p2p/src/connection.ts#L78-L105), [node.ts:1417-1580](file:///d:/Sovra/packages/p2p/src/node.ts#L1417-L1580) | Fixed `getConnectedPeers()` & `ConnectionManager` so active `relayedRoutes` appear accurately with `status: 'relayed', connectionType: 'relayed'` and `/onion*` peers report `'tor-onion'` (never mislabeled `'direct'`) | Cross-ASN relay hops `NOT TESTED` | `PASS` *(Local truth-in-reporting & fallback)* |
| **Native QUIC (RFC 9000)** | [node.ts:1118-1127](file:///d:/Sovra/packages/p2p/src/node.ts#L1118-L1127), [bootstrap-seeds.ts](file:///d:/Sovra/packages/p2p/src/bootstrap-seeds.ts) | **Explicitly unsupported** in Node runtime; fails closed with `ERR_UNSUPPORTED_TRANSPORT`, `getSupportedTransports()` excludes `'quic'`, and `filterDialableMultiaddrs()` strips `/quic` without spoofing TCP as QUIC (`transport-interop.test.ts` PASS) | Requires native QUIC implementation if needed in future | `PASS` *(Honest fail-closed contract)* / **Unsupported** |

---

## Finding-by-Finding Remediation Record

### NAT-P3-01 — Missing RFC 6887 PCP (Port Control Protocol) Support
- **Original Finding & Severity:** **Medium** — `packages/p2p/src/upnp.ts` implemented UPnP IGD and RFC 6886 NAT-PMP, omitting RFC 6887 PCP MAP v2 supported by modern Carrier/IPv6-aware gateways.
- **Exact Source File & Line:** [upnp.ts:7-44, 240-510](file:///d:/Sovra/packages/p2p/src/upnp.ts#L240-L510).
- **Root Cause:** `AutoPortMapper` only fell back to NAT-PMP v0 (`opcode=2`) and lacked RFC 6887 60-byte PCP v2 packet construction, 96-bit mapping nonce validation, and IPv4-mapped IPv6 (`::ffff:a.b.c.d`) / IPv6 address encoding.
- **Code Change:** Implemented `encodeIpTo16Bytes()`, `decode16ByteIp()`, `buildPcpMapPacket()`, and `requestPcpMapping()` in `packages/p2p/src/upnp.ts`; added `'pcp'` to `PortMappingLease['method']`, Step 3 PCP fallback in `AutoPortMapper.mapPort()`, and lifetime-`0` PCP unmap cleanup in `AutoPortMapper.unmapAll()`.
- **Tests Executed:** `packages/p2p/test/upnp-socks5-zero-domain.test.ts` (9 tests including real UDP PCP v2 MAP responder + lifetime=0 nonce-matched teardown on `node.stop()`).
- **Actual Output (`task-57722`):** `pcpAllocLifetime: 3600`, advertised `/ip4/198.51.100.88/tcp/<port>/p2p/...`, `pcpUnmapLifetime: 0`, `unmapNonceMatched: true`. Host gateway `10.155.170.243:5351` probe returned `PCP gateway 10.155.170.243:5351 did not return a valid MAP v2 response`.
- **Status:** **`PARTIAL`** *(Protocol implementation `PASS`; physical router responder absent on host LAN `BLOCKED`)*.

### NAT-P3-02 — Relayed / Onion `ConnectionType` Visibility & Anti-Misreporting
- **Original Finding & Severity:** **High** — `ConnectionManager.getConnectedPeers()` did not guard `/p2p-circuit/` multiaddrs, `SovraP2PNode.getConnectedPeers()` omitted live `this.relayedRoutes` connections not present in `connManager.connections`, and Tor onion dials were labeled `'direct'` instead of `'tor-onion'`.
- **Exact Source File & Line:** [types.ts:14](file:///d:/Sovra/packages/p2p/src/types.ts#L14), [connection.ts:78-105](file:///d:/Sovra/packages/p2p/src/connection.ts#L78-L105), [node.ts:1388, 1451, 1552-1582](file:///d:/Sovra/packages/p2p/src/node.ts#L1552-L1582).
- **Root Cause:** Relayed Circuit Relay v2 sessions stored in `relayedRoutes` were separated from `ConnectionManager.connections`, and `ConnectionType` lacked a distinct `'tor-onion'` variant.
- **Code Change:** Added `'tor-onion'` to `ConnectionType`; hardened `ConnectionManager.getConnectedPeers()` to inspect `status === 'relayed'`, `/p2p-circuit/`, and `/onion` before labeling `'direct'`; exposed `ConnectionManager.getPeerInfo()`; updated `SovraP2PNode.getConnectedPeers()` to include active `relayedRoutes` strictly as `{ status: 'relayed', connectionType: 'relayed' }`; cleared `relayedRoutes` in `disconnect()`.
- **Tests Executed:** `packages/p2p/test/transport-interop.test.ts` (`4/4 PASS`), `packages/p2p/test/cgnat-cellular-relay.test.ts` (`8/8 PASS`), `packages/p2p/test/upnp-socks5-zero-domain.test.ts` (`9/9 PASS`).
- **Actual Output (`task-57722`):** `dialWithRelayFallback` recovery reports `connectionType === 'relayed'` in both dial result and `pA.getConnectedPeers()`, and Tor SOCKS5 `/onion3/` dial reports `connectionType === 'tor-onion'` with bidirectional `ONION_ACK` ReqResp verified.
- **Status:** **`PASS`**

---

## Phase 3 Regression Results (`task-57722`, Exit `0`)

Command:
`.\pnpm.cmd --filter @sovra/p2p build` -> `.\pnpm.cmd --filter @sovra/p2p run typecheck` -> `vitest run` on 8 Phase 3 suites + live Node host probe:

- **`@sovra/p2p` build & typecheck:** Exit **`0`**
- **Phase 3 Test Suites:** **`21 / 21` describe suites (`8 / 8` files), `36 / 36` tests PASS, `0` failed**:
  - `packages/p2p/test/upnp-socks5-zero-domain.test.ts`: `9 / 9`
  - `packages/p2p/test/transport-interop.test.ts`: `4 / 4`
  - `packages/p2p/test/cgnat-cellular-relay.test.ts`: `8 / 8`
  - `packages/p2p/test/network-integration.test.ts`: `4 / 4`
  - `packages/p2p/test/websocket.test.ts`: `3 / 3`
  - `packages/p2p/test/real-network.test.ts`: `1 / 1`
  - `packages/p2p/test/reliability-partition.test.ts`: `3 / 3`
  - `packages/p2p/test/transport.test.ts`: `4 / 4`
- **Live Host Telemetry:** Gateway `10.155.170.243` (Wi-Fi `10.155.170.224` + IPv6 `2401:4900:...`); UPnP/NAT-PMP/PCP probe `ok: false`; Tor SOCKS5 port `9050` open: `false`.
