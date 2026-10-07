import { Result, ok, err } from '@sovra/shared';
import {
  SovraEvent,
  EventKind,
  ConsensusStatus,
  KnowledgeClaimPayload,
  KnowledgeEvidencePayload,
  KnowledgeCounterargumentPayload,
  KnowledgeQuestionPayload,
  KnowledgeAnswerPayload,
} from '@sovra/protocol';

export interface SemanticClaimNode {
  readonly id: string;
  readonly authorPubkey: string;
  readonly createdAt: number;
  readonly payload: KnowledgeClaimPayload;
  readonly evidenceIds: string[];
  readonly counterargumentIds: string[];
}

export interface SemanticEvidenceNode {
  readonly id: string;
  readonly authorPubkey: string;
  readonly createdAt: number;
  readonly payload: KnowledgeEvidencePayload;
}

export interface SemanticCounterargumentNode {
  readonly id: string;
  readonly authorPubkey: string;
  readonly createdAt: number;
  readonly payload: KnowledgeCounterargumentPayload;
}

export interface SemanticQuestionNode {
  readonly id: string;
  readonly authorPubkey: string;
  readonly createdAt: number;
  readonly payload: KnowledgeQuestionPayload;
  readonly answerIds: string[];
}

export interface SemanticAnswerNode {
  readonly id: string;
  readonly authorPubkey: string;
  readonly createdAt: number;
  readonly payload: KnowledgeAnswerPayload;
}

export interface SemanticSubgraph {
  readonly rootId: string;
  readonly question?: SemanticQuestionNode | undefined;
  readonly claim?: SemanticClaimNode | undefined;
  readonly answers: readonly SemanticAnswerNode[];
  readonly evidence: readonly SemanticEvidenceNode[];
  readonly counterarguments: readonly SemanticCounterargumentNode[];
}

export class KnowledgeGraphEngine {
  private readonly questions = new Map<string, SemanticQuestionNode>();
  private readonly answers = new Map<string, SemanticAnswerNode>();
  private readonly claims = new Map<string, SemanticClaimNode>();
  private readonly evidence = new Map<string, SemanticEvidenceNode>();
  private readonly counterarguments = new Map<string, SemanticCounterargumentNode>();

  // Inverted indexes for fast traversal
  private readonly claimsByDomain = new Map<string, Set<string>>();
  private readonly claimsByAuthor = new Map<string, Set<string>>();

