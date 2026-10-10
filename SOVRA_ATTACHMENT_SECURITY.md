# SOVRA Attachment Security & File Serving Pipeline

## 1. Overview & Fix for Blank-Browser-Tab Issue
Previously, chat attachments attempted to open raw, untrusted `dataUrl` strings via `window.open(dataUrl, '_blank')`, triggering browser popup blocks or displaying completely blank browser tabs due to URL length limits and security policies.

SOVRA Phase 4 completely resolves this at both the protocol and transport levels:
1. **Server-Side File Persistence**:
   - Binary attachments uploaded via `/api/chat/send` are decoded, assigned a content-addressed identifier (`CID`), and stored securely on disk under the node's media repository.
2. **Dedicated Serving Endpoint**:
   - Attachments are served via `/api/chat/attachment/:cid`.
   - The server inspects the binary header to detect authentic MIME types (`image/png`, `application/pdf`, `video/mp4`, `application/zip`, etc.).
   - Sets exact `Content-Type` headers and appropriate `Content-Disposition` directives:
     - `inline; filename="preview.png"` for safe rendering.
     - `attachment; filename="data.zip"` for arbitrary downloadables.
   - Supports **HTTP 206 Partial Content** and `Range` headers for seekable video/audio streams.

---

## 2. BOLA & IDOR Authorization Boundaries
To prevent Broken Object Level Authorization (BOLA) and Insecure Direct Object References (IDOR):
- An attachment cannot be fetched simply by guessing or brute-forcing a CID.
- When User A sends an attachment to User B:
  - User C cannot access the file even if they obtain the CID.
  - The serving handler enforces that the requesting identity (`req.headers['authorization']` or `X-Sovra-DID`) matches either:
    1. The message sender DID.
    2. The message recipient DID.
    3. An authorized member of the target group/channel.
- Unauthorized requests receive an immediate `403 Forbidden` response.

---

## 3. Lightbox & Safe In-App Preview
Within the spatial conversation interface:
- **Images**: Rendered as authenticated in-surface thumbnails (`<img src="/api/chat/attachment/:cid">`). Clicking opens the in-app Lightbox modal (`#chatAttachmentLightboxModal`) rather than opening a detached blank browser tab.
- **Documents & Binaries**: Rendered with icon badges, filename, and file size in KB/MB with direct authenticated download triggers.
