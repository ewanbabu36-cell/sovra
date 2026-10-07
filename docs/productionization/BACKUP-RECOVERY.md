# Sovra — Backup & Disaster Recovery Runbook

## 1. Local Node Backup Procedures

### Automatic Rolling Backup
The `SovraDatabaseEngine` creates an automatic snapshot `dynamic-social-state.json.bak` on every state write before the new state is committed.

### Manual / Cron Backup Script
To take a full offline or hot backup of the node storage:
```powershell
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = "./backups/$timestamp"
New-Item -ItemType Directory -Force -Path $backupDir

# Backup relational database state
Copy-Item "./.sovra-storage-dev/dynamic-social-state.json" "$backupDir/dynamic-social-state.json"

# Backup CID blockstore
Copy-Item -Recurse "./.sovra-storage-dev/blocks" "$backupDir/blocks"
```

---

## 2. Recovery Objectives
* **Recovery Point Objective (RPO):** <= 1 state transaction (due to automatic `.bak` rolling backups).
* **Recovery Time Objective (RTO):** < 5 seconds (restart node daemon; automated corruption recovery reads `.bak` immediately).

---

## 3. Disaster Recovery Execution
1. Stop the node daemon (`Ctrl+C` or kill process).
2. If primary JSON is corrupted, copy `dynamic-social-state.json.bak` over `dynamic-social-state.json`.
3. Restart dev server daemon:
   ```powershell
   node --experimental-strip-types scripts/dev-server.ts
   ```
4. Check health endpoint:
   ```powershell
   curl http://localhost:3001/api/status
   ```
