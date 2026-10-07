# Sovra — Database & Persistence Engine Specification

## 1. Engine Architecture
* **Implementation:** `SovraDatabaseEngine` in [`scripts/database-engine.ts`](file:///d:/Sovra/scripts/database-engine.ts).
* **Storage Location:** `.sovra-storage-dev/dynamic-social-state.json` (overridable via `SOVRA_STORAGE_DIR`).
* **Format:** Formatted JSON schema with schema version metadata (`schemaVersion: 1`).

---

## 2. Crash Resilience & Atomic Writes
* **Unique Temp File Write:** State is serialized to a unique temp file (`dynamic-social-state.json.tmp.<pid>.<timestamp>.<hex>`) to prevent multi-process or concurrent test write collisions.
* **Rolling Backup:** Prior to overwrite, any valid primary database file is preserved as `dynamic-social-state.json.bak`.
* **Atomic Rename & Windows Fallback:** Attempts `fs.renameSync()`. If a Windows OS file-lock collision occurs, falls back to `copyFileSync()` followed by `unlinkSync()`.
* **Corrupted State Recovery:** If the primary JSON file cannot be parsed due to abrupt power failure, `load()` detects the corruption and automatically restores state from `dynamic-social-state.json.bak`.

---

## 3. Persistent Collections (15)
1. `users`: Profile records, DIDs, handles, display names, avatar data URLs, cover photos, website URLs, device types, sovereign wallet balances.
2. `follows`: Asymmetric follow graph relationships (`id: followerDid:targetDid`).
3. `user_sessions`: Hardware devices and sessions (`sessionId`, `token`, `deviceName`, `isRevoked`, `lastActiveAt`).
4. `posts`: Feed post documents (`text`, `photo`, `video`, `reel`, `article`, `poll`, `qa`, `quiz`, `mood`, `event`, `idea`, `rating`).
5. `comments`: Post comments and threaded replies.
6. `direct_messages`: End-to-end user chat messages.
7. `channels`: Decentralized community channels.
8. `channel_messages`: Public and subscriber channel posts.
9. `friend_relationships`: Bilateral friendship requests and mutual handshakes.
10. `reels`: Vertical video records with CIDs.
11. `reel_comments`: Comments on vertical video reels.
12. `video_comments`: Video discussion comments.
13. `tip_vouchers`: Micro-tipping audit ledger.
14. `audit_logs`: Operations and moderation security audit trail.
15. `stories`: 24-hour ephemeral stories.
16. `notifications`: In-app notification queue.
17. `call_sessions`: WebRTC voice and video signaling state.
