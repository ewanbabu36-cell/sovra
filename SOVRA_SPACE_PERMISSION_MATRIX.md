# SOVRA Space Permission Matrix (RBAC Engine)

## 1. Overview
The SOVRA Space RBAC engine regulates access control across all managed entities (Channels, Pages, Groups). Roles are bound cryptographically to decentralized identities (`did:sovra:...`) and enforced strictly on the server:
- Client-side checks provide UX hints and UI filtering only.
- Every mutation endpoint independently resolves the caller principal via Bearer token / Ed25519 signature headers (`resolvePrincipal(req)`) and validates authority against `sovraDb.hasSpacePermission(userDid, spaceId, permission, spaceType)`.

---

## 2. Defined Roles
1. **OWNER (`OWNER`)**: The cryptographic creator or designated successor. Holds unconditional authority over space lifecycle, destructive mutations, and ownership transfer.
2. **ADMIN (`ADMIN`)**: Delegated operational executive. Can manage all content, update settings, manage team roles (except modifying the Owner), and approve join requests.
3. **EDITOR (`EDITOR`)**: Authorized content publisher. Can create, edit, pin, and delete their own dispatches and drafts. Cannot modify settings or manage members.
4. **MODERATOR (`MODERATOR`)**: Community protector. Can remove abusive dispatches, delete rule violations, enforce space rules, and mute or remove disruptive members.
5. **MEMBER (`MEMBER`)**: Standard participant or subscriber. Can view public/group dispatches, reply, react, and submit join requests.

---

## 3. Cryptographic Capability Matrix

| Capability / Action | OWNER | ADMIN | EDITOR | MODERATOR | MEMBER |
|:---|:---:|:---:|:---:|:---:|:---:|
| **Delete Space Entity** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Transfer Ownership** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Update Space Settings** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Manage Space Rules** | ✅ | ✅ | ❌ | ✅ | ❌ |
| **Delegate Admin Roles** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Delegate Editor / Mod Roles** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Remove Non-Admin Member** | ✅ | ✅ | ❌ | ✅ | ❌ |
| **Remove Admin Member** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Publish Dispatches / Media** | ✅ | ✅ | ✅ | ❌ | ❌* |
| **Edit / Delete Own Content** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Delete Any Content (Mod)** | ✅ | ✅ | ❌ | ✅ | ❌ |
| **View Internal Telemetry** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **View Public Dispatches** | ✅ | ✅ | ✅ | ✅ | ✅ |

*\*Note: In Group discussions configured with `allowMemberPosts=true`, Members can submit discussion posts subject to moderation.*

---

## 4. Enforcement Implementation
Server endpoints in `scripts/dev-server.ts` use the database engine method:
```typescript
sovraDb.canManageSpace(callerDid, spaceId, spaceType);
// Verifies user is either direct owner or holds OWNER/ADMIN space membership record.
```
Any mutation attempted without meeting the matrix condition returns HTTP 403 Forbidden with `{ ok: false, error: "Insufficient permission" }`.
