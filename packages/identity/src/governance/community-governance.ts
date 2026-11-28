import { bytesToHex, canonicalCborEncode, hexToBytes, sha256, signEd25519, verifyEd25519 } from '@sovra/crypto';
import { isValidSovraIdentityId } from '../sovra-id.js';
import { ValidationError } from '@sovra/shared';

export type SovraProposalCategory = 'SOVRA-P' | 'SOVRA-S' | 'SOVRA-A' | 'SOVRA-G' | 'SOVRA-O';

export type SovraProposalStage =
  | 'DRAFT'
  | 'DISCUSSION'
  | 'REVIEW'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'IMPLEMENTATION'
  | 'RELEASE';

export interface GovernanceReviewRecord {
  readonly reviewId: string;
  readonly proposalId: string;
  readonly reviewerId: string;
  readonly reviewerPublicKeyHex: string;
  readonly backwardCompatible: boolean;
  readonly securityReviewed: boolean;
  readonly approved: boolean;
  readonly notes: string;
  readonly signatureHex: string;
  readonly timestamp: number;
}

export interface GovernanceBallotRecord {
  readonly voteId: string;
  readonly proposalId: string;
  readonly voterId: string;
  readonly voterPublicKeyHex: string;
  readonly decision: 'YES' | 'NO' | 'ABSTAIN';
  readonly signatureHex: string;
  readonly timestamp: number;
}

export interface CommunityProposal {
  readonly proposalId: string;
  readonly category: SovraProposalCategory;
  readonly title: string;
  readonly specificationCid: string;
  readonly authorId: string;
  readonly authorPublicKeyHex: string;
  readonly backwardCompatibilityNotes: string;
  readonly securityConsiderations: string;
  readonly implementationUrlOrCid?: string | undefined;
  readonly migrationPlan?: string | undefined;
  stage: SovraProposalStage;
  readonly createdAt: number;
  readonly compulsoryTokenVoting: false; // Strictly token-free by Constitution
  readonly reviews: GovernanceReviewRecord[];
  readonly votes: Map<string, GovernanceBallotRecord>; // voterId -> ballot
  readonly releaseSignatures: Array<{ maintainerId: string; publicKeyHex: string; signatureHex: string }>;
}

export interface ForkDeclaration {
  readonly version: 1;
  readonly forkNetworkId: string;
  readonly parentNetworkId: string;
  readonly parentSpecificationCid: string;
  readonly reason: string;
  readonly initiatorId: string;
  readonly initiatorPublicKeyHex: string;
  readonly timestamp: number;
  readonly signatureHex: string;
}

const textEncoder = new TextEncoder();

function hashTagCbor(tag: string, payload: unknown): Uint8Array {
  const tb = textEncoder.encode(tag);
  const cb = canonicalCborEncode(payload);
  const combined = new Uint8Array(tb.length + cb.length);
  combined.set(tb, 0);
  combined.set(cb, tb.length);
  return sha256(combined);
}

/**
 * Spec-Exact Section 15 (RFC SOVRA-GOV v1.0) Community Governance Engine:
 * - Proposal categories: SOVRA-P, SOVRA-S, SOVRA-A, SOVRA-G, SOVRA-O
 * - Lifecycle: DRAFT -> DISCUSSION -> REVIEW -> ACCEPTED / REJECTED -> IMPLEMENTATION -> RELEASE
 * - Zero founder veto, zero compulsory token voting
 * - First-class fork rights (declareFork / verifyFork)
 */
export class CommunityGovernanceEngine {
  private readonly proposals = new Map<string, CommunityProposal>();
  private readonly forks = new Map<string, ForkDeclaration>();

  public createProposal(params: {
    category: SovraProposalCategory;
    title: string;
    specificationCid: string;
    authorId: string;
    authorPublicKeyHex: string;
    backwardCompatibilityNotes: string;
    securityConsiderations: string;
    migrationPlan?: string | undefined;
  }): CommunityProposal {
    if (!isValidSovraIdentityId(params.authorId)) {
      throw new ValidationError(`Invalid sovra1 authorId '${params.authorId}'`);
    }
    const now = Math.floor(Date.now() / 1000);
    const idHash = bytesToHex(
      hashTagCbor('SOVRA-GOV-PROP-v1', {
        category: params.category,
        title: params.title,
        specificationCid: params.specificationCid,
        authorId: params.authorId,
        createdAt: now,
      }),
    ).slice(0, 16);
    const proposalId = `${params.category.toLowerCase()}-${idHash}`;

    const prop: CommunityProposal = {
      proposalId,
      category: params.category,
      title: params.title,
      specificationCid: params.specificationCid,
      authorId: params.authorId,
      authorPublicKeyHex: params.authorPublicKeyHex,
      backwardCompatibilityNotes: params.backwardCompatibilityNotes,
      securityConsiderations: params.securityConsiderations,
      migrationPlan: params.migrationPlan,
      stage: 'DRAFT',
      createdAt: now,
      compulsoryTokenVoting: false,
      reviews: [],
      votes: new Map(),
      releaseSignatures: [],
    };
    this.proposals.set(proposalId, prop);
    return prop;
  }

