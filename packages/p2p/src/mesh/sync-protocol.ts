/**
 * @file packages/p2p/src/mesh/sync-protocol.ts
 * Offline Data Synchronization Protocol for Sovra Mesh Network.
 *
 * Implements:
 * 1. Vector Clock & Timestamp Summaries between partitioned peers.
 * 2. Missing event set computation (bidirectional reconciliation).
 * 3. Deterministic Last-Write-Wins CRDT conflict resolution.
 * 4. PENDING_MODERATION offline status tagging for unmoderated peer content.
 * 5. Local filtering rules (banned pubkeys/keywords) applied in offline state.
 */

import { SovraEvent } from '@sovra/protocol';

export type OfflineModerationStatus = 'APPROVED' | 'PENDING_MODERATION' | 'FLAGGED';

export interface SynchronizedMeshEvent {
  readonly event: SovraEvent;
  readonly offlineModerationState: OfflineModerationStatus;
  readonly receivedOverTransport: 'ble' | 'tcp';
  readonly syncedAt: number;
}

export interface AuthorSyncCheckpoint {
  readonly authorPubkey: string;
  readonly latestCreatedAt: number;
  readonly eventCount: number;
}

export interface MeshSyncSummary {
  readonly authors: readonly AuthorSyncCheckpoint[];
  readonly recentEventIds: readonly string[];
  readonly generatedAt: number;
}

export interface MeshSyncRequest {
  readonly requestedEventIds: readonly string[];
  readonly sinceTimestamp?: number | undefined;
}

export interface MeshSyncResponse {
  readonly events: readonly SynchronizedMeshEvent[];
}

export interface ModerationPolicy {
  readonly blockedPubkeys: readonly string[];
  readonly forbiddenKeywords: readonly string[];
}

export class MeshSyncEngine {
  private readonly defaultPolicy: ModerationPolicy;

  constructor(policy?: Partial<ModerationPolicy>) {
    this.defaultPolicy = {
      blockedPubkeys: policy?.blockedPubkeys ?? [],
      forbiddenKeywords: policy?.forbiddenKeywords ?? [],
    };
  }

  /**
   * Generates a compact Sync Summary of local events to share with a newly connected peer.
   */
  public createSyncSummary(localEvents: readonly SovraEvent[], maxRecentIds = 100): MeshSyncSummary {
    const authorMap = new Map<string, { latestCreatedAt: number; count: number }>();

    for (const evt of localEvents) {
      const existing = authorMap.get(evt.pubkey);
      if (!existing) {
        authorMap.set(evt.pubkey, { latestCreatedAt: evt.createdAt, count: 1 });
      } else {
        authorMap.set(evt.pubkey, {
          latestCreatedAt: Math.max(existing.latestCreatedAt, evt.createdAt),
          count: existing.count + 1,
        });
      }
    }

    const authors: AuthorSyncCheckpoint[] = [];
    for (const [authorPubkey, stats] of authorMap.entries()) {
      authors.push({
        authorPubkey,
        latestCreatedAt: stats.latestCreatedAt,
        eventCount: stats.count,
      });
    }

    // Sort events by createdAt descending and take the most recent IDs
    const sorted = [...localEvents].sort((a, b) => b.createdAt - a.createdAt);
    const recentEventIds = sorted.slice(0, maxRecentIds).map(e => e.id);

    return {
      authors,
      recentEventIds,
      generatedAt: Date.now(),
    };
  }

  /**
   * Computes which event IDs this local node is missing compared to the peer's summary.
   */
  public computeMissingEventIds(
    peerSummary: MeshSyncSummary,
    localEvents: readonly SovraEvent[],
  ): string[] {
    const localIdSet = new Set(localEvents.map(e => e.id));
    const missing: string[] = [];

    for (const id of peerSummary.recentEventIds) {
      if (!localIdSet.has(id)) {
        missing.push(id);
      }
    }

    return missing;
  }

