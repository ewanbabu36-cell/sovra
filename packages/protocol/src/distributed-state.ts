/**
 * @file packages/protocol/src/distributed-state.ts
 * Authoritative Canonical Distributed State Engine for Sovra Protocol (Phase 3).
 *
 * Implements:
 * 1. Event-Sourced Deterministic State Machine: State = Projection(ValidatedEventHistory)
 * 2. Unified Event Model using Canonical SovraProtocolEvent.
 * 3. Causal Ordering with Deterministic Dependency Buffering & Cycle Defense.
 * 4. Deterministic Conflict Resolution (LWW, OR-Set, PN-Counter, Tombstones, Edit History).
 * 5. Deterministic State Snapshotting & Frontier Merkle State Hashing.
 * 6. Local-First Write & Query APIs independent of any central server or dev-server.
 */

import { Result, ok, err } from '@sovra/shared';
import { sha256, bytesToHex } from '@sovra/crypto';
import {
  SovraProtocolEvent,
  canonicalizeUnsignedProtocolEvent,
} from './protocol-event.js';
import { DurableEventStore } from './store.js';
import { EventValidationPipeline } from './pipeline.js';
import { canonicalizeJson } from './serialization.js';
import {
  ProtocolError,
  InvalidEventError,
  StorageFailureError,
  UnauthorizedOperationError,
} from './errors.js';

// ==========================================
// 1. CANONICAL DOMAIN STATE INTERFACES
// ==========================================

export interface CanonicalProfile {
  readonly did: string;
  readonly displayName: string;
  readonly bio: string;
  readonly avatarCid?: string | undefined;
  readonly updatedAt: number;
  readonly lamport: number;
  readonly lastEventId: string;
  readonly editHistory: readonly {
    readonly eventId: string;
    readonly updatedAt: number;
    readonly lamport: number;
    readonly displayName: string;
    readonly bio: string;
  }[];
}

export interface CanonicalPost {
  readonly id: string;
  readonly authorDid: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly mediaCids: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lamport: number;
  readonly isDeleted: boolean;
  readonly tombstoneAt?: number | undefined;
  readonly tombstoneLamport?: number | undefined;
  readonly editHistory: readonly {
    readonly eventId: string;
    readonly content: string;
    readonly updatedAt: number;
    readonly lamport: number;
  }[];
}

export interface CanonicalComment {
  readonly id: string;
  readonly targetObjectId: string;
  readonly authorDid: string;
  readonly content: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lamport: number;
  readonly isDeleted: boolean;
  readonly tombstoneAt?: number | undefined;
}

export interface CanonicalPNCounter {
  readonly targetObjectId: string;
  readonly increments: Readonly<Record<string, number>>; // actorDid -> count
  readonly decrements: Readonly<Record<string, number>>; // actorDid -> count
  readonly total: number;
}

export type FriendshipStatus =
  | 'NONE'
  | 'REQUEST_SENT'
  | 'REQUEST_RECEIVED'
  | 'ACCEPTED'
  | 'REMOVED';

export interface CanonicalRelationshipState {
  readonly sourceDid: string;
  readonly targetDid: string;
  readonly isFollowing: boolean;
  readonly isBlocked: boolean;
  readonly isMuted: boolean;
  readonly friendStatus: FriendshipStatus;
  readonly updatedAt: number;
  readonly lamport: number;
  readonly lastEventId: string;
}

export interface CanonicalCommunity {
  readonly id: string;
  readonly name: string;
  readonly creatorDid: string;
  readonly members: Readonly<Record<string, { role: 'ADMIN' | 'MODERATOR' | 'MEMBER'; joinedAt: number; lamport: number }>>;
  readonly isDeleted: boolean;
}

export interface CanonicalClaim {
  readonly id: string;
  readonly authorDid: string;
  readonly thesis: string;
  readonly domain: string;
  readonly createdAt: number;
  readonly lamport: number;
  readonly evidenceCount: number;
  readonly counterargumentCount: number;
  readonly consensusStatus: string;
  readonly synthesisSummary?: string | undefined;
}

export interface CanonicalQuestion {
  readonly id: string;
  readonly authorDid: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly topics: readonly string[];
  readonly createdAt: number;
  readonly lamport: number;
  readonly answerCount: number;
}

export interface SerializedCanonicalState {
  readonly profiles: Record<string, CanonicalProfile>;
  readonly posts: Record<string, CanonicalPost>;
  readonly comments: Record<string, CanonicalComment>;
  readonly counters: Record<string, CanonicalPNCounter>;
  readonly relationships: Record<string, CanonicalRelationshipState>;
  readonly communities: Record<string, CanonicalCommunity>;
  readonly claims: Record<string, CanonicalClaim>;
  readonly questions: Record<string, CanonicalQuestion>;
}

export interface EventFrontier {
  readonly vectorClock: Record<string, number>; // authorDid -> max sequence
  readonly eventCount: number;
  readonly stateHash: string;
}

export interface DeterministicStateSnapshot {
  readonly snapshotVersion: 1;
  readonly timestamp: number;
  readonly frontier: EventFrontier;
  readonly state: SerializedCanonicalState;
  readonly stateHash: string;
}

export interface DistributedStateEngineOptions {
  readonly store?: DurableEventStore | undefined;
  readonly pipeline?: EventValidationPipeline | undefined;
  readonly maxPendingBuffer?: number | undefined;
  readonly maxDependencyDepth?: number | undefined;
  readonly maxEventSizeBytes?: number | undefined;
  readonly allowHistoricalReplay?: boolean | undefined;
}

// ==========================================
// 2. THE DISTRIBUTED STATE ENGINE
// ==========================================

export class DistributedStateEngine {
  public readonly store: DurableEventStore;
  private readonly pipeline: EventValidationPipeline;
  private readonly maxPendingBuffer: number;
  private readonly maxDependencyDepth: number;
  private readonly maxEventSizeBytes: number;
  private readonly allowHistoricalReplay: boolean;

  // In-memory canonical projection tables
  private readonly profiles = new Map<string, CanonicalProfile>();
  private readonly posts = new Map<string, CanonicalPost>();
  private readonly comments = new Map<string, CanonicalComment>();
  private readonly counters = new Map<string, { P: Map<string, number>; N: Map<string, number> }>();
  private readonly relationships = new Map<string, CanonicalRelationshipState>();
  private readonly communities = new Map<string, CanonicalCommunity>();
  private readonly claims = new Map<string, CanonicalClaim>();
  private readonly questions = new Map<string, CanonicalQuestion>();

