# SOVRA PRODUCTION DEPLOYMENT RUNBOOK
**Operational Guide for Multi-Container Production Deployment with Docker, Caddy, and Health Probes**

---

## 1. System Requirements

- **Operating System:** Linux (Ubuntu 22.04 LTS / Debian 12 / Alpine 3.19 recommended)
- **Container Engine:** Docker Engine 24.0+ and Docker Compose 2.20+
- **Memory:** Minimum 2 GB RAM (4 GB recommended for high concurrent SSE & media traffic)
- **CPU:** Minimum 2 vCPU cores
- **Storage:** Minimum 20 GB SSD (NVMe recommended for SQLite WAL journal and media blockstore)
- **Network Ports:**
  - `80/tcp`: HTTP (Redirects to HTTPS)
  - `443/tcp`: HTTPS (Caddy TLS Termination)
  - `4001/tcp`: Noise_XX P2P Protocol Mesh Listen Port

---

## 2. Directory Structure & Configuration Files

All production container configuration resides in the `docker/` directory:

```
docker/
├── Caddyfile                   # Reverse proxy rules, unbuffered SSE, WebRTC Permissions-Policy
├── Dockerfile.production       # Multi-stage hardened Alpine Node.js 22 container
├── Dockerfile.seed             # Seed node configuration
├── docker-compose.production.yml # Multi-container production deployment stack
└── docker-compose.seed.yml     # Seed node stack
```

---

## 3. Environment Variables Configuration

Create an environment file at `docker/.env`:

```bash
# Node Runtime Configuration
NODE_ENV=production
PORT=3001
SOVRA_STORAGE_DIR=/app/.sovra-storage-prod
SOVRA_HTTP_PORT=3001
SOVRA_P2P_PORT=4001

# Administrative Credentials
ADMIN_SECRET_KEY=sovra-production-super-secret-key-32chars-minimum!

# Optional Domain Configuration for Caddy Automatic Let's Encrypt TLS
SOVRA_DOMAIN=sovra.network
```

---

## 4. Production Deployment Steps

### Step 1: Clone Repository & Build Production Artifacts
```bash
git clone https://github.com/sovra/sovra.git /opt/sovra
cd /opt/sovra
```

### Step 2: Build and Launch Production Multi-Container Stack
```bash
cd docker
docker compose -f docker-compose.production.yml up -d --build
```

### Step 3: Verify Container Health & Status
```bash
docker compose -f docker-compose.production.yml ps
```
Both containers should report `healthy`:
```
NAME                    IMAGE                  COMMAND                  SERVICE       STATUS
sovra-production-node   docker-sovra-node      "node --experimental…"   sovra-node    Up (healthy)
sovra-caddy-proxy       caddy:2-alpine         "caddy run --config …"   caddy-proxy   Up
```

---

## 5. Health Probes & Monitoring Verification

### 5.1 Container Liveness Probe (`/livez`)
```bash
curl -f http://127.0.0.1:3001/livez
# Response: {"status":"alive","timestamp":1791467276720}
```

### 5.2 Container Readiness Probe (`/readyz`)
```bash
curl -f http://127.0.0.1:3001/readyz
# Response: {"status":"ready","checks":{"databaseIntegrity":true,"storageAccessible":true,"p2pOnline":true}}
```

### 5.3 Detailed Healthcheck Probe (`/healthz`)
```bash
curl -f http://127.0.0.1:3001/healthz
# Response: {"status":"healthy","uptimeSeconds":1500,"database":{"backend":"sqlite","journalMode":"WAL"}}
```

### 5.4 Prometheus Metrics Probe (`/metrics`)
```bash
curl -s http://127.0.0.1:3001/metrics | grep sovra_
# Output:
# sovra_uptime_seconds 1500
# sovra_users_count 24
# sovra_posts_count 88
```

---

## 6. Zero-Downtime Maintenance & Upgrades

### Graceful Node Restart
```bash
docker compose -f docker-compose.production.yml restart sovra-node
```

### Log Streaming & Monitoring
```bash
# Follow Node Application Logs
docker logs -f --tail=100 sovra-production-node

# Follow Caddy Proxy Logs
docker logs -f --tail=100 sovra-caddy-proxy
```

### Pruning Unused Images & Volumes
```bash
docker image prune -f
```
*(Caution: Never run `docker volume prune` without verifying persistent storage volumes).*