  /**
   * Ingests and indexes a validated Sovra knowledge protocol event into the semantic graph.
   */
  public ingestEvent(event: SovraEvent): Result<void> {
    try {
      const parsed = typeof event.content === 'string' ? JSON.parse(event.content) : event.content;

      switch (event.kind) {
        case EventKind.Question: {
          const payload = parsed as KnowledgeQuestionPayload;
          const node: SemanticQuestionNode = {
            id: event.id,
            authorPubkey: event.pubkey,
            createdAt: event.createdAt,
            payload,
            answerIds: [],
          };
          this.questions.set(event.id, node);
          return ok(undefined);
        }

        case EventKind.Answer: {
          const payload = parsed as KnowledgeAnswerPayload;
          const node: SemanticAnswerNode = {
            id: event.id,
            authorPubkey: event.pubkey,
            createdAt: event.createdAt,
            payload,
          };
          this.answers.set(event.id, node);

          const q = this.questions.get(payload.questionEventId);
          if (q && !q.answerIds.includes(event.id)) {
            q.answerIds.push(event.id);
          }
          return ok(undefined);
        }

        case EventKind.Claim: {
          const payload = parsed as KnowledgeClaimPayload;
          const node: SemanticClaimNode = {
            id: event.id,
            authorPubkey: event.pubkey,
            createdAt: event.createdAt,
            payload,
            evidenceIds: [],
            counterargumentIds: [],
          };
          this.claims.set(event.id, node);

          // Index domain
          const domain = payload.domain.toLowerCase();
          let domainSet = this.claimsByDomain.get(domain);
          if (!domainSet) {
            domainSet = new Set();
            this.claimsByDomain.set(domain, domainSet);
          }
          domainSet.add(event.id);

          // Index author
          let authorSet = this.claimsByAuthor.get(event.pubkey);
          if (!authorSet) {
            authorSet = new Set();
            this.claimsByAuthor.set(event.pubkey, authorSet);
          }
          authorSet.add(event.id);

          return ok(undefined);
        }

        case EventKind.Evidence: {
          const payload = parsed as KnowledgeEvidencePayload;
          const node: SemanticEvidenceNode = {
            id: event.id,
            authorPubkey: event.pubkey,
            createdAt: event.createdAt,
            payload,
          };
          this.evidence.set(event.id, node);

          const claim = this.claims.get(payload.targetClaimId);
          if (claim && !claim.evidenceIds.includes(event.id)) {
            claim.evidenceIds.push(event.id);
          }
          return ok(undefined);
        }

        case EventKind.Counterargument: {
          const payload = parsed as KnowledgeCounterargumentPayload;
          const node: SemanticCounterargumentNode = {
            id: event.id,
            authorPubkey: event.pubkey,
            createdAt: event.createdAt,
            payload,
          };
          this.counterarguments.set(event.id, node);

          const claim = this.claims.get(payload.targetClaimOrEvidenceId);
          if (claim && !claim.counterargumentIds.includes(event.id)) {
            claim.counterargumentIds.push(event.id);
          }
          return ok(undefined);
        }

        default:
          return ok(undefined); // Non-knowledge event safely skipped
      }
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e ?? 'Failed to parse knowledge event')));
    }
  }

  public getQuestion(id: string): SemanticQuestionNode | undefined {
    return this.questions.get(id);
  }

  public getAnswersForQuestion(questionId: string): readonly SemanticAnswerNode[] {
    const q = this.questions.get(questionId);
    if (!q) return [];
    return q.answerIds
      .map(id => this.answers.get(id))
      .filter((a): a is SemanticAnswerNode => a !== undefined);
  }

  public getClaim(id: string): SemanticClaimNode | undefined {
    return this.claims.get(id);
  }

  public getEvidenceForClaim(claimId: string): readonly SemanticEvidenceNode[] {
    const c = this.claims.get(claimId);
    if (!c) return [];
    return c.evidenceIds
      .map(id => this.evidence.get(id))
      .filter((e): e is SemanticEvidenceNode => e !== undefined);
  }

  public getCounterargumentsForClaim(claimId: string): readonly SemanticCounterargumentNode[] {
    const c = this.claims.get(claimId);
    if (!c) return [];
    return c.counterargumentIds
      .map(id => this.counterarguments.get(id))
      .filter((ca): ca is SemanticCounterargumentNode => ca !== undefined);
  }

  public getClaimsByDomain(domain: string): readonly SemanticClaimNode[] {
    const claimIds = this.claimsByDomain.get(domain.toLowerCase());
    if (!claimIds) return [];
    return Array.from(claimIds)
      .map(id => this.claims.get(id))
      .filter((c): c is SemanticClaimNode => c !== undefined);
  }

  /**
   * Computes epistemic consensus status and confidence score for a claim.
   */
  public resolveConsensus(claimId: string): {
    status: ConsensusStatus;
    netScore: number;
    evidenceCount: number;
    counterargumentCount: number;
  } {
    const claim = this.claims.get(claimId);
    if (!claim) {
      return {
        status: 'emerging',
        netScore: 0,
        evidenceCount: 0,
        counterargumentCount: 0,
      };
    }

    const evidenceList = this.getEvidenceForClaim(claimId);
    const counterList = this.getCounterargumentsForClaim(claimId);

    let evidenceWeight = 0;
    for (const ev of evidenceList) {
      evidenceWeight += ev.payload.reproducibilityScore ?? 0.7;
    }

    let counterWeight = 0;
    for (const ca of counterList) {
      if (ca.payload.rebuttalType === 'falsification') {
        counterWeight += 1.0;
      } else {
        counterWeight += 0.5;
      }
    }

    const totalWeight = evidenceWeight + counterWeight;
    const netScore = totalWeight > 0 ? (evidenceWeight - counterWeight) / totalWeight : 0;

    let status: ConsensusStatus = 'emerging';
    if (evidenceList.length === 0 && counterList.length === 0) {
      status = 'emerging';
    } else if (counterWeight > 1.5 && netScore < -0.4) {
      status = 'falsified';
    } else if (evidenceWeight >= 1.5 && counterWeight < 0.5 && netScore > 0.5) {
      status = 'strong_consensus';
    } else if (evidenceList.length > 0 && counterList.length > 0) {
      status = 'contested';
    } else if (evidenceList.length > 0) {
      status = 'emerging';
    }

    return {
      status,
      netScore: Number(netScore.toFixed(2)),
      evidenceCount: evidenceList.length,
      counterargumentCount: counterList.length,
    };
  }

  /**
   * Traverses and exports the full connected semantic subgraph for a question or claim.
   */
  public exportSemanticSubgraph(rootId: string): SemanticSubgraph {
    const question = this.questions.get(rootId);
    const claim = this.claims.get(rootId);

    const answers = question ? this.getAnswersForQuestion(rootId) : [];
    const evidence = claim ? this.getEvidenceForClaim(rootId) : [];
    const counterarguments = claim ? this.getCounterargumentsForClaim(rootId) : [];

    return {
      rootId,
      question,
      claim,
      answers,
      evidence,
      counterarguments,
    };
  }
}
