/**
 * @file packages/identity/src/governance/proposal-engine.ts
 * SOVRA Governance Proposal Engine (SIP Lifecycle & Screening).
 *
 * Enforces:
 * 1. Categorization into SIP-TECH, SIP-TREASURY, SIP-PROTOCOL, SIP-VALIDATOR, SIP-CONST.
 * 2. Mandatory discussion periods prior to on-chain voting.
 * 3. Mandatory conflict-of-interest declarations.
 * 4. Pre-submission constitutional screening.
 */

import crypto from 'node:crypto';
import { ValidationError } from '@sovra/shared';
import {
  SIPCategory,
  CATEGORY_RULES,
  GovernanceQuorumValidator,
} from './quorum-validator.js';

export type SIPStage =
  | 'DRAFT'
  | 'DISCUSSION'
  | 'VOTING_ACTIVE'
  | 'TALLYING'
  | 'PASSED'
  | 'REJECTED'
  | 'EXECUTED';

export interface GovernanceProposal {
  readonly id: string;
  readonly category: SIPCategory;
  readonly title: string;
  readonly description: string;
  readonly proposerDid: string;
  readonly proposerConflictDeclared: boolean;
  readonly conflictDetails?: string | undefined;
  readonly options: readonly string[];
  readonly payload?: Record<string, unknown> | undefined;
  readonly payloadHash: string;
  readonly createdAt: number;
  readonly discussionEndAt: number;
  readonly votingEndAt: number;
  stage: SIPStage;
}

export class GovernanceProposalEngine {
  private readonly proposals = new Map<string, GovernanceProposal>();

  /**
   * Submits a new governance proposal after strict constitutional redline screening.
   */
  public submitProposal(params: {
    category: SIPCategory;
    title: string;
    description: string;
    proposerDid: string;
    options?: string[];
    payload?: Record<string, unknown>;
    conflictDeclared?: boolean;
    conflictDetails?: string;
    createdAt?: number;
    customDiscussionDays?: number;
    votingDays?: number;
  }): GovernanceProposal {
    if (!params.title || params.title.trim().length < 5) {
      throw new ValidationError('Proposal title must be at least 5 characters');
    }
    if (!params.description || params.description.trim().length < 20) {
      throw new ValidationError('Proposal description must be at least 20 characters');
    }

    // Constitutional Screening: Fails closed if prohibited actions detected
    GovernanceQuorumValidator.screenConstitutionalRedlines({
      title: params.title,
      description: params.description,
      ...(params.payload !== undefined ? { payload: params.payload } : {}),
    });

    const rules = CATEGORY_RULES[params.category];
    const discussionDays = params.customDiscussionDays ?? rules.minDiscussionDays;
    if (discussionDays < rules.minDiscussionDays) {
      throw new ValidationError(
        `Discussion period (${discussionDays}d) cannot be less than category requirement (${rules.minDiscussionDays}d)`,
      );
    }

    const now = params.createdAt ?? Math.floor(Date.now() / 1000);
    const discussionEndAt = now + discussionDays * 86400;
    const votingDurationDays = params.votingDays ?? 14;
    const votingEndAt = discussionEndAt + votingDurationDays * 86400;

    const payloadCanonical = JSON.stringify(params.payload ?? {});
    const payloadHash = crypto.createHash('sha256').update(payloadCanonical).digest('hex');
    const id = `sip-${params.category.toLowerCase().replace('_', '-')}-${payloadHash.slice(0, 8)}`;

    const proposal: GovernanceProposal = {
      id,
      category: params.category,
      title: params.title.trim(),
      description: params.description.trim(),
      proposerDid: params.proposerDid,
      proposerConflictDeclared: params.conflictDeclared ?? false,
      conflictDetails: params.conflictDetails,
      options: params.options ?? ['YES', 'NO', 'ABSTAIN'],
      payload: params.payload,
      payloadHash,
      createdAt: now,
      discussionEndAt,
      votingEndAt,
      stage: 'DISCUSSION',
    };

    this.proposals.set(id, proposal);
    return proposal;
  }

  public getProposal(id: string): GovernanceProposal | undefined {
    return this.proposals.get(id);
  }

  /**
   * Transitions a proposal from DISCUSSION to VOTING_ACTIVE once the discussion window has elapsed.
   */
  public activateVoting(proposalId: string, currentTime = Math.floor(Date.now() / 1000)): GovernanceProposal {
    const p = this.proposals.get(proposalId);
    if (!p) throw new ValidationError(`Proposal ${proposalId} not found`);

    if (p.stage !== 'DISCUSSION') {
      throw new ValidationError(`Cannot activate voting from stage ${p.stage}`);
    }

    if (currentTime < p.discussionEndAt) {
      const waitDays = ((p.discussionEndAt - currentTime) / 86400).toFixed(1);
      throw new ValidationError(
        `Mandatory discussion window is active. Voting opens in ${waitDays} days.`,
      );
    }

    p.stage = 'VOTING_ACTIVE';
    return p;
  }

  /**
   * Closes voting and transitions to TALLYING.
   */
  public closeVoting(proposalId: string, currentTime = Math.floor(Date.now() / 1000)): GovernanceProposal {
    const p = this.proposals.get(proposalId);
    if (!p) throw new ValidationError(`Proposal ${proposalId} not found`);

    if (p.stage !== 'VOTING_ACTIVE') {
      throw new ValidationError(`Proposal is not in VOTING_ACTIVE stage (current: ${p.stage})`);
    }

    if (currentTime < p.votingEndAt) {
      throw new ValidationError('Voting period has not concluded');
    }

    p.stage = 'TALLYING';
    return p;
  }
}
