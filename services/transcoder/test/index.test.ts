import { describe, it, expect } from 'vitest';
import { TranscoderWorker, TranscodeJob } from '../src/index.js';

describe('@sovra/transcoder', () => {
  it('processes multi-resolution transcode job definitions', async () => {
    const worker = new TranscoderWorker();
    const job: TranscodeJob = {
      jobId: 'job-1',
      sourceCid: 'bafybeirawvideo',
      targetResolutions: ['360p', '720p', '1080p'],
      segmentDurationSeconds: 4,
    };

    const res = await worker.transcode(job);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.resolutionCids['720p']).toBeDefined();
    }
  });
});
