/**
 * @file packages/social/src/spectral.ts
 * Pillar 10: Spectral Graph Conductance & EigenTrust Sybil Ring Isolation.
 *
 * Real-world problem:
 * 50,000 bot accounts mutually follow and upvote each other in a closed clique.
 * Simple social proximity metrics rank their spam posts highly on unsuspecting users' feeds.
 *
 * Solution:
 * 1. Computes cluster boundary conductance Phi_S = CutWeight(S, not S) / min(Vol(S), Vol(not S)).
 * 2. Closed, isolated collusion rings exhibit near-zero conductance (Phi_S < 0.03).
 * 3. Applies non-linear trust discount Omega_trust:
 *    - Phi_S < 0.03 => 0.0 (Complete zero-weight isolation)
 *    - 0.03 <= Phi_S < 0.15 => ((Phi_S - 0.03) / 0.12)^1.5
 *    - Phi_S >= 0.15 => 1.0 (Healthy organic interconnected cluster)
 */

export interface ClusterConductanceEvaluation {
  readonly clusterId: string;
  readonly internalEdges: number;
  readonly boundaryCutEdges: number;
  readonly volumeS: number;
  readonly volumeNotS: number;
  readonly conductance: number;
  readonly trustDiscount: number;
  readonly isSybilRing: boolean;
  readonly explanation: string;
}

export class SpectralGraphConductanceEngine {
  public static readonly SYBIL_CONDUCTANCE_CUTOFF = 0.03;
  public static readonly HEALTHY_CONDUCTANCE_MIN = 0.15;

  /**
   * Computes graph topological conductance Phi_S:
   * Phi_S = BoundaryCutWeight / min(Volume_S, Volume_not_S)
   */
  public static calculateConductance(
    boundaryCutEdges: number,
    volumeS: number,
    volumeNotS: number,
  ): number {
    const minVol = Math.min(volumeS, volumeNotS);
    if (minVol <= 0) return 0.0;

    const raw = boundaryCutEdges / minVol;
    return Math.max(0.0, Math.min(1.0, Math.round(raw * 1000) / 1000));
  }

  /**
   * Computes Sybil Ring Trust Discount Omega_trust(S):
   * - Phi_S < 0.03 => 0.0
   * - 0.03 <= Phi_S < 0.15 => ((Phi_S - 0.03) / 0.12)^1.5
   * - Phi_S >= 0.15 => 1.0
   */
  public static calculateTrustDiscount(conductance: number): number {
    if (conductance < this.SYBIL_CONDUCTANCE_CUTOFF) {
      return 0.0;
    }

    if (conductance >= this.HEALTHY_CONDUCTANCE_MIN) {
      return 1.0;
    }

    const ratio = (conductance - this.SYBIL_CONDUCTANCE_CUTOFF) / (this.HEALTHY_CONDUCTANCE_MIN - this.SYBIL_CONDUCTANCE_CUTOFF);
    const score = Math.pow(ratio, 1.5);
    return Math.round(score * 1000) / 1000;
  }

  /**
   * Evaluates a subgraph cluster to determine if it is an isolated Sybil collusion clique.
   */
  public static evaluateCluster(
    clusterId: string,
    internalEdges: number,
    boundaryCutEdges: number,
    volumeNotS: number,
  ): ClusterConductanceEvaluation {
    const volumeS = internalEdges * 2 + boundaryCutEdges;
    const conductance = this.calculateConductance(boundaryCutEdges, volumeS, volumeNotS);
    const trustDiscount = this.calculateTrustDiscount(conductance);
    const isSybilRing = trustDiscount === 0.0;

    const explanation = isSybilRing
      ? `Conductance ${conductance} < 0.03 indicates isolated collusion ring with no organic inbound trust. All engagement discounted to 0.0.`
      : trustDiscount < 1.0
        ? `Conductance ${conductance} reflects peripheral community. Discounting engagement by ${(1 - trustDiscount) * 100}%.`
        : `Conductance ${conductance} >= 0.15 reflects healthy, well-integrated organic community. Full engagement weight applied.`;

    return {
      clusterId,
      internalEdges,
      boundaryCutEdges,
      volumeS,
      volumeNotS,
      conductance,
      trustDiscount,
      isSybilRing,
      explanation,
    };
  }
}
