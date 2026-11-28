# SOVRA — Storage Integrity & Durability Report

**Scope:** Stage 3 (`P0-03`, `P0-05`) — Proof of Retrievability, Storage Receipts, CID Content Addressing, Blockstore Path Guards, BitSwap Transfer, Replica Repair, and Fault Injection.  
**Date:** 2026-11-26

---

## 1. Remediated Vulnerabilities & Validation Guarantees

1. **Eliminated Non-CID PoR Verification Bypass ([nodes/storage-node/src/verifier.ts:249-258](file:///d:/Sovra/nodes/storage-node/src/verifier.ts#L249-L258)):**
   - Removed the previous `catch { cidDigestValid = challenge.cid.length > 0 && blockData.length > 0; }` bypass.
   - Any malformed or non-multihash CID (`'bafybeihash123'`, `'not-a-valid-cid'`) or empty block buffer now strictly sets `cidDigestValid = false` and fails closed (`isValid: false`).
2. **Remote Signed PoR Challenge/Response Hardening ([verifier.ts:303-342](file:///d:/Sovra/nodes/storage-node/src/verifier.ts#L303-L342) & [nodes/storage-node/src/index.ts:390-405](file:///d:/Sovra/nodes/storage-node/src/index.ts#L390-L405)):**
   - `verifySignedProof()` enforces matching `challengeId` and `cid`, exact `expectedProverPeerId`, bounded response window (`0 <= respondedAt - issuedAt <= maxResponseTimeMs`), genuine `CID.parse(challenge.cid)` digest match against `expectedBlockData`, deterministic challenge sample hash, and Ed25519 verification against the public key extracted from `expectedProverPeerId`.
   - `StorageNodeDaemon` maintains `consumedPorChallengeIds` (verifier side) and `seenInboundPorChallengeIds` (prover side) plus challenger wall-clock timeout enforcement so replayed proofs, future-timestamped proofs, and stale responses are rejected fail-closed.
3. **Storage Receipt Structural & Validity Hardening ([packages/storage/src/replication-policy.ts:69-105](file:///d:/Sovra/packages/storage/src/replication-policy.ts#L69-L105)):**
   - Enforces non-empty `providerPeerId`/`operatorId`, valid `CID.parse(receipt.cid)`, and `receipt.storedAt <= receipt.expiresAt` in addition to Ed25519 signature verification against canonical CBOR payload.
4. **Fail-Fast Blockstore & Daemon Path Validation ([packages/storage/src/blockstore.ts:205-214](file:///d:/Sovra/packages/storage/src/blockstore.ts#L205-L214) & [nodes/storage-node/src/index.ts:59-62](file:///d:/Sovra/nodes/storage-node/src/index.ts#L59-L62)):**
   - Passing an undefined, non-string, or empty path immediately throws a typed `StorageError` in constructors/init rather than crashing asynchronously with `TypeError` during I/O.

---

## 2. Observed Storage Test Verification (`task-55701`)

| Test Suite | Tests Passed | What Was Actually Verified | Scope Boundary |
|---|---|---|---|
| [perceptual-multisig.test.ts](file:///d:/Sovra/nodes/storage-node/test/perceptual-multisig.test.ts) | `6/6` | Genuine CID SHA-256 verification, malformed CID label rejection, bit-flipped data rejection, empty data rejection, perceptual dHash distance, Ed25519 multi-sig quorum | Unit (`UNIT TEST VERIFIED`) |
| [storage-integrity.test.ts](file:///d:/Sovra/nodes/storage-node/test/storage-integrity.test.ts) | `3/3` | Rejected spoofed signer PeerID, future `respondedAt` clock forgery, single-use `challengeId` replay, tampered BitSwap block bytes vs CID, failure-domain diversity pin counting, live `verifyReplicas()` repair across multi-node daemon cluster | Real local OS TCP + FS blockstore (`INTEGRATION VERIFIED`) |
| [ia01-networking-and-storage.test.ts](file:///d:/Sovra/tests/integration/ia01-networking-and-storage.test.ts) (`Sec 5`) | `1/1` (Sec 5) | Signed storage receipt issuance & expiry pruning, failed constructor path guard, remote challenged PoR verification & repair trigger upon peer loss | Real local OS TCP + FS blockstore (`INTEGRATION VERIFIED`) |
| [blockstore.test.ts](file:///d:/Sovra/packages/storage/test/blockstore.test.ts) + [bitswap.test.ts](file:///d:/Sovra/packages/storage/test/bitswap.test.ts) | `9/9` + `7/7` | Persistent CAS `DiskBlockstore` read/write/GC/corruption handling + BitSwap block exchange & wantlist handling | Unit + local P2P (`UNIT/INTEGRATION VERIFIED`) |

Long-term multi-day churn & cross-ASN WAN replication remain `NOT VERIFIED` externally (`Stage 7`).
