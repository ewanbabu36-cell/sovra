/**
 * @file packages/protocol/src/vector-clock.ts
 * Vector Clock & Merkle State Digest Engine for Sovra Distributed State Sync.
 *
 * Implements:
 * 1. Actor-Indexed Monotonic Vector Clocks with causal order comparison:
 *    BEFORE, AFTER, CONCURRENT, IDENTICAL.
 * 2. Deterministic Vector Clock Merge and Dominance testing.
 * 3. Compact Merkle State Digest for zero-bandwidth equality checks.
 * 4. Incremental delta computation between remote vector clocks.
 */

import { sha256, bytesToHex } from '@sovra/crypto';
import { SovraProtocolEvent } from './protocol-event.js';
import { SovraEvent } from './events.js';

export type CausalOrder = 'IDENTICAL' | 'BEFORE' | 'AFTER' | 'CONCURRENT';

export interface AuthorBucketDigest {
  readonly count: number;
  readonly maxSequence: number;
  readonly bucketHash: string;
}

export interface MerkleStateDigest {
  readonly totalEvents: number;
  readonly stateRootHex: string;
  readonly authorBuckets: Readonly<Record<string, AuthorBucketDigest>>;
  readonly timestamp: number;
}

export class VectorClock {
  private readonly clocks: Map<string, number>;

  constructor(initialClocks?: Readonly<Record<string, number>> | Map<string, number>) {
    this.clocks = new Map();
    if (initialClocks) {
      if (initialClocks instanceof Map) {
        for (const [k, v] of initialClocks.entries()) {
          this.clocks.set(k, v);
        }
      } else {
        for (const [k, v] of Object.entries(initialClocks)) {
          this.clocks.set(k, v);
        }
      }
    }
  }

  public get(actorId: string): number {
    return this.clocks.get(actorId) ?? 0;
  }

  public set(actorId: string, sequence: number): void {
    this.clocks.set(actorId, sequence);
  }

  public increment(actorId: string): number {
    const next = (this.clocks.get(actorId) ?? 0) + 1;
    this.clocks.set(actorId, next);
    return next;
  }

  public size(): number {
    return this.clocks.size;
  }

  public actors(): string[] {
    return Array.from(this.clocks.keys()).sort();
  }

  public clone(): VectorClock {
    return new VectorClock(this.clocks);
  }

  /**
   * Merges another VectorClock into a new instance, taking the component-wise maximum.
   */
  public merge(other: VectorClock): VectorClock {
    const merged = new VectorClock(this.clocks);
    for (const [actor, seq] of other.clocks.entries()) {
      const current = merged.get(actor);
      if (seq > current) {
        merged.set(actor, seq);
      }
    }
    return merged;
  }

  /**
   * Compares causality with another VectorClock.
   * Returns:
   * - IDENTICAL: both have identical components.
   * - BEFORE: this <= other for all components, and this < other for at least one.
   * - AFTER: this >= other for all components, and this > other for at least one.
   * - CONCURRENT: some components are greater, some are smaller.
   */
  public compare(other: VectorClock): CausalOrder {
    const allActors = new Set<string>([...this.clocks.keys(), ...other.clocks.keys()]);
    let hasGreater = false;
    let hasLesser = false;

    for (const actor of allActors) {
      const v1 = this.get(actor);
      const v2 = other.get(actor);

      if (v1 > v2) {
        hasGreater = true;
      } else if (v1 < v2) {
        hasLesser = true;
      }

      if (hasGreater && hasLesser) {
        return 'CONCURRENT';
      }
    }

    if (!hasGreater && !hasLesser) {
      return 'IDENTICAL';
    }
    if (hasGreater && !hasLesser) {
      return 'AFTER';
    }
    return 'BEFORE';
  }

  /**
   * Checks if this VectorClock strictly dominates or is equal to other.
   */
  public dominates(other: VectorClock): boolean {
    const order = this.compare(other);
    return order === 'AFTER' || order === 'IDENTICAL';
  }

  /**
   * Computes which authors and sequences this node is missing compared to a remote clock.
   */
  public computeMissingFromRemote(remoteClock: VectorClock): Array<{ actorId: string; fromSeq: number; toSeq: number }> {
    const missingRanges: Array<{ actorId: string; fromSeq: number; toSeq: number }> = [];

    for (const actor of remoteClock.actors()) {
      const remoteSeq = remoteClock.get(actor);
      const localSeq = this.get(actor);

      if (remoteSeq > localSeq) {
        missingRanges.push({
          actorId: actor,
          fromSeq: localSeq + 1,
          toSeq: remoteSeq,
        });
      }
    }

    return missingRanges;
  }

  public toJSON(): Record<string, number> {
    const obj: Record<string, number> = {};
    const sortedActors = Array.from(this.clocks.keys()).sort();
    for (const a of sortedActors) {
      obj[a] = this.clocks.get(a)!;
    }
    return obj;
  }

  public static fromJSON(record: Record<string, number>): VectorClock {
    return new VectorClock(record);
  }
}

