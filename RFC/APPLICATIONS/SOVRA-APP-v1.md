# RFC SOVRA-APP v1.0
## Social, Marketplace, Business & Third-Party App Sandboxing (`SOVRA-APP`)

**Specification:** `SOVRA-APP` (`v1.0`)  
**Namespace:** `/sovra/app/1.0.0`  
**Status:** Frozen Baseline

---

## 1. Sovra Social

- Profiles, posts, CID media, comments, reactions, follows, communities, local moderation filters, user-controlled feeds.
- **No Mandatory Central Algorithm:** Ranking and moderation filters run on-device or via opt-in community indexers; no founder feed controller exists.

## 2. Sovra Marketplace & Sovra Business

- Domain-independent business creation (`business.create`), product/service listings (`market.listing`), buyer order creation (`market.order`), seller acceptance (`market.accept`), status progression (`market.status`), reputation & signed dispute records.
- Runs purely via `SOVRA-EVT` signed state transitions without requiring a central server or mandatory token (optional payment rails / off-band settlement supported).

## 3. Sovra Apps — Scoped Capabilities & Permission Isolation

Third-party applications declare an Ed25519-signed `AppPermissionManifest`:
- Scoped capabilities only (`social.read`, `social.post`, `market.read`, `storage.pin`, etc.).
- Explicit forbidden scope: private key extraction (`identity.export_private_key`, raw signing secret access) is unconditionally blocked.
- Per-user grants support expiry, version constraints, offline signature verification, and instant local revocation (`revokeGrant(grantId)`).

Reference implementation: [packages/protocol/src/sovra-apps.ts](file:///d:/Sovra/packages/protocol/src/sovra-apps.ts) & [packages/protocol/src/sovra-commerce.ts](file:///d:/Sovra/packages/protocol/src/sovra-commerce.ts).
