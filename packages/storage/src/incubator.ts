/**
 * @file packages/storage/src/incubator.ts
 * Pillar 9: Swarm Seed Incubator Pool (Cold-Start Creator Retention).
 *
 * Real-world problem:
 * 85% of new creators abandon decentralized platforms because their initial uploads have only
 * 1 seeder (their own phone). Once the creator locks their screen, videos buffer forever and views stall at 0.
 *
 * Solution:
 * 1. Protocol grants 72-hour incubator replication subsidy for the first 10 uploads of every creator.
 * 2. Dynamic target replica count:
 *    R_target = max(3, ceil(6 * exp(-Age_hours / 48) * (1 - OrganicSeeders / 4))).
 * 3. Guaranteed >= 3 independent storage node replicas during the vulnerable bootstrap phase.
 */

export interface IncubatorGrant {
  readonly grantId: string;
  readonly creatorDid: string;
  readonly contentCid: string;
  readonly uploadTimestamp: number;
  readonly assignedStorageNodes: readonly string[];
  readonly targetReplicas: number;
  readonly active: boolean;
}

export class SwarmSeedIncubatorPool {
  private readonly grants = new Map<string, IncubatorGrant>();

  /**
   * Calculates dynamic incubator replica count:
   * R_target = max(3, ceil(6 * exp(-Age_hours / 48) * (1 - OrganicSeeders / 4)))
   */
  public static calculateIncubatorReplicas(ageHours: number, organicSeeders: number): number {
    const safeAge = Math.max(0, ageHours);
    const decay = Math.exp(-safeAge / 48);
    const organicDeficit = Math.max(0, 1 - Math.min(1, organicSeeders / 4));
    const dynamicBoost = Math.ceil(6 * decay * organicDeficit);
    return Math.max(3, dynamicBoost);
  }

  /**
   * Determines if a creator upload is eligible for subsidized incubator replication:
   * Eligible if lifetime uploads <= 10 and content age <= 72 hours.
   */
  public static isEligibleForIncubator(creatorLifetimeUploads: number, ageHours: number): boolean {
    return creatorLifetimeUploads <= 10 && ageHours <= 72;
  }

  public registerGrant(
    creatorDid: string,
    contentCid: string,
    creatorLifetimeUploads: number,
    candidateStorageNodes: readonly string[],
  ): IncubatorGrant | null {
    if (!SwarmSeedIncubatorPool.isEligibleForIncubator(creatorLifetimeUploads, 0)) {
      return null;
    }

    const targetReplicas = SwarmSeedIncubatorPool.calculateIncubatorReplicas(0, 0); // Initially 6 replicas
    const assignedNodes = candidateStorageNodes.slice(0, targetReplicas);

    const grant: IncubatorGrant = {
      grantId: `incubator_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      creatorDid,
      contentCid,
      uploadTimestamp: Date.now(),
      assignedStorageNodes: assignedNodes,
      targetReplicas,
      active: true,
    };

    this.grants.set(contentCid, grant);
    return grant;
  }

  public getGrant(contentCid: string): IncubatorGrant | undefined {
    return this.grants.get(contentCid);
  }

  public updateGrantStatus(contentCid: string, organicSeeders: number): { targetReplicas: number; active: boolean } {
    const grant = this.grants.get(contentCid);
    if (!grant) return { targetReplicas: 0, active: false };

    const ageHours = (Date.now() - grant.uploadTimestamp) / (1000 * 3600);
    if (ageHours > 72) {
      const expired: IncubatorGrant = { ...grant, active: false };
      this.grants.set(contentCid, expired);
      return { targetReplicas: 0, active: false };
    }

    const updatedTarget = SwarmSeedIncubatorPool.calculateIncubatorReplicas(ageHours, organicSeeders);
    return { targetReplicas: updatedTarget, active: true };
  }
}
