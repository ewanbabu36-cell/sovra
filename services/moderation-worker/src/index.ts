import { Result, ok } from '@sovra/shared';
import { SafetyScanResult } from '@sovra/moderation';

export interface ScanJob {
  readonly jobId: string;
  readonly contentCid: string;
  readonly mimeType: string;
}

export class ModerationWorker {
  public async scanContent(job: ScanJob): Promise<Result<SafetyScanResult>> {
    return ok({
      contentCid: job.contentCid,
      overallScore: 0.05,
      visualScore: 0.05,
      videoFrameScores: [],
      textOcrScore: 0.01,
      metadataScore: 0.01,
      detectedCategories: [],
      isProtectedExpression: true,
      hashMatches: [],
      suggestedDecision: 'ALLOW',
      evaluatedAt: Date.now(),
    });
  }
}
