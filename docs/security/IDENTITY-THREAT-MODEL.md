# SOVRA Decentralized Identity Threat Model

## 1. Scope & Adversary Capabilities

This threat model evaluates security, authentication, and recovery threats against **Sovra's Decentralized Cryptographic Identity System**.

### 1.1 Decentralized Trust Assumptions

1. **Zero Central Authority:** No central authentication server, company database, or corporate directory acts as an identity validator or gatekeeper.
2. **Untrusted Relays:** Intermediate network nodes and relays can delay, drop, or reorder messages, but cannot forge signatures or tamper with payloads.
3. **Hostile Local Environments:** End-user devices may be subjected to malware, physical theft, or malicious browser extensions attempting memory or storage extraction.
4. **Independent Company Admin Panel:** The Company Admin Panel has zero identity validation privileges and cannot alter, seize, or reassign user DIDs.

---

## 2. Adversary Classification & Attack Vectors

```
+--------------------------------------------------------------------------------------------------------+
|                                    IDENTITY THREAT TAXONOMY                                            |
+--------------------------------------------------------------------------------------------------------+
  |                        |                          |                          |                      |
  v                        v                          v                          v                      v
[1. Device & Key Theft]  [2. Delegation Tamper]     [3. Revocation Attacks]    [4. Recovery Takeover] [5. Replay / Spoof]
- Extraction from disk   - Forged delegation sig    - Censoring revocation msg - Malicious collusion  - Replaying old delegation
- Compromised device     - Scope expansion attack   - Revocation replaying     - Pre-mature execution - Forging author DID
- Stolen device token    - Expired delegation use   - Revocation of wrong key  - Takeover via sybils  - Nonce exhaustion
```

---

## 3. Key Compromise & Blast Radius Analysis

Sovra enforces strict key role separation to constrain the blast radius of any individual key compromise:

| Compromised Key                  | Blast Radius                                                                             | Impact on Identity & Other Devices                                                           | Mitigation & Recovery                                                                                                                                                                     |
| :------------------------------- | :--------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Delegated Device Key ($DK$)**  | **Contained to single device.** Adversary can sign events as that device until revoked.  | **Zero impact on root identity.** Other devices remain secure.                               | Root Identity Key issues a signed `DeviceRevocationAssertion`. Peers immediately reject all subsequent actions from $DK$.                                                                 |
| **Ephemeral Session Key ($SK$)** | **Contained to single session or message ratchet.**                                      | **Zero impact on past messages (Forward Secrecy)** and zero impact on identity.              | Session key discarded. Double Ratchet self-heals via DH ratchet step (Post-Compromise Security).                                                                                          |
| **Root Identity Key ($IK$)**     | **Severe.** Adversary controls the DID and can authorize devices or sign profile events. | All past signed events remain historically attributed; adversary can attempt to rotate keys. | User executes **Threshold Guardian Recovery** to rotate $IK \to IK_{new}$ and revokes the compromised root key across peer registries.                                                    |
| **Single Guardian Key ($GK$)**   | **Negligible.** Single guardian has zero authority ($1 < M$).                            | Zero. Cannot execute recovery alone; cannot read user data.                                  | User replaces compromised guardian in `RecoveryPlan` with a new signed plan update.                                                                                                       |
| **$M$ Colluding Guardians**      | **High if unmitigated.** Malicious guardians attempt to authorize a rogue new key.       | User identity at risk of unauthorized rotation.                                              | **Mitigated by Timelock Challenge Window & Recovery Cancellation:** Active user receives notification and issues signed `RecoveryCancellation`, permanently aborting the hostile attempt. |

---

## 4. Specific Attack Scenarios & Cryptographic Defenses

### Attack 4.1: Delegation Signature Forgery

- **Vector:** Adversary attempts to generate a fraudulent `DeviceDelegationAssertion` claiming that Identity $A$ authorized Rogue Device $R$.
- **Defense:** Verification requires valid Ed25519 signature over canonical JSON serialization of the delegation assertion using Identity $A$'s public key. Ed25519 guarantees 128-bit security against signature forgery.

### Attack 4.2: Revocation Censorship / Relay Suppression

- **Vector:** Adversary compromises Device $B$. When Identity $A$ broadcasts a revocation for Device $B$, malicious relays suppress the revocation message, allowing Device $B$ to continue posting to unwitting peers.
- **Defense:**
  1. Revocation assertions are gossiped across multiple independent GossipSub topic paths (`/sovra/identity/revocations`).
  2. Peer query protocols require checking the author's latest revocation sequence when evaluating device delegations.
  3. Short delegation expiration lifetimes (`validUntil`) ensure that even in a total network partition, stale authorizations automatically expire.

### Attack 4.3: Malicious Guardian Takeover (Collusion)

- **Vector:** $M$ guardians collude or are subpoenaed/hacked to authorize transferring Identity $A$ to an attacker's public key.
- **Defense:**
  1. **Zero Private Key Exposure:** Guardians never hold shares of the user's private key; they only provide signed authorization tokens.
  2. **Enforced Timelock Grace Period:** Threshold recovery proofs enforce an immutable timelock (e.g. 72 hours) before the new key is activated.
  3. **Veto via Signed Cancellation:** The legitimate owner holding the original Identity Key can broadcast a `RecoveryCancellation` event during the timelock window, immediately invalidating the fraudulent recovery attempt.

### Attack 4.4: Replay Attacks on Delegations & Rotations

- **Vector:** An adversary captures an expired or previously revoked delegation assertion and replays it to a newly joined node.
- **Defense:**
  1. Strict timestamp and expiration bounds (`validUntil`). Nodes reject authorizations where `now > validUntil`.
  2. Monotonic rotation sequences and unique cryptographic nonces.

---

## 5. Security Invariants Checklist

- [x] Every public identity is deterministically rooted in an asymmetric cryptographic key (`did:key`).
- [x] Device authority is always derived through cryptographically signed delegations.
- [x] Private keys never cross network boundaries or exist in unencrypted public storage.
- [x] Compromising a single device does not compromise the root identity.
- [x] Guardians cannot read messages, forge past signatures, or extract private keys.
- [x] Recovery includes a timelock and active owner veto mechanism.
