# SOVRA Studio Architecture

## 1. Executive Summary & Design Vision
The **SOVRA Studio** is a unified spatial operating layer engineered directly on top of the SOVRA Spatial Surface Engine (Phase 1) and SOVRA Core (Logo navigation). Rather than fragmenting the user experience across three disparate web applications or cluttering the interface with permanent sidebars, SOVRA Studio provides a clean, cybernetic, contextual management system for:
1. **Channels** (broadcast feeds, subscriber audiences, public/private dispatches)
2. **Pages** (verified organization, business identity, call-to-action leads, public brand presence)
3. **Groups** (end-to-end encrypted mesh circles, discussions, rule enforcement)

Management flows logically under a single authenticated user identity:
```
USER (Sovereign DID Keypair)
  ↓
SOVRA STUDIO (Contextual Management Plane)
  ↓
SELECTED SPACE
  ├── Channel (Rahul Tech)
  ├── Page (SOVRA India)
  └── Group (Bihar Tech Community)
```

---

## 2. Contextual Discovery vs Permanent Clutter
SOVRA strictly forbids permanent "Studio" tabs in the global shell navigation. Instead, Studio is discovered contextually through the entity being managed:
1. **Profile Route**:
   - `SOVRA Core` → `Profile` → `My Channels` / `My Pages` / `My Groups` → Select Space → `SOVRA Studio`.
2. **Entity Card Route**:
   - Viewing an entity card owned by the user surfaces a `⚙️ Manage` action that mounts `openSpatialStudioSurface(spaceId, spaceType, originEl)`.
3. **Creation Route**:
   - Launching a space via `openSpatialChannelCreatorSurface`, `openSpatialPageCreatorSurface`, or `openSpatialGroupCreatorSurface` immediately transitions the user into the active space studio upon cryptographic confirmation.

---

## 3. Spatial Surface Engine Integration & Space Switcher
When entering Studio, the user is presented with only the selected space context:
- Space Header: Name, Avatar, Category, Verified Role Badge (`OWNER`, `ADMIN`, etc.).
- Contextual Switcher Button: `⇄ Switch Space`.
- Progressive Disclosure Tabs: `Overview`, `Content`, `Community`, `Settings`.

Clicking `⇄ Switch Space` pushes a compact spatial surface:
```
openSpatialSpaceSwitcherSurface(originEl, currentSpaceId)
  ├─ Rahul Tech (Channel • Active)
  ├─ SOVRA India (Page)
  └─ Bihar Tech Community (Group)
```
Selecting any space pops the switcher and smoothly re-indexes the Studio context to the chosen entity without triggering a full-page reload.

---

## 4. Progressive Disclosure Layout
To maintain an uncluttered interface, Studio exposes nested tools on demand:
- **Overview**: Persisted audience count, content volume, delivery reach, and recent interaction trail. If no telemetry exists, honest `"No activity yet."` state is rendered.
- **Content**: Dispatches, announcements, media items, with instant moderation actions (delete, unpublish, pin).
- **Community**: Real peer members, subscribers, and cryptographic admin delegations.
- **Settings**: Space name, handle, metadata, discoverability toggles, community rules, and cryptographic ownership management.

---

## 5. Unified Backend API Endpoints
All Studio surfaces interact exclusively with real, authenticated REST endpoints:
- `GET /api/studio/spaces`: Returns user's owned and managed channels, pages, and groups.
- `GET /api/studio/space?spaceId=:id&spaceType=:type`: Returns metadata, verified role, and real telemetry counts.
- `GET /api/studio/content?spaceId=:id`: Returns all posts/dispatches created under the space.
- `GET /api/studio/team?spaceId=:id&spaceType=:type`: Returns peer members and their assigned RBAC roles.
- `POST /api/studio/team/role`: Updates space member role (`OWNER`, `ADMIN`, `EDITOR`, `MODERATOR`, `MEMBER`).
- `POST /api/studio/team/remove`: Revokes space access from a member.
