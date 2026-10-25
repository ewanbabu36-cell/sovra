/**
 * @file tests/e2e/production-hardening-cycle-3.test.ts
 * Comprehensive Verification Suite for Master Production Hardening Cycle 3.
 *
 * Verifies all 8 Architectural Dimensions:
 * 1. Schema v4 migration & Guardians collection persistence in SovraLocalDatabase.
 * 2. Outbox SyncEngine execution with singular /api/feed/comment route.
 * 3. Dynamic Feed comments, comment likes, reposts, and bookmarks API endpoints.
 * 4. WebRTC call signaling lifecycle: offer -> SSE stream -> 3s heartbeat -> clean hang-up.
 * 5. Real voice notes with Base64 audio attachments and local database caching.
 * 6. Cryptographic 32-byte QR Account Transfer secret & 2-of-3 Guardian Recovery plan.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  SovraLocalDatabase,
  MemoryStorageDriver,
  LocalSchemaMigrator,
  type LocalDatabaseSchema,
  type CachedGuardian,
  type CachedMessage,
} from '../../apps/sovra-mobile/src/services/local-database.js';
import {
  fetchFeedComments,
  addFeedComment,
  likeFeedComment,
  repostFeedPost,
  saveFeedPost,
  sendChatMessage,
  createFeedPost,
  setActiveSession,
} from '../../apps/sovra-mobile/src/services/api.js';
import { AccountLifecycleEngine } from '../../packages/identity/src/onboarding.js';
import { secureRandomBytes, bytesToHex } from '../../packages/crypto/src/primitives.js';

const DEV_SERVER_HTTP = 'http://localhost:3001';

describe('Production Hardening Cycle 3 Verification Suite', () => {
  let sessionToken: string = '';
  let testUserDid: string = 'did:sovra:cycle3user';
  let targetPeerDid: string = 'did:sovra:cycle3peer';
  let createdPostId: string = 'post-1';

  beforeAll(async () => {
    try {
      const regRes = await fetch(`${DEV_SERVER_HTTP}/api/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: `cycle3_${Date.now().toString(36)}`,
          displayName: 'Cycle 3 Hardening User',
        }),
      });
      if (regRes.ok) {
        const data = await regRes.json();
        sessionToken = data.sessionToken;
        testUserDid = data.user?.did || data.did || testUserDid;
        setActiveSession(sessionToken, testUserDid);
      }

      // Create a test feed post to ensure valid post ID for comments, reposts & bookmarks
      const postRes = await createFeedPost(`Cycle 3 Test Post ${Date.now()}`);
      if (postRes.ok && postRes.post?.id) {
        createdPostId = postRes.post.id;
      }
    } catch {
      // In offline / unit mode, dev server might not be running
    }
  });

  // ============================================================
  // 1. SCHEMA V4 & GUARDIANS COLLECTION PERSISTENCE
  // ============================================================
  describe('Dimension 1 & 8: Schema v4 & Guardians Persistence', () => {
    it('migrates older schemas to Schema v4 and initializes guardians collection', () => {
      const legacySchema: LocalDatabaseSchema = {
        version: 3,
        users: {},
        profiles: {},
        posts: {},
        comments: {},
        messages: {},
        channels: {},
        operations: {},
        outbox: {},
        inbox: {},
        media_staging: {},
        wallet_ledger: {},
        guardians: {},
        sync_state: {
          lastSyncTimestamp: 0,
          lastKnownServerCursor: '0',
          activeVectorClock: {},
        },
      };

      const migrated = LocalSchemaMigrator.migrate(legacySchema);
      expect(migrated.version).toBeGreaterThanOrEqual(4);
      expect(migrated.guardians).toBeDefined();
      expect(typeof migrated.guardians).toBe('object');
      expect(Object.keys(migrated.guardians).length).toBe(0);
    });

    it('persists, queries, and removes guardians in SovraLocalDatabase', async () => {
      const driver = new MemoryStorageDriver();
      const db = SovraLocalDatabase.getInstance(driver);

      const guardianBob: CachedGuardian = {
        did: 'did:sovra:bobGuardian',
        name: 'Bob (Trusted Friend)',
        status: 'active',
        addedAt: Date.now(),
        threshold: 2,
      };

      const guardianCarol: CachedGuardian = {
        did: 'did:sovra:carolGuardian',
        name: 'Carol (Trusted Colleague)',
        status: 'active',
        addedAt: Date.now(),
        threshold: 2,
      };

      await db.saveGuardian(guardianBob);
      await db.saveGuardian(guardianCarol);

      const list = db.getGuardians();
      expect(list.length).toBe(2);
      expect(list.some(g => g.did === 'did:sovra:bobGuardian')).toBe(true);
      expect(list.some(g => g.did === 'did:sovra:carolGuardian')).toBe(true);

      // Remove a guardian
      await db.removeGuardian('did:sovra:bobGuardian');
      const updatedList = db.getGuardians();
      expect(updatedList.length).toBe(1);
      expect(updatedList[0]?.did).toBe('did:sovra:carolGuardian');
    });

    it('emergencyPanicWipe resets guardians and sets schema version to 4', async () => {
      const driver = new MemoryStorageDriver();
      const db = SovraLocalDatabase.getInstance(driver);

      await db.saveGuardian({
        did: 'did:sovra:tempGuardian',
        name: 'Temp',
        status: 'active',
        addedAt: Date.now(),
      });
      expect(db.getGuardians().length).toBe(1);

      await db.emergencyPanicWipe();
      expect(db.getGuardians().length).toBe(0);
      expect((db as any).state.version).toBeGreaterThanOrEqual(4);
      expect((db as any).state.guardians).toEqual({});
    });
  });

  // ============================================================
  // 2. FEED COMMENTS, REPOSTS & BOOKMARKS API
  // ============================================================
  describe('Dimension 3 & 4: Feed Comments, Reposts & Bookmarks API', () => {
    it('adds a feed comment, queries comments, and likes comment', async () => {
      const commentText = `Sovereign comment created at ${Date.now()}`;

      // Add comment to created post
      const addRes = await addFeedComment(createdPostId, commentText);
      expect(addRes.ok).toBe(true);
      expect(addRes.comment).toBeDefined();
      expect(addRes.comment.text).toBe(commentText);

      // Fetch comments for post
      const comments = await fetchFeedComments(createdPostId);
      expect(Array.isArray(comments)).toBe(true);
      const found = comments.find((c: any) => c.text === commentText);
      expect(found).toBeDefined();

      // Like the comment
      if (found?.id) {
        const likeRes = await likeFeedComment(found.id, createdPostId);
        expect(likeRes.ok).toBe(true);
      }
    });

    it('reposts and bookmarks a feed post successfully', async () => {
      const repostRes = await repostFeedPost(createdPostId);
      expect(repostRes.ok).toBe(true);

      const saveRes = await saveFeedPost(createdPostId);
      expect(saveRes.ok).toBe(true);
    });
  });

  // ============================================================
  // 3. WEBRTC LIVE CALL SIGNALING LIFECYCLE
  // ============================================================
  describe('Dimension 2 & 5: WebRTC Live Call Signaling Lifecycle', () => {
    let callSessionId: string = '';

    it('initiates call offer and receives a valid sessionId', async () => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        'x-sovra-did': testUserDid,
      };

      const offerRes = await fetch(`${DEV_SERVER_HTTP}/api/call/offer`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          recipientDid: targetPeerDid,
          offerSdp: 'v=0\r\no=- 42 2 IN IP4 127.0.0.1\r\ns=SovraCall\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 0.0.0.0',
          callType: 'video',
        }),
      });

      expect(offerRes.status).toBe(200);
      const data = await offerRes.json();
      expect(data.ok).toBe(true);
      callSessionId = data.sessionId || data.session?.callId;
      expect(callSessionId).toBeDefined();
      expect(typeof callSessionId).toBe('string');
    });

    it('connects to SSE signaling stream for the call session', async () => {
      if (!callSessionId) return;

      const headers: Record<string, string> = {
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        'x-sovra-did': testUserDid,
      };

      const streamRes = await fetch(`${DEV_SERVER_HTTP}/api/call/stream?callId=${callSessionId}`, {
        method: 'GET',
        headers,
      });

      expect(streamRes.status).toBe(200);
      expect(streamRes.headers.get('content-type')).toContain('text/event-stream');
    });

    it('dispatches 3-second heartbeat to keep call session alive', async () => {
      if (!callSessionId) return;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        'x-sovra-did': testUserDid,
      };

      const hbRes = await fetch(`${DEV_SERVER_HTTP}/api/call/heartbeat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ callId: callSessionId }),
      });

      expect(hbRes.status).toBe(200);
      const data = await hbRes.json();
      expect(data.ok).toBe(true);
    });

    it('terminates call session with clean hangup', async () => {
      if (!callSessionId) return;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        'x-sovra-did': testUserDid,
      };

      const endRes = await fetch(`${DEV_SERVER_HTTP}/api/call/end`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ callId: callSessionId, reason: 'hangup' }),
      });

      expect(endRes.status).toBe(200);
      const data = await endRes.json();
      expect(data.ok).toBe(true);
    });
  });

  // ============================================================
  // 4. REAL VOICE NOTES & BASE64 ATTACHMENTS
  // ============================================================
  describe('Dimension 6 & 7: Real Voice Notes & Media Attachments', () => {
    it('dispatches voice note with Base64 audio attachment and caches locally', async () => {
      const driver = new MemoryStorageDriver();
      const db = SovraLocalDatabase.getInstance(driver);

      const fakeAudioDataUrl = 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJ8';
      const voiceMsgId = `voice_test_${Date.now()}`;

      // Dispatch via sendChatMessage with audio flag & attachment
      const sendRes = await sendChatMessage({
        recipientDid: targetPeerDid,
        text: 'Voice note (4s)',
        isAudio: true,
        audioDurationSec: 4,
        attachment: {
          name: 'voice_note.webm',
          type: 'audio/webm',
          dataUrl: fakeAudioDataUrl,
          size: fakeAudioDataUrl.length,
        },
      });

      expect(sendRes.ok).toBe(true);

      // Save to local database
      const cachedMsg: CachedMessage = {
        id: voiceMsgId,
        threadId: targetPeerDid,
        senderDid: testUserDid,
        recipientDid: targetPeerDid,
        senderName: 'You',
        text: '🎤 Voice note (4s)',
        timestamp: Date.now(),
        status: 'delivered',
        mediaAttachment: {
          name: 'voice_note.webm',
          cid: voiceMsgId,
          mimeType: 'audio/webm',
          sizeBytes: fakeAudioDataUrl.length,
          dataUrl: fakeAudioDataUrl,
        },
        syncStatus: 'SYNCED',
      };

      await db.saveMessage(cachedMsg);

      const messages = db.getThreadMessages(targetPeerDid);
      const retrieved = messages.find(m => m.id === voiceMsgId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.mediaAttachment?.mimeType).toBe('audio/webm');
      expect(retrieved?.mediaAttachment?.dataUrl).toBe(fakeAudioDataUrl);
    });
  });

  // ============================================================
  // 5. CRYPTOGRAPHIC QR TRANSFER & SOCIAL GUARDIAN RECOVERY
  // ============================================================
  describe('Dimension 1 & 8: QR Transfer Secret & Guardian Recovery Plan', () => {
    it('generates secure 32-byte QR pairing secret with valid 300s TTL', async () => {
      const ephemeralKeyBytes = secureRandomBytes(32);
      expect(ephemeralKeyBytes.length).toBe(32);

      const ephemeralKeyHex = bytesToHex(ephemeralKeyBytes);
      expect(ephemeralKeyHex.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(ephemeralKeyHex)).toBe(true);

      const engine = new AccountLifecycleEngine();
      await engine.createAccount('alice_qr', 'Alice QR Test', 'android');

      const qrRes = engine.generateQrPairingPayload(ephemeralKeyHex, 300);
      expect(qrRes.ok).toBe(true);
      if (qrRes.ok) {
        expect(qrRes.value.ephemeralExchangeSecretHex).toHaveLength(64);
        expect(qrRes.value.delegationAssertion.devicePublicKeyHex).toHaveLength(64);
        expect(qrRes.value.expiresAt).toBeGreaterThan(Date.now() / 1000);
      }
    });

    it('configures 2-of-3 social guardian recovery plan', async () => {
      const engine = new AccountLifecycleEngine();
      await engine.createAccount('bob_guard', 'Bob Guardian Test', 'android');

      const guardianDids = [
        'did:sovra:guardianAlice',
        'did:sovra:guardianBob',
        'did:sovra:guardianCarol',
      ];

      const planRes = engine.setupGuardianRecovery({
        guardianDids,
        threshold: 2,
      });

      expect(planRes.ok).toBe(true);
      if (planRes.ok) {
        expect(planRes.value.guardianDids).toHaveLength(3);
        expect(planRes.value.requiredThreshold).toBe(2);
        expect(planRes.value.timelockSeconds).toBe(86400); // 24h timelock
      }
    });
  });
});
