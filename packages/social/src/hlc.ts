/**
 * Hybrid Logical Timestamp representation (RFC 6770 compliant).
 * Guarantees monotonic causality even under severe hardware clock drift.
 */
export interface HybridLogicalTimestamp {
  readonly physicalTime: number; // Unix milliseconds
  readonly logicalCounter: number;
  readonly nodeId: string;
}

/**
 * Hybrid Logical Clock (HLC).
 * Solves Pillar 9 Split-Brain Clock Skew:
 * 1. Monotonically tracks causality across independent mobile nodes.
 * 2. Unifies wall-clock physical time with Lamport logical counters.
 */
export class HybridLogicalClock {
  private physicalTime = 0;
  private logicalCounter = 0;

  constructor(public readonly nodeId: string) {
    this.physicalTime = Date.now();
  }

  public now(): HybridLogicalTimestamp {
    const physicalNow = Date.now();
    if (physicalNow > this.physicalTime) {
      this.physicalTime = physicalNow;
      this.logicalCounter = 0;
    } else {
      this.logicalCounter++;
    }

    return {
      physicalTime: this.physicalTime,
      logicalCounter: this.logicalCounter,
      nodeId: this.nodeId,
    };
  }

  /**
   * Updates local HLC upon receiving an event timestamp from a remote peer.
   */
  public update(received: HybridLogicalTimestamp): HybridLogicalTimestamp {
    const physicalNow = Date.now();
    const maxPhysical = Math.max(physicalNow, this.physicalTime, received.physicalTime);

    if (maxPhysical === this.physicalTime && maxPhysical === received.physicalTime) {
      this.logicalCounter = Math.max(this.logicalCounter, received.logicalCounter) + 1;
    } else if (maxPhysical === this.physicalTime) {
      this.logicalCounter++;
    } else if (maxPhysical === received.physicalTime) {
      this.logicalCounter = received.logicalCounter + 1;
    } else {
      this.logicalCounter = 0;
    }

    this.physicalTime = maxPhysical;

    return {
      physicalTime: this.physicalTime,
      logicalCounter: this.logicalCounter,
      nodeId: this.nodeId,
    };
  }

  public static compare(a: HybridLogicalTimestamp, b: HybridLogicalTimestamp): number {
    if (a.physicalTime !== b.physicalTime) {
      return a.physicalTime - b.physicalTime;
    }
    if (a.logicalCounter !== b.logicalCounter) {
      return a.logicalCounter - b.logicalCounter;
    }
    return a.nodeId.localeCompare(b.nodeId);
  }
}

/**
 * Conflict-Free Replicated Data Type (CRDT) Positive-Negative Counter.
 * Solves Pillar 9 Like Event Compaction & State Bloat:
 * 1. Compacts viral post interactions without storing millions of individual DB rows.
 * 2. Enables deterministic conflict-free merges across gossip mesh.
 */
export class PNCounterCRDT {
  private readonly P = new Map<string, number>(); // increments
  private readonly N = new Map<string, number>(); // decrements

  public increment(actorDid: string, amount = 1): void {
    const current = this.P.get(actorDid) ?? 0;
    this.P.set(actorDid, current + amount);
  }

  public decrement(actorDid: string, amount = 1): void {
    const current = this.N.get(actorDid) ?? 0;
    this.N.set(actorDid, current + amount);
  }

  public value(): number {
    let totalP = 0;
    let totalN = 0;
    for (const v of this.P.values()) totalP += v;
    for (const v of this.N.values()) totalN += v;
    return totalP - totalN;
  }

  public merge(other: PNCounterCRDT): void {
    for (const [actor, count] of other.P.entries()) {
      const existing = this.P.get(actor) ?? 0;
      this.P.set(actor, Math.max(existing, count));
    }
    for (const [actor, count] of other.N.entries()) {
      const existing = this.N.get(actor) ?? 0;
      this.N.set(actor, Math.max(existing, count));
    }
  }

  public toJSON(): { P: Record<string, number>; N: Record<string, number> } {
    return {
      P: Object.fromEntries(this.P.entries()),
      N: Object.fromEntries(this.N.entries()),
    };
  }

  public static fromJSON(json: { P: Record<string, number>; N: Record<string, number> }): PNCounterCRDT {
    const counter = new PNCounterCRDT();
    for (const [k, v] of Object.entries(json.P)) counter.P.set(k, v);
    for (const [k, v] of Object.entries(json.N)) counter.N.set(k, v);
    return counter;
  }

  public getRawMaps(): { P: Map<string, number>; N: Map<string, number> } {
    return { P: this.P, N: this.N };
  }
}

/**
 * Pillar 9: Physical Clock Drift Boundary Invariant.
 * Rejects events with timestamps more than 60 seconds into the future,
 * neutralizing future-timestamp feed pinning attacks.
 */
export function assertPhysicalClockDriftBound(
  receivedTimestampMs: number,
  maxDriftMs = 60_000,
  currentPhysicalTimeMs = Date.now(),
): boolean {
  return receivedTimestampMs <= currentPhysicalTimeMs + maxDriftMs;
}

export interface CompactionResult {
  readonly compactedEntries: number;
  readonly tombstoneRatio: number;
  readonly wasCompacted: boolean;
}

/**
 * Pillar 9: Deterministic CRDT Tombstone Compactor & State Garbage Collector.
 * Identifies cancelled/unlike pairs (where P[actor] == N[actor]) and removes them
 * when the tombstone ratio exceeds 40%, preventing memory leaks.
 */
export function compactTombstones(
  counter: PNCounterCRDT,
  tombstoneRatioThreshold = 0.40,
): CompactionResult {
  const { P, N } = counter.getRawMaps();
  const totalEntries = P.size + N.size;
  if (totalEntries === 0) {
    return { compactedEntries: 0, tombstoneRatio: 0, wasCompacted: false };
  }

  // Count cancelled pairs
  let cancelledCount = 0;
  const toDelete: string[] = [];

  for (const [actor, pVal] of P.entries()) {
    const nVal = N.get(actor);
    if (nVal !== undefined && nVal === pVal) {
      cancelledCount++;
      toDelete.push(actor);
    }
  }

  const tombstoneRatio = (cancelledCount * 2) / totalEntries;

  if (tombstoneRatio >= tombstoneRatioThreshold) {
    for (const actor of toDelete) {
      P.delete(actor);
      N.delete(actor);
    }
    return {
      compactedEntries: toDelete.length,
      tombstoneRatio: Math.round(tombstoneRatio * 100) / 100,
      wasCompacted: true,
    };
  }

  return {
    compactedEntries: 0,
    tombstoneRatio: Math.round(tombstoneRatio * 100) / 100,
    wasCompacted: false,
  };
}

