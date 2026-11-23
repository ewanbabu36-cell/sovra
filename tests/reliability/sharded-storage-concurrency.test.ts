import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { UserShardedStorageEngine, WriteRingBuffer } from '../../packages/storage/src/sharded-storage.js';

describe('User-Partitioned Sharded Storage & High-Concurrency Reliability', () => {
  let storage: UserShardedStorageEngine;

  beforeEach(() => {
    storage = new UserShardedStorageEngine({
      totalShards: 16,
      flushIntervalMs: 50,
      ringCapacity: 10000,
    });
  });

  afterEach(() => {
    storage.dispose();
  });

  it('determines deterministic shard partitions per user DID via SHA-256', () => {
    const userA = 'did:sov:user_alpha_999';
    const userB = 'did:sov:user_beta_888';

    const shardA = storage.getShardIndex(userA);
    const shardB = storage.getShardIndex(userB);

    expect(shardA).toBeGreaterThanOrEqual(0);
    expect(shardA).toBeLessThan(16);
    expect(shardB).toBeGreaterThanOrEqual(0);
    expect(shardB).toBeLessThan(16);

    // Consistency check
    expect(storage.getShardIndex(userA)).toBe(shardA);
    expect(storage.getShardIndex(userB)).toBe(shardB);
  });

  it('sustains 100 concurrent writers across user partitions with 0 lock contentions or SQLITE_BUSY errors', async () => {
    const CONCURRENT_USERS = 100;
    const recordsPerUser = 5;

    const writers = Array.from({ length: CONCURRENT_USERS }, async (_, uIdx) => {
      const userDid = `did:sov:stress_actor_${uIdx}_${crypto.randomBytes(4).toString('hex')}`;
      
      const userWrites = Array.from({ length: recordsPerUser }, async (_, rIdx) => {
        return storage.writeUserRecord(userDid, 'posts', {
          id: `post_${uIdx}_${rIdx}`,
          title: `Post ${rIdx} from user ${uIdx}`,
          content: 'High concurrency sharded write verification',
          likes: rIdx * 10,
        });
      });

      return Promise.all(userWrites);
    });

    const results = await Promise.all(writers);
    expect(results.length).toBe(CONCURRENT_USERS);

    const stats = storage.stats();
    expect(stats.totalRecords).toBe(CONCURRENT_USERS * recordsPerUser);
    expect(stats.shards.length).toBe(16);

    // Verify all 16 shards received a healthy distribution of writes
    const activeShards = stats.shards.filter(s => s.recordsCount > 0);
    expect(activeShards.length).toBeGreaterThan(10);
  });

  it('ensures actor-model isolation: User A writes never block or contaminate User B', async () => {
    const userAlice = 'did:sov:alice_isolated_001';
    const userBob = 'did:sov:bob_isolated_002';

    await storage.writeUserRecord(userAlice, 'notes', { id: 'note_1', secret: 'alice_secret_alpha' });
    await storage.writeUserRecord(userBob, 'notes', { id: 'note_1', secret: 'bob_secret_beta' });

    const aliceRecord = storage.readUserRecord(userAlice, 'notes', 'note_1');
    const bobRecord = storage.readUserRecord(userBob, 'notes', 'note_1');

    expect(aliceRecord).toBeDefined();
    expect(aliceRecord?.data.secret).toBe('alice_secret_alpha');

    expect(bobRecord).toBeDefined();
    expect(bobRecord?.data.secret).toBe('bob_secret_beta');

    // Bob cannot read Alice's data through his user partition
    const aliceNotesForBob = storage.queryUserRecords(userBob, 'notes', { secret: 'alice_secret_alpha' });
    expect(aliceNotesForBob.length).toBe(0);
  });

  it('in-memory write-ring buffer coalesces rapid mutations and flushes micro-batches', async () => {
    const flushedBatches: any[][] = [];
    const ring = new WriteRingBuffer(5000, 40); // 40ms flush
    
    ring.registerFlushCallback(async (batch) => {
      flushedBatches.push(batch);
    });

    const TOTAL_OPERATIONS = 500;
    for (let i = 0; i < TOTAL_OPERATIONS; i++) {
      ring.enqueue({
        id: `op_${i}`,
        userDid: `did:sov:user_${i % 10}`,
        type: 'increment',
        collection: 'views',
        payload: { targetId: `post_${i % 5}`, amount: 1 },
        timestamp: Date.now(),
      });
    }

    // Explicit manual flush + wait for timer
    await ring.flush();
    await new Promise(r => setTimeout(r, 80));
    ring.dispose();

    const totalFlushedItems = flushedBatches.reduce((acc, b) => acc + b.length, 0);
    expect(totalFlushedItems).toBe(TOTAL_OPERATIONS);
  });
});
