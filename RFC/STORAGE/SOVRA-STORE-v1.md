# RFC SOVRA-STORE v1.0
## Distributed Content Storage, Operator Diversity & Part K Local Node Schema

**Protocol Identifier:** `SOVRA-STORE`  
**Namespace:** `/sovra/store/1.0.0`  
**Version:** `1.0`

---

## 1. Hybrid Storage Architecture

- **Signed Events:** Authorship, social posts, marketplace orders, governance actions.
- **Content-Addressed Blobs/DAGs (CID):** Images, chunked video, encrypted documents, specification artifacts.
- **CRDT Documents:** Shared tags, collaborative notes, carts.
- **Local Node SQLite DB:** Per-node index & persistence (NOT a centralized global DB). Search & peer indexes MUST be rebuildable from raw verified events/blocks.

---

## 2. Replication Targets & Failure-Domain Rule

| Content Tier | Initial Target | Operator Rule |
|---|---:|---|
| Temporary cache | `1` copy | Best-effort local cache |
| Ordinary public content | `3` independent copies | `>= 3` distinct operators & network subnets |
| Important public content | `5` independent copies | `>= 5` distinct operators / failure domains |
| Critical protocol releases | `5+` independent copies | Signed release manifest + M-of-N verification |
| Private data | User-controlled encrypted backups | Encrypted before storage (`ChaCha20-Poly1305`) |

> **Failure-Domain Invariant:** Five replicas running under one operator, single ASN/subnet, or single host count as **`1` independent failure domain**, not `5`.

---

## 3. Required Storage Operations & 5-Point Verification

**Operations:** `STORE_OBJECT`, `GET_OBJECT`, `VERIFY_OBJECT`, `PIN_OBJECT`, `UNPIN_OBJECT`, `ADVERTISE_PROVIDER`, `FIND_PROVIDERS`, `REPLICATE_OBJECT`, `REPORT_UNAVAILABLE`, `REPAIR_REPLICA`.

**5-Point Retrieval Verification:** Every object read validates: (1) CID multihash match, (2) byte length match, (3) codec & version match, (4) optional author signature, and (5) encryption metadata when private. No supplier node is trusted by reputation alone.

---

## 4. Part K Normalized Local Node SQLite Schema (14 Tables)

All compliant local full/storage/community node databases (`WAL` mode + `PRAGMA foreign_keys = ON` + `schema_migrations`) implement:
1. `identities` (`identity_id`, `public_key`, `key_epoch`, `created_at`, `status`, `profile_event_id`)
2. `devices` (`device_id`, `identity_id`, `device_public_key`, `authorization_event_id`, `created_at`, `revoked_at`)
3. `nodes` (`peer_id`, `public_key`, `capabilities`, `protocol_versions`, `last_seen`, `reachability`)
4. `events` (`event_id`, `identity_id`, `device_id`, `event_type`, `sequence`, `created_at`, `payload`, `signature`, `validation_status`)
5. `event_references` (`event_id`, `referenced_event_id`, `reference_type`)
6. `content_objects` (`cid`, `codec`, `content_size`, `encryption_status`, `created_at`, `verified`)
7. `content_providers` (`cid`, `peer_id`, `advertised_at`, `expires_at`)
8. `replication_jobs` (`job_id`, `cid`, `target_peer`, `status`, `attempts`, `created_at`)
9. `crdt_documents` (`document_id`, `document_type`, `document_version`, `current_snapshot_cid`, `updated_at`)
10. `crdt_changes` (`change_id`, `document_id`, `actor_id`, `dependencies`, `change_payload`, `signature`)
11. `messages` (`message_id`, `sender_id`, `recipient_id`, `encrypted_payload`, `created_at`, `delivery_status`)
12. `governance_proposals` (`proposal_id`, `author_id`, `proposal_type`, `specification_cid`, `status`, `created_at`)
13. `governance_votes` (`vote_id`, `proposal_id`, `voter_id`, `decision`, `signature`, `created_at`)
14. `audit_events` (`audit_id`, `actor_id`, `action`, `object_id`, `timestamp`, `event_signature`)

Reference implementation: [packages/protocol/src/node-db.ts](file:///d:/Sovra/packages/protocol/src/node-db.ts) & [packages/storage/src/replication-policy.ts](file:///d:/Sovra/packages/storage/src/replication-policy.ts).
