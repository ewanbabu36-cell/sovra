# SOVRA Standalone Node Operations & Administration Guide

**Document Version:** 1.0.0  
**Target Nodes:** `nodes/full-node`, `nodes/relay-node`, `nodes/community-node`  
**Status:** Approved & Verified

---

## 1. Node Types & Operational Roles

| Node Type          | Package                | Key Functions                                                              | Recommended Hardware           |
| :----------------- | :--------------------- | :------------------------------------------------------------------------- | :----------------------------- |
| **Full Node**      | `nodes/full-node`      | Routing, DHT storage, GossipSub mesh participation, protocol event caching | 2 vCPU, 4GB RAM, 50GB SSD      |
| **Relay Node**     | `nodes/relay-node`     | Circuit Relay v2 proxying, NAT traversal assistance, high bandwidth        | 2 vCPU, 2GB RAM, 1Gbps network |
| **Community Node** | `nodes/community-node` | Community topic index, local federation, creator content pinning           | 4 vCPU, 8GB RAM, 200GB SSD     |

---

## 2. Bootstrapping Strategy (Zero Single-Point-of-Failure)

To guarantee network resilience, production nodes must NEVER hardcode a single bootstrap server. Configure independent multi-entity seeds in `sovra-node.json`:

```json
{
  "bootstrap": {
    "bootstrapNodes": [
      "/dns4/seed-us-east.sovra.community/tcp/4001/p2p/12D3KooWSeed1...",
      "/dns4/seed-eu-central.sovra.foundation/tcp/4001/p2p/12D3KooWSeed2..."
    ],
    "communityNodes": ["/dns4/community.opensocial.org/tcp/4001/p2p/12D3KooWComm1..."],
    "userConfiguredNodes": ["/ip4/192.168.1.100/tcp/4001/p2p/12D3KooWLocalPeer..."]
  }
}
```

### Failover Rules

- If `bootstrapNodes[0]` is unresponsive, the node automatically queries `bootstrapNodes[1]`.
- If all public seeds are blocked or offline, the node uses `userConfiguredNodes` or cached historical peers from disk.

---

## 3. NAT Traversal & Firewall Configuration

### 3.1 Direct Port Forwarding (Recommended for Servers)

For public nodes, expose TCP and UDP listening ports:

- **Default P2P Port:** `4001` (TCP for streams, UDP for QUIC)
- **Default WebSocket Port (Browser Gateway):** `4002` (WSS)

### 3.2 Operating Behind NAT (Residential & Mobile Clients)

Client nodes automatically detect NAT status via AutoNAT:

1. **AutoNAT Probe:** Node requests dial-back confirmation from 3 distinct peers.
2. **Relay Reservation:** If dial-back fails, node registers reservations with active Circuit Relay v2 nodes:
   ```typescript
   await node.relay.requestReservation('/ip4/198.51.100.1/tcp/4001/p2p/12D3KooWRelayServer');
   ```
3. **Advertising Address:** The node advertises `/p2p-circuit` multiaddrs to peers in GossipSub and DHT announcements.

---

## 4. Relay Node Administration (`nodes/relay-node`)

Relay nodes provide NAT traversal bandwidth without inspecting payloads:

- **Resource Limits for Relay Nodes:**
  ```json
  {
    "relay": {
      "maxReservations": 500,
      "maxCircuits": 100,
      "reservationDurationSeconds": 7200,
      "dataRateLimitBytesPerSec": 2097152
    }
  }
  ```
- **Security Invariant:** Relays only forward AEAD ciphertext. A compromised relay node cannot read user messages or forge events.

---

## 5. Peer Scoring & Defensive Thresholds

Node operators can adjust local peer scoring parameters in `scoring.json`:

```json
{
  "scoring": {
    "topicWeight": 1.0,
    "timeInMeshWeight": 0.1,
    "firstMessageDeliveriesWeight": 1.0,
    "invalidMessageDeliveriesWeight": -50.0,
    "decayIntervalMs": 60000,
    "graylistThreshold": -20.0,
    "blacklistThreshold": -50.0
  }
}
```

- **Graylist Action:** Automatically un-grafts peer from GossipSub topic mesh.
- **Blacklist Action:** Terminates connection and rejects dials for a 15-minute cooldown period.

---

## 6. Observability & Structured Local Node Metrics

All nodes collect structured local telemetry accessible via the CLI:

```typescript
const snapshot = node.metrics.getSnapshot();
console.log({
  peers: snapshot.peerCount,
  activeConnections: snapshot.connectionCount,
  directConnections: snapshot.directConnections,
  relayedConnections: snapshot.relayedConnections,
  failedConnections: snapshot.failedConnections,
  dhtOps: snapshot.dhtOperations,
  gossipPublished: snapshot.gossipSubMessagesPublished,
  gossipReceived: snapshot.gossipSubMessagesReceived,
  rejectedMessages: snapshot.rejectedMessages,
  avgLatencyMs: snapshot.averageLatencyMs,
});
```

### Security Rule

Node metrics NEVER record private keys, ephemeral secrets, or plaintext E2EE payloads.

---

## 7. Disaster Recovery & Offline Operation

When the node cannot reach wide-area internet:

1. **Local LAN Mode:** Node discovers nearby local peers using `LocalDiscoverySource` (mDNS/broadcast).
2. **Local Mesh Synchronization:** Signed events continue circulating over LAN without internet access.
3. **Healing on Reconnect:** When internet connectivity returns, the node dials cached peers and exchanges missed event IDs.
