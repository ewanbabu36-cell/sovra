# SOVRA Decentralized Threshold Recovery Architecture

## 1. Design Philosophy & Non-Escrow Principle

Traditional social recovery models often suffer from a catastrophic flaw:

> _"Guardians receive encrypted key shares; if guardians collude, they reconstruct the user's private key and take over all historical data."_

**Sovra strictly rejects this approach.**

Under the **Sovra Authorization-Based Recovery Model**:

1. **Guardians NEVER receive, hold, or reconstruct the user's private key.**
2. Guardians act strictly as **Cryptographic Attestors/Witnesses**.
3. During recovery, the user generates a **brand-new Identity Key** ($IK_{new}$) and requests guardian signatures to attest that the owner of $IK_{old}$ is now legitimately moving to $IK_{new}$.
4. A quorum of $M$-of-$N$ guardians sign distinct authorization assertions.
5. Even if $M$ guardians collude maliciously, **they cannot read past encrypted messages** (protected by forward secrecy) and **cannot bypass the recovery timelock veto window**.

---

## 2. Ten Tenets of the Sovra Recovery Model

```
+---------------------------------------------------------------------------------------------------------+
|                                    10-POINT RECOVERY FRAMEWORK                                          |
+---------------------------------------------------------------------------------------------------------+
[1. Threat Model]          --> Adversary attempts account takeover via compromised or colluding guardians.
[2. Guardian Capabilities] --> Can ONLY sign an authorization token naming (OldDID, NewPubKey, Nonce).
[3. Quorum]                --> M-of-N threshold (e.g. 3-of-5). Strictly enforced by signature checks.
[4. Replacement]           --> Active owner can rotate or replace guardians at any time with a signed plan.
[5. Lost Guardians]        --> Tolerates up to (N - M) lost or unresponsive guardians.
[6. Collusion Resistance]  --> Colluding guardians cannot forge past events or access historical data.
[7. Takeover Prevention]   --> Mandatory Timelock Window (e.g. 72h) delays activation of new key.
[8. Auditability]          --> All recovery requests and proofs are signed, public cryptographic events.
[9. Emergency Protocol]    --> Emergency alerts dispatched across all user's registered active devices.
[10. Recovery Cancellation]--> Legitimate owner signs `RecoveryCancellation` to immediately abort takeover.
```

---

## 3. Cryptographic Recovery Workflow

```
User (Lost Key)                   Guardian 1..M                    Peer Network / Verifiers
      |                                 |                                      |
1. Generate $IK_{new}$                  |                                      |
   Create RecoveryRequest               |                                      |
      | ------------------------------> |                                      |
      |                                 |                                      |
      |   (Out-of-band verification)    |                                      |
      |                                 |                                      |
      | <------------------------------ |                                      |
      |   GuardianAuthorizationSig      |                                      |
      |                                 |                                      |
2. Assemble Quorum                      |                                      |
   Sign ThresholdRecoveryProof          |                                      |
      | ---------------------------------------------------------------------> |
      |                                                                        |
      |                                                                 3. Start Timelock (72h)
      |                                                                    Alert User Devices
      |                                                                        |
      |                                                                 (If no Cancellation)
      |                                                                        |
      | <--------------------------------------------------------------------- |
                                                                        4. Identity Rebound
                                                                           $IK_{old} \to IK_{new}$
```

### 3.1 Data Structures

#### 1. Recovery Plan Declaration (Registered by Identity Owner)

```json
{
  "targetDid": "did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw",
  "requiredThreshold": 3,
  "totalGuardians": 5,
  "guardianDids": [
    "did:key:z6MkuGuardianAlice...",
    "did:key:z6MkuGuardianBob...",
    "did:key:z6MkuGuardianCharlie...",
    "did:key:z6MkuGuardianDave...",
    "did:key:z6MkuGuardianEve..."
  ],
  "timelockSeconds": 259200,
  "planSequence": 1,
  "signature": "ed25519_sig_by_target_identity"
}
```

#### 2. Individual Guardian Authorization Token

```json
{
  "targetDid": "did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw",
  "newPublicKeyHex": "8a31...new_ed25519_pubkey...",
  "guardianDid": "did:key:z6MkuGuardianAlice...",
  "nonce": "c91fa023e4",
  "timestamp": 1780000000,
  "validUntil": 1780086400,
  "guardianSignature": "ed25519_sig_by_guardian_alice"
}
```

#### 3. Threshold Recovery Proof (Submitted to Mesh)

```json
{
  "targetDid": "did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw",
  "newPublicKeyHex": "8a31...new_ed25519_pubkey...",
  "authorizations": [
    {/* Guardian Alice Token */},
    {/* Guardian Bob Token */},
    {/* Guardian Charlie Token */}
  ],
  "claimTimestamp": 1780000100,
  "newKeySignature": "ed25519_sig_by_new_key_confirming_acceptance"
}
```

#### 4. Recovery Cancellation (Owner Veto)

```json
{
  "targetDid": "did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw",
  "cancelledProofNonce": "c91fa023e4",
  "timestamp": 1780000200,
  "reason": "unauthorized_takeover_attempt",
  "signature": "ed25519_sig_by_legitimate_original_identity_key"
}
```

---

## 4. Attack Scenarios & Automated Verification Suite

| Attack Vector                     | Simulated Scenario                                  | Expected System Defense                                                                                                                       |
| :-------------------------------- | :-------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| **Insufficient Quorum**           | Attacker collects 2 signatures on a 3-of-5 plan     | **REJECTED.** Quorum check asserts $\text{count}(\text{validSigs}) \ge M$.                                                                    |
| **Colluding Rogue Guardians**     | 3 guardians sign without user consent               | **BLOCKED BY TIMELOCK.** Proof enters 72h challenge state; legitimate user broadcasts `RecoveryCancellation`, permanently invalidating proof. |
| **Replayed Expired Token**        | Attacker replays an authorization from 6 months ago | **REJECTED.** Verifier rejects tokens where $\text{now} > \text{validUntil}$.                                                                 |
| **Forged Guardian Signature**     | Attacker forges 3rd guardian signature              | **REJECTED.** Signature verification fails against declared guardian DID.                                                                     |
| **Unknown Guardian Substitution** | Attacker supplies 3 signatures from unlisted DIDs   | **REJECTED.** Verifier cross-references signer DIDs with `guardianDids` in registered plan.                                                   |
