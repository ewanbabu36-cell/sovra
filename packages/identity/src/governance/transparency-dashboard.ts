/**
 * @file packages/identity/src/governance/transparency-dashboard.ts
 * SOVRA Public Transparency Dashboard & Verifiable State Aggregator.
 *
 * Enforces:
 * 1. Radical economic transparency: 100M SOV cap invariant, burned tokens, circulating supply.
 * 2. Treasury flow reporting: pending multi-sig approvals, executed grants.
 * 3. Governance health: active proposals, quadratic voter participation, quorum statistics.
 * 4. Audit chain integrity reporting: head hash and cryptographic verification state.
 * 5. Founder milestone & succession status: milestone progression, pseudonymity posture.
 */

import { TamperEvidentAuditLog } from './audit-log.js';
import { FounderIdentityRegistry } from './founder-identity.js';
import { SuccessionManagementEngine } from './succession.js';

export interface PublicCoinMetrics {
  readonly maxLifetimeSupplyMicroSov: bigint; // 100,000,000 SOV = 10^14 micro-SOV
  readonly issuedSupplyMicroSov: bigint;
  readonly permanentlyBurnedMicroSov: bigint;
  readonly circulatingSupplyMicroSov: bigint;
  readonly capInvariantPreserved: boolean;
}

export interface PublicTreasuryMetrics {
  readonly treasuryVaultBalanceMicroSov: bigint;
  readonly pendingMultiPartyActionsCount: number;
  readonly totalGrantsDistributedMicroSov: bigint;
}

export interface PublicGovernanceMetrics {
  readonly activeProposalsCount: number;
  readonly passedProposalsCount: number;
  readonly rejectedProposalsCount: number;
  readonly totalRegisteredVoters: number;
}

export interface PublicTransparencyReport {
  readonly generatedAt: number;
  readonly networkVersion: string;
  readonly coinMetrics: PublicCoinMetrics;
  readonly treasuryMetrics: PublicTreasuryMetrics;
  readonly governanceMetrics: PublicGovernanceMetrics;
  readonly auditChainMetrics: {
    readonly totalEntries: number;
    readonly headHash: string;
    readonly chainIntegrityValid: boolean;
  };
  readonly founderStatus: {
    readonly pseudonym: string;
    readonly currentMilestone: number;
    readonly revealStatus: string;
    readonly successionState: string;
  };
}

export class PublicTransparencyDashboard {
  public static readonly MAX_SUPPLY_MICRO_SOV = 100_000_000_000_000n; // 100M SOV * 10^6

  /**
   * Generates the comprehensive, cryptographically verifiable public transparency report.
   */
  public static generateReport(params: {
    issuedSupplyMicroSov: bigint;
    permanentlyBurnedMicroSov: bigint;
    treasuryBalanceMicroSov: bigint;
    pendingActionsCount: number;
    totalGrantsDistributedMicroSov: bigint;
    activeProposalsCount: number;
    passedProposalsCount: number;
    rejectedProposalsCount: number;
    totalRegisteredVoters: number;
    auditLog: TamperEvidentAuditLog;
    founderRegistry?: FounderIdentityRegistry;
    successionEngine?: SuccessionManagementEngine;
    currentTime?: number;
  }): PublicTransparencyReport {
    const circulating = params.issuedSupplyMicroSov - params.permanentlyBurnedMicroSov;
    const capPreserved = params.issuedSupplyMicroSov <= this.MAX_SUPPLY_MICRO_SOV;

    const auditVerification = params.auditLog.verifyChainIntegrity();

    let founderStatus = {
      pseudonym: 'UNREGISTERED',
      currentMilestone: 1,
      revealStatus: 'PSEUDONYMOUS',
      successionState: 'INACTIVE',
    };

    if (params.founderRegistry) {
      try {
        const p = params.founderRegistry.getPublicProfile();
        founderStatus = {
          pseudonym: p.pseudonym,
          currentMilestone: p.currentMilestone,
          revealStatus: p.revealStatus,
          successionState: params.successionEngine?.getRecord().state ?? 'ACTIVE_FOUNDER',
        };
      } catch {
        // Unregistered founder profile
      }
    }

    return {
      generatedAt: params.currentTime ?? Math.floor(Date.now() / 1000),
      networkVersion: '1.0.0-governance',
      coinMetrics: {
        maxLifetimeSupplyMicroSov: this.MAX_SUPPLY_MICRO_SOV,
        issuedSupplyMicroSov: params.issuedSupplyMicroSov,
        permanentlyBurnedMicroSov: params.permanentlyBurnedMicroSov,
        circulatingSupplyMicroSov: circulating,
        capInvariantPreserved: capPreserved,
      },
      treasuryMetrics: {
        treasuryVaultBalanceMicroSov: params.treasuryBalanceMicroSov,
        pendingMultiPartyActionsCount: params.pendingActionsCount,
        totalGrantsDistributedMicroSov: params.totalGrantsDistributedMicroSov,
      },
      governanceMetrics: {
        activeProposalsCount: params.activeProposalsCount,
        passedProposalsCount: params.passedProposalsCount,
        rejectedProposalsCount: params.rejectedProposalsCount,
        totalRegisteredVoters: params.totalRegisteredVoters,
      },
      auditChainMetrics: {
        totalEntries: auditVerification.totalEntries,
        headHash: auditVerification.headHash,
        chainIntegrityValid: auditVerification.valid,
      },
      founderStatus,
    };
  }
}
