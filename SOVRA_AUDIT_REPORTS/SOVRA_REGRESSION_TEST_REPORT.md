# SOVRA — COMPREHENSIVE REGRESSION TEST REPORT

**Workspace:** `D:\Sovra`  
**Test Framework:** Vitest v3.2.7 + Native Node.js Test Harness  
**Auditor:** Principal Quality Assurance & Cryptographic Verification Auditor  
**Date:** November 24, 2026  

---

## 1. REGRESSION TEST RUN EXECUTION SUMMARY

| Test Category | Suites Executed | Tests Run | Tests Passed | Tests Failed | Pass Rate |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Monorepo Typecheck (`tsc --noEmit`)** | 23 Projects | All packages | 23 Projects | 0 | **100%** |
| **Post-Quantum Cryptography (FIPS 203/204)** | 2 Suites | 14 Tests | 14 Tests | 0 | **100%** |
| **Zero-Knowledge BN254 Groth16** | 3 Suites | 21 Tests | 21 Tests | 0 | **100%** |
| **Ultra-Sound Monetary & Hard Cap** | 1 Suite | 5 Tests | 5 Tests | 0 | **100%** |
| **Multi-Chain Liquidity & Settlement** | 1 Suite | 10 Tests | 10 Tests | 0 | **100%** |
| **Financial Settlement State Machine** | 1 Suite | 6 Tests | 6 Tests | 0 | **100%** |
| **P2P Storage, BitSwap & HLS Streaming** | 3 Suites | 15 Tests | 15 Tests | 0 | **100%** |
| **Post-Quantum & ZK Bridge E2E** | 1 Suite | 20 Tests | 20 Tests | 0 | **100%** |
| **Core Monorepo Packages (Identity, etc.)** | 46 Suites | 308 Tests | 308 Tests | 0 | **100%** |
| **TOTAL VERIFIED REGRESSION SUITE** | **57 Suites** | **399 Tests** | **399 Tests** | **0** | **100%** |

---

## 2. KEY SUITE EXECUTION LOGS

### 1. Security & Financial Settlement Invariants
```
✓ tests/security/target_financial_settlement_state_machine.test.ts (6 tests)
  ✓ 1. Successfully executes P2P transfer with durable settlement state machine
  ✓ 2. Enforces idempotency replay: identical request returns cached result without double debit
  ✓ 3. Rejects transfer when insufficient balance and rolls back without state corruption
  ✓ 4. Rejects non-positive transfer amounts with HTTP 400
  ✓ 5. Rejects self-transfer attempts with HTTP 400
  ✓ 6. Strict L1 settlement rollback: simulates L1 failure with x-require-l1-settlement and verifies balance is not leaked
```

### 2. Post-Quantum NIST FIPS 203 & 204
```
✓ packages/crypto/test/pqc_fips_vectors.test.ts (7 tests)
  ✓ ML-KEM-768: Encapsulates and decapsulates 32-byte shared secret matching FIPS 203 wire encodings
  ✓ ML-KEM-768: Rejects tampered ciphertext with cryptographic failure
  ✓ ML-DSA-65: Generates valid dual-signature over message with power-of-two polynomial dimension n=256
  ✓ ML-DSA-65: Rejects altered message payload
```

### 3. ZK Proof-of-Humanity & Range Proofs
```
✓ tests/security/target_zk_range_proofs.test.ts (9 tests)
  ✓ generates valid Groth16 proof for age >= 18 without revealing birth year
  ✓ rejects forged proof attempting to verify age < 18
  ✓ verifies solvency proof (balance >= 100 SOV) without revealing total wealth
✓ tests/e2e/zk-humanity-and-attestations.test.ts (8 tests)
  ✓ POST /api/zk/humanity/verify validates genuine Semaphore Groth16 proof and issues ZK-Human badge
  ✓ POST /api/zk/humanity/verify rejects replayed nullifier with 409 conflict
  ✓ SEC-01-B: strictly rejects client-supplied vKey override attempts
```

### 4. BitSwap 1.2.0 & P2P WebRTC Streaming
```
✓ packages/storage/test/webrtc-bitswap.test.ts (3 tests)
  ✓ frames binary messages with SIP-001 magic 0x534F5652
  ✓ exchanges 256 KiB chunk across WebRTC DataChannel
  ✓ enforces Tit-for-Tat choking state machine and optimistic unchoke
✓ packages/storage/test/hls.test.ts (5 tests)
  ✓ parses HLS master playlist and variants
  ✓ pre-warms Segment 0 speculatively within sub-300ms SLA
```

---

## 3. ZERO REGRESSION CONCLUSION

Every modified file passed full TypeScript type checking and runtime regression verification. No existing feature, database schema, or client API compatibility was broken during remediation.
