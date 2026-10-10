import { describe, it, expect } from 'vitest';
import { TranscoderWorker } from '../../services/transcoder/dist/index.js';

describe('Sovra Automated Background HLS Video Transcoder', () => {
  const worker = new TranscoderWorker();

  it('generates compliant RFC 8216 HLS Master Playlist across multi-bitrate resolutions', () => {
    const resolutions = ['1080p', '720p', '480p', '360p'] as const;
    const masterM3u8 = worker.generateMasterPlaylist('test_vid_cid_123', resolutions);

    expect(masterM3u8).toContain('#EXTM3U');
    expect(masterM3u8).toContain('BANDWIDTH=5000000,RESOLUTION=1920x1080');
    expect(masterM3u8).toContain('BANDWIDTH=2800000,RESOLUTION=1280x720');
    expect(masterM3u8).toContain('BANDWIDTH=1400000,RESOLUTION=854x480');
    expect(masterM3u8).toContain('BANDWIDTH=800000,RESOLUTION=640x360');
    expect(masterM3u8).toContain('test_vid_cid_123_1080p.m3u8');
    expect(masterM3u8).toContain('test_vid_cid_123_720p.m3u8');
    expect(masterM3u8).toContain('test_vid_cid_123_480p.m3u8');
    expect(masterM3u8).toContain('test_vid_cid_123_360p.m3u8');
  });

  it('transcodes a video job into multi-bitrate HLS package with segment CIDs', async () => {
    const res = await worker.transcode({
      jobId: 'job_hls_test_456',
      sourceCid: 'did:key:z6MkuCreatorTest',
      targetResolutions: ['720p', '360p'],
      segmentDurationSeconds: 2,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.jobId).toBe('job_hls_test_456');
      expect(res.value.resolutionCids['720p']).toBeDefined();
      expect(res.value.resolutionCids['360p']).toBeDefined();
    }
  });
});
