# SOVRA — END-TO-END DATA FLOW MAP & LIFECYCLE AUDIT

**Audit Date**: 2026-11-04  
**Audit Entity**: Multidisciplinary Enterprise Technology Audit Organization  
**Auditor Roles**: Principal Software Architect & Database & Data Integrity Engineer  
**Scope**: Registration, Messaging, Post Creation, Media Storage, and Admin Telemetry

---

## 1. IDENTITY & REGISTRATION DATA FLOW

```mermaid
sequenceDiagram
    autonumber
    actor User as Client Browser / Mobile
    participant Svr as scripts/dev-server.ts (:3001)
    participant Reg as scripts/routes/user (POST /api/user/register)
    participant Crypto as packages/identity (did.ts)
    participant SQLite as sovra-social.sqlite (users & user_sessions)
    participant Wiretap as admin_wiretap_telemetry

    User->>Svr: POST /api/user/register { displayName, handle, bio }
    Svr->>Wiretap: Log IP, timestamp, userAgent, path
    Svr->>Reg: Pass registration payload
    Reg->>Crypto: Generate Ed25519 Keypair & W3C DID (did:key:z6M...)
    Crypto-->>Reg: Return { did, publicKey, privateKey, mnemonic }
    Reg->>SQLite: INSERT INTO users (did, handle, display_name, ...)
    Reg->>SQLite: INSERT INTO user_sessions (session_token, did, expires_at)
    Reg-->>User: HTTP 200 { ok: true, user, token, mnemonic }
```

### Trace Findings:
- Zero Personal Identifiable Information (PII) required: No email or phone fields are sent or written.
- However, step 2 immediately captures client IP and User-Agent in `admin_wiretap_telemetry` table in SQLite.

---

## 2. DIRECT END-TO-END ENCRYPTED MESSAGING FLOW

```mermaid
sequenceDiagram
    autonumber
    actor Alice as Sender (Alice)
    participant Svr as scripts/dev-server.ts
    participant ChatRoute as scripts/routes/chat.routes.ts
    participant Privacy as User Privacy Check (canMessageMe)
    participant DB as SQLite (direct_messages table)
    actor Bob as Recipient (Bob)

    Alice->>Alice: Encrypt plaintext with X25519 ECDH + ChaCha20-Poly1305
    Alice->>Svr: POST /api/chat/send { recipientDid: Bob, ciphertext, ttl: 86400 }
    Svr->>ChatRoute: Route message payload
    ChatRoute->>Privacy: Check Bob's privacy settings & friendship status
    alt Stranger & Bob accepts friends only
        Privacy-->>Alice: HTTP 403 Forbidden ("Recipient only accepts DMs from friends")
    else Friendship Validated or Stranger Accepted
        Privacy->>DB: INSERT INTO direct_messages (id, sender_did, recipient_did, ciphertext, expires_at)
        DB-->>ChatRoute: Record inserted
        ChatRoute-->>Alice: HTTP 200 { ok: true, messageId }
        Svr-->>Bob: WebSocket Push { event: 'new_message', ciphertext, envelope }
        Bob->>Bob: Decrypt ciphertext locally using Alice's public key & Bob's private key
    end
```

### Trace Findings:
- Two-Tier Inbox classification is enforced in server middleware before database write.
- Server acts as an untrusted blind relay for ciphertext; server cannot read payload contents.
- Ephemeral TTL messages: `expires_at` is set, but physical disk deletion occurs lazily during client read sweeps.

---

## 3. CONTENT POSTING & MEDIA ATTACHMENT FLOW

```mermaid
sequenceDiagram
    autonumber
    actor User as Creator
    participant Svr as scripts/dev-server.ts
    participant MediaRoute as scripts/routes/media.routes.ts
    participant Disk as .sovra-storage-dev/ (media / posts)
    participant SQLite as sovra-social.sqlite (posts & analytics)

    User->>Svr: POST /api/media/upload (Multipart image/video binary)
    Svr->>MediaRoute: Inspect MIME type & file signatures
    MediaRoute->>MediaRoute: Calculate SHA-256 / BLAKE3 hash -> CID
    MediaRoute->>Disk: Write binary to .sovra-storage-dev/media/{CID}
    MediaRoute-->>User: HTTP 200 { ok: true, cid, mediaUrl }
    User->>Svr: POST /api/feed/post { text, mediaCids: [CID], tags }
    Svr->>SQLite: INSERT INTO posts (id, author_did, content, media_urls, timestamp)
    SQLite-->>User: HTTP 200 { ok: true, post }
```

### Trace Findings:
- Media files are content-addressed by cryptographic hash.
- File writes are persisted synchronously to `.sovra-storage-dev/media/`.

---

## 4. ADMIN WIRETAP & TELEMETRY FLOW

```mermaid
sequenceDiagram
    autonumber
    actor Client as Any Client Request
    participant Middleware as dev-server.ts res.end Hook
    participant SQLite as sovra-social.sqlite
    participant AdminUI as /admin/panopticon / Wiretap Stream

    Client->>Middleware: Send any HTTP request (except /health & /wiretap)
    Middleware->>Middleware: Intercept res.end and compute latencyMs
    Middleware->>SQLite: INSERT INTO admin_wiretap_telemetry (ip, userAgent, path, latency, did)
    AdminUI->>Middleware: GET /api/admin/wiretap/stream (SSE)
    Middleware-->>AdminUI: Push live telemetry event
```

### Trace Findings:
- Flow is synchronous and executed on every API call.
- Accumulation is unbounded: reached 166,396 records in local test environment.
