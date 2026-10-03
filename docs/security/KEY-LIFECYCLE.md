# SOVRA Cryptographic Key Lifecycle & Storage Matrix

## 1. Key Taxonomy & Architectural Distinction

To eliminate dangerous ambiguities, Sovra strictly distinguishes six distinct cryptographic key concepts:

```
+--------------------------------------------------------------------------------------------------------+
|                                      KEY ROLE TAXONOMY & PURPOSE                                       |
+--------------------------------------------------------------------------------------------------------+
  |                        |                          |                          |                      |
  v                        v                          v                          v                      v
[1. Identity Key]        [2. Device Key]            [3. Signing Key]           [4. Key-Agreement Key] [5. Session Key]
- Root Ed25519           - Delegated Ed25519        - Action Signature         - X25519 DH            - Ephemeral Ratchet
- Controls DID           - Physical hardware bound  - Event validation         - Channel secret       - Forward secrecy
- Lifetime: Multi-year   - Lifetime: 6-12 months    - Lifetime: Per delegation - Lifetime: 1-3 months - Lifetime: Minutes/Hours
```

---

## 2. Key Lifecycle Specification Matrix

| Key Type                        | Cryptographic Algorithm         | Primary Purpose                                                                         | Standard Lifetime                          | Secure Platform Storage                                                                                                                                              | Rotation Mechanism                                         | Compromise Response                                                                              |
| :------------------------------ | :------------------------------ | :-------------------------------------------------------------------------------------- | :----------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| **1. Identity Key ($IK$)**      | Ed25519 (RFC 8032)              | Root identity authority, issuing device delegations, recovery plan definitions          | Multi-year or indefinite                   | **Browser:** Non-extractable WebCrypto in encrypted IndexedDB.<br>**Desktop:** OS Credential Store (DPAPI/Keychain).<br>**Mobile:** iOS Keychain / Android Keystore. | Dual-signed `KeyRotationAssertion` ($IK_{old} + IK_{new}$) | Immediate execution of M-of-N Threshold Guardian Recovery; revoke old key across network.        |
| **2. Device Key ($DK$)**        | Ed25519 (RFC 8032)              | Signing day-to-day protocol events and messages on behalf of a specific hardware client | 6 to 12 months (enforced via `validUntil`) | Stored strictly in local hardware secure enclave / TPM / local key store. **Never synced between devices.**                                                          | Routine delegation renewal issued by Identity Key          | Root Identity Key publishes signed `RevocationAssertion`. All peers drop actions signed by $DK$. |
| **3. Signing Key**              | Ed25519 (RFC 8032)              | Cryptographic signature production role (used by Identity Key or Device Key)            | Inherited from parent role                 | Non-extractable memory structure                                                                                                                                     | Inherited from parent role                                 | Revoke via parent delegation revocation                                                          |
| **4. Key-Agreement Key ($KA$)** | X25519 (RFC 7748)               | Diffie-Hellman key exchange for establishing symmetric encryption keys between peers    | 1 to 3 months (Prekey rotation)            | Local encrypted keystore                                                                                                                                             | Publish updated signed PreKey bundles                      | Replace PreKey bundle; discard old private scalar                                                |
| **5. Session Key ($SK$)**       | ChaCha20-Poly1305 / AES-256-GCM | Symmetric encryption of individual transport frames or E2EE message payloads            | Ephemeral (single message or ratchet step) | Ephemeral RAM only; zero disk persistence; memory overwritten with zeros after use                                                                                   | Continuous Double Ratchet evolution per message            | Ephemeral; past messages protected by Forward Secrecy; future sessions self-heal via DH ratchet  |
| **6. Guardian Key ($GK$)**      | Ed25519 (RFC 8032)              | Authorizing identity recovery for a protected peer                                      | Managed independently by the guardian      | Guardian's own local identity key store                                                                                                                              | Replaced by user updating `RecoveryPlan`                   | User revokes compromised guardian and updates threshold plan                                     |

---

## 3. Platform Secure Storage Architecture

Guarantees vary by operating system and client environment. Sovra applies defense-in-depth per platform:

### 3.1 Web Browser Runtimes

- **Challenge:** Web environments lack hardware enclaves and are vulnerable to malicious extensions.
- **Mechanism:**
  - Root and device keys are generated as non-extractable WebCrypto `CryptoKey` handles where supported.
  - When raw seeds must be persisted locally in IndexedDB, they are encrypted with `AES-256-GCM`.
  - The Key Encryption Key (KEK) is derived using Argon2id from a user-supplied high-entropy passphrase with unique salt.
  - Plaintext key buffers are pinned to scoped closures and scrubbed on unload.

### 3.2 Desktop Runtimes (Windows, macOS, Linux)

- **Windows:** Windows Data Protection API (DPAPI) + Credential Manager. Keys are tied to user login credentials and TPM.
- **macOS:** macOS Keychain Services with Access Control Lists requiring user presence.
- **Linux:** Secret Service API (libsecret / GNOME Keyring / KWallet) backed by system PAM.

### 3.3 Mobile Runtimes (iOS & Android)

- **iOS:** Keychain Services backed by the **Secure Enclave processor (SEP)** (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`).
- **Android:** Android Keystore Provider backed by StrongBox Keymaster hardware security module (HSM).

---

## 4. Leakage Prevention & Redaction Controls

1. **Zero Serialization of Secrets:** Key management classes override `.toJSON()` to omit private key bytes.
2. **Automated Log Redaction:** The `@sovra/shared` logging engine automatically matches and replaces private key parameters with `[REDACTED]`.
3. **Zero Network Transmission:** Private keys are never serialized into protocol events, GossipSub messages, IPFS blocks, or HTTP headers.
