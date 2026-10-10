# SOVRA PROTOCOL — PRODUCTION INCIDENT RESPONSE PLAN
**Document Version:** 1.0.0  
**Classification:** Operational Security & Reliability  
**Target Environments:** Production & Staging Nodes  

---

## 1. Incident Severity Classification Framework

| Severity Level | Definition | Response SLA | Escalation Target |
|----------------|------------|--------------|-------------------|
| **SEV-0 (Catastrophic)** | Total node outage, database corruption, master admin key compromise, or active data exfiltration. | < 15 Minutes | Incident Commander + Lead Protocol Engineer |
| **SEV-1 (Critical)** | Core subsystem failure (WebRTC TURN relay down, media storage exhausted, SSE broadcast storm, authentication failure). | < 30 Minutes | Primary On-Call Engineer |
| **SEV-2 (Major)** | Elevated latency ($p95 > 500\text{ ms}$), rate limit throttling spike, isolated endpoint failure. | < 2 Hours | Operations Engineering |
| **SEV-3 (Minor)** | Non-blocking degradation, transient worker alerts, cosmetic admin log warnings. | < 24 Hours | Sprint Backlog |

---

## 2. Standard 6-Phase Incident Lifecycle

```
[1. DETECT] ───> [2. CONTAIN] ───> [3. RECOVER] ───> [4. INVESTIGATE] ───> [5. DOCUMENT] ───> [6. PREVENT]
```

1. **Detect:** Automated alerts from `/healthz`, `/readyz`, or Prometheus `/metrics` trigger pager.
2. **Contain:** Isolate compromised keys, quarantine affected peers, activate admin emergency panic mode (`POST /api/admin/panic`), or switch reverse proxy to maintenance mode.
3. **Recover:** Restore database from point-in-time backup, rotate compromised secrets, reboot StatefulSet with clean state.
4. **Investigate:** Analyze structured JSON logs, audit logs table (`SELECT * FROM audit_logs`), and container metrics.
5. **Document:** Author a Root Cause Analysis (RCA) within 48 hours.
6. **Prevent:** Implement regression test, update firewall rules, or apply schema migration.

---

## 3. Incident Playbooks by Failure Domain

### 3.1 Playbook A: Total Service Outage (Process Crash / Deadlock)
**Symptoms:** `/livez` fails to respond; HTTP connections drop with `502 Bad Gateway` from Caddy/Nginx.

1. **Check Container Status:**
   ```bash
   docker ps -a --filter "name=sovra"
   # or Kubernetes:
   kubectl get pods -n sovra-system -l app.kubernetes.io/name=sovra-node
   ```
2. **Inspect Process Exit Codes & Logs:**
   ```bash
   docker logs --tail 100 sovra-production-node
   ```
3. **Attempt Controlled Restart:**
   ```bash
   docker restart sovra-production-node
   ```
4. **If Restart Fails (Stale Lock File):**
   - Verify if `.sovra-storage-prod/sovra-social.sqlite-wal` is locked by a zombie PID:
   ```bash
   fuser -v /app/.sovra-storage-prod/sovra-social.sqlite
   ```
   - Terminate zombie process and start fresh container.

---

### 3.2 Playbook B: Database Corruption (`PRAGMA integrity_check` Fails)
**Symptoms:** `/readyz` returns HTTP 503 `checks.databaseIntegrity: false`; logs indicate `SQLITE_CORRUPT`.

1. **Isolate Active Pod Immediately:**
   ```bash
   docker stop sovra-production-node
   ```
2. **Verify Backup Availability:**
   ```bash
   ls -lt /app/.sovra-backups/
   ```
3. **Run Integrity Check on Latest Backup:**
   ```bash
   node --experimental-strip-types scripts/sovra-backup-restore.ts verify-backup \
     --backup-dir $(ls -td /app/.sovra-backups/sovra_backup_* | head -1)
   ```
4. **Execute Clean Restore:**
   ```bash
   node --experimental-strip-types scripts/sovra-backup-restore.ts restore-backup \
     --backup-dir $(ls -td /app/.sovra-backups/sovra_backup_* | head -1) \
     --target-dir /app/.sovra-storage-prod
   ```
5. **Start Application & Verify:**
   ```bash
   docker start sovra-production-node
   curl -f http://127.0.0.1:3001/readyz
   ```

---

### 3.3 Playbook C: Security Breach & Master Admin Key Compromise
**Symptoms:** Unauthorized administrative actions in `audit_logs`; abnormal session tokens observed.

1. **Activate Emergency Lockout (Revoke All Sessions):**
   ```bash
   # Generate new 64-character random key
   NEW_KEY=$(openssl rand -hex 32)
   
   # Rotate immediately via AdminSecurityEngine
   curl -X POST http://127.0.0.1:3001/api/admin/panic \
     -H "Content-Type: application/json" \
     -d "{\"adminSecret\": \"${CURRENT_KEY}\", \"action\": \"LOCKDOWN\"}"
   ```
2. **Update Environment Variable in Secret Store:**
   ```bash
   # Kubernetes:
   kubectl create secret generic sovra-admin-credentials \
     --from-literal=admin-secret-key="${NEW_KEY}" \
     --dry-run=client -o yaml | kubectl apply -f -
   
   # Restart node to pick up rotated key:
   kubectl rollout restart statefulset/sovra-node -n sovra-system
   ```
3. **Audit Log Inspection:**
   ```sql
   SELECT * FROM audit_logs WHERE timestamp > (strftime('%s', 'now') - 86400) * 1000 ORDER BY timestamp DESC;
   ```

---

### 3.4 Playbook D: Disk Storage Exhaustion (< 5% Free)
**Symptoms:** Media uploads fail with `500 Internal Server Error`; `/readyz` latency degrades.

1. **Trigger Garbage Collection & SQLite Compaction:**
   ```bash
   curl -X POST http://127.0.0.1:3001/api/node/gc
   ```
2. **Prune Stale Backups Older Than Retention Window:**
   ```bash
   find /app/.sovra-backups -maxdepth 1 -type d -name "sovra_backup_*" -mtime +14 -exec rm -rf {} +
   ```
3. **Prune Temporary Attachment Files:**
   ```bash
   find /app/.sovra-storage-prod/attachments -type f -mtime +30 -delete
   ```

---

### 3.5 Playbook E: WebRTC & TURN Relay Failure
**Symptoms:** Cross-network peer calls fail to connect (`FAILED` state in call metrics); ICE candidate gathering times out.

1. **Check Coturn Container Status:**
   ```bash
   docker ps | grep coturn
   docker logs --tail 50 sovra-coturn-relay
   ```
2. **Verify UDP Port Accessibility (3478 & 5349):**
   ```bash
   nc -z -v -u 127.0.0.1 3478
   ```
3. **Verify Ephemeral Credential Generation:**
   ```bash
   curl -s http://127.0.0.1:3001/api/call/ice-servers | jq .
   ```
4. **Restart Coturn Daemon:**
   ```bash
   docker restart sovra-coturn-relay
   ```
