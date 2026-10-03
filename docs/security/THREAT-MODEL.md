# SOVRA Comprehensive Security Threat Model

## 1. Scope, Methodology & Security Philosophy

This document defines the formal threat model for **Sovra**, covering both **Product A (End-User Product & Protocol)** and **Product B (Company Operations Admin Panel)**.

### 1.1 Methodology

We apply a hybrid threat modeling framework combining:

- **STRIDE:** Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege.
- **DREAD:** Damage potential, Reproducibility, Exploitability, Affected users, Discoverability (scoring from 1 to 10).
- **Decentralized Adversary Models:** Evaluating malicious peers, rogue relays, sybil swarms, and compromised corporate infrastructure.

### 1.2 Core Trust Assumptions & Non-Assumptions

1. **Zero Trust in Relays:** Relays are treated as untrusted network couriers. Relays MUST NOT be able to read message plaintext or forge user signatures.
2. **Zero Trust in Central Admin:** The failure, compromise, or malicious takeover of the Company Admin Panel must not compromise the integrity of the decentralized protocol, user identities, or historical signed events.
3. **Untrusted Client Runtimes:** Browser environments are considered hostile. Private keys stored in browser storage require encryption at rest using hardware-backed or passphrase-derived keys.
4. **No Custom Cryptography:** All cryptographic operations rely strictly on audited, industry-standard primitives (Ed25519, X25519, ChaCha20-Poly1305, AES-256-GCM, BLAKE3, SHA-256).

---

## 2. Threat Vector Breakdown

```
+--------------------------------------------------------------------------------------------------------+
|                                        THREAT DOMAIN TAXONOMY                                         |
+--------------------------------------------------------------------------------------------------------+
  |                        |                          |                          |                      |
  v                        v                          v                          v                      v
[1. Cryptographic Keys]  [2. P2P & Transport]       [3. Distributed Storage]   [4. E2EE Messaging]    [5. Admin Panel]
- Key theft              - Sybil swarms             - Private data in IPFS     - MITM on X3DH         - Credential theft
- Malicious linking      - Eclipse attacks          - CID poisoning            - Ratchet break        - Rogue moderator
- Compromised recovery   - GossipSub spam flood     - Media exploit payloads   - Replay attacks       - Audit log tampering
- Secret leakage in logs - Relay metadata snooping  - Unpinning censorship     - Group split-brain    - Privilege escalation
```

---

## 3. Cryptographic Identity & Key Management Threats

### Threat 1.1: Local Key Extraction / Key Theft

- **STRIDE:** Information Disclosure / Spoofing
- **Vector:** Malware or malicious browser extensions attempt to read raw private keys from `localStorage`, IndexedDB, or memory dumps.
- **DREAD Score:** 8.2 (High)
- **Mitigation:**
  - **Browser:** Keys stored in IndexedDB are encrypted using AES-256-GCM. The key encryption key is derived using Argon2id with salt and user passphrase or handled via non-extractable WebCrypto `CryptoKey` handles.
  - **Desktop / Mobile:** Leverage OS-level credential stores: Windows Credential Manager / DPAPI, macOS Keychain with Secure Enclave, Android Keystore, iOS Keychain.
  - Memory sanitization: Clear sensitive key buffers immediately following signature generation.

### Threat 1.2: Malicious Device Linking

- **STRIDE:** Elevation of Privilege / Spoofing
- **Vector:** An attacker accesses a user's unlocked device or uses social engineering to register a malicious device key to the user's DID.
- **DREAD Score:** 7.4 (High)
- **Mitigation:**
  - Dual-device verification: Device linking requires an ephemeral out-of-band challenge (QR code display on existing device, camera scan on new device, and mutual cryptographic signature).
  - Explicit delegation expiration: Device delegations carry cryptographic expiry timestamps (`exp`) and restricted capability scopes.
  - Revocation assertions: Primary key can issue a signed revocation event broadcast across GossipSub that immediately invalidates delegated device keys.

### Threat 1.3: Accidental Exposure of Keys in Logs or Telemetry

- **STRIDE:** Information Disclosure
- **Vector:** Debug loggers serialize user context objects containing raw private keys and transmit them to observability pipelines.
- **DREAD Score:** 9.0 (Critical)
- **Mitigation:**
  - Custom `SecretKey` and `Identity` classes override `.toJSON()`, `.toString()`, and `util.inspect.custom` to output `[REDACTED]`.
  - Static analysis linter rules prohibit logging variables matching `*privateKey*`, `*secret*`, or `*mnemonic*`.

