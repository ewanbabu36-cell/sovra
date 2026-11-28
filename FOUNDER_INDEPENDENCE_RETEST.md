# SOVRA — Founder-Independence Retest Report (`Section 27` & `P0-04`)

**Program Baseline:** [FOUNDER_INDEPENDENCE_EVIDENCE.md](file:///d:/Sovra/FOUNDER_INDEPENDENCE_EVIDENCE.md) & [P0_BLOCKERS.md#L45](file:///d:/Sovra/P0_BLOCKERS.md#L45)  
**Date:** 2026-11-26

---

## 1. Remediations Applied for Founder Independence

1. **Removed Unprompted Eager L1 Supervisor Startup ([scripts/dev-server.ts:10450-10464](file:///d:/Sovra/scripts/dev-server.ts#L10450-L10464)):**
   - Gated `l1ChainSupervisor.start()` strictly behind `process.env.SOVRA_ENABLE_EXT_CONSENSUS === 'true'`, logging `[SOVRA-CORE] Operating without eager Go L1 supervisor` by default so web/HTTP dev gateway operation no longer implicitly depends on launching `SOVRA-EXT-CONSENSUS`.
2. **Real PEX-to-Disk Persistence in Community Daemons ([scripts/bootstrap-node.ts:260-272](file:///d:/Sovra/scripts/bootstrap-node.ts#L260-L272) & [packages/p2p/src/discovery.ts:306,502](file:///d:/Sovra/packages/p2p/src/discovery.ts#L306)):**
   - Fixed gap where `/sovra/pex/1.0.0`, mDNS, and QR discoveries updated only in-memory `PeerDiscoveryManager` state without persisting to `<dataDir>/peers.json`. Wired `p2pNode.discovery.onPeerDiscovered` -> `upsertPeerBook` so restarting community nodes recover peers from disk without hardcoded founder bootstrap flags.
3. **Zero-Domain Default on Mobile Client ([apps/sovra-mobile/src/main.tsx](file:///d:/Sovra/apps/sovra-mobile/src/main.tsx) & [multi-relay-manager.ts:140,190](file:///d:/Sovra/apps/sovra-mobile/src/services/multi-relay-manager.ts#L140)):**
   - Defaulted `MultiRelayManager.zeroDomainOnly = true` (unless `SOVRA_ALLOW_DNS === 'true'`) and enforced `multiRelayManager.setZeroDomainOnly(true)` inside mobile boot.
4. **Governance Authority Isolation ([packages/identity/src/governance/](file:///d:/Sovra/packages/identity/src/governance/index.ts)):**
   - Changed `MultiPartyApprovalEngine` default `bindGenesisCouncil` to `false`, enforced `hasProtocolPrivilege: false` + `assertZeroProtocolPrivilege` on `FounderIdentityRegistry`, and isolated `GENESIS_SECURITY_COUNCIL` / `FounderIdentityRegistry` / `GovernanceVotingEngine` into explicit [ext-consensus.ts](file:///d:/Sovra/packages/identity/src/governance/ext-consensus.ts).
5. **Removed Client Fallback Identity & Loopback Pin ([apps/sovra-app/src/client.ts:128-145](file:///d:/Sovra/apps/sovra-app/src/client.ts#L128-L145)):**
   - Replaced `'did:sovra:user:local'` & hardcoded `'/ip4/127.0.0.1/tcp/4001/p2p-circuit'` default with dynamic `SovraIdentityKey.generate().did` and `config.preferredRelayMultiaddrs ?? []`.

---

## 2. Multi-Process Pre-Coupled Founder Disappearance Retest ([founder-independence-multiprocess.test.ts](file:///d:/Sovra/tests/integration/founder-independence-multiprocess.test.ts))

Unlike [master-spec-v1-certification.test.ts](file:///d:/Sovra/tests/integration/master-spec-v1-certification.test.ts) where the founder node had zero pre-shutdown coupling, the new Stage 4 integration suite spawns **four separate Node.js OS child processes** (`child_process.spawn` with `SOVRA_NO_DNS='true'`):

1. **Process 1 (`founder`):** Starts `seed` daemon (`enableStorage: true`, dynamic TCP & HTTP ports).
2. **Processes 2 & 3 (`coopA`, `coopB`):** Boot with `--bootstrap` pointed **exclusively** at `founder.ready.multiaddr` (`coopA` does not initially know `coopB`'s address). Both exchange signed peer records via `/sovra/pex/1.0.0` through `founder` and persist peers to `<dataDir>/peers.json`. Founder pins and replicates content CID (`replicationFactor = 2`) via BitSwap onto `coopA` before disappearing.
3. **Permanent Founder Destruction:** Parent issues `SIGKILL` to `founder.proc`, verifies exit, deletes `founderDir` from disk (`rmSync`), and confirms `fetch(`${founder.ready.httpUrl}/api/seeds`)` fails.
4. **Zero-Arg Community Restart:** Cleanly stops `coopB`, spawns fresh `coopB` process from `coopBDir` with **empty** `bootstrapPeers = []`, confirms `peers.json` recovered `coopA.peerId`, and dials `coopA`.
5. **Process 4 (`joiner`):** Fresh zero-state OS process dials surviving `coopB` ONLY, learns `coopA` over `/sovra/pex/1.0.0`, retrieves founder's original content CID over BitSwap from `coopA`, and publishes a signed `SOVRA-EVT` CBOR event verified by `coopA`.

**Observed Result (`task-55701`):** `1 passed (1)` in **`4,473ms`** (`Exit status: 0`), alongside [founder-disappears-and-adversarial.test.ts](file:///d:/Sovra/tests/integration/founder-disappears-and-adversarial.test.ts) (`4/4` passed in `2,247ms`).

---

## 3. Updated Separation Table & Remaining External Boundary

| Asset Category | Local Multi-Process / Unit Evidence | External Cross-Org Evidence |
|---|---|---|
| Bootstrap & PEX Persistence (`peers.json` + `/sovra/pex/1.0.0`) | **`INTEGRATION VERIFIED`** across 4 OS processes | **`NOT VERIFIED`** across `>= 3` external ASNs |
| Storage Survival & BitSwap Retrieval Post-Founder `SIGKILL` | **`INTEGRATION VERIFIED`** (`SIGKILL` + `rmSync(founderDir)`) | **`NOT VERIFIED`** across geo-separated external storage operators |
| DNS Removal (`SOVRA_NO_DNS=true` default on mobile) | **`INTEGRATION VERIFIED`** locally | **`NOT VERIFIED`** under ISP/OS DNS sinkhole of `*.sovra.network` |
| Go L1 Decoupling (`SOVRA-EXT-CONSENSUS`) | **`INTEGRATION VERIFIED`** (`dev-server` lazy flag + boundary suite + `10/10` Go tests) | External validator independence drill **`NOT VERIFIED`** |
