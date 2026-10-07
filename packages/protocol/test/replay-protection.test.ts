import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DurableReplayStore } from '../src/replay.js';

describe('Durable Replay Protection Suite (@sovra/protocol)', () => {
  const tmpFile = path.join(process.cwd(), '.tmp-test-replay-protection.json');

  beforeEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  it('accepts first submission and rejects duplicate eventId', () => {
    const store = new DurableReplayStore({ filePath: tmpFile });
    const now = Math.floor(Date.now() / 1000);

    const first = store.validateAndRecord({
      eventId: 'evt_001_first_post',
      issuerDid: 'did:sovra:alice',
      nonce: 'nonce_123',
      timestamp: now,
    });
    expect(first.accepted).toBe(true);

    // Duplicate submission
    const duplicate = store.validateAndRecord({
      eventId: 'evt_001_first_post',
      issuerDid: 'did:sovra:alice',
      nonce: 'nonce_999',
      timestamp: now,
    });
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.error).toContain('Duplicate event rejected');
  });

  it('rejects reused nonce for same issuer', () => {
    const store = new DurableReplayStore({ filePath: tmpFile });
    const now = Math.floor(Date.now() / 1000);

    const first = store.validateAndRecord({
      eventId: 'evt_alice_1',
      issuerDid: 'did:sovra:alice',
      nonce: 'consumed_nonce_1',
      timestamp: now,
    });
    expect(first.accepted).toBe(true);

    const secondWithSameNonce = store.validateAndRecord({
      eventId: 'evt_alice_2',
      issuerDid: 'did:sovra:alice',
      nonce: 'consumed_nonce_1',
      timestamp: now,
    });
    expect(secondWithSameNonce.accepted).toBe(false);
    expect(secondWithSameNonce.error).toContain('Reused nonce rejected');
  });

  it('enforces monotonic sequence progression', () => {
    const store = new DurableReplayStore({ filePath: tmpFile });
    const now = Math.floor(Date.now() / 1000);

    const seq1 = store.validateAndRecord({
      eventId: 'evt_s1',
      issuerDid: 'did:sovra:bob',
      deviceId: 'phone_1',
      sequence: 10,
      timestamp: now,
    });
    expect(seq1.accepted).toBe(true);

    // Stale sequence <= 10
    const staleSeq = store.validateAndRecord({
      eventId: 'evt_s2',
      issuerDid: 'did:sovra:bob',
      deviceId: 'phone_1',
      sequence: 9,
      timestamp: now,
    });
    expect(staleSeq.accepted).toBe(false);
    expect(staleSeq.error).toContain('Stale sequence rejected');

    // Valid next sequence 11
    const nextSeq = store.validateAndRecord({
      eventId: 'evt_s3',
      issuerDid: 'did:sovra:bob',
      deviceId: 'phone_1',
      sequence: 11,
      timestamp: now,
    });
    expect(nextSeq.accepted).toBe(true);
  });

  it('rejects timestamps exceeding maximum clock skew', () => {
    const store = new DurableReplayStore({ filePath: tmpFile, maxClockDriftSeconds: 60 });
    const now = Math.floor(Date.now() / 1000);

    // Stale timestamp 10 minutes in the past
    const stale = store.validateAndRecord({
      eventId: 'evt_stale',
      issuerDid: 'did:sovra:alice',
      timestamp: now - 600,
    });
    expect(stale.accepted).toBe(false);
    expect(stale.error).toContain('Timestamp skew exceeded');

    // Future timestamp 10 minutes in the future
    const future = store.validateAndRecord({
      eventId: 'evt_future',
      issuerDid: 'did:sovra:alice',
      timestamp: now + 600,
    });
    expect(future.accepted).toBe(false);
    expect(future.error).toContain('Timestamp skew exceeded');
  });

  it('survives process restart and preserves rejection state on disk', () => {
    const store1 = new DurableReplayStore({ filePath: tmpFile });
    const now = Math.floor(Date.now() / 1000);

    store1.validateAndRecord({
      eventId: 'evt_reboot_test',
      issuerDid: 'did:sovra:carol',
      nonce: 'nonce_reboot_test',
      sequence: 5,
      timestamp: now,
    });

    // Simulate process shutdown and reboot with new store instance
    const store2 = new DurableReplayStore({ filePath: tmpFile });

    // Attempt to submit identical eventId after reboot
    const dupRes = store2.validateAndRecord({
      eventId: 'evt_reboot_test',
      issuerDid: 'did:sovra:carol',
      timestamp: now,
    });
    expect(dupRes.accepted).toBe(false);
    expect(dupRes.error).toContain('Duplicate event rejected');

    // Attempt to reuse nonce after reboot
    const nonceRes = store2.validateAndRecord({
      eventId: 'evt_reboot_test_2',
      issuerDid: 'did:sovra:carol',
      nonce: 'nonce_reboot_test',
      timestamp: now,
    });
    expect(nonceRes.accepted).toBe(false);
    expect(nonceRes.error).toContain('Reused nonce rejected');
    store1.close();
    store2.close();
  });

  it('bounds memory by evicting oldest records when maxEntries is reached', () => {
    const store = new DurableReplayStore({ maxEntries: 3, autoPruneIntervalMs: 0 });
    const now = Math.floor(Date.now() / 1000);

    store.validateAndRecord({ eventId: 'evt_1', issuerDid: 'did:sovra:user_1', nonce: 'n_1', timestamp: now });
    store.validateAndRecord({ eventId: 'evt_2', issuerDid: 'did:sovra:user_2', nonce: 'n_2', timestamp: now });
    store.validateAndRecord({ eventId: 'evt_3', issuerDid: 'did:sovra:user_3', nonce: 'n_3', timestamp: now });

    expect(store.hasEvent('evt_1')).toBe(true);

    // 4th entry exceeds maxEntries=3, evicting oldest (evt_1)
    store.validateAndRecord({ eventId: 'evt_4', issuerDid: 'did:sovra:user_4', nonce: 'n_4', timestamp: now });

    expect(store.hasEvent('evt_1')).toBe(false);
    expect(store.hasEvent('evt_4')).toBe(true);
    store.close();
  });
});
