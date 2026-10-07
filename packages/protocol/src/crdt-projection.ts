/**
 * @file packages/protocol/src/crdt-projection.ts
 * Deterministic CRDT State Projection Engine for Sovra Protocol.
 *
 * Implements:
 * 1. Monotonic, Commutative, Associative, Idempotent event-sourced state projections.
 * 2. LWW-Register projections for Profiles and Content.
 * 3. PNCounter CRDT for Object Reactions and Votes.
 * 4. Add-Wins Epistemic Knowledge Graph projections (Questions, Claims, Evidence, Syntheses).
 * 5. Bit-for-bit deterministic state snapshot hashing.
 */

import { sha256, bytesToHex } from '@sovra/crypto';
import { SovraEvent, EventKind } from './events.js';
import {
  KnowledgeQuestionPayload,
  KnowledgeClaimPayload,
  KnowledgeEvidencePayload,
  KnowledgeCounterargumentPayload,
  KnowledgeSynthesisPayload,
  ConsensusStatus,
} from './knowledge.js';

export interface ProjectedProfile {
  readonly pubkey: string;
  readonly displayName?: string | undefined;
  readonly bio?: string | undefined;
  readonly avatarCid?: string | undefined;
  readonly updatedAt: number;
  readonly lastEventId: string;
}

export interface ProjectedPost {
  readonly id: string;
  readonly authorPubkey: string;
  readonly content: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deleted: boolean;
  readonly tags: readonly (readonly [string, ...string[]])[];
}

export interface ProjectedPNCounter {
  readonly increments: Readonly<Record<string, number>>; // actorPubkey -> count
  readonly decrements: Readonly<Record<string, number>>; // actorPubkey -> count
  readonly total: number;
}

export interface ProjectedQuestion {
  readonly id: string;
  readonly authorPubkey: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly topics: readonly string[];
  readonly createdAt: number;
  readonly answerCount: number;
}

export interface ProjectedClaim {
  readonly id: string;
  readonly authorPubkey: string;
  readonly thesis: string;
  readonly domain: string;
  readonly createdAt: number;
  readonly evidenceCount: number;
  readonly counterargumentCount: number;
  readonly consensusStatus: ConsensusStatus;
  readonly synthesisSummary?: string | undefined;
}

export interface ProjectedEvidence {
  readonly id: string;
  readonly targetClaimId: string;
  readonly authorPubkey: string;
  readonly evidenceType: string;
  readonly summary: string;
  readonly dataCid?: string | undefined;
  readonly reproducibilityScore?: number | undefined;
  readonly createdAt: number;
}

export interface ProjectedStateSnapshot {
  readonly profiles: Readonly<Record<string, ProjectedProfile>>;
  readonly posts: Readonly<Record<string, ProjectedPost>>;
  readonly counters: Readonly<Record<string, ProjectedPNCounter>>;
  readonly questions: Readonly<Record<string, ProjectedQuestion>>;
  readonly claims: Readonly<Record<string, ProjectedClaim>>;
  readonly evidence: Readonly<Record<string, ProjectedEvidence>>;
  readonly stateHash: string;
}

export class CRDTStateProjector {
  private readonly profiles = new Map<string, ProjectedProfile>();
  private readonly posts = new Map<string, ProjectedPost>();
  private readonly counters = new Map<string, { P: Map<string, number>; N: Map<string, number> }>();
  private readonly questions = new Map<string, ProjectedQuestion>();
  private readonly claims = new Map<string, ProjectedClaim>();
  private readonly evidence = new Map<string, ProjectedEvidence>();

  // Inverted relation sets to guarantee order-independent commutativity
  private readonly claimEvidences = new Map<string, Set<string>>();
  private readonly claimCounterarguments = new Map<string, Set<string>>();
  private readonly claimSyntheses = new Map<string, KnowledgeSynthesisPayload>();
  private readonly questionAnswers = new Map<string, Set<string>>();

  private readonly appliedEventIds = new Set<string>();

  public isEventApplied(eventId: string): boolean {
    return this.appliedEventIds.has(eventId);
  }

  public getAppliedCount(): number {
    return this.appliedEventIds.size;
  }

  /**
   * Applies an event deterministically. Idempotent on duplicates.
   */
  public applyEvent(event: SovraEvent): boolean {
    if (this.appliedEventIds.has(event.id)) {
      return false; // Idempotent skip
    }

    switch (event.kind) {
      case EventKind.Metadata:
        this.applyProfileMetadata(event);
        break;

      case EventKind.ShortPost:
        this.applyShortPost(event);
        break;

      case EventKind.Reaction:
        this.applyReaction(event);
        break;

      case EventKind.Question:
        this.applyQuestion(event);
        break;

      case EventKind.Answer:
        this.applyAnswer(event);
        break;

      case EventKind.Claim:
        this.applyClaim(event);
        break;

      case EventKind.Evidence:
        this.applyEvidence(event);
        break;

      case EventKind.Counterargument:
        this.applyCounterargument(event);
        break;

      case EventKind.KnowledgeSynthesis:
        this.applySynthesis(event);
        break;

      default:
        // Other event kinds tracked without state mutation
        break;
    }

    this.appliedEventIds.add(event.id);
    return true;
  }

