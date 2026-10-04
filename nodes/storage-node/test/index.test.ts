import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { CID, QuotaExceededError, AuthorQuotaExceededError } from '@sovra/storage';
import { StorageNodeDaemon, StorageNodeConfig } from '../src/index.js';

describe('@sovra/storage-node StorageNodeDaemon Suite', () => {
  let tempDir: string;
  let daemon: StorageNodeDaemon;

  beforeEach(async () => {
    tempDir = path.join(
      os.tmpdir(),
      `sovra-storage-node-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });

    const config: StorageNodeConfig = {
      storagePath: tempDir,
      maxCapacityBytes: 107374182400n, // 100 GB
      enableBitswap: true,
      memoryCacheBytes: 16 * 1024 * 1024,
      quotas: {
        maxCapacityBytes: 107374182400n,
        highWatermarkPercent: 85,
        lowWatermarkPercent: 70,
        maxAuthorQuotaBytes: 1048576n, // 1 MB per author for testing
      },
    };
    daemon = new StorageNodeDaemon(config);
  });

  afterEach(async () => {
    if (daemon.isRunning) {
      await daemon.stop();
    }
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('instantiates, starts, and reports configuration and status', async () => {
    expect(daemon.getConfig().enableBitswap).toBe(true);
    expect(daemon.isRunning).toBe(false);

    const startRes = await daemon.start();
    expect(startRes.ok).toBe(true);
    expect(daemon.isRunning).toBe(true);

    const stats = daemon.getStats();
    expect(stats.isBitswapActive).toBe(true);
    expect(stats.totalBlocks).toBe(0);
    expect(stats.pinnedCount).toBe(0);
    expect(stats.activePinsCount).toBe(0);

    const stopRes = await daemon.stop();
    expect(stopRes.ok).toBe(true);
    expect(daemon.isRunning).toBe(false);
  });

  it('publishes media through internal storage service and persists blocks', async () => {
    await daemon.start();

    const mediaBytes = new TextEncoder().encode('Decentralized Sovra Public Video Segment Content');
    const pubRes = await daemon.storageService.publishMedia(mediaBytes, 'video/mp4');

    expect(pubRes.ok).toBe(true);
    if (!pubRes.ok) return;

    const mediaAsset = pubRes.value;
    expect(mediaAsset.cid.version).toBe(1);

    // Verify local retrieval from daemon
    const retrievedRes = await daemon.retrieveContent(mediaAsset.cid as unknown as CID);
    expect(retrievedRes.ok).toBe(true);
    if (!retrievedRes.ok) return;

    expect(new TextDecoder().decode(retrievedRes.value)).toBe(
      'Decentralized Sovra Public Video Segment Content',
    );
  });

  it('manages continuous pinning with recursive DAG resolution and metadata', async () => {
    await daemon.start();

    // 1. Create a 300KB file (spans 2 raw blocks + 1 root DAG node)
    const largePayload = new Uint8Array(300 * 1024).fill(42);
    const pubRes = await daemon.storageService.publishMedia(largePayload, 'application/octet-stream');
    expect(pubRes.ok).toBe(true);
    if (!pubRes.ok) return;

    const rootCid = pubRes.value.cid as unknown as CID;

    // 2. Pin continuously with author DID and TTL lease (1 hour)
    const creatorDid = 'did:key:z6MkuSampleCreator123';
    const pinRes = await daemon.pin(rootCid, {
      creatorDid,
      targetReplicationFactor: 3,
      ttlMs: 3600000,
    });
    expect(pinRes.ok).toBe(true);
    if (!pinRes.ok) return;

    const pinRecord = pinRes.value;
    expect(pinRecord.cid).toBe(rootCid.toString());
    expect(pinRecord.creatorDid).toBe(creatorDid);
    expect(pinRecord.targetReplicationFactor).toBe(3);
    expect(pinRecord.status).toBe('active');
    expect(pinRecord.childCids.length).toBeGreaterThan(0); // Recursively tracked child chunks
    expect(pinRecord.byteSize).toBeGreaterThanOrEqual(300 * 1024);

    // Verify stats updated
    const stats = daemon.getStats();
    expect(stats.activePinsCount).toBe(1);
    expect(stats.quotaUsage.authorUsage[creatorDid]).toBe(BigInt(pinRecord.byteSize));

    // 3. Renew pin with new expiry
    const renewedRes = await daemon.renewPin(rootCid, undefined, 7200000);
    expect(renewedRes.ok).toBe(true);
    if (!renewedRes.ok) return;
    expect(renewedRes.value.expiresAt).toBeGreaterThan(pinRecord.expiresAt!);

    // 4. Unpin CID and verify clean orphan removal
    const unpinRes = await daemon.unpin(rootCid);
    expect(unpinRes.ok).toBe(true);

    const statsAfter = daemon.getStats();
    expect(statsAfter.activePinsCount).toBe(0);
    expect(statsAfter.pinnedCount).toBe(0);
  });

  it('enforces author storage quotas and global capacity boundaries', async () => {
    // Daemon configured with maxAuthorQuotaBytes = 1000 bytes for testing
    const strictDir = path.join(tempDir, 'strict-quota');
    await fs.mkdir(strictDir, { recursive: true });

    const strictDaemon = new StorageNodeDaemon({
      storagePath: strictDir,
      maxCapacityBytes: 5000n, // 5 KB total
      enableBitswap: false,
      quotas: {
        maxCapacityBytes: 5000n,
        maxAuthorQuotaBytes: 1500n, // 1.5 KB per author
      },
    });
    await strictDaemon.start();

    try {
      // 1. Author A stores 1000 bytes (within 1500 limit)
      const dataA1 = new Uint8Array(1000).fill(1);
      const cidA1 = CID.create('raw', dataA1);
      await strictDaemon.blockstore.put(cidA1, dataA1);
      const pin1 = await strictDaemon.pin(cidA1, { creatorDid: 'did:key:creatorA' });
      expect(pin1.ok).toBe(true);

      // 2. Author A tries to store another 800 bytes (1000 + 800 = 1800 > 1500 limit) -> REJECTED
      const dataA2 = new Uint8Array(800).fill(2);
      const cidA2 = CID.create('raw', dataA2);
      await strictDaemon.blockstore.put(cidA2, dataA2);
      const pin2 = await strictDaemon.pin(cidA2, { creatorDid: 'did:key:creatorA' });
      expect(pin2.ok).toBe(false);
      expect(pin2.error).toBeInstanceOf(AuthorQuotaExceededError);

      // 3. Author B tries to store 4500 bytes (4500 > 1500 author quota) -> REJECTED
      const dataB1 = new Uint8Array(4500).fill(3);
      const cidB1 = CID.create('raw', dataB1);
      await strictDaemon.blockstore.put(cidB1, dataB1);
      const pinB = await strictDaemon.pin(cidB1, { creatorDid: 'did:key:creatorB' });
      expect(pinB.ok).toBe(false);
      expect(pinB.error).toBeInstanceOf(AuthorQuotaExceededError);

      // 4. Global capacity rejection: without author DID, if pinned exceeds 5000 bytes
      const bigData = new Uint8Array(4200).fill(4);
      const bigCid = CID.create('raw', bigData);
      await strictDaemon.blockstore.put(bigCid, bigData);
      // Already 1000 bytes pinned, 1000 + 4200 = 5200 > 5000 -> REJECTED
      const pinGlobal = await strictDaemon.pin(bigCid);
      expect(pinGlobal.ok).toBe(false);
      expect(pinGlobal.error).toBeInstanceOf(QuotaExceededError);
    } finally {
      await strictDaemon.stop();
    }
  });

  it('runs garbage collection to evict unpinned blocks while protecting pinned DAGs', async () => {
    await daemon.start();

    // 1. Put 3 unpinned blocks
    const unpinned1 = new Uint8Array(500).fill(10);
    const cidUnpinned1 = CID.create('raw', unpinned1);
    await daemon.blockstore.put(cidUnpinned1, unpinned1);

    const unpinned2 = new Uint8Array(500).fill(20);
    const cidUnpinned2 = CID.create('raw', unpinned2);
    await daemon.blockstore.put(cidUnpinned2, unpinned2);

    // 2. Put 1 pinned block
    const pinnedData = new Uint8Array(500).fill(99);
    const cidPinned = CID.create('raw', pinnedData);
    await daemon.blockstore.put(cidPinned, pinnedData);
    await daemon.pin(cidPinned);

    expect(await daemon.blockstore.has(cidUnpinned1)).toBe(true);
    expect(await daemon.blockstore.has(cidUnpinned2)).toBe(true);
    expect(await daemon.blockstore.has(cidPinned)).toBe(true);

    // 3. Trigger Garbage Collection to free at least 800 bytes
    const gcRes = await daemon.runGarbageCollection(800n);
    expect(gcRes.ok).toBe(true);
    if (!gcRes.ok) return;

    expect(gcRes.value.blocksEvicted).toBeGreaterThanOrEqual(1);
    expect(gcRes.value.bytesFreed).toBeGreaterThan(0n);

    // 4. Verify pinned block was NOT deleted!
    expect(await daemon.blockstore.has(cidPinned)).toBe(true);
    expect(await daemon.blockstore.isPinned(cidPinned)).toBe(true);
  });

  it('executes background replica verification, under-replication detection, and sweeps expired leases', async () => {
    await daemon.start();

    // 1. Create block and pin with short TTL (already expired or 1ms)
    const blockData = new Uint8Array([1, 2, 3, 4, 5]);
    const cid = CID.create('raw', blockData);
    await daemon.blockstore.put(cid, blockData);

    // Target 3 replicas, expires in 10ms
    const pinRes = await daemon.pin(cid, {
      targetReplicationFactor: 3,
      ttlMs: 10,
    });
    expect(pinRes.ok).toBe(true);

    // Wait 25ms for lease to expire
    await new Promise(r => setTimeout(r, 25));

    // 2. Run replica verification
    const reportRes = await daemon.verifyReplicas();
    expect(reportRes.ok).toBe(true);
    if (!reportRes.ok) return;

    const report = reportRes.value;
    expect(report.expiredCount).toBe(1); // Detected expired lease
    const pinAfter = daemon.getPin(cid).value;
    expect(pinAfter?.status).toBe('expired');

    // 3. Create fresh permanent pin with targetReplicationFactor = 3
    const freshData = new Uint8Array([6, 7, 8, 9, 10]);
    const freshCid = CID.create('raw', freshData);
    await daemon.blockstore.put(freshCid, freshData);
    await daemon.pin(freshCid, { targetReplicationFactor: 3 });

    // Verify replica check reports under-replicated (since local node is only replica) and attempts repair
    const report2Res = await daemon.verifyReplicas();
    expect(report2Res.ok).toBe(true);
    if (!report2Res.ok) return;

    expect(report2Res.value.underReplicatedCount).toBeGreaterThanOrEqual(1);
    const freshPin = daemon.getPin(freshCid).value;
    expect(freshPin?.status).toBe('under_replicated');
  });
});
