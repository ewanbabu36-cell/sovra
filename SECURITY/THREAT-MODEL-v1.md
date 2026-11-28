# SOVRA Security Threat Model & Incident Process (`v1.0`)

**Spec Alignment:** `SOVRA-CORE/1.0`, `SOVRA-OPS/1.0`

---

## 1. Adversarial Assumptions
Sovra assumes ANY peer, relay, storage node, third-party app, or founder endpoint can be dishonest, compromised, malicious, or permanently unreachable.

## 2. Threat-to-Control Matrix (Section 18.1)

| Threat | Implemented Defense | Code Anchor |
|---|---|---|
| Identity impersonation | Ed25519 domain-separated signatures & `sovra1...` binding | [sovra-id.ts](file:///d:/Sovra/packages/identity/src/sovra-id.ts) |
| Sybil attacks | `/24` IPv4 & `/48` IPv6 subnet diversity + rate limits + peer scoring | [connection.ts](file:///d:/Sovra/packages/p2p/src/connection.ts) |
| DHT poisoning | Signed peer records, TTL expiry, query timeouts, bucket diversity | [discovery.ts](file:///d:/Sovra/packages/p2p/src/discovery.ts), [dht.ts](file:///d:/Sovra/packages/p2p/src/dht.ts) |
| Eclipse attacks | Multiple independent discovery paths (PEX, QR, mDNS, DHT, bundles) | [bootstrap-bundle.ts](file:///d:/Sovra/packages/p2p/src/bootstrap-bundle.ts) |
| Replay attacks | Monotonic `(identity_id, device_id, sequence)`, nonces & expiry | [sovra-evt.ts](file:///d:/Sovra/packages/protocol/src/sovra-evt.ts), `node-db.ts` |
| Data tampering | SHA-256 / BLAKE3 CID verification & signed event IDs | [bitswap.ts](file:///d:/Sovra/packages/storage/src/bitswap.ts) |
| Message interception | Double Ratchet ChaCha20-Poly1305 E2EE with separate encryption key | [chat-engine.ts](file:///d:/Sovra/packages/messaging/src/chat-engine.ts) |
| Device compromise | Root-signed `device.revoke` rejecting compromised keys | [sovra-id.ts](file:///d:/Sovra/packages/identity/src/sovra-id.ts) |
| Spam / Storage abuse | Per-peer scoring, chunk quotas, BitSwap accounting | [relay-v2.ts](file:///d:/Sovra/packages/p2p/src/relay-v2.ts), [scoring.ts](file:///d:/Sovra/packages/p2p/src/scoring.ts) |
| Malicious updates | M-of-N threshold Ed25519 release verification + anti-downgrade | [software-update.ts](file:///d:/Sovra/packages/crypto/src/software-update.ts) |
| Malicious third-party apps | Scoped `AppPermissionManifest` blocking raw key extraction | [sovra-apps.ts](file:///d:/Sovra/packages/protocol/src/sovra-apps.ts) |
| Governance capture | Non-token review + open fork rights | [community-governance.ts](file:///d:/Sovra/packages/identity/src/governance/community-governance.ts) |
| Network partition | Offline outbox queues + CRDT deterministic convergence | [sovra-sync.ts](file:///d:/Sovra/packages/protocol/src/sovra-sync.ts) |

## 3. Incident Response Protocol (Zero Founder Kill Switch)
1. Detect & isolate locally. 2. Publish signed `SOVRA-S` advisory (`author_id`, affected versions, mitigation CID). 3. Independent review & reproducible mitigation build. 4. M-of-N signed release manifest. 5. Operators adopt or fork independently without any unilateral emergency override key.