  // Inverted relation sets
  private readonly claimEvidences = new Map<string, Set<string>>();
  private readonly claimCounterarguments = new Map<string, Set<string>>();
  private readonly questionAnswers = new Map<string, Set<string>>();
  private readonly claimSyntheses = new Map<
    string,
    { consensusStatus: string; synthesisSummary: string; lamport: number; createdAt: number; authorDid: string; eventId: string }
  >();
  private readonly communityMembers = new Map<
    string,
    Map<string, { role: 'ADMIN' | 'MODERATOR' | 'MEMBER'; joinedAt: number; lamport: number }>
  >();
  private readonly relationshipAspects = new Map<
    string,
    {
      follow: { value: boolean; lamport: number; updatedAt: number; eventId: string };
      block: { value: boolean; lamport: number; updatedAt: number; eventId: string };
      mute: { value: boolean; lamport: number; updatedAt: number; eventId: string };
      friend: { status: FriendshipStatus; lamport: number; updatedAt: number; eventId: string };
    }
  >();

  // Applied event tracking & frontier clock
  private readonly appliedEventIds = new Set<string>();
  private readonly frontierVectorClock = new Map<string, number>();

  // Causal ordering: dependency buffer (parentId -> Set of waiting events)
  private readonly pendingByParent = new Map<string, Map<string, SovraProtocolEvent>>();
  private readonly pendingEventIds = new Set<string>();
  private readonly pendingEventsById = new Map<string, SovraProtocolEvent>();

  // Diagnostics & Observability
  private conflictsDetectedCount = 0;
  private snapshotsCreatedCount = 0;
  private lastAppliedEventId?: string | undefined;

  constructor(options?: DistributedStateEngineOptions) {
    this.store = options?.store ?? new DurableEventStore();
    this.pipeline = options?.pipeline ?? new EventValidationPipeline();
    this.maxPendingBuffer = options?.maxPendingBuffer ?? 5000;
    this.maxDependencyDepth = options?.maxDependencyDepth ?? 32;
    this.maxEventSizeBytes = options?.maxEventSizeBytes ?? 1024 * 1024; // 1 MB
    this.allowHistoricalReplay = options?.allowHistoricalReplay ?? true;
  }

  // ==========================================
  // EVENT INGESTION & PIPELINE APPLICATION
  // ==========================================

  /**
   * Primary entrypoint: validates, checks causal dependencies,
   * buffers if parents missing, and applies transition to state.
   */
  public async ingestEvent(
    eventCandidate: unknown,
    nowSeconds?: number,
  ): Promise<Result<{ applied: boolean; buffered: boolean; eventId: string }, ProtocolError>> {
    // Stage 0: Early Idempotency & Duplicate Integrity Check
    const rawCandidate = eventCandidate as any;
    const candidateId = rawCandidate?.eventId;
    if (typeof candidateId === 'string' && this.appliedEventIds.has(candidateId)) {
      const existing = await this.store.get(candidateId);
      if (existing) {
        const cExisting = canonicalizeJson(existing);
        const cNew = canonicalizeJson(rawCandidate);
        if (cExisting !== cNew) {
          return err(
            new StorageFailureError(
              `Integrity violation: duplicate event ID ${candidateId} contains conflicting payload`,
            ),
          );
        }
      }
      return ok({ applied: false, buffered: false, eventId: candidateId });
    }

    const effectiveNow =
      nowSeconds !== undefined
        ? nowSeconds
        : this.allowHistoricalReplay && typeof (eventCandidate as any)?.createdAt === 'number'
          ? (eventCandidate as any).createdAt
          : Math.floor(Date.now() / 1000);

    // Stage 1-11 Unified Pipeline Validation
    const validation = await this.pipeline.validate(eventCandidate, effectiveNow);
    if (!validation.isValid || !validation.event) {
      return err(
        new InvalidEventError(
          `Event validation failed (${validation.decision}): ${validation.error}`,
          { decision: validation.decision },
        ),
      );
    }

    const event = validation.event;

    // Resource Limit: event size check
    const serializedSize = canonicalizeUnsignedProtocolEvent(event).length;
    if (serializedSize > this.maxEventSizeBytes) {
      return err(
        new InvalidEventError(
          `Resource limit exceeded: event size ${serializedSize} exceeds max ${this.maxEventSizeBytes} bytes`,
        ),
      );
    }

    // Idempotency: if already applied, return immediately
    if (this.appliedEventIds.has(event.eventId)) {
      return ok({ applied: false, buffered: false, eventId: event.eventId });
    }

    // Fail-closed authorization and semantic precondition verification
    const precondRes = this.validateStatePreconditions(event);
    if (!precondRes.ok) {
      return precondRes;
    }

    // Persist to durable append-only event store
    const storeRes = await this.store.append(event);
    if (!storeRes.ok) {
      return storeRes;
    }

    // Check causal dependencies (parents)
    const missingParents = this.findMissingDependencies(event);

    if (missingParents.length > 0) {
      // Buffer event until dependencies arrive
      const bufferRes = this.bufferPendingEvent(event, missingParents);
      if (!bufferRes.ok) {
        return bufferRes;
      }
      return ok({ applied: false, buffered: true, eventId: event.eventId });
    }

    // Dependencies satisfied: apply state transition
    this.applyEventDirect(event);

    // Recursively resolve any downstream events waiting on this event
    this.resolvePendingDependents(event.eventId);

    return ok({ applied: true, buffered: false, eventId: event.eventId });
  }

  /**
   * Ingests a batch of events (e.g. from network sync, partition recovery, or snapshot replay).
   * Automatically resolves dependencies and out-of-order deliveries.
   */
  public async ingestBatch(
    events: readonly SovraProtocolEvent[],
    nowSeconds?: number,
  ): Promise<{ total: number; appliedCount: number; bufferedCount: number }> {
    let appliedCount = 0;
    let bufferedCount = 0;

    for (const evt of events) {
      const res = await this.ingestEvent(evt, nowSeconds);
      if (res.ok) {
        if (res.value.applied) appliedCount++;
        if (res.value.buffered) bufferedCount++;
      }
    }

    return { total: events.length, appliedCount, bufferedCount };
  }

  // ==========================================
  // CAUSAL ORDERING & DEPENDENCY BUFFERING
  // ==========================================

  private findMissingDependencies(event: SovraProtocolEvent): string[] {
    const missing: string[] = [];
    for (const parentId of event.parents) {
      if (!this.appliedEventIds.has(parentId)) {
        missing.push(parentId);
      }
    }
    return missing;
  }

