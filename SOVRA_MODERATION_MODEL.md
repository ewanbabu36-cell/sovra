# SOVRA Moderation Model

## 1. Content Moderation States

SOVRA avoids silent deletions and frontend hiding by maintaining an explicit, audited state machine for all content:

```
  ┌────────────┐
  │  VISIBLE   │ ◄───────────────────────┐ (Restore / Unhide)
  └─────┬──────┘                         │
        │                                │
        │ (Report submitted / Flagged)   │
        ▼                                │
  ┌────────────┐                         │
  │  REPORTED  │                         │
  └─────┬──────┘                         │
        │                                │
        │ (Moderator claimed)            │
        ▼                                │
  ┌──────────────┐                       │
  │ UNDER_REVIEW │                       │
  └─────┬────────┴                       │
        │                                │
        ├───► [Action: Hide] ──────► ┌───┴──────────┐
        │                            │    HIDDEN    │
        │                            └──────────────┘
        │
        ├───► [Action: Restrict] ──► ┌──────────────┐
        │                            │  RESTRICTED  │
        │                            └──────────────┘
        │
        └───► [Action: Remove] ────► ┌──────────────┐
                                     │   REMOVED    │ (Terminal / Redacted)
                                     └──────────────┘
```

| State | Visibility in Feeds | Search Indexing | API Access | Inbound Mesh Ingestion |
| :--- | :--- | :--- | :--- | :--- |
| `VISIBLE` | Yes | Yes | 200 OK | Allowed |
| `REPORTED` | Yes (Pending review) | Yes | 200 OK | Allowed |
| `UNDER_REVIEW` | Yes (Marked in admin) | Yes | 200 OK | Allowed |
| `HIDDEN` | No (Soft-moderated) | No | 404 / 403 to non-mods | Rejected (403 Forbidden) |
| `RESTRICTED` | Limited (Age / Region / Quarantine) | Filtered | 200 with warnings | Conditional |
| `REMOVED` | No (Hard removal) | No | 404 Not Found | Rejected (403 Forbidden) |

---

## 2. Authorization Hierarchy & Scopes

The system establishes two distinct moderation spheres:
1. **Platform-Level Administration**: Global control held exclusively by `SUPER_ADMIN` and `SECURITY_ADMIN`.
2. **Entity-Level Moderation**: Space-bound control over Channels, Pages, and Groups held by space members based on their localized role.

```
                    PLATFORM LEVEL (Global)
                 ┌───────────────────────────┐
                 │        SUPER_ADMIN        │
                 └─────────────┬─────────────┘
                               │
                 ┌─────────────▼─────────────┐
                 │      SECURITY_ADMIN       │
                 └───────────────────────────┘

                    ENTITY LEVEL (Space-Scoped)
                 ┌───────────────────────────┐
                 │       Space OWNER         │
                 └─────────────┬─────────────┘
                               │
                 ┌─────────────▼─────────────┐
                 │       Space ADMIN         │
                 └─────────────┬─────────────┘
                               │
                 ┌─────────────▼─────────────┐
                 │       Space EDITOR        │
                 └─────────────┬─────────────┘
                               │
                 ┌─────────────▼─────────────┐
                 │      Space MODERATOR      │
                 └─────────────┬─────────────┘
                               │
                 ┌─────────────▼─────────────┐
                 │       Space MEMBER        │
                 └───────────────────────────┘
```

### Deterministic Permission Resolution: `canUserModerate`
Located in `scripts/database-engine.ts`:
```typescript
canUserModerate(actorDid: string, resource: { type: string; id: string; spaceId?: string }, explicitRole?: string): boolean
```

**Resolution Logic**:
1. If `actorDid` is a global admin or `explicitRole === 'SUPER_ADMIN' | 'SECURITY_ADMIN'`, authorization is **GRANTED** across all resources.
2. If the resource is scoped to an entity (e.g. Channel, Page, or Group):
   - Check `channel_members` or `group_members` for the specific entity ID.
   - If user has role `OWNER`, `ADMIN`, or `MODERATOR` within that space, authorization is **GRANTED**.
   - If user is only a `MEMBER` or has no membership in that specific space, authorization is **DENIED (HTTP 403 Forbidden)**.
