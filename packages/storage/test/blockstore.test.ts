import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  CID,
  MemoryBlockstore,
  DiskBlockstore,
  TieredBlockstore,
  BlockstoreCapacityError,
  IntegrityVerificationError,
} from '../src/index.js';

describe('Blockstore Engine Suite (@sovra/storage)', () => {
  describe('MemoryBlockstore', () => {
    it('stores, retrieves, and checks existence of blocks with integrity verification', async () => {
      const store = new MemoryBlockstore();
      const payload = new TextEncoder().encode('Test Block Data');
      const cid = CID.create('raw', payload);

      expect(await store.has(cid)).toBe(false);
      await store.put(cid, payload);
      expect(await store.has(cid)).toBe(true);

      const retrieved = await store.get(cid);
      expect(retrieved).toEqual(payload);

      const stats = store.getStats();
      expect(stats.totalBlocks).toBe(1);
      expect(stats.totalSizeBytes).toBe(payload.length);
      expect(stats.hitCount).toBe(1);
    });

    it('rejects put of corrupted block whose hash does not match CID digest', async () => {
      const store = new MemoryBlockstore();
      const payload = new TextEncoder().encode('Original Data');
      const cid = CID.create('raw', payload);

      const corruptedPayload = new TextEncoder().encode('Corrupted Tampered Data');
      await expect(store.put(cid, corruptedPayload)).rejects.toThrow(IntegrityVerificationError);
    });

    it('evicts oldest unpinned blocks when capacity is exceeded (LRU)', async () => {
      // 300 bytes max capacity
      const store = new MemoryBlockstore(300);

      const block1 = new Uint8Array(100).fill(1);
      const cid1 = CID.create('raw', block1);

      const block2 = new Uint8Array(100).fill(2);
      const cid2 = CID.create('raw', block2);

      const block3 = new Uint8Array(100).fill(3);
      const cid3 = CID.create('raw', block3);

      await store.put(cid1, block1);
      await store.put(cid2, block2);
      await store.put(cid3, block3);

      expect(store.getStats().totalBlocks).toBe(3);
      expect(store.getStats().totalSizeBytes).toBe(300);

      // Putting a 4th block must evict the least recently used block (block1)
      const block4 = new Uint8Array(100).fill(4);
      const cid4 = CID.create('raw', block4);
      await store.put(cid4, block4);

      expect(await store.has(cid1)).toBe(false); // Evicted!
      expect(await store.has(cid2)).toBe(true);
      expect(await store.has(cid3)).toBe(true);
      expect(await store.has(cid4)).toBe(true);
      expect(store.getStats().evictionCount).toBe(1);
    });

    it('protects pinned blocks from LRU eviction', async () => {
      const store = new MemoryBlockstore(200);

      const block1 = new Uint8Array(100).fill(1);
      const cid1 = CID.create('raw', block1);

      const block2 = new Uint8Array(100).fill(2);
      const cid2 = CID.create('raw', block2);

      await store.put(cid1, block1);
      await store.put(cid2, block2);

      // Pin block1
      await store.pin(cid1);
      expect(await store.isPinned(cid1)).toBe(true);

      // Putting block3 should evict block2 instead of block1 because block1 is pinned!
      const block3 = new Uint8Array(100).fill(3);
      const cid3 = CID.create('raw', block3);
      await store.put(cid3, block3);

      expect(await store.has(cid1)).toBe(true); // Protected by pin!
      expect(await store.has(cid2)).toBe(false); // Evicted!
      expect(await store.has(cid3)).toBe(true);
    });

    it('throws BlockstoreCapacityError when all blocks are pinned and cannot evict', async () => {
      const store = new MemoryBlockstore(200);

      const b1 = new Uint8Array(100).fill(1);
      const c1 = CID.create('raw', b1);
      const b2 = new Uint8Array(100).fill(2);
      const c2 = CID.create('raw', b2);

      await store.put(c1, b1);
      await store.put(c2, b2);
      await store.pin(c1);
      await store.pin(c2);

      const b3 = new Uint8Array(100).fill(3);
      const c3 = CID.create('raw', b3);

      await expect(store.put(c3, b3)).rejects.toThrow(BlockstoreCapacityError);
    });
  });

  describe('DiskBlockstore', () => {
    let tempDir: string;
    let diskStore: DiskBlockstore;

    beforeEach(async () => {
      tempDir = path.join(os.tmpdir(), `sovra-test-disk-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      diskStore = new DiskBlockstore(tempDir);
      await diskStore.init();
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    });

    it('persists blocks to disk and retrieves with integrity check', async () => {
      const payload = new Uint8Array(512).fill(42);
      const cid = CID.create('raw', payload);

      expect(await diskStore.has(cid)).toBe(false);
      await diskStore.put(cid, payload);
      expect(await diskStore.has(cid)).toBe(true);

      const fetched = await diskStore.get(cid);
      expect(fetched).toEqual(payload);
    });

    it('detects disk corruption and throws IntegrityVerificationError', async () => {
      const payload = new TextEncoder().encode('Uncorrupted Disk Content');
      const cid = CID.create('raw', payload);

      await diskStore.put(cid, payload);

      // Tamper with file on disk directly
      const cidStr = cid.toString();
      const p1 = cidStr.slice(0, 2);
      const p2 = cidStr.slice(2, 4);
      const filePath = path.join(tempDir, p1, p2, `${cidStr}.block`);

      const fileData = await fs.readFile(filePath);
      fileData[0] = (fileData[0]! ^ 0xff); // Flip byte
      await fs.writeFile(filePath, fileData);

      // Reading corrupted file must fail integrity verification
      await expect(diskStore.get(cid)).rejects.toThrow(IntegrityVerificationError);
    });

    it('persists and reloads pins across instances', async () => {
      const payload = new Uint8Array(64).fill(7);
      const cid = CID.create('raw', payload);

      await diskStore.put(cid, payload);
      await diskStore.pin(cid);
      expect(await diskStore.isPinned(cid)).toBe(true);

      // Spin up second store instance on same directory
      const store2 = new DiskBlockstore(tempDir);
      await store2.init();

      expect(await store2.has(cid)).toBe(true);
      expect(await store2.isPinned(cid)).toBe(true);
    });
  });

  describe('TieredBlockstore', () => {
    let tempDir: string;
    let l1: MemoryBlockstore;
    let l2: DiskBlockstore;
    let tiered: TieredBlockstore;

    beforeEach(async () => {
      tempDir = path.join(os.tmpdir(), `sovra-test-tiered-${Date.now()}`);
      l1 = new MemoryBlockstore();
      l2 = new DiskBlockstore(tempDir);
      tiered = new TieredBlockstore(l1, l2);
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    });

    it('resolves L1 cache hit, and on L1 miss promotes from L2 disk into L1', async () => {
      const payload = new TextEncoder().encode('Tiered Storage Block');
      const cid = CID.create('raw', payload);

      // Write directly to L2 disk only
      await l2.put(cid, payload);
      expect(await l1.has(cid)).toBe(false);

      // Tiered get should retrieve from L2 and promote into L1
      const fetched = await tiered.get(cid);
      expect(fetched).toEqual(payload);

      // Now L1 has it!
      expect(await l1.has(cid)).toBe(true);
    });
  });
});