// ==========================================
// MERKLE STATE DIGEST GENERATION
// ==========================================

export class MerkleStateDigestEngine {
  /**
   * Generates a deterministic MerkleStateDigest from canonical protocol events.
   */
  public static computeFromProtocolEvents(
    events: readonly SovraProtocolEvent[],
    now = Date.now(),
  ): MerkleStateDigest {
    if (events.length === 0) {
      return {
        totalEvents: 0,
        stateRootHex: bytesToHex(sha256(new Uint8Array(0))),
        authorBuckets: {},
        timestamp: now,
      };
    }

    // Group events by author DID
    const authorMap = new Map<string, SovraProtocolEvent[]>();
    for (const evt of events) {
      const list = authorMap.get(evt.author.did);
      if (!list) {
        authorMap.set(evt.author.did, [evt]);
      } else {
        list.push(evt);
      }
    }

    const authorBuckets: Record<string, AuthorBucketDigest> = {};
    const sortedAuthors = Array.from(authorMap.keys()).sort();
    const bucketHashes: string[] = [];

    for (const author of sortedAuthors) {
      const authorEvents = authorMap.get(author)!;
      // Sort deterministically by logical clock sequence, then eventId
      authorEvents.sort((a, b) => {
        if (a.logicalClock.sequence !== b.logicalClock.sequence) {
          return a.logicalClock.sequence - b.logicalClock.sequence;
        }
        return a.eventId.localeCompare(b.eventId);
      });

      const maxSequence = Math.max(...authorEvents.map((e) => e.logicalClock.sequence));
      const eventIdsCombined = authorEvents.map((e) => e.eventId).join(':');
      const bucketHash = bytesToHex(sha256(new TextEncoder().encode(eventIdsCombined)));

      authorBuckets[author] = {
        count: authorEvents.length,
        maxSequence,
        bucketHash,
      };

      bucketHashes.push(`${author}:${bucketHash}`);
    }

    // Root hash is SHA-256 of concatenated sorted author bucket hashes
    const rootPayload = bucketHashes.join('|');
    const stateRootHex = bytesToHex(sha256(new TextEncoder().encode(rootPayload)));

    return {
      totalEvents: events.length,
      stateRootHex,
      authorBuckets,
      timestamp: now,
    };
  }

  /**
   * Generates a deterministic MerkleStateDigest from standard SovraEvents.
   */
  public static computeFromSovraEvents(
    events: readonly SovraEvent[],
    now = Date.now(),
  ): MerkleStateDigest {
    if (events.length === 0) {
      return {
        totalEvents: 0,
        stateRootHex: bytesToHex(sha256(new Uint8Array(0))),
        authorBuckets: {},
        timestamp: now,
      };
    }

    const authorMap = new Map<string, SovraEvent[]>();
    for (const evt of events) {
      const list = authorMap.get(evt.pubkey);
      if (!list) {
        authorMap.set(evt.pubkey, [evt]);
      } else {
        list.push(evt);
      }
    }

    const authorBuckets: Record<string, AuthorBucketDigest> = {};
    const sortedAuthors = Array.from(authorMap.keys()).sort();
    const bucketHashes: string[] = [];

    for (const author of sortedAuthors) {
      const authorEvents = authorMap.get(author)!;
      authorEvents.sort((a, b) => {
        if (a.createdAt !== b.createdAt) {
          return a.createdAt - b.createdAt;
        }
        return a.id.localeCompare(b.id);
      });

      const maxSequence = Math.max(...authorEvents.map((e) => e.createdAt));
      const eventIdsCombined = authorEvents.map((e) => e.id).join(':');
      const bucketHash = bytesToHex(sha256(new TextEncoder().encode(eventIdsCombined)));

      authorBuckets[author] = {
        count: authorEvents.length,
        maxSequence,
        bucketHash,
      };

      bucketHashes.push(`${author}:${bucketHash}`);
    }

    const rootPayload = bucketHashes.join('|');
    const stateRootHex = bytesToHex(sha256(new TextEncoder().encode(rootPayload)));

    return {
      totalEvents: events.length,
      stateRootHex,
      authorBuckets,
      timestamp: now,
    };
  }

  /**
   * Compares two digests and returns the author keys whose buckets mismatch.
   */
  public static findDivergentAuthors(
    localDigest: MerkleStateDigest,
    remoteDigest: MerkleStateDigest,
  ): string[] {
    if (localDigest.stateRootHex === remoteDigest.stateRootHex) {
      return []; // Exactly identical, 0 diffs
    }

    const allAuthors = new Set<string>([
      ...Object.keys(localDigest.authorBuckets),
      ...Object.keys(remoteDigest.authorBuckets),
    ]);

    const divergent: string[] = [];
    for (const author of allAuthors) {
      const local = localDigest.authorBuckets[author];
      const remote = remoteDigest.authorBuckets[author];

      if (!local || !remote || local.bucketHash !== remote.bucketHash) {
        divergent.push(author);
      }
    }

    return divergent.sort();
  }
}