  public advanceToDiscussion(proposalId: string): CommunityProposal {
    const p = this.mustGet(proposalId);
    if (p.stage !== 'DRAFT') throw new ValidationError(`Expected DRAFT stage, got ${p.stage}`);
    p.stage = 'DISCUSSION';
    return p;
  }

  public advanceToReview(proposalId: string): CommunityProposal {
    const p = this.mustGet(proposalId);
    if (p.stage !== 'DISCUSSION') throw new ValidationError(`Expected DISCUSSION stage, got ${p.stage}`);
    p.stage = 'REVIEW';
    return p;
  }

  public submitReview(params: {
    proposalId: string;
    reviewerId: string;
    reviewerPrivateKey: Uint8Array;
    reviewerPublicKey: Uint8Array;
    backwardCompatible: boolean;
    securityReviewed: boolean;
    approved: boolean;
    notes: string;
  }): GovernanceReviewRecord {
    const p = this.mustGet(params.proposalId);
    const timestamp = Math.floor(Date.now() / 1000);
    const unsigned = {
      proposalId: params.proposalId,
      reviewerId: params.reviewerId,
      backwardCompatible: params.backwardCompatible,
      securityReviewed: params.securityReviewed,
      approved: params.approved,
      notes: params.notes,
      timestamp,
    };
    const digest = hashTagCbor('SOVRA-GOV-REV-v1', unsigned);
    const signatureHex = bytesToHex(signEd25519(params.reviewerPrivateKey, digest));
    const review: GovernanceReviewRecord = {
      reviewId: `rev-${bytesToHex(digest).slice(0, 12)}`,
      ...unsigned,
      reviewerPublicKeyHex: bytesToHex(params.reviewerPublicKey),
      signatureHex,
    };
    p.reviews.push(review);
    return review;
  }

