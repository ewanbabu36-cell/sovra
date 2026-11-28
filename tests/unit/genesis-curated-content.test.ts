import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SovraDatabaseEngine } from '../../scripts/database-engine.ts';

describe('Sovra Curated Genesis Seed Content (Empty Room Elimination)', () => {
  it('provides at least 10 verified genesis channels including #Tech, #AI, #Music, #Art, #Crypto, and #Philosophy', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-genesis-test-'));
    const db = new SovraDatabaseEngine(tmpDir);
    try {
      const channels = db.getAllChannels();
      const verifiedChannels = channels.filter(c => c.verified === true);

      expect(verifiedChannels.length).toBeGreaterThanOrEqual(10);

      const categories = new Set(verifiedChannels.map(c => c.category.toLowerCase()));
      for (const requiredCat of ['tech', 'ai', 'music', 'art', 'crypto', 'philosophy']) {
        expect(categories.has(requiredCat)).toBe(true);
      }
    } finally {
      db.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  it('provides 20 to 30+ high-quality curated genesis posts covering core channels and formats', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-genesis-posts-'));
    const db = new SovraDatabaseEngine(tmpDir);
    try {
      const seeds = db.getSeedPosts();
      expect(seeds.length).toBeGreaterThanOrEqual(20);

      const combinedTags = seeds.map(s => String(s.tags || '').toLowerCase()).join(' ');
      for (const topicTag of ['#tech', '#ai', '#music', '#art', '#crypto', '#philosophy']) {
        expect(combinedTags).toContain(topicTag);
      }

      // Must contain polls, announcements, articles, and threaded replies without false FIPS 204 certification wording
      expect(seeds.some(s => s.postType === 'poll')).toBe(true);
      expect(seeds.some(s => Boolean(s.threadRootId))).toBe(true);
      expect(seeds.some(s => Boolean(s.mediaGradient && s.mediaTitle))).toBe(true);
      expect(seeds.every(s => !s.caption.includes('FIPS 204 ML-DSA'))).toBe(true);
    } finally {
      db.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  it('eliminates Empty Room on brand-new unauthenticated AND authenticated launch and seeds idempotently', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-genesis-cold-'));
    const db = new SovraDatabaseEngine(tmpDir);
    try {
      // Unauthenticated visitor before login must see populated curated feed
      const anonFeed = db.getFeedPosts();
      expect(anonFeed.length).toBeGreaterThanOrEqual(20);

      // Authenticated brand-new user with 0 friends must also see populated feed
      const freshFeed = db.getFeedPosts('did:sovra:brand_new_launch_user_' + Date.now());
      expect(freshFeed.length).toBeGreaterThanOrEqual(20);

      // Explicit idempotent genesis seeding populates persistent storage without duplication
      const firstRun = db.seedGenesisCuratedContent();
      expect(firstRun.verifiedChannels).toBeGreaterThanOrEqual(10);
      expect(firstRun.totalPosts).toBeGreaterThanOrEqual(20);

      const secondRun = db.seedGenesisCuratedContent();
      expect(secondRun.channelsAdded).toBe(0);
      expect(secondRun.postsAdded).toBe(0);
    } finally {
      db.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});
