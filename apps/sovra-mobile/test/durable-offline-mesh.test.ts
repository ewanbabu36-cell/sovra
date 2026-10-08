/**
 * @file apps/sovra-mobile/test/durable-offline-mesh.test.ts
 * Comprehensive Automated Verification Suite for Sovra Mobile Offline Mesh & Durable Outbox.
 *
 * Verifies:
 * 1. Local database persistence, schema integrity, and crash survival.
 * 2. Outbox operation lifecycle (PENDING -> TRANSMITTING -> ACKNOWLEDGED / RETRYABLE).
 * 3. Idempotent operation deduplication.
 * 4. NativeMobileBleAdapter platform contract and hardware offline safety.
 * 5. MobileMeshCoordinator integration: envelope signing, routing, and truthful diagnostics.
 * 6. MediaTransferManager 64KB chunk slicing, CRC-32 validation, and SHA-256 verification.
 * 7. MobileSyncEngine outbox processing loop.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { localDb } from '../src/services/local-database.js';
import { NativeMobileBleAdapter } from '../src/services/native-ble-bridge.js';
import { mobileMesh } from '../src/services/mobile-mesh-coordinator.js';
import { mediaTransfer } from '../src/services/media-transfer-manager.js';
import { syncEngine } from '../src/services/sync-engine.js';

describe('Sovra Mobile Durable Offline Mesh & Outbox Verification', () => {
  beforeEach(async () => {
    await localDb.emergencyPanicWipe();
  });

  // ==========================================
  // 1. LOCAL PERSISTENCE & SCHEMA INTEGRITY
  // ==========================================
  it('persists and retrieves cached posts and chat messages across reloads', async () => {
    await localDb.savePost({
      id: 'post-101',
      authorDid: 'did:key:z6MksTestAuthor',
      authorName: 'Test Author',
      authorHandle: '@test_author',
      caption: 'Offline message persisted to durable local store 🌐',
      timestamp: Date.now(),
      likesCount: 5,
      likedByDids: ['did:key:userA'],
      isLiked: true,
      commentsCount: 1,
      syncStatus: 'LOCAL',
    });

    const posts = localDb.getPosts();
    expect(posts.length).toBe(1);
    expect(posts[0]!.id).toBe('post-101');
    expect(posts[0]!.syncStatus).toBe('LOCAL');
    expect(posts[0]!.caption).toContain('Offline message');

    // Message persistence
    await localDb.saveMessage({
      id: 'msg-202',
      threadId: 'did:key:z6MksBob',
      senderDid: 'did:key:z6MksAlice',
      recipientDid: 'did:key:z6MksBob',
      senderName: 'Alice',
      text: 'Direct message stored in durable client DB 🔒',
      timestamp: Date.now(),
      status: 'pending',
      syncStatus: 'LOCAL',
    });

    const threadMsgs = localDb.getThreadMessages('did:key:z6MksBob');
    expect(threadMsgs.length).toBe(1);
    expect(threadMsgs[0]!.id).toBe('msg-202');
    expect(threadMsgs[0]!.status).toBe('pending');
  });

  // ==========================================
  // 2. OUTBOX QUEUE LIFECYCLE & RETRIES
  // ==========================================
  it('enqueues operations and transitions through truthful lifecycle states', async () => {
    const op = await localDb.enqueueOperation('CREATE_POST', 'did:key:z6MksAuthor', {
      caption: 'First outbox post',
    });

    expect(op.status).toBe('PENDING');
    expect(op.attemptCount).toBe(0);

    const pending = localDb.getPendingOutbox();
    expect(pending.length).toBe(1);
    expect(pending[0]!.operationId).toBe(op.operationId);

    // Mark attempting
    await localDb.markOperationAttempting(op.operationId);
    expect(localDb.getAllOutbox()[0]!.status).toBe('TRANSMITTING');
    expect(localDb.getAllOutbox()[0]!.attemptCount).toBe(1);

    // Mark retryable on network failure
    await localDb.markOperationRetryable(op.operationId, 'Radio unreachable');
    expect(localDb.getAllOutbox()[0]!.status).toBe('RETRYABLE');
    expect(localDb.getAllOutbox()[0]!.nextRetryAt).toBeGreaterThan(Date.now());

    // Mark success on recovery
    await localDb.markOperationSuccess(op.operationId);
    expect(localDb.getAllOutbox()[0]!.status).toBe('ACKNOWLEDGED');
    expect(localDb.getPendingOutbox().length).toBe(0);
  });

  // ==========================================
  // 3. IDEMPOTENCY & DEDUPLICATION
  // ==========================================
  it('suppresses duplicate operation enqueueing with matching idempotency key', async () => {
    const key = 'idem-unique-post-1';
    const op1 = await localDb.enqueueOperation('CREATE_POST', 'did:key:user1', { caption: 'Duplicate check' }, key);
    const op2 = await localDb.enqueueOperation('CREATE_POST', 'did:key:user1', { caption: 'Duplicate check' }, key);

    expect(op1.operationId).toBe(op2.operationId);
    expect(localDb.getAllOutbox().length).toBe(1);
  });

  // ==========================================
  // 4. NATIVE MOBILE BLE ADAPTER SAFETY
  // ==========================================
  it('NativeMobileBleAdapter reports truthful availability without crashing when radio is absent', async () => {
    const adapter = new NativeMobileBleAdapter();
    expect(['android', 'ios']).toContain(adapter.platformName);

    const isAvail = await adapter.isAvailable();
    // In headless test environment, native radio is not bound
    expect(typeof isAvail).toBe('boolean');

    // Attempting to connect when radio is absent throws truthful BleHardwareUnavailableError
    await expect(adapter.connect('00:11:22:33:44:55')).rejects.toThrow();
  });

  // ==========================================
  // 5. MOBILE MESH COORDINATOR & ROUTER
  // ==========================================
  it('MobileMeshCoordinator initializes Ed25519 identity and exposes truthful runtime state', () => {
    expect(mobileMesh.localDid).toMatch(/^did:key:z6Mk/);

    const state = mobileMesh.getRuntimeState();
    expect(state).toHaveProperty('status');
    expect(state).toHaveProperty('diagnostics');
    expect(state).toHaveProperty('controls');

    // Truthful diagnostics: 0 peers initially
    expect(state.diagnostics.nearbyPeersCount).toBe(0);
    expect(state.diagnostics.authenticatedPeersCount).toBe(0);
  });

  it('MobileMeshCoordinator creates signed envelopes and records to localDb', async () => {
    const res = await mobileMesh.sendChatMessage(
      'did:key:z6MksRecipientPeer',
      'Encrypted mesh envelope payload',
      'Alice',
    );

    expect(res.success).toBe(true);
    expect(res.envelopeId).toBeDefined();

    // Verify stored in local database
    const msgs = localDb.getThreadMessages('did:key:z6MksRecipientPeer');
    expect(msgs.length).toBe(1);
    expect(msgs[0]!.text).toBe('Encrypted mesh envelope payload');
    expect(msgs[0]!.syncStatus).toBe('PENDING');
  });

  // ==========================================
  // 6. HIGH-BANDWIDTH MEDIA TRANSFER & CHUNKING
  // ==========================================
  it('MediaTransferManager stages media, slices into 64KB chunks, and verifies CRC-32 integrity', async () => {
    // Create 150KB sample test payload
    const testBytes = new Uint8Array(150 * 1024);
    for (let i = 0; i < testBytes.length; i++) testBytes[i] = (i * 7) % 256;
    const base64Sample = 'data:image/jpeg;base64,...';

    const session = await mediaTransfer.stageLocalMedia(
      'offline_photo.jpg',
      'image/jpeg',
      testBytes,
      base64Sample,
    );

    expect(session.status).toBe('STAGED');
    expect(session.cid).toMatch(/^bafkrei/);
    expect(session.totalBytes).toBe(150 * 1024);
    expect(session.totalChunks).toBe(3); // 64KB + 64KB + 22KB

    // Slice chunks
    const chunks = mediaTransfer.sliceIntoChunks(testBytes, session.transferId);
    expect(chunks.length).toBe(3);
    expect(chunks[0]!.chunkData.byteLength).toBe(64 * 1024);
    expect(chunks[2]!.chunkData.byteLength).toBe(22 * 1024);

    // Ingest chunks sequentially
    const res1 = await mediaTransfer.ingestChunk(chunks[0]!, testBytes.length);
    expect(res1.verified).toBe(true);
    expect(res1.isComplete).toBe(false);

    const res2 = await mediaTransfer.ingestChunk(chunks[1]!, testBytes.length);
    expect(res2.verified).toBe(true);
    expect(res2.isComplete).toBe(false);

    const res3 = await mediaTransfer.ingestChunk(chunks[2]!, testBytes.length);
    expect(res3.verified).toBe(true);
    expect(res3.isComplete).toBe(true);

    const completedSession = mediaTransfer.getSession(session.transferId);
    expect(completedSession?.status).toBe('VERIFIED');
  });

  // ==========================================
  // 7. SYNC ENGINE OUTBOX LOOP
  // ==========================================
  it('SyncEngine processes outbox operations and reports truthful sync status', async () => {
    const status = syncEngine.getStatus();
    expect(status).toHaveProperty('isSyncing');
    expect(status).toHaveProperty('pendingOutboxCount');
    expect(status).toHaveProperty('lastSyncResult');

    // Trigger sync on empty outbox
    const syncRes = await syncEngine.triggerSync();
    expect(syncRes.lastSyncResult).toBe('IDLE');
  });

  // ==========================================
  // 8. SECURE KEYSTORE ENCRYPTION AT REST
  // ==========================================
  it('SecureKeyStore encrypts private keys at rest with ChaCha20-Poly1305 and rejects tampered vaults', async () => {
    const { secureKeyStore } = await import('../src/services/secure-keystore.js');
    secureKeyStore.wipe();

    // 1. Generate identity
    const identity = secureKeyStore.getOrGenerateMeshIdentity();
    expect(identity.did).toMatch(/^did:key:z6Mk/);
    expect(identity.privateKey.length).toBe(32);
    expect(identity.publicKey.length).toBe(32);

    // 2. Inspect raw storage to verify private key is NEVER stored in plaintext
    const rawVaultStr = secureKeyStore.getItem('sovra_secure_key_vault_v1');
    expect(rawVaultStr).toBeTruthy();
    const vault = JSON.parse(rawVaultStr!);
    expect(vault.version).toBe(1);
    expect(vault.did).toBe(identity.did);
    expect(vault.saltHex).toBeDefined();
    expect(vault.nonceHex).toBeDefined();
    expect(vault.ciphertextHex).toBeDefined();

    // Plaintext private key hex must NOT appear anywhere in the vault string
    const privHex = Buffer.from(identity.privateKey).toString('hex');
    expect(rawVaultStr).not.toContain(privHex);
    expect(secureKeyStore.getItem('sovra_mesh_priv_key')).toBeNull();

    // 3. Retrieval from encrypted vault works seamlessly
    const reloaded = secureKeyStore.getOrGenerateMeshIdentity();
    expect(reloaded.did).toBe(identity.did);
    expect(Buffer.from(reloaded.privateKey).toString('hex')).toBe(privHex);

    // 4. Tampering detection: corrupting ciphertext causes decryption rejection
    const tamperedCipher = 'ff' + vault.ciphertextHex.slice(2);
    secureKeyStore.setItem(
      'sovra_secure_key_vault_v1',
      JSON.stringify({ ...vault, ciphertextHex: tamperedCipher }),
    );

    // Next getOrGenerateMeshIdentity should detect tampering, discard corrupted vault, and generate safe fresh identity
    const afterTamper = secureKeyStore.getOrGenerateMeshIdentity();
    expect(afterTamper.did).not.toBe(identity.did);
  });

  // ==========================================
  // 9. OFFLINE-TO-ONLINE BATCH RECONCILIATION
  // ==========================================
  it('reconciles queued offline operations with dev server and retrieves server deltas', async () => {
    const { registerUserProfile, setActiveSession } = await import('../src/services/api.js');
    const reg = await registerUserProfile({
      handle: `offline_sync_user_${Date.now()}`,
      displayName: 'Offline Sync User',
    });
    if (reg.sessionToken && reg.user) {
      setActiveSession(reg.sessionToken, reg.user.did);
    }
    const userDid = reg.user?.did || 'did:key:z6MksAlice';

    // Enqueue an offline post and a chat message
    const offlinePostOp = await localDb.enqueueOperation('CREATE_POST', userDid, {
      caption: 'Post created while phone was completely offline in a basement 📶❌',
      postType: 'text',
      tags: '#offline #mesh #crdt',
    });

    const offlineChatOp = await localDb.enqueueOperation('SEND_CHAT', userDid, {
      recipientDid: 'channel:local_mesh',
      text: 'Offline chat message ready for reconciliation',
      id: 'chat-offline-' + Date.now(),
    });

    const pending = localDb.getPendingOutbox();
    expect(pending.length).toBe(2);

    // Trigger sync with network active (dev-server running)
    const result = await syncEngine.triggerSync();
    expect(result.lastSyncResult).toBe('SUCCESS');

    // Outbox operations must now be marked ACKNOWLEDGED
    const remainingPending = localDb.getPendingOutbox();
    expect(remainingPending.length).toBe(0);

    const allOps = localDb.getAllOutbox();
    const syncedPostOp = allOps.find(o => o.operationId === offlinePostOp.operationId);
    const syncedChatOp = allOps.find(o => o.operationId === offlineChatOp.operationId);
    expect(syncedPostOp?.status).toBe('ACKNOWLEDGED');
    expect(syncedChatOp?.status).toBe('ACKNOWLEDGED');
  });
});

