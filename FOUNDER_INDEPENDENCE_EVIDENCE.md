# SOVRA — Founder-Independence Evidence & Gap Forensic Review

---

## 1. Go Blockchain (`chain/`) Isolation Audit (`SOVRA-EXT-CONSENSUS`)
- **Packages & Node Daemons (`@sovra/*`, `nodes/*`, `apps/*`):** Source scan (`Select-String -CaseSensitive`) verified zero production code imports of `chain/`, `chain-supervisor.ts`, `sovrad`, `cometbft`, or `wallet.routes.ts`. (One automated test regex `/26657/` collided falsely with decimal string `'...26657522...'` inside BN254 constant in [packages/crypto/src/zk.ts:187](file:///d:/Sovra/packages/crypto/src/zk.ts#L187)).
- **Remaining Host Coupling in `scripts/`:**
  - [scripts/dev-server.ts:126,10451](file:///d:/Sovra/scripts/dev-server.ts#L10451) imports `l1ChainSupervisor` and calls `l1ChainSupervisor.start()` automatically (`http://127.0.0.1:26657`), binding the legacy HTTP/web gateway startup path to `SOVRA-EXT-CONSENSUS` startup even though pure P2P nodes (`volunteer-node.ts`, `full-node`) do not need it.
  - [packages/identity/src/governance/multi-party-approval.ts:54-56](file:///d:/Sovra/packages/identity/src/governance/multi-party-approval.ts#L54-L56) still hardcodes `GENESIS_SECURITY_COUNCIL` keys tied to CometBFT terminology.

---

## 2. Section 27 Founder Disappearance Test Audit
Inspected [tests/integration/master-spec-v1-certification.test.ts:75-185](file:///d:/Sovra/tests/integration/master-spec-v1-certification.test.ts#L75-L185) and [tests/integration/founder-disappears-and-adversarial.test.ts](file:///d:/Sovra/tests/integration/founder-disappears-and-adversarial.test.ts):

| Founder Asset Category | Simulated in Local Tests? | Actually Exercised Pre-Shutdown? | Independently Tested Across Real Operators? |
|---|---|---|---|
| **Bootstrap Infrastructure** | Partial (`founderNode` started & stopped; `.sovra.network` NOT queried in `SOVRA_NO_DNS=true` mode) | **NO** in `master-spec-v1-certification.test.ts` (peers used `communityA/B/C` bundle directly without ever dialing `founderNode`); **YES** in `founder-disappears-and-adversarial.test.ts` (volunteer node PEX/peers.json failover) | **NO** — `GLOBAL_DEFAULT_SEEDS` (`*.sovra.network`) still exist in [bootstrap-seeds.ts:20-86](file:///d:/Sovra/packages/p2p/src/bootstrap-seeds.ts#L20-L86); zero external multi-org test run. |
| **Relay Infrastructure** | **YES** (`relay1` stopped or relay killed -> client fails over locally) | Partial (`founder-disappears-and-adversarial.test.ts` tested relay data forwarding; `ia01` Sec 4 multi-relay test failed earlier at line 107 before reaching failover lines!) | **NO** — zero cross-ISP relay tests. |
| **Storage Infrastructure** | **YES** (`creator` stopped -> surviving seeder serves DAG blocks via BitSwap) | Partial (`founder-disappears` passed locally; `ia01` Sec 5 failed at `DiskBlockstore.init`) | **NO** — zero multi-organization pinning endurance tests. |
| **DNS / Domain Infrastructure** | Yes (`SOVRA_NO_DNS=true` env flag tested locally) | Only when `SOVRA_NO_DNS=true` explicitly set; Capacitor iOS uses `app.sovra.network` ID & mobile STUN uses Google/Cloudflare hostnames | **NO** — real OS DNS sinkhole / ISP block scenario untested externally. |
| **Release & Update Infrastructure** | Unit library only (`verifySignedSoftwareRelease`, `verifyIndependentUpdateMirrors`) | **NO** end-to-end auto-update daemon execution across nodes | **NO** — unsigned release pipelines & non-reproducible external builds. |

---

## 3. Honest Assessment
The repository possesses clean standalone cryptographic primitives, CBOR event serialization, Part K SQLite persistence, and working local P2P TCP/`Noise_XX`/BitSwap daemons that operate without Go `chain/` or tokens. However, **founder independence is currently proven only in local single-host multi-process tests**, while default client shells (`apps/sovra-mobile/src/main.tsx`), default seeds (`*.sovra.network`), third-party STUN/DHT seeds, Android Gradle config, and zero multi-organization WAN testing prevent claiming live Founder-Independence Certification (`NOT CERTIFIED`).
