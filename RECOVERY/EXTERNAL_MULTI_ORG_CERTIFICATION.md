# SOVRA — External Multi-Organization & WAN Certification Procedure (`Stage 7`)

**Baseline:** Master Engineering Specification v1.0 + Integration Amendment `IA-01` (`Section 4, 5, 8, 9, 10, 27`)  
**Script Runner:** [external-certification-check.ts](file:///d:/Sovra/scripts/external-certification-check.ts)  
**Classification Standard:** Every scenario MUST record one strict status:
- `IMPLEMENTED` — Code path exists on disk with fail-closed validation, but has no isolated unit test for this scenario.
- `UNIT TEST VERIFIED` — Verified in isolation against synthetic/mocked or in-process inputs.
- `INTEGRATION VERIFIED` — Verified across real local sockets, SQLite WAL, filesystem CAS/BitSwap, or multi-OS loopback processes (`127.0.0.1` / `::1`).
- `REAL-WORLD VERIFIED` — Verified externally on >=3 independent administrative organizations, distinct public ASNs, physical carrier CGNAT, and physical hardware.
- `NOT VERIFIED` — Reproducible test not yet executed in the required target environment. **Never report unexecuted external scenarios as passed.**

---

## 1. Required Topology & Independence Constraints (`IA-01 Section 9`)

| Role | Operator Requirement | Public Network Constraints | Required Hardware / ISP |
|---|---|---|---|
| **Org A Seed/Relay** | Independent Entity #1 (not Founder) | Separate Public ASN #1; Dual-Stack IPv4 + IPv6 (`tcp/4001`, `ws/4002`) | Bare-metal/VPS in Region 1 (e.g., Tokyo / AS-A) |
| **Org B Storage/Relay** | Independent Entity #2 (not Founder) | Separate Public ASN #2; Symmetric Storage Disk (`>= 10 GB`) | Independent Server in Region 2 (e.g., Frankfurt / AS-B) |
| **Org C Volunteer Node** | Independent Entity #3 (not Founder) | Separate Public ASN #3; Public IPv4/IPv6 | Community Host in Region 3 (e.g., Toronto / AS-C) |
| **NAT Client Device #1** | Mobile/Consumer behind **Carrier CGNAT** | LTE/5G Carrier NAT (`100.64.0.0/10` behind stateful carrier gateway; NO UPnP / inbound ports) | Physical Android (`apps/sovra-mobile`) or Laptop on Tethering |
| **NAT Client Device #2** | Dual-Stack / Firewalled Home NAT | Restricted Cone / Symmetric Wi-Fi NAT | Physical Laptop / Mobile in Separate Home Network |
| **Founder Kill-Switch Node** | Pre-existing Founder Bootstrap Node | Must run BEFORE shutdown, serve initial PEX + BitSwap pins, then be permanently `SIGKILL`ed + DNS sinkholed | Isolated Host to be permanently powered off |

---

## 2. Step-by-Step Reproducible Certification Procedure

### Phase A — Pre-Coupled Founder Bootstrap & DNS Sinkhole Verification
1. Boot Founder Node with `SOVRA_NO_DNS=false` initially *only* for pre-coupled test, OR boot Org A/B/C with `SOVRA_NO_DNS=true` pointing ONLY to Founder's raw IP multiaddr:
   ```bash
   SOVRA_NO_DNS=true SOVRA_P2P_PORT=4001 SOVRA_HTTP_PORT=8080 SOVRA_PUBLIC_IP=<FOUNDER_PUBLIC_IP> \
     node --experimental-strip-types scripts/volunteer-node.ts --role seed --data-dir /var/lib/sovra-founder
   ```
2. On Org A, Org B, and Org C (on distinct ASNs), boot independent volunteer daemons pointing initially ONLY at Founder IP (`no *.sovra.network DNS`):
   ```bash
   SOVRA_NO_DNS=true SOVRA_PUBLIC_IP=<ORG_PUBLIC_IP> SOVRA_BOOTSTRAP_PEERS="/ip4/<FOUNDER_PUBLIC_IP>/tcp/4001/p2p/<FOUNDER_PEER_ID>" \
     node --experimental-strip-types scripts/volunteer-node.ts --role full --p2p-port 4001 --http-port 8080 --data-dir /var/lib/sovra-org
   ```
3. Verify each Org node executes `/sovra/pex/1.0.0`, populates `<dataDir>/peers.json` with peer multiaddrs across ASN #1/#2/#3, and pins a test CID (`replicationFactor >= 2`) originating from Founder.

### Phase B — Multi-Transport, Dual-Stack IPv4/IPv6 & QUIC Boundary Check
1. Execute probing from Org C against Org A & Org B:
   ```bash
   SOVRA_NO_DNS=true node --experimental-strip-types scripts/external-certification-check.ts \
     --peers "/ip4/<ORG_A_IP4>/tcp/4001/p2p/<ORG_A_PEER_ID>,/ip6/<ORG_A_IP6>/tcp/4001/p2p/<ORG_A_PEER_ID>,/ip4/<ORG_B_IP4>/tcp/4001/ws/p2p/<ORG_B_PEER_ID>"
   ```
2. Confirm in stdout JSON report:
   - IPv4 `tcp+noise_xx+yamux` handshake succeeds and returns signed peer record.
   - IPv6 `tcp+noise_xx+yamux` handshake succeeds across public WAN IPv6.
   - WebSocket `/ws+noise_xx+yamux` dial + ReqResp succeeds.
   - `/quic` multiaddr fails closed explicitly (`ERR_UNSUPPORTED_TRANSPORT` until genuine UDP QUIC is built & enabled).

### Phase C — Carrier CGNAT Hole-Punch / Circuit Relay v2 Failover
1. On **NAT Client Device #1** (LTE/5G CGNAT), verify direct inbound TCP dials to Client #1 fail from Org A (`unreachable behind CGNAT`).
2. Establish outbound `Noise_XX` session from Client #1 to **Org A Relay** and **Org B Relay**, acquire `/p2p-circuit` reservations, and dial **NAT Client Device #2** via Org A Relay.
3. Terminate Org A Relay cleanly (`kill -9` / firewall block) mid-session and measure automatic failover recovery time via Org B Relay + `MultiRelayManager.fetchWithFailover()`.
4. Record raw pcap/socket logs, carrier ASN (`traceroute` / `whois`), reservation expiry timestamps, and failover latency in milliseconds.

### Phase D — Permanent Founder Shutdown (`Section 27`)
1. Power off Founder Host (`SIGKILL` + delete `<founderDataDir>`) AND add `/etc/hosts` or router firewall sinkhole (`0.0.0.0 seed1.sovra.network`, `seed2.sovra.network`, `seed-us-east.sovra.network`).
2. Restart Org B cleanly **with empty `--peers` CLI argument** so Org B must recover solely from its disk `<dataDir>/peers.json`.
3. Boot a brand-new Org D Joiner node referencing ONLY Org B's raw IP multiaddr (or offline scanned QR URI from Org C).
4. Verify:
   - Org D discovers Org A and Org C via `/sovra/pex/1.0.0`.
   - Org D retrieves Founder's original media CID via BitSwap from Org A/Org B and passes `ProofOfRetrievabilityEngine` CID digest verification.
   - Org D publishes a signed `SOVRA-EVT` CBOR social event verified independently by Org A/Org B/Org C without L1 (`chain/` not running, `SOVRA_ENABLE_EXT_CONSENSUS` unset).

### Phase E — Storage Failure, Repair & Network Partition Healing
1. Terminate Org B Storage Node holding one replica of test CID.
2. Trigger replica verification (`verifyReplicas()`) on Org A/Org C -> confirm distinct operator failure-domain check triggers `REPAIR_REPLICA` onto Org C and passes cryptographic `ProofOfRetrievabilityEngine.verifyProof()` without accepting non-CID labels or replayed challenge IDs.
3. Partition Org C from Org A (`iptables -A OUTPUT -d <ORG_A_IP> -j DROP`) for 5 minutes while both append concurrent CRDT / social events into local SQLite WAL.
4. Remove firewall block (`iptables -F`), reconcile deltas across `/sovra/event/1.0.0` / sync, and assert deterministic state convergence with zero inventory/sequence violation.

---

## 3. Evidence Collection & Sign-Off Schema

Every independent operator executing Phases A–E must attach:
1. Operator AS Number, cloud/ISP name, geo-region, and SHA-256 of executed `git rev-parse HEAD`.
2. Raw JSON output of `scripts/external-certification-check.ts --report`.
3. Filtered `peers.json` + packet capture/latency measurements (`ping6`, `stun` mapped addresses, `Circuit Relay v2` failover duration).
4. Explicit honest classification: any skipped physical test (e.g., BLE hardware on Android/iOS, carrier CGNAT on LTE) MUST remain marked **`NOT VERIFIED`**.
