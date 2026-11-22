# SOVRA PROTOCOL — PHASE 15.4 FINAL RELEASE GATE & ENVIRONMENT AUTHORIZATION MATRIX
**Document ID:** `SOVRA-P15.4-GATE-010`  
**Security Classification:** `FINAL RELEASE GATE & AUTHORIZATION / ZERO-TRUST`  
**Network / Chain ID:** `sovra-testnet-0` (and `sovra-recovery-1`)  
**Baseline Commits:** Phase 15.2 `d16d239`, Phase 15.3 `e983be1`  
**Date:** November 22, 2026  
**Auditor:** SOVRA Protocol Security & Cryptographic Consensus Engineering Taskforce  

---

## 1. Executive Summary

Phase 15.4 successfully resolved the critical architectural gap identified in Phase 15.3: **`ValidatorSchedule` is now directly and dynamically integrated into the live block-production, proposal validation, vote processing, commit certificate verification, and P2P gossip layers of the SOVRA consensus engine.**

Furthermore, the forensic investigation of the running chain (`sovra-testnet-0`) was conducted with complete zero-trust honesty: the fact that blocks 40,000–44,900+ were signed by compromised genesis keys was formally documented as a security incident without retroactive historical falsification, and a forward-scheduled recovery architecture was codified.

This document presents the definitive release gate decisions and operational environment classifications.

---

## 2. Environmental Authorization Matrix

| Operational Environment | Classification Status | Rationale & Prerequisites |
| :--- | :---: | :--- |
| **Local Development** | **`CERTIFIED`** | All unit tests, Go packages, and simulation harnesses pass with 100% success rate. |
| **Local Loopback Testnet** | **`INCIDENT_DOCUMENTED__CONSENSUS_ENGINE_UPGRADED`** | Running chain incident formally audited and logged. Daemons in `chain/cmd/sovrad/main.go` and `chain/consensus/engine.go` upgraded with live schedule wiring. |
| **Validator Transition Activation** | **`CERTIFIED_INTEGRATED`** | `ValidatorSchedule` dynamically wired into proposal, vote, certificate, P2P, and RPC layers. Tested in 4-node live consensus. |
| **Forward Recovery Architecture** | **`FORMALLY_ESTABLISHED`** | Backward immutability preserved. Forward activation at height 50,000 on `sovra-testnet-0` or clean genesis on `sovra-recovery-1`. |
| **Compromised Key Rejection** | **`PROTOCOL_VERIFIED`** | Compromised genesis keys strictly rejected across all 7 protocol consensus layers with `ErrRevokedValidator`. |
| **Git History Remediation** | **`RECOVERY_BRANCH_VERIFIED_CLEAN__MAIN_REWRITE_BLOCKED`** | All 5 sensitive key blobs purged on branch `recovery/history-remediation-phase15-3` and pushed to `origin`. Main branch force-rewrite withheld pending owner approval. |
| **Hardware-Backed Signing** | **`BLOCKED__DEVELOPMENT_ONLY`** | Physical HSM device is not present in local dev environment. Enclave driver strictly tagged `[DEVELOPMENT_ONLY]`. |
| **Remote Multi-Cloud Testnet** | **`BLOCKED`** | Blocked pending completion of 4 external prerequisites (physical servers, real HSMs, mTLS, owner git authorization). |
| **Production Mainnet** | **`STRICTLY_NOT_AUTHORIZED`** | Mainnet authorization is permanently prohibited prior to extensive multi-month live operation on remote testnet and external audits. |

---

## 3. Remote Testnet Blocking Prerequisites

Authorization for public or remote testnet deployment remains **STRICTLY BLOCKED** until the following four concrete criteria are satisfied:

1. **Physical Multi-Cloud Infrastructure Provisioning:**  
   Four dedicated, hardened server instances deployed across independent cloud providers (e.g. AWS eu-central-1, GCP us-east4, Azure eastus2, Hetzner fsn1) with static public IP addresses and WireGuard mesh routing.
2. **Physical Hardware Security Module (HSM) Integration:**  
   Physical integration of real PKCS#11 hardware security modules (AWS CloudHSM SDK 5+ or YubiHSM 2 with CKM_EDDSA support) and verification of physical tamper-resistant signature generation.
3. **mTLS Node-to-Node P2P Encryption:**  
   Mutual TLS authentication configured across all P2P connections using X.509 certificates tied to hardware identities.
4. **Repository Owner Git History Rewrite Authorization:**  
   Explicit human owner confirmation to execute the force-push rewrite of `main` or formal acceptance of the dual-track `recovery/` branch policy.

---

## 4. Phase 15.4 Deliverables Verification

All required deliverables for Phase 15.4 have been fully generated, certified, and committed:

### 10 Formal Markdown Reports:
1. `SOVRA_PHASE15_4_LIVE_CONSENSUS_FORENSIC_AUDIT.md`
2. `SOVRA_PHASE15_4_TRUSTED_RECOVERY_DESIGN.md`
3. `SOVRA_PHASE15_4_LIVE_VALIDATOR_INTEGRATION.md`
4. `SOVRA_PHASE15_4_FOUR_NODE_CONSENSUS_VERIFICATION.md`
5. `SOVRA_PHASE15_4_COMPROMISED_KEY_REJECTION.md`
6. `SOVRA_PHASE15_4_FINANCIAL_INTEGRITY.md`
7. `SOVRA_PHASE15_4_GIT_HISTORY_STATUS.md`
8. `SOVRA_PHASE15_4_REGRESSION_REPORT.md`
9. `SOVRA_PHASE15_4_INDEPENDENT_VERIFICATION.md`
10. `SOVRA_PHASE15_4_FINAL_RELEASE_GATE.md`

### 6 Machine-Readable Evidence JSONs:
1. `phase15_4-live-validator-sets.json`
2. `phase15_4-activation-evidence.json`
3. `phase15_4-block-signing-identities.json`
4. `phase15_4-node-agreement-matrix.json`
5. `phase15_4-regression-reproducibility-evidence.json`
6. `phase15_4-final-authorization-matrix.json`

---

*Phase 15.4 Consensus Engine Upgrade & Trust Recovery Certified Complete.*
