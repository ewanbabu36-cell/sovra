# SOVRA — P2P DECENTRALIZATION & NETWORKING AUDIT REPORT

**Workspace:** `D:\Sovra`  
**Packages Audited:** `packages/p2p`, `packages/storage`, `packages/protocol`  
**Auditor:** Principal P2P Protocol & Distributed Networking Engineer  
**Date:** November 24, 2026  

---

## 1. P2P PROTOCOL MATRIX

Sovra implements a multi-tier decentralized transport stack designed to operate across browser WebRTC, mobile BLE, and server TCP:

```
┌────────────────────────────────────────────────────────┐
│               SOVRA APPLICATION PROTOCOLS              │
├────────────────────────────┬───────────────────────────┤
│ BitSwap 1.2.0 Media Chunks │ GossipSub v1.2 Feeds & Pub│
├────────────────────────────┼───────────────────────────┤
│ W3C DID Authentication     │ Noise XX Mutual Encryption│
├────────────────────────────┼───────────────────────────┤
│ ICE (STUN / TURN / Relay)  │ BLE Ad-Hoc Multi-Hop Mesh │
├────────────────────────────┼───────────────────────────┤
│ WebRTC RTCDataChannel      │ Raw TCP / WebSocket Wire  │
└────────────────────────────┴───────────────────────────┘
```

---

## 2. BITSWAP 1.2.0 & WEBRTC SWARM EVALUATION

### Technical Specifications:
- **Wire Framing:** SIP-001 Binary Protocol Header (`0x534F5652` / 'SOVR') with 64-byte Ed25519 signature validation.
- **Chunk Size:** 256 KiB (`SOVRA_CHUNK_SIZE`).
- **DataChannel Protocol:** `'bitswap-1.2.0'` over SCTP.
- **Tit-for-Tat Choking Engine:**
  - Tracked peer upload and download rates.
  - Periodic recalculation (every 10 seconds).
  - Top 4 fastest downloaders unchoked; 1 random peer optimistically unchoked to discover new seeders.

### Verification Results (`packages/storage/test/webrtc-bitswap.test.ts`):
1. `should frame and serialize binary wire messages with 0x534F5652 magic`: **PASS**
2. `should negotiate WantList and transfer 256 KiB chunk over WebRTC DataChannel`: **PASS**
3. `should enforce Tit-for-Tat choking state machine and optimistic unchoke`: **PASS**

---

## 3. NOISE PROTOCOL & ENCRYPTED TRANSPORT

- **Handshake Pattern:** Noise_XX_25519_ChaChaPoly_BLAKE2s.
- **Adversarial Resilience:** Verified against replayed handshakes, out-of-order counter frames, and forged signatures in `packages/p2p/test/noise-vectors.test.ts` (PASS).
- **NAT Traversal:** Dynamic fallback between direct STUN host/server-reflexive candidates and TURN relayed candidates, traversing Symmetric and CGNAT cellular networks.

---

## 4. PUBLIC TELEMETRY ENDPOINTS

To eliminate simulated seeder numbers, the platform exposes genuine node metrics:
- `GET /api/webrtc/status`: Reports ICE servers, NAT traversal status, and RFC 8445 protocol version.
- `GET /api/p2p/swarm-status`: Reports active connected seeders, BitSwap wantlists, and total block exchange counts.
