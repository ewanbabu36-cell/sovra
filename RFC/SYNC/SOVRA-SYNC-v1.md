# RFC SOVRA-SYNC v1.0
## CRDT Models, Transactional State Machines & Offline Synchronization (`SOVRA-SYNC`)

**Protocol Identifier:** `SOVRA-SYNC`  
**Namespace:** `/sovra/sync/1.0.0`  
**Version:** `1.0`

---

## 1. Per-Domain Convergence Model Selection (Section 9.1)

| Domain Data | Required Model | Conflict Rule |
|---|---|---|
| Counters / Reactions | `PN-Counter` | Per-actor increment/decrement maps; total = sum(P) - sum(N) |
| Tags / Reactions / Follows | Observed-Remove Set (`OR-Set`) | Add-wins with causal dot IDs + explicit author authorization |
| Community Membership | Authorized `OR-Set` | Mutations require valid signed admin/mod authorization event |
| Collaborative Text | Sequence CRDT (`RGA`) | Causal identifier + deterministic `(lamport, actor_id)` total tie-break |
| Profiles | Signed single-writer updates | Higher `sequence` / `(created_at, event_id)` by owner |
| Shopping Cart | `OR-Map` / application CRDT | Key-scoped add/remove tags per `(cart_id, item_id)` |
| Inventory | Transactional state machine | Deterministic reservation invariant (`reserved <= stock`, no LWW overwrite) |
| Financial Ledger | Append-only signed events | Strict non-negative balance & conservation invariants |
| Marketplace Orders | Authorized state machine | Legal transitions only (`listing -> order -> accept -> fulfilled/cancelled/disputed`) |
| Governance Votes | Immutable signed records | Latest authorized ballot per `(proposal_id, voter_id)` before deadline |

> **Critical Rule:** Financial balances, inventory reservations, and order state transitions MUST NEVER be resolved merely by "latest timestamp wins".

---

## 2. 10-Step Synchronization Flow

1. Connect to peer (`/sovra/sync/1.0.0`).
2. Exchange protocol capabilities & supported spec versions.
3. Exchange tracked `document_id` lists.
4. Compare causal version vectors / known change IDs.
5. Request missing changes.
6. Verify author identity, device authorization, and Ed25519 signature on each incoming change.
7. Validate domain authorization & invariants.
8. Merge compatible concurrent updates deterministically (idempotent, associative, commutative).
9. Persist updated snapshot/changes atomically in local SQLite (`crdt_documents`, `crdt_changes`).
10. Advertise updated version vector to peer mesh.

Reference implementation: [packages/protocol/src/sovra-sync.ts](file:///d:/Sovra/packages/protocol/src/sovra-sync.ts).
