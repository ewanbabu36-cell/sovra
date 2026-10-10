# SOVRA WebRTC TURN & Coturn Production Deployment

## 1. Overview & Relay Architecture

For symmetric NATs, mobile cellular firewalls (Carrier-Grade NAT / CGNAT), and enterprise networks where direct P2P hole-punching fails, SOVRA utilizes a hardened **Coturn** TURN/STUN relay server.

```
  Client (Cellular 4G/5G / Symmetric NAT)
                     │
         STUN Binding Request (UDP 3478)
                     ▼
  ┌─────────────────────────────────────────────────────┐
  │         SOVRA Coturn Cluster (turn.sovra.network)   │
  │                                                     │
  │  ├── Port 3478:  STUN / TURN (UDP & TCP)           │
  │  ├── Port 5349:  TURNS (TLS over TCP & UDP)        │
  │  └── Port Range: 49152-49200 (UDP Media Relays)    │
  └──────────────────────────┬──────────────────────────┘
                             │ Relay Allocation
                             ▼
  Client (Enterprise Wi-Fi / Restrictive Firewall)
```

---

## 2. Server Configuration Specification

Configuration file location: [`docker/turnserver.conf`](file:///d:/Sovra/docker/turnserver.conf)

### Core Directives:
* **`listening-port=3478`**: Standard TURN/STUN UDP & TCP listener.
* **`tls-listening-port=5349`**: Secure encrypted TURN (TURNS) listener.
* **`min-port=49152` & `max-port=49200`**: Deterministic UDP relay port range configured in firewalls.
* **`fingerprint`**: Mandatory WebRTC message integrity fingerprint.
* **`lt-cred-mech`**: Long-term credential mechanism required for TURN allocations.
* **`use-auth-secret`**: Enables ephemeral REST API HMAC-SHA1 credentials.
* **`stale-nonce=600`**: 10-minute nonce lifetime protecting against replay attacks.
* **`realm=sovra.network`**: Authentication realm matching token issuer.

### Resource Quotas & Rate Limits:
* **`max-bps=3000000`**: Throttles bandwidth to 3 Mbps per relay session to prevent denial-of-service.
* **`total-quota=200`**: Limits concurrent allocations to 200 per server pod.
* **`user-quota=10`**: Restricts each authenticated DID to a maximum of 10 concurrent allocations.

### Network Isolation & SSRF Prevention:
Coturn is strictly forbidden from relaying packets to internal private RFC1918 subnets or cloud provider metadata services:
```properties
no-loopback-peers
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
```

---

## 3. Ephemeral Time-Windowed Authentication (Coturn REST API)

SOVRA strictly prohibits static hardcoded credentials in frontend bundles. Instead, the backend generates short-lived HMAC-SHA1 credentials upon request via `getIceServers(userDid)`:

$$\text{Username} = \text{Expiry} : \text{userDid}$$
$$\text{Credential} = \text{Base64}\left(\text{HMAC-SHA1}(\text{TURN\_SECRET}, \text{Username})\right)$$

### Environment Variables:
| Variable | Description | Production Default |
| :--- | :--- | :--- |
| `WEBRTC_STUN_SERVERS` | Comma-separated STUN server URLs | `stun:stun.l.google.com:19302,stun:global.stun.twilio.com:3478` |
| `WEBRTC_TURN_SERVERS` | Comma-separated TURN URLs | `turn:turn.sovra.network:3478?transport=udp,turns:turn.sovra.network:5349?transport=tcp` |
| `WEBRTC_TURN_SECRET` | Shared HMAC secret matching Coturn | Stored in Kubernetes Secret (`sovra-coturn-secret`) |
| `WEBRTC_TURN_TTL` | Credential validity in seconds | `3600` (1 hour) |

---

## 4. Kubernetes Deployment Specification

Kubernetes manifest location: [`deploy/kubernetes/sovra-coturn.yaml`](file:///d:/Sovra/deploy/kubernetes/sovra-coturn.yaml)

```bash
# 1. Apply namespace and secret
kubectl apply -f deploy/kubernetes/sovra-coturn.yaml

# 2. Verify pods and LoadBalancer service
kubectl get pods -n sovra-system -l app.kubernetes.io/name=sovra-coturn
kubectl get svc -n sovra-system sovra-coturn-relay
```

### Production Firewall & Security Groups:
Ensure the following ports are open on cloud edge firewalls (AWS Security Groups / GCP Firewall Rules):
* `3478 UDP / TCP` (STUN / TURN)
* `5349 UDP / TCP` (TURNS TLS)
* `49152-49200 UDP` (Media Relay Traffic)