  private bufferPendingEvent(
    event: SovraProtocolEvent,
    missingParents: readonly string[],
  ): Result<void, ProtocolError> {
    // Bounded buffer check
    if (this.pendingEventIds.size >= this.maxPendingBuffer) {
      return err(
        new InvalidEventError(
          `Dependency buffer overflow: exceeded max buffer limit of ${this.maxPendingBuffer} events`,
        ),
      );
    }

    // Cycle Detection: verify candidate does not create a dependency loop
    if (this.detectDependencyCycle(event.eventId, missingParents)) {
      return err(
        new InvalidEventError(
          `Dependency cycle detected for event ${event.eventId}. Graph rejected.`,
        ),
      );
    }

    // Buffer under first missing parent
    const primaryParent = missingParents[0]!;
    let bucket = this.pendingByParent.get(primaryParent);
    if (!bucket) {
      bucket = new Map();
      this.pendingByParent.set(primaryParent, bucket);
    }

    bucket.set(event.eventId, event);
    this.pendingEventIds.add(event.eventId);
    this.pendingEventsById.set(event.eventId, event);

    return ok(undefined);
  }

  private detectDependencyCycle(
    candidateId: string,
    parents: readonly string[],
    visited = new Set<string>(),
    depth = 0,
  ): boolean {
    if (depth >= this.maxDependencyDepth) {
      return true; // Exceeded maximum allowable chain depth
    }

    for (const parentId of parents) {
      if (parentId === candidateId) return true;
      if (visited.has(parentId)) continue;
      visited.add(parentId);

      // Check if parent itself is in the pending buffer
      const parentEvent = this.pendingEventsById.get(parentId);
      if (parentEvent) {
        if (parentEvent.eventId === candidateId) return true;
        if (parentEvent.parents.includes(candidateId)) return true;
        if (this.detectDependencyCycle(candidateId, parentEvent.parents, visited, depth + 1)) {
          return true;
        }
      }
    }

    return false;
  }

  private resolvePendingDependents(resolvedEventId: string): void {
    const dependentsMap = this.pendingByParent.get(resolvedEventId);
    if (!dependentsMap) return;

    this.pendingByParent.delete(resolvedEventId);
    const dependents = Array.from(dependentsMap.values());

    // Sort dependents by causal sequence and timestamp
    dependents.sort((a, b) => {
      const lamportA = a.logicalClock.lamport ?? 0;
      const lamportB = b.logicalClock.lamport ?? 0;
      if (lamportA !== lamportB) return lamportA - lamportB;
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.eventId.localeCompare(b.eventId);
    });

    for (const dep of dependents) {
      this.pendingEventIds.delete(dep.eventId);
      this.pendingEventsById.delete(dep.eventId);
      const remainingMissing = this.findMissingDependencies(dep);
      if (remainingMissing.length === 0) {
        this.applyEventDirect(dep);
        // Cascade down
        this.resolvePendingDependents(dep.eventId);
      } else {
        // Re-buffer under next missing parent
        this.bufferPendingEvent(dep, remainingMissing);
      }
    }
  }

  private validateStatePreconditions(event: SovraProtocolEvent): Result<void, ProtocolError> {
    const payload = event.payload as any;

    if (event.eventType === 'post:edit' || event.eventType === 'post.edit') {
      const targetPostId = payload?.targetPostId ?? event.object?.id;
      if (targetPostId) {
        const post = this.posts.get(targetPostId);
        if (post) {
          if (post.isDeleted) {
            return err(new InvalidEventError(`Cannot edit deleted post ${targetPostId}`));
          }
          if (post.authorDid !== event.author.did) {
            return err(
              new UnauthorizedOperationError(
                `Unauthorized edit: event author ${event.author.did} is not post author ${post.authorDid}`,
              ),
            );
          }
        }
      }
    } else if (event.eventType === 'post:create' || event.eventType === 'post.create') {
      const postId = payload?.postId ?? event.object?.id ?? event.eventId;
      if (postId) {
        const post = this.posts.get(postId);
        if (post && post.isDeleted) {
          return err(new InvalidEventError(`Resurrection rejected: post ${postId} is tombstoned`));
        }
      }
    } else if (event.eventType === 'post:delete' || event.eventType === 'post.delete') {
      const targetPostId = payload?.targetPostId ?? event.object?.id;
      if (targetPostId) {
        const post = this.posts.get(targetPostId);
        if (post && post.authorDid !== event.author.did) {
          return err(
            new UnauthorizedOperationError(
              `Unauthorized delete: event author ${event.author.did} is not post author ${post.authorDid}`,
            ),
          );
        }
      }
    } else if (event.eventType === 'comment:delete' || event.eventType === 'comment.delete') {
      const targetCommentId = payload?.targetCommentId ?? event.object?.id;
      if (targetCommentId) {
        const comment = this.comments.get(targetCommentId);
        if (comment && comment.authorDid !== event.author.did) {
          return err(
            new UnauthorizedOperationError(
              `Unauthorized delete: event author ${event.author.did} is not comment author ${comment.authorDid}`,
            ),
          );
        }
      }
    }

    return ok(undefined);
  }

  // ==========================================
  // DETERMINISTIC STATE TRANSITION REDUCER
  // ==========================================

  private applyEventDirect(event: SovraProtocolEvent): void {
    if (this.appliedEventIds.has(event.eventId)) return;
    const precond = this.validateStatePreconditions(event);
    if (!precond.ok) return;

    switch (event.eventType) {
      case 'profile.update':
      case 'profile:update':
        this.reduceProfileUpdate(event);
        break;

      case 'post.create':
      case 'post:create':
        this.reducePostCreate(event);
        break;

      case 'post.edit':
      case 'post:edit':
        this.reducePostEdit(event);
        break;

      case 'post.delete':
      case 'post:delete':
        this.reducePostDelete(event);
        break;

      case 'comment.create':
      case 'comment:create':
        this.reduceCommentCreate(event);
        break;

      case 'comment.delete':
      case 'comment:delete':
        this.reduceCommentDelete(event);
        break;

      case 'reaction.add':
      case 'reaction:add':
      case 'reaction.create':
        this.reduceReactionAdd(event);
        break;

      case 'social.follow':
      case 'social:follow':
      case 'social.unfollow':
      case 'social:unfollow':
      case 'social.block':
      case 'social:block':
      case 'social.unblock':
      case 'social:unblock':
      case 'social.mute':
      case 'social:mute':
      case 'social.unmute':
      case 'social:unmute':
      case 'friend.request':
      case 'friend:request':
      case 'friend.respond':
      case 'friend:respond':
      case 'friend.remove':
      case 'friend:remove':
        this.reduceSocialRelationship(event);
        break;

      case 'community.create':
      case 'community:create':
      case 'community.member_join':
      case 'community:member_join':
      case 'community.role_assign':
      case 'community:role_assign':
        this.reduceCommunity(event);
        break;

      case 'knowledge.question_create':
      case 'knowledge:question_create':
      case 'knowledge.claim_create':
      case 'knowledge:claim_create':
      case 'knowledge.evidence_attach':
      case 'knowledge:evidence_attach':
      case 'knowledge.synthesis_create':
      case 'knowledge:synthesis_create':
        this.reduceKnowledge(event);
        break;

      default:
        // Other verified protocol events tracked without domain state mutations
        break;
    }

    // Mark event applied
    this.appliedEventIds.add(event.eventId);
    this.lastAppliedEventId = event.eventId;

    // Update frontier vector clock
    const currentSeq = this.frontierVectorClock.get(event.author.did) ?? 0;
    if (event.logicalClock.sequence > currentSeq) {
      this.frontierVectorClock.set(event.author.did, event.logicalClock.sequence);
    }
  }

