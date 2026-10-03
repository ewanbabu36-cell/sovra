# SOVRA Monorepo Architecture Specification

## 1. Overview & Directory Layout

Sovra is structured as a modular, production-first monorepo managed with `pnpm` workspaces, strict TypeScript compilation, and unified Vitest testing.

```
sovra/
├── apps/
│   ├── sovra-app/                   # Product A: End-User Application + Integrated Creator Studio
│   └── sovra-admin/                 # Product B: Company Operations & Moderation Console
├── packages/
│   ├── shared/                      # Base errors, sanitizing logger, monotonic clocks, result types
│   ├── crypto/                      # Audited crypto contracts & library registry (Zero custom crypto)
│   ├── identity/                    # Root Ed25519 identity, device keys, did:key, threshold recovery
│   ├── protocol/                    # Canonical event schemas, RFC 8785 serializer, event validator
│   ├── p2p/                         # libp2p node lifecycle, discovery, Circuit Relay v2, GossipSub
│   ├── storage/                     # Content addressing (CIDs), public media vs. private blob separation
│   ├── messaging/                   # E2EE Double Ratchet contracts, X3DH prekeys, delivery receipts
│   ├── social/                      # Signed social graph events (follow, block, mute, react, repost)
│   ├── moderation/                  # Multi-modal safety scan contracts, perceptual hashes, audit ledger
│   └── ui/                          # Presentation design tokens, dark palette, UI types (No crypto)
├── nodes/
│   ├── full-node/                   # Standalone peer node daemon (DHT, GossipSub, storage verification)
│   ├── relay-node/                  # High-capacity Circuit Relay v2 daemon
│   ├── storage-node/                # IPFS/BitSwap pinning provider daemon
│   ├── index-node/                  # Read-optimized search and query indexer
│   └── community-node/              # Dedicated community host daemon
├── services/
│   ├── transcoder/                  # Multi-resolution HLS video segmentation worker (360p-1080p)
│   ├── search/                      # Distributed index search worker
│   └── moderation-worker/           # Background visual & audio safety inspection worker
├── tests/
│   ├── unit/                        # Workspace-wide unit tests
│   ├── integration/                 # Cross-package protocol flow tests
│   ├── e2e/                         # End-to-end integration test harnesses
│   ├── security/                    # Dependency boundary enforcement & crypto audits
│   └── reliability/                 # Offline resilience & administrative decoupling tests
└── docs/
    ├── architecture/                # System architecture, roadmap, monorepo specifications
    ├── security/                    # Threat models and security audit ledgers
    └── moderation/                  # Content safety policy and review pipelines
```

---

## 2. Product Architecture & Separation

### Product A: Sovra End-User Application (`apps/sovra-app`)

- **Unified Single Client:** Serves regular consumers and creators alike.
- **Integrated Creator Mode:** Activating Creator Mode inside settings unlocks the **Creator Studio** route (`/studio`) within the same app without spawning a second identity or distinct app.
- **Autonomous Protocol Operation:** Consumes `@sovra/protocol`, `@sovra/identity`, `@sovra/p2p`, `@sovra/storage`, and `@sovra/messaging`. Does NOT call or depend on the Company Admin Panel.

### Product B: Sovra Company Operations Console (`apps/sovra-admin`)

- **Internal Operations Tool Only:** Accessible only by authorized Sovra staff via multi-factor authentication and role-based access control (RBAC).
- **Operational Scope:** Telemetry aggregation, moderation review queues, appeal processing, and company-operated node orchestration.
- **Non-Critical Invariant:** If the Admin Panel and company servers go dark, the decentralized protocol, peer discovery, and end-to-end messaging continue without degradation.

---

## 3. Package Ownership & Responsibility Boundaries

| Package             | Scope & Responsibility                                          | Allowed Upstream Internal Dependencies                                 |
| :------------------ | :-------------------------------------------------------------- | :--------------------------------------------------------------------- |
| `@sovra/shared`     | Core errors, redacting logger, monotonic clock, Result types    | _None_                                                                 |
| `@sovra/crypto`     | Cryptographic contracts and vetted library audits               | `@sovra/shared`                                                        |
| `@sovra/ui`         | Presentation tokens, dark palette, UI component interfaces      | `@sovra/shared`                                                        |
| `@sovra/identity`   | `did:key`, root signing, device delegation, threshold recovery  | `@sovra/crypto`, `@sovra/shared`                                       |
| `@sovra/protocol`   | Canonical events, RFC 8785 canonicalization, event validation   | `@sovra/crypto`, `@sovra/identity`, `@sovra/shared`                    |
| `@sovra/p2p`        | libp2p node lifecycle, discovery, Circuit Relay v2, GossipSub   | `@sovra/crypto`, `@sovra/identity`, `@sovra/shared`                    |
| `@sovra/storage`    | Content addressing (CIDs), BitSwap, private encrypted blobs     | `@sovra/crypto`, `@sovra/shared`                                       |
| `@sovra/messaging`  | E2EE Double Ratchet contracts, X3DH prekeys, delivery receipts  | `@sovra/crypto`, `@sovra/identity`, `@sovra/protocol`, `@sovra/shared` |
| `@sovra/social`     | Signed social graph events (follow, block, mute, react, repost) | `@sovra/identity`, `@sovra/protocol`, `@sovra/shared`                  |
| `@sovra/moderation` | Content safety classification, perceptual hashes, audit ledger  | `@sovra/crypto`, `@sovra/protocol`, `@sovra/shared`                    |

---

## 4. Build Pipeline & Execution Order

All packages compile to modern ECMAScript Modules (`type: "module"`), emitting declarations (`.d.ts`), source maps (`.map`), and compiled JavaScript (`.js`) into `dist/`.

Topological Build Sequence:

1. `@sovra/shared`
2. `@sovra/ui`, `@sovra/crypto`
3. `@sovra/storage`, `@sovra/identity`
4. `@sovra/protocol`, `@sovra/p2p`
5. `@sovra/messaging`, `@sovra/social`, `@sovra/moderation`, `@sovra/transcoder`, `@sovra/search`
6. `nodes/*`, `services/*`, `apps/*`
