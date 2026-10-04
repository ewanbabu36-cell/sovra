import { Result, ok } from '@sovra/shared';
import {
  generateHlsMasterPlaylist,
  generateHlsMediaPlaylist,
  VideoResolution,
  HlsStreamVariant,
  HlsVideoSegment,
} from '@sovra/storage';

export type { VideoResolution };
export * from './pipeline.js';

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
  readonly masterM3u8?: string | undefined;
}

export class TranscoderWorker {
  public generateMasterPlaylist(jobId: string, resolutions: readonly VideoResolution[]): string {
    const resolutionDimensions: Record<VideoResolution, { width: number; height: number; bandwidth: number }> = {
      '360p': { width: 640, height: 360, bandwidth: 800000 },
      '480p': { width: 854, height: 480, bandwidth: 1400000 },
      '720p': { width: 1280, height: 720, bandwidth: 2800000 },
      '1080p': { width: 1920, height: 1080, bandwidth: 5000000 },
    };

    const variants: HlsStreamVariant[] = resolutions.map(res => {
      const dim = resolutionDimensions[res];
      return {
        resolution: res,
        bandwidth: dim.bandwidth,
        width: dim.width,
        height: dim.height,
        uri: `${jobId}_${res}.m3u8`,
      };
    });

    return generateHlsMasterPlaylist(variants);
  }

  public generateMediaPlaylist(segments: readonly HlsVideoSegment[], targetDurationSeconds = 2): string {
    return generateHlsMediaPlaylist(segments, targetDurationSeconds);
  }

  public async transcode(job: TranscodeJob): Promise<Result<TranscodeResult>> {
    const dummyCids: Record<VideoResolution, string> = {
      '360p': `bafybei360p_${job.jobId}`,
      '480p': `bafybei480p_${job.jobId}`,
      '720p': `bafybei720p_${job.jobId}`,
      '1080p': `bafybei1080p_${job.jobId}`,
    };

    const masterM3u8 = this.generateMasterPlaylist(job.jobId, job.targetResolutions);

    return ok({
      jobId: job.jobId,
      masterManifestCid: `bafybeimaster_${job.jobId}`,
      resolutionCids: dummyCids,
      masterM3u8,
    });
  }
}

