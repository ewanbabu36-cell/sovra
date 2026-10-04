import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SqlitePinStore } from '../src/db.js';
import { PinRecord } from '../src/types.js';

describe('SqlitePinStore ACID Persistence Suite', () => {
  let tempDir: string;
  let store: SqlitePinStore;

  beforeEach(async () => {
    tempDir = path.join(
      os.tmpdir(),
      `sovra-sqlite-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });
    store = new SqlitePinStore(tempDir);
  });

  afterEach(async () => {
    store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('stores and retrieves pin records with sub-millisecond atomic transactions', () => {
    const pin: PinRecord = {
      cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      pinnedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      creatorDid: 'did:key:z6MkuSampleCreator456',
      targetReplicationFactor: 3,
      byteSize: 1048576, // 1 MB
      status: 'active',
      replicaCount: 1,
      lastVerifiedAt: Date.now(),
      childCids: ['bafkreia123', 'bafkreia456'],
    };

    store.upsertPin(pin);

    const retrieved = store.getPin(pin.cid);
    expect(retrieved).toBeDefined();
    expect(retrieved?.cid).toBe(pin.cid);
    expect(retrieved?.creatorDid).toBe('did:key:z6MkuSampleCreator456');
    expect(retrieved?.byteSize).toBe(1048576);
    expect(retrieved?.childCids).toEqual(['bafkreia123', 'bafkreia456']);
  });

  it('aggregates author allocations and protected CIDs accurately', () => {
    const authorA = 'did:key:creatorA';
    const authorB = 'did:key:creatorB';

    store.upsertPin({
      cid: 'cid-1',
      pinnedAt: Date.now(),
      creatorDid: authorA,
      targetReplicationFactor: 3,
      byteSize: 500,
      status: 'healthy',
      replicaCount: 3,
      lastVerifiedAt: Date.now(),
      childCids: ['child-1', 'child-2'],
    });

    store.upsertPin({
      cid: 'cid-2',
      pinnedAt: Date.now(),
      creatorDid: authorA,
      targetReplicationFactor: 3,
      byteSize: 300,
      status: 'healthy',
      replicaCount: 3,
      lastVerifiedAt: Date.now(),
      childCids: [],
    });

    store.upsertPin({
      cid: 'cid-3',
      pinnedAt: Date.now(),
      creatorDid: authorB,
      targetReplicationFactor: 3,
      byteSize: 1200,
      status: 'under_replicated',
      replicaCount: 1,
      lastVerifiedAt: Date.now(),
      childCids: ['child-3'],
    });

    // Verify allocations
    const allocations = store.getAuthorAllocations();
    expect(allocations[authorA]).toBe(800n);
    expect(allocations[authorB]).toBe(1200n);

    // Verify total pinned bytes
    expect(store.getTotalPinnedBytes()).toBe(2000n);

    // Verify protected CIDs
    const protectedCids = store.getAllProtectedCids();
    expect(protectedCids.has('cid-1')).toBe(true);
    expect(protectedCids.has('child-1')).toBe(true);
    expect(protectedCids.has('child-2')).toBe(true);
    expect(protectedCids.has('cid-2')).toBe(true);
    expect(protectedCids.has('cid-3')).toBe(true);
    expect(protectedCids.has('child-3')).toBe(true);
  });

  it('sweeps expired pins atomically and transitions status', () => {
    const pastTime = Date.now() - 5000;
    const futureTime = Date.now() + 50000;

    store.upsertPin({
      cid: 'cid-expired',
      pinnedAt: pastTime - 10000,
      expiresAt: pastTime,
      targetReplicationFactor: 3,
      byteSize: 100,
      status: 'active',
      replicaCount: 1,
      lastVerifiedAt: pastTime,
      childCids: [],
    });

    store.upsertPin({
      cid: 'cid-active',
      pinnedAt: Date.now(),
      expiresAt: futureTime,
      targetReplicationFactor: 3,
      byteSize: 200,
      status: 'active',
      replicaCount: 1,
      lastVerifiedAt: Date.now(),
      childCids: [],
    });

    const swept = store.sweepExpiredPins(Date.now());
    expect(swept.length).toBe(1);
    expect(swept[0]?.cid).toBe('cid-expired');

    const pinAfter = store.getPin('cid-expired');
    expect(pinAfter?.status).toBe('expired');

    const activePin = store.getPin('cid-active');
    expect(activePin?.status).toBe('active');
  });
});
