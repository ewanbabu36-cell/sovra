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

  it('runs complete VideoIngestionPipeline producing master m3u8 and 4 resolution variants', async () => {
    const { VideoIngestionPipeline } = await import('../src/index.js');
    const pipeline = new VideoIngestionPipeline();

    const result = await pipeline.processVideo({
      mediaId: 'reel-demo-99',
      creatorDid: 'did:key:z6MksAliceCreatorP2P',
      title: 'P2P Decentralized Reels Master',
      durationSeconds: 15,
      targetResolutions: ['1080p', '720p', '480p', '360p'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pkg = result.value;
    expect(pkg.mediaId).toBe('reel-demo-99');
    expect(pkg.masterManifestCid).toMatch(/^bafybei_master_/);
    expect(pkg.segment0Cid).toMatch(/^bafkrei_/);
    expect(pkg.variants).toHaveLength(4);

    // Verify 1080p variant
    const v1080 = pkg.variants.find(v => v.resolution === '1080p');
    expect(v1080).toBeDefined();
    expect(v1080?.segments.length).toBe(8); // 15s / 2s segments = 8 segments
    expect(v1080?.mediaM3u8).toContain('#EXTM3U');
    expect(v1080?.mediaM3u8).toContain('#EXTINF:2');

    // Verify Master playlist contains all 4 stream variants
    expect(pkg.masterM3u8).toContain('RESOLUTION=1920x1080');
    expect(pkg.masterM3u8).toContain('RESOLUTION=1280x720');
    expect(pkg.masterM3u8).toContain('RESOLUTION=854x480');
    expect(pkg.masterM3u8).toContain('RESOLUTION=640x360');
  });
});
