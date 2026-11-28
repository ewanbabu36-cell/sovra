# SOVRA — P0 Certification Blockers

Zero P0 blocker below may be marked closed via loopback simulation. Every finding is grounded directly in observed code paths and test output.

---

### P0-01: Zero Multi-Organization / Cross-ISP WAN Certification
- **Severity:** **P0 — Critical Blocker**
- **File Path & Line References:** [tests/integration/master-spec-v1-certification.test.ts:69-175](file:///d:/Sovra/tests/integration/master-spec-v1-certification.test.ts#L69-L175), [tests/integration/ia01-networking-and-storage.test.ts:53-188](file:///d:/Sovra/tests/integration/ia01-networking-and-storage.test.ts#L53-L188)
- **Actual Code Evidence:** All nodes bind `/ip4/127.0.0.1/tcp/0` (or `/ip6/::1/tcp/0` / CGNAT loopback `/ip4/100.64.9.10/tcp/0`) inside one Node process, and `operatorId` / `as2516-jp` strings in `master-spec-v1-certification.test.ts:122-147` are synthetic labels rather than distinct autonomous systems.
- **Expected Spec Requirement:** `IA-01 Section 9` & `Section 4`: at least `3` independently administered organizations, multiple geographical locations, separate network providers, and public WAN testing.
- **Reproduction Steps:** Inspect `listenAddresses` in `tests/integration/master-spec-v1-certification.test.ts` and `ia01-networking-and-storage.test.ts`; run Vitest from `D:\Sovra` without WAN peers.
- **Impact:** Localhost tests cannot verify carrier NAT firewalls, asymmetric routing, real Internet jitter, or cross-ISP discovery without founder seeds.
- **Recommended Minimal Fix:** Deploy >= 3 independent volunteer operator nodes across distinct public ASNs/continents, record topology/versions, and execute Section 9 join/failover tests externally.
- **Required Regression Test:** External 3-organization public WAN interoperability & failover verification log (`REAL_WORLD_TEST_MATRIX.md`).

---

### P0-02: UDP / QUIC Transport Protocol Not Implemented
- **Severity:** **P0 — Spec Compliance Blocker**
- **File Path & Line References:** [packages/p2p/src/bootstrap-seeds.ts:106-111](file:///d:/Sovra/packages/p2p/src/bootstrap-seeds.ts#L106-L111), [packages/p2p/src/chameleon.ts:26-70](file:///d:/Sovra/packages/p2p/src/chameleon.ts#L26-L70), [packages/p2p/src/light-client.ts:54-55,296-298](file:///d:/Sovra/packages/p2p/src/light-client.ts#L54-L55), [packages/p2p/src/transport.ts:1-30](file:///d:/Sovra/packages/p2p/src/transport.ts#L1-L30)
- **Actual Code Evidence:** `transport.ts` imports `node:net` TCP exclusively. Search across `packages/p2p/src/*.ts` shows `quic` exists ONLY in multiaddr scoring (`-2` bonus in `bootstrap-seeds.ts:106`), heuristic naming in `chameleon.ts`, and type annotations/comments (`transport?: 'quic' | ...` in `light-client.ts:55`, `connectionIdHex` at line `54`, connection migration comment at lines `296-298`). `dgram` is used only for UDP STUN (`nat.ts:632,677`) and mDNS (`discovery.ts:66`).
- **Expected Spec Requirement:** `SOVRA-NET` (Master Spec Section 6 & RFC `SOVRA-NET-v1.md`) specifies QUIC alongside Noise/TLS and Yamux; documentation and `chameleon.ts` imply QUIC selection/migration.
- **Reproduction Steps:** Search `packages/p2p/src/` for `quic` and inspect `transport.ts`.
- **Impact:** True UDP hole punching, 0-RTT connection migration across Wi-Fi/5G switches, and carrier QUIC fallback cannot occur; all connections rely on TCP or Circuit Relay over TCP.
- **Recommended Minimal Fix:** Implement genuine QUIC transport in `packages/p2p/src/` (or remove QUIC claims from runtime heuristics and RFC baseline via an explicit amendment until implemented).
- **Required Regression Test:** Real dual-node QUIC handshake, stream multiplexing, and live UDP IP-change connection migration test.

---

### P0-03: IA-01 Networking & Storage Acceptance Test Suite Currently Failing (`2/2` Failed)
- **Severity:** **P0 — Verification & API Contract Blocker**
- **File Path & Line References:** [packages/p2p/src/identity.ts:269-273](file:///d:/Sovra/packages/p2p/src/identity.ts#L269-L273), [nodes/storage-node/src/index.ts:56-79](file:///d:/Sovra/nodes/storage-node/src/index.ts#L56-L79), [packages/storage/src/blockstore.ts:200-208](file:///d:/Sovra/packages/storage/src/blockstore.ts#L200-L208), [tests/integration/ia01-networking-and-storage.test.ts:107,200-208](file:///d:/Sovra/tests/integration/ia01-networking-and-storage.test.ts#L107)
- **Actual Code Evidence:**
  - `verifySignedPeerRecord()` returns `boolean` (`identity.ts:273`), whereas `decodeAndVerifyPeerQrUri()` returns `Result`; `ia01-networking-and-storage.test.ts:107` read `.ok` -> `expected undefined to be false`.
  - `DiskBlockstore` constructor accepts `rootDir: string` without validating non-empty string, throwing `TypeError: The "path" argument must be of type string... Received undefined` later at `blockstore.ts:207` when `StorageNodeDaemon` is constructed incorrectly (`ia01-networking-and-storage.test.ts:200`).
- **Expected Spec Requirement:** Consistent Result/error APIs, fail-fast config validation in storage daemons, and passing Section 4 & 5 acceptance suites (`IA-01 Sec 4, 5`).
- **Reproduction Steps:** Run `vitest run tests/integration/ia01-networking-and-storage.test.ts` from `D:\Sovra`. Exit code `1` (`2/2` failed).
- **Impact:** Expired peer record rejection, multi-relay failover, storage receipts, provider expiration pruning, and replica repair in IA-01 Sec 4–5 remain **unverified by a passing suite**.
- **Recommended Minimal Fix:** Enforce non-empty `storagePath` validation in `StorageNodeDaemon` & `DiskBlockstore` constructors, align test/caller invocations with `StorageNodeConfig` + boolean `verifySignedPeerRecord` return (or unify `Result` APIs), and re-verify cleanly.
- **Required Regression Test:** `tests/integration/ia01-networking-and-storage.test.ts` passing `2/2` without relaxing assertions.

---

### P0-04: Section 27 Founder-Disappearance Certification Suite Does Not Prove Pre-Existing Founder Dependency Elimination
- **Severity:** **P0 — Founder-Independence Verification Gap**
- **File Path & Line References:** [tests/integration/master-spec-v1-certification.test.ts:75-175](file:///d:/Sovra/tests/integration/master-spec-v1-certification.test.ts#L75-L175), [packages/p2p/src/bootstrap-seeds.ts:20-86](file:///d:/Sovra/packages/p2p/src/bootstrap-seeds.ts#L20-L86), [scripts/dev-server.ts:10451](file:///d:/Sovra/scripts/dev-server.ts#L10451)
- **Actual Code Evidence:** In `master-spec-v1-certification.test.ts:88-170`, `founderNode` is created, never dialed by peers, holds zero unique pins, serves no bootstrap/update traffic, and is stopped at line 169 before `joinerNode` connects to `communityB`. Meanwhile defaults in `bootstrap-seeds.ts` embed `*.sovra.network` DNS names and `dev-server.ts:10451` still launches `l1ChainSupervisor.start()` (`26657`).
- **Expected Spec Requirement:** Master Spec Section 27 (12-step experiment) & IA-01 Section 9–11: network nodes initially relying on real bootstrap/storage/relay paths survive *after* shutting down founder machines, DNS, bootstrap, relays, and update mirrors simultaneously in a real multi-operator environment.
- **Reproduction Steps:** Inspect `tests/integration/master-spec-v1-certification.test.ts:88-170` and `packages/p2p/src/bootstrap-seeds.ts:20-86`.
- **Impact:** Creating an unused node and calling `.stop()` risks false confidence in founder removal while default non-env-overridden client paths still reference `*.sovra.network` and local L1 supervisor startup.
- **Recommended Minimal Fix:** Wire realistic pre-shutdown state where clients initially bootstrap & store through a founder node + community peers, terminate founder processes AND block `.sovra.network` resolution AND test recovery without `dev-server` or `chain-supervisor` running; remove `.sovra.network` defaults from production default seed lists.
- **Required Regression Test:** Realistic pre-coupled founder teardown integration test + external 3-org test.

---

### P0-05: Proof-of-Retrievability Bypass Fallback for Non-CID Labels
- **Severity:** **P0 — Storage Integrity Defect**
- **File Path & Line References:** [nodes/storage-node/src/verifier.ts:249-257](file:///d:/Sovra/nodes/storage-node/src/verifier.ts#L249-L257)
- **Actual Code Evidence:**
  ```ts
  try {
    const parsedCid = CID.parse(challenge.cid);
    const actualDigest = parsedCid.multihashType === 'blake3' ? blake3Hash(blockData) : sha256(blockData);
    cidDigestValid = constantTimeEquals(actualDigest, parsedCid.digest);
  } catch {
    // Non-multihash test labels pass structural compatibility while real CIDs undergo strict hash check
    cidDigestValid = challenge.cid.length > 0 && blockData.length > 0;
  }
  ```
- **Expected Spec Requirement:** `RFC SOVRA-STORE v1.0` Section 3 & `IA-01 Section 5`: *"Every retrieval must verify: 1. Content identifier..."*; invalid CIDs must fail closed.
- **Reproduction Steps:** Pass `challenge = { challengeId: 'c1', cid: 'not-a-valid-cid', blockOffset: 0, randomNonceHex: 'aa', issuedAt: Date.now() }` and arbitrary non-empty `blockData` into `ProofOfRetrievabilityEngine.verifyProof(challenge, blockData)` -> returns `isValid: true`.
- **Impact:** A malicious challenger or buggy caller using non-multihash identifiers bypasses content-address integrity checks completely.
- **Recommended Minimal Fix:** Remove the fallback inside `catch {}` and return `cidDigestValid = false` whenever `CID.parse(challenge.cid)` throws.
- **Required Regression Test:** Assert `ProofOfRetrievabilityEngine.verifyProof` returns `isValid: false` on malformed/synthetic CID strings.
