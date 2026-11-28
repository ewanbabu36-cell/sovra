# RFC SOVRA-NET v1.0
## Sovra Peer Networking & Zero-Domain Discovery Protocol (`SOVRA-NET`)

**Protocol Identifier:** `SOVRA-NET`  
**Namespace:** `/sovra/net/1.0.0`  
**Version:** `1.0`

---

## 1. Node Roles (Capabilities, Not Central Assignments)

| Role | Capabilities |
|---|---|
| `full` | Routing, event validation, replication, local node DB |
| `storage` | Content-addressed persistence, BitSwap delivery, PoR proofs |
| `relay` | Circuit Relay v2 blinded packet forwarding (`/hop` + `/stop`) |
| `community` | Community indexing, optional local rendezvous, moderation feeds |
| `light` | Resource-bounded header/digest sync without heavy storage |
| `browser` | Client-side PWA/Web-compatible transports & signed requests |

---

## 2. Node Identity Object

Every node advertises a signed record containing:
- `peer_id` & `node_public_key` (Ed25519)
- `protocol_versions` (supported `SOVRA-CORE`, `SOVRA-DATA`, `SOVRA-APP`, `SOVRA-GOV`, `SOVRA-OPS`)
- `supported_transports` (`tcp+noise_xx+yamux`, `circuit-relay-v2`, `mdns-udp`, optional `quic`/`ws`)
- `capabilities` / `role` & `service_advertisements`
- `reachable_addresses` (direct `/ip4/`, `/ip6/`, `.onion`, relay multiaddrs)

---

## 3. Six Independent Peer Discovery Mechanisms

1. **Kademlia DHT Discovery:** XOR routing with IPv4 `/24` & IPv6 `/48` bucket subnet diversity.
2. **Peer Exchange (PEX):** `/sovra/pex/1.0.0` signed `SignedPeerRecord` exchanges with nonce replay defense.
3. **Signed Bootstrap Bundles:** `network_id`, expiry, multi-operator independent peer list, and operator Ed25519 signatures (rejects single-operator bundles in strict production mode).
4. **QR-Code Invitations:** `sovra://peer-pex/v1?p=...` carrying verified `SignedPeerRecord`.
5. **Local Network Discovery:** UDP multicast LAN mDNS (`sovra-mdns-v1`) + native mobile BLE/Wi-Fi Direct adapters.
6. **Optional Community Rendezvous:** Purely voluntary community HTTP/WS/libp2p rendezvous endpoints (`SOVRA_NO_DNS=true` disables all default domain assumptions).

---

## 4. DHT Protection & NAT Traversal Sequence

- **DHT Hardening:** `/24` & `/48` subnet diversity, routing-table verification, Ed25519 signed records, record TTL/expiry, per-peer rate limiting, query timeouts, peer scoring/blacklisting, Eclipse detection, multi-path bootstrap.
- **NAT Traversal Order:**
  1. Direct TCP (`Noise_XX` / TLS) connection
  2. Hole punching (assisted by RFC 5389 UDP STUN probing + peer coordination; **STUN alone never guarantees connectivity**)
  3. Community Circuit Relay v2 forwarding (mandatory fallback for symmetric NAT / strict CGNAT)
  4. Alternative local/transport paths
  5. Store-and-forward offline queues for async messaging and signed events

Relays only forward authenticated streams and ciphertext envelopes; they CANNOT decrypt E2EE payloads.
