# SOVRA — Decentralized Peer Discovery Audit (AUDIT 3)

**Audit Date:** `2026-11-26T16:45:22+05:30`

---

## Component Status Matrix

| Mechanism | Source Implementation | Empirical Runtime Verification | Verdict |
|---|---|---|---|
| **Kademlia 256-bit XOR Routing & Provider Store** | Real SHA-256 XOR buckets (`k=20`, `alpha=3`, Wire RPC `/sovra/dht/1.0.0`) | Unit & interop tests pass; **cross-bucket `/24` Sybil & unauthenticated `PUT_VALUE`/`ADD_PROVIDER` gaps found** | `PARTIAL` |
| **Signed Peer Exchange (`SOVRA-PEER-BIND-v1`, QR)** | Nonce-checked Ed25519 `SignedPeerRecord` + `sovra://peer-pex/v1` | Verified across `PeerDiscoveryManager` & `/api/peers/announce` | `PASS` |
| **Signed Bootstrap Bundles (`SOVRA-BOOT-BUNDLE-v1`)** | Canonical CBOR + domain tag + multi-operator quorum (`minIndependentOperators`) | Tampered bundle `400` rejected; `2-of-3` / valid quorum imported cleanly | `PASS` |
| **Sybil & Eclipse Attack Resistance** | `PeerScoringEngine` (`-50` blacklist) + per-bucket `MAX_PEERS_PER_SUBNET = 2` | Scoring blacklisted `-50`; **DHT per-bucket subnet limit bypassed across XOR buckets (`[true, true, true]` accepted)**; zero `.onion` quota | `PARTIAL` |
| **Bootstrap Seed Shutdown & Peer Churn Recovery** | Persistent `<dataDir>/peers.json` + P2P PEX gossip across nodes | 4-node drill: `N1` stopped -> `N4` bootstrapped via `N2` & discovered `N3` without `N1` | `PASS` *(Local)* |
| **Clean-Install Zero-Domain Seed Discovery** | `bootstrap-seeds.ts` w/o `/dns` only contains `127.0.0.1` + optional mDNS (`false` default) | `nClean` w/ `enableDnsFallback: false` had `peerBookCount: 0` & no WAN seeds | `FAIL / BLOCKED` *(WAN cold-start)* |

---

## Detailed Findings

