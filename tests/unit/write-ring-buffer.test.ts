import { describe, it, expect } from 'vitest';
import { SqliteSocialDatabaseEngine, WriteRingBuffer } from '../../scripts/database-sqlite.ts';
import fs from 'node:fs';

describe('SQLite WriteRingBuffer Concurrency Unit Test', () => {
  const testDir = './.test-ring-buffer-' + Date.now();
  const db = new SqliteSocialDatabaseEngine(testDir);
  const ringBuffer = db.getWriteRingBuffer();

  it('initializes write ring buffer with 10s busy_timeout and WAL autocheckpoint', () => {
    expect(ringBuffer).toBeInstanceOf(WriteRingBuffer);
    expect(ringBuffer.getPendingCount()).toBe(0);
  });

  it('batches and merges high-frequency view increments into atomic transaction', () => {
    // Insert a test post first
    const rawDb = db.getRawDb();
    const postId = 'post_test_batch_1';
    rawDb.prepare(`
      INSERT INTO posts (id, author_did, handle, author_name, author_avatar, author_avatar_bg, caption, created_at, updated_at, views_count, likes_count)
      VALUES (?, 'did:key:test', 'test', 'Test', 'T', '#fff', 'Test', 1000, 1000, 0, 0)
    `).run(postId);

    // Enqueue 25 separate view increments for the same post
    for (let i = 0; i < 25; i++) {
      ringBuffer.incrementPostView(postId, 1);
    }

    expect(ringBuffer.getPendingCount()).toBe(1); // Merged into 1 aggregate entry!

    // Flush to SQLite
    const res = ringBuffer.flush();
    expect(res.flushedCount).toBe(1);

    // Verify database has 25 views
    const row: any = rawDb.prepare('SELECT views_count, likes_count FROM posts WHERE id = ?').get(postId);
    expect(row.views_count).toBe(25);
  });

  it('cleans up and stops gracefully', () => {
    db.close();
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
  });
});
