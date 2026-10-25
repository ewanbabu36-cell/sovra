/**
 * @file tests/e2e/production-hardening-cycle-6.test.ts
 * Comprehensive End-to-End Verification Suite for Cycle 6 Production Hardening.
 *
 * Verifies across all 8 architectural dimensions:
 * 1. Schema v7 migration, live_streams & custom_channels collections, emergency panic wipe.
 * 2. Live stream broadcaster session lifecycle (start, discover, comment, and clean termination).
 * 3. Direct P2P cryptographic token transfers and wallet ledger persistence.
 * 4. Custom mesh community channels creation and dynamic channel discovery.
 * 5. PWA install prompt & haptic vibration contracts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  LocalSchemaMigrator,
  SovraLocalDatabase,
  type CachedLiveStream,
  type CachedChannel,
} from '../../apps/sovra-mobile/src/services/local-database.js';
import {
  startLiveStream,
  fetchLiveStreams,
  endLiveStream,
  sendLiveComment,
  sendP2PTokenTransfer,
  createMeshChannel,
  fetchMeshChannels,
} from '../../apps/sovra-mobile/src/services/api.js';
import { triggerHapticFeedback } from '../../apps/sovra-mobile/src/navigation/BottomTabNavigator.js';

describe('Production Hardening Cycle 6 Verification Suite', () => {
  let db: SovraLocalDatabase;

  beforeEach(() => {
    db = SovraLocalDatabase.getInstance();
  });

  afterEach(async () => {
    await db.emergencyPanicWipe();
  });

  // ============================================================
  // 1. SCHEMA V7, LIVE STREAMS & CUSTOM CHANNELS PERSISTENCE
  // ============================================================
  describe('Dimension 1, 2 & 8: Schema v7, Live Streams & Custom Channels', () => {
    it('migrates Schema v6 to Schema v7 and initializes live_streams and custom_channels tables', () => {
      const legacyV6Schema = {
        version: 6,
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
        bookmarks: {},
        follows: {},
        stories: {},
        reactions: {},
        sync_state: {
          lastSyncTimestamp: 0,
          lastKnownServerCursor: '0',
          activeVectorClock: {},
        },
      };

      const migrated = LocalSchemaMigrator.migrate(legacyV6Schema);
      expect(migrated.version).toBeGreaterThanOrEqual(7);
      expect(migrated.live_streams).toBeDefined();
      expect(typeof migrated.live_streams).toBe('object');
      expect(migrated.custom_channels).toBeDefined();
      expect(typeof migrated.custom_channels).toBe('object');
    });

    it('persists and retrieves live stream broadcast sessions in local durable database', async () => {
      const sampleStream: CachedLiveStream = {
        id: 'stream-mesh-alpha-1',
        hostDid: 'did:key:z6MksAliceP2P',
        hostName: 'Alice',
        title: 'Building Zero-Knowledge Swarms',
        category: 'Tech',
        viewersCount: 42,
        isLive: true,
        startedAt: Date.now(),
      };

      await db.saveLiveStream(sampleStream);
      const activeStreams = db.getLiveStreams();
      expect(activeStreams.length).toBeGreaterThan(0);
      const found = activeStreams.find(s => s.id === 'stream-mesh-alpha-1');
      expect(found).toBeDefined();
      expect(found?.title).toBe('Building Zero-Knowledge Swarms');
      expect(found?.isLive).toBe(true);

      // End stream
      await db.endLiveStream('stream-mesh-alpha-1');
      const updated = db.getLiveStreams().find(s => s.id === 'stream-mesh-alpha-1');
      expect(updated?.isLive).toBe(false);
      expect(updated?.endedAt).toBeDefined();
    });

    it('persists and queries custom community channels in durable storage', async () => {
      const customChannel: CachedChannel = {
        id: 'channel:solarpunk_mesh',
        name: '#solarpunk-mesh',
        description: 'Off-grid decentralized communications hub',
        topic: 'Solar powered hardware & BLE mesh antennas',
        ownerDid: 'did:key:z6MksBobMesh',
        memberCount: 8,
        subscriberCount: 8,
        isPublic: true,
        createdAt: Date.now(),
        syncStatus: 'SYNCED',
      };

      await db.saveChannel(customChannel);
      const channels = db.getChannels();
      const found = channels.find(c => c.id === 'channel:solarpunk_mesh');
      expect(found).toBeDefined();
      expect(found?.name).toBe('#solarpunk-mesh');
      expect(found?.topic).toBe('Solar powered hardware & BLE mesh antennas');
    });

    it('clears live_streams and custom_channels on emergencyPanicWipe()', async () => {
      await db.saveLiveStream({
        id: 'stream-to-wipe',
        hostDid: 'did:key:z6MksAliceP2P',
        hostName: 'Alice',
        title: 'Ephemeral Broadcast',
        viewersCount: 10,
        isLive: true,
        startedAt: Date.now(),
      });

      await db.saveChannel({
        id: 'channel:to_wipe',
        name: '#to-wipe',
        description: 'Ephemeral Channel',
        topic: 'Ephemeral',
        ownerDid: 'did:key:z6MksAliceP2P',
        memberCount: 1,
        createdAt: Date.now(),
        syncStatus: 'LOCAL',
      });

      expect(db.getLiveStreams().length).toBeGreaterThan(0);
      expect(db.getChannels().filter(c => c.id === 'channel:to_wipe').length).toBe(1);

      await db.emergencyPanicWipe();
      expect(db.state.version).toBeGreaterThanOrEqual(7);
      expect(db.getLiveStreams().length).toBe(0);
      expect(db.getChannels().filter(c => c.id === 'channel:to_wipe').length).toBe(0);
    });
  });

  // ============================================================
  // 2. LIVE STREAM BROADCASTER & DISCOVERY API
  // ============================================================
  describe('Dimension 3 & 4: Live Broadcaster & Discovery API', () => {
    it('starts a live stream session, lists active swarms, and sends a live chat comment', async () => {
      const startRes = await startLiveStream({
        title: 'Sovereign Decentralized Super-App Demo',
        category: 'Tech',
        description: 'Live walkthrough of WebRTC, Double Ratchet, and AMM DEX',
      });

      expect(startRes).toBeDefined();
      expect(startRes.ok).toBe(true);
      expect(startRes.stream).toBeDefined();
      const streamId = startRes.stream.id;

      // List streams
      const streams = await fetchLiveStreams();
      expect(Array.isArray(streams)).toBe(true);
      const activeStream = streams.find(s => s.id === streamId);
      expect(activeStream).toBeDefined();
      expect(activeStream?.title).toBe('Sovereign Decentralized Super-App Demo');

      // Send live comment
      const commentRes = await sendLiveComment(streamId, 'Amazing P2P video quality! 🚀');
      expect(commentRes).toBeDefined();
      expect(commentRes.ok).toBe(true);
      expect(commentRes.comment.text).toBe('Amazing P2P video quality! 🚀');

      // End broadcast
      const endRes = await endLiveStream(streamId);
      expect(endRes).toBeDefined();
      expect(endRes.ok).toBe(true);
    }, 15000);
  });

  // ============================================================
  // 3. DIRECT P2P TOKEN TRANSFERS API & LEDGER
  // ============================================================
  describe('Dimension 3, 4 & 7: Direct P2P Token Transfers', () => {
    it('executes a cryptographic P2P token transfer and logs transaction in durable wallet ledger', async () => {
      const transferRes = await sendP2PTokenTransfer({
        recipientDid: 'did:key:z6MksRecipientPeer77',
        amount: '15.5',
        tokenSymbol: 'SOV',
      });

      expect(transferRes).toBeDefined();
      expect(transferRes.ok).toBe(true);
      expect(transferRes.txHash).toBeDefined();
      expect(transferRes.txHash?.startsWith('0x')).toBe(true);

      // Verify transaction in local ledger
      const txs = db.getWalletTransactions();
      const recordedTx = txs.find(tx => tx.txHash === transferRes.txHash);
      expect(recordedTx).toBeDefined();
      expect(recordedTx?.amount).toBe('15.5');
      expect(recordedTx?.tokenSymbol).toBe('SOV');
      expect(recordedTx?.peerDid).toBe('did:key:z6MksRecipientPeer77');
      expect(recordedTx?.status).toBe('confirmed');
    }, 10000);
  });

  // ============================================================
  // 4. CUSTOM MESH COMMUNITY CHANNELS API
  // ============================================================
  describe('Dimension 3 & 4: Custom Mesh Community Channels API', () => {
    it('creates a custom mesh channel and retrieves it through channel discovery', async () => {
      const created = await createMeshChannel({
        name: '#privacy-alpha',
        topic: 'Discussions on zero-knowledge SNARK proofs and mixnets',
        isPublic: true,
      });

      expect(created).toBeDefined();
      expect(created.ok).toBe(true);
      expect(created.channel).toBeDefined();
      expect(created.channel.name).toBe('#privacy-alpha');

      // Fetch channels
      const channels = await fetchMeshChannels();
      expect(Array.isArray(channels)).toBe(true);
      const found = channels.find(c => c.name === '#privacy-alpha');
      expect(found).toBeDefined();
      expect(found?.topic).toContain('zero-knowledge');
    }, 10000);
  });

  // ============================================================
  // 5. PWA PROMPT & HAPTIC VIBRATION CONTRACTS
  // ============================================================
  describe('Dimension 4 & 7: PWA Prompt & Haptic Vibration Contracts', () => {
    it('executes triggerHapticFeedback safely without throwing in node or browser environments', () => {
      expect(() => {
        triggerHapticFeedback([100, 50, 100]);
      }).not.toThrow();
    });
  });
});
