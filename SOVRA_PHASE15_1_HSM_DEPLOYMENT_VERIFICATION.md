# SOVRA PHASE 15.1 — HARDWARE SECURITY MODULE (HSM) DEPLOYMENT VERIFICATION

**Author:** Principal Cryptographic Security Auditor & Hardware Security Authority  
**Repository:** `D:\Sovra`  
**File Under Audit:** `chain/privval/hsm.go` (SHA-256: `fed7b7810d84ad16c26e26988f0c5e2a8c59d09a3b7ddde0255e851ea47e534e`)  
**Date:** November 22, 2026  
**Classification:** VERIFICATION FAILED FOR PRODUCTION HSM — SOFTWARE SIMULATION ONLY  
**Evidence Artifact:** [`phase15_1-hsm-gap-analysis-evidence.json`](file:///d:/Sovra/phase15_1-hsm-gap-analysis-evidence.json)

---

## 1. EXECUTIVE SUMMARY & ZERO-TRUST VERDICT

In Phase 15, claims and abstractions were introduced regarding "AWS CloudHSM and YubiHSM2 deployment" for validator signing key custody. Under this zero-trust audit, we examined the physical, runtime, and architectural implementation of `chain/privval/hsm.go`.

### Audit Verdict:
- **Software Interface Architecture:** **VERIFIED (COMPLIANT)** — The Go interface abstraction (`Sign`, `GetPublicKey`, `GetHSMType`, `Close`) is well-designed and cleanly isolates signing operations.
- **Production Hardware Security Module:** **FAILED / NOT DEPLOYED** — No physical YubiHSM2 devices, AWS CloudHSM clusters, or PKCS#11 CGO dynamic libraries are present or invoked.
- **Key Custody Reality:** Signing keys reside as raw `ed25519.PrivateKey` byte slices in process heap memory. They are not physically protected by a FIPS 140-2 Level 3 hardware boundary.
- **Certification Level:** **DOWNGRADED TO SOFTWARE SIMULATION ONLY**. Authorization for remote testnet validator operations using this implementation is **DENIED** until true hardware HSM or AWS KMS/CloudHSM integration is operational.

---

## 2. SOURCE CODE ARCHITECTURE AUDIT

An inspection of `chain/privval/hsm.go` demonstrates that all signing operations occur via in-process software emulation:

```go
// chain/privval/hsm.go (Lines 11-16, 70-79)
type MemoryEnclaveHSM struct {
    mu         sync.RWMutex
    privateKey ed25519.PrivateKey
    publicKey  ed25519.PublicKey
    hsmType    string
}

type CloudHSMBackend struct {
    mu           sync.RWMutex
    endpoint     string
    clusterID    string
    keyHandle    uint32
    sessionToken string
    hsmModel     string // "AWS_CloudHSM_v3" or "YubiHSM2_PKCS11"
    enclave      *MemoryEnclaveHSM // Software enclave fallback/driver
}
```

### Forensic Deficiencies:
1. **Software Delegation (Line 103):** 
   When `CloudHSMBackend.Sign(data)` is invoked, it executes:
   ```go
   return c.enclave.Sign(data)
   ```
   Which resolves to `ed25519.Sign(m.privateKey, data)` (Line 52). No network packet or PKCS#11 RPC is transmitted to an external hardware device.
2. **Key Material in User Memory (Line 13 & Line 81):**
   The constructor `NewCloudHSMBackend(..., privKey ed25519.PrivateKey)` takes the plaintext private key as an argument. In a genuine HSM deployment, the private key is generated *inside* the hardware module and can **never** be exported or passed across the host interface in plaintext.
3. **Absence of PKCS#11 CGO Dynamic Linking:**
   The `chain` binary is compiled with pure Go without CGO dependencies on `libcloudhsm_pkcs11.so` or `libyubihsm.so`.

---

## 3. COMPLIANCE & GAP ANALYSIS MATRIX

| Security Criterion | Industry Standard (FIPS 140-2 L3) | Phase 15 Claimed Status | Phase 15.1 Audited Reality | Gap / Finding |
| :--- | :--- | :--- | :--- | :--- |
| **Physical Enclosure** | Tamper-evident, tamper-resistant coating | AWS / YubiHSM Hardware | Local Host Motherboard / RAM | **0% Hardware Protection** |
| **Key Generation** | TRNG inside hardware boundary | Enclave TRNG | `crypto/rand` in Go software | Host-memory generated |
| **Key Non-Exportability**| Hardware prevents private key export | Non-exportable | Private key is a standard Go byte slice | **Memory Dump Extractable** |
| **Hardware Attestation** | Signed attestation certificate (CA) | Attested | Plaintext string ("AWS_CloudHSM_v3") | No cryptographic attestation |
| **PKCS#11 Protocol** | OASIS PKCS#11 v2.40 cryptographic API | Active | Emulated Go struct methods | No PKCS#11 implementation |
| **Audit Logging** | Cryptographically chained HSM firmware logs| Audit logs | Standard node console stdout/stderr | Host-compromisable logs |

---

## 4. ATTACK VECTOR & THREAT MODEL ANALYSIS

Under the current implementation, an adversary who gains read access to the host operating system or process memory space can:
1. **Core Dump Extraction:** Trigger a process core dump (`gcore` or Windows ProcDump) and extract the 32-byte Ed25519 seed from the `MemoryEnclaveHSM.privateKey` slice.
2. **Debugger Interception:** Attach a debugger (e.g. Delve, GDB, WinDbg) to the running `sovrad` process and read memory at the pointer referenced by `enclave.privateKey`.
3. **Arbitrary Signing:** Bypass the `CloudHSMBackend.sessionToken` check simply by invoking the memory enclave directly or overwriting the struct field in memory.

---

## 5. MANDATORY HARDWARE MIGRATION REQUIREMENTS

Before remote testnet nodes can be authorized with production HSM protection, the following must be delivered:
1. **True CGO / PKCS#11 Integration:** Implement Go PKCS#11 bindings (e.g., `miekg/pkcs11`) that load the vendor PKCS#11 dynamic shared library.
2. **Hardware Key Pair Generation:** Keys must be generated using `C_GenerateKeyPair` with the `CKA_EXTRACTABLE` attribute set to `CK_FALSE` and `CKA_SENSITIVE` set to `CK_TRUE`.
3. **Remote AWS CloudHSM Client Daemon:** If deploying on AWS, the AWS CloudHSM client daemon must be configured with a validated mutual-TLS client certificate, connecting to a provisioned CloudHSM cluster.
4. **Hardware Attestation Verification:** An automated script must query and verify the HSM public key attestation root of trust prior to registering the validator on-chain.

---

## 6. CONCLUSION & RELEASE AUTHORITY ORDER

The HSM implementation in `chain/privval/hsm.go` is certified as an **In-Memory Software Enclave Driver suitable solely for local integration testing**.

**RELEASE ORDER:**
- **Remote Testnet HSM Authorization:** **DENIED / WITHDRAWN**
- **Action Required:** Update operational documentation to remove claims of active physical HSM deployment.
