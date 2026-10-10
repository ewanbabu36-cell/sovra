# SOVRA Create Surface Flow

## 1. Overview
The **Create Surface** (`openSpatialCreateSurface`) is the unified creation portal across all SOVRA content modalities and space types:
```
SOVRA CORE (Logo)
  ↓
[Create Node]
  ↓
openSpatialCreateSurface()
  ├── ✍️ Post     → openSpatialPostCreatorSurface()
  ├── 📷 Photo    → openSpatialPhotoCreatorSurface()
  ├── 🎥 Video    → openSpatialVideoCreatorSurface()
  ├── 🎬 Reel     → openSpatialReelCreatorSurface()
  ├── 📊 Poll     → openSpatialPollCreatorSurface()
  ├── ❓ Question → openSpatialQuestionCreatorSurface()
  ├── 📢 Channel  → openSpatialChannelCreatorSurface()
  ├── 🏢 Page     → openSpatialPageCreatorSurface()
  └── 👥 Group    → openSpatialGroupCreatorSurface()
```

---

## 2. Space Creation Routing
When a space entity is created:
1. **Channel**:
   - Submits `POST /api/social/channels` with `{ name, handle, category, desc }`.
   - On success, registers channel into local memory and immediately opens `openSpatialStudioSurface(channel.id, 'channel')`.
2. **Page**:
   - Submits `POST /api/social/pages` with `{ name, handle, category, ctaType, bio }`.
   - On success, registers page and immediately opens `openSpatialStudioSurface(page.id, 'page')`.
3. **Group**:
   - Submits `POST /api/social/groups` with `{ name, handle, privacy, description }`.
   - On success, registers group and immediately opens `openSpatialStudioSurface(group.id, 'group')`.

---

## 3. Media Creation Routing
- **Feed Posts**: Dispatched via `POST /api/feed/post` with Ed25519 signing.
- **Polls**: Dispatched to feed with vote tracking.
- **Photos / Videos**: Dispatched with verified decentralized hashes or streaming URLs.