---

## 4. P2P Network & Transport Level Threats

### Threat 2.1: Sybil Attacks on Kademlia DHT

- **STRIDE:** Denial of Service / Tampering
- **Vector:** An adversary generates thousands of fake Peer IDs to dominate DHT routing buckets, isolating victim peers or preventing CID lookups.
- **DREAD Score:** 7.8 (High)
- **Mitigation:**
  - **Cryptographic Node IDs:** Peer IDs are tied directly to public keys.
  - **IP Diversity Constraints:** DHT routing tables enforce strict IP subnet diversity (limiting max peers per `/24` IPv4 or `/48` IPv6 prefix).
  - **Peer Scoring:** libp2p connection manager evicts poorly behaving or unresponsive peers.

### Threat 2.2: GossipSub Message Amplification & Spam Flooding

- **STRIDE:** Denial of Service
- **Vector:** Malicious nodes publish high volumes of invalid or massive messages to public topics, overwhelming node CPU and bandwidth.
- **DREAD Score:** 7.5 (High)
- **Mitigation:**
  - **GossipSub v1.2 Peer Scoring:** Nodes maintain behavioral scores. Peers broadcasting invalid events, duplicate payloads, or excessive traffic are penalized and throttled.
  - **Pre-Relay Signature Verification:** Full nodes and relays perform fast signature checks _before_ forwarding messages across the GossipSub mesh.
  - **Payload Size Limits:** Hard maximum message payload size (e.g., 64KB for text/metadata events, 1MB for chunk frames).

### Threat 2.3: Relay Metadata Snooping & Traffic Analysis

- **STRIDE:** Information Disclosure
- **Vector:** Relay nodes observe source IP, destination IP, connection duration, and packet sizes between peers.
- **DREAD Score:** 6.5 (Medium)
- **Mitigation:**
  - **End-to-End Transport Encryption:** Noise protocol (`Noise_XX`) encrypts all peer-to-peer transport connections. Relays only handle Circuit Relay v2 encapsulation frames.
  - Multi-hop circuit relays when enhanced privacy is selected.
  - Constant-rate dummy padding for sensitive metadata exchanges where appropriate.

---

## 5. Distributed Storage & Media Pipeline Threats

### Threat 3.1: Private Data Accidentally Uploaded to Public Content-Addressed Storage

- **STRIDE:** Information Disclosure
- **Vector:** Private chat images, voice notes, or documents are published directly to public IPFS/DHT gateways.
- **DREAD Score:** 9.5 (Critical)
- **Mitigation:**
  - **Strict Architectural Separation:**
    - `packages/storage` provides distinct interfaces: `PublicMediaStorage` vs `EncryptedPayloadStore`.
    - Private attachments are encrypted client-side with a unique single-use symmetric key ($K_{media}$) _before_ being packaged.
    - Public IPFS providers reject unencrypted private message schemas.

### Threat 3.2: Malicious Media Parsing Exploits (H.264 / WebM / MP4)

- **STRIDE:** Remote Code Execution / Tampering
- **Vector:** Adversary uploads specially crafted, malformed video or image files designed to exploit buffer overflows in client decoders or FFmpeg transcoders.
- **DREAD Score:** 8.0 (High)
- **Mitigation:**
  - **Sandboxed Transcoding:** FFmpeg processes run inside isolated, non-root, unprivileged containers with seccomp filters and memory caps.
  - **Strict Input Sanitization:** Inspect media containers and magic bytes; reject malformed chunk streams before decoding.
  - Client video playback delegates to native browser `<video>` sandboxes with hardware decoding safeguards.

---

## 6. End-to-End Encrypted Messaging Threats

### Threat 4.1: Man-In-The-Middle (MITM) during X3DH Initial Key Agreement

- **STRIDE:** Information Disclosure / Spoofing
- **Vector:** Adversary intercepts prekey bundle distribution and substitutes their own identity or one-time prekeys.
- **DREAD Score:** 8.5 (High)
- **Mitigation:**
  - **Signed Prekey Bundles:** Identity keys sign the identity document and prekey bundle.
  - **Safety Numbers / Out-of-Band Verification:** Clients display cryptographic fingerprint comparisons (visual QR codes and numeric fingerprints) allowing users to verify communication authenticity.

