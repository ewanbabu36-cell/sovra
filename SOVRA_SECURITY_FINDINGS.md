# SOVRA — FORENSIC SECURITY & VULNERABILITY AUDIT
**Audit Date:** October 8, 2026  
**Auditor:** Staff Security Engineer & Principal Cryptographic Architect  
**Scope:** Complete Codebase, 169 API Endpoints, Native Bridges, Cryptographic Primitives, Docker & Infrastructure  

---

## 1. THREAT MODEL & SECURITY POSTURE SUMMARY

The Sovra platform is engineered with a hybrid architecture combining sovereign cryptographic identity (`did:key`), decentralized GossipSub/Noise_XX mesh communication, and a centralized development/relay server (`scripts/dev-server.ts`).

While individual cryptographic primitives (Ed25519, ChaCha20-Poly1305, HKDF) are sound when evaluated in isolation, severe architectural and implementation vulnerabilities exist at the API boundary, session management, and native storage layers.

### Critical Vulnerability Summary
```
┌──────────────────────────────┬──────────┬────────────────────────────────────────────────────────┐
│ Vulnerability ID             │ Severity │ Description                                            │
├──────────────────────────────┼──────────┼────────────────────────────────────────────────────────┤
│ SEC-BOLA-01                  │ P0       │ Chat History IDOR / BOLA via unauthenticated userDid   │
│ SEC-RBAC-01                  │ P0       │ Unauthenticated Admin Channel & Page Deletion API      │
│ SEC-DATA-01                  │ P0       │ Automated User Purge Heuristic Wiping Legitimate DIDs  │
│ SEC-AUTH-01                  │ P1       │ Infinite Session Lifetimes (Zero Expiration TTL)       │
│ SEC-CRYPTO-01                │ P1       │ In-Memory Key Derivation Seed Colocated in LocalStorage │
│ SEC-INFRA-01                 │ P1       │ Default Production Secrets in Docker Compose & Coturn  │
│ SEC-DOS-01                   │ P1       │ Reverse Proxy Rate Limiting DoS (Global 429 Cascades)  │
│ SEC-PRIV-01                  │ P1       │ Missing Account & Message Deletion Flows (GDPR Risk)   │
│ SEC-STOR-01                  │ P1       │ Unpinned Media Orphaned on Disk Post-Deletion          │
└──────────────────────────────┴──────────┴────────────────────────────────────────────────────────┘
```

---

## 2. API FORENSIC AUDIT (ENDPOINT-BY-ENDPOINT VULNERABILITIES)

### A. Broken Object Level Authorization (BOLA / IDOR)

#### 1. Vulnerability SEC-BOLA-01: Direct Message History Disclosure
- **Endpoint:** `GET /api/chat/messages`, `GET /api/chat/history`
- **Location:** `scripts/dev-server.ts:30005–30028`
- **CVSS 4.0 Score:** **9.3 (Critical)** — `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:N/VA:N`
- **Vulnerability Mechanism:**
  When `resolvePrincipal(req)` returns `null`, the endpoint extracts the `userDid` parameter from the query string and performs an existence check (`sovraDb.findUserByDid(queryDid)`). If the DID exists, it replaces `userDid` with the target DID and filters messages:
  ```typescript
  messages = messages.filter(
    m => m.recipientDid.startsWith('channel:') || m.senderDid === userDid || m.recipientDid === userDid
  );
  ```
- **Exploitation:**
  An unauthenticated remote attacker can scrape every private message between any two users simply by enumerating public DIDs discovered from the feed or `/api/peers/list`.

---

### B. Broken Function Level Authorization & Missing RBAC

#### 1. Vulnerability SEC-RBAC-01: Unauthorized Administrative Deletions
- **Endpoints:**
  - `POST /api/admin/channels/delete` (`scripts/dev-server.ts:31564`)
  - `POST /api/admin/pages/delete` (`scripts/dev-server.ts:31587`)
  - `POST /api/admin/entities/purge-test` (`scripts/dev-server.ts:31610`)
- **CVSS 4.0 Score:** **9.8 (Critical)** — `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:H/VA:H`
- **Vulnerability Mechanism:**
  These endpoints read the request body, parse JSON, and immediately invoke `sovraDb.deleteChannel(...)` using the hardcoded system authority DID `'did:sovra:system'`. There is no token validation, session check, or role verification.
- **Exploitation:**
  ```bash
  curl -X POST http://target:3001/api/admin/channels/delete \
       -H "Content-Type: application/json" \
       -d '{"channelId":"ch-alpha"}'
  ```
  The core system announcement channel is permanently deleted.

---

### C. Authentication & Session Security