3. Cross-space isolation is absolute: A moderator of `group_alpha` has zero moderation privileges over `group_beta`.

---

## 3. Moderation Actions & Lifecycle

| Action | Supported Roles | Target Types | Effect | Audit Event |
| :--- | :--- | :--- | :--- | :--- |
| `Hide` | Space Mod+, Platform Admin | Post, Comment, Video, Reel | Sets state to `HIDDEN`, excludes from feeds & search | `MODERATION_ACTION_HIDE` |
| `Unhide` / `Restore` | Space Mod+, Platform Admin | Post, Comment, Video, Reel | Sets state to `VISIBLE`, restores feeds & search | `MODERATION_ACTION_RESTORE` |
| `Remove` | Space Admin+, Platform Admin | Any content | Sets state to `REMOVED`, terminates lifecycle, marks reports `RESOLVED` | `MODERATION_ACTION_REMOVE` |
| `Warn` | Space Mod+, Platform Admin | User | Emits system alert notification to target user with warning message | `MODERATION_ACTION_WARN` |
| `Suspend` | Space Owner/Admin, Platform Admin | User (Space or Global) | Suspends user privileges in space or global platform | `MODERATION_ACTION_SUSPEND` |
| `StatusUpdate` | Space Mod+, Platform Admin | Report | Updates report status (`TRIAGED`, `UNDER_REVIEW`, `REJECTED`, `RESOLVED`) | `MODERATION_REPORT_STATUS_UPDATE` |

---

## 4. Moderation API Endpoints

All moderation endpoints require valid Bearer token authentication.

### `POST /api/moderation/report`
Creates a user-submitted report.
- **Request Body**: `{ targetType, targetId, reason, details?, evidenceUrl?, contextScopeId? }`
- **Security**: Derives `reporterDid` exclusively from authenticated session.
- **Response**: `200 OK` with `{ report: { id, status: 'SUBMITTED', ... } }`

### `GET /api/moderation/reports`
Lists reports for moderation triage.
- **Query Params**: `status`, `targetType`, `contextScopeId`
- **Security**: Validates moderator authority over `contextScopeId`. Global admins see all; space moderators see only reports in their assigned space.
- **Response**: `200 OK` with `{ reports: ReportRecord[] }`

### `POST /api/moderation/action`
Executes an actionable moderation measure.
- **Request Body**: `{ reportId?, targetType, targetId, action, notes?, contextScopeId? }`
- **Security**: Calls `canUserModerate`. Rejects unauthorized actions with `403 Forbidden`.
- **Response**: `200 OK` with `{ success: true, targetState, reportStatus }`

### `PATCH /api/moderation/report/status`
Updates workflow triage status of a report.
- **Request Body**: `{ reportId, status, notes? }`
- **Security**: Moderator or Admin session required.
- **Response**: `200 OK` with updated report.

---

## 5. Spatial Moderation Surfaces

The SOVRA Spatial Surface Engine provides tactile, non-intrusive UI overlays:

1. **`openSpatialReportSurface({ targetType, targetId, title })`**:
   - Opens a compact reporting modal avoiding oversized menus.
   - Guides user through: Reason selection -> Optional details -> Submit -> Confirmation.
2. **`openSpatialModerationSurface({ contextScopeId, role })`**:
   - For authorized moderators: Presents incoming reports, pending flags, restricted content, and resolution tools.
   - Excludes extraneous personal user data, strictly exposing content and violation claims.
3. **`openSpatialSecurityCenterSurface({ userDid })`**:
   - Provides user privacy dashboard: Active hardware sessions, blocked users list, mute preferences, and export requests.

---

## 6. Known Gaps & Future Roadmap

1. **Distributed Consensus on Mesh Moderation**: In a pure peer-to-peer mesh with no internet connectivity for weeks, malicious nodes could theoretically withhold local blocklists. Future phases will introduce Byzantine fault-tolerant signed moderation certificates propagated via gossip protocols.
2. **Automated Content Classification**: Currently relies on user reports and explicit moderator actions. Automated on-device neural perceptual hash models (e.g. PhotoDNA / PDQ) will be evaluated in Phase 9.
