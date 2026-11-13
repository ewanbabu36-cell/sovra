# SOVRA — PHASE 1 STANDALONE `services/api` RISK REPORT
**Task ID:** TSK-P0-01 (Microservice Architecture & Latent Exposure Review)  
**Auditor Role:** Senior Application Security Auditor  
**Primary Target:** `services/api/` Subsystem (Controllers, Routes, Middleware, Test Harness)  
**Evaluation Standard:** Zero-Trust Perimeter & Microservice Security  
**Overall Section Verdict:** ❌ **CRITICAL RISK (UNMITIGATED IDENTITY SPOOFING & ZERO TEST COVERAGE)**

---

## 1. ARCHITECTURAL OVERVIEW & LATENT THREAT PROFILE

The SOVRA repository contains two distinct API execution layers:
1. **The Monolithic Runtime:** Hosted in `scripts/dev-server.ts` (using pure Node.js HTTP server and `scripts/routes/admin_features.routes.ts`). This is the runtime where Phase 1 security remediation was focused.
2. **The Standalone Microservice:** Located in `services/api/` (using Express.js, TypeScript, and a modern layered architecture with controllers, routes, and services).

While developer documentation asserted repository-wide identity hardening, our audit discovered that **`services/api` was completely untouched during Phase 1 remediation**. 

### The Latent Activation Threat
In modern microservice and containerized environments, code left unhardened in a subpackage represents an existential threat:
- `services/api/Dockerfile` exists, allowing automated CI/CD pipelines or Helm charts to build and deploy this service.
- If an API gateway, ingress controller (e.g. NGINX, Cloudflare, Traefik), or Kubernetes service routes external traffic to `services/api:3000` instead of `dev-server.ts:3001`, **all cryptographic protections implemented in Phase 1 are completely bypassed**.

---

## 2. FORENSIC AUDIT OF `services/api` CONTROLLERS

A line-by-line inspection of `services/api/src/controllers/` revealed that arbitrary, unverified HTTP headers and body parameters are trusted directly for authentication and authorization.

### 2.1 Wallet Controller (`services/api/src/controllers/wallet.controller.ts`)
```typescript
// Line 63 - getBalance
export const getBalance = async (req: Request, res: Response) => {
  const userDid = (req.headers['x-sovra-did'] as string) || 'default_user';
  const balance = await walletService.getBalance(userDid);
  res.json({ success: true, balance });
};

// Line 91 - transferTokens
export const transferTokens = async (req: Request, res: Response) => {
  const senderDid = (req.headers['x-sovra-did'] as string) || 'default_user';
  const { recipientDid, amount } = req.body;
  const result = await walletService.transfer(senderDid, recipientDid, amount);
  res.json({ success: true, transactionId: result.id });
};
```
- **Auditor Analysis:**
  - Zero cryptographic signature verification.
  - Zero session token validation.
  - An attacker simply sets `X-Sovra-DID: did:sovra:treasury` or any whale address to drain balances or query private financial ledger states.
  - The fallback to `'default_user'` allows unauthenticated callers without any headers to interact with shared state.
- **Severity:** **CRITICAL (CVSS 9.8)**.

---

### 2.2 Social Controller (`services/api/src/controllers/social.controller.ts`)
```typescript
// Line 159 - createPost
export const createPost = async (req: Request, res: Response) => {
  const { authorDid, content, mediaUrls } = req.body;
  if (!authorDid) {
    return res.status(400).json({ error: 'authorDid is required' });
  }
  const post = await socialService.publishPost(authorDid, content, mediaUrls);
  res.json({ success: true, post });
};
```
- **Auditor Analysis:**
  - The endpoint takes `authorDid` directly from the untrusted JSON request body!
  - Any attacker can publish posts, impersonate public figures, or generate disinformation under another user's identity.
- **Severity:** **HIGH (CVSS 8.2)**.

---

### 2.3 Chat Controller (`services/api/src/controllers/chat.controller.ts`)
```typescript
// Line 88 - getMessages
export const getMessages = async (req: Request, res: Response) => {
  const callerDid = (req.headers['x-sovra-did'] as string);
  const { threadId } = req.params;
  const messages = await chatService.fetchThread(threadId, callerDid);
  res.json({ success: true, messages });
};
```
- **Auditor Analysis:**
  - Private encrypted chats and communication logs are accessible simply by presenting the target user's DID in the header.
- **Severity:** **CRITICAL (CVSS 8.6)**.

---

### 2.4 Auth Controller (`services/api/src/controllers/auth.controller.ts`)
```typescript
// Line 125 - issueToken
export const issueToken = async (req: Request, res: Response) => {
  const { handle } = req.body;
  const token = jwtService.sign({ handle, role: 'USER' });
  res.json({ success: true, token });
};
```
- **Auditor Analysis:**
  - Mints valid JWTs for any arbitrary user handle without requiring password authentication, private key ownership proof, or challenge-response verification.
- **Severity:** **CRITICAL (CVSS 9.8)**.

---

## 3. MIDDLEWARE ASSESSMENT (`services/api/src/middleware/`)

Inspection of `services/api/src/middleware/security.middleware.ts` revealed that a preliminary DID authentication middleware exists:
```typescript
export const authenticateDID = (req: Request, res: Response, next: NextFunction) => {
  const did = req.headers['x-sovra-did'];
  if (!did) {
    return res.status(401).json({ error: 'X-Sovra-DID header required' });
  }
  // Missing cryptographic verification; merely checks header existence
  (req as any).user = { did };
  next();
};
```
- **Auditor Finding:**
  1. The existing middleware only checks for the **presence** of the string `X-Sovra-DID`. It performs **zero Ed25519 signature checks**, zero replay checks, and zero database lookups!
  2. Even worse, this middleware is **not mounted globally** in `services/api/src/routes/index.ts`. Multiple route groups bypass it entirely.

---

## 4. TEST HARNESS FORENSIC AUDIT (VITEST EXIT CODE 1)

During verification, Vitest was run against `services/api`:
- **Command:** `npx vitest run services/api`
- **Output:**
  ```text
  No test files found, exiting with code 1
  FAIL  services/api
  ```
- **Auditor Analysis:**
  - The developer's Phase 1 report gave the impression that all services were covered by automated verification.
  - In reality, `services/api` contains **zero test files** (`.test.ts` or `.spec.ts`).
  - Vitest defaults to returning exit code 1 when no matching test files are found.
  - This demonstrates that `services/api` is completely unmonitored by CI/CD security regression suites.

---

## 5. IMMEDIATE CONTAINMENT & REMEDIATION ROADMAP

Until `services/api` is secured, it represents an imminent security vulnerability.

### Immediate Containment Steps:
1. **Disable Ingress / Container Build:**
   - Add a warning banner to `services/api/README.md`.
   - Ensure `docker-compose.yml` or production Helm charts do NOT expose `services/api` to external traffic.
2. **Shared Security Middleware:**
   - Extract the cryptographic verification logic from `scripts/dev-server.ts` into a shared package (`packages/security` or `packages/auth`).
   - Import and mount this middleware globally in `services/api/src/app.ts`:
     ```typescript
     app.use(sovraCryptographicAuthMiddleware);
     ```
3. **Refactor Controllers:**
   - Eliminate all references to `req.headers['x-sovra-did']` and `req.body.authorDid` in controllers.
   - Enforce reading caller identity exclusively from `req.authenticatedPrincipal.did`.
4. **Author Security Regression Test Suite:**
   - Create `services/api/test/security/auth-bypass.test.ts` verifying that requests lacking Ed25519 signatures are rejected with HTTP 401 across all endpoints.
