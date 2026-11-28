# SOVRA — Network Interoperability & Transport Report

**Scope:** Stage 2 (`P0-02`, `P0-03`, `P1-05`) — Transports, Handshake, Multiplexing, IPv4/IPv6, WebSocket, NAT/STUN/Relay, Timeouts, and Validation Throughput.  
**Date:** 2026-11-26

---

## 1. Runtime Transport Inventory & Honesty Statement (`Node v24.22.0`)

Per Absolute Rule 4 (`Do not label TCP as QUIC`) and [RFC/NETWORK/SOVRA-NET-v1.md:28](file:///d:/Sovra/RFC/NETWORK/SOVRA-NET-v1.md#L28) (`quic`/`ws` specified as optional):
- **`node:quic` is NOT available** in this environment (`ERR_UNKNOWN_BUILTIN_MODULE` on Node `v24.22.0`), and no native QUIC C++/Rust addon exists in workspace dependencies.
- Rather than labeling TCP connections as QUIC, [packages/p2p/src/node.ts:604-606,999-1007](file:///d:/Sovra/packages/p2p/src/node.ts#L999-L1007) explicitly skips `/quic` listen addresses, rejects `/quic` dials with `ERR_UNSUPPORTED_TRANSPORT`, and excludes `/quic` from [filterDialableMultiaddrs](file:///d:/Sovra/packages/p2p/src/bootstrap-seeds.ts#L111-L113).
- Genuine implemented runtime transports reported by `node.getSupportedTransports()`:
  1. `tcp+noise_xx+yamux` (OS IPv4 & IPv6 TCP sockets + X25519/Ed25519 `Noise_XX` + `Yamux` streams)
  2. `ws+noise_xx+yamux` (RFC 6455 WebSocket upgrade/framing over TCP + `Noise_XX` + `Yamux`)
  3. `circuit-relay-v2` (Reserved relay circuits forwarding authenticated `/sovra/...` req/resp & pubsub frames)
  4. `mdns-udp` (IPv4 UDP `224.0.0.251` signed `sovra-mdns-v1` peer beacons)

---

## 2. Protocol & Interoperability Fixes Verified

1. **Multi-Listener Dual-Stack + WebSocket Node Binding ([packages/p2p/src/node.ts](file:///d:/Sovra/packages/p2p/src/node.ts)):** Nodes now simultaneously bind IPv4 TCP (`/ip4/.../tcp/0`), IPv6 TCP (`/ip6/::1/tcp/0`), and WebSocket (`/ip4/.../tcp/0/ws`), exposing `getBoundAddresses()`, `getBoundWsPort()`, and symmetrical `registerMuxerProtocolHandlers()` across initiator & responder streams.
2. **ReqResp Empty Payload Bug ([packages/p2p/src/reqresp.ts:246](file:///d:/Sovra/packages/p2p/src/reqresp.ts#L246)):** Fixed truthiness check `parsed.payloadHex` that dropped empty valid 0-byte responses (`""`), now checking `typeof parsed.payloadHex === 'string'`.
3. **WebSocket Pre-Listener Buffering & Fast Socket Teardown ([packages/p2p/src/websocket.ts:28,172,365](file:///d:/Sovra/packages/p2p/src/websocket.ts#L28) & [transport.ts:622-624](file:///d:/Sovra/packages/p2p/src/transport.ts#L622-L624)):** Added `bufferedPayloads` queueing in `WebSocketDuplexStream` so inbound Noise handshakes arriving during socket attachment are never lost; added `closeAllConnections?.()` so node shutdown completes reliably without hanging timers.
4. **Timeouts, Idle Pruning & Relay Failover ([packages/p2p/src/node.ts:817,1354](file:///d:/Sovra/packages/p2p/src/node.ts#L1354)):** Enforced `handshakeTimeoutMs` around hung Noise exchanges, periodic idle connection pruning (`idlePruneIntervalMs`), and automatic multi-candidate fallback via `dialWithRelayFallback()`.
5. **PEX Disk Persistence Wiring ([packages/p2p/src/discovery.ts:306,502](file:///d:/Sovra/packages/p2p/src/discovery.ts#L306) & [scripts/bootstrap-node.ts:260-272](file:///d:/Sovra/scripts/bootstrap-node.ts#L260-L272)):** Subscribed volunteer/seed daemons to `p2pNode.discovery.onPeerDiscovered` so `/sovra/pex/1.0.0`, mDNS, and QR-learned peers persist automatically into `<dataDir>/peers.json`.

---

## 3. Observed Local Interoperability & Performance Evidence (`task-55701`)

| Test / Benchmark | Result | Measured Output (`remediation-verified-120-final.log`) | Environment |
|---|---|---|---|
| [transport-interop.test.ts](file:///d:/Sovra/packages/p2p/test/transport-interop.test.ts) (`4` tests) | **PASS (`4/4`)** | Simultaneous IPv4+IPv6+WS+Noise_XX ReqResp, `/quic` fail-closed rejection, hung-socket timeout & idle prune, relay failover recovery (`540ms`) | Loopback OS sockets |
| [real-network.test.ts](file:///d:/Sovra/packages/p2p/test/real-network.test.ts) (`20` OS nodes) | **PASS (`1/1`)** | 20 independent OS TCP `Noise_XX` nodes handshaking and communicating (`985ms`) | Loopback OS sockets |
| [ia01-networking-and-storage.test.ts](file:///d:/Sovra/tests/integration/ia01-networking-and-storage.test.ts) (`Sec 4`) | **PASS** | IPv4, IPv6 `/ip6/::1`, UDP mDNS, signed QR, expired/replayed PEX rejection, STUN failure bound, multi-relay failover (`867ms`) | Loopback OS sockets |
| [benchmark.test.ts](file:///d:/Sovra/packages/p2p/test/benchmark.test.ts) (`Validation / DHT / GossipSub`) | **PASS (`3/3`)** | Validation: **`4,238 ops/sec`** (`118.0ms / 500`, up from `153 ops/sec`; `10,715 ops/sec` isolated); DHT lookup: **`0.344ms`**; GossipSub publish: **`106,433 msgs/sec`** | Local Vitest load |
| External Multi-ASN Public WAN + Carrier CGNAT + UDP QUIC | **NOT VERIFIED** | Procedure authored in [RECOVERY/EXTERNAL_MULTI_ORG_CERTIFICATION.md](file:///d:/Sovra/RECOVERY/EXTERNAL_MULTI_ORG_CERTIFICATION.md) & [external-certification-check.ts](file:///d:/Sovra/scripts/external-certification-check.ts) | Single host cannot establish WAN |
