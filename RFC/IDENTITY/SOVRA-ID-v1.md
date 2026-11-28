# RFC SOVRA-ID v1.0
## Sovra Cryptographic Identity Protocol (`SOVRA-ID`)

**Protocol Identifier:** `SOVRA-ID`  
**Namespace:** `/sovra/id/1.0.0`  
**Version:** `1.0`

---

## 1. Cryptographic Profile & Frozen Identity Derivation

- **Signing Algorithm:** Ed25519 (RFC 8032, 32-byte raw public key)
- **Key Agreement / Encryption:** X25519 (RFC 7748, strictly separate from signing key)
- **Hash Function:** SHA-256
- **Domain Separation Tag:** `"SOVRA-ID-v1"` (ASCII bytes `[0x53, 0x4f, 0x56, 0x52, 0x41, 0x2d, 0x49, 0x44, 0x2d, 0x76, 0x31]`)
- **Versioned Binary Payload (`33` bytes):**
  - Byte `0`: Version `0x01`
  - Bytes `1..32`: `SHA-256("SOVRA-ID-v1" || Ed25519SigningPublicKey32)`
- **Human-Readable Encoding:** Bech32m (BIP-350 constant `0x2bc830a3`) with HRP `"sovra"`, converting the 33-byte payload from 8-bit bytes into 5-bit base32 groups with zero-padding, yielding lowercase `sovra1...` strings (`60` data chars + HRP `sovra1` = `66` chars total).

---

## 2. Canonical Identity Object

```json
{
  "version": 1,
  "identity_id": "sovra1...",
  "signing_public_key": "<64-hex Ed25519 pubkey>",
  "encryption_public_key": "<64-hex X25519 pubkey>",
  "created_at": 1700000000,
  "key_epoch": 1,
  "capabilities": ["social", "messaging", "commerce"],
  "signature": "<128-hex Ed25519 signature>"
}
```

- Signature covers SHA-256 of deterministic CBOR of all unsigned fields prefixed by `"SOVRA-ID-OBJ-v1"`.
- Verification checks: `version === 1`, `key_epoch >= 1`, `identity_id === deriveSovraId(signing_public_key)`, and valid Ed25519 signature over canonical unsigned bytes using `signing_public_key`.

---

## 3. Private Key Protection, Multi-Device & Recovery

1. **Private Key Protection:** CSPRNG key generation, separate Ed25519 signing and X25519 encryption keys, encrypted rest vault (`ChaCha20-Poly1305` + `scrypt` key derivation), excluded from logs, crash dumps, and telemetry.
2. **Multi-Device Authorization & Revocation:** Root identity signs a device record (`device_id`, `device_public_key`, `capabilities`, `expires_at`, `signature`). Revoking a device records `(device_id, identity_id, key_epoch, revoked_at, signature)` and rejects any future operations signed by that device without abandoning the user's `identity_id`.
3. **Key Rotation:** Advances `key_epoch` (`n -> n + 1`) dual-signed by the previous and replacement signing keys (`identity.rotate`).
4. **Recovery Guarantees:** Supports password-encrypted user backups (`identity.exportBackup` / `identity.restoreBackup`), device-to-device migration, and M-of-N guardian timelocked recovery (`RecoveryPlan`). No recovery guardian ever holds unrestricted unilateral identity control, and zero founder dependency exists.

---

## 4. Reference Implementations & Local APIs

