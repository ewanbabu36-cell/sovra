# SOVRA Channel Studio

## 1. Overview
The **Channel Studio** provides specialized broadcast management for content creators, publishers, and decentralized media outlets. Channels operate as one-to-many communication pipelines:
- Only authorized admins and editors publish dispatches.
- Subscribers receive authenticated real-time updates and can submit reactions/comments.

---

## 2. Channel Studio Functional Areas
Within `openSpatialStudioSurface(channelId, 'channel')`, progressive disclosure reveals 4 dedicated areas:

### 2.1 Overview
- **Persisted Metrics**: Real subscriber count from `channel.count`, content volume from database, and last published activity timestamp.
- **Honest States**: If the channel is brand new, Studio displays `"No activity yet."` instead of fabricated subscriber counts or mock views.
- **Verification**: Badge displaying `"Cryptographically Verified Sovereign Channel"`.

### 2.2 Content Management
- **Media Modalities**: Video broadcasts, Reels/Shorts, audio clips, text dispatches, and interactive polls.
- **Real Backend Endpoints**:
  - Fetch content: `GET /api/studio/content?spaceId=:channelId`
  - Create broadcast: `POST /api/feed/post` with `{ channelTargetId: channelId }`
  - Remove broadcast: `POST /api/social/post/delete`
- **Actions**: Publish, unpublish, pin to top, inspect peer delivery hops.

### 2.3 Community & Subscribers
- **Subscriber Registry**: Real count of verified peer DIDs subscribed via mesh gossip.
- **Team Delegations**: Delegate `ADMIN`, `EDITOR`, or `MODERATOR` roles to trusted peers via `POST /api/studio/team/role`.

### 2.4 Channel Settings
- **Broadcast Metadata**: Channel name, handle (`@handle`), avatar, and description.
- **Policy Control**: Broadcast mode (Admins Only vs Open Discussion).
- **Directory Discovery**: Mesh directory advertisement toggle in Omni-Search.
