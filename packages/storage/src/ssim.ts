/**
 * @file packages/storage/src/ssim.ts
 * Pillar 4: Perceptual SSIM Transcode Verification & GOP Worker Slashing.
 *
 * Real-world problem:
 * Mobile phones hit 46°C thermal limits and crash if transcoding raw 4K 60fps video locally.
 * Outsource to untrusted edge workers risks malicious frame injection, ad insertion, or corrupt downscaling.
 *
 * Solution:
 * 1. Computes mathematical Structural Similarity Metric (SSIM) between client keyframe fingerprints and transcoded outputs.
 * 2. Enforces SSIM >= 0.94 threshold.
 * 3. 2-of-3 GOP consensus quorum: Workers reporting SSIM < 0.94 have their stake slashed.
 * 4. Adaptive delegation: Local encode on nominal Wi-Fi, GOP split on throttled/cellular.
 */

export interface TranscodeWorkerSubmission {
  readonly workerPeerId: string;
  readonly gopIndex: number;
  readonly transcodedCid: string;
  readonly sampleFrameLuminance: readonly number[]; // Normalized 0-255 luminance samples
  readonly bondedStakeAmount: number;
}

export interface GopVerificationResult {
  readonly gopIndex: number;
  readonly verifiedCid: string | null;
  readonly consensusReached: boolean;
  readonly averageSsim: number;
  readonly passedWorkers: readonly string[];
  readonly slashedWorkers: readonly string[];
}

export class PerceptualSsimVerifier {
  private static readonly C1 = 6.5025; // (0.01 * 255)^2
  private static readonly C2 = 58.5225; // (0.03 * 255)^2
  public static readonly MIN_ACCEPTABLE_SSIM = 0.94;

  /**
   * Computes the standard Structural Similarity (SSIM) score between two luminance vectors:
   * SSIM(x, y) = ((2*mu_x*mu_y + C1)*(2*sigma_xy + C2)) / ((mu_x^2 + mu_y^2 + C1)*(sigma_x^2 + sigma_y^2 + C2))
   */
  public static calculateSSIM(x: readonly number[], y: readonly number[]): number {
    if (x.length === 0 || y.length === 0 || x.length !== y.length) {
      return 0.0;
    }

    const n = x.length;
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < n; i++) {
      sumX += x[i]!;
      sumY += y[i]!;
    }
    const muX = sumX / n;
    const muY = sumY / n;

    let varX = 0;
    let varY = 0;
    let covarXY = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i]! - muX;
      const dy = y[i]! - muY;
      varX += dx * dx;
      varY += dy * dy;
      covarXY += dx * dy;
    }
    const sigmaX2 = varX / n;
    const sigmaY2 = varY / n;
    const sigmaXY = covarXY / n;

    const numerator = (2 * muX * muY + this.C1) * (2 * sigmaXY + this.C2);
    const denominator = (muX * muX + muY * muY + this.C1) * (sigmaX2 + sigmaY2 + this.C2);

    if (denominator === 0) return 0.0;
    const rawSsim = numerator / denominator;
    return Math.max(0, Math.min(1, Math.round(rawSsim * 1000) / 1000));
  }

  /**
   * Evaluates GOP worker submissions against reference client keyframe fingerprint.
   * Enforces 2-of-3 quorum: at least 2 workers must meet SSIM >= 0.94 with agreeing CID.
   */
  public static verifyGopConsensus(
    referenceLuminance: readonly number[],
    submissions: readonly TranscodeWorkerSubmission[],
  ): GopVerificationResult {
    if (submissions.length === 0) {
      return {
        gopIndex: 0,
        verifiedCid: null,
        consensusReached: false,
        averageSsim: 0,
        passedWorkers: [],
        slashedWorkers: [],
      };
    }

    const gopIndex = submissions[0]!.gopIndex;
    const ssimScores: number[] = [];
    const passedWorkers: string[] = [];
    const slashedWorkers: string[] = [];
    const cidVotes = new Map<string, number>();

    for (const sub of submissions) {
      const score = this.calculateSSIM(referenceLuminance, sub.sampleFrameLuminance);
      ssimScores.push(score);

      if (score >= this.MIN_ACCEPTABLE_SSIM) {
        passedWorkers.push(sub.workerPeerId);
        cidVotes.set(sub.transcodedCid, (cidVotes.get(sub.transcodedCid) ?? 0) + 1);
      } else {
        slashedWorkers.push(sub.workerPeerId);
      }
    }

    const avgSsim =
      ssimScores.reduce((a, b) => a + b, 0) / (ssimScores.length || 1);

    // Find highest voted CID with at least 2 votes
    let winningCid: string | null = null;
    for (const [cid, votes] of cidVotes.entries()) {
      if (votes >= 2) {
        winningCid = cid;
        break;
      }
    }

    return {
      gopIndex,
      verifiedCid: winningCid,
      consensusReached: winningCid !== null,
      averageSsim: Math.round(avgSsim * 1000) / 1000,
      passedWorkers,
      slashedWorkers,
    };
  }

  /**
   * Evaluates whether device should perform local transcoding or delegate to edge GOP workers.
   */
  public static shouldDelegateTranscode(
    thermalThrottled: boolean,
    isCellular: boolean,
    videoDurationSec: number,
  ): boolean {
    if (thermalThrottled) return true;
    if (isCellular && videoDurationSec > 15) return true;
    return false;
  }
}
