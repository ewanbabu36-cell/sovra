# SOVRA PROTOCOL — PRODUCTION OPERATIONS RUNBOOK
**Document Version:** 1.0.0  
**Classification:** Day-2 Operations & Infrastructure Maintenance  
**Target Environments:** Linux / Docker / Kubernetes  

---

## 1. Service Lifecycle Commands

### 1.1 Local / VPS Systemd Daemon
```bash
# Start Sovra node daemon
systemctl start sovra-node

# Stop Sovra node daemon (graceful shutdown)
systemctl stop sovra-node

# Restart daemon
systemctl restart sovra-node

# Check systemd status
systemctl status sovra-node
```

### 1.2 Docker Compose Production Stack
```bash
# Launch entire production stack (Node + Caddy + Coturn) in background
docker compose -f docker/docker-compose.production.yml up -d

# Check live service status and health probes
docker compose -f docker/docker-compose.production.yml ps

# Follow container logs
docker compose -f docker/docker-compose.production.yml logs -f sovra-node

# Gracefully stop production stack
docker compose -f docker/docker-compose.production.yml down

# Restart specific service without interrupting others
docker compose -f docker/docker-compose.production.yml restart caddy-proxy
```

### 1.3 Kubernetes StatefulSet
```bash
# Check pod status and replica count
kubectl get statefulset,pods,svc -n sovra-system

# View live pod logs
kubectl logs -f statefulset/sovra-node -n sovra-system

# Perform rolling restart
kubectl rollout restart statefulset/sovra-node -n sovra-system

# Check rollout status
kubectl rollout status statefulset/sovra-node -n sovra-system
```

---

## 2. Health Check & Diagnostic Probes

| Endpoint | Method | Intended Caller | Expected Response | Description |
|----------|--------|-----------------|-------------------|-------------|
| `/livez` | `GET` | K8s Liveness / Docker | `200 OK` `{"status":"alive"}` | Validates Node.js event loop is responsive. |
| `/readyz` | `GET` | K8s Readiness / Proxy | `200 OK` `{"status":"ready"}` | Confirms DB is mounted, accessible, and uncorrupted. |
| `/healthz` | `GET` | Monitoring Agent | `200 OK` (JSON details) | Returns uptime, memory usage, and DB tables. |
| `/api/node/version` | `GET` | CI/CD / Ops | `200 OK` (JSON release) | Reports git commit, build time, and schema version. |
| `/metrics` | `GET` | Prometheus Scraper | `200 OK` (text/plain) | Standard Prometheus time-series metrics. |

### 2.1 Diagnostic One-Liners
```bash
# Check node readiness
curl -fsS http://localhost:3001/readyz | jq .

# Check build & schema version
curl -fsS http://localhost:3001/api/node/version | jq .

# Scrape Prometheus metrics
curl -fsS http://localhost:3001/metrics | grep sovra_
```

---

## 3. Database Administration & WAL Maintenance

### 3.1 Manual WAL Checkpoint & Compaction
SQLite in WAL mode checkpoints automatically, but heavy write spikes can cause the `.sqlite-wal` file to grow. Run manual checkpointing during low-traffic windows:

```bash
# Trigger checkpoint & disk GC via REST endpoint
curl -X POST http://localhost:3001/api/node/gc

# Alternatively, run via direct SQLite pragma:
sqlite3 /app/.sovra-storage-prod/sovra-social.sqlite "PRAGMA wal_checkpoint(TRUNCATE);"
```

### 3.2 Database Integrity Validation
```bash
# Execute deep B-Tree integrity check
sqlite3 /app/.sovra-storage-prod/sovra-social.sqlite "PRAGMA integrity_check;"

# Execute fast header & page check
sqlite3 /app/.sovra-storage-prod/sovra-social.sqlite "PRAGMA quick_check;"

# Inspect migration history
sqlite3 /app/.sovra-storage-prod/sovra-social.sqlite "SELECT * FROM schema_migrations ORDER BY version DESC;"
```

---

## 4. Backup & Restore Operations

### 4.1 On-Demand Backup Execution
```bash
# Trigger immediate online backup
node --experimental-strip-types scripts/sovra-backup-restore.ts create-backup \
  --dest /app/.sovra-backups \
  --tag manual_pre_upgrade
```

### 4.2 Backup Verification
```bash
# Verify integrity of backup folder
node --experimental-strip-types scripts/sovra-backup-restore.ts verify-backup \
  --backup-dir /app/.sovra-backups/sovra_backup_1791522331881_drill_prod
```

### 4.3 Full Restore Execution
```bash
# Restore verified backup snapshot
node --experimental-strip-types scripts/sovra-backup-restore.ts restore-backup \
  --backup-dir /app/.sovra-backups/sovra_backup_1791522331881_drill_prod \
  --target-dir /app/.sovra-storage-prod
```

---

## 5. Deployment, Upgrade & Safe Rollback Procedure

### 5.1 Pre-Deployment Verification Checklist
- [ ] Working tree clean on `main` branch.
- [ ] TypeScript typecheck passes: `npx tsc --noEmit`.
- [ ] Automated tests pass: `npx vitest run`.
- [ ] Database backup taken: `scripts/sovra-backup-restore.ts create-backup`.
- [ ] Secrets present in environment (not hardcoded).

### 5.2 Rollout (Version N → N+1)
```bash
# 1. Build and tag new container image
docker build -f docker/Dockerfile.production -t ghcr.io/sovra/sovra-node:v1.1.0 .

# 2. Update Kubernetes StatefulSet image
kubectl set image statefulset/sovra-node sovra-node=ghcr.io/sovra/sovra-node:v1.1.0 -n sovra-system

# 3. Monitor rollout progress
kubectl rollout status statefulset/sovra-node -n sovra-system --timeout=120s
```

### 5.3 Rollback (Version N+1 → N)
If `/readyz` fails or health checks trigger an alert:
```bash
# 1. Rollback Kubernetes deployment immediately
kubectl rollout undo statefulset/sovra-node -n sovra-system

# 2. If schema rollback is required:
node --experimental-strip-types scripts/database-migrations.ts rollback --target 4

# 3. Verify previous version restored
curl -fsS http://localhost:3001/api/node/version | jq .
```