  /**
   * Computes which events from our local store can satisfy the peer's sync request.
   */
  public createSyncResponse(
    request: MeshSyncRequest,
    localEvents: readonly SovraEvent[],
    transport: 'ble' | 'tcp' = 'ble',
  ): MeshSyncResponse {
    const requestedSet = new Set(request.requestedEventIds);
    const matching: SynchronizedMeshEvent[] = [];
    const now = Date.now();

    for (const evt of localEvents) {
      const isRequested = requestedSet.has(evt.id);
      const isSinceTime = request.sinceTimestamp !== undefined && evt.createdAt >= request.sinceTimestamp;

      if (isRequested || isSinceTime) {
        const moderationState = this.evaluateOfflineModeration(evt);
        matching.push({
          event: evt,
          offlineModerationState: moderationState,
          receivedOverTransport: transport,
          syncedAt: now,
        });
      }
    }

    return { events: matching };
  }

  /**
   * Evaluates offline moderation rules for an incoming event.
   * If author is blocked -> FLAGGED.
   * If prohibited content detected -> FLAGGED.
   * Otherwise -> PENDING_MODERATION (until online verification).
   */
  public evaluateOfflineModeration(
    event: SovraEvent,
    policy?: Partial<ModerationPolicy>,
  ): OfflineModerationStatus {
    const effectiveBlocked = policy?.blockedPubkeys ?? this.defaultPolicy.blockedPubkeys;
    const effectiveKeywords = policy?.forbiddenKeywords ?? this.defaultPolicy.forbiddenKeywords;

    // Check author pubkey blocklist
    if (effectiveBlocked.includes(event.pubkey)) {
      return 'FLAGGED';
    }

    // Check forbidden content keywords
    if (typeof event.content === 'string') {
      const lower = event.content.toLowerCase();
      for (const kw of effectiveKeywords) {
        if (lower.includes(kw.toLowerCase())) {
          return 'FLAGGED';
        }
      }
    }

    // Unmoderated peer content received offline defaults to PENDING_MODERATION
    return 'PENDING_MODERATION';
  }

  /**
   * Deterministic CRDT Conflict Resolution (Last-Write-Wins with ID tie-breaking).
   */
  public resolveEventConflict(eventA: SovraEvent, eventB: SovraEvent): SovraEvent {
    if (eventA.id === eventB.id) {
      return eventA;
    }

    if (eventA.createdAt > eventB.createdAt) {
      return eventA;
    }
    if (eventB.createdAt > eventA.createdAt) {
      return eventB;
    }

    // Deterministic tie-breaker: lexicographical comparison of SHA-256 IDs
    return eventA.id.localeCompare(eventB.id) < 0 ? eventA : eventB;
  }
}

// ==========================================
// PENDING DEPENDENCY BUFFER (OUT-OF-ORDER CAUSAL RESEQUENCING)
// ==========================================

export interface DependencyBufferConfig {
  readonly maxBufferSize?: number | undefined;
  readonly ttlMs?: number | undefined;
}

export interface BufferedEventRecord<T> {
  readonly event: T;
  readonly unmetDependencies: Set<string>;
  readonly bufferedAt: number;
}

/**
 * Utility to extract dependent event IDs from a SovraEvent tags (e.g. ['e', targetId]).
 */
export function extractEventDependencies(event: SovraEvent): string[] {
  const deps: string[] = [];
  if (Array.isArray(event.tags)) {
    for (const tag of event.tags) {
      if (Array.isArray(tag) && tag[0] === 'e' && typeof tag[1] === 'string' && tag[1].length > 0) {
        deps.push(tag[1]);
      }
    }
  }
  return deps;
}

export class PendingDependencyBuffer<T extends { id: string } = { id: string }> {
  private readonly maxBufferSize: number;
  private readonly ttlMs: number;

  // Stored pending events keyed by eventId
  private pending = new Map<string, BufferedEventRecord<T>>();

  // Inverted index: missingDependencyId -> Set<dependentEventId>
  private dependencyWaitingIndex = new Map<string, Set<string>>();

  // Known committed event IDs
  private committedEventIds = new Set<string>();

  constructor(config?: DependencyBufferConfig) {
    this.maxBufferSize = config?.maxBufferSize ?? 5000;
    this.ttlMs = config?.ttlMs ?? 86_400_000; // 24 hours
  }

  /**
   * Registers an event ID as already committed to local state/store.
   */
  public markCommitted(eventId: string): void {
    this.committedEventIds.add(eventId);
    // If committed, remove from pending if present
    this.pending.delete(eventId);
  }

