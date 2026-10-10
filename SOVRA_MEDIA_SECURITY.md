# SOVRA Media Security & Access Control Model

## 1. Executive Summary: Zero-Trust Media Security
Media streaming in decentralized networks poses unique security challenges: direct CID exposure can allow unauthorized peers to access private media unless rigorous authorization gates are enforced at every stream slice.

SOVRA enforces **server-side Broken Object-Level Authorization (BOLA/IDOR) defense** across all media endpoints (`/api/feed/video/:cid`, `/api/video/stream/:cid`, `/api/watch/video/:cid`).

---

## 2. Media Visibility Matrix & RBAC

| Post / Media Visibility | Unauthenticated | Non-Friend Peer | Friend Peer | Author / Space Owner | Super Admin |
|---|---|---|---|---|---|
| **Public** | `200` / `206` | `200` / `206` | `200` / `206` | `200` / `206` | `200` / `206` |
| **Friends-Only** | `401 Unauthorized` | `403 Forbidden` | `200` / `206` | `200` / `206` | `200` / `206` |
| **Private / Only-Me** | `401 Unauthorized` | `403 Forbidden` | `403 Forbidden` | `200` / `206` | `200` / `206` |

### Tampering Defenses (CID, Post ID, Channel ID)
- If User B attempts to access User A's private video by directly calling `/api/feed/video/{cid}` or guessing `?postId={id}`, the server performs cryptographic resolution of the associated post record:
  1. Locates the post record referencing the target CID or `mediaVideo`.
  2. Extracts `post.visibility` and `post.authorDid`.
  3. Verifies the authenticated session token from headers (`Authorization: Bearer <token>` or `X-Sovra-DID`).
  4. If caller DID $\neq$ `post.authorDid` and caller is not `SUPER_ADMIN`, access is denied with `HTTP 403 Forbidden`.

---

## 3. Playlists & Channel Media RBAC
- Playlists are tied directly to channel and creator identities.
- **Modification & Reordering**: Restricted to playlist creator or channel managers (`OWNER`, `ADMIN`, `EDITOR`).
- **Deletion**: Restricted to playlist creator or channel administrator (`OWNER`, `ADMIN`).
- All attempts by unauthorized members to modify or reorder playlists return `HTTP 403 Forbidden`.

---

## 4. Watch History Threshold & Anti-Telemetry Abuse
- To prevent database bloat and artificial recommendation manipulation:
  - Video events with `durationWatchedSec < 5` (e.g. mouse hovers, quick clicks) are **strictly ignored** by the backend (`{ ok: false, ignored: true }`).
  - Only viewing sessions $\ge 5$ seconds are recorded to persistent history.
  - Users retain sovereign right to clear their entire history at any time (`POST /api/watch/history/clear`).

---

## 5. Saved Media Deduplication
- `POST /api/media/save` checks existing saved media collections for `(userDid, mediaId)` tuples.
- Repeated saves return `{ ok: true, alreadySaved: true }`, ensuring idempotent state and zero duplicate database entries.
