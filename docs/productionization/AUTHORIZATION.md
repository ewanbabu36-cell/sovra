# Sovra — Authorization & RBAC Matrix

## 1. Canonical Authorization Model

Every protected resource evaluates:
`WHO (Principal) CAN DO WHAT (Action) TO WHICH RESOURCE (Target) UNDER WHICH CONDITIONS (Context)?`

| Resource | Action | Authorized Principals | Condition | HTTP Failure Code |
|---|---|---|---|---|
| Post | Create | Any Authenticated User | Valid session, bounded payload | `401 Unauthorized` |
| Post | Edit | Author | `post.authorDid === principal.did` | `403 Forbidden` |
| Post | Delete | Author, Admin | `authorDid === principal.did` OR `role === SUPER_ADMIN` | `403 Forbidden` |
| Post | View | Public / Friends / Author | `visibility === public` OR (`friends` AND `areFriends`) OR `authorDid === principal.did` | `403 Forbidden` / `404 Not Found` |
| Comment | Add | Any Authenticated User | Must have view access to post | `403 Forbidden` |
| Comment | Delete | Comment Author, Post Author | `comment.authorDid === principal.did` OR `post.authorDid === principal.did` | `403 Forbidden` |
| Direct Message | Send | Sender | `senderDid === principal.did` | `401 Unauthorized` |
| Direct Message | Read | Sender, Recipient | `senderDid === principal.did` OR `recipientDid === principal.did` | Filtered out |
| Channel | Create | Any Authenticated User | Unique handle | `409 Conflict` |
| Channel | Post | Channel Members | Caller is in channel roster | `403 Forbidden` |
| User Session | Revoke | Session Owner | `session.userDid === principal.did` | `404 Not Found` |
| Admin Console | Access | Super Admin | Bearer matches `ADMIN_SECRET_KEY` | `401 Unauthorized` |

---

## 2. Multi-User Verification
* Verified across `USER_A`, `USER_B`, and `USER_C`:
  * A publishes `only_me` post -> B & C cannot view it (`403 Forbidden`).
  * A publishes `friends` post -> B (friend) can view it; C (non-friend) cannot view it.
  * A sends private direct message to B -> C cannot view the thread.
  * B attempts to delete A's post -> rejected with `403 Forbidden`.