  public castVote(params: {
    proposalId: string;
    voterId: string;
    voterPrivateKey: Uint8Array;
    voterPublicKey: Uint8Array;
    decision: 'YES' | 'NO' | 'ABSTAIN';
  }): GovernanceBallotRecord {
    const p = this.mustGet(params.proposalId);
    if (!isValidSovraIdentityId(params.voterId)) {
      throw new ValidationError(`Invalid voter identity_id '${params.voterId}'`);
    }
    if (p.stage !== 'REVIEW' && p.stage !== 'DISCUSSION') {
      throw new ValidationError(`Voting closed in stage '${p.stage}'`);
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const unsigned = {
      proposalId: params.proposalId,
      voterId: params.voterId,
      decision: params.decision,
      timestamp,
    };
    const digest = hashTagCbor('SOVRA-GOV-VOTE-v1', unsigned);
    const signatureHex = bytesToHex(signEd25519(params.voterPrivateKey, digest));
    const ballot: GovernanceBallotRecord = {
      voteId: `vote-${bytesToHex(digest).slice(0, 12)}`,
      ...unsigned,
      voterPublicKeyHex: bytesToHex(params.voterPublicKey),
      signatureHex,
    };
    p.votes.set(params.voterId, ballot);
    return ballot;
  }

  public finalizeDecision(proposalId: string, minimumApprovals = 1): { stage: SovraProposalStage; yes: number; no: number; abstain: number } {
    const p = this.mustGet(proposalId);
    const validReviews = p.reviews.filter((r) => {
      const digest = hashTagCbor('SOVRA-GOV-REV-v1', {
        proposalId: r.proposalId,
        reviewerId: r.reviewerId,
        backwardCompatible: r.backwardCompatible,
        securityReviewed: r.securityReviewed,
        approved: r.approved,
        notes: r.notes,
        timestamp: r.timestamp,
      });
      return verifyEd25519(hexToBytes(r.reviewerPublicKeyHex), digest, hexToBytes(r.signatureHex));
    });
    const hasSecurityReview = validReviews.some((r) => r.securityReviewed && r.approved);

    let yes = 0;
    let no = 0;
    let abstain = 0;
    for (const v of p.votes.values()) {
      const digest = hashTagCbor('SOVRA-GOV-VOTE-v1', {
        proposalId: v.proposalId,
        voterId: v.voterId,
        decision: v.decision,
        timestamp: v.timestamp,
      });
      if (!verifyEd25519(hexToBytes(v.voterPublicKeyHex), digest, hexToBytes(v.signatureHex))) continue;
      if (v.decision === 'YES') yes++;
      else if (v.decision === 'NO') no++;
      else abstain++;
    }

    p.stage = hasSecurityReview && yes >= minimumApprovals && yes > no ? 'ACCEPTED' : 'REJECTED';
    return { stage: p.stage, yes, no, abstain };
  }

  public recordImplementation(proposalId: string, implementationCid: string): CommunityProposal {
    const p = this.mustGet(proposalId);
    if (p.stage !== 'ACCEPTED') {
      throw new ValidationError(`Proposal must be ACCEPTED before IMPLEMENTATION (got ${p.stage})`);
    }
    const updated: CommunityProposal = {
      ...p,
      implementationUrlOrCid: implementationCid,
      stage: 'IMPLEMENTATION',
    };
    this.proposals.set(proposalId, updated);
    return updated;
  }

  public publishRelease(
    proposalId: string,
    signers: readonly { maintainerId: string; privateKey: Uint8Array; publicKey: Uint8Array }[],
    minSigners = 2,
  ): CommunityProposal {
    const p = this.mustGet(proposalId);
    if (p.stage !== 'IMPLEMENTATION') {
      throw new ValidationError(`Proposal must complete IMPLEMENTATION before RELEASE (got ${p.stage})`);
    }
    if (signers.length < minSigners) {
      throw new ValidationError(`Release requires at least ${minSigners} independent maintainer signatures`);
    }
    const digest = hashTagCbor('SOVRA-GOV-REL-v1', {
      proposalId: p.proposalId,
      specificationCid: p.specificationCid,
      implementationCid: p.implementationUrlOrCid ?? '',
    });
    for (const s of signers) {
      p.releaseSignatures.push({
        maintainerId: s.maintainerId,
        publicKeyHex: bytesToHex(s.publicKey),
        signatureHex: bytesToHex(signEd25519(s.privateKey, digest)),
      });
    }
    p.stage = 'RELEASE';
    return p;
  }

  /**
   * Preserves constitutional fork rights (Section 15.3-15.4): any community member
   * can declare a signed protocol/network fork independently without founder consent.
   */
  public declareFork(params: {
    forkNetworkId: string;
    parentNetworkId: string;
    parentSpecificationCid: string;
    reason: string;
    initiatorId: string;
    initiatorPrivateKey: Uint8Array;
    initiatorPublicKey: Uint8Array;
  }): ForkDeclaration {
    const timestamp = Math.floor(Date.now() / 1000);
    const unsigned = {
      version: 1 as const,
      forkNetworkId: params.forkNetworkId,
      parentNetworkId: params.parentNetworkId,
      parentSpecificationCid: params.parentSpecificationCid,
      reason: params.reason,
      initiatorId: params.initiatorId,
      initiatorPublicKeyHex: bytesToHex(params.initiatorPublicKey),
      timestamp,
    };
    const digest = hashTagCbor('SOVRA-GOV-FORK-v1', unsigned);
    const fork: ForkDeclaration = {
      ...unsigned,
      signatureHex: bytesToHex(signEd25519(params.initiatorPrivateKey, digest)),
    };
    this.forks.set(params.forkNetworkId, fork);
    return fork;
  }

  public verifyForkDeclaration(fork: ForkDeclaration): boolean {
    const { signatureHex, ...unsigned } = fork;
    const digest = hashTagCbor('SOVRA-GOV-FORK-v1', unsigned);
    try {
      return verifyEd25519(hexToBytes(fork.initiatorPublicKeyHex), digest, hexToBytes(signatureHex));
    } catch {
      return false;
    }
  }

  public getProposal(proposalId: string): CommunityProposal | undefined {
    return this.proposals.get(proposalId);
  }

  private mustGet(proposalId: string): CommunityProposal {
    const p = this.proposals.get(proposalId);
    if (!p) throw new ValidationError(`Unknown proposal '${proposalId}'`);
    return p;
  }
}
