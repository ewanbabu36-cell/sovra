/**
 * @file packages/protocol/test/crdt-projection.test.ts
 * Verification Suite for VectorClock, MerkleStateDigest, and CRDT State Projector.
 *
 * Verifies:
 * 1. Vector Clock Monotonicity, Merges, Causal Ordering (BEFORE, AFTER, CONCURRENT, IDENTICAL).
 * 2. Merkle State Digest Root Hashing, Fast Equality, and Divergence Detection.
 * 3. Commutative, Associative & Idempotent CRDT State Projection Convergence.
 * 4. LWW Profile/Post Reducers, PNCounters, and Epistemic Knowledge Graph Views.
 */

import { describe, it, expect } from 'vitest';
import {
  generateEd25519KeyPair,
  bytesToHex,
  hexToBytes,
  sha256,
  signEd25519,
} from '@sovra/crypto';
import { encodeEd25519DidKey } from '@sovra/identity';
import {
  SovraEvent,
  EventKind,
  VectorClock,
  MerkleStateDigestEngine,
  CRDTStateProjector,
} from '../src/index.js';

describe('Phase 3: VectorClock, MerkleStateDigest & CRDT State Projection', () => {
  function createTestIdentity(label: string) {
    const keyPair = generateEd25519KeyPair();
    const did = encodeEd25519DidKey(keyPair.publicKey);
    return {
      label,
      did,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      publicKeyHex: bytesToHex(keyPair.publicKey),
    };
  }

  function createSignedEvent(params: {
    author: { did: string; privateKey: Uint8Array; publicKeyHex: string };
    kind: EventKind;
    content: string;
    createdAt?: number;
    tags?: Array<[string, ...string[]]>;
  }): SovraEvent {
    const createdAt = params.createdAt ?? Math.floor(Date.now() / 1000);
    const tags = params.tags ?? [];
    const unsigned = JSON.stringify([
      0,
      params.author.publicKeyHex,
      createdAt,
      params.kind,
      tags,
      params.content,
    ]);
    const id = bytesToHex(sha256(new TextEncoder().encode(unsigned)));
    const sig = bytesToHex(signEd25519(hexToBytes(id), params.author.privateKey));

    return {
      id,
      pubkey: params.author.publicKeyHex,
      createdAt,
      kind: params.kind,
      tags,
      content: params.content,
      sig,
    };
  }

  // ==========================================
  // 1. VECTOR CLOCK
  // ==========================================
  describe('VectorClock Monotonicity & Causal Comparison', () => {
    it('accurately compares causal order across vector clocks', () => {
      const v1 = new VectorClock({ alice: 1, bob: 1 });
      const v2 = new VectorClock({ alice: 2, bob: 1 });
      const v3 = new VectorClock({ alice: 1, bob: 2 });
      const v4 = new VectorClock({ alice: 1, bob: 1 });

      // v1 vs v4 (IDENTICAL)
      expect(v1.compare(v4)).toBe('IDENTICAL');
      expect(v1.dominates(v4)).toBe(true);

      // v1 vs v2 (BEFORE)
      expect(v1.compare(v2)).toBe('BEFORE');
      expect(v2.compare(v1)).toBe('AFTER');
      expect(v2.dominates(v1)).toBe(true);
      expect(v1.dominates(v2)).toBe(false);

      // v2 vs v3 (CONCURRENT)
      expect(v2.compare(v3)).toBe('CONCURRENT');
      expect(v3.compare(v2)).toBe('CONCURRENT');
      expect(v2.dominates(v3)).toBe(false);
      expect(v3.dominates(v2)).toBe(false);
    });

    it('merges vector clocks taking component-wise maximum', () => {
      const vA = new VectorClock({ alice: 3, bob: 1, charlie: 4 });
      const vB = new VectorClock({ alice: 2, bob: 5, dana: 1 });

      const merged = vA.merge(vB);
      expect(merged.get('alice')).toBe(3);
      expect(merged.get('bob')).toBe(5);
      expect(merged.get('charlie')).toBe(4);
      expect(merged.get('dana')).toBe(1);

      expect(merged.dominates(vA)).toBe(true);
      expect(merged.dominates(vB)).toBe(true);
    });

    it('computes missing sequence ranges from remote vector clock', () => {
      const local = new VectorClock({ alice: 5, bob: 2 });
      const remote = new VectorClock({ alice: 5, bob: 6, charlie: 3 });

      const missing = local.computeMissingFromRemote(remote);
      expect(missing).toHaveLength(2);

      const bobMissing = missing.find((m) => m.actorId === 'bob');
      expect(bobMissing).toBeDefined();
      expect(bobMissing!.fromSeq).toBe(3);
      expect(bobMissing!.toSeq).toBe(6);

      const charlieMissing = missing.find((m) => m.actorId === 'charlie');
      expect(charlieMissing).toBeDefined();
      expect(charlieMissing!.fromSeq).toBe(1);
      expect(charlieMissing!.toSeq).toBe(3);
    });
  });

  // ==========================================
  // 2. MERKLE STATE DIGEST
  // ==========================================
  describe('MerkleStateDigestEngine Fast Equality & Divergence', () => {
    it('produces identical stateRootHex for identical event sets regardless of input order', () => {
      const alice = createTestIdentity('Alice');
      const bob = createTestIdentity('Bob');

      const e1 = createSignedEvent({ author: alice, kind: EventKind.ShortPost, content: 'Alice post 1', createdAt: 1000 });
      const e2 = createSignedEvent({ author: alice, kind: EventKind.ShortPost, content: 'Alice post 2', createdAt: 1010 });
      const e3 = createSignedEvent({ author: bob, kind: EventKind.ShortPost, content: 'Bob post 1', createdAt: 1005 });

      const digestA = MerkleStateDigestEngine.computeFromSovraEvents([e1, e2, e3]);
      const digestB = MerkleStateDigestEngine.computeFromSovraEvents([e3, e1, e2]);

      expect(digestA.stateRootHex).toBe(digestB.stateRootHex);
      expect(digestA.totalEvents).toBe(3);
      expect(Object.keys(digestA.authorBuckets)).toHaveLength(2);
      expect(MerkleStateDigestEngine.findDivergentAuthors(digestA, digestB)).toEqual([]);
    });

    it('identifies exact divergent author buckets when event sets differ', () => {
      const alice = createTestIdentity('Alice');
      const bob = createTestIdentity('Bob');
      const charlie = createTestIdentity('Charlie');

      const eA1 = createSignedEvent({ author: alice, kind: EventKind.ShortPost, content: 'Alice 1', createdAt: 1000 });
      const eB1 = createSignedEvent({ author: bob, kind: EventKind.ShortPost, content: 'Bob 1', createdAt: 1000 });
      const eC1 = createSignedEvent({ author: charlie, kind: EventKind.ShortPost, content: 'Charlie 1', createdAt: 1000 });

      // Set 1: Alice, Bob
      const digest1 = MerkleStateDigestEngine.computeFromSovraEvents([eA1, eB1]);
      // Set 2: Alice, Charlie
      const digest2 = MerkleStateDigestEngine.computeFromSovraEvents([eA1, eC1]);

      expect(digest1.stateRootHex).not.toBe(digest2.stateRootHex);
      const divergent = MerkleStateDigestEngine.findDivergentAuthors(digest1, digest2);

      // Alice is in sync. Bob and Charlie differ.
      expect(divergent).toContain(bob.publicKeyHex);
      expect(divergent).toContain(charlie.publicKeyHex);
      expect(divergent).not.toContain(alice.publicKeyHex);
    });
  });

  // ==========================================
  // 3. CRDT STATE PROJECTION & COMMUTATIVE CONVERGENCE
  // ==========================================
  describe('CRDT State Projector Deterministic Convergence', () => {
    it('converges to 100% identical state snapshot regardless of event application order', () => {
      const alice = createTestIdentity('Alice');
      const bob = createTestIdentity('Bob');

      // Create rich event sequence covering all entity types
      const events: SovraEvent[] = [];

      // 1. Alice Profile updates
      events.push(createSignedEvent({
        author: alice,
        kind: EventKind.Metadata,
        content: JSON.stringify({ displayName: 'Alice V1', bio: 'Bio initial' }),
        createdAt: 1000,
      }));
      events.push(createSignedEvent({
        author: alice,
        kind: EventKind.Metadata,
        content: JSON.stringify({ displayName: 'Alice Final', bio: 'Bio updated' }),
        createdAt: 1020,
      }));

      // 2. Post
      const postEvent = createSignedEvent({
        author: alice,
        kind: EventKind.ShortPost,
        content: 'Decentralized post content',
        createdAt: 1005,
      });
      events.push(postEvent);

      // 3. Reactions to Post (PNCounter)
      events.push(createSignedEvent({
        author: bob,
        kind: EventKind.Reaction,
        content: '+',
        tags: [['e', postEvent.id]],
        createdAt: 1010,
      }));
      events.push(createSignedEvent({
        author: alice,
        kind: EventKind.Reaction,
        content: '+',
        tags: [['e', postEvent.id]],
        createdAt: 1012,
      }));

      // 4. Knowledge Question
      const questionEvent = createSignedEvent({
        author: bob,
        kind: EventKind.Question,
        content: JSON.stringify({
          title: 'How does CRDT convergence work?',
          topics: ['distributed-systems', 'crdt'],
        }),
        createdAt: 1015,
      });
      events.push(questionEvent);

      // 5. Knowledge Claim
      const claimEvent = createSignedEvent({
        author: alice,
        kind: EventKind.Claim,
        content: JSON.stringify({
          thesis: 'LWW with SHA-256 tie-breaker is strictly deterministic.',
          domain: 'computer_science',
        }),
        createdAt: 1025,
      });
      events.push(claimEvent);

      // 6. Evidence for Claim
      events.push(createSignedEvent({
        author: bob,
        kind: EventKind.Evidence,
        content: JSON.stringify({
          targetClaimId: claimEvent.id,
          evidenceType: 'mathematical',
          summary: 'Total order proof under lexicographical string comparison.',
          reproducibilityScore: 1.0,
        }),
        createdAt: 1030,
      }));

      // Project through 3 projectors with shuffled orderings:
      // Projector 1: Natural order
      const proj1 = new CRDTStateProjector();
      proj1.applyBatch(events);

      // Projector 2: Reversed order
      const proj2 = new CRDTStateProjector();
      proj2.applyBatch([...events].reverse());

      // Projector 3: Pseudo-random permutation
      const permuted = [
        events[3]!, events[0]!, events[7]!, events[5]!, events[1]!,
        events[6]!, events[2]!, events[4]!,
      ];
      const proj3 = new CRDTStateProjector();
      proj3.applyBatch(permuted);

      // Snapshots
      const snap1 = proj1.snapshot();
      const snap2 = proj2.snapshot();
      const snap3 = proj3.snapshot();

      // Verify bit-for-bit identical stateHash
      expect(snap1.stateHash).toBe(snap2.stateHash);
      expect(snap2.stateHash).toBe(snap3.stateHash);

      // Verify projected views match exactly
      expect(snap1.profiles[alice.publicKeyHex]?.displayName).toBe('Alice Final');
      expect(snap1.counters[postEvent.id]?.total).toBe(2);
      expect(snap1.questions[questionEvent.id]?.title).toBe('How does CRDT convergence work?');
      expect(snap1.claims[claimEvent.id]?.evidenceCount).toBe(1);
    });

    it('enforces idempotency on duplicate event ingestion', () => {
      const alice = createTestIdentity('Alice');
      const proj = new CRDTStateProjector();

      const evt = createSignedEvent({
        author: alice,
        kind: EventKind.ShortPost,
        content: 'Idempotent post',
      });

      const applied1 = proj.applyEvent(evt);
      const applied2 = proj.applyEvent(evt);

      expect(applied1).toBe(true);
      expect(applied2).toBe(false);
      expect(proj.getAppliedCount()).toBe(1);
    });
  });
});
