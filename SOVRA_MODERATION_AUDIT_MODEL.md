# SOVRA Moderation Audit Model

## 1. Audit Principles & Immutability Guarantee

Every action within the Trust & Safety system generates an auditable, append-only record. The audit trail guarantees non-repudiation and forensic accountability while preserving privacy:

1. **Append-Only Architecture**: The `audit_logs` table has no `UPDATE` or `DELETE` triggers or exposed API routes.
2. **Actor-Attributed**: Every moderation intervention explicitly records the actor's DID, their authorization role at the time of action, the target resource identifier, the previous state, and the resulting state.
3. **Cryptographic Redaction**: When logs are queried by lower-privilege roles (e.g. `MODERATOR`, `ANALYST`), sensitive personally identifiable information (PII), private credentials, and secret notes are cryptographically masked or redacted via `sanitizeAuditDetails`.

---

## 2. Audit Record Schema

```typescript
interface ModerationAuditRecord {
  id: string;                     // aud_<nanoid>
  timestamp: number;              // Epoch timestamp in milliseconds
  actorDid: string;               // DID of moderator or system actor
  actorRole: string;              // 'SUPER_ADMIN' | 'MODERATOR' | 'OWNER' | 'SYSTEM'
  action: string;                 // 'MODERATION_ACTION_HIDE' | 'MODERATION_ACTION_REMOVE' | etc.
  targetType: string;             // 'post' | 'comment' | 'user' | 'channel' | 'group' | 'message'
  targetId: string;               // Target resource identifier
  contextScopeId?: string;        // Space scope identifier (or 'global')
  previousState?: string;         // 'VISIBLE' | 'REPORTED' | 'UNDER_REVIEW'
  newState?: string;              // 'HIDDEN' | 'REMOVED' | 'RESTRICTED'
  reason?: string;                // Moderation rationale / category
  details?: Record<string, any>;  // Structured metadata and evidence references
  ipAddressHash?: string;         // Salted SHA-256 hash of origin IP
}
```

---

## 3. Supported Audit Event Types

| Event Name | Trigger Condition | Logged Attributes |
| :--- | :--- | :--- |
| `REPORT_SUBMITTED` | User files a violation report | Target type/ID, category, reporter DID, scope |
| `REPORT_STATUS_UPDATE` | Report transitions state (`TRIAGED`, `UNDER_REVIEW`, etc.) | Previous status, new status, moderator DID |
| `MODERATION_ACTION_HIDE` | Content hidden from public surfaces | Content ID, author DID, moderator DID, reason |
| `MODERATION_ACTION_RESTORE` | Hidden content restored to visible | Content ID, previous state, moderator DID |
| `MODERATION_ACTION_REMOVE` | Content permanently removed | Content ID, previous state, moderator DID |
| `MODERATION_ACTION_WARN` | Official warning issued to user account | Target user DID, moderator DID, warning text |
| `MODERATION_ACTION_SUSPEND` | User account suspended | Target user DID, suspension duration, scope |
| `USER_BLOCK_CREATED` | User blocks another user | Blocker DID, blocked DID |
| `USER_BLOCK_REMOVED` | User unblocks another user | Blocker DID, unblocked DID |
| `SESSIONS_REVOKED_BULK` | User terminates all other hardware sessions | User DID, count of revoked hardware tokens |

---

## 4. Cryptographic Redaction & Privacy Masking

The `sanitizeAuditDetails` function enforces field-level access control on audit responses:

```typescript
export function sanitizeAuditDetails(
  details: Record<string, any>,
  requestingRole: string
): Record<string, any> {
  const sanitized = { ...details };

  // Only SUPER_ADMIN and SECURITY_ADMIN can view raw unredacted IP hashes and internal reporter evidence
  if (requestingRole !== 'SUPER_ADMIN' && requestingRole !== 'SECURITY_ADMIN') {
    delete sanitized.rawIp;
    delete sanitized.tokenHash;
    if (sanitized.reporterDetails) {
      sanitized.reporterDetails = '[REDACTED_FOR_PRIVACY]';
    }
    if (sanitized.evidenceUrl && sanitized.isPrivateMedia) {
      sanitized.evidenceUrl = '[PROTECTED_EVIDENCE_REFERENCE]';
    }
  }

  return sanitized;
}
```

---

## 5. Offline & Mesh Audit Log Synchronization

1. **Local Node Tamper Evident Storage**: In offline mode, moderation interventions taken by a local space moderator are recorded in the local SQLite `audit_logs` table.
2. **Batch Sync Verification**: When syncing with peers or platform relay nodes, each audit entry is accompanied by the moderator's cryptographic Ed25519 signature over `SHA256(actorDid + action + targetId + timestamp)`.
3. **Conflict & Replay Prevention**: The synchronization engine verifies that the timestamp does not exceed permissible clock drift and rejects duplicate entries based on the unique audit record UUID.

---

## 6. Retention & Verification Testing

The audit model is validated continuously by the automated test suite:
- `tests/e2e/sovra-trust-safety-phase7.test.ts` (Section 9):
  - Confirms that every moderation action (`Hide`, `Restore`, `Remove`, `Warn`) writes an entry into `audit_logs`.
  - Confirms actor identity matches authenticated session.
  - Verifies `sanitizeAuditDetails` masks sensitive fields for non-admin principals.
