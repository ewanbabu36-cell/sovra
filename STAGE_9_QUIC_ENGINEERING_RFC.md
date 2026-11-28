# Stage 9 — Phase 5 QUIC Engineering RFC (`RFC SOVRA-QUIC-001`)

**Status:** Engineering Design Specification Only *(Zero QUIC runtime implementation begun; fail-closed rejection remains active)*  
**Target Protocol Profile:** Optional `quic` transport in [RFC/NETWORK/SOVRA-NET-v1.md:28](file:///d:/Sovra/RFC/NETWORK/SOVRA-NET-v1.md#L28) (alongside mandatory `tcp+noise_xx+yamux` and `ws+noise_xx+yamux`)  
**Baseline Preserved:** Stage 8 verdict remains **`NOT TESTED — External Field Certification`**; [STAGE_8_QUIC_IMPLEMENTATION_STATUS.md](file:///d:/Sovra/STAGE_8_QUIC_IMPLEMENTATION_STATUS.md) recorded `NOT IMPLEMENTED` (QUIC runtime) and `PASS` (fail-closed honesty).

---

## 1. Empirical Node.js Runtime Compatibility Analysis

Measured host runtime telemetry (`STAGE_8_QUIC_IMPLEMENTATION_STATUS.md`, `EV-01` & `EV-02`):
* **Workspace Electron-Built Node (`v24.22.0`):** `process.versions.ngtcp2 === ""`, `process.versions.nghttp3 === ""`, `import('node:quic')` rejects with `ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:quic`.
* **System Node (`v24.19.0`):** `process.versions.ngtcp2 === ""`, `process.versions.nghttp3 === ""`, `import('node:quic')` rejects with `ERR_UNKNOWN_BUILTIN_MODULE`.
* **Current Fail-Closed P2P Guard ([packages/p2p/src/node.ts:604-606, 1000-1008](file:///d:/Sovra/packages/p2p/src/node.ts#L1000-L1008) & [bootstrap-seeds.ts:105-109](file:///d:/Sovra/packages/p2p/src/bootstrap-seeds.ts#L105-L109)):**
  * `SovraP2PNode.start()` skips `/quic` multiaddrs when binding TCP/WS listeners.
  * `SovraP2PNode.dial()` rejects any `/quic` / `/quic-v1` target with `ERR_UNSUPPORTED_TRANSPORT`.
  * `RUNTIME_IMPLEMENTED_TRANSPORTS` strictly lists `['tcp+noise_xx+yamux', 'ws+noise_xx+yamux', 'circuit-relay-v2', 'mdns-udp']`.

**Architectural Rule:** Sovra MUST NEVER map `/quic` or `/quic-v1` multiaddrs onto TCP sockets or `Noise_XX` over TCP streams. Prebuilt stock Node.js binaries on Windows, Linux, and macOS cannot be assumed to ship `node:quic` enabled by default.

---

## 2. Native Implementation Options Comparison

| Option | Mechanism | Cross-Platform Binary / Zero-Domain Impact | Stream / Event-Loop Fit | Verdict |
|---|---|---|---|---|
| **A. Custom Node.js Build (`--with-quic` / `ngtcp2`)** | Compile custom `node` binary with experimental `node:quic` & OpenSSL QUIC APIs | **High friction:** Volunteers cannot run stock distro `node` packages; requires redistributing signed custom Node runtimes across OSes | Native `libuv` loop integration; API remains experimental across Node major releases | Reject for mandatory core; viable only as experimental opt-in build |
| **B. N-API Native Addon (Rust `quinn` or C `ngtcp2`)** | Prebuilt `.node` native addon wrapping `quinn` (Tokio/rustls) or `ngtcp2` (`N-API v9`) | **Moderate:** Works on stock Node `v24+` via deterministic reproducible N-API artifacts (`win32-x64`, `linux-x64/arm64`, `darwin-arm64`), or `cargo`/CMake build from source | Clean zero-copy `Buffer` framing to JS `DuplexTransportStream` without inter-process hops; pure-Rust `quinn` + `rustls` avoids OpenSSL C ABI drift | **Recommended** native path for Node daemons (`SovraP2PNode`) |
| **C. Out-of-Process Go Sidecar (`quic-go`)** | Local IPC (Unix Domain Socket / named pipe + protobuf/CBOR frames) to `sovrad`-adjacent Go binary using `quic-go` | **Best immediate Go synergy** (`chain/` already uses Go `go1.27.0`), statically compiled single binary | Extra context-switch/serialization latency across UDS/named pipe; separate daemon lifecycle supervision | Viable interim daemon transport for volunteer seed relays |

---

## 3. `ngtcp2` / TLS 1.3 Stack Constraints

1. **TLS Stack Coupling:** `ngtcp2` is purely a QUIC transport state machine and requires crypto callbacks mapped to either OpenSSL (`SSL_QUIC_METHOD` or OpenSSL 3.5+ native QUIC), `quictls`, `BoringSSL`, `wolfSSL`, or `GnuTLS`. Standard Node builds omit `quictls` patches unless explicitly linked.
2. **ABI & Distribution Hygiene:** Under zero-domain distribution (`BOOTSTRAP_BUNDLE_v1`), any precompiled `.node` addon binary MUST carry reproducible hash digests verified via M-of-N Ed25519 manifest signatures ([packages/crypto/src/software-update.ts](file:///d:/Sovra/packages/crypto/src/software-update.ts)) before dynamic loading (`process.dlopen`), and volunteer nodes without compatible ABI MUST gracefully degrade to `tcp+noise_xx+yamux`.

---

## 4. UDP Socket Ownership & Multiplexing with STUN / ICE / mDNS

Currently in `@sovra/p2p`:
* **mDNS ([discovery.ts:67](file:///d:/Sovra/packages/p2p/src/discovery.ts#L67)):** Binds `node:dgram` `udp4` (`reuseAddr: true`) on `224.0.0.251:5353`. Stays isolated on multicast port `5353`.
* **STUN Probes ([nat.ts:625-668](file:///d:/Sovra/packages/p2p/src/nat.ts#L625-L668)):** Uses ephemeral `dgram.createSocket('udp4')` sockets that close immediately after probe completion (`probeStunUdp`), which would allocate **different NAT port mappings** under Endpoint-Dependent Mapping / Symmetric NAT if not sharing the QUIC endpoint socket!
* **Target Socket Architecture (RFC 9000 + RFC 5389 Demux on One Bound UDP Socket):**
  * Bind a single persistent native UDP endpoint socket (`0.0.0.0:<quicPort>` and `[::]:<quicPort>` when dual-stack) owned exclusively by `QuicEndpointManager`.
  * Register an in-kernel/addon packet discriminator BEFORE QUIC decrypt (`recvmsg` dispatch):
    * **STUN Packet (RFC 5389):** First byte bits `00` (`(b0 & 0xC0) === 0x00`) AND bytes `[4..7]` == STUN Magic Cookie `0x2112A442` -> route to `NatManager` / `DCUtR` UDP hole-punch handler (`observeBinding`, `handleIncomingStun`).
    * **QUIC Packet (RFC 9000):** Fixed bit `(b0 & 0x40) === 0x40` (Long Header `b0 & 0x80` or Short Header 1-RTT) -> feed into `ngtcp2`/`quinn` connection table by Destination Connection ID (DCID).
  * **Benefit:** STUN reflexive `ip:port` discovered through `QuicEndpointManager` matches the exact NAT pinhole used by subsequent QUIC handshakes and `DCUtR` hole punches.

---

## 5. TLS 1.3 Handshake vs `Noise_XX` & Sovra Identity Binding

Currently TCP/WS listeners run raw sockets wrapped in [SecureTransportHandshake](file:///d:/Sovra/packages/p2p/src/transport.ts#L19) (`Noise_XX_25519_ChaChaPoly_SHA256`, ephemeral `e` + static X25519 `s` + inner signed `PeerIdentityBinding` checked against `RevocationRegistry`).

Over QUIC (`RFC 9000` mandates **TLS 1.3** wire encryption and prohibits plaintext QUIC payloads):
1. **Do NOT double-encrypt with Noise_XX over TLS 1.3 QUIC** unless an explicit post-quantum hybrid tunnel is negotiated; instead authenticate the peer natively inside **TLS 1.3 Mutual Authentication** (libp2p-quic TLS spec pattern):
   * Both initiator and responder present an ephemeral self-signed X.509 certificate during TLS 1.3 (`ServerHello` + `CertificateRequest` + client `Certificate` + `CertificateVerify`), signed by an ephemeral ECDSA/Ed25519 TLS key.
   * Embed a critical/non-standard X.509 extension (e.g. Sovra/libp2p OID) containing `(peerPublicKeyEd25519, Ed25519Sign(peerPrivKey, "sovra-quic-tls-v1:" || tlsSpkiDer))`.
   * Verify `derivePeerId(peerPublicKeyEd25519) === expectedPeerId` inside custom TLS certificate verifier BEFORE completing the 1-RTT handshake.
2. **Preserve Application-Level `PeerIdentityBinding` & `RevocationRegistry`:** Immediately upon opening stream `0` (control stream, ALPN `sovra/p2p/1.0.0`), exchange `PeerIdentityBinding` (`did` + device delegation cert) and verify against `RevocationRegistry` exactly as TCP/WS does, keeping `/sovra/*` protocol handlers transport-agnostic.

---

## 6. Stream Multiplexing vs Yamux

| Feature | Existing TCP/WS (`multiplex.ts`) | Target QUIC (`RFC 9000`) |
|---|---|---|
| **Framing** | [StreamMultiplexer](file:///d:/Sovra/packages/p2p/src/multiplex.ts#L6) (`12`-byte Big-Endian Yamux header per chunk) | Native QUIC `STREAM` frames inside encrypted 1-RTT UDP datagrams (zero extra Yamux header bytes) |
| **Head-of-Line (HoL) Blocking** | Single lost TCP segment stalls ALL concurrent GossipSub/Bitswap/ReqResp streams | Per-stream independent delivery in UDP QUIC; packet loss in a BitSwap block stream never stalls `/sovra/pex/1.0.0` or ReqResp RPC |
| **Flow Control** | Software `sendWindow`/`recvWindow` (`1 MB` initial, `16 MB` max via `WINDOW_UPDATE`) | Kernel/addon native `MAX_STREAM_DATA` & `MAX_DATA` credit windows mapped onto the same `MuxedStream` interface |

`MuxedStream` ([types.ts](file:///d:/Sovra/packages/p2p/src/types.ts)) and `GossipSubRouter` / `RequestResponseManager` / `KademliaDHT` require **no semantic rewrite** once a `QuicMuxedStreamAdapter` implements `MuxedStream` (`write`, `close`, `on('data' | 'close')`) directly atop QUIC bidirectional streams without instantiating `StreamMultiplexer` (`Yamux`).

---

## 7. Connection Migration Architecture

Currently [light-client.ts:50-58, 299-319](file:///d:/Sovra/packages/p2p/src/light-client.ts#L299-L319) defines `SessionMigrationToken` (with `connectionIdHex?: string`) and [connection.ts:292-321](file:///d:/Sovra/packages/p2p/src/connection.ts#L292-L321) provides `ConnectionManager.migratePeerConnection(peerId, newMultiaddr)` which swaps `conn.multiaddr` and `/24` or `/48` subnet counters in memory.

With real RFC 9000 QUIC:
1. **Unlinked Multi-Path CIDs:** During connection setup, server issues >= 4 unused Connection IDs via `NEW_CONNECTION_ID` frames with distinct stateless reset tokens.
2. **Active Wi-Fi <-> 5G Migration:** When mobile handoff detects interface/IP change, client switches packet emission to the new OS socket IP:port using a fresh unused server CID, transmits `PATH_CHALLENGE`, waits for peer `PATH_RESPONSE`, and enforces `ConnectionManager.canAcceptConnection()` `/24` IPv4 / `/48` IPv6 subnet limits on the new source address BEFORE retiring the old path CID (`RETIRE_CONNECTION_ID`).
3. **Server-Side Constraint:** If NAT changes source IP:port without a pre-issued CID or peer behind aggressive firewall blocks unsolicited peer UDP responses, fall back immediately to `Circuit Relay v2` rather than keeping half-open dead state.

---

## 8. NAT Traversal & CGNAT Interaction

* **UDP Hole Punching + DCUtR ([nat.ts:585-599](file:///d:/Sovra/packages/p2p/src/node.ts#L585-L599)):** Because QUIC runs over UDP, the **same** bound UDP socket performs STUN binding discovery, coordinated `DCUtR` (`CONNECT`/`SYNC`) simultaneous packet emission (`tier2_udp_hole_punch`), and the subsequent QUIC Initial handshake without TCP `SO_REUSEPORT` half-open RST races.
* **Symmetric NAT & Strict Carrier CGNAT (`100.64.0.0/10`):** When two peers sit behind Endpoint-Dependent Mapping (Symmetric) NAT (`STAGE_8_CGNAT_CARRIER_REPORT`), UDP hole punching still cannot deterministically succeed without shared port-prediction feasibility.
* **Mandatory Circuit Relay v2 Invariant:** When direct QUIC fails handshake timeout (`<= 3000ms`), `SovraP2PNode.dial()` dials an independent community `/p2p-circuit` relay over QUIC (or TCP fallback when firewall blocks outbound UDP `443`/`4001`, e.g., captive portals / enterprise UDP drop!), preserving `/libp2p/circuit/relay/0.2.0/hop` + `/stop`.
* **Firewall Heuristic:** Default QUIC transport priority MUST race IPv6 UDP QUIC first, IPv4 UDP QUIC second, IPv6/IPv4 TCP `Noise_XX` third (`Happy Eyeballs` staggered 150–300ms delay), and `/ws` fourth so captive networks dropping UDP never cause blackhole timeouts.

---

## 9. Security Boundaries

1. **UDP Amplification DDoS Defense (RFC 9000 §8.1):** Enforce strict **3x anti-amplification limit** before peer source-address validation; require QUIC `Retry` packets (stateless AEAD-encrypted address-validation token bound to client `(IP, port, ODCID, timestamp)`) under elevated handshake load.
2. **Strict Zero-RTT Replay Prohibition:** Disable TLS 1.3 / QUIC **0-RTT early data** for all state-mutating protocols (`SOVRA-EVT`, BitSwap PoR receipts, tip/treasury messages, governance votes, PEX peer registration). At most allow 0-RTT for idempotent read-only `/query` headers if ever enabled, defaulting **`max_early_data = 0`**.
3. **Subnet Eclipse & Resource Caps:** Retain [DEFAULT_RESOURCE_LIMITS](file:///d:/Sovra/packages/p2p/src/connection.ts#L8-L15) (`maxConnections = 100`, `maxStreamsPerConnection = 64`, `maxPerSubnet = 10` per `/24` IPv4 / `/48` IPv6) BEFORE admitting QUIC handshakes; reject blacklisted PeerIDs immediately post-`Certificate` verification.
4. **Idle & Stateless Reset Hygiene:** Enforce bounded connection idle timeouts (`30–60s` for mobile relays) and isolate stateless reset tokens per connection so mobile IP roaming cannot leak linkable cleartext session IDs.

---

## 10. Mobile & WebView Compatibility Constraints

* **Browser / Android WebView / iOS WKWebView ([apps/sovra-mobile](file:///d:/Sovra/apps/sovra-mobile/build-mobile-bundle.ts#L87-L95)):** Browser JS runtimes and Capacitor WebViews have **zero access to raw `node:dgram` UDP sockets** (notice [build-mobile-bundle.ts:87-95](file:///d:/Sovra/apps/sovra-mobile/build-mobile-bundle.ts#L87-L95) stubs `dgram` as a no-op).
  * **Android/iOS Native Path:** Mobile UDP QUIC requires running a compiled native library inside Android Kotlin/JNI (`Cronet`/Rust `quinn` NDK `.so` or Go `gomobile`/`quic-go`) and iOS Swift `Network.framework` (`NWProtocolQUIC` on iOS 15+) exposed via an explicit native plugin bridge — **never** inside WebView JS.
  * **Chromium `WebTransport` Caveat:** Chromium `>= 100` WebViews support `WebTransport` (HTTP/3 over QUIC), **but** WebTransport requires a WebPKI certificate (`CA`-signed domain!) or a short-lived (`<= 14 days`) `serverCertificateHashes` SHA-256 fingerprint — conflicting with zero-domain raw-IP operation unless peer hashes are pre-distributed via signed `SignedPeerRecord` QR/PEX bundles!
  * **Recommendation:** Keep **TCP+WS `Noise_XX` + Circuit Relay v2** as mobile's universal baseline (`BLE` + `Wi-Fi Direct` offline), and gate mobile QUIC strictly behind native NDK/Swift `NWProtocolQUIC` plugins after desktop/server QUIC passes WAN CGNAT interop.

---

## 11. Staged Implementation Gate Criteria (No Code Implemented in Stage 9)

Implementation MAY proceed only via separate engineering milestones requiring:
1. Unit handshake + stream multiplex + retry + 0-RTT-rejection tests on UDP `127.0.0.1` & `::1`.
2. STUN + QUIC single-socket demultiplex verification (`tcpdump`/pcap confirming 1 UDP socket).
3. Multi-org external WAN + carrier CGNAT Happy-Eyeballs race (`/udp/.../quic-v1` vs `/tcp/...` failover).
4. Zero regressions in `tcp+noise_xx+yamux` / `ws+noise_xx+yamux` interoperability.
