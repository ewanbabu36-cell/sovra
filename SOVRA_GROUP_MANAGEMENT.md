# SOVRA Group Management

## 1. Overview
The **Group Management Studio** manages peer-to-peer community spaces and discussion circles. Groups focus on multi-directional peer interaction, privacy rings, and cryptographic community moderation.

---

## 2. Privacy Rings
Groups support 3 distinct privacy levels:
1. **Public**: Open to all discovered mesh peers. Anyone can discover the group in Omni-Search, join, and participate in discussion threads.
2. **Private**: Discovered via directory or invite link, but joining requires cryptographic approval from an `OWNER` or `ADMIN`.
3. **Secret**: Invisible to directory indexing. Membership and packet exchange require explicit cryptographically signed invitations.

---

## 3. Community Rules Lifecycle
Groups enforce decentralized governance through persisted space rules:
- **Create Rule**: `POST /api/social/groups/rules` with `{ groupId, title, description }`.
- **List Rules**: `GET /api/social/groups/rules?groupId=:groupId`.
- **Delete Rule**: `POST /api/social/groups/rules/delete` with `{ groupId, ruleId }`.
Rules are displayed transparently to joining peers to prevent spam, Sybil nodes, and unauthorized harvesting.

---

## 4. Moderation & Join Requests
- **Membership Operations**:
  - Join space: `POST /api/social/groups/join`
  - Fetch members: `GET /api/social/groups/members?groupId=:groupId`
  - Remove member: `POST /api/studio/team/remove`
- **Join Requests**: For private groups, pending requests are retrieved via `GET /api/social/groups/join-requests` and approved/rejected via `POST /api/social/groups/join-requests/respond`.
- **Auditability**: All moderation actions log the acting moderator DID and timestamp to ensure accountability.