### Threat 4.2: Compromise of Ephemeral Session State

- **STRIDE:** Information Disclosure
- **Vector:** Adversary obtains a snapshot of the current message encryption key.
- **DREAD Score:** 6.0 (Medium)
- **Mitigation:**
  - **Double Ratchet Protocol:** Symmetric and Diffie-Hellman ratchets update keys after every single message exchange.
  - **Forward Secrecy (FS):** Past messages cannot be decrypted even if the current ratchet key is compromised.
  - **Post-Compromise Security (PCS):** Future messages regain full confidentiality as soon as a new DH exchange occurs.

---

## 7. Company Admin Panel Security Architecture

### Threat 5.1: Admin Account Takeover

- **STRIDE:** Elevation of Privilege / Tampering
- **Vector:** Phishing, credential stuffing, or session hijacking against staff accessing `apps/sovra-admin`.
- **DREAD Score:** 8.8 (High)
- **Mitigation:**
  - Mandatory Hardware MFA: FIDO2 / WebAuthn (YubiKey) required for all admin accounts; SMS/TOTP fallback disabled.
  - Short-Lived Access Tokens: JWT/PASETO tokens valid for a maximum of 15 minutes, bound to client TLS fingerprint and IP address.
  - Automated session termination upon IP or device change.

### Threat 5.2: Rogue Administrator / Insider Threat

- **STRIDE:** Tampering / Information Disclosure
- **Vector:** Disgruntled or compromised employee attempts to delete users, bulk export personal data, or tamper with moderation records.
- **DREAD Score:** 8.0 (High)
- **Mitigation:**
  - **Granular RBAC:** Least-privilege role boundaries (Moderator, Security Admin, Support, Analyst). Moderators cannot export database dumps or modify system firewall rules.
  - **Four-Eyes Principle (Dual Authorization):** Destructive or sensitive actions (e.g. mass quarantine, global policy updates) require independent approval from a second administrator.
  - **Append-Only Signed Audit Ledger:** Every administrative action is recorded in an immutable audit log signed by the operator's private key. Logs are shipped to write-once-read-many (WORM) storage.

### Threat 5.3: Admin API Acting as Network Single Point of Failure (SPOF)

- **STRIDE:** Denial of Service
- **Vector:** Attacker takes down the Admin API via DDoS, attempting to knock out the entire Sovra social network.
- **DREAD Score:** 2.0 (Low Impact on Network - by Design)
- **Mitigation:**
  - Total network decoupling: Protocol clients do not hold admin API endpoints.
  - Consumer clients never make upstream requests to `sovra-admin`.
  - Admin panel is strictly an internal operational tool for managing company-operated nodes, reviewing reports, and viewing aggregated telemetry.

---

## 8. Client-Side Screen-Time Engine Threats

### Threat 6.1: Clock Manipulation to Bypass Local Screen-Time Limits

- **STRIDE:** Tampering
- **Vector:** User alters device system clock back in time to reset daily usage allowances.
- **DREAD Score:** 4.5 (Low)
- **Mitigation:**
  - Monotonic Clock Tracking: Usage timers increment based on active window focus ticks (`performance.now()`) rather than raw wall-clock timestamps (`Date.now()`).
  - Network Time Protocol (NTP) consensus: Periodic sanity checks against peer timestamps in received signed GossipSub events.
  - Detected backwards time shifts freeze timers rather than decrementing usage.

---

## 9. Security Verification & Audit Matrix

| Security Layer        | Verification Tooling                              | Frequency        | Passing Criteria                                         |
| :-------------------- | :------------------------------------------------ | :--------------- | :------------------------------------------------------- |
| **Crypto Primitives** | Fuzz testing & known-answer test vectors          | Every CI build   | 100% match against RFC 8032 / RFC 7748 vectors           |
| **P2P Transport**     | Adversarial node simulation & Sybil test          | Nightly test run | Mesh maintains 100% delivery under 30% malicious nodes   |
| **E2EE Messaging**    | Session state corruption & replay fuzzing         | Every PR         | Zero out-of-order execution, zero plaintext leak         |
| **Admin RBAC**        | Penetration test & permission matrix tests        | Every PR         | 100% unauthorized privilege escalation attempts rejected |
| **Dependencies**      | Automated vulnerability scan (`npm audit`, Trivy) | Continuous       | Zero High/Critical CVEs permitted                        |
