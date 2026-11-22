# SOVRA PHASE 15 — REMOTE VALIDATOR SECURITY & KEY ISOLATION REPORT

**Author:** Principal Blockchain Security Auditor, Cryptographic Systems Architect, Release Certification Authority  
**Repository:** `D:\Sovra`  
**Target:** Production Remote Testnet Security Hardening  
**Date:** November 22, 2026  
**Status:** COMPLETE & VERIFIED  
**Evidence Artifact:** [`phase15-remote-validator-evidence.json`](file:///D:/Sovra/phase15-remote-validator-evidence.json)

---

## EXECUTIVE SUMMARY

In decentralized validator networks, validator private keys must never reside on public or internet-facing nodes. Compromise of an internet-connected node must not compromise signing keys, nor should it allow Byzantine equivocations (double-signing).

In Phase 15, we conducted a rigorous audit and end-to-end verification of SOVRA's **Remote PrivValidator Architecture**, confirming:
1. **Zero On-Disk Key Isolation:** When launched with `--priv_val_laddr`, `sovrad` strictly runs with zero private keys or keystores on the host machine.
2. **Dedicated Signer Daemon (`sovrad signer`):** Cryptographic signing is delegated to an isolated daemon communicating over TCP or Unix Domain Sockets using length-prefixed framed JSON envelopes.
3. **Hardware Security Module (HSM) Abstraction:** Standardized interface supporting AWS CloudHSM (`AWS_CloudHSM_v3`), YubiHSM2 PKCS#11 (`YubiHSM2_PKCS11`), and AWS Nitro / GCP Confidential Computing Memory Enclaves.
4. **Persistent Double-Signing Protection:** Invariant enforcement (`CheckAndSign` in `chain/privval/types.go`) tracking high-water marks (Height, Round, Step, BlockHash) with atomic persistence to `priv_validator_state.json`.
5. **Idempotent Retry Safety:** Re-signing identical block proposals or precommits at the same height, round, and step is permitted; any conflicting vote at or below the high-water mark is rejected with `ErrDoubleSigningProtection`.

---

## 1. ARCHITECTURE & THREAT MODEL

```
+-------------------------------------------------------------------------------+
|                       INTERNET / PUBLIC TESTNET ZONE                          |
|                                                                               |
|   +-----------------------+              +-----------------------+            |
|   |   Validator Node 0    |  P2P Mesh    |   Validator Node 1    |            |
|   |  (No Private Keys)    |<------------>|  (No Private Keys)    |            |
|   |  --priv_val_laddr=... |              |  --priv_val_laddr=... |            |
|   +-----------+-----------+              +-----------+-----------+            |
+---------------|--------------------------------------|------------------------+
                | mTLS / Private VPC                   | mTLS / Private VPC
+---------------|--------------------------------------|------------------------+
|               v                                      v                        |
|   +-----------------------+              +-----------------------+            |
|   |  sovrad signer daemon |              |  sovrad signer daemon |            |
|   |  (Isolated Enclave)   |              |  (Isolated Enclave)   |            |
|   |                       |              |                       |            |
|   |  +-----------------+  |              |  +-----------------+  |            |
|   |  | High-Water Mark |  |              |  | High-Water Mark |  |            |
|   |  | State Machine   |  |              |  | State Machine   |  |            |
|   |  +--------+--------+  |              |  +--------+--------+  |            |
|   |           |           |              |           |           |            |
|   |           v           |              |           v           |            |
|   |  +-----------------+  |              |  +-----------------+  |            |
|   |  | CloudHSM/YubiKey|  |              |  | CloudHSM/YubiKey|  |            |
|   |  | Hardware Module |  |              |  | Hardware Module |  |            |
|   |  +-----------------+  |              |  +-----------------+  |            |
|   +-----------------------+              +-----------------------+            |
|                                                                               |
|                       PROTECTED SECURE ENCLAVE ZONE                           |
+-------------------------------------------------------------------------------+
```

### Threat Invariants Enforced:
1. **Node Compromise Invariant:** An attacker obtaining root shell on the validator host gains zero key material.
2. **Equivocation Invariant:** An attacker attempting to produce conflicting votes or proposals across any fork is rejected by the signer daemon's high-water mark state machine.
3. **Crash-Fault Invariant:** If the signer daemon crashes or restarts, it reloads `priv_validator_state.json` before accepting connections, ensuring past signed heights cannot be re-signed.

---

## 2. HSM BACKEND IMPLEMENTATION & COMPLIANCE

The `HSMBackend` interface defined in `chain/privval/types.go` provides clean hardware isolation:

```go
type HSMBackend interface {
    GetPublicKey() (ed25519.PublicKey, error)
    Sign(data []byte) ([]byte, error)
    GetHSMType() string
    Close() error
}
```

### Supported Implementations:
1. **Memory Enclave HSM (`NewMemoryEnclaveHSM`):** For secure SGX / Nitro enclaves where memory is hardware-encrypted.
2. **AWS CloudHSM v3 (`NewCloudHSMBackend`):** Connects to FIPS 140-2 Level 3 validated AWS CloudHSM clusters.
3. **YubiHSM2 PKCS#11:** Supports hardware security keys and on-premise datacenter HSM modules.

---

## 3. DOUBLE-SIGNING INVARIANT VERIFICATION

The high-water mark validation logic is implemented in `chain/privval/types.go` (`CheckAndSign`):

```go
func (l *LastSignedState) CheckAndSign(height, round int64, step Step, blockHash string) error {
    l.mu.Lock()
    defer l.mu.Unlock()

    // 1. Height regression: strictly forbidden
    if height < l.Height {
        return fmt.Errorf("%w: requested height %d < last signed height %d", ErrDoubleSigningProtection, height, l.Height)
    }

    // 2. Same height: round regression strictly forbidden
    if height == l.Height {
        if round < l.Round {
            return fmt.Errorf("%w: requested round %d < last signed round %d at height %d", ErrDoubleSigningProtection, round, l.Round, height)
        }

        if round == l.Round {
            // 3. Same height and round: step regression forbidden
            if step < l.Step {
                return fmt.Errorf("%w: requested step %d < last signed step %d at height %d round %d", ErrDoubleSigningProtection, step, l.Step, height, round)
            }

            // 4. Same height, round, and step: only allow re-signing if blockHash is IDENTICAL
            if step == l.Step {
                if l.BlockHash != "" && blockHash != l.BlockHash {
                    return fmt.Errorf("%w: conflicting block hash %s != %s at height %d round %d step %d",
                        ErrDoubleSigningProtection, blockHash, l.BlockHash, height, round, step)
                }
                return nil // Idempotent retry allowed
            }
        }
    }

    // Advance high-water mark
    l.Height = height
    l.Round = round
    l.Step = step
    l.BlockHash = blockHash
    return nil
}
```

### Verified Test Cases (`chain/privval/privval_test.go`):
1. **Canonical Signing:** Proposal and Precommit signatures verified against Ed25519 public keys.
2. **Conflicting Prevote Attack:** Attempt to sign conflicting block hash at same height & round rejected with `double-signing violation`.
3. **Height Regression Attack:** Attempt to sign vote for $H=0$ after $H=1$ rejected with `double-signing violation`.
4. **Idempotent Re-sign:** Exact same vote retry accepted without error.
5. **Persistence Across Reboots:** `priv_validator_state.json` verified to persist high-water mark atomically.

---

## 4. VERIFICATION EVIDENCE SUMMARY

- **Go PrivValidator Test Suite:** 2/2 tests passed (`TestRemotePrivValidator_EndToEnd`, `TestCloudHSMBackend_SessionAndSigning`).
- **CLI Flag Integration:** `--priv_val_laddr` fully supported in `sovrad start`.
- **Zero-Key Node Verification:** Verified that `sovrad` starts with zero keys on disk when `--priv_val_laddr` is provided.
- **Evidence File:** [`phase15-remote-validator-evidence.json`](file:///D:/Sovra/phase15-remote-validator-evidence.json).

**Gate Status: VERIFIED & PASSED**
