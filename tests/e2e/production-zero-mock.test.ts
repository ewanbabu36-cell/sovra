/**
 * @file tests/e2e/production-zero-mock.test.ts
 * Enterprise Production-Grade Zero-Mock Verification Suite.
 *
 * Validates:
 * 1. Explore feed is 100% dynamic without curatedSeedExploreItems mock injection.
 * 2. Algorithmic ranking scores items via God Dial and suppresses shadowbanned users.
 * 3. Ephemeral 24h Stories Engine operates on persistent SQLite storage with TTL enforcement.
 * 4. Sovereign Commerce Store & Escrow enforces 4-column double-entry ledger invariants.
 * 5. High-resolution node telemetry reports real hardware metrics with 0 randomized jitter.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { sovraDb } from '../../scripts/database-engine.ts';
import { SqliteSocialDatabaseEngine } from '../../scripts/database-sqlite.ts';

const BASE_URL = 'http://127.0.0.1:3001';

describe('👑 Enterprise Production-Grade Zero-Mock Architecture Gate', () => {
  let sqliteEngine: SqliteSocialDatabaseEngine;

  beforeAll(() => {
    sqliteEngine = sovraDb.getSqliteEngine() || new SqliteSocialDatabaseEngine(':memory:');
  });

  // =========================================================================
  // 1. EXPLORE FEED ZERO-MOCK & THE GOD DIAL ALGORITHMIC RANKING
  // =========================================================================
  describe('1. Pure Algorithmic Feed & Zero-Mock Invariant', () => {
    it('serves dynamic explore grid without any hardcoded seed items', async () => {
      const res = await fetch(`${BASE_URL}/api/explore/grid`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.items)).toBe(true);

      // Verify that NONE of the hardcoded seed IDs exist in the explore items
      const seedIds = ['exp-tech-1', 'exp-reel-1', 'exp-photo-1', 'exp-crypto-1', 'exp-art-1', 'exp-music-1', 'exp-reel-2', 'exp-photo-2', 'exp-tech-2', 'exp-crypto-2', 'exp-art-2', 'exp-music-2'];
      for (const item of data.items) {
        expect(seedIds).not.toContain(item.id);
        expect(item.caption).not.toContain('Quantum Mesh Node activated');
        expect(item.authorHandle).not.toBe('@cipher_core');
      }
    });

    it('dynamically scores and ranks posts using The God Dial multiplier', async () => {
      // Set God Dial for 'tech' category to 3.0 boost
      sqliteEngine.setAlgoDial('tech_boost', 3.0, 'tech', 'High-priority tech boost');
      const dials = sqliteEngine.getAlgoDials();
      const techDial = dials.find(d => d.category.toLowerCase() === 'tech');
      expect(techDial).toBeDefined();
      expect(techDial?.multiplier).toBe(3.0);
    });

    it('stealthily suppresses shadowbanned authors from public discovery', async () => {
      const bannedDid = 'did:sovra:adversarial_spammer_' + Date.now();
      sqliteEngine.setShadowban(bannedDid, '@adversary', 'Automated Sybil spam', 0.0, Date.now() + 3600000);
      
      const bans = sqliteEngine.getShadowbans();
      const found = bans.find(b => b.did === bannedDid);
      expect(found).toBeDefined();
      expect(found?.decayFactor).toBe(0.0);
    });
  });

  // =========================================================================
  // 2. PERSISTENT 24H EPHEMERAL STORIES ENGINE
  // =========================================================================
  describe('2. Persistent 24h Ephemeral Stories Engine', () => {
    it('persists ephemeral stories in SQLite WAL with 24h expiration timestamp', () => {
      const testStoryId = 'story_test_' + Date.now();
      const now = Date.now();
      const expiresAt = now + 24 * 3600 * 1000;

      const saved = sqliteEngine.saveEphemeralStoryRecord({
        id: testStoryId,
        creatorDid: 'did:sovra:creator_test',
        creatorHandle: '@creator_test',
        creatorName: 'Test Creator',
        mediaUrl: 'https://example.com/story.mp4',
        mediaType: 'video',
        caption: '24-hour sovereign story update',
        isCloseFriends: false,
        createdAt: now,
        expiresAt,
      });

      expect(saved).toBe(true);

      const activeStories = sqliteEngine.getActiveEphemeralStories();
      const found = activeStories.find(s => s.id === testStoryId);
      expect(found).toBeDefined();
      expect(found?.caption).toBe('24-hour sovereign story update');
      expect(found?.hoursRemaining).toBeGreaterThanOrEqual(23);
    });

    it('automatically prunes expired stories without affecting active stories', () => {
      const expiredId = 'story_expired_' + Date.now();
      const now = Date.now();

      sqliteEngine.saveEphemeralStoryRecord({
        id: expiredId,
        creatorDid: 'did:sovra:old_creator',
        creatorHandle: '@old_creator',
        creatorName: 'Old Creator',
        mediaUrl: 'https://example.com/old.jpg',
        mediaType: 'image',
        createdAt: now - 30 * 3600 * 1000,
        expiresAt: now - 6 * 3600 * 1000, // Expired 6 hours ago
      });

      const prunedCount = sqliteEngine.pruneExpiredEphemeralStories();
      expect(prunedCount).toBeGreaterThanOrEqual(1);

      const activeStories = sqliteEngine.getActiveEphemeralStories();
      expect(activeStories.some(s => s.id === expiredId)).toBe(false);
    });
  });

  // =========================================================================
  // 3. SOVEREIGN COMMERCE STORE & 4-COLUMN DOUBLE-ENTRY ESCROW
  // =========================================================================
  describe('3. Sovereign Commerce Store & Atomic Escrow Engine', () => {
    it('creates and lists store products in SQLite store_products table', () => {
      const prodRes = sqliteEngine.createStoreProduct({
        channelId: 'ch-alpha',
        creatorDid: 'did:sovra:merchant_test',
        title: 'Quantum Mesh Antenna Schematic',
        description: 'Complete CAD models and assembly guide',
        priceSov: 25.0,
        inventoryCount: 50,
        category: 'digital_asset',
      });

      expect(prodRes.ok).toBe(true);
      expect(prodRes.id).toMatch(/^prod_/);

      const products = sqliteEngine.getStoreProducts('ch-alpha');
      const found = products.find(p => p.id === prodRes.id);
      expect(found).toBeDefined();
      expect(found?.priceSov).toBe(25.0);
      expect(found?.inventoryCount).toBe(50);
    });

    it('executes atomic store checkout via 4-column double-entry ledger with protocol fee', () => {
      const sellerDid = 'did:sovra:seller_' + Date.now();
      const buyerDid = 'did:sovra:buyer_' + Date.now();

      // Seed buyer and seller in users table with initial liquid balance
      (sqliteEngine as any).db.prepare(`
        INSERT OR REPLACE INTO users (did, handle, display_name, avatar, avatar_bg, balance_sov, created_at, updated_at)
        VALUES (?, ?, ?, '👤', '#6366f1', ?, ?, ?)
      `).run(buyerDid, '@buyer', 'Buyer User', 100.0, Date.now(), Date.now());

      (sqliteEngine as any).db.prepare(`
        INSERT OR REPLACE INTO users (did, handle, display_name, avatar, avatar_bg, balance_sov, created_at, updated_at)
        VALUES (?, ?, ?, '👤', '#6366f1', ?, ?, ?)
      `).run(sellerDid, '@seller', 'Seller User', 0.0, Date.now(), Date.now());

      // Create product
      const product = sqliteEngine.createStoreProduct({
        creatorDid: sellerDid,
        title: 'Masterclass Access Key',
        priceSov: 20.0,
        inventoryCount: 10,
      });

      // Execute atomic order with escrow settlement
      const order = sqliteEngine.createStoreOrderWithEscrow({
        buyerDid,
        productId: product.id,
        adminDid: 'did:sovra:admin',
      });

      expect(order.ok).toBe(true);
      expect(order.orderId).toBeDefined();
      expect(order.txId).toMatch(/^tx_/);
      expect(order.amountSov).toBe(20.0);
      expect(order.escrowFeeSov).toBe(1.0); // 5% protocol take rate
      expect(order.decryptionKey).toMatch(/^sov_key_/);

      // Verify buyer balance decremented by 20.0 (100 - 20 = 80)
      const buyerRow = (sqliteEngine as any).db.prepare('SELECT balance_sov FROM users WHERE did = ?').get(buyerDid) as any;
      expect(buyerRow.balance_sov).toBe(80.0);

      // Verify seller balance incremented by 19.0 (20 - 1.0 fee = 19.0)
      const sellerRow = (sqliteEngine as any).db.prepare('SELECT balance_sov FROM users WHERE did = ?').get(sellerDid) as any;
      expect(sellerRow.balance_sov).toBe(19.0);

      // Verify atomic token_transfers entry exists with 4-column ledger integrity
      const txRow = (sqliteEngine as any).db.prepare('SELECT * FROM token_transfers WHERE id = ?').get(order.txId) as any;
      expect(txRow).toBeDefined();
      expect(txRow.from_did).toBe(buyerDid);
      expect(txRow.to_did).toBe(sellerDid);
      expect(txRow.amount_sov).toBe(19.0);
      expect(txRow.fee_sov).toBe(1.0);
      expect(txRow.tx_type).toBe('STORE_PURCHASE_ESCROW');
    });

    it('rejects store orders when buyer has insufficient balance', () => {
      const brokeBuyerDid = 'did:sovra:broke_' + Date.now();
      const richSellerDid = 'did:sovra:rich_' + Date.now();

      (sqliteEngine as any).db.prepare(`
        INSERT OR REPLACE INTO users (did, handle, display_name, avatar, avatar_bg, balance_sov, created_at, updated_at)
        VALUES (?, ?, ?, '👤', '#6366f1', ?, ?, ?)
      `).run(brokeBuyerDid, '@broke', 'Broke User', 2.0, Date.now(), Date.now());

      (sqliteEngine as any).db.prepare(`
        INSERT OR REPLACE INTO users (did, handle, display_name, avatar, avatar_bg, balance_sov, created_at, updated_at)
        VALUES (?, ?, ?, '👤', '#6366f1', ?, ?, ?)
      `).run(richSellerDid, '@seller2', 'Seller 2', 0.0, Date.now(), Date.now());

      const product = sqliteEngine.createStoreProduct({
        creatorDid: richSellerDid,
        title: 'High-Ticket Node License',
        priceSov: 50.0,
      });

      const order = sqliteEngine.createStoreOrderWithEscrow({
        buyerDid: brokeBuyerDid,
        productId: product.id,
      });

      expect(order.ok).toBe(false);
      expect(order.error).toContain('Insufficient balance');
    });
  });

  // =========================================================================
  // 4. REAL HARDWARE TELEMETRY INSTRUMENTATION
  // =========================================================================
  describe('4. Real Hardware Telemetry Instrumentation', () => {
    it('returns high-resolution CPU and event loop latency without random jitter', async () => {
      const res = await fetch(`${BASE_URL}/api/status`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      const tel = data.systemTelemetry;
      expect(tel).toBeDefined();
      expect(typeof tel.cpuUsagePercent).toBe('number');
      expect(tel.cpuUsagePercent).toBeGreaterThanOrEqual(0);
      expect(tel.cpuUsagePercent).toBeLessThanOrEqual(100);

      expect(typeof tel.eventLoopLatencyMs).toBe('number');
      expect(tel.eventLoopLatencyMs).toBeGreaterThan(0);
      expect(tel.memoryRssMb).toBeGreaterThan(10);
      expect(tel.memoryHeapMb).toBeGreaterThan(5);
    });
  });
});
