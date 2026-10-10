# SOVRA Chat Surface Flow

## 1. Flow Overview
The chat surface flow defines the user journey from discovering conversations to interacting with peers:

```
[SOVRA Core Logo]
       │
       ▼ Click "Chat"
┌────────────────────────────────────────────────────────┐
│                   SOVRA CHAT SURFACE                   │
│                                                        │
│  [🔍 Search conversations...]        [+ New Chat]      │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ 👤 Alice (@alice.node)                           │  │
│  │    "Did you verify multi-hop relay route?"       │  │
│  │    10:42 AM • 🔒 Noise_XX • Direct P2P           │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
       │
       ▼ Click Contact
┌────────────────────────────────────────────────────────┐
│             CONVERSATION SURFACE: Alice                │
│                                                        │
│  ● P2P Mesh Online            [📞 Call]  [📹 Video]    │
│  ────────────────────────────────────────────────────  │
│  [Message Stream with Delivery Ticks (✓✓)]             │
│  [📎 Architecture.png Preview]                         │
│  ────────────────────────────────────────────────────  │
│  [📎] [ Type encrypted message... ]         [Send ➤]   │
└────────────────────────────────────────────────────────┘
       │
       ▼ Click Message Bubble
┌────────────────────────────────────────────────────────┐
│                 MESSAGE ACTION SURFACE                 │
│                                                        │
│  [ ❤️  👍  🔥  😮  😂  👏 ]                            │
│                                                        │
│  📋 Copy Message Text                                  │
│  🗑️ Delete for Everyone                                │
└────────────────────────────────────────────────────────┘
```

---

## 2. Conversation Surface Details
- **Header Actions**:
  - `📞 Call`: Launches `openSpatialCallSurface(contactDid, 'audio')`.
  - `📹 Video`: Launches `openSpatialCallSurface(contactDid, 'video')`.
- **Message List**:
  - Dynamically queries `/api/chat/messages?contactDid=:did&userDid=:myDid`.
  - Distinguishes outgoing messages (blue accent with single/double delivery ticks) from incoming messages (dark frosted glass).
  - Renders inline image previews or downloadable document cards.
- **Composer Controls**:
  - File picker button `📎` opens local file chooser and displays attachment badge with dismissible tag.
  - Send button `Send ➤` or pressing `Enter` dispatches payload to `/api/chat/send` and immediately refreshes the stream.
