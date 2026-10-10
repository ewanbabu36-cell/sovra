# SOVRA Notification Surface Flow

## 1. Overview
The **Notifications Surface** (`openSpatialNotificationsSurface`) delivers a unified view of mesh alerts, peer interactions, direct message dispatches, and community updates without relying on an obtrusive drawer or permanent top-dock bell.

---

## 2. Notification Pipeline & Deep-Linking
When a notification card is clicked in the surface:
1. **Persistent Read Marking**:
   - Fires `POST /api/notifications/read` with `{ notificationId: notif.id }`.
   - The server updates the database record via `sovraDb.markNotificationRead(...)` and decrements unread counters.
2. **Contextual Deep-Link Routing (`_handleNotificationClick`)**:
   - **Type `message` / `chat`**: Deep-links directly into `openSpatialConversationSurface(senderDid, null, senderName)`.
   - **Type `channel` / `page` / `group` / `space`**: Deep-links directly into `openSpatialStudioSurface(spaceId, spaceType)`.
   - **Type `friend_request` / `friend`**: Switches active view to the Friends Directory (`switchTab('friends')`).
   - **Other / Network alerts**: Switches to the Sovereign Mesh Feed (`switchTab('feed')`).

---

## 3. Filtering Modalities
The surface header provides instant categorical filtering:
- **All**: Displays all received notifications in reverse chronological order.
- **Chats**: Filters strictly for direct messages and conversation alerts.
- **Mesh**: Filters for network alerts, friend requests, peer connections, and community dispatches.
- **✓ Mark All Read**: Calls `POST /api/notifications/read-all` to clear all unread badges across the node.
