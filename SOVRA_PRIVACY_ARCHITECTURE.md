# SOVRA Privacy Architecture

## 1. Privacy Principles & Sovereign Data Governance

In the SOVRA ecosystem, user privacy is anchored in cryptography and sovereign data ownership rather than corporate policy promises:

1. **Cryptographic Identity Binding**: All user accounts are Decentralized Identifiers (DIDs) rooted in Ed25519 asymmetric key pairs.
2. **Zero Information Leakage in Search**: Private profiles, private posts, and blocked identities are omitted from global and local search queries before results are serialized.
3. **No IDOR / Direct Identifier Access**: Direct fetching by UUID or nanoid (`/api/feed/post?id=...` or `/api/profile?did=...`) enforces author privacy policies and block checks at the database layer.
4. **Session Sovereignty**: Hardware session keys are compartmentalized. Users can inspect all active device sessions and terminate unauthorized or old hardware sessions at will.

---

## 2. Block Architecture & Cross-Surface Enforcement

When User A blocks User B, the relationship is recorded in the persistent `blocks` table:
```sql
CREATE TABLE blocks (
  id TEXT PRIMARY KEY,
  blocker_did TEXT NOT NULL,
  blocked_did TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(blocker_did, blocked_did)
);
```

### Surface Enforcement Matrix

```
       User A (Blocker) ──────────── BLOCK ───────────► User B (Blocked)
              │                                                │
              ├────── Bidirectional Profile Lockdown ──────────┤
              ├────── Feed / Post Hiding Both Ways ────────────┤
              ├────── Comment Creation Rejection (403) ────────┤
              ├────── Direct / Group Chat Drop (403) ──────────┤
              ├────── Search Result Filtering ─────────────────┤
              ├────── Notification Suppression ────────────────┤
              └────── Space Discovery & Membership Gating ─────┘
```

1. **Profile Surface**:
   - Bob requesting Alice's profile receives `isBlocked: true` with all personal data (posts, follower count, email, bio) redacted.
   - Alice requesting Bob's profile receives clear indication of active block status.
2. **Feed & Posts**:
   - `/api/feed/posts` checks blocker and blocked lists for the requesting user DID. Alice's posts never appear in Bob's feed, and Bob's posts never appear in Alice's feed.
3. **Comments**:
   - Submitting a comment on a post owned by a blocker or blocked user is immediately rejected with `403 Forbidden: Block relationship active`.
4. **Chat & Realtime Communication**:
   - `/api/chat/send` checks if recipient blocked sender or sender blocked recipient. Returns `403 Forbidden: Blocked relationship active`. WebRTC call offers are likewise dropped.
5. **Search & Discovery**:
   - `/api/search/users` and `/api/search/content` join against active block records, excluding both blocker and blocked from search hits.
6. **Notifications**:
   - Notification dispatch silently discards any alerts originating from blocked or muting counterparts.

---

## 3. Mute vs Block vs Unfollow

SOVRA explicitly differentiates between these three distinct social states:

```
┌─────────────────┬─────────────────────┬──────────────────┬─────────────────────┐
│ Feature         │ MUTE                │ BLOCK            │ UNFOLLOW            │
├─────────────────┼─────────────────────┼──────────────────┼─────────────────────┤
│ Purpose         │ Silence alerts      │ Total isolation  │ Feed curation       │
│ Visibility      │ Full content visible│ Completely hidden│ Public posts visible│
│ Can Comment?    │ Yes                 │ Rejected (403)   │ Yes                 │
│ Can Chat?       │ Yes (silenced)      │ Rejected (403)   │ Yes                 │
│ Search Filter?  │ No                  │ Yes (filtered)   │ No                  │
│ Target Notified?│ Never               │ Never            │ No                  │
│ Scope           │ User / Conv / Space │ User to User     │ User to User        │
└─────────────────┴─────────────────────┴──────────────────┴─────────────────────┘
```

### Persisted Mute Table
```typescript
interface MuteRecord {
  id: string;
  userDid: string;
  targetType: 'user' | 'conversation' | 'channel' | 'group';
  targetId: string;
  createdAt: number;
}
```

---

## 4. Multi-Device Hardware Session Management

Users can view and manage all active hardware sessions across smartphones, tablets, laptops, and desktop nodes:

- **Endpoint**: `POST /api/user/sessions/revoke-others`
- **Behavior**:
  1. Identifies the caller's currently active session token.
  2. Identifies all other sessions associated with `userDid` in `active_sessions`.
  3. Transitions non-matching sessions to `REVOKED` state and purges session caches.
  4. Returns count of terminated hardware devices.
- **Security**: A user cannot revoke sessions belonging to a foreign DID (IDOR protection verified by `tests/e2e/sovra-trust-safety-phase7.test.ts`).

---

## 5. Private Content Leakage Defenses

1. **Direct Identifier Protection**: Direct retrieval of posts, stories, reels, or profile bios via query params (`?id=...`) executes an ownership/privacy gate check:
   - If post is set to `PRIVATE` or `FOLLOWERS_ONLY`, the requester's DID must match the author or be an approved follower.
   - Non-compliant requests return `404 Not Found` or `403 Forbidden` to prevent object existence enumeration.
2. **Search Index Masking**: Content marked `HIDDEN`, `REMOVED`, or belonging to private profiles is strictly excluded from Lucene/SQLite FTS indexing.
3. **Attachment Link Tokens**: Media attachments are never served via raw static predictable URLs. URLs are generated with short-lived authenticated capability tokens (`/api/media/secure-download?token=...`).

---

## 6. Offline Local Data Privacy

1. **Encrypted SQLite Storage**: Local node databases use SQLCipher AES-256 encryption at rest.
2. **Zero Plaintext Telemetry**: No tracking beacons, surveillance pings, or third-party SDK calls exist in the codebase.
3. **Mesh Packet Minimization**: Advertised Bluetooth BLE beacons and discovery frames expose only ephemeral session identifiers, omitting public keys, usernames, and DIDs.
