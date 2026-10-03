import { Result, ok } from '@sovra/shared';

export type VideoResolution = '360p' | '480p' | '720p' | '1080p';

export interface TranscodeJob {
  readonly jobId: string;
  readonly sourceCid: string;
  readonly targetResolutions: readonly VideoResolution[];
  readonly segmentDurationSeconds: number;
}

export interface TranscodeResult {
  readonly jobId: string;
  readonly masterManifestCid: string;
  readonly resolutionCids: Readonly<Record<VideoResolution, string>>;
}

export class TranscoderWorker {
  public async transcode(job: TranscodeJob): Promise<Result<TranscodeResult>> {
    const dummyCids: Record<VideoResolution, string> = {
      '360p': 'bafybei360p',
      '480p': 'bafybei480p',
      '720p': 'bafybei720p',
      '1080p': 'bafybei1080p',
    };
    return ok({
      jobId: job.jobId,
      masterManifestCid: 'bafybeimaster',
      resolutionCids: dummyCids,
    });
  }
}
