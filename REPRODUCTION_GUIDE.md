# SOVRA PROTOCOL — ADVERSARIAL AUDIT REPRODUCTION GUIDE

**Date**: 2026-11-04  
**Auditor**: Independent Senior Security Auditor & Cryptographic Engineer  

This guide provides exact, deterministic commands to reproduce every finding and test scenario documented in this security audit.

---

## PREREQUISITES

1. Node.js (v20+ or v24+)
2. Running instance of Sovra Dev Server:
   ```bash
   node --max-old-space-size=4096 --experimental-strip-types scripts/dev-server.ts
   ```
   Ensure server is bound on `http://localhost:3001` and TCP `127.0.0.1:4001`.

---

## 1. REPRODUCE SEC-01: ZK-SNARK CIRCUIT PROOF FORGERY

Send a forged proof with completely invalid math to `/api/zk/humanity/verify`:

```bash
curl -X POST http://localhost:3001/api/zk/humanity/verify \
  -H "Content-Type: application/json" \
  -d '{
    "subjectDid": "did:sovra:attacker_forged_math",
    "nullifierHash": "nullifier_repro_'$(date +%s)'",
    "proofSnarkJson": "{\"fake_field\":\"bogus_math\",\"pi_a\":[\"0x0\"],\"pi_b\":[[\"0x0\"]],\"pi_c\":[\"0x0\"]}"
  }'
```

**Observed Result**:
HTTP 200 with `"isHuman": true`. Proves missing Groth16 cryptographic verification.

---

## 2. REPRODUCE SEC-02: WEBAUTHN PRF CONSOLE.LOG STUB

Inspect line 85167 of `scripts/dev-server.ts`:

```bash
node -e "
const fs = require('fs');
const code = fs.readFileSync('scripts/dev-server.ts', 'utf8');
const lines = code.split('\n');
console.log(lines.slice(85165, 85181).join('\n'));
"
```

**Observed Result**:
Function `loginWithHardwareEnclavePrf` only executes `console.log('[Enclave] deriveKeyFromWebAuthnPrf active...')`. No WebAuthn browser API is called.

---

## 3. REPRODUCE SEC-03: DISAPPEARING MESSAGES DELAYED DISK ERASURE

Run the automated reproduction script:

```bash
node scratch/audit_scripts/adversarial_test_runner.cjs
```

Review section `[CLAIM 5]`:
1. Message sent with `disappearingDurationSec: 1`.
2. Inspect disk 2.2s later before GET request: plaintext string remains in `.sovra-storage-dev/dynamic-social-state.json`.
3. After GET request, observe string replaced with `'💨 Message disappeared'`, while the message record itself is retained in JSON storage.

---

## 4. REPRODUCE SEC-04: GHOST MODE LOCALSTORAGE TOGGLE

Inspect line 47245 of `scripts/dev-server.ts`:

```bash
node -e "
const fs = require('fs');
const code = fs.readFileSync('scripts/dev-server.ts', 'utf8');
const lines = code.split('\n');
console.log(lines.slice(47244, 47260).join('\n'));
"
```

**Observed Result**:
`isGhostModeActive()` reads `localStorage.getItem('sovra_ghost_mode')`. No proxy, onion, or IP-masking transport exists.

---

## 5. REPRODUCE SEC-05: STRANGER MESSAGE BLOCKING (VERIFIED)

Run the automated stranger blocking verification:

```bash
node scratch/audit_scripts/14_test_stranger_block_api.cjs
```

**Observed Result**:
- User B sets `canMessageMe: 'friends'`.
- Stranger User A sends message to User B.
- HTTP 403 Forbidden: `"Recipient only accepts direct messages from friends"`.
