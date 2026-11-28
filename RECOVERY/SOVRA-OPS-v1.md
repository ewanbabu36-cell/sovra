# SOVRA Operations, Recovery & Section 27 Certification Runbook (`SOVRA-OPS v1.0`)

**Specification:** `SOVRA-OPS` (`v1.0`)

---

## 1. Failure Recovery Matrix

1. **Founder Infrastructure Shutdown:** Surviving nodes load persisted SQLite/peers books, signed multi-operator bootstrap bundles, LAN mDNS, QR invites, and P2P PEX (`/sovra/pex/1.0.0`). Zero central registration or DNS lookups needed.
2. **Bootstrap / Relay Node Failure:** `MultiRelayManager` & `ConnectionManager` trigger exponential-backoff reconnect and failover across remaining community relays and direct connections.
3. **Storage Node Loss:** `ReplicaVerificationEngine` detects failure-domain deficits (distinguishing distinct operators/subnets) and pushes missing DAG chunks via BitSwap (`REPAIR_REPLICA`).
4. **Network Partition:** Nodes record operations into durable outbox / SQLite WAL tables and deterministically merge CRDTs (`OR-Set`, `PN-Counter`, `RGA`, `OR-Map`) while enforcing strict state machine invariants for commerce orders upon reconnect.
5. **Compromised Device:** User broadcasts signed `device.revoke` (`SOVRA-EVT`), preserving `sovra1...` root identity while rejecting subsequent actions signed by the compromised device key.

---

## 2. Section 22.1 Performance Targets (Verified in Benchmarks)

- Local `SOVRA-ID` creation: target `< 2,000 ms`
- Local `SOVRA-EVT` CBOR + Ed25519 verification: target `< 100 ms`
- Reachable P2P TCP + `Noise_XX` peer connection: target `< 10,000 ms`
- Small event p95 mesh propagation: target `< 10,000 ms`
- Local offline startup & SQLite read availability: immediate (`0` network calls)

---

## 3. Section 27 — 12-Step Ultimate Founder-Disappears Certification Procedure
Executed automatically in [master-spec-v1-certification.test.ts](file:///d:/Sovra/tests/integration/master-spec-v1-certification.test.ts).
