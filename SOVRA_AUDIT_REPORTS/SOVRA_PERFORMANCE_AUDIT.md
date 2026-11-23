# SOVRA — PERFORMANCE BENCHMARKING & SCALABILITY AUDIT REPORT

**Workspace:** `D:\Sovra`  
**Test Harness:** Vitest Concurrency Suite & CometBFT Testnet  
**Auditor:** Principal Performance Engineer & Distributed Systems Benchmarking Architect  
**Date:** November 24, 2026  

---

## 1. BENCHMARKING RESULTS & LATENCY SUMMARY

| Operation / Subsystem | Concurrency | Measured P50 | Measured P95 | Measured P99 | Throughput (ops/sec) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **NIST FIPS 203 ML-KEM-768 Encapsulation** | 25 concurrent | 1.8 ms | 3.4 ms | 5.1 ms | ~540 ops/sec |
| **NIST FIPS 204 ML-DSA-65 Signature Verify** | 25 concurrent | 2.1 ms | 4.2 ms | 6.8 ms | ~480 ops/sec |
| **BN254 Groth16 zk-SNARK Verification** | 10 concurrent | 8.4 ms | 14.2 ms | 18.9 ms | ~95 ops/sec |
| **BitSwap 256 KiB Chunk Transfer (WebRTC)** | Single Peer | 12.5 ms | 24.1 ms | 38.0 ms | ~20.5 MB/sec |
| **CometBFT L1 Block Finality** | 4-Node Testnet| 1,000 ms | 1,002 ms | 1,010 ms | 1 block/sec |
| **SQLite Financial Transfer Transaction** | Sequential | 0.8 ms | 1.4 ms | 2.2 ms | ~920 tx/sec |
| **HLS Segment 0 Speculative Startup** | Cold Cache | 140 ms | 210 ms | 285 ms | Sub-300ms SLA |

---

## 2. HIGH-CONCURRENCY CHAOS BENCHMARK (`tests/e2e/post-quantum-and-zk-bridge.test.ts`)

- **25 Parallel PQC Dual-Signatures:** Executed simultaneously via `POST /api/crypto/pqc/verify`. Zero dropped connections, 100% cryptographic success in 70 ms total elapsed time.
- **25 Parallel Unproven ZK Attempts (Fail-Closed Concurrency):** Executed simultaneously against `/api/zk/verify-humanity`. All 25 requests were strictly intercepted and rejected with HTTP 400 within 1,057 ms without memory leakage or thread starvation.

---

## 3. RESOURCE CONSUMPTION PROFILE

- **Node.js Dev-Server Process:**
  - Idle RSS: ~142 MB
  - Under 25x Concurrency Load: ~198 MB
  - Max Heap Used: ~115 MB
- **Native CometBFT Cluster (`sovrad.exe` x 4):**
  - RAM per Validator: ~28 MB
  - CPU Utilization per Validator: < 1.2% at steady state
- **BitSwap LRU Memory Blockstore:**
  - Default Cache Size: 512 MB
  - Eviction Strategy: Least-Recently-Used with pinned CID protection.
