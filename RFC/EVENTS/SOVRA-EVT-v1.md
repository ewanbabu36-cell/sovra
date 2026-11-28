# RFC SOVRA-EVT v1.0
## Sovra Signed Event Protocol & Deterministic CBOR Wire Format (`SOVRA-EVT`)

**Protocol Identifier:** `SOVRA-EVT`  
**Namespace:** `/sovra/event/1.0.0`  
**Version:** `1.0`

---

## 1. Canonical Binary Encoding: Deterministic CBOR (RFC 8949 Section 4.2)

- Integers encoded in shortest big-endian major type `0` (unsigned `0..2^64-1`) or `1` (negative `-2^64..-1`).
- Text strings (major type `3`) and byte strings (major type `2`) use definite-length UTF-8/raw headers.
- Maps (major type `5`) omit `undefined` values and sort keys strictly by **encoded CBOR key length ascending, then bytewise unsigned lexicographic order** (RFC 8949 Core Deterministic Encoding).
- Arrays (major type `4`), `false` (`0xf4`), `true` (`0xf5`), `null` (`0xf6`) use canonical minimal tokens (no indefinite-length items).

---

## 2. Canonical Event Structure

```json
{
  "protocol": "sovra",
  "version": 1,
  "event_id": "<64-hex SHA-256>",
  "identity_id": "sovra1...",
  "device_id": "dev_...",
  "event_type": "social.post",
  "created_at": 1700000000,
  "sequence": 1,
  "key_epoch": 1,
  "payload": {},
  "references": [],
  "content_cid": null,
  "critical": false,
  "signature": "<128-hex Ed25519>"
}
```

- **Event ID Derivation:** `SHA-256("SOVRA-EVT-v1" || deterministic_cbor(unsigned_event_without_event_id_and_signature))`
- **Signature Coverage:** Ed25519 signature over `"SOVRA-EVT-SIG-v1" || hexToBytes(event_id)` using an authorized `signing_public_key` matching `(identity_id, device_id, key_epoch)` that is not revoked.

---

## 3. Initial Event Registry (17 Canonical Types + Unknown Type Rules)

| Category | Event Types |
|---|---|
| Identity & Device | `identity.create`, `identity.rotate`, `device.authorize`, `device.revoke` |
| Profile & Social | `profile.update`, `social.post`, `social.comment`, `social.reaction`, `social.follow`, `social.delete` |
| Commerce | `market.listing`, `market.order`, `market.accept`, `market.status`, `business.create` |
| Governance | `governance.proposal`, `governance.vote` |

**Forward-Compatibility Rule:**
- **Unknown optional events** (`critical !== true` and non-security prefix) whose signature & structure validate MUST be preserved without crashing older clients.
- **Unknown security-critical events** (`critical === true` or unknown `identity.*` / `device.*` / `governance.*` / `auth.*` subtypes) MUST fail closed (`REJECTED`) when unrecognized.

---

## 4. Immutability & Tombstones

- Signed events are append-only and immutable. Edits append new events referencing parent IDs.
- Deletion appends a signed `social.delete` tombstone referencing the target `event_id` (`author must match original owner or authorized moderator rule`). Tombstones trigger local purge/hide policies but never retroactively prove erasure across offline third-party copies.
- Reference implementation: [packages/protocol/src/cbor.ts](file:///d:/Sovra/packages/crypto/src/cbor.ts) & [packages/protocol/src/sovra-evt.ts](file:///d:/Sovra/packages/protocol/src/sovra-evt.ts).

---

## 5. Frozen Deterministic CBOR Test Vector (`v1.0`)

Using the Section 5 frozen vector key (`sovra1qycxelj9jsrn35nxd08m46d5dlcp3tzjvgsmfhn99nfm2jq9s3tfch4gull`):
- `device_id`: `"dev_vec_1"`, `event_type`: `"social.post"`, `created_at`: `1700000010`, `sequence`: `1`, `key_epoch`: `1`, `references`: `[]`, `content_cid`: `null`
- `payload`: `{ "b": 2, "aa": "first_val", "text": "Hello Sovereign World" }`
- `unsigned_cbor_hex` (RFC 8949 Section 4.2 sorted): `ab677061796c6f6164a36162026261616966697273745f76616c64746578747548656c6c6f20536f7665726569676e20576f726c646776657273696f6e016870726f746f636f6c65736f7672616873657175656e636501696465766963655f6964696465765f7665635f31696b65795f65706f6368016a637265617465645f61741a6553f10a6a6576656e745f747970656b736f6369616c2e706f73746a7265666572656e636573806b636f6e74656e745f636964f66b6964656e746974795f69647841736f7672613171796378656c6a396a73726e33356e786430386d34366435646c637033747a6a7667736d66686e39396e666d326a71397333746663683467756c6c`
- `event_id`: `9ffebb5e7067d4409b98987237f56061c3abb0a2f74d08fb28d97905868a911b`
- `signature`: `83b2fc487d390dc8182223352c6db1f1528f9a1d9c66f4bc5613203b540122a3c6b520817c0a362710d92d782399611e7516ed9ff01005d6cc16943832c17508`