#### 1. Vulnerability SEC-AUTH-01: Non-Expiring Session Tokens
- **Location:** `scripts/database-engine.ts:595–606`, `scripts/dev-server.ts:26045–26062`
- **Vulnerability Mechanism:**
  The session record schema stores only `createdAt` and `lastActiveAt`. There is no `expiresAt` property. When a token is resolved in `findUserBySessionToken`, it only checks:
  ```typescript
  const activeSession = (this.db.user_sessions || []).find(s => s.token === token && !s.isRevoked);
  ```
- **Risk:**
  Session tokens never expire. A token stolen from network logs, browser storage, or client compromise remains permanently usable.

#### 2. Session Revocation Propagation
- While `sovraDb.isSessionRevoked(token)` exists, revoked sessions are tracked in a transient in-memory array that is only persisted if `sovraDb.save()` is called before process termination. A server crash can un-revoke tokens.

---

### D. Cryptography & Key Management

#### 1. Vulnerability SEC-CRYPTO-01: Flawed Key Store Architecture
- **Location:** `apps/sovra-mobile/src/services/secure-keystore.ts:215–233`
- **Claimed Architecture:** "Cryptographically Hardened Mobile Key Storage Adapter with AEAD Encryption at Rest."
- **Actual Implementation Reality:**
  1. The vault key is derived using HKDF:
     ```typescript
     private deriveVaultKey(salt: Uint8Array, did: string): Uint8Array {
       const deviceSeed = this.getOrCreateDeviceSeed();
       const info = new TextEncoder().encode(`sovra:keystore:v1:${did}`);
       return hkdfDerive(deviceSeed, salt, info, 32);
     }
     ```
  2. The `deviceSeed` is generated and saved directly to `localStorage`:
     ```typescript
     this.setItem(DEVICE_ENTROPY_KEY, bytesToHex(fresh));
     ```
  3. The encrypted vault (`ciphertextHex`, `saltHex`, `nonceHex`) is saved to the same `localStorage` under `sovra_secure_key_vault_v1`.
- **Finding:**
  This is application-level software obfuscation, NOT a hardware-backed keystore. The key derivation seed and the ciphertext reside in the same plaintext storage partition. Any malicious third-party script, WebView inspector, or file access can extract both values, derive the key, and recover the user's Ed25519 private key.
- **Hardware Keystore Reality:**
  - Android Keystore is **NOT** used (no `KeyGenParameterSpec`, no Android hardware TEE/StrongBox).
  - iOS Keychain / Secure Enclave is **NOT** used (no `kSecClassGenericPassword`, no `kSecAttrAccessibleAfterFirstUnlock`).

---

### E. Infrastructure & Deployment Security

#### 1. Vulnerability SEC-INFRA-01: Hardcoded Secrets in Production Deployment Manifests
- **Location:** `docker/docker-compose.production.yml:21`, `docker/turnserver.conf:26`
- **Finding:**
  ```yaml
  ADMIN_SECRET_KEY=${ADMIN_SECRET_KEY:-sovra-production-admin-secret-key-32chars!}
  SOVRA_TURN_SECRET=${SOVRA_TURN_SECRET:-sovra-dev-turn-secret-change-in-prod-replace-with-env!}
  ```
  If an operator runs `docker compose -f docker-compose.production.yml up`, and forgets to export `ADMIN_SECRET_KEY`, the server initializes with a known public secret. An attacker can immediately authenticate as `SUPER_ADMIN` via `/api/admin/login` or execute emergency panic wipes via `/api/admin/panic`.

#### 2. Vulnerability SEC-DOS-01: Ingress Rate Limiting Flaw
- **Location:** `scripts/dev-server.ts:26108–26120`
- **Finding:**
  ```typescript
  const clientIp = req.socket.remoteAddress || '127.0.0.1';
  if (!rateLimiter.consume(clientIp)) { ... }
  ```
  Behind reverse proxies (Caddy, Nginx, AWS ALB), all client sockets originate from the reverse proxy IP. The token bucket (`200` requests with `40` burst) applies globally to the proxy IP. An attacker making 200 rapid requests triggers HTTP 429 for all legitimate users worldwide.

---

### F. Privacy & Data Governance (GDPR Compliance)

1. **Right to Erasure (Article 17 GDPR):**
   - No user deletion endpoint (`/api/user/delete`) exists.
   - No message deletion endpoint exists.
   - When a post is deleted via `/api/feed/delete`, the media binary remains in `.sovra-storage-dev` and blockstore indefinitely.
2. **Metadata Leakage in Logging:**
   - Client IPs, user DIDs, and message IDs are logged to stdout without masking.
