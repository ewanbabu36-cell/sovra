# SOVRA Trust & Safety Architecture

## 1. Overview & Architectural Principles

The SOVRA Trust & Safety Architecture provides a unified, zero-trust security and moderation foundation across all sovereign product surfaces: Profiles, Posts, Comments, Direct & Group Chat, Channels, Pages, Groups, Reels, Videos, Live Sessions, Global Search, Realtime Notifications, Media Transcoding, and Offline Mesh Store-and-Forward packets.

```
                      SOVRA Sovereign Identity (DID / Ed25519)
                                       │
                                       ▼
                     Trust & Safety Enforcement Layer
  ┌────────────────────────────────────┼────────────────────────────────────┐
  │                                    │                                    │
  ▼                                    ▼                                    ▼
Content & Communication            Entity Scopes                    Moderation Actions
├── Posts / Comments               ├── Channels (Owner/Admin/Mod)    ├── Flag / Report
├── Direct & Group Chat            ├── Pages (Owner/Admin/Mod)       ├── Hide / Unhide
├── Reels & Videos                 ├── Groups (Owner/Admin/Mod)      ├── Remove / Restore
├── Live Stream Signaling          └── Global Platform Admin         ├── Warn / Suspend
└── Mesh Packets & Sync                 (SUPER_ADMIN)                └── Redact & Audit
```

### Core Architecture Rules:
1. **Server-Side Authorization**: No frontend-only filtering or hiding. Every request to fetch, query, mutate, search, stream, or synchronize content executes deterministic server-side identity verification and relationship gating.
2. **Unified Taxonomy**: Standardized, compact reporting categories applied consistently across all content surfaces.
3. **Multi-Tenant Space Isolation**: Entity-level roles (`OWNER`, `ADMIN`, `EDITOR`, `MODERATOR`, `MEMBER`) restrict moderation power strictly to the target entity's partition. A channel moderator cannot touch posts or members in another channel or group.
4. **BOLA / IDOR Defense**: The acting identity is strictly derived from the authenticated cryptographically signed session token. No user can report under another user's DID, modify foreign reports, or alter audit logs.
5. **Offline & Mesh Synchronization**: Durable local outbox queueing for reports and safety actions with HMAC/signature verification on mesh receipt. Inbound mesh sync rejects any packets referencing moderated or hidden content with strict HTTP 403 Forbidden.

---

## 2. Surfaces Covered

The Trust & Safety system protects nine distinct surface categories:

| Surface | Protected Interactions | Enforcement Mechanism |
| :--- | :--- | :--- |
| **Profiles** | Viewing bio, profile data, follower graph | Bidirectional block filter; private profile approval check |
| **Feed Posts & Comments** | Creating, reading, commenting, liking | Author block checks, content state checks (`VISIBLE`, `HIDDEN`, `REMOVED`), space-level moderation |
| **Direct & Group Chat** | P2P & relay message delivery, attachments | Rejection of messages if recipient blocked sender or vice versa (HTTP 403) |
| **Channels & Pages** | Content broadcasting, editing, comment moderation | Space-scoped RBAC (`canUserModerate` checks entity owner/admin/moderator) |
| **Groups** | Member management, post moderation | Strict isolation: Group A moderators cannot moderate Group B resources |
| **Reels & Videos** | Media playback, description, metadata | Video state enforcement; hidden videos filtered from public catalog |
| **Live Sessions** | Real-time chat, stream participation, host moderation | Live session host and channel moderators have exclusive kick/mute/delete permissions |
| **Search & Discovery** | Public handle, hashtag, content querying | Search query pipeline filters blocked identities and non-visible content |
| **Offline Mesh Sync** | Store-and-forward bundle delivery, packet ingestion | `verifyAndIngestMeshPacket` verifies content status before accepting into local inbox |

---

## 3. Reporting System Architecture

### Report Lifecycle States
- `SUBMITTED`: Report created by an authenticated user and queued for review.
- `TRIAGED`: Automated or manual categorization and priority assignment.
- `UNDER_REVIEW`: A human moderator or administrator has claimed the case.
- `ACTION_TAKEN`: A moderation action (`Hide`, `Remove`, `Warn`, `Suspend`) was executed against the content or target.
- `RESOLVED`: Final state indicating the report workflow has been completed.
- `REJECTED`: Report determined to be duplicate, bad-faith, or non-violative.

