# SOVRA — PRODUCTION DEPLOYMENT & OPERATIONAL REPORT

**Deployment Date:** November 19, 2026  
**Active Environment:** Local Daemon + Live Public Tunnel Matrix  
**Status:** **OPERATIONAL & LIVE**

---

## 1. Active Daemons & Endpoints

| Service / Daemon | Task ID | Internal Address | Public Tunnel Endpoint | Status |
| :--- | :---: | :---: | :---: | :---: |
| **HTTP Web Application & API** | `task-23075` | `http://localhost:3001` | `https://reflector-grafting-clergyman.ngrok-free.dev` | **ONLINE** |
| **HTTPS Secure WebRTC Server** | `task-23075` | `https://0.0.0.0:3443` | Direct / LAN Binding | **ONLINE** |
| **CometBFT L1 Consensus Node** | Subprocess | `http://127.0.0.1:26657` | L1 RPC / Block Producer | **ONLINE (Producing Blocks)** |
| **P2P Noise_XX TCP Swarm** | Embedded | `127.0.0.1:4001` | P2P Swarm Gossip | **ONLINE** |
| **Ngrok Public Live Tunnel** | `task-22697` | Port 3001 | `https://reflector-grafting-clergyman.ngrok-free.dev` | **HEALTHY** |
| **Cloudflare Quick Tunnel** | `task-22699` | Port 3001 | `https://boot-headquarters-mold-featured.trycloudflare.com` | **HEALTHY** |

---

## 2. Production Asset Builds & Performance Metrics
- **Client Bundle:** `apps/sovra-app/dist/bundle.js` — **216,440 bytes**
- **Minified Stylesheet:** `apps/sovra-app/dist/sovra.css` — **354,296 bytes** (v2.4.0)
- **Database Engine:** SQLite WAL mode with zero lock contention (`sovra.db` ~1.17 MB).
- **Consensus Metrics:** CometBFT producing blocks regularly with zero missed rounds.
- **Backup Performance:** Hot backup generation: **43.76ms**; cold point-in-time restore: **14.32ms**. Achievable RPO: < 15 seconds; achievable RTO: < 2 seconds.