  /**
   * Checks whether an event ID has already been marked as committed.
   */
  public isCommitted(eventId: string): boolean {
    return this.committedEventIds.has(eventId);
  }

  /**
   * Checks if an event is currently held in the dependency buffer.
   */
  public isPending(eventId: string): boolean {
    return this.pending.has(eventId);
  }

  public getPendingCount(): number {
    return this.pending.size;
  }

  public getPendingEventIds(): string[] {
    return Array.from(this.pending.keys());
  }

  /**
   * Inspects dependencies for an event. If all dependencies are already committed,
   * returns false (not buffered, can be applied immediately).
   * Otherwise, buffers the event and returns true.
   */
  public bufferIfMissingDependencies(event: T, dependencyIds: readonly string[]): boolean {
    if (this.committedEventIds.has(event.id)) {
      return false; // Already committed
    }

    const unmet = new Set<string>();
    for (const depId of dependencyIds) {
      if (!this.committedEventIds.has(depId)) {
        unmet.add(depId);
      }
    }

    if (unmet.size === 0) {
      // All dependencies satisfied!
      return false;
    }

    // Buffer capacity enforcement
    if (this.pending.size >= this.maxBufferSize) {
      this.evictOldest();
    }

    const record: BufferedEventRecord<T> = {
      event,
      unmetDependencies: unmet,
      bufferedAt: Date.now(),
    };

    this.pending.set(event.id, record);

    for (const depId of unmet) {
      let waiting = this.dependencyWaitingIndex.get(depId);
      if (!waiting) {
        waiting = new Set();
        this.dependencyWaitingIndex.set(depId, waiting);
      }
      waiting.add(event.id);
    }

    return true;
  }

  /**
   * Notifies the buffer that a prerequisite event has been committed.
   * Resolves and returns all unblocked dependent events in topological causal order.
   */
  public resolveDependencies(committedEventId: string): T[] {
    this.markCommitted(committedEventId);

    const readyEvents: T[] = [];
    const queue = [committedEventId];
    const visitedInPass = new Set<string>();

    while (queue.length > 0) {
      const currentResolvedId = queue.shift()!;
      if (visitedInPass.has(currentResolvedId)) continue;
      visitedInPass.add(currentResolvedId);

      const waitingDependentIds = this.dependencyWaitingIndex.get(currentResolvedId);
      if (!waitingDependentIds) continue;

      this.dependencyWaitingIndex.delete(currentResolvedId);

      for (const dependentId of waitingDependentIds) {
        const record = this.pending.get(dependentId);
        if (!record) continue;

        record.unmetDependencies.delete(currentResolvedId);

        if (record.unmetDependencies.size === 0) {
          // All dependencies are now resolved for this event!
          this.pending.delete(dependentId);
          this.committedEventIds.add(dependentId);
          readyEvents.push(record.event);
          queue.push(dependentId); // Cascade to any events waiting on this one
        }
      }
    }

    return readyEvents;
  }

  /**
   * Purges expired entries older than ttlMs.
   */
  public purgeExpired(now = Date.now()): string[] {
    const expiredIds: string[] = [];
    for (const [id, record] of this.pending.entries()) {
      if (now - record.bufferedAt >= this.ttlMs) {
        expiredIds.push(id);
      }
    }

    for (const id of expiredIds) {
      this.pending.delete(id);
      for (const [depId, set] of this.dependencyWaitingIndex.entries()) {
        set.delete(id);
        if (set.size === 0) this.dependencyWaitingIndex.delete(depId);
      }
    }

    return expiredIds;
  }

  private evictOldest(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, record] of this.pending.entries()) {
      if (record.bufferedAt < oldestTime) {
        oldestTime = record.bufferedAt;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.pending.delete(oldestId);
      for (const [depId, set] of this.dependencyWaitingIndex.entries()) {
        set.delete(oldestId);
        if (set.size === 0) this.dependencyWaitingIndex.delete(depId);
      }
    }
  }

  public clear(): void {
    this.pending.clear();
    this.dependencyWaitingIndex.clear();
    this.committedEventIds.clear();
  }
}
