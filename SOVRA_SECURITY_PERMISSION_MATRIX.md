# SOVRA Security Permission Matrix

## 1. Global Role-Based Access Control (RBAC)

The SOVRA platform maintains strict global roles managed via cryptographically signed admin tokens and public key verification:

| Global Role | View Global Reports | Take Moderation Action | View Audit Logs | Revoke Any User Session | System Health & Node Ops | Standard User Features |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `SUPER_ADMIN` | ✅ | ✅ (All resources) | ✅ (Unredacted) | ✅ | ✅ | ✅ |
| `SECURITY_ADMIN` | ✅ | ✅ (All resources) | ✅ (Unredacted) | ✅ | ❌ | ✅ |
| `MODERATOR` | ✅ | ✅ (Content/Users) | ✅ (Redacted) | ❌ | ❌ | ✅ |
| `INFRA_OPERATOR` | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| `ANALYST` | ✅ (Read-only) | ❌ | ✅ (Redacted) | ❌ | ❌ | ✅ |
| `SUPPORT` | ✅ (Assigned) | ❌ (Flag only) | ❌ | ❌ | ❌ | ✅ |
| `USER` | ❌ (Own only) | ❌ (Own spaces only) | ❌ | ❌ (Own devices only) | ❌ | ✅ |

---

## 2. Space-Scoped Role-Based Access Control

Entity spaces (Channels, Pages, Groups) operate with independent multi-tenant permissions. Roles are determined by `channel_members` and `group_members` tables:

| Space Role | Broadcast / Post | Edit Metadata | Manage Roles | Hide / Remove Content | Warn / Mute Member | Kick / Ban Member | Moderate Other Spaces |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `OWNER` | ✅ | ✅ | ✅ (All) | ✅ | ✅ | ✅ | ❌ |
| `ADMIN` | ✅ | ✅ | ✅ (Mod/Editor/Member) | ✅ | ✅ | ✅ | ❌ |
| `EDITOR` | ✅ | ✅ (Drafts/Posts) | ❌ | ❌ | ❌ | ❌ | ❌ |
| `MODERATOR` | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ (Temp mute only) | ❌ |
| `MEMBER` | ✅ (If allowed) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `GUEST` / `NON-MEMBER` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 3. Resource & Action Permission Matrix

| Resource | Action | Authorized Roles | Code Enforcement Method |
| :--- | :--- | :--- | :--- |
| **Report** | `create` | Any authenticated `USER` | `db.createReport` (Derives `reporterDid` from session) |
| **Report** | `read_global` | `SUPER_ADMIN`, `SECURITY_ADMIN`, Global `MODERATOR` | `db.getReports` (Validates admin role or explicit scope) |
| **Report** | `read_scoped` | Space `OWNER`, `ADMIN`, `MODERATOR` | `db.getReports` with matching `contextScopeId` |
| **Report** | `status_update` | Space `MODERATOR`+, Global Admin | `db.updateReportStatus` via `canUserModerate` |
| **Post / Comment** | `hide` | Space `MODERATOR`+, Global Admin | `db.takeModerationAction('Hide')` |
| **Post / Comment** | `restore` | Space `MODERATOR`+, Global Admin | `db.takeModerationAction('Restore')` |
| **Post / Comment** | `remove` | Space `ADMIN`+, Global Admin | `db.takeModerationAction('Remove')` |
| **User** | `warn` | Space `MODERATOR`+, Global Admin | `db.takeModerationAction('Warn')` |
| **User** | `suspend` | Space `OWNER`/`ADMIN`, Global Admin | `db.takeModerationAction('Suspend')` |
| **Audit Log** | `read` | `SUPER_ADMIN`, `SECURITY_ADMIN`, `MODERATOR` | `db.getAuditLogs` with `sanitizeAuditDetails` |
| **Hardware Session** | `revoke_others` | Self (`callerDid === session.userDid`) | `db.revokeAllOtherSessions` |
| **Block** | `create` / `delete` | Self (`callerDid === blockerDid`) | `db.blockUser`, `db.unblockUser` |
| **Mute** | `create` / `delete` | Self (`callerDid === userDid`) | `db.muteTarget`, `db.unmuteTarget` |
| **Mesh Packet** | `verify_ingest` | Any node verifying inbound packet | `db.verifyAndIngestMeshPacket` (Checks target content state) |

---

## 4. BOLA / IDOR Defense Verification

Every critical pathway is audited and validated against adversarial tests in `tests/security/adversarial-bola-idor-matrix.test.ts` and `tests/e2e/sovra-trust-safety-phase7.test.ts`:

1. **Reporter Identity Forgery**:
   - Attacker attempts to send `{ reporterDid: 'did:sovra:victim' }`.
   - Backend ignores or overwrites body parameter with cryptographically verified token DID.
2. **Cross-Space Moderator Abuse**:
   - Moderator of Group Alpha attempts `POST /api/moderation/action` targeting a post in Group Beta.
   - `canUserModerate` evaluates membership in Group Beta, detects lack of role, and rejects with `403 Forbidden: Moderator not authorized for this scope`.
3. **Foreign Hardware Session Termination**:
   - Attacker attempts to terminate target user's hardware sessions.
   - Endpoint binds target DID strictly to authenticated session token, rejecting cross-account termination.
4. **Audit Log Tampering**:
   - Moderation actions write append-only records to `audit_logs`.
   - Modifying or deleting audit log records via API is disallowed (no update/delete routes exist).