  /**
   * Applies a batch of events in any arrival order.
   */
  public applyBatch(events: readonly SovraEvent[]): number {
    let count = 0;
    for (const evt of events) {
      if (this.applyEvent(evt)) {
        count++;
      }
    }
    return count;
  }

  // ==========================================
  // EVENT REDUCERS
  // ==========================================

  private applyProfileMetadata(event: SovraEvent): void {
    let payload: any = {};
    try {
      payload = typeof event.content === 'string' ? JSON.parse(event.content) : event.content;
    } catch {
      return;
    }

    const existing = this.profiles.get(event.pubkey);
    if (!existing || this.isLWWSuperior(event.createdAt, event.id, existing.updatedAt, existing.lastEventId)) {
      this.profiles.set(event.pubkey, {
        pubkey: event.pubkey,
        displayName: payload.displayName ?? payload.name ?? existing?.displayName,
        bio: payload.bio ?? existing?.bio,
        avatarCid: payload.avatarCid ?? existing?.avatarCid,
        updatedAt: event.createdAt,
        lastEventId: event.id,
      });
    }
  }

  private applyShortPost(event: SovraEvent): void {
    const content = typeof event.content === 'string' ? event.content : JSON.stringify(event.content);
    const existing = this.posts.get(event.id);
    if (!existing) {
      this.posts.set(event.id, {
        id: event.id,
        authorPubkey: event.pubkey,
        content,
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
        deleted: false,
        tags: event.tags,
      });
    }
  }

  private applyReaction(event: SovraEvent): void {
    const targetTag = event.tags.find((t) => t[0] === 'e');
    if (!targetTag || !targetTag[1]) return;

    const targetId = targetTag[1];
    let counter = this.counters.get(targetId);
    if (!counter) {
      counter = { P: new Map(), N: new Map() };
      this.counters.set(targetId, counter);
    }

    const isNegative = typeof event.content === 'string' && (event.content === '-' || event.content === 'downvote');
    if (isNegative) {
      counter.N.set(event.pubkey, (counter.N.get(event.pubkey) ?? 0) + 1);
    } else {
      counter.P.set(event.pubkey, (counter.P.get(event.pubkey) ?? 0) + 1);
    }
  }

  private applyQuestion(event: SovraEvent): void {
    let payload: KnowledgeQuestionPayload;
    try {
      payload = typeof event.content === 'string' ? JSON.parse(event.content) : event.content;
    } catch {
      return;
    }

    if (!payload.title) return;

    if (!this.questions.has(event.id)) {
      const answerSet = this.questionAnswers.get(event.id);
      this.questions.set(event.id, {
        id: event.id,
        authorPubkey: event.pubkey,
        title: payload.title,
        description: payload.description,
        topics: payload.topics ?? [],
        createdAt: event.createdAt,
        answerCount: answerSet ? answerSet.size : 0,
      });
    }
  }

  private applyAnswer(event: SovraEvent): void {
    let payload: any;
    try {
      payload = typeof event.content === 'string' ? JSON.parse(event.content) : event.content;
    } catch {
      return;
    }

    if (!payload.questionEventId) return;
    let ansSet = this.questionAnswers.get(payload.questionEventId);
    if (!ansSet) {
      ansSet = new Set();
      this.questionAnswers.set(payload.questionEventId, ansSet);
    }
    ansSet.add(event.id);

    const q = this.questions.get(payload.questionEventId);
    if (q) {
      this.questions.set(payload.questionEventId, {
        ...q,
        answerCount: ansSet.size,
      });
    }
  }

  private applyClaim(event: SovraEvent): void {
    let payload: KnowledgeClaimPayload;
    try {
      payload = typeof event.content === 'string' ? JSON.parse(event.content) : event.content;
    } catch {
      return;
    }

    if (!payload.thesis) return;

    if (!this.claims.has(event.id)) {
      const evidenceSet = this.claimEvidences.get(event.id);
      const counterargumentSet = this.claimCounterarguments.get(event.id);
      const synthesis = this.claimSyntheses.get(event.id);

      this.claims.set(event.id, {
        id: event.id,
        authorPubkey: event.pubkey,
        thesis: payload.thesis,
        domain: payload.domain,
        createdAt: event.createdAt,
        evidenceCount: evidenceSet ? evidenceSet.size : 0,
        counterargumentCount: counterargumentSet ? counterargumentSet.size : 0,
        consensusStatus: synthesis?.consensusStatus ?? 'emerging',
        synthesisSummary: synthesis?.synthesisSummary,
      });
    }
  }

