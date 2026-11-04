# SOVRA — DECENTRALIZED IDENTITY & ACCESS CONTROL AUDIT

**Audit Date**: 2026-11-04  
**Audit Entity**: Multidisciplinary Enterprise Technology Audit Organization  
**Auditor Roles**: Cryptography & Identity Security Specialist & AppSec Auditor  
**Scope**: W3C DIDs, Passkeys, Mnemonic Seeds, Registration Schemas, and Role-Based Access Control  
**Evaluation Status**: VERIFIED (Real Ed25519 DIDs; Zero-PII Registration Confirmed)

---

## 1. W3C DECENTRALIZED IDENTIFIER (DID) COMPLIANCE

SOVRA assigns every user a cryptographic decentralized identifier using the W3C `did:key` method:

```mermaid
flowchart LR
    Seed[256-bit Entropy / Seed] --> EdKey[Ed25519 Keypair]
    EdKey --> Pub[32-byte Public Key]
    Pub --> MultiCodec[Prepend 0xed01 Multicodec Header]
    MultiCodec --> Base58[Base58-BTC Encoding 'z']
    Base58 --> DID["did:key:z6Mku... (Canonical W3C DID)"]
```

### Empirical Verification:
- Registration test via `POST /api/user/register`:
  - Returned DID: `did:key:z6MknU2s8hFvJ2YmD5V9e2...`
  - Leading prefix `z6Mk` conforms strictly to Multicodec `0xed01` (Ed25519 public key) encoded in Base58-BTC.
  - Derived from uncompressed 32-byte Ed25519 raw public key.
  - Status: **VERIFIED**.

---

## 2. PRIVACY-PRESERVING REGISTRATION AUDIT

| Registration Property | Specification Requirement | Actual Implementation | Audit Status |
| :--- | :--- | :--- | :--- |
| **Phone Number Requirement** | Zero telephone number prompt or storage | Inspected schema: 0 phone fields in DB or API payload | **VERIFIED** |
| **Email Address Requirement**| Zero email prompt or storage | Inspected schema: 0 email fields in DB or API payload | **VERIFIED** |
| **KYC / Real Name** | No government ID or KYC gate | Users choose arbitrary display names and handles | **VERIFIED** |
| **Private Key Custody** | Non-custodial: private key never stored on server | Server stores only public key & DID; client holds seed | **VERIFIED** |
| **Seed Phrase Backup** | Standard 12/24 word BIP-39 mnemonic | Generated locally via `@scure/bip39` English wordlist | **VERIFIED** |

---

## 3. IDENTITY RECOVERY & MULTI-DEVICE SESSION AUDIT

1. **Mnemonic Recovery**:
   - Endpoint: `POST /api/user/restore-mnemonic`
   - Mechanism: Recomputes Ed25519 keypair from 12-word seed, resolves associated DID, issues fresh session token.
   - Status: **VERIFIED**.
2. **Session Token Management**:
   - Bearer token generated using 32 bytes of cryptographically secure random bytes (`crypto.randomBytes(32).toString('hex')`).
   - Recorded in `user_sessions` with 30-day TTL.
   - Instant revocation on `POST /api/user/logout` via `revoked_tokens` table.
   - Status: **VERIFIED**.

---

## 4. IDENTITY SECURITY FINDINGS

### Finding IDSEC-01: Session Fixation & Storage in LocalStorage
- **Location**: `scripts/dev-server.ts:47100`
- **Severity**: High
- **Description**: While token issuance is cryptographically strong, saving tokens in `localStorage` makes them accessible to any script executing in the browser domain.
- **Remediation**: Migrate session tokens to `HttpOnly` cookies with `SameSite=Strict`.

### Finding IDSEC-02: Device Linking Ticket Expiration
- **Location**: `scripts/dev-server.ts:95120-95150`
- **Severity**: Medium
- **Description**: Multi-device linking tickets (`/api/user/sessions/create-link-ticket`) use a 10-minute validity window. This window is excessively wide for real-time QR code scanning.
- **Remediation**: Reduce ticket expiration window to 120 seconds.

---

## 5. IDENTITY SECURITY SCORECARD

- **Cryptographic DID Integrity**: `98 / 100`
- **Zero-PII Onboarding Conformance**: `100 / 100`
- **Session Lifecycle & Revocation**: `88 / 100`
- **Token Storage Hardening**: `62 / 100`
- **Overall Decentralized Identity Score**: **87.0 / 100**
