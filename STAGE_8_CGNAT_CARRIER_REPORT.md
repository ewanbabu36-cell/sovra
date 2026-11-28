# Stage 8 — CGNAT & Carrier Cellular Network Report

**Phase:** Stage 8 — Independent External Field Certification  
**Timestamp:** `2026-11-26T12:58:04+05:30`  
**Overall Section Status:** **`NOT TESTED`** *(No multi-carrier LTE/5G SIM testbench or second peer behind symmetric carrier CGNAT available; single-uplink Wi-Fi NAT observation documented separately as `PARTIAL`)*

---

## 1. Honest Observations & Resource Limits

- This workstation is connected over a single Wi-Fi uplink (`10.155.170.224` -> reflexive `223.238.130.171`).
- No separate independent LTE/5G carrier SIM connections (`Carrier A` / `Carrier B`) or second remote peer behind symmetric NAT (`100.64.0.0/10`) are available in this environment.
- Per Stage 8 Section 3 & Rule 1 (`"Do not simulate external organizations, ASNs, carrier networks or physical devices"`), localhost `cgnat-cellular-relay.test.ts` and `founder-disappears-and-adversarial.test.ts` STUN/relay checks **cannot** be reported as live carrier CGNAT certification.

---

## 2. Finding Matrix

| Finding ID | Detailed Verification Record |
|---|---|
| **S8-CGNAT-01** | **Requirement ID:** `S8-CGNAT-01` — Characterize current uplink NAT behavior via real external RFC 5389 STUN servers<br>**Test methodology:** Sequential UDP STUN Binding Requests from single bound local port (`54356`) to `stun.l.google.com:19302`, `stun1.l.google.com:19302`, `stun.cloudflare.com:3478` (`stun-probe.mjs`)<br>**Environment:** Wi-Fi IPv4 `10.155.170.224` (`Node v24.22.0`)<br>**Actual execution evidence:** Observed identical reflexive mapping `223.238.130.171:6562` across all 3 servers (indicating Endpoint-Independent Mapping on this uplink, NOT symmetric port randomization); meanwhile concurrent sockets opened separate reflexive ports (`23853`, `23856`, `23857`) via `probeStunUdp()`<br>**Result:** **`PARTIAL`** *(Single non-symmetric uplink measured; symmetric/restrictive multi-carrier CGNAT NOT exercised)*<br>**Evidence location:** `scratch/stun-probe.mjs` & `probeStunUdp` output<br>**Remaining limitations:** Does NOT cover real mobile carrier CGNAT port randomization, hairpinning restrictions, or carrier idle NAT table timeouts (`30–120s`). |
| **S8-CGNAT-02** | **Requirement ID:** `S8-CGNAT-02` — Symmetric & restrictive LTE/5G carrier CGNAT outbound peer establishment & `Circuit Relay v2` failover between live cellular SIMs<br>**Test methodology:** Live carrier cellular test on separate SIMs behind CGNAT dialing public `ORG-A`/`ORG-B` relays and surviving relay termination per [EXTERNAL_MULTI_ORG_CERTIFICATION.md#L54-L58](file:///d:/Sovra/RECOVERY/EXTERNAL_MULTI_ORG_CERTIFICATION.md#L54-L58)<br>**Environment:** Requires >= 2 real cellular SIM uplinks on separate carriers + external relays (unavailable here)<br>**Actual execution evidence:** `0` carrier SIM tests executed; local simulation tests exist in [cgnat-cellular-relay.test.ts](file:///d:/Sovra/packages/p2p/test/cgnat-cellular-relay.test.ts) only<br>**Result:** **`NOT TESTED`**<br>**Evidence location:** [cgnat-cellular-relay.test.ts](file:///d:/Sovra/packages/p2p/test/cgnat-cellular-relay.test.ts) *(lab only)*<br>**Remaining limitations:** Real cellular CGNAT UDP/TCP timeout pruning and symmetric NAT filtering unsupported until external hardware/SIM run. |
| **S8-CGNAT-03** | **Requirement ID:** `S8-CGNAT-03` — Intermittent connectivity & peer recovery after cellular-to-Wi-Fi IP change<br>**Test methodology:** Live interface switch / carrier IP change while maintaining or recovering active P2P session & `MultiRelayManager` health probe<br>**Environment:** Unavailable without physical SIM/multi-homed mobile test device<br>**Actual execution evidence:** Only token-based local `migrateConnection()` unit logic tested in [light-client.test.ts](file:///d:/Sovra/packages/p2p/test/light-client.test.ts)<br>**Result:** **`NOT TESTED`**<br>**Evidence location:** [light-client.ts:299-319](file:///d:/Sovra/packages/p2p/src/light-client.ts#L299-L319)<br>**Remaining limitations:** Live socket migration upon physical NIC/IP change (especially without UDP QUIC) untested on cellular radios. |