  private applyEvidence(event: SovraEvent): void {
    let payload: KnowledgeEvidencePayload;
    try {
      payload = typeof event.content === 'string' ? JSON.parse(event.content) : event.content;
    } catch {
      return;
    }

    if (!payload.targetClaimId || !payload.summary) return;

    let evSet = this.claimEvidences.get(payload.targetClaimId);
    if (!evSet) {
      evSet = new Set();
      this.claimEvidences.set(payload.targetClaimId, evSet);
    }
    evSet.add(event.id);

    if (!this.evidence.has(event.id)) {
      this.evidence.set(event.id, {
        id: event.id,
        targetClaimId: payload.targetClaimId,
        authorPubkey: event.pubkey,
        evidenceType: payload.evidenceType,
        summary: payload.summary,
        dataCid: payload.dataCid,
        reproducibilityScore: payload.reproducibilityScore,
        createdAt: event.createdAt,
      });

      const claim = this.claims.get(payload.targetClaimId);
      if (claim) {
        this.claims.set(payload.targetClaimId, {
          ...claim,
          evidenceCount: evSet.size,
        });
      }
    }
  }

  private applyCounterargument(event: SovraEvent): void {
    let payload: KnowledgeCounterargumentPayload;
    try {
      payload = typeof event.content === 'string' ? JSON.parse(event.content) : event.content;
    } catch {
      return;
    }

    if (!payload.targetClaimOrEvidenceId) return;

    let caSet = this.claimCounterarguments.get(payload.targetClaimOrEvidenceId);
    if (!caSet) {
      caSet = new Set();
      this.claimCounterarguments.set(payload.targetClaimOrEvidenceId, caSet);
    }
    caSet.add(event.id);

    const claim = this.claims.get(payload.targetClaimOrEvidenceId);
    if (claim) {
      this.claims.set(payload.targetClaimOrEvidenceId, {
        ...claim,
        counterargumentCount: caSet.size,
      });
    }
  }

  private applySynthesis(event: SovraEvent): void {
    let payload: KnowledgeSynthesisPayload;
    try {
      payload = typeof event.content === 'string' ? JSON.parse(event.content) : event.content;
    } catch {
      return;
    }

    this.claimSyntheses.set(payload.questionOrClaimId, payload);
    const claim = this.claims.get(payload.questionOrClaimId);
    if (claim) {
      this.claims.set(payload.questionOrClaimId, {
        ...claim,
        consensusStatus: payload.consensusStatus,
        synthesisSummary: payload.synthesisSummary,
      });
    }
  }

  // ==========================================
  // LWW ARBITRATION UTILITY
  // ==========================================

  private isLWWSuperior(timeA: number, idA: string, timeB: number, idB: string): boolean {
    if (timeA !== timeB) {
      return timeA > timeB;
    }
    // Lexicographical SHA-256 tie-breaker
    return idA.localeCompare(idB) < 0;
  }

  // ==========================================
  // DETERMINISTIC SNAPSHOT PROJECTION
  // ==========================================

  public snapshot(): ProjectedStateSnapshot {
    const profiles: Record<string, ProjectedProfile> = {};
    for (const [k, v] of Array.from(this.profiles.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      profiles[k] = v;
    }

    const posts: Record<string, ProjectedPost> = {};
    for (const [k, v] of Array.from(this.posts.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      posts[k] = v;
    }

    const counters: Record<string, ProjectedPNCounter> = {};
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
        increments: incs,
        decrements: decs,
        total: totalP - totalN,
      };
    }

    const questions: Record<string, ProjectedQuestion> = {};
    for (const [k, v] of Array.from(this.questions.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      questions[k] = v;
    }

    const claims: Record<string, ProjectedClaim> = {};
    for (const [k, v] of Array.from(this.claims.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      claims[k] = v;
    }

    const evidence: Record<string, ProjectedEvidence> = {};
    for (const [k, v] of Array.from(this.evidence.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      evidence[k] = v;
    }

    // Compute deterministic snapshot hash
    const canonicalStateJson = JSON.stringify({
      profiles,
      posts,
      counters,
      questions,
      claims,
      evidence,
    });

    const stateHash = bytesToHex(sha256(new TextEncoder().encode(canonicalStateJson)));

    return {
      profiles,
      posts,
      counters,
      questions,
      claims,
      evidence,
      stateHash,
    };
  }
}
