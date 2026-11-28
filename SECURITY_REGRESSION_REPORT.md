# SOVRA — Security Regression Report

**Scope:** Cryptographic primitives, identity rotation & vectors, dependency isolation, storage Proof-of-Retrievability, blind push privacy, release secrets, and governance privilege boundaries.  
**Date:** 2026-11-26

---

## 1. Security-Critical Remediations & Negative Controls Verified

| Domain | Security Control Verified | Negative / Adversarial Test Coverage | Evidence File |
|---|---|---|---|
| **Storage PoR Integrity** | `ProofOfRetrievabilityEngine.verifyProof()` fails closed on non-CID strings (`catch => cidDigestValid = false`), zero-byte data, and bit-flipped payloads | `'bafybeihash123'`, `'not-a-valid-cid'`, empty buffer, mismatched CID, corrupted block bytes all rejected | [perceptual-multisig.test.ts](file:///d:/Sovra/nodes/storage-node/test/perceptual-multisig.test.ts), [storage-integrity.test.ts](file:///d:/Sovra/nodes/storage-node/test/storage-integrity.test.ts) |
| **Remote Signed PoR Anti-Spoofing & Anti-Replay** | `verifySignedProof()` enforces `CID.parse`, Ed25519 signature over `challengeId:cid:nonce:sample:peerId:respondedAt`, and `0 <= respondedAt - issuedAt <= maxResponseTimeMs`; `StorageNodeDaemon` rejects replayed challenge IDs (`consumedPorChallengeIds`, `seenInboundPorChallengeIds`) and stale challenger wall-clock responses | Rejected: forged PeerID signer, future `respondedAt`, elapsed timeout past `maxResponseTimeMs`, reused single-use `challengeId`, tampered sample hash | [verifier.ts:273-342](file:///d:/Sovra/nodes/storage-node/src/verifier.ts#L273-L342), [nodes/storage-node/src/index.ts:390-405](file:///d:/Sovra/nodes/storage-node/src/index.ts#L390-L405), [storage-integrity.test.ts](file:///d:/Sovra/nodes/storage-node/test/storage-integrity.test.ts) |
| **SOVRA-ID Epoch Key Rotation** | `rotateSovraIdentityEpoch()` derives X25519 public key deterministically via `getX25519PublicKey(params.newEncryptionPrivateKey)`; rejects invalid private key lengths | Cross-verified Vector 6 (`newEncryptionPrivateKey = 07...07` -> `prevSig = 17ddf1...9e500`) against Node OpenSSL `node:crypto`; rejects `< 32` byte keys | [sovra-id-v1.test.ts](file:///d:/Sovra/packages/identity/test/sovra-id-v1.test.ts), [SOVRA-ID-v1.md](file:///d:/Sovra/RFC/IDENTITY/SOVRA-ID-v1.md) |
| **Signed Peer Record Verification** | `verifySignedPeerRecordResult` returns explicit typed `Err` on expired records, invalid PeerID bindings, and replayed nonces; `verifySignedPeerRecord` boolean wrapper preserved for API compatibility | Expired records, tampered region/addresses, and non-32-byte PeerIDs fail closed across PEX & QR ingestion | [packages/p2p/src/identity.ts:270-331](file:///d:/Sovra/packages/p2p/src/identity.ts#L270-L331), [ia01-networking-and-storage.test.ts](file:///d:/Sovra/tests/integration/ia01-networking-and-storage.test.ts) |
| **Transport Fail-Closed Honesty** | `/quic` listeners skipped and `/quic` dials fail closed with `ERR_UNSUPPORTED_TRANSPORT` rather than silently downgrading to TCP | Asserts `node.dial('/ip4/.../quic/...')` returns `ok === false` and `filterDialableMultiaddrs` strips `/quic` | [packages/p2p/src/node.ts:999-1007](file:///d:/Sovra/packages/p2p/src/node.ts#L999-L1007), [transport-interop.test.ts](file:///d:/Sovra/packages/p2p/test/transport-interop.test.ts) |
| **Blind Push Fail-Closed** | Unconfigured `BlindPushRelayServer` refuses mock delivery (`err(...)`); `HttpEndpointPushTransport` transmits only `blindChannelId` & `opaqueWakeupHint` without DIDs | Verified against real ephemeral `node:http` server (`0` DID strings leaked) and fail-closed refusal when unconfigured | [blind-push.ts:122-215](file:///d:/Sovra/packages/messaging/src/blind-push.ts#L122-L215), [blind-push.test.ts](file:///d:/Sovra/packages/messaging/test/blind-push.test.ts) |
| **Architectural & Secret Hygiene** | Core packages isolated from `chain-supervisor` / `:26657` RPC without breaking BN254 scalars (`zk.ts:187`); `dev-server` gates L1 supervisor behind `SOVRA_ENABLE_EXT_CONSENSUS`; `build.gradle` removes `"sovraSecure2026!"`; `client.ts` removes `'did:sovra:user:local'` | Verified in static boundary suite, mobile hardening suite, and governance suite (`hasProtocolPrivilege === false`, `bindGenesisCouncil = false` default, `coreTokenFreeMode`) | [dependency-boundaries.test.ts](file:///d:/Sovra/tests/security/dependency-boundaries.test.ts), [governance.test.ts](file:///d:/Sovra/packages/identity/test/governance.test.ts), [mobile-production-hardening.test.ts](file:///d:/Sovra/apps/sovra-mobile/test/mobile-production-hardening.test.ts) |

---

## 2. Full Security & Core Matrix Test Comparison

| Verification Matrix | Baseline Run (`AUDIT-ONLY`) | Post-Remediation Run (`task-55701` / `task-55676`) |
|---|---|---|
| **TypeScript Workspace `tsc --noEmit`** | `19/19` package configs (`0` errors) | **`23/23` workspace `tsconfig.json` files** (`apps/*`, `nodes/*`, `packages/*`, `services/*`), Exit `0` |
| **Go `SOVRA-EXT-CONSENSUS` (`D:\Sovra\chain`)** | `go test -count=1 ./...` -> Exit `0` (`10` passed, `5` `[no test files]`) | `go test -count=1 ./...` -> Exit `0` (`10` passed, `5` `[no test files]`) |
| **116 Baseline + 4 New Core/Security/Integration Files (`Vitest`)** | `112 passed \| 4 failed (116)`; `739 passed \| 5 failed (744)` | **`120 passed \| 0 failed (120)`; `758 passed \| 0 failed (758)`**, Exit `0`, `124.51s` |
| **Remaining Known Non-Matrix Failures** | HTTP `P0-C` in `governance_p0_remediation.test.ts` (requires dev-server) | `governance_p0_remediation.test.ts` `P0-C` (`8/32`, `ECONNREFUSED 127.0.0.1:3001`) & `phase7-governance-e2ee-adversarial.test.ts` (`2/13` legacy `database-engine` redaction label) remain open when running those extra HTTP/legacy suites |
