# SOVRA Decentralized Cryptographic Identity Specification

## 1. Specification Overview

Sovra identities are autonomous, self-sovereign cryptographic primitives rooted in asymmetric public key cryptography.

An identity requires:

- **No central authentication server**
- **No corporate user database**
- **No company-controlled identity provider (OAuth / OIDC)**
- **No email address or phone number requirement**
- **No central session authority**

---

## 2. W3C `did:key` Representation Specification

Sovra adopts the W3C `did:key` standard using Ed25519 public keys.

### 2.1 Multicodec & Multibase Formulation

- **Cryptographic Curve:** Curve25519 in Edwards form (Ed25519 / RFC 8032).
- **Key Length:** Exactly 32 bytes (256 bits).
- **Multicodec Code:** `ed25519-pub` with varint value `0xed01` (binary representation: bytes `[0xed, 0x01]`).
- **Multibase Encoding:** Base58-BTC with prefix character `'z'`.
- **String Format:**
  $$\text{DID} = \text{"did:key:z"} + \text{Base58BTC}([0xed, 0x01] \,||\, \text{rawPublicKeyBytes}_{32})$$

### 2.2 Canonical Test Vector

- **Raw Public Key (Hex):**  
  `d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a`
- **Prefixed Multicodec (34 bytes):**  
  `ed01d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a`
- **Canonical `did:key` String:**  
  `did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw`

### 2.3 Verification & Decoding Algorithm

Given a candidate DID string $S$:

1. Assert $S$ starts with `did:key:z`.
2. Extract the substring following `did:key:z`.
3. Decode using Base58-BTC alphabet to obtain byte array $B$.
4. Assert $B$ has length exactly 34 bytes.
5. Assert $B[0] == 0xed$ and $B[1] == 0x01$.
6. Extract slice $B[2..34]$ as the 32-byte Ed25519 raw public key.

---

## 3. Public Identity Data Model

The `PublicIdentity` object contains only verifiable public metadata. **It never contains private keys, recovery seed shares, or plain passwords.**

```json
{
  "did": "did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw",
  "publicKeyHex": "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  "createdAt": 1780000000,
  "version": 1,
  "activeDevices": [
    {
      "deviceId": "dev-macbook-pro-m3",
      "deviceName": "Alice's Laptop",
      "devicePublicKeyHex": "9b12...device_pubkey_hex...",
      "validUntil": 1811536000,
      "delegationSignature": "4a7f...ed25519_sig_by_root_identity..."
    }
  ],
  "recoveryPlan": {
    "requiredThreshold": 3,
    "totalGuardians": 5,
    "guardianDids": [
      "did:key:z6MkuGuardian1...",
      "did:key:z6MkuGuardian2...",
      "did:key:z6MkuGuardian3...",
      "did:key:z6MkuGuardian4...",
      "did:key:z6MkuGuardian5..."
    ],
    "timelockSeconds": 259200
  }
}
```

---

## 4. Multi-Device Model & Signed Delegations

A user identity may possess multiple physical devices (phone, laptop, desktop).

### 4.1 Device Delegation Assertion Schema

To authorize Device $D$, the root Identity Key signs a `DeviceDelegationAssertion`:

```json
{
  "parentDid": "did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw",
  "deviceId": "dev-pixel-9",
  "deviceName": "Mobile Phone",
  "devicePublicKeyHex": "1c34...device_pubkey_hex...",
  "authorizedAt": 1780000100,
  "validUntil": 1811536000,
  "nonce": "a78d02ff81c4",
  "delegationSignature": "f8a0...root_key_signature_hex..."
}
```

### 4.2 Signature Verification Procedure for Device-Authored Events

When verifying an event authored by a delegated device:

1. Extract `event.sig` and `event.pubkey` (Device Public Key).
2. Verify that `event.sig` is a valid signature over canonical event ID using `event.pubkey`.
3. Locate the author's `DeviceDelegationAssertion` matching `event.pubkey`.
4. Verify that the delegation was signed by the root `parentDid` public key.
5. Verify that `event.createdAt <= delegation.validUntil`.
6. Assert that `devicePublicKeyHex` is NOT present in the identity's revoked keys registry.

---

## 5. Signed Key Revocation Mechanism

Revocations are explicit cryptographic records published to the peer mesh.

```json
{
  "targetDid": "did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw",
  "revokedKeyHex": "1c34...device_or_signing_key_hex...",
  "revokedKeyRole": "device",
  "reason": "device_lost",
  "revocationSequence": 1,
  "timestamp": 1780000500,
  "nonce": "981ad402fe",
  "signature": "77bc...signature_by_root_identity_key..."
}
```

### Replay & Ordering Defense

- Monotonic sequence numbers (`revocationSequence = 1, 2, ...`) prevent rollback.
- Once a key is marked revoked in a peer's local state, subsequent attempts to authorize or sign with that key are rejected forever.

---

## 6. Forward Key Rotation

When an identity key is routinely rotated or superseded:

1. Root Key 1 ($IK_1$) signs a `KeyRotationAssertion` delegating authority forward to Root Key 2 ($IK_2$).
2. $IK_2$ co-signs the assertion to prove possession.
3. The continuity link $IK_1 \to IK_2$ is verified deterministically by any peer without contacting central servers.
