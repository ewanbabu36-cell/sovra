import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { CID, MemoryBlockstore, DiskBlockstore, TieredBlockstore } from '@sovra/storage';
import {
  SqlitePinStore,
  ContentComplianceManager,
  ContinuousPinningManager,
  DeniedHashRecord,
} from '../src/index.js';

describe('Milestone 5: Node Operator Legal Shield & Compliance Deny-List', () => {
  let testStorageDir: string;
  let pinStore: SqlitePinStore;
  let complianceManager: ContentComplianceManager;
  let blockstore: TieredBlockstore;
  let pinningManager: ContinuousPinningManager;

  beforeEach(async () => {
    testStorageDir = path.join(
      os.tmpdir(),
      `sovra-compliance-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(testStorageDir, { recursive: true });

    pinStore = new SqlitePinStore(testStorageDir);
    complianceManager = new ContentComplianceManager(pinStore);

    const mem = new MemoryBlockstore();
    const disk = new DiskBlockstore(testStorageDir, 10 * 1024 * 1024);
    blockstore = new TieredBlockstore(mem, disk);

    pinningManager = new ContinuousPinningManager(blockstore, testStorageDir);
    await pinningManager.init();
  });

  afterEach(async () => {
    pinningManager.close();
    pinStore.close();
    await fs.rm(testStorageDir, { recursive: true, force: true }).catch(() => {});
  });

  it('records DMCA/CSAM takedowns and rejects denied content during verification', () => {
    const badHash = 'a'.repeat(64);
    const badCid = 'bafkrei_bad_content_123';

    const record: DeniedHashRecord = {
      contentHash: badHash,
      cid: badCid,
      reason: 'DMCA',
      takedownNoticeId: 'NOTICE-2026-001',
      addedAt: Math.floor(Date.now() / 1000),
      addedBy: 'did:sovra:operator-node-1',
      notes: 'Court order takedown notice',
    };

    complianceManager.addTakedown(record);

    expect(complianceManager.isHashDenied(badHash)).toBe(true);
    expect(complianceManager.isCidDenied(badCid)).toBe(true);
    expect(complianceManager.isHashDenied('clean_hash')).toBe(false);

    expect(() => complianceManager.verifyContentAllowed(badHash)).toThrow(
      'blocked by operator legal compliance deny-list',
    );
    expect(() => complianceManager.verifyContentAllowed('clean_hash', badCid)).toThrow(
      'blocked by operator legal compliance deny-list',
    );
  });

  it('prevents ContinuousPinningManager from pinning blacklisted content', async () => {
    const rawData = new TextEncoder().encode('Infringing copyrighted movie bytes');
    const cid = CID.create('raw', rawData);
    await blockstore.put(cid, rawData);

    // Operator adds CID to legal deny-list
    complianceManager.addTakedown({
      contentHash: cid.multihash,
      cid: cid.toString(),
      reason: 'DMCA',
      addedAt: Math.floor(Date.now() / 1000),
      addedBy: 'did:sovra:operator-node-1',
    });

    // Attempting to pin must fail immediately with ERR_COMPLIANCE_BLOCKED
    await expect(pinningManager.pin(cid)).rejects.toThrow(
      'content blocked by legal compliance deny-list',
    );
  });

  it('purges blacklisted content from both pins and disk storage', async () => {
    const rawData = new TextEncoder().encode('Takedown target file data');
    const cid = CID.create('raw', rawData);
    await blockstore.put(cid, rawData);

    // Pin initially before takedown
    await pinningManager.pin(cid);
    expect(pinningManager.getPin(cid)).toBeDefined();
    expect(await blockstore.has(cid)).toBe(true);

    // Issue takedown order
    complianceManager.addTakedown({
      contentHash: cid.multihash,
      cid: cid.toString(),
      reason: 'LEGAL_TAKEDOWN',
      addedAt: Math.floor(Date.now() / 1000),
      addedBy: 'did:sovra:court-compliance',
    });

    // Purge
    const purged = await complianceManager.purgeDeniedContent(cid, blockstore);
    expect(purged).toBe(true);

    // Verify block is eradicated from pin store and blockstore disk
    expect(pinStore.getPin(cid.toString())).toBeUndefined();
    expect(await blockstore.has(cid)).toBe(false);
  });

  it('generates blinded storage envelope affirming plausible deniability', () => {
    const ciphertext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const envelope = complianceManager.createBlindedEnvelope(ciphertext, 'bafkreienvelope123');

    expect(envelope.isBlinded).toBe(true);
    expect(envelope.byteSize).toBe(8);
    expect(envelope.proofOfZeroKnowledge).toBeDefined();
    expect(envelope.proofOfZeroKnowledge.length).toBe(64); // SHA-256 hex length
  });
});
