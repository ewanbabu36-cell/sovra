# SOVRA — DHT and P2P Security Remediation Report (Phase 2)

**Report Date:** `2026-11-26T22:28:00+05:30`  
**Git Baseline:** `6c0e705` (with Phase 1 + Phase 2 remediations applied and verified)  
**Overall Phase 2 Gate Status:** **`PARTIAL`** *(All local code defects in `dht.ts`, `discovery.ts`, `node.ts`, `types.ts`, and relay/DCUtR/PEX wire handlers are fixed, typechecked, built, and verified `231 / 231 PASS` across all 32 `@sovra/p2p` suites + `zero-domain-full-parity.test.ts`; cross-ASN Sybil/eclipse behavior against live adversarial internet nodes remains `NOT TESTED`.)*

---

## Finding-by-Finding Audit & Remediation Record

### P2P-P2-01 — Cross-Bucket `/24` IPv4, `/48` IPv6, and `.onion` Sybil Quota Evasion in Kademlia DHT
- **Original Finding & Severity:** `DISC-01` (**High**) — `KademliaBucket.addPeer()` checked `extractSubnetPrefix(primaryAddr)` only within one bucket out of 256 and only against `addresses[0]`, allowing an attacker to bypass `MAX_PEERS_PER_SUBNET = 2` via multi-address loopback prepending or XOR-bucket grinding, and imposed no bound on `.onion` / `.onion3` peers.
- **Exact Source File & Line:** [dht.ts:12-13, 90-143, 274-325](file:///d:/Sovra/packages/p2p/src/dht.ts#L274-L325).
- **Root Cause:** Quota enforcement lived only inside `KademliaBucket` rather than globally across the entire 256-bucket `KademliaDHT` routing table, examined only `addresses[0]`, and returned `null` for `/onion/` / `/onion3/`.
- **Code Change:**
  - Added `MAX_PEER_MULTIADDRS = 16` and `MAX_ONION_PEERS_TOTAL = 8` constants in `dht.ts`.
  - Implemented `extractPeerQuotas()` and `countGlobalPrefixAndOnions(excludePeerId)` in `KademliaDHT` to count all `/24` IPv4 prefixes, `/48` IPv6 prefixes, and `.onion`/`.onion3` presence across **all** advertised `addresses` of every peer in all 256 Kademlia buckets before inserting/updating a peer in `KademliaDHT.addPeer()`.
- **Tests Executed:**
  - `packages/p2p/test/dht-p2p-security-adversarial.test.ts` (Test 1: `blocks multi-address subnet & .onion quota evasion across all Kademlia buckets`)
  - `packages/p2p/test/subnet-diversity.test.ts`
- **Actual Output (`task-57656`):**
  - Loopback-first IPv4 `/24` evasion across diverse PeerIDs capped at strictly `2` peers across all buckets (`acceptedIp4 === 2`).
  - IPv6 `/48` prefix across diverse buckets capped at strictly `2` (`acceptedIp6 === 2`).
  - `.onion3` flooding capped at strictly `MAX_ONION_PEERS_TOTAL` (`8`, rejecting the 9th–14th `.onion3` peers).
  - `subnet-diversity.test.ts`: `2 / 2 PASS`.
- **Remaining Limitation:** Routing-table subnet caps operate at IPv4 `/24`, IPv6 `/48`, and global `.onion` count rather than ASN/BGP prefix lookup or S/Kademlia Proof-of-Work ID generation.
- **Status:** **`PASS`** *(Local routing-table enforcement verified)* / **`NOT TESTED`** *(Multi-ASN WAN attacker testing)*.

### P2P-P2-02 — Unauthenticated `PUT_VALUE`, `ADD_PROVIDER` Impersonation, Replay/Future-Skew, Expiry, and Empty Local Provider Multiaddrs
- **Original Finding & Severity:** `DISC-02` (**Critical**) — `KademliaDHT.handleRpcMessage()` accepted unsigned `PUT_VALUE` records forging `authorPeerId`, accepted `ADD_PROVIDER` records impersonating third-party PeerIDs and `/p2p/<id>` addresses with unbounded `expiresAt`, did not reject expired/replayed/future-skewed timestamps, and `SovraP2PNode` wired `KademliaDHT` without an Ed25519 signer or strict verification.
- **Exact Source File & Line:** [dht.ts:182-227, 423-490, 552-749](file:///d:/Sovra/packages/p2p/src/dht.ts#L552-L749), [types.ts](file:///d:/Sovra/packages/p2p/src/types.ts) (`DHTRecord`), [node.ts:334-388, 1767-1779](file:///d:/Sovra/packages/p2p/src/node.ts#L334-L388).
- **Root Cause:** No cryptographic digest/signature format existed for `DHTRecord` or `ProviderRecord`, `handleRpcMessage()` did not receive or enforce the Noise_XX-authenticated `remotePeerId`, `FIND_VALUE`/`getValue()` did not purge expired records, and `setLocalAddresses()` was not propagated when `requireSignedRecords` was enabled.
- **Code Change:**
  - Added optional `expiresAt?: number` to `DHTRecord` in `packages/p2p/src/types.ts`.
  - Added `coerceUint8Array()`, `buildDhtRecordSignableBytes()` (`SOVRA-DHT-REC-v1`), `buildProviderRecordSignableBytes()` (`SOVRA-DHT-PROV-v1`), `KademliaDhtSecurityOptions` (`requireSignedRecords`, `signDigest`), `verifyRecordCryptographicAuth()`, `verifyProviderCryptographicAuth()`, and `validateProviderAddressesOwnership()` in `packages/p2p/src/dht.ts`.
  - Hardened `KademliaDHT.handleRpcMessage(msg, authenticatedSenderPeerId)` to enforce sender binding, target key equality, `MAX_DHT_FUTURE_SKEW_SECONDS = 300`, expiry rejection & `FIND_VALUE` purge, Ed25519 verification against `extractPublicKeyFromPeerId()`, sequence monotonicity + equal-sequence timestamp replay rejection, provider `/p2p/<id>` ownership verification, and TTL clamping to `DEFAULT_PROVIDER_TTL_SECONDS = 86400`.
  - Updated `SovraP2PNode` in `node.ts` to configure `KademliaDHT` with `{ requireSignedRecords: true, signDigest: digest => this.config.deviceKey.sign(digest) }`, pass authenticated Noise_XX `remotePeerId` into `this.dht.handleRpcMessage()`, and call `this.penalizeBadDhtSender()` (`onInvalidSignature` + delayed `25ms` socket teardown if blacklisted).
- **Tests Executed:**
  - `packages/p2p/test/dht-p2p-security-adversarial.test.ts` (Tests 2 & 3)
  - `packages/p2p/test/dht.test.ts`
- **Actual Output (`task-57656`):**
  - Strict DHT accepted valid Ed25519-signed `PUT_VALUE` & `ADD_PROVIDER` (both unit and live Noise_XX TCP wire) while rejecting: unsigned `PUT_VALUE`, cross-author key mismatch, expired records, equal-seq replay, >300s future skew, unsigned/forged `ADD_PROVIDER`, and `/p2p/<victim>` address hijacking (`dht-p2p-security-adversarial.test.ts`: `3 / 3 PASS`; `dht.test.ts`: `7 / 7 PASS`).
- **Status:** **`PASS`**

### P2P-P2-03 — Relay Forwarding Authorization, PEX Forgery Isolation, and DCUtR Third-Party Dial Redirect
- **Original Finding & Severity:** **High** — `CIRCUIT_RELAY_FORWARD_PROTOCOL` lacked explicit check against `activeCircuitLookup`, `SOVRA_PEX_PROTOCOL` did not fail-fast / isolate peers sending forged `SignedPeerRecord` announcements, `DCUTR_PROTOCOL` `CONNECT` could attempt dialing arbitrary third-party `/p2p/<victim>` addresses in `dcutrMsg.addrs`, and `ingestPeerExchange()` needed bounded multiaddr validation.
- **Exact Source File & Line:** [node.ts:491-547, 590-629, 654-680](file:///d:/Sovra/packages/p2p/src/node.ts#L491-L680), [discovery.ts:420-439](file:///d:/Sovra/packages/p2p/src/discovery.ts#L420-L439).
- **Root Cause:** Relay forward handler did not validate `activeCircuitLookup`, PEX handler swallowed invalid signatures while still returning `{ ok: true }`, and DCUtR handler dialed any `CONNECT` multiaddr without validating `/p2p/<id>` ownership against Noise_XX `remotePeerId`.
- **Code Change:**
  - `CIRCUIT_RELAY_FORWARD_PROTOCOL` in `node.ts`: verifies sender/target blacklist state, `envelope.fromPeerId === senderPeerId`, and `activeCircuitLookup.get(envelope.circuitId)` endpoint authorization.
  - `SOVRA_PEX_PROTOCOL` in `node.ts`: rejects blacklisted senders, calls `this.scoring.onInvalidSignature(remotePeerId)` on bad peer-record signatures, schedules delayed `25ms` socket teardown once blacklisted, and returns `{ ok: false, peers: [] }`.
  - `DCUTR_PROTOCOL` in `node.ts`: ignores blacklisted peers and accepts `CONNECT` addresses **only** if non-circuit `/ip4/` or `/ip6/` with no mismatched `/p2p/<id>` segment (`!p2pMatch || p2pMatch[1] === remotePeerId`).
  - `PeerDiscoveryManager.ingestPeerExchange()` in `discovery.ts`: filters strings `<= 512` chars with supported multiaddr prefix and `/p2p/<peerId>` length `>= 16`.
- **Tests Executed:**
  - `packages/p2p/test/dht-p2p-security-adversarial.test.ts` (Test 3 live Noise_XX mesh)
  - `packages/p2p/test/cgnat-cellular-relay.test.ts`
  - `packages/p2p/test/security-adversarial.test.ts`
  - `packages/p2p/test/scoring.test.ts`
- **Actual Output (`task-57656`):**
  - Forged `PUT_VALUE` blacklisted `evilClient` (`scoring.isBlacklisted === true`).
  - Unauthorized `CIRCUIT_RELAY_FORWARD_PROTOCOL` targeting blacklisted `evilClient` or unknown `circuit-forged-unauthorized` targeting clean `victim` both returned `ok: false`.
  - Forged DCUtR `CONNECT` naming third-party `victim` resulted in `victim.connManager.getConnection(server.peerId) === undefined`.
  - Tampered PEX announcement immediately blacklisted `pexBadPeer` (`isBlacklisted === true`) and returned `ok: false`.
- **Status:** **`PASS`** *(Local adversarial Noise_XX suite verified)*

---

## Phase 2 Regression Results (`task-57656`, `@sovra/p2p` build + `tsc --noEmit` + 33 Test Files)

Command:
`.\pnpm.cmd --filter @sovra/p2p build` -> `.\pnpm.cmd --filter @sovra/p2p run typecheck` -> `vitest run packages/p2p/test tests/security/zero-domain-full-parity.test.ts`

- **`@sovra/p2p` build (`tsc -p tsconfig.json`) & typecheck (`--noEmit`):** Exit **`0`**
- **Test Suites / Files:** **`33 / 33` test files (`105 / 105` describe suites)** — **`231 / 231` tests PASS, `0` failed**:
  - `packages/p2p/test/dht-p2p-security-adversarial.test.ts`: `3 / 3`
  - `packages/p2p/test/dht.test.ts`: `7 / 7`
  - `packages/p2p/test/subnet-diversity.test.ts`: `2 / 2`
  - `packages/p2p/test/security-adversarial.test.ts`: `4 / 4`
  - `packages/p2p/test/scoring.test.ts`: `4 / 4`
  - `packages/p2p/test/cgnat-cellular-relay.test.ts`: `8 / 8`
  - `packages/p2p/test/upnp-socks5-zero-domain.test.ts`: `8 / 8`
  - All remaining 25 suites in `packages/p2p/test/*` (`adversarial-aead-matrix`, `dual-radio-handover`, `noise-vectors`, `transport-independent-p2p`, `transport-interop`, `offline-ble-mesh`, `offline-ble-loss`, etc.): `186 / 186`
  - `tests/security/zero-domain-full-parity.test.ts`: `9 / 9`
