import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateEd25519KeyPair, bytesToHex } from '@sovra/crypto';
import {
  UnsignedProtocolEvent,
  SovraProtocolEvent,
  createSignedProtocolEvent,
  DurableEventStore,
  DistributedStateEngine,
  DeterministicStateSnapshot,
} from '../src/index.js';

describe('Phase 3: Authoritative Canonical Distributed State Engine', () => {
  let tempDir: string;
  let storeFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-dist-state-test-'));
    storeFile = path.join(tempDir, 'events.log');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function createTestIdentity(name = 'Peer') {
    const kp = generateEd25519KeyPair();
    const pubkeyHex = bytesToHex(kp.publicKey);
    return {
      name,
      pubkeyHex,
      did: `did:key:${pubkeyHex}`,
      privateKey: kp.privateKey,
    };
  }

  function signEvent<T>(
    author: ReturnType<typeof createTestIdentity>,
    eventType: string,
    payload: T,
    options?: {
      object?: { id: string; type: string; ownerDid?: string };
      parents?: string[];
      sequence?: number;
      lamport?: number;
      createdAt?: number;
      nonce?: string;
    },
  ): SovraProtocolEvent<T> {
    const unsigned: UnsignedProtocolEvent<T> = {
      protocolVersion: { major: 1, minor: 0 },
      eventType,
      author: {
        did: author.did,
        deviceId: 'dev-node-1',
        pubkeyHex: author.pubkeyHex,
      },
      object: options?.object,
      parents: options?.parents ?? [],
      logicalClock: {
        sequence: options?.sequence ?? 1,
        lamport: options?.lamport ?? options?.sequence ?? 1,
      },
      nonce: options?.nonce ?? `nonce-${Math.random()}-${Date.now()}`,
      createdAt: options?.createdAt ?? Math.floor(Date.now() / 1000),
      payload,
    };

    return createSignedProtocolEvent(unsigned, author.privateKey);
  }

  // ==========================================
  // 1. EVENT MODEL & LOCAL-FIRST INGESTION
  // ==========================================
  describe('Event Model & Local-First Ingestion', () => {
    it('ingests and projects profile updates deterministically', async () => {
      const alice = createTestIdentity('Alice');
      const engine = new DistributedStateEngine({ store: new DurableEventStore({ filePath: storeFile }) });

      const updateEvent = signEvent(alice, 'profile:update', {
        displayName: 'Alice Sovereign',
        bio: 'Building decentralized mesh networks',
        avatarCid: 'bafy-avatar-1',
      }, { sequence: 1, lamport: 1, createdAt: 1000 });

      const res = await engine.ingestEvent(updateEvent);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.applied).toBe(true);

      const profile = engine.getProfile(alice.did);
      expect(profile).not.toBeNull();
      expect(profile?.displayName).toBe('Alice Sovereign');
      expect(profile?.bio).toBe('Building decentralized mesh networks');
      expect(profile?.avatarCid).toBe('bafy-avatar-1');
      expect(profile?.editHistory.length).toBe(1);
    });

    it('rejects forged signatures fail-closed', async () => {
      const alice = createTestIdentity('Alice');
      const bob = createTestIdentity('Bob');
      const engine = new DistributedStateEngine();

      const forgedEvent = signEvent(alice, 'profile:update', {
        displayName: 'Attacker Malicious',
      }, { sequence: 1 });

      // Mallory signs with Bob's key instead of Alice's key
      const tampered: SovraProtocolEvent = {
        ...forgedEvent,
        author: {
          did: alice.did, // Claim Alice
          pubkeyHex: alice.pubkeyHex,
        },
        signature: signEvent(bob, 'dummy', {}).signature, // Signed by Bob
      };

      const res = await engine.ingestEvent(tampered);
      expect(res.ok).toBe(false);
      expect(engine.getProfile(alice.did)).toBeNull();
    });
  });

  // ==========================================
  // 2. CAUSAL ORDERING & DEPENDENCY BUFFERING
  // ==========================================
  describe('Causal Ordering & Out-of-Order Dependency Buffering', () => {
    it('buffers dependent events and applies them in causal order upon parent arrival', async () => {
      const alice = createTestIdentity('Alice');
      const bob = createTestIdentity('Bob');
      const charlie = createTestIdentity('Charlie');
      const engine = new DistributedStateEngine();

      // Parent: Post P1 by Alice
      const postP1 = signEvent(alice, 'post:create', {
        content: 'Root post about decentralization',
      }, { object: { id: 'post-1', type: 'post', ownerDid: alice.did }, sequence: 1, lamport: 1, createdAt: 1000 });

      // Child 1: Comment C1 by Bob, depending on P1
      const commentC1 = signEvent(bob, 'comment:create', {
        targetObjectId: 'post-1',
        content: 'Great insight on mesh topology',
      }, {
        object: { id: 'comment-1', type: 'comment', ownerDid: bob.did },
        parents: [postP1.eventId],
        sequence: 1,
        lamport: 2,
        createdAt: 1005,
      });

      // Child 2: Reaction R1 by Charlie, depending on C1
      const reactionR1 = signEvent(charlie, 'reaction:add', {
        targetObjectId: 'post-1',
        direction: '+',
      }, {
        parents: [commentC1.eventId],
        sequence: 1,
        lamport: 3,
        createdAt: 1010,
      });

      // Deliver out of order: [R1, C1, P1]
      // 1. Ingest R1: missing C1 -> buffered
      const resR1 = await engine.ingestEvent(reactionR1);
      expect(resR1.ok).toBe(true);
      if (!resR1.ok) return;
      expect(resR1.value.buffered).toBe(true);
      expect(resR1.value.applied).toBe(false);
      expect(engine.getReactionCount('post-1')).toBe(0);

      // 2. Ingest C1: missing P1 -> buffered
      const resC1 = await engine.ingestEvent(commentC1);
      expect(resC1.ok).toBe(true);
      if (!resC1.ok) return;
      expect(resC1.value.buffered).toBe(true);
      expect(resC1.value.applied).toBe(false);
      expect(engine.getComments('post-1').length).toBe(0);

      // 3. Ingest P1: dependencies satisfied -> triggers recursive unbuffering of C1 and R1!
      const resP1 = await engine.ingestEvent(postP1);
      expect(resP1.ok).toBe(true);
      if (!resP1.ok) return;
      expect(resP1.value.applied).toBe(true);

      // Verify that all 3 events were applied in causal order
      expect(engine.getPost('post-1')?.content).toBe('Root post about decentralization');
      expect(engine.getComments('post-1').length).toBe(1);
      expect(engine.getComments('post-1')[0]?.content).toBe('Great insight on mesh topology');
      expect(engine.getReactionCount('post-1')).toBe(1);
      expect(engine.getDiagnostics().pendingDependencyCount).toBe(0);
    });

    it('detects and rejects dependency cycles safely', async () => {
      const alice = createTestIdentity('Alice');
      const bob = createTestIdentity('Bob');
      const engine = new DistributedStateEngine({ maxDependencyDepth: 2 });

      // Create a chain of unapplied events that exceeds allowable depth
      const ev1 = signEvent(alice, 'post:create', { content: 'Level 1' }, {
        parents: ['genesis-missing-root'],
      });
      const res1 = await engine.ingestEvent(ev1);
      expect(res1.ok).toBe(true);
      if (!res1.ok) return;
      expect(res1.value.buffered).toBe(true);

      const ev2 = signEvent(bob, 'post:create', { content: 'Level 2' }, {
        parents: [ev1.eventId],
      });
      const res2 = await engine.ingestEvent(ev2);
      expect(res2.ok).toBe(true);
      if (!res2.ok) return;
      expect(res2.value.buffered).toBe(true);

      // Level 3 exceeds maxDependencyDepth 2, safely triggering cycle / depth rejection
      const ev3 = signEvent(alice, 'post:create', { content: 'Level 3' }, {
        sequence: 2,
        parents: [ev2.eventId],
      });
      const res3 = await engine.ingestEvent(ev3);
      expect(res3.ok).toBe(false);
      if (!res3.ok) {
        expect(res3.error.message.toLowerCase()).toContain('cycle');
      }
    });
  });

  // ==========================================
  // 3. DETERMINISTIC CONFLICT RESOLUTION & LWW
  // ==========================================
  describe('Deterministic Conflict Resolution & LWW', () => {
    it('resolves concurrent profile edits with Lamport clock and deterministic tie-breaker', async () => {
      const alice = createTestIdentity('Alice');

      // Edit A: lamport = 10, createdAt = 1000
      const editA = signEvent(alice, 'profile:update', {
        displayName: 'Alice Version A',
        bio: 'Bio A',
      }, { sequence: 1, lamport: 10, createdAt: 1000 });

      // Edit B: lamport = 12, createdAt = 1000 (higher Lamport clock wins)
      const editB = signEvent(alice, 'profile:update', {
        displayName: 'Alice Version B',
        bio: 'Bio B',
      }, { sequence: 2, lamport: 12, createdAt: 1000 });

      // Projector 1: Ingest A then B
      const engine1 = new DistributedStateEngine();
      await engine1.ingestEvent(editA);
      await engine1.ingestEvent(editB);

      // Projector 2: Ingest B then A
      const engine2 = new DistributedStateEngine();
      await engine2.ingestEvent(editB);
      await engine2.ingestEvent(editA);

      // Both must converge to Version B
      expect(engine1.getProfile(alice.did)?.displayName).toBe('Alice Version B');
      expect(engine2.getProfile(alice.did)?.displayName).toBe('Alice Version B');
      expect(engine1.getStateHash()).toBe(engine2.getStateHash());
    });

    it('enforces total order tie-breaker when Lamport and createdAt are identical', async () => {
      const alice = createTestIdentity('Alice');

      const edit1 = signEvent(alice, 'profile:update', {
        displayName: 'Tie 1',
      }, { sequence: 1, lamport: 5, createdAt: 2000, nonce: 'nonce-aaa' });

      const edit2 = signEvent(alice, 'profile:update', {
        displayName: 'Tie 2',
      }, { sequence: 2, lamport: 5, createdAt: 2000, nonce: 'nonce-zzz' });

      const engine1 = new DistributedStateEngine();
      await engine1.ingestBatch([edit1, edit2]);

      const engine2 = new DistributedStateEngine();
      await engine2.ingestBatch([edit2, edit1]);

      expect(engine1.getProfile(alice.did)?.displayName).toBe(engine2.getProfile(alice.did)?.displayName);
      expect(engine1.getStateHash()).toBe(engine2.getStateHash());
    });
  });

  // ==========================================
  // 4. TOMBSTONES, DELETIONS & EDIT HISTORY
  // ==========================================
  describe('Tombstones, Deletions & Edit History', () => {
    it('prevents late-arriving create from resurrecting a deleted post', async () => {
      const alice = createTestIdentity('Alice');
      const engine = new DistributedStateEngine();

      const postEvent = signEvent(alice, 'post:create', {
        content: 'Temporary announcement',
      }, { object: { id: 'post-temp', type: 'post' }, sequence: 1, createdAt: 1000 });

      const deleteEvent = signEvent(alice, 'post:delete', {
        targetPostId: 'post-temp',
      }, { object: { id: 'post-temp', type: 'post' }, sequence: 2, createdAt: 1010 });

      // Node receives DELETE first, then late-arriving CREATE
      await engine.ingestEvent(deleteEvent);
      expect(engine.getPost('post-temp')).toBeNull(); // Tombstone created

      await engine.ingestEvent(postEvent);
      // Late create MUST NOT resurrect!
      expect(engine.getPost('post-temp')).toBeNull();
      expect(engine.getPostWithTombstone('post-temp')?.isDeleted).toBe(true);
    });

    it('preserves edit history for content audits', async () => {
      const alice = createTestIdentity('Alice');
      const engine = new DistributedStateEngine();

      const create = signEvent(alice, 'post:create', {
        content: 'Original draft',
      }, { object: { id: 'post-hist', type: 'post' }, sequence: 1, lamport: 1, createdAt: 1000 });

      const edit1 = signEvent(alice, 'post:edit', {
        targetPostId: 'post-hist',
        newContent: 'Second draft with revisions',
      }, { object: { id: 'post-hist', type: 'post' }, sequence: 2, lamport: 2, createdAt: 1020 });

      const edit2 = signEvent(alice, 'post:edit', {
        targetPostId: 'post-hist',
        newContent: 'Final published version',
      }, { object: { id: 'post-hist', type: 'post' }, sequence: 3, lamport: 3, createdAt: 1040 });

      await engine.ingestBatch([create, edit1, edit2]);

      const post = engine.getPost('post-hist');
      expect(post?.content).toBe('Final published version');
      expect(post?.editHistory.length).toBe(3);
      expect(post?.editHistory[0]?.content).toBe('Original draft');
      expect(post?.editHistory[1]?.content).toBe('Second draft with revisions');
      expect(post?.editHistory[2]?.content).toBe('Final published version');
    });

    it('rejects post edits attempted on deleted content', async () => {
      const alice = createTestIdentity('Alice');
      const engine = new DistributedStateEngine();

      const create = signEvent(alice, 'post:create', { content: 'Post' }, { object: { id: 'p-del', type: 'post' }, sequence: 1 });
      const del = signEvent(alice, 'post:delete', { targetPostId: 'p-del' }, { object: { id: 'p-del', type: 'post' }, sequence: 2 });
      const edit = signEvent(alice, 'post:edit', { targetPostId: 'p-del', newContent: 'Revived' }, { object: { id: 'p-del', type: 'post' }, sequence: 3 });

      await engine.ingestBatch([create, del, edit]);
      expect(engine.getPost('p-del')).toBeNull();
    });
  });

  // ==========================================
  // 5. SOCIAL GRAPH: FOLLOW, BLOCK & MUTING
  // ==========================================
  describe('Social Graph: Follow, Block & Muting Semantics', () => {
    it('enforces that block takes precedence over follow and breaks relationship', async () => {
      const alice = createTestIdentity('Alice');
      const bob = createTestIdentity('Bob');
      const engine = new DistributedStateEngine();

      const follow = signEvent(alice, 'social:follow', { targetDid: bob.did }, { sequence: 1, lamport: 1, createdAt: 1000 });
      await engine.ingestEvent(follow);
      expect(engine.getFollowing(alice.did)).toContain(bob.did);

      // Alice blocks Bob
      const block = signEvent(alice, 'social:block', { targetDid: bob.did }, { sequence: 2, lamport: 2, createdAt: 1010 });
      await engine.ingestEvent(block);

      // Blocked state breaks follow
      expect(engine.getFollowing(alice.did)).not.toContain(bob.did);
      const rel = engine.getRelationship(alice.did, bob.did);
      expect(rel.isBlocked).toBe(true);
      expect(rel.isFollowing).toBe(false);
    });

    it('manages bilateral friend request lifecycle deterministically', async () => {
      const alice = createTestIdentity('Alice');
      const bob = createTestIdentity('Bob');
      const engine = new DistributedStateEngine();

      // Alice sends friend request
      const req = signEvent(alice, 'friend:request', { targetDid: bob.did }, { sequence: 1, lamport: 1 });
      await engine.ingestEvent(req);
      expect(engine.getRelationship(alice.did, bob.did).friendStatus).toBe('REQUEST_SENT');

      // Bob accepts friend request
      const accept = signEvent(bob, 'friend:respond', { targetDid: alice.did, accept: true }, { sequence: 1, lamport: 2 });
      await engine.ingestEvent(accept);
      expect(engine.getRelationship(bob.did, alice.did).friendStatus).toBe('ACCEPTED');
    });
  });

  // ==========================================
  // 6. PN-COUNTER CRDT REACTIONS
  // ==========================================
  describe('PN-Counter CRDT Reactions', () => {
    it('converges to exact arithmetic count regardless of arrival order or duplicates', async () => {
      const alice = createTestIdentity('Alice');
      const bob = createTestIdentity('Bob');
      const charlie = createTestIdentity('Charlie');

      const r1 = signEvent(alice, 'reaction:add', { targetObjectId: 'post-99', direction: '+' }, { sequence: 1 });
      const r2 = signEvent(bob, 'reaction:add', { targetObjectId: 'post-99', direction: '+' }, { sequence: 1 });
      const r3 = signEvent(charlie, 'reaction:add', { targetObjectId: 'post-99', direction: '-' }, { sequence: 1 });

      const engine1 = new DistributedStateEngine();
      await engine1.ingestBatch([r1, r2, r3]);

      const engine2 = new DistributedStateEngine();
      await engine2.ingestBatch([r3, r1, r2]);

      // Both should have count: +1 + 1 - 1 = 1
      expect(engine1.getReactionCount('post-99')).toBe(1);
      expect(engine2.getReactionCount('post-99')).toBe(1);
      expect(engine1.getStateHash()).toBe(engine2.getStateHash());
    });
  });

  // ==========================================
  // 7. DETERMINISTIC SNAPSHOTS & REPLAY
  // ==========================================
  describe('Deterministic Snapshots & Replay Invariant', () => {
    it('proves that snapshot + subsequent replay equals full replay from zero', async () => {
      const alice = createTestIdentity('Alice');
      const bob = createTestIdentity('Bob');

      const events: SovraProtocolEvent[] = [
        signEvent(alice, 'profile:update', { displayName: 'Alice Snap' }, { sequence: 1, lamport: 1, createdAt: 100 }),
        signEvent(alice, 'post:create', { content: 'Post Alpha' }, { object: { id: 'p-alpha', type: 'post' }, sequence: 2, lamport: 2, createdAt: 200 }),
        signEvent(bob, 'social:follow', { targetDid: alice.did }, { sequence: 1, lamport: 3, createdAt: 300 }),
        signEvent(alice, 'post:create', { content: 'Post Beta' }, { object: { id: 'p-beta', type: 'post' }, sequence: 3, lamport: 4, createdAt: 400 }),
        signEvent(bob, 'reaction:add', { targetObjectId: 'p-alpha', direction: '+' }, { sequence: 2, lamport: 5, createdAt: 500 }),
      ];

      // Engine 1: Ingests all 5 events from zero
      const engineFull = new DistributedStateEngine();
      await engineFull.ingestBatch(events);
      const fullHash = engineFull.getStateHash();

      // Engine 2: Ingests first 3 events, creates snapshot, restores, then ingests remaining 2 events
      const engineSnap = new DistributedStateEngine();
      await engineSnap.ingestBatch(events.slice(0, 3));
      const snapshot = engineSnap.createSnapshot();

      // Engine 3: Restores from snapshot, then applies remaining 2 events
      const engineRestored = new DistributedStateEngine();
      const restoreRes = engineRestored.restoreFromSnapshot(snapshot);
      expect(restoreRes.ok).toBe(true);

      await engineRestored.ingestBatch(events.slice(3));
      const restoredHash = engineRestored.getStateHash();

      // INVARIANT: full replay == snapshot + replay
      expect(restoredHash).toBe(fullHash);
      expect(engineRestored.getProfile(alice.did)?.displayName).toBe('Alice Snap');
      expect(engineRestored.getPost('p-alpha')?.content).toBe('Post Alpha');
      expect(engineRestored.getPost('p-beta')?.content).toBe('Post Beta');
      expect(engineRestored.getReactionCount('p-alpha')).toBe(1);
      expect(engineRestored.getFollowing(bob.did)).toContain(alice.did);
    });

    it('rejects tampered snapshots fail-closed', async () => {
      const alice = createTestIdentity('Alice');
      const engine = new DistributedStateEngine();
      await engine.ingestEvent(signEvent(alice, 'profile:update', { displayName: 'Original' }));

      const snapshot = engine.createSnapshot();

      // Attacker tampers with snapshot state content
      const tamperedSnapshot: DeterministicStateSnapshot = {
        ...snapshot,
        state: {
          ...snapshot.state,
          profiles: {
            ...snapshot.state.profiles,
            [alice.did]: {
              ...snapshot.state.profiles[alice.did]!,
              displayName: 'Tampered Hacker Name',
            },
          },
        },
      };

      const engineNew = new DistributedStateEngine();
      const res = engineNew.restoreFromSnapshot(tamperedSnapshot);
      expect(res.ok).toBe(false);
      expect(engineNew.getProfile(alice.did)).toBeNull();
    });
  });

  // ==========================================
  // 8. DUPLICATE IDEMPOTENCY & INTEGRITY
  // ==========================================
  describe('Duplicate Idempotency & Conflict Detection', () => {
    it('handles 100x duplicate deliveries idempotently with zero state divergence', async () => {
      const alice = createTestIdentity('Alice');
      const engine = new DistributedStateEngine();

      const post = signEvent(alice, 'post:create', { content: 'Idempotent test' }, { object: { id: 'p-idem', type: 'post' } });

      for (let i = 0; i < 100; i++) {
        const res = await engine.ingestEvent(post);
        expect(res.ok).toBe(true);
      }

      expect(engine.getDiagnostics().totalEventsApplied).toBe(1);
      expect(engine.getPost('p-idem')?.content).toBe('Idempotent test');
    });

    it('detects and rejects conflicting payloads under identical EventID as an integrity violation', async () => {
      const alice = createTestIdentity('Alice');
      const store = new DurableEventStore();
      const engine = new DistributedStateEngine({ store });

      const original = signEvent(alice, 'post:create', { content: 'Legitimate post' });
      await engine.ingestEvent(original);

      // 1. Attacker attempts to submit same eventId with conflicting modified payload
      const tamperedPayload: SovraProtocolEvent = {
        ...original,
        payload: { content: 'Malicious payload injection' },
      };
      const resPayload = await store.append(tamperedPayload);
      expect(resPayload.ok).toBe(false);

      // 2. Attacker attempts duplicate eventId with conflicting signature
      const tamperedSig: SovraProtocolEvent = {
        ...original,
        signature: 'a'.repeat(128),
      };
      const resSig = await store.append(tamperedSig);
      expect(resSig.ok).toBe(false);
    });
  });

  // ==========================================
  // 9. CRASH RECOVERY & STORAGE PERSISTENCE
  // ==========================================
  describe('Crash Recovery & Storage Persistence', () => {
    it('survives simulated crash and reconstructs state from durable disk log', async () => {
      const alice = createTestIdentity('Alice');
      const bob = createTestIdentity('Bob');

      const store1 = new DurableEventStore({ filePath: storeFile });
      const engine1 = new DistributedStateEngine({ store: store1 });

      const e1 = signEvent(alice, 'profile:update', { displayName: 'Crash Survivor' }, { sequence: 1, lamport: 1 });
      const e2 = signEvent(alice, 'post:create', { content: 'Persisted to disk' }, { object: { id: 'p-crash', type: 'post' }, sequence: 2, lamport: 2 });
      const e3 = signEvent(bob, 'social:follow', { targetDid: alice.did }, { sequence: 1, lamport: 3 });

      await engine1.ingestBatch([e1, e2, e3]);
      const preCrashHash = engine1.getStateHash();

      // SIMULATE CRASH: Dispose engine1 and store1 completely
      // Restart new engine reading the same storage file on disk
      const store2 = new DurableEventStore({ filePath: storeFile });
      expect(store2.getCount()).toBe(3);

      const engine2 = new DistributedStateEngine({ store: store2 });
      // Replay events from durable log
      for await (const ev of store2.iterate()) {
        await engine2.ingestEvent(ev);
      }

      expect(engine2.getStateHash()).toBe(preCrashHash);
      expect(engine2.getProfile(alice.did)?.displayName).toBe('Crash Survivor');
      expect(engine2.getPost('p-crash')?.content).toBe('Persisted to disk');
      expect(engine2.getFollowing(bob.did)).toContain(alice.did);
    });

    it('detects and safely quarantines corrupted records in disk log', () => {
      // Intentionally write a corrupt line into the storeFile
      fs.writeFileSync(storeFile, '{"eventId":"fake","payload":"invalid JSON or tampered hash"}\n', 'utf8');

      const store = new DurableEventStore({ filePath: storeFile });
      const corruptions = store.getCorruptionReports();
      expect(corruptions.length).toBeGreaterThan(0);
      expect(store.getCount()).toBe(0); // Corrupted event skipped from valid index
    });
  });
});