- Reference module: [packages/identity/src/sovra-id.ts](file:///d:/Sovra/packages/identity/src/sovra-id.ts)
- Deterministic Test Vectors & Compliance Suite: [packages/identity/test/sovra-id-v1.test.ts](file:///d:/Sovra/packages/identity/test/sovra-id-v1.test.ts)
- Local API methods: `identity.create()`, `identity.getPublicIdentity()`, `identity.authorizeDevice()`, `identity.revokeDevice()`, `identity.rotateKey()`, `identity.exportBackup()`, `identity.restoreBackup()`, `identity.verifySignature()`.

---

## 5. Frozen Interoperability Test Vectors (`IA-01 Section 3 Complete 8-Vector Set`)

> **BIP-39 Scope Boundary:** BIP-39 (`packages/crypto/src/bip39.ts`) is strictly an optional recovery phrase encoding format, NEVER an automatic substitute for CSPRNG Ed25519 key generation & HKDF-separated root key derivation.

### Four-Identifier Model
1. **Sovra Identity ID (`sovra1...`):** Stable user root identity (`0x01 || SHA-256("SOVRA-ID-v1" || Ed25519Pub)`).
2. **Device ID (`device_id` + `device_public_key`):** Individually authorized & independently revocable client device keypair.
3. **Peer ID (`12D3KooW...`):** Libp2p Ed25519 transport node identity, cryptographically bound to user identity via `SovraPeerIdentityBindingRecord`.
4. **Encryption Key ID (`sovraenc1...`):** X25519 public key identity (`0x01 || SHA-256("SOVRA-ENC-ID-v1" || X25519Pub)`), independently rotatable.

### Formal Deterministic Vectors
1. **Vector 1 — Identity Generation:** `signing_private_key_hex = 0101010101010101010101010101010101010101010101010101010101010101` -> `signing_public_key = 8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c`; `encryption_public_key = 2222222222222222222222222222222222222222222222222222222222222222`.
2. **Vector 2 — Identity & Encryption Key Encoding:** `identity_id = sovra1qycxelj9jsrn35nxd08m46d5dlcp3tzjvgsmfhn99nfm2jq9s3tfch4gull`; `encryption_key_id = sovraenc1qynwej8k93xrr305p0p7dap4jvpucnefzw8fsc3u78yz6a2ftxk8khm44lw`.
3. **Vector 3 — IdentityObject Signature (`created_at = 1700000000`, `key_epoch = 1`, `capabilities = ["social","messaging","commerce"]`):** `signature = 36e11e6a11a6a4ea42608512f652312205ce46377cd282ce8519a1a308375606cab870f749febdc8dd08d6bc76f99ff84c5769918a52c49ff66726a1728b6403`.
4. **Vector 4 — Device Authorization (`device_id = "dev_vec_1"`, `dev_pub = ca93ac1705187071d67b83c7ff0efe8108e8ec4530575d7726879333dbdabe7c`, `authorized_at = 1700000001`, `expires_at = 1731536001`):** `authorization_signature = c4c23ec9e319116cf54c7d78a30ea72fc8e097751d52ca393a0bd942b6bc139c66de0c99aca6454c5e38f93c85a1180908308e35893f0804a332d5730d0bad0c`.
5. **Vector 5 — Device Revocation (`device_id = "dev_vec_1"`, `reason = "compromised"`, `revoked_at = 1700000050`):** `signature = fd45dc007c65a5e4f623dd54c79f1b34b6b10e4786a0630dff6b966863b56b4e0edfce2ba90494fa7fe4e0b42c35ffbcc12039d13bd90328f544b2caa86b4503`.
6. **Vector 6 — Key Epoch & Encryption Key Rotation (`new_priv = 05...05`, `new_enc_priv = 07...07`, `rotated_at = 1700000100`, `new_enc_pub = 33...33`, `enc_epoch = 2`, `enc_rotated_at = 1700000120`):**
   - `new_identity_id = sovra1qytkmau584rk45gducsmzzxfvwn8tstcgxa6ja28za7j3865h3ezcja8k5f`
   - `epoch_new_encryption_public_key = 13be4feaeaf204c7fd3358fc9c00721881d174278128227ec674f37f7fe97b6d`
   - `previous_key_signature = 17ddf1620149c317c372fb55f86d9eda1f6f50bd6e2b5850b56bf595a69fc1f3ba2ff400cda3f808913c7be81914421ed49fa0f9ca55d06d77c35d9677b9e500`
   - `new_key_signature = 9242fa0ec14a55f49dbc70c7656616e30c70127106df47a4519ae7dfdc93aa5283414b0a47fc6ce348256ba23ed333553bc7733ddc6bf42b3757e00405f09d0c`
   - `new_encryption_key_id = sovraenc1qy8s5hyw3fv8j3d0q5yw5hx8vjp386hhyhmajdes035mpwxngyezzlmlwku`
   - `enc_rotation_signature = 0c5ad0ce70b7ed17e85f1255dae896211b36d2f8cab243b67638916eb3e417daa59af754985624188055e8aeecd65d2947dba14ffcfbc64e29ad802f4e56e802`.
7. **Vector 7 — Recovery (`scrypt(N=1024..16384, r=8, p=1) + ChaCha20-Poly1305 AEAD` with AAD `"SOVRA-BACKUP-v1:<identity_id>:<epoch>"`):** Round-trip decrypts exact `SovraLocalIdentitySecrets` & fails on wrong passphrase or tampered ciphertext.
8. **Vector 8 — Peer Identity Binding (`peer_id = "12D3KooWVectorPeerExample000000000000000000000000001"`, `peer_priv = 06...06`, `issued_at = 1700000010`, `expires_at = 1702592010`):**
   - `peer_public_key = 8a875fff1eb38451577acd5afee405456568dd7c89e090863a0557bc7af49f17`
   - `identity_signature = 4d258c8cb3f01471aacb0a1df9fa106452aadc1190e3efa72e474f2633840d4dee6ef3406759d2d960e899af45b42c55d3def3dd340187d7c1e29836b58e7e0a`
   - `peer_signature = 7963529ea25c4dda59e69a5ebdb28fc5588a67e1aef8254b10c8b460792507f28ede868619cec292b414fec21ddd57f48d92add3758ef4c1b610361daf43290a`