  // ==========================================
  // REDUCERS: PROFILES & POSTS
  // ==========================================

  private reduceProfileUpdate(event: SovraProtocolEvent): void {
    const payload = event.payload as any;
    if (!payload || typeof payload !== 'object') return;

    const authorDid = event.author.did;
    const existing = this.profiles.get(authorDid);
    const lamport = event.logicalClock.lamport ?? event.logicalClock.sequence;

    const historyEntry = {
      eventId: event.eventId,
      updatedAt: event.createdAt,
      lamport,
      displayName: payload.displayName ?? existing?.displayName ?? '',
      bio: payload.bio ?? existing?.bio ?? '',
    };

    if (
      !existing ||
      this.isSuperior(event.createdAt, lamport, authorDid, event.eventId, existing.updatedAt, existing.lamport, authorDid, existing.lastEventId)
    ) {
      const history = existing ? [...existing.editHistory] : [];
      if (!history.some((h) => h.eventId === event.eventId)) {
        history.push(historyEntry);
      }
      history.sort((a, b) => {
        if (a.lamport !== b.lamport) return a.lamport - b.lamport;
        if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
        return a.eventId.localeCompare(b.eventId);
      });

      this.profiles.set(authorDid, {
        did: authorDid,
        displayName: payload.displayName ?? existing?.displayName ?? 'Sovereign Peer',
        bio: payload.bio ?? existing?.bio ?? '',
        avatarCid: payload.avatarCid ?? existing?.avatarCid,
        updatedAt: event.createdAt,
        lamport,
        lastEventId: event.eventId,
        editHistory: history,
      });
    } else {
      this.conflictsDetectedCount++;
      const history = [...existing.editHistory];
      if (!history.some((h) => h.eventId === event.eventId)) {
        history.push(historyEntry);
      }
      history.sort((a, b) => {
        if (a.lamport !== b.lamport) return a.lamport - b.lamport;
        if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
        return a.eventId.localeCompare(b.eventId);
      });
      this.profiles.set(authorDid, {
        ...existing,
        editHistory: history,
      });
    }
  }

  private reducePostCreate(event: SovraProtocolEvent): void {
    const payload = event.payload as any;
    const postId = event.object?.id ?? event.eventId;
    const lamport = event.logicalClock.lamport ?? event.logicalClock.sequence;
    const existing = this.posts.get(postId);

    // If already deleted by a tombstone, DO NOT resurrect
    if (existing && existing.isDeleted) {
      return;
    }

    if (!existing) {
      this.posts.set(postId, {
        id: postId,
        authorDid: event.author.did,
        content: String(payload?.content ?? ''),
        tags: Array.isArray(payload?.tags) ? payload.tags : [],
        mediaCids: Array.isArray(payload?.mediaCids) ? payload.mediaCids : [],
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
        lamport,
        isDeleted: false,
        editHistory: [
          {
            eventId: event.eventId,
            content: String(payload?.content ?? ''),
            updatedAt: event.createdAt,
            lamport,
          },
        ],
      });
    }
  }

  private reducePostEdit(event: SovraProtocolEvent): void {
    const payload = event.payload as any;
    const targetPostId = payload?.targetPostId ?? event.object?.id;
    if (!targetPostId) return;

    const existing = this.posts.get(targetPostId);
    if (!existing) return;

    // If deleted, edit is rejected
    if (existing.isDeleted) return;

    // Only post author can edit post
    if (existing.authorDid !== event.author.did) return;

    const lamport = event.logicalClock.lamport ?? event.logicalClock.sequence;
    const historyEntry = {
      eventId: event.eventId,
      content: String(payload?.newContent ?? ''),
      updatedAt: event.createdAt,
      lamport,
    };

    if (
      this.isSuperior(event.createdAt, lamport, event.author.did, event.eventId, existing.updatedAt, existing.lamport, existing.authorDid, existing.id)
    ) {
      const history = [...existing.editHistory];
      if (!history.some((h) => h.eventId === event.eventId)) {
        history.push(historyEntry);
      }
      history.sort((a, b) => {
        if (a.lamport !== b.lamport) return a.lamport - b.lamport;
        if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
        return a.eventId.localeCompare(b.eventId);
      });

      this.posts.set(targetPostId, {
        ...existing,
        content: String(payload?.newContent ?? ''),
        updatedAt: event.createdAt,
        lamport,
        editHistory: history,
      });
    } else {
      this.conflictsDetectedCount++;
      const history = [...existing.editHistory];
      if (!history.some((h) => h.eventId === event.eventId)) {
        history.push(historyEntry);
      }
      history.sort((a, b) => {
        if (a.lamport !== b.lamport) return a.lamport - b.lamport;
        if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
        return a.eventId.localeCompare(b.eventId);
      });
      this.posts.set(targetPostId, {
        ...existing,
        editHistory: history,
      });
    }
  }

  private reducePostDelete(event: SovraProtocolEvent): void {
    const payload = event.payload as any;
    const targetPostId = payload?.targetPostId ?? event.object?.id;
    if (!targetPostId) return;

    const existing = this.posts.get(targetPostId);
    const lamport = event.logicalClock.lamport ?? event.logicalClock.sequence;

    // Authorization: only author can delete
    if (existing && existing.authorDid !== event.author.did) return;

    if (existing) {
      this.posts.set(targetPostId, {
        ...existing,
        isDeleted: true,
        tombstoneAt: event.createdAt,
        tombstoneLamport: lamport,
        updatedAt: event.createdAt,
      });
    } else {
      // Create preemptive tombstone if delete arrives before create
      this.posts.set(targetPostId, {
        id: targetPostId,
        authorDid: event.author.did,
        content: '',
        tags: [],
        mediaCids: [],
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
        lamport,
        isDeleted: true,
        tombstoneAt: event.createdAt,
        tombstoneLamport: lamport,
        editHistory: [],
      });
    }
  }