### DISC-01: Kademlia DHT Per-Bucket `/24` Cap Bypassed Across Routing Table + Zero `.onion` Sybil Limit
1. **Actual source code evidence:** `KademliaBucket.addPeer` counts peers with matching `extractSubnetPrefix(primaryAddr)` ONLY inside `this.peers` (a single `KademliaBucket` out of 256), excluding `.onion` addresses (`extractSubnetPrefix` returns `null`) and skipping `127.0.0.x` loopback.
2. **Exact file and line references:** [dht.ts:86-130, 184, 197-205](file:///d:/Sovra/packages/p2p/src/dht.ts#L86-L130).
3. **Actual runtime test:** Inserted `3` distinct PeerIDs (`p-s1`, `p-s2`, `p-s3`) all on `/ip4/198.51.100.*` and `3` `/onion3/` PeerIDs into `KademliaDHT('local-peer-1')`.
4. **Expected result:** For genuine Sybil/eclipse hardening, an attacker controlling a single `/24` IPv4 subnet should be bounded globally across the DHT table (`MAX_PEERS_PER_SUBNET = 2`).
5. **Observed result:** `ipv4SameSubnet3PeersAccepted: [true, true, true]` — all `3` peers from `198.51.100.0/24` were accepted because their SHA-256 XOR distances hashed into different buckets! All `3` `/onion3/` peers were also accepted (`onion3PeersAcceptedCount: 3`). (`packages/p2p/test/subnet-diversity.test.ts` `2/2` only checks single-bucket insertion + `ConnectionManager` global subnet cap).
6. **Remaining dependency:** None (pure routing-table fix in TypeScript).
7. **Remediation required:** Enforce global routing-table subnet diversity across all `256` buckets in `KademliaDHT.addPeer()`, add proof-of-work / peer-scoring / operator-diversity bounds for `.onion` peers, and align `ConnectionManager` + `KademliaDHT` quotas.

### DISC-02: DHT `PUT_VALUE` & `ADD_PROVIDER` Accept Unauthenticated/Spoofed Records + Empty Local Provider Multiaddrs
1. **Actual source code evidence:** `KademliaDHT.handleRpcMessage` writes `msg.record` on `PUT_VALUE` without verifying any signature from `msg.record.authorPeerId`, and `ADD_PROVIDER` writes `msg.provider` without verifying ownership or bounding `msg.provider.expiresAt`. Also `KademliaDHT.provide(key)` hardcodes `addresses: []`.
2. **Exact file and line references:** [dht.ts:325-362, 431-455](file:///d:/Sovra/packages/p2p/src/dht.ts#L325-L362).
3. **Actual runtime test:** Invoked `dht.handleRpcMessage()` with `senderPeerId: 'evil-attacker'` forging `authorPeerId: 'victim-author'` on `PUT_VALUE` and forging `peerId: 'impersonated-peer'` + `expiresAt: 9999999999` on `ADD_PROVIDER`.
4. **Expected result:** Unsigned/forged DHT values and third-party provider spoofing with arbitrary TTLs must be rejected.
5. **Observed result:** Both returned `{ success: true }` (`unauthenticatedPutValueAccepted: true`, `unauthenticatedAddProviderAccepted: true`).
6. **Remaining dependency:** Signed DHT record schema upgrade.
7. **Remediation required:** Require Ed25519 signature over `(key, value, sequenceNumber)` matching `authorPeerId` for `PUT_VALUE`, require authenticated `msg.senderPeerId === msg.provider.peerId` with clamped TTL (`<= DEFAULT_PROVIDER_TTL_SECONDS`) for `ADD_PROVIDER`, and pass `this.getAdvertisedAddresses()` into `provide(key)`.

### DISC-03: Clean-Install Zero-Domain Cold Start Has Zero Non-Localhost Seeds When DNS & mDNS Are Off
1. **Actual source code evidence:** `getZeroDomainBootstrapMultiaddrs([], false)` filters `GLOBAL_DEFAULT_SEEDS` with `!s.multiaddr.startsWith('/dns')`, leaving only `/ip4/127.0.0.1/tcp/4001/p2p/...`. `startVolunteerNodeDaemon` defaults `enableDnsFallback = false` and `enableMdns = false`.
2. **Exact file and line references:** [bootstrap-seeds.ts:20-61, 142-153](file:///d:/Sovra/packages/p2p/src/bootstrap-seeds.ts#L20-L61), [volunteer-node.ts:46-51, 109, 115](file:///d:/Sovra/scripts/volunteer-node.ts#L46-L51).
3. **Actual runtime test:** Checked `getZeroDomainBootstrapMultiaddrs([], false)` and booted `nClean = await startVolunteerNodeDaemon({ role: 'relay', dataDir: tmpClean, p2pPort: 0, httpPort: 0 })`.
4. **Expected result:** Without DNS, a new WAN node needs either baked-in volunteer IP/`.onion` seeds (like Bitcoin `chainparamsseeds.h`) or out-of-band QR/bundle input to discover remote peers.
5. **Observed result:** `zeroDomainDefaultSeeds` returned only loopback `/ip4/127.0.0.1/tcp/4001/p2p/...`; `nClean` booted with `peerBookCount: 0`.
6. **Remaining dependency:** Deployed, long-lived community operator IPv4/IPv6/`.onion` seed list + mDNS enabled by default for LAN discovery.
7. **Remediation required:** Publish a multi-operator signed `SignedBootstrapBundle` containing genuine community raw IP / `.onion` multiaddrs (plus enable LAN UDP mDNS by default or opt-out when safe) for clean first-run discovery without DNS.

### DISC-04: Signed Bootstrap Bundles, Peer Exchange, Scoring & Local Seed Shutdown Recovery Work Correctly
1. **Actual source code evidence:** `createSignedBootstrapBundle` / `verifySignedBootstrapBundle` enforce `SOVRA-BOOT-BUNDLE-v1` canonical CBOR signatures, TTL expiry, and independent operator count; `PeerDiscoveryManager` exports/imports peer snapshots (`peers.json`), `SignedPeerRecord`, QR URIs; `PeerScoringEngine.onInvalidSignature` deducts `-50` reaching `blacklistThreshold: -50`.
2. **Exact file and line references:** [bootstrap-bundle.ts:45-147](file:///d:/Sovra/packages/p2p/src/bootstrap-bundle.ts#L45-L147), [discovery.ts:361-485](file:///d:/Sovra/packages/p2p/src/discovery.ts#L361-L485), [scoring.ts:9-79](file:///d:/Sovra/packages/p2p/src/scoring.ts#L9-L79), [bootstrap-node.ts:428-509](file:///d:/Sovra/scripts/bootstrap-node.ts#L428-L509).
3. **Actual runtime test:** 4-node isolated drill (`N1` `12D3KooWLFz2...`, `N2` `12D3KooWGxjY...`, `N3` `12D3KooWNajp...`, `N4` `12D3KooWSGjk...`) + `zero-domain-full-parity.test.ts` Test 2 + `PeerScoringEngine` test.
4. **Expected result:** Nodes reject tampered bundles, transitive PEX discovers peers across hops, and joining/discovery keeps working after initial seed `N1` shuts down permanently.
5. **Observed result:** Tampered bundle returned `400`; `scoring.onInvalidSignature` yielded `{ scoreAfterInvalidSig: -50, isBlacklisted: true }`; after `await n1.stop()`, fresh `N4` imported `N2`'s bundle (`n4BootstrappedWithoutN1Ok: true`) and discovered both `N2` (`true`) and `N3` (`true`), shutting down cleanly in `60ms`.
6. **Remaining dependency:** Independent cross-ASN WAN verification (`ORG-A/B/C`) under real packet loss and asymmetric partitions (`NOT TESTED`).
7. **Remediation required:** Execute multi-org cross-ASN partition/churn tests once external community nodes are provisioned.