### Reporting Data Model
```typescript
interface ReportRecord {
  id: string;                      // rep_<nanoid>
  targetType: 'user' | 'post' | 'comment' | 'message' | 'channel' | 'page' | 'group' | 'video' | 'reel' | 'live';
  targetId: string;
  reporterDid: string;             // Authenticated DID of reporter
  reason: ModerationCategory;
  details?: string;
  evidenceUrl?: string;
  contextScopeId?: string;         // Channel ID, Group ID, or 'global'
  status: 'SUBMITTED' | 'TRIAGED' | 'UNDER_REVIEW' | 'ACTION_TAKEN' | 'RESOLVED' | 'REJECTED';
  moderatorNotes?: string;
  assignedModeratorDid?: string;
  createdAt: number;
  updatedAt: number;
}
```

### Standardized Taxonomy
1. `SPAM`: Unsolicited commercial or automated repetitive posts.
2. `HARASSMENT`: Targeted insults, threats, doxxing, or stalking.
3. `IMPERSONATION`: Falsely claiming identity of other persons or organizations.
4. `FRAUD`: Scams, deceptive schemes, phishing links.
5. `VIOLENCE`: Incitement, violent extremism, physical threats.
6. `ILLEGAL_CONTENT`: Regulated or illicit commerce, severe harm.
7. `PRIVACY_VIOLATION`: Sharing non-consensual personal information or media.
8. `SEXUAL_CONTENT`: Adult non-consensual imagery, sexually explicit media.
9. `CHILD_SAFETY`: Zero-tolerance high-priority child exploitation or endangerment.
10. `COPYRIGHT`: Digital millennium and IP rights infringement.
11. `OTHER`: General terms violation.

---

## 4. Relationship Enforcement Matrix

| Relationship | Behavior Description | Persistence | Symmetric / Asymmetric |
| :--- | :--- | :--- | :--- |
| **Block** | Alice blocks Bob: Bob cannot view Alice's profile, post comments on Alice's content, send chat messages to Alice, or find Alice in search. Alice cannot view Bob's profile unless unblocked. | Real SQLite `blocks` table | Asymmetric action, Bidirectional enforcement |
| **Mute** | Alice mutes Bob (or Conversation/Channel): Notifications from target are silenced. Bob can still view content and send messages, but Alice receives no alerts or badges. | Real SQLite `mutes` table | Asymmetric (unilateral silent filter) |
| **Unfollow** | Alice unfollows Bob: Bob's posts cease appearing in Alice's default following feed. No communication or profile restrictions applied. | Real SQLite `follows` table | Asymmetric |

---

## 5. Offline Mesh & Store-and-Forward Safety

1. **Local Outbox Queueing**: When a user files a report or takes a moderation action while offline, the action is durably committed to the `moderation_outbox` table with status `PENDING`.
2. **Reconnection Batch Sync**: Upon regaining internet or P2P mesh relay connectivity, `/api/moderation/outbox/sync` executes an idempotent bulk ingestion, deduplicating against existing `id` and `timestamp`.
3. **Inbound Packet Gatekeeping**:
   ```
   Mesh Packet Arrival
          │
          ▼
   Check target content ID in ContentModerationState
          │
          ├── If State == HIDDEN / REMOVED / SUSPENDED ──► REJECT (HTTP 403 / Mesh Drop)
          │
          └── If State == VISIBLE / Non-existent ───────► ALLOW Ingestion
   ```

---

## 6. Verification & Automated Test Coverage

The Trust & Safety system is thoroughly validated by `tests/e2e/sovra-trust-safety-phase7.test.ts` (47 comprehensive tests):
- Submitting reports across all 10 target types.
- Report lifecycle state machine (`SUBMITTED` -> `TRIAGED` -> `UNDER_REVIEW` -> `ACTION_TAKEN` -> `RESOLVED`).
- Moderation actions (`Hide`, `Restore`, `Remove`, `Warn`, `Suspend`).
- Bidirectional block across profiles, feeds, comments, search, and chat.
- Persisted mute relationships distinct from blocks and unfollows.
- Mesh packet rejection for moderated targets and outbox sync.
- Cryptographic redaction and append-only audit logging.