  // ==========================================
  // REDUCERS: COMMENTS & REACTIONS
  // ==========================================

  private reduceCommentCreate(event: SovraProtocolEvent): void {
    const payload = event.payload as any;
    const commentId = event.object?.id ?? event.eventId;
    const targetObjectId = payload?.targetObjectId ?? payload?.targetPostId;
    if (!targetObjectId) return;

    const lamport = event.logicalClock.lamport ?? event.logicalClock.sequence;
    const existing = this.comments.get(commentId);
    if (existing && existing.isDeleted) return;

    if (!existing) {
      this.comments.set(commentId, {
        id: commentId,
        targetObjectId,
        authorDid: event.author.did,
        content: String(payload?.content ?? ''),
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
        lamport,
        isDeleted: false,
      });
    }
  }

  private reduceCommentDelete(event: SovraProtocolEvent): void {
    const payload = event.payload as any;
    const targetCommentId = payload?.targetCommentId ?? event.object?.id;
    if (!targetCommentId) return;

    const existing = this.comments.get(targetCommentId);
    if (existing && existing.authorDid !== event.author.did) return;

    if (existing) {
      this.comments.set(targetCommentId, {
        ...existing,
        isDeleted: true,
        tombstoneAt: event.createdAt,
      });
    }
  }

  private reduceReactionAdd(event: SovraProtocolEvent): void {
    const payload = event.payload as any;
    const targetObjectId = payload?.targetObjectId ?? event.object?.id;
    if (!targetObjectId) return;

    let counter = this.counters.get(targetObjectId);
    if (!counter) {
      counter = { P: new Map(), N: new Map() };
      this.counters.set(targetObjectId, counter);
    }

    const isNegative = payload?.direction === '-';
    if (isNegative) {
      counter.N.set(event.author.did, (counter.N.get(event.author.did) ?? 0) + 1);
    } else {
      counter.P.set(event.author.did, (counter.P.get(event.author.did) ?? 0) + 1);
    }
  }

  // ==========================================
  // REDUCERS: SOCIAL RELATIONSHIPS & GRAPH
  // ==========================================

  private reduceSocialRelationship(event: SovraProtocolEvent): void {
    const payload = event.payload as any;
    const targetDid = payload?.targetDid ?? event.object?.ownerDid;
    if (!targetDid || targetDid === event.author.did) return;

    const relKey = `${event.author.did}:${targetDid}`;
    let aspects = this.relationshipAspects.get(relKey);
    if (!aspects) {
      aspects = {
        follow: { value: false, lamport: 0, updatedAt: 0, eventId: '' },
        block: { value: false, lamport: 0, updatedAt: 0, eventId: '' },
        mute: { value: false, lamport: 0, updatedAt: 0, eventId: '' },
        friend: { status: 'NONE', lamport: 0, updatedAt: 0, eventId: '' },
      };
      this.relationshipAspects.set(relKey, aspects);
    }

    const lamport = event.logicalClock.lamport ?? event.logicalClock.sequence;

    switch (event.eventType) {
      case 'social.follow':
      case 'social:follow':
        if (
          !aspects.follow.eventId ||
          this.isSuperior(event.createdAt, lamport, event.author.did, event.eventId, aspects.follow.updatedAt, aspects.follow.lamport, event.author.did, aspects.follow.eventId)
        ) {
          aspects.follow = { value: true, lamport, updatedAt: event.createdAt, eventId: event.eventId };
        } else {
          this.conflictsDetectedCount++;
        }
        break;

      case 'social.unfollow':
      case 'social:unfollow':
        if (
          !aspects.follow.eventId ||
          this.isSuperior(event.createdAt, lamport, event.author.did, event.eventId, aspects.follow.updatedAt, aspects.follow.lamport, event.author.did, aspects.follow.eventId)
        ) {
          aspects.follow = { value: false, lamport, updatedAt: event.createdAt, eventId: event.eventId };
        } else {
          this.conflictsDetectedCount++;
        }
        break;

      case 'social.block':
      case 'social:block':
        if (
          !aspects.block.eventId ||
          this.isSuperior(event.createdAt, lamport, event.author.did, event.eventId, aspects.block.updatedAt, aspects.block.lamport, event.author.did, aspects.block.eventId)
        ) {
          aspects.block = { value: true, lamport, updatedAt: event.createdAt, eventId: event.eventId };
        } else {
          this.conflictsDetectedCount++;
        }
        break;

      case 'social.unblock':
      case 'social:unblock':
        if (
          !aspects.block.eventId ||
          this.isSuperior(event.createdAt, lamport, event.author.did, event.eventId, aspects.block.updatedAt, aspects.block.lamport, event.author.did, aspects.block.eventId)
        ) {
          aspects.block = { value: false, lamport, updatedAt: event.createdAt, eventId: event.eventId };
        } else {
          this.conflictsDetectedCount++;
        }
        break;

      case 'social.mute':
      case 'social:mute':
        if (
          !aspects.mute.eventId ||
          this.isSuperior(event.createdAt, lamport, event.author.did, event.eventId, aspects.mute.updatedAt, aspects.mute.lamport, event.author.did, aspects.mute.eventId)
        ) {
          aspects.mute = { value: true, lamport, updatedAt: event.createdAt, eventId: event.eventId };
        } else {
          this.conflictsDetectedCount++;
        }
        break;

      case 'social.unmute':
      case 'social:unmute':
        if (
          !aspects.mute.eventId ||
          this.isSuperior(event.createdAt, lamport, event.author.did, event.eventId, aspects.mute.updatedAt, aspects.mute.lamport, event.author.did, aspects.mute.eventId)
        ) {
          aspects.mute = { value: false, lamport, updatedAt: event.createdAt, eventId: event.eventId };
        } else {
          this.conflictsDetectedCount++;
        }
        break;

      case 'friend.request':
      case 'friend:request':
        if (
          !aspects.friend.eventId ||
          this.isSuperior(event.createdAt, lamport, event.author.did, event.eventId, aspects.friend.updatedAt, aspects.friend.lamport, event.author.did, aspects.friend.eventId)
        ) {
          aspects.friend = { status: 'REQUEST_SENT', lamport, updatedAt: event.createdAt, eventId: event.eventId };
        } else {
          this.conflictsDetectedCount++;
        }
        break;

      case 'friend.respond':
      case 'friend:respond':
        if (
          !aspects.friend.eventId ||
          this.isSuperior(event.createdAt, lamport, event.author.did, event.eventId, aspects.friend.updatedAt, aspects.friend.lamport, event.author.did, aspects.friend.eventId)
        ) {
          const nextStatus = payload?.accept ? 'ACCEPTED' : 'NONE';
          aspects.friend = { status: nextStatus, lamport, updatedAt: event.createdAt, eventId: event.eventId };
        } else {
          this.conflictsDetectedCount++;
        }
        break;

      case 'friend.remove':
      case 'friend:remove':
        if (
          !aspects.friend.eventId ||
          this.isSuperior(event.createdAt, lamport, event.author.did, event.eventId, aspects.friend.updatedAt, aspects.friend.lamport, event.author.did, aspects.friend.eventId)
        ) {
          aspects.friend = { status: 'REMOVED', lamport, updatedAt: event.createdAt, eventId: event.eventId };
        } else {
          this.conflictsDetectedCount++;
        }
        break;
    }

    const isBlocked = aspects.block.value;
    const isMuted = aspects.mute.value;
    const friendStatus = aspects.friend.status;
    const isFollowing = aspects.follow.value && !isBlocked;

    let maxLamport = 0;
    let maxUpdatedAt = 0;
    let latestEventId = '';

    for (const asp of [aspects.follow, aspects.block, aspects.mute, aspects.friend]) {
      if (!asp.eventId) continue;
      if (
        !latestEventId ||
        this.isSuperior(asp.updatedAt, asp.lamport, event.author.did, asp.eventId, maxUpdatedAt, maxLamport, event.author.did, latestEventId)
      ) {
        maxLamport = asp.lamport;
        maxUpdatedAt = asp.updatedAt;
        latestEventId = asp.eventId;
      }
    }

    this.relationships.set(relKey, {
      sourceDid: event.author.did,
      targetDid,
      isFollowing,
      isBlocked,
      isMuted,
      friendStatus,
      updatedAt: maxUpdatedAt,
      lamport: maxLamport,
      lastEventId: latestEventId,
    });
  }

