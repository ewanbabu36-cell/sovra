/**
 * @file packages/identity/src/governance/quorum-validator.ts
 * SOVRA Governance Quorum Validator & Constitutional Redline Screener.
 *
 * Enforces:
 * 1. Participation quorum verification based on proposal category.
 * 2. Supermajority threshold calculation.
 * 3. Fail-closed rejection of unconstitutional proposals (forced de-anonymization,
 *    inflation past 100M, ledger reversal, E2EE backdoors, founder veto).
 */

import { ValidationError } from '@sovra/shared';

export type SIPCategory =
  | 'SIP_TECH'
  | 'SIP_TREASURY'
  | 'SIP_PROTOCOL'
  | 'SIP_VALIDATOR'
  | 'SIP_CONST';

export interface CategoryRule {
  readonly minDiscussionDays: number;
  readonly minQuorumPercentage: number;
  readonly supermajorityPercentage: number;
  readonly timelockHours: number;
}

export const CATEGORY_RULES: Record<SIPCategory, CategoryRule> = {
  SIP_TECH: {
    minDiscussionDays: 14,
    minQuorumPercentage: 0.10, // 10%
    supermajorityPercentage: 0.50, // >50%
    timelockHours: 48,
  },
  SIP_TREASURY: {
    minDiscussionDays: 21,
    minQuorumPercentage: 0.15, // 15%
    supermajorityPercentage: 0.60, // 60%
    timelockHours: 72,
  },
  SIP_PROTOCOL: {
    minDiscussionDays: 30,
    minQuorumPercentage: 0.25, // 25%
    supermajorityPercentage: 0.667, // 66.7%
    timelockHours: 168, // 7 days
  },
  SIP_VALIDATOR: {
    minDiscussionDays: 30,
    minQuorumPercentage: 0.20, // 20%
    supermajorityPercentage: 0.667, // 66.7%
    timelockHours: 168,
  },
  SIP_CONST: {
    minDiscussionDays: 90,
    minQuorumPercentage: 0.50, // 50%
    supermajorityPercentage: 0.80, // 80%
    timelockHours: 336, // 14 days
  },
};

export class GovernanceQuorumValidator {
  /**
   * Verifies if participation satisfies the required quorum and supermajority threshold.
   */
  public static validateQuorumAndTally(params: {
    category: SIPCategory;
    totalCastWeight: number;
    totalEligibleDIDs: number;
    yesWeight: number;
    noWeight: number;
    abstainWeight?: number;
  }): {
    quorumReached: boolean;
    quorumPercentage: number;
    thresholdMet: boolean;
    yesRatio: number;
    passed: boolean;
    details: string;
  } {
    const rules = CATEGORY_RULES[params.category];
    const totalEligible = Math.max(1, params.totalEligibleDIDs);
    const quorumPercentage = params.totalCastWeight / totalEligible;
    const quorumReached = quorumPercentage >= rules.minQuorumPercentage;

    const decisiveWeight = params.yesWeight + params.noWeight;
    const yesRatio = decisiveWeight > 0 ? params.yesWeight / decisiveWeight : 0;
    const thresholdMet = yesRatio >= rules.supermajorityPercentage;

    const passed = quorumReached && thresholdMet;

    const details = passed
      ? `PASSED: Quorum (${(quorumPercentage * 100).toFixed(1)}% >= ${(rules.minQuorumPercentage * 100).toFixed(0)}%) and approval (${(yesRatio * 100).toFixed(1)}% >= ${(rules.supermajorityPercentage * 100).toFixed(0)}%) satisfied.`
      : !quorumReached
        ? `FAILED: Quorum not met (${(quorumPercentage * 100).toFixed(1)}% < ${(rules.minQuorumPercentage * 100).toFixed(0)}% required).`
        : `FAILED: Approval threshold not met (${(yesRatio * 100).toFixed(1)}% < ${(rules.supermajorityPercentage * 100).toFixed(0)}% required).`;

    return {
      quorumReached,
      quorumPercentage,
      thresholdMet,
      yesRatio,
      passed,
      details,
    };
  }

  /**
   * Constitutional Redline Screening:
   * Inspects proposal title, description, and payload for forbidden patterns.
   * Fails closed immediately if any redline is breached.
   */
  public static screenConstitutionalRedlines(proposal: {
    title: string;
    description: string;
    payload?: Record<string, unknown>;
  }): void {
    const combined = `${proposal.title} ${proposal.description} ${JSON.stringify(proposal.payload ?? {})}`.toLowerCase();

    // 1. Forced de-anonymization / Unmasking
    const forcedRevealPatterns = [
      'force reveal',
      'compel identity',
      'unmask founder',
      'doxx founder',
      'disclose legal name',
      'mandatory kyc founder',
      'compulsory identity disclosure',
    ];
    for (const p of forcedRevealPatterns) {
      if (combined.includes(p)) {
        throw new ValidationError(
          `CONSTITUTIONAL REDLINE BREACH: Proposal attempts compulsory de-anonymization ("${p}"). Strictly prohibited by SOVRA Constitution Invariant 5 and GOV-POL-001.`,
        );
      }
    }

    // 2. Monetary inflation beyond 100,000,000 SOV
    if (
      combined.includes('inflate cap') ||
      combined.includes('increase supply ceiling') ||
      combined.includes('mint beyond 100m')
    ) {
      throw new ValidationError(
        'CONSTITUTIONAL REDLINE BREACH: Proposal attempts to breach 100,000,000 SOV hard cap (Invariant 1).',
      );
    }

    // 3. Balance confiscation / Ledger reversal
    if (
      combined.includes('confiscate balance') ||
      combined.includes('reverse transaction') ||
      combined.includes('burn user wallet')
    ) {
      throw new ValidationError(
        'CONSTITUTIONAL REDLINE BREACH: Proposal attempts arbitrary ledger confiscation (Invariant 3).',
      );
    }

    // 4. E2EE Backdoors or Escrow
    if (
      combined.includes('e2ee escrow') ||
      combined.includes('master decryption key') ||
      combined.includes('backdoor messaging')
    ) {
      throw new ValidationError(
        'CONSTITUTIONAL REDLINE BREACH: Proposal attempts to compromise E2EE privacy (Invariant 4).',
      );
    }

    // 5. Founder unilateral veto
    if (
      combined.includes('founder veto') ||
      combined.includes('grant founder override') ||
      combined.includes('master administrative override')
    ) {
      throw new ValidationError(
        'CONSTITUTIONAL REDLINE BREACH: Proposal attempts to assign unilateral founder override (Invariant 2).',
      );
    }
  }
}
