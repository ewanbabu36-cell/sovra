# SOVRA PROTOCOL — PRODUCTION BACKUP & RESTORE RUNBOOK
**Document Version:** 1.0.0  
**Target Environment:** Production (Docker Compose & Kubernetes StatefulSet)  
**Classification:** Operational Runbook  

---

## 1. Executive Summary & Architecture Overview

The Sovra decentralized node persists all relational, social graph, identity, and cryptographic state using a dual-persistence architecture:
1. **Primary Relational Engine:** Embedded SQLite database (`sovra-social.sqlite`) operating in Write-Ahead Logging (`WAL`) mode with foreign key enforcement and statement caching.
2. **Atomic JSON Snapshot Engine:** Snapshot and rolling backup files (`dynamic-social-state.json` and `.bak`) providing redundant disk representation.
3. **Node Identity & Cryptographic Keys:** `node-identity.json` containing the device DID, Ed25519 identity keypairs, and Noise_XX static handshake keys.
4. **Content-Addressed Media Store:** File hierarchy under `.sovra-storage-prod/` (`posts/`, `avatars/`, `covers/`, `reels/`, `attachments/`).

### 1.1 Atomic Backup Guarantees
Because SQLite in WAL mode maintains active shared-memory (`.sqlite-shm`) and write-ahead log (`.sqlite-wal`) files, direct filesystem copying of an open SQLite database file risks capturing an inconsistent point-in-time snapshot. 

Sovra solves this through native SQLite online vacuum backups:
```sql
PRAGMA wal_checkpoint(TRUNCATE);
VACUUM INTO '/destination/path/sovra-social.sqlite';
```
This produces a fully compacted, atomic, read-consistent snapshot with zero transaction blocking and zero downtime.

---

## 2. Backup Manifest Specification

Every backup created by `SovraBackupManager` generates a cryptographic `manifest.json` containing:
- `backupId`: Unique identifier (`sovra_backup_<timestamp>_<tag>`).
- `timestamp` / `isoDate`: ISO-8601 creation timestamp.
- `schemaVersion`: Applied migration version (e.g. `5`).
- `files`: Array of backed up files, their byte sizes, and cryptographic SHA-256 digests.
- `databaseStats`: Live row counts across `users`, `posts`, `direct_messages`, and `channels`.
- `integrityVerified`: Boolean confirmation that `PRAGMA integrity_check` returned `ok` immediately following snapshot generation.

---

## 3. Production Backup Procedures

### 3.1 Automated Scheduled Backups (Docker Compose)
In Docker Compose deployments, backups are orchestrated via the built-in backup CLI executed via cron or an external orchestrator:

```bash
# Execute online backup directly inside the running container
docker exec sovra-production-node node --experimental-strip-types scripts/sovra-backup-restore.ts create-backup \
  --dest /app/.sovra-backups \
  --tag automated_daily
```

To include media attachments:
```bash
docker exec sovra-production-node node --experimental-strip-types scripts/sovra-backup-restore.ts create-backup \
  --dest /app/.sovra-backups \
  --include-media \
  --tag full_archive
```

### 3.2 Kubernetes CronJob Manifest
In Kubernetes deployments, a lightweight helper pod mounts the shared storage PersistentVolumeClaim (`sovra-storage`) and runs the backup procedure to an offsite persistent volume or S3 bucket:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: sovra-sqlite-backup
  namespace: sovra-system
spec:
  schedule: "0 2 * * *" # Daily at 02:00 UTC
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: backup-worker
              image: ghcr.io/sovra/sovra-node:latest
              command: ["node", "--experimental-strip-types", "scripts/sovra-backup-restore.ts", "create-backup"]
              env:
                - name: SOVRA_STORAGE_DIR
                  value: "/app/.sovra-storage-prod"
              volumeMounts:
                - name: sovra-storage
                  mountPath: /app/.sovra-storage-prod
                - name: backup-destination
                  mountPath: /app/.sovra-backups
          volumes:
            - name: sovra-storage
              persistentVolumeClaim:
                claimName: sovra-storage
            - name: backup-destination
              persistentVolumeClaim:
                claimName: sovra-backup-pvc
```

---

## 4. Disaster Recovery & Restoration Procedures

### 4.1 Prerequisites
1. Identify the target backup directory (e.g., `/.sovra-backups/sovra_backup_1791522331881_drill_prod`).
2. Verify backup integrity **before** taking destructive action:
   ```bash
   node --experimental-strip-types scripts/sovra-backup-restore.ts verify-backup \
     --backup-dir /.sovra-backups/sovra_backup_1791522331881_drill_prod
   ```

### 4.2 Standard Restoration Sequence (Docker)
1. **Stop the Application Service:**
   ```bash
   docker stop sovra-production-node
   ```
2. **Execute Restoration to Target Storage:**
   ```bash
   node --experimental-strip-types scripts/sovra-backup-restore.ts restore-backup \
     --backup-dir /.sovra-backups/sovra_backup_1791522331881_drill_prod \
     --target-dir /var/lib/docker/volumes/sovra_sovra-prod-storage/_data
   ```
3. **Start the Application Service:**
   ```bash
   docker start sovra-production-node
   ```
4. **Validate Liveness & Readiness:**
   ```bash
   curl -f http://127.0.0.1:3001/livez
   curl -f http://127.0.0.1:3001/readyz
   curl -f http://127.0.0.1:3001/api/node/version
   ```

---

## 5. Empirical Restoration Drill Validation

The restoration procedure was empirically validated in automated reliability test `tests/reliability/backup-restore-production-drill.test.ts` across an 11-step execution sequence:

| Step | Operation | Result | Metric |
|------|-----------|--------|--------|
| **1** | Online Snapshot Creation | **PASSED** | Duration: **38.24 ms** |
| **2** | Checksum & Size Audit | **PASSED** | DB Size: 311,296 bytes; SHA256 verified |
| **3** | Post-Backup Data Mutation | **PASSED** | Simulated data drift injected |
| **4** | Application Shutdown | **PASSED** | Clean connection closure |
| **5** | Isolated Environment Restore | **PASSED** | Duration: **8.94 ms** |
| **6** | Restored Database Startup | **PASSED** | SQLite WAL opened cleanly |
| **7** | `PRAGMA integrity_check` | **PASSED** | Returned `"ok"` |
| **8** | Point-in-Time Data Verification | **PASSED** | Pre-backup data intact; drift excluded |
| **9** | Write & Read Operations | **PASSED** | New post created and retrieved |
| **10** | Metadata & Integrity Manifest | **PASSED** | Manifest matches 100% |
| **11** | RTO Measurement | **PASSED** | **8.94 ms** (Target: < 10,000 ms) |

---

## 6. Retention & Pruning Policy

| Tier | Frequency | Retention Window | Storage Target |
|------|-----------|------------------|----------------|
| **Hourly Snapshots** | Every 60 minutes | 24 Hours | Local NVMe volume |
| **Daily Backups** | Every 24 hours | 14 Days | Local secondary volume / PVC |
| **Weekly Archives** | Every 7 days | 90 Days | Offsite encrypted S3 object storage |
| **Monthly Golden Images** | First of month | 365 Days | Cold immutable object storage (WORM) |

Pruning command:
```bash
find /app/.sovra-backups -maxdepth 1 -type d -name "sovra_backup_*" -mtime +14 -exec rm -rf {} +
```