  // ==========================================
  // REDUCERS: COMMUNITIES & KNOWLEDGE
  // ==========================================

  private reduceCommunity(event: SovraProtocolEvent): void {
    const payload = event.payload as any;
    const communityId = payload?.communityId ?? event.object?.id;
    if (!communityId) return;

    const lamport = event.logicalClock.lamport ?? event.logicalClock.sequence;

    let memberMap = this.communityMembers.get(communityId);
    if (!memberMap) {
      memberMap = new Map();
      this.communityMembers.set(communityId, memberMap);
    }

    if (event.eventType === 'community:create') {
      const existingCreator = memberMap.get(event.author.did);
      const joinedAt = existingCreator ? Math.min(existingCreator.joinedAt, event.createdAt) : event.createdAt;
      const creatorLamport = existingCreator ? Math.min(existingCreator.lamport, lamport) : lamport;
      memberMap.set(event.author.did, { role: 'ADMIN', joinedAt, lamport: creatorLamport });

      if (!this.communities.has(communityId)) {
        this.communities.set(communityId, {
          id: communityId,
          name: String(payload?.name ?? 'Sovereign Community'),
          creatorDid: event.author.did,
          members: {},
          isDeleted: false,
        });
      }
    } else if (event.eventType === 'community:member_join') {
      const existing = memberMap.get(event.author.did);
      if (!existing) {
        memberMap.set(event.author.did, { role: 'MEMBER', joinedAt: event.createdAt, lamport });
      } else {
        const role = existing.role === 'ADMIN' ? 'ADMIN' : 'MEMBER';
        const isEarlier =
          lamport < existing.lamport || (lamport === existing.lamport && event.createdAt < existing.joinedAt);
        if (isEarlier) {
          memberMap.set(event.author.did, { role, joinedAt: event.createdAt, lamport });
        } else if (existing.role !== 'ADMIN' && role === 'ADMIN') {
          memberMap.set(event.author.did, { role: 'ADMIN', joinedAt: existing.joinedAt, lamport: existing.lamport });
        }
      }
    }

    const comm = this.communities.get(communityId);
    if (comm && !comm.isDeleted) {
      const membersObj: Record<string, { role: 'ADMIN' | 'MODERATOR' | 'MEMBER'; joinedAt: number; lamport: number }> = {};
      for (const [did, m] of memberMap.entries()) {
        membersObj[did] = m;
      }
      this.communities.set(communityId, {
        ...comm,
        members: membersObj,
      });
    }
  }

  private reduceKnowledge(event: SovraProtocolEvent): void {
    const payload = event.payload as any;
    const lamport = event.logicalClock.lamport ?? event.logicalClock.sequence;

    if (event.eventType === 'knowledge:question_create') {
      const qId = payload?.questionId ?? event.object?.id ?? event.eventId;
      if (!this.questions.has(qId)) {
        const answers = this.questionAnswers.get(qId);
        this.questions.set(qId, {
          id: qId,
          authorDid: event.author.did,
          title: String(payload?.title ?? ''),
          description: payload?.description ? String(payload.description) : undefined,
          topics: Array.isArray(payload?.topics) ? payload.topics : [],
          createdAt: event.createdAt,
          lamport,
          answerCount: answers ? answers.size : 0,
        });
      }
    } else if (event.eventType === 'knowledge:claim_create') {
      const cId = payload?.claimId ?? event.object?.id ?? event.eventId;
      if (!this.claims.has(cId)) {
        const evSet = this.claimEvidences.get(cId);
        const caSet = this.claimCounterarguments.get(cId);
        const synth = this.claimSyntheses.get(cId);
        this.claims.set(cId, {
          id: cId,
          authorDid: event.author.did,
          thesis: String(payload?.thesis ?? payload?.statement ?? ''),
          domain: String(payload?.domain ?? 'general'),
          createdAt: event.createdAt,
          lamport,
          evidenceCount: evSet ? evSet.size : 0,
          counterargumentCount: caSet ? caSet.size : 0,
          consensusStatus: synth ? synth.consensusStatus : 'PROPOSED',
          synthesisSummary: synth ? synth.synthesisSummary : undefined,
        });
      }
    } else if (event.eventType === 'knowledge:evidence_attach') {
      const claimId = payload?.claimId;
      if (!claimId) return;

      let evSet = this.claimEvidences.get(claimId);
      if (!evSet) {
        evSet = new Set();
        this.claimEvidences.set(claimId, evSet);
      }
      evSet.add(event.eventId);

      const claim = this.claims.get(claimId);
      if (claim) {
        this.claims.set(claimId, {
          ...claim,
          evidenceCount: evSet.size,
        });
      }
    } else if (event.eventType === 'knowledge:synthesis_create') {
      const claimId = payload?.claimId;
      if (!claimId) return;

      const status = String(payload?.consensusStatus ?? 'ACCEPTED');
      const summary = String(payload?.summary ?? '');

      const existingSynth = this.claimSyntheses.get(claimId);
      if (
        !existingSynth ||
        this.isSuperior(
          event.createdAt,
          lamport,
          event.author.did,
          event.eventId,
          existingSynth.createdAt,
          existingSynth.lamport,
          existingSynth.authorDid,
          existingSynth.eventId,
        )
      ) {
        this.claimSyntheses.set(claimId, {
          consensusStatus: status,
          synthesisSummary: summary,
          lamport,
          createdAt: event.createdAt,
          authorDid: event.author.did,
          eventId: event.eventId,
        });
      }

      const claim = this.claims.get(claimId);
      if (claim) {
        const synth = this.claimSyntheses.get(claimId)!;
        this.claims.set(claimId, {
          ...claim,
          consensusStatus: synth.consensusStatus,
          synthesisSummary: synth.synthesisSummary,
        });
      }
    }
  }

