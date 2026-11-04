# SOVRA — DEPENDENCY INVENTORY & SUPPLY CHAIN SECURITY AUDIT

**Audit Date**: 2026-11-04  
**Audit Entity**: DevSecOps & Software Supply Chain Integrity Group  
**Auditor Roles**: Senior Application Security Engineer & DevOps Engineer  
**Classification**: High Priority Risk Assessment  
**Evaluation Status**: PARTIALLY VERIFIED (No lockfile integrity check runnable via npm audit)

---

## 1. WORKSPACE DEPENDENCY TOPOLOGY

The SOVRA repository uses **pnpm workspaces** defined via `pnpm-workspace.yaml` and locked with `pnpm-lock.yaml` (83.6 KB).

### Supply Chain Risk Note:
> [!CAUTION]
> The build environment contains `npm` (v11.17.0) and `node` (v24.21.0), but does **NOT** have `pnpm` installed in the system PATH. Running `npm audit` fails with `ENOLOCK` because `package-lock.json` is missing. Standard automated CI/CD dependency vulnerability scans using `npm audit` are completely non-functional without generating a root lockfile or installing pnpm.

---

## 2. PRODUCTION CRYPTOGRAPHIC DEPENDENCIES

The core cryptographic operations rely on the `@noble` suite developed by Paul Miller (scure/noble). These packages are audited, zero-dependency, and widely regarded as industry gold-standards in the Web3 and cryptography ecosystem:

| Package | Version | Usage Location | Security Assessment |
| :--- | :--- | :--- | :--- |
| **`@noble/curves`** | `^1.4.0` | `packages/crypto`, `packages/identity` | **VERIFIED**: Provides RFC 8032 Ed25519 signatures and RFC 7748 X25519 ECDH key exchange. |
| **`@noble/ciphers`** | `^0.4.0` | `packages/crypto`, `packages/messaging` | **VERIFIED**: Provides ChaCha20-Poly1305 AEAD authenticated encryption. |
| **`@noble/hashes`** | `^1.4.0` | `packages/crypto`, `packages/protocol` | **VERIFIED**: Provides SHA-256, SHA-512, HKDF, and BLAKE3 hash functions. |
| **`@scure/bip39`** | `^1.3.0` | `packages/identity` | **VERIFIED**: Provides English wordlist BIP-39 mnemonic phrase derivation. |
| **`@scure/base`** | `^1.1.6` | `packages/identity`, `packages/storage` | **VERIFIED**: Provides Base58 and Base64 multibase encoding formats. |

---

## 3. IDENTIFIED DEPENDENCY GAPS & MISSING RUNTIMES

Our AST and runtime audits identified several critical libraries that are referenced in documentation or architectural claims but are **completely absent** from `package.json`:

1. **`snarkjs` / `@semaphore-protocol/proof`**:
   - **Claimed**: Zero-knowledge Semaphore humanity proof generation and verification.
   - **Reality**: Neither package is declared in `package.json` or imported in `scripts/routes/zk.routes.ts`.
   - **Impact**: Server cannot verify Groth16 mathematical proofs on elliptic curves.

2. **`@simplewebauthn/server`**:
   - **Claimed**: WebAuthn passkey server verification with PRF extensions.
   - **Reality**: Absent. Dev server performs basic string validation instead of relying on FIDO2/WebAuthn attestation verification libraries.

3. **`redis` / `ioredis`**:
   - **Claimed**: Distributed pub/sub and task queuing for `moderation-worker` and caching.
   - **Reality**: In dev mode, Redis is completely bypassed in favor of in-memory maps.

---

## 4. ROOT WORKSPACE DEPENDENCY MATRIX

| Dependency Name | Type | Target Environment | Audit Risk Level |
| :--- | :--- | :--- | :--- |
| `typescript` | `devDependency` | Build Tooling | Low |
| `tsx` | `devDependency` | Runtime Execution | Low |
| `vite` | `devDependency` | Frontend Bundler | Low |
| `vitest` | `devDependency` | Unit / Integration Tests | Low |
| `tailwindcss` | `devDependency` | CSS Framework | Low |
| `turbo` | `devDependency` | Monorepo Pipeline | Low |
| `node:sqlite` | `Node.js Built-in` | Database Storage | Low (Native Engine) |
| `node:crypto` | `Node.js Built-in` | System Cryptography | Low (OpenSSL Backed) |
| `node:net` | `Node.js Built-in` | P2P TCP Socket | Low (Native Socket) |

---

## 5. SUPPLY CHAIN RECOMMENDATIONS

1. **Install PNPM in CI/CD**: Run `npm install -g pnpm@latest` or configure Corepack (`corepack enable`) to enable `pnpm audit`.
2. **Eliminate Dependency Discrepancy**: Explicitly install `snarkjs` and circomlibjs in `@sovra/crypto` to provide actual SNARK verification.
3. **Pin Dependency Versions**: Shift from permissive caret ranges (`^1.4.0`) to exact version pinning (`1.4.0`) to guard against upstream supply chain poisoning.
