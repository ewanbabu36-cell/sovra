# SOVRA Communication Architecture (Phase 4)

## 1. Overview
The **SOVRA Spatial Communication Layer** seamlessly integrates real-time peer-to-peer messaging, file sharing, WebRTC audio/video calls, and notifications directly into the SOVRA Spatial Surface Engine.

---

## 2. Core Architectural Pillars
1. **Zero Permanent Docks**:
   - No permanent global chat panel, side dock, or floating notifications tray cluttering the screen.
   - Entry occurs exclusively via the **SOVRA Core Logo** or contextual triggers (e.g. Profile `Message` button, entity mentions).
2. **Spatial Surface Hierarchy**:
   - Pushing conversations, actions, and calls creates stacked surfaces with organic depth, backdrop blur, and origin-coordinate scaling.
   - Pressing `ESC` or clicking the back button unwinds the active surface cleanly without full-page reloads.
3. **P2P Cryptographic Transport**:
   - Peer messaging utilizes Noise_XX session handshakes and Double Ratchet packet encryption.
   - Direct WebRTC media sessions stream encrypted 48kHz Opus audio and VP8 video between peers.
4. **Honest Data Only**:
   - Contacts and message history are queried directly from real backend persistence (`/api/chat/contacts`, `/api/chat/messages`).
   - Zero hardcoded mock conversation cards (no fake Alice/Bob/Swarm Bot mockups).

---

## 3. Communication Component Pipeline
```
SOVRA CORE (Logo)
  ↓
[Chat Node]
  ↓
openSpatialChatSurface()
  ├── Real Contacts Stream (/api/chat/contacts)
  ├── Live Filter Search
  └── [+ New Chat] → openSpatialNewChatSurface()
        ↓
  Click Contact
        ↓
openSpatialConversationSurface(contactDid)
  ├── WebRTC Call Controls (📞 / 📹) → openSpatialCallSurface()
  ├── Encrypted Message Bubbles (Noise_XX / Double Ratchet)
  ├── Safe Attachment Previews (/api/chat/attachment/:cid)
  ├── Realtime Composer (Text, File Picker, Send)
  └── Message Click → openSpatialMessageActionsSurface(msg)
        ├── Reactions (/api/chat/reaction)
        ├── Copy Text
        └── Delete (/api/chat/delete)
```
