/**
 * @file packages/protocol/src/dispute-bond.ts
 * Pillar 7: Stake-Backed Dispute Bonds & Restitution (Anti-Extortion Legal Shield).
 *
 * Real-world problem:
 * Zero-cost automated DMCA notice flooding overwhelms oracle nodes and extorts creators.
 * Attackers submit 10,000 false claims/hour to suppress rival news channels or freeze creator feeds.
 *
 * Solution:
 * 1. Financial friction: Complainants must stake a dispute bond scaled to creator popularity and inverse reputation:
 *    Bond = BaseStake * (1 + log10(CreatorViews24h)) * (1 / ComplainantReputation).
 * 2. Slashing & Restitution: If appeal proves takedown was fraudulent, 90% of complainant's bond
 *    is paid directly to the victim creator for downtime damages, 10% to verifiers.
 * 3. VRF rotating oracle selection from bonded verifiers.
 */

export interface DisputeNotice {
  readonly disputeId: string;
  readonly contentCid: string;
  readonly creatorDid: string;
  readonly complainantDid: string;
  readonly reasonCode: 'DMCA_COPYRIGHT' | 'DEFAMATION' | 'CSAM_TERROR' | 'IMPERSONATION';
  readonly creatorViews24h: number;
  readonly complainantReputation: number; // 0.01 to 1.0
  readonly stakedBondAmount: bigint;
  readonly createdAt: number;
  readonly status: 'pending' | 'resolved_valid' | 'resolved_fraudulent_slashed';
}

export interface DisputeResolutionResult {
  readonly disputeId: string;
  readonly isTakedownUpheld: boolean;
  readonly bondSlashed: boolean;
  readonly creatorRestitutionAmount: bigint;
  readonly verifierRewardAmount: bigint;
  readonly refundToComplainant: bigint;
}

export class StakeBackedDisputeBondManager {
  private readonly disputes = new Map<string, DisputeNotice>();

  /**
   * Calculates dynamic bond required to file a takedown notice:
   * Bond = BaseStake * (1 + log10(max(1, CreatorViews24h))) * (1 / max(0.05, ComplainantReputation))
   */
  public static calculateRequiredBond(
    baseStake: bigint,
    creatorViews24h: number,
    complainantReputation: number,
  ): bigint {
    const safeViews = Math.max(1, creatorViews24h);
    const viewFactor = 1.0 + Math.log10(safeViews);
    const safeRep = Math.max(0.05, Math.min(1.0, complainantReputation));
    const repFactor = 1.0 / safeRep;

    const totalMultiplier = viewFactor * repFactor;
    return (baseStake * BigInt(Math.round(totalMultiplier * 100))) / 100n;
  }

  public registerDispute(
    contentCid: string,
    creatorDid: string,
    complainantDid: string,
    reasonCode: DisputeNotice['reasonCode'],
    creatorViews24h: number,
    complainantReputation: number,
    baseStake: bigint,
  ): DisputeNotice {
    const requiredBond = StakeBackedDisputeBondManager.calculateRequiredBond(
      baseStake,
      creatorViews24h,
      complainantReputation,
    );

    const dispute: DisputeNotice = {
      disputeId: `disp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      contentCid,
      creatorDid,
      complainantDid,
      reasonCode,
      creatorViews24h,
      complainantReputation,
      stakedBondAmount: requiredBond,
      createdAt: Date.now(),
      status: 'pending',
    };

    this.disputes.set(dispute.disputeId, dispute);
    return dispute;
  }

  public resolveDispute(
    disputeId: string,
    upheldByOracles: boolean,
  ): DisputeResolutionResult {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) {
      throw new Error(`Dispute ${disputeId} not found`);
    }

    if (upheldByOracles) {
      // Legitimate takedown: refund complainant bond
      const resolved: DisputeNotice = { ...dispute, status: 'resolved_valid' };
      this.disputes.set(disputeId, resolved);
      return {
        disputeId,
        isTakedownUpheld: true,
        bondSlashed: false,
        creatorRestitutionAmount: 0n,
        verifierRewardAmount: 0n,
        refundToComplainant: dispute.stakedBondAmount,
      };
    }

    // Fraudulent / rejected takedown: slash bond
    // 90% to creator for damages, 10% to verifiers
    const creatorRestitution = (dispute.stakedBondAmount * 90n) / 100n;
    const verifierReward = dispute.stakedBondAmount - creatorRestitution;

    const resolved: DisputeNotice = { ...dispute, status: 'resolved_fraudulent_slashed' };
    this.disputes.set(disputeId, resolved);

    return {
      disputeId,
      isTakedownUpheld: false,
      bondSlashed: true,
      creatorRestitutionAmount: creatorRestitution,
      verifierRewardAmount: verifierReward,
      refundToComplainant: 0n,
    };
  }

  public getDispute(disputeId: string): DisputeNotice | undefined {
    return this.disputes.get(disputeId);
  }
}
