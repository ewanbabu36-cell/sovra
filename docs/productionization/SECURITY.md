# Sovra — Security & Threat Modeling Specification

## 1. Authentication Security
* **Session Tokens:** High-entropy 192-bit cryptographic strings generated using `crypto.randomBytes(24).toString('hex')` prefixed with `stk_`.
* **Hardware Sessions (`user_sessions`):** Every device login tracks IP address, User-Agent, device name, creation time, and revocation status.
* **Remote Invalidation:** Revoking a session immediately sets `isRevoked = true` in persistent disk storage. Subsequent requests with that token return `401 Unauthorized`.
* **Zero Credential Logging:** Passwords, session tokens, secret keys, and authorization headers are strictly excluded from console logs, debug traces, and audit messages.

---

## 2. Authorization & BOLA / IDOR Defense
* **Central Policy:** `enforceAuth(req, res, parsed)` derives identity exclusively from verified session tokens.
* **Identity Forgery Protection:** If a request body includes `authorDid`, `senderDid`, or `userDid` that does not match `principal.did`, the request is rejected with `403 Forbidden`.
* **Resource Ownership Checks:**
  * Post Deletion: Restricted to `post.authorDid === principal.did` or `principal.role === 'SUPER_ADMIN'`.
  * Post Editing: Restricted strictly to `post.authorDid === principal.did`.
  * Comment Deletion: Restricted to comment author or post author.
  * Direct Messages: Scoped exclusively to conversations where `principal.did` is sender or recipient.

---

## 3. Input Validation & Denial-of-Service Mitigations
* **Bounded Request Streams:** `readBoundedBody()` enforces hard payload limits (64KB for standard endpoints, 25MB for media uploads) preventing heap exhaustion attacks.
* **Rate Limiting:** IP-based sliding window rate limiter protects against brute-force registration, login flood, and API spamming.
* **HTML & XSS Sanitization:** All user text injected into the DOM uses `innerText` or strict character entity escaping.
