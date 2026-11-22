# SOVRA PHASE 15.5 — ACTIVATION & AUTHORIZATION SECURITY AUDIT

**Date:** November 22, 2026  
**Auditor:** Independent Release Verification Authority  
**Repository:** `D:\Sovra`  
**Target File:** `chain/cmd/sovrad/main.go`  
**Endpoint Audited:** `POST /consensus/transition`

---

## 1. Vulnerability Discovery (Phase 15.4 Gap)

During the forensic audit of `chain/cmd/sovrad/main.go`, the runtime validator transition endpoint was inspected:

```go
mux.HandleFunc("/consensus/transition", func(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
        return
    }
    // ... unmarshaled JSON body and immediately invoked ApplyValidatorTransition ...
})
```

### Critical Finding:
The HTTP endpoint `/consensus/transition` was completely unauthenticated. Any client capable of reaching the node's RPC port could submit an arbitrary validator set, revoke legitimate validators, or install malicious keys without authorization.

---

## 2. Security Remediation: Fail-Closed Multi-Tier Gate

In Phase 15.5, `POST /consensus/transition` was completely refactored with a strict fail-closed security gate:

### 2.1. Dual-Path Authentication Architecture
To authorize a runtime transition, a request must satisfy at least one of two cryptographic criteria:

1. **Path A — Operator Bearer / HMAC Authentication Token:**
   - Evaluates HTTP `Authorization: Bearer <TOKEN>` or `X-Sovra-Transition-Auth: <TOKEN>`.
   - Compares the token against the environment variable `SOVRA_RECOVERY_AUTH_TOKEN` using constant-time string comparison (`hmac.Equal`).
   - If `SOVRA_RECOVERY_AUTH_TOKEN` is unset or empty, this path is completely disabled.

2. **Path B — On-Chain 2/3+ Ed25519 Quorum Signatures:**
   - If no valid operator token is supplied, the request payload must contain cryptographic signatures from at least 2/3+ (> 66.7%) of the currently active validator set.
   - Canonical signing payload:
     $$\text{Digest} = \text{SHA256}(\text{ChainID} \parallel \text{":transition:"} \parallel \text{TransitionHeight} \parallel \text{":"} \parallel \text{Reason})$$
   - Each signature is verified against the validator's registered Ed25519 public key.
   - Any signature from a revoked or compromised validator is strictly rejected (`ErrRevokedValidator`).

### 2.2. Fail-Closed Default
If neither Path A nor Path B evaluates to true, the endpoint immediately aborts and returns:
`HTTP 401 Unauthorized: {"error": "unauthorized: valid authorization token or 2/3+ active validator quorum signatures required"}`.

---

## 3. Deterministic Startup Transition Loading

To support offline, air-gapped, or scheduled transitions without relying solely on runtime HTTP endpoints, `sovrad start` was enhanced to load a static configuration:

- **Config Path:** `filepath.Join(homeDir, "transition.json")`
- **Validation:** On node startup, if `transition.json` exists, it is unmarshaled into a `consensus.ValidatorTransition` struct and registered in `valSchedule` before block production or P2P switch initialization begins.
- **Audit Logging:** Emits `[CONSENSUS SCHEDULE] Loaded static transition from transition.json at H=<height>`.

---

## 4. Empirical Verification Evidence

The security gate was tested against the live running cluster in `tests/security/phase15-5-live-recovery.test.ts`:

1. **Unauthenticated Request:**
   - `POST /consensus/transition` without headers -> Returns `HTTP 401 Unauthorized`. (Verified)
2. **Invalid Bearer Token:**
   - `Authorization: Bearer invalid-secret-token` -> Returns `HTTP 401 Unauthorized`. (Verified)
3. **Compromised-Key Signed Request:**
   - Request signed by revoked genesis keys -> Returns `HTTP 401 Unauthorized`. (Verified)
4. **Valid Authenticated Request:**
   - `Authorization: Bearer sovra-recovery-auth-token-2026` -> Authenticated successfully. (Verified)