  // ==========================================
  // DETERMINISTIC LWW TIE-BREAKER
  // ==========================================

  /**
   * Evaluates total order superiority between two state mutations:
   * 1. Lamport logical clock
   * 2. Physical wall-clock timestamp
   * 3. Author DID lexicographical comparison
   * 4. Event ID lexicographical comparison
   */
  private isSuperior(
    timeA: number,
    lamportA: number,
    authorA: string,
    idA: string,
    timeB: number,
    lamportB: number,
    authorB: string,
    idB: string,
  ): boolean {
    if (lamportA !== lamportB) {
      return lamportA > lamportB;
    }
    if (timeA !== timeB) {
      return timeA > timeB;
    }
    const authorCmp = authorA.localeCompare(authorB);
    if (authorCmp !== 0) {
      return authorCmp < 0;
    }
    return idA.localeCompare(idB) < 0;
  }

  // ==========================================
  // DETERMINISTIC STATE SNAPSHOT & FRONTIER HASH
  // ==========================================

  /**
   * Produces a bit-for-bit deterministic canonical snapshot.
   */
  public createSnapshot(): DeterministicStateSnapshot {
    const serialized = this.getSerializedState();
    const stateHash = this.computeStateHash(serialized);

    const clockObj: Record<string, number> = {};
    for (const [did, seq] of Array.from(this.frontierVectorClock.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      clockObj[did] = seq;
    }

    const frontier: EventFrontier = {
      vectorClock: clockObj,
      eventCount: this.appliedEventIds.size,
      stateHash,
    };

    this.snapshotsCreatedCount++;

    return {
      snapshotVersion: 1,
      timestamp: Math.floor(Date.now() / 1000),
      frontier,
      state: serialized,
      stateHash,
    };
  }

  /**
   * Restores state projection from a verified snapshot.
   */
  public restoreFromSnapshot(snapshot: DeterministicStateSnapshot): Result<void, ProtocolError> {
    if (snapshot.snapshotVersion !== 1) {
      return err(new InvalidEventError(`Unsupported snapshot version: ${snapshot.snapshotVersion}`));
    }

    // Verify snapshot cryptographic integrity
    const computedHash = this.computeStateHash(snapshot.state);
    if (computedHash !== snapshot.stateHash) {
      return err(
        new StorageFailureError(
          `Snapshot integrity verification failed: computed ${computedHash} !== declared ${snapshot.stateHash}`,
        ),
      );
    }

    // Clear existing projection
    this.profiles.clear();
    this.posts.clear();
    this.comments.clear();
    this.counters.clear();
    this.relationships.clear();
    this.relationshipAspects.clear();
    this.communities.clear();
    this.communityMembers.clear();
    this.claims.clear();
    this.claimEvidences.clear();
    this.claimCounterarguments.clear();
    this.claimSyntheses.clear();
    this.questions.clear();
    this.questionAnswers.clear();
    this.appliedEventIds.clear();
    this.frontierVectorClock.clear();

    // Populate from snapshot state
    for (const [k, v] of Object.entries(snapshot.state.profiles)) this.profiles.set(k, v);
    for (const [k, v] of Object.entries(snapshot.state.posts)) this.posts.set(k, v);
    for (const [k, v] of Object.entries(snapshot.state.comments)) this.comments.set(k, v);
    for (const [k, v] of Object.entries(snapshot.state.counters)) {
      const pMap = new Map<string, number>();
      for (const [a, c] of Object.entries(v.increments)) pMap.set(a, c);
      const nMap = new Map<string, number>();
      for (const [a, c] of Object.entries(v.decrements)) nMap.set(a, c);
      this.counters.set(k, { P: pMap, N: nMap });
    }
    for (const [k, v] of Object.entries(snapshot.state.relationships)) {
      this.relationships.set(k, v);
      this.relationshipAspects.set(k, {
        follow: { value: v.isFollowing, lamport: v.lamport, updatedAt: v.updatedAt, eventId: v.lastEventId },
        block: { value: v.isBlocked, lamport: v.lamport, updatedAt: v.updatedAt, eventId: v.lastEventId },
        mute: { value: v.isMuted, lamport: v.lamport, updatedAt: v.updatedAt, eventId: v.lastEventId },
        friend: { status: v.friendStatus, lamport: v.lamport, updatedAt: v.updatedAt, eventId: v.lastEventId },
      });
    }
    for (const [k, v] of Object.entries(snapshot.state.communities)) {
      this.communities.set(k, v);
      const memMap = new Map();
      for (const [did, m] of Object.entries(v.members)) {
        memMap.set(did, m);
      }
      this.communityMembers.set(k, memMap);
    }
    for (const [k, v] of Object.entries(snapshot.state.claims)) {
      this.claims.set(k, v);
      if (v.consensusStatus || v.synthesisSummary) {
        this.claimSyntheses.set(k, {
          consensusStatus: v.consensusStatus,
          synthesisSummary: v.synthesisSummary ?? '',
          lamport: v.lamport,
          createdAt: v.createdAt,
          authorDid: v.authorDid,
          eventId: v.id,
        });
      }
    }
    for (const [k, v] of Object.entries(snapshot.state.questions)) this.questions.set(k, v);

    // Restore vector clock
    for (const [did, seq] of Object.entries(snapshot.frontier.vectorClock)) {
      this.frontierVectorClock.set(did, seq);
    }

    return ok(undefined);
  }

  public restoreSnapshot(snapshot: DeterministicStateSnapshot): Result<void, ProtocolError> {
    return this.restoreFromSnapshot(snapshot);
  }

  public getSerializedState(): SerializedCanonicalState {
    const profiles: Record<string, CanonicalProfile> = {};
    for (const [k, v] of Array.from(this.profiles.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      profiles[k] = v;
    }

    const posts: Record<string, CanonicalPost> = {};
    for (const [k, v] of Array.from(this.posts.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      posts[k] = v;
    }

    const comments: Record<string, CanonicalComment> = {};
    for (const [k, v] of Array.from(this.comments.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      comments[k] = v;
    }

    const counters: Record<string, CanonicalPNCounter> = {};
    for (const [targetId, c] of Array.from(this.counters.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      const incs: Record<string, number> = {};
      let totalP = 0;
      for (const [actor, cnt] of Array.from(c.P.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        incs[actor] = cnt;
        totalP += cnt;
      }
      const decs: Record<string, number> = {};
      let totalN = 0;
      for (const [actor, cnt] of Array.from(c.N.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        decs[actor] = cnt;
        totalN += cnt;
      }
      counters[targetId] = {
        targetObjectId: targetId,
        increments: incs,
        decrements: decs,
        total: totalP - totalN,
      };
    }

    const relationships: Record<string, CanonicalRelationshipState> = {};
    for (const [k, v] of Array.from(this.relationships.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      relationships[k] = v;
    }

    const communities: Record<string, CanonicalCommunity> = {};
    for (const [k, v] of Array.from(this.communities.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      const sortedMembers: Record<string, any> = {};
      for (const [did, m] of Object.entries(v.members).sort((a, b) => a[0].localeCompare(b[0]))) {
        sortedMembers[did] = m;
      }
      communities[k] = {
        ...v,
        members: sortedMembers,
      };
    }

    const claims: Record<string, CanonicalClaim> = {};
    for (const [k, v] of Array.from(this.claims.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      claims[k] = v;
    }

    const questions: Record<string, CanonicalQuestion> = {};
    for (const [k, v] of Array.from(this.questions.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      questions[k] = v;
    }

    return {
      profiles,
      posts,
      comments,
      counters,
      relationships,
      communities,
      claims,
      questions,
    };
  }

  public getStateHash(): string {
    return this.computeStateHash(this.getSerializedState());
  }

  public computeStateHash(state: SerializedCanonicalState): string {
    const canonical = canonicalizeJson(state);
    return bytesToHex(sha256(new TextEncoder().encode(canonical)));
  }

  public getFrontier(): EventFrontier {
    const clockObj: Record<string, number> = {};
    for (const [did, seq] of Array.from(this.frontierVectorClock.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      clockObj[did] = seq;
    }
    return {
      vectorClock: clockObj,
      eventCount: this.appliedEventIds.size,
      stateHash: this.getStateHash(),
    };
  }

  // ==========================================
  // LOCAL-FIRST QUERY APIS
  // ==========================================

  public getProfile(did: string): CanonicalProfile | null {
    return this.profiles.get(did) ?? null;
  }

  public getPost(id: string): CanonicalPost | null {
    const post = this.posts.get(id);
    if (!post || post.isDeleted) return null;
    return post;
  }

  public getPostWithTombstone(id: string): CanonicalPost | null {
    return this.posts.get(id) ?? null;
  }

  public getComments(targetObjectId: string): readonly CanonicalComment[] {
    const list: CanonicalComment[] = [];
    for (const c of this.comments.values()) {
      if (c.targetObjectId === targetObjectId && !c.isDeleted) {
        list.push(c);
      }
    }
    return list.sort((a, b) => a.createdAt - b.createdAt);
  }

  public getReactionCount(targetObjectId: string): number {
    const counter = this.counters.get(targetObjectId);
    if (!counter) return 0;
    let p = 0;
    for (const v of counter.P.values()) p += v;
    let n = 0;
    for (const v of counter.N.values()) n += v;
    return p - n;
  }

  public getFollowing(sourceDid: string): readonly string[] {
    const res: string[] = [];
    for (const r of this.relationships.values()) {
      if (r.sourceDid === sourceDid && r.isFollowing && !r.isBlocked) {
        res.push(r.targetDid);
      }
    }
    return res.sort();
  }

  public getFollowers(targetDid: string): readonly string[] {
    const res: string[] = [];
    for (const r of this.relationships.values()) {
      if (r.targetDid === targetDid && r.isFollowing && !r.isBlocked) {
        res.push(r.sourceDid);
      }
    }
    return res.sort();
  }

  public getRelationship(sourceDid: string, targetDid: string): CanonicalRelationshipState {
    const relKey = `${sourceDid}:${targetDid}`;
    return (
      this.relationships.get(relKey) ?? {
        sourceDid,
        targetDid,
        isFollowing: false,
        isBlocked: false,
        isMuted: false,
        friendStatus: 'NONE',
        updatedAt: 0,
        lamport: 0,
        lastEventId: '',
      }
    );
  }

  public getTimeline(options?: { authorDid?: string; limit?: number }): readonly CanonicalPost[] {
    const list: CanonicalPost[] = [];
    for (const post of this.posts.values()) {
      if (post.isDeleted) continue;
      if (options?.authorDid && post.authorDid !== options.authorDid) continue;
      list.push(post);
    }

    list.sort((a, b) => {
      if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
      return b.id.localeCompare(a.id);
    });

    if (options?.limit && list.length > options.limit) {
      return list.slice(0, options.limit);
    }
    return list;
  }

  // ==========================================
  // DIAGNOSTICS & TELEMETRY
  // ==========================================

  public getDiagnostics(): {
    readonly totalEventsApplied: number;
    readonly pendingDependencyCount: number;
    readonly totalProfiles: number;
    readonly totalPosts: number;
    readonly totalComments: number;
    readonly conflictsDetected: number;
    readonly snapshotsCreated: number;
    readonly lastAppliedEventId?: string | undefined;
  } {
    return {
      totalEventsApplied: this.appliedEventIds.size,
      pendingDependencyCount: this.pendingEventIds.size,
      totalProfiles: this.profiles.size,
      totalPosts: this.posts.size,
      totalComments: this.comments.size,
      conflictsDetected: this.conflictsDetectedCount,
      snapshotsCreated: this.snapshotsCreatedCount,
      lastAppliedEventId: this.lastAppliedEventId,
    };
  }
}
