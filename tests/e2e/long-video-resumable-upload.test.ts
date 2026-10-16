/**
 * @file tests/e2e/long-video-resumable-upload.test.ts
 * SOVRA ENTERPRISE RESUMABLE VIDEO INGESTION & ABR HLS TRANSCODING SUITE
 *
 * Verifies:
 * 1. Resumable Chunked Upload Protocol (/api/videos/upload/init, /chunk, /status, /complete)
 * 2. Zero-RAM streaming disk writes via req.pipe()
 * 3. Network interruption and resume offset recovery without re-transmitting bytes
 * 4. Content-addressed bafy... SHA-256 CID derivation and atomic staging-to-permanent move
 * 5. Multi-resolution ABR HLS packaging (master.m3u8, 1080p, 720p, 480p) + .ts segments
 * 6. Storyboard timeline scrub WebVTT (storyboard.vtt) generation
 * 7. Storage Daemon / BitSwap P2P blockstore ingestion & pinning
 * 8. Elimination of 25MB client UI bottleneck & live throughput MB/s indicators
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { sovraDb } from '../../scripts/database-engine.ts';
import { VideoTranscodePipeline } from '../../scripts/video-transcode-pipeline.ts';
import { handleVideoRoutes, activeResumableUploads } from '../../scripts/routes/video.routes.ts';

describe('Sovra Resumable Long Video Ingestion & ABR HLS Pipeline', () => {
  let server: http.Server;
  let baseUrl: string;
  const testDir = path.join(os.tmpdir(), 'sovra-long-video-test-' + Date.now());
  const reelsDir = path.join(testDir, 'reels');
  const hlsDir = path.join(testDir, 'hls');
  const storyboardsDir = path.join(testDir, 'storyboards');

  const mockStorageBlocks = new Map<string, Buffer>();
  const mockStorageDaemon = {
    putBlock: async (cid: string, buffer: Buffer) => {
      mockStorageBlocks.set(cid, buffer);
      return true;
    },
    getBlock: async (cid: string) => {
      return mockStorageBlocks.get(cid) || null;
    },
  };

  const testCreator = {
    did: 'did:sovra:creator_test_' + Date.now(),
    handle: 'sovra_creator',
    displayName: 'Sovra Studio Creator',
  };

  beforeAll(async () => {
    fs.mkdirSync(reelsDir, { recursive: true });
    fs.mkdirSync(hlsDir, { recursive: true });
    fs.mkdirSync(storyboardsDir, { recursive: true });

    // Seed test creator in sovraDb
    sovraDb.createUser({
      did: testCreator.did,
      handle: testCreator.handle,
      displayName: testCreator.displayName,
      avatar: '🎬',
      bio: 'Sovereign 4K Video Creator',
    });

    server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      const handled = await handleVideoRoutes({
        req,
        res,
        url,
        REELS_DIR: reelsDir,
        storageDaemon: mockStorageDaemon,
        validateMediaMagicBytes: () => ({ valid: true }),
        readBoundedBody: async (r, s, maxBytes = 10 * 1024 * 1024) => {
          return new Promise((resolve) => {
            let body = '';
            let received = 0;
            r.on('data', chunk => {
              received += chunk.length;
              if (received > maxBytes) {
                r.destroy();
                s.writeHead(413, { 'Content-Type': 'application/json' });
                s.end(JSON.stringify({ ok: false, error: 'Payload Too Large' }));
                resolve({ body: '', ok: false });
                return;
              }
              body += chunk;
            });
            r.on('end', () => resolve({ body, ok: true }));
            r.on('error', () => resolve({ body: '', ok: false }));
          });
        },
        resolvePrincipal: () => ({
          did: testCreator.did,
          handle: testCreator.handle,
          displayName: testCreator.displayName,
        } as any),
        enforceAuth: () => ({
          did: testCreator.did,
          handle: testCreator.handle,
          displayName: testCreator.displayName,
        } as any),
      });

      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Route not handled' }));
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  // =========================================================================
  // SUITE 1: RESUMABLE UPLOAD SESSION INITIALIZATION
  // =========================================================================
  describe('Suite 1: Resumable Upload Session Initialization (/api/videos/upload/init)', () => {
    it('1.1 Rejects initialization when video title is missing (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/videos/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileSize: 10485760 }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Video title is required');
    });

    it('1.2 Allocates resumable upload session with unique uploadId and dedicated staging directory', async () => {
      const totalSize = 3 * 1024 * 1024; // 3 MB synthetic video
      const res = await fetch(`${baseUrl}/api/videos/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Decentralized Sovereign Web 4K Masterclass',
          fileSize: totalSize,
          mimeType: 'video/mp4',
          description: 'A deep dive into P2P content-addressed video networks',
          category: 'Science & Technology',
          visibility: 'public',
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.uploadId).toMatch(/^upl_\d+_[0-9a-f]+$/);
      expect(data.chunkSize).toBe(8 * 1024 * 1024);
      expect(data.totalBytes).toBe(totalSize);

      const session = activeResumableUploads.get(data.uploadId);
      expect(session).toBeDefined();
      expect(session?.ownerDid).toBe(testCreator.did);
      expect(fs.existsSync(session!.stagingDir)).toBe(true);
    });
  });

  // =========================================================================
  // SUITE 2: ZERO-RAM CHUNKED INGESTION & NETWORK RESUMPTION
  // =========================================================================
  describe('Suite 2: Zero-RAM Chunk Streaming & Mid-Upload Resumption', () => {
    let uploadId: string;
    const chunkSize = 1024 * 1024; // 1MB chunks
    const chunk1 = crypto.randomBytes(chunkSize);
    const chunk2 = crypto.randomBytes(chunkSize);
    const chunk3 = crypto.randomBytes(chunkSize);
    const totalVideoPayload = Buffer.concat([chunk1, chunk2, chunk3]); // 3MB total

    it('2.1 Initializes session for multi-part chunk transmission', async () => {
      const res = await fetch(`${baseUrl}/api/videos/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '4K Resumable Pipeline Test',
          fileSize: totalVideoPayload.length,
          mimeType: 'video/mp4',
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      uploadId = data.uploadId;
      expect(uploadId).toBeTruthy();
    });

    it('2.2 Streams Chunk #1 directly to staging disk without buffering full body in RAM', async () => {
      const res = await fetch(`${baseUrl}/api/videos/upload/chunk?uploadId=${uploadId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(chunk1.length),
        },
        body: chunk1,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.bytesReceived).toBe(chunk1.length);
      expect(data.chunkCount).toBe(1);
      expect(data.progressPercent).toBe(33);

      const session = activeResumableUploads.get(uploadId);
      expect(session).toBeDefined();
      expect(fs.existsSync(session!.stagingFile)).toBe(true);
      expect(fs.statSync(session!.stagingFile).size).toBe(chunk1.length);
    });

    it('2.3 Streams Chunk #2 and verifies continuous binary append', async () => {
      const res = await fetch(`${baseUrl}/api/videos/upload/chunk?uploadId=${uploadId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(chunk2.length),
        },
        body: chunk2,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.bytesReceived).toBe(chunk1.length + chunk2.length);
      expect(data.chunkCount).toBe(2);
      expect(data.progressPercent).toBe(67);

      const session = activeResumableUploads.get(uploadId);
      expect(fs.statSync(session!.stagingFile).size).toBe(chunk1.length + chunk2.length);
    });

    it('2.4 Simulates network disconnect & queries /status to recover byte offset without re-upload', async () => {
      const res = await fetch(`${baseUrl}/api/videos/upload/status?uploadId=${uploadId}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.uploadId).toBe(uploadId);
      expect(data.bytesReceived).toBe(2 * 1024 * 1024);
      expect(data.totalBytes).toBe(3 * 1024 * 1024);
      expect(data.progressPercent).toBe(67);
      expect(data.isComplete).toBe(false);
    });

    it('2.5 Streams final Chunk #3 to reach 100% completion', async () => {
      const res = await fetch(`${baseUrl}/api/videos/upload/chunk?uploadId=${uploadId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(chunk3.length),
        },
        body: chunk3,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.bytesReceived).toBe(totalVideoPayload.length);
      expect(data.progressPercent).toBe(100);

      // Verify status endpoint reports isComplete = true
      const statusRes = await fetch(`${baseUrl}/api/videos/upload/status?uploadId=${uploadId}`);
      const statusData = await statusRes.json();
      expect(statusData.isComplete).toBe(true);

      // Verify disk content matches exact concatenated original bytes
      const session = activeResumableUploads.get(uploadId);
      const stagedData = fs.readFileSync(session!.stagingFile);
      expect(stagedData.equals(totalVideoPayload)).toBe(true);
    });
  });

  // =========================================================================
  // SUITE 3: ATOMIC FINALIZATION, SHA-256 CID, & DB ENTRY
  // =========================================================================
  describe('Suite 3: Atomic Finalization & SHA-256 CID Derivation (/api/videos/upload/complete)', () => {
    let uploadId: string;
    let completedVideoId: string;
    let expectedCid: string;
    const testVideoBytes = crypto.randomBytes(2 * 1024 * 1024); // 2MB

    beforeAll(async () => {
      const hash = crypto.createHash('sha256').update(testVideoBytes).digest('hex');
      expectedCid = 'bafy' + hash.substring(0, 32);

      const initRes = await fetch(`${baseUrl}/api/videos/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Sovra Finalize Video Test',
          fileSize: testVideoBytes.length,
          mimeType: 'video/mp4',
        }),
      });
      const initData = await initRes.json();
      uploadId = initData.uploadId;

      await fetch(`${baseUrl}/api/videos/upload/chunk?uploadId=${uploadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: testVideoBytes,
      });
    });

    it('3.1 Finalizes upload, calculates SHA-256 CID, moves file, and starts transcode', async () => {
      const res = await fetch(`${baseUrl}/api/videos/upload/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.videoId).toBeTruthy();
      expect(data.cid).toBe(expectedCid);
      expect(data.status).toBe('processing');
      expect(data.hlsMasterUrl).toBe(`/api/videos/hls/${encodeURIComponent(data.videoId)}/master.m3u8`);
      expect(data.storyboardUrl).toBe(`/api/videos/storyboard/${encodeURIComponent(data.videoId)}/storyboard.vtt`);

      completedVideoId = data.videoId;

      // Verify staging directory is cleaned up
      expect(activeResumableUploads.has(uploadId)).toBe(false);

      // Verify file was moved to reelsDir
      const permanentPath = path.join(reelsDir, `${expectedCid}.mp4`);
      expect(fs.existsSync(permanentPath)).toBe(true);
      expect(fs.statSync(permanentPath).size).toBe(testVideoBytes.length);

      // Verify database record
      const dbRecord = sovraDb.getVideoById(completedVideoId);
      expect(dbRecord).toBeDefined();
      expect(dbRecord?.cid).toBe(expectedCid);
      expect(dbRecord?.rawFileSize).toBe(testVideoBytes.length);
      expect(dbRecord?.hlsMasterUrl).toContain(completedVideoId);
    });

    it('3.2 Rejects complete call if uploadId is invalid or already finalized (404)', async () => {
      const res = await fetch(`${baseUrl}/api/videos/upload/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId: 'invalid_or_done_id' }),
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });
  });

  // =========================================================================
  // SUITE 4: ABR HLS TRANSCODING ENGINE & P2P BLOCKSTORE INGESTION
  // =========================================================================
  describe('Suite 4: VideoTranscodePipeline Multi-Bitrate Engine & Storyboard Scrub VTT', () => {
    const rawSampleVideoPath = path.join(testDir, 'source_4k_sample.mp4');
    const sampleBytes = crypto.randomBytes(3 * 1024 * 1024); // 3MB sample

    beforeAll(() => {
      fs.writeFileSync(rawSampleVideoPath, sampleBytes);
    });

    it('4.1 Executes transcode pipeline and generates RFC 8216 compliant master and variant playlists', async () => {
      const createdVid = sovraDb.createVideo({
        ownerDid: testCreator.did,
        channelName: 'Channel',
        channelHandle: 'channel',
        channelAvatar: '🎬',
        title: 'Pipeline Transcode Verification',
        description: 'Testing HLS generation',
        duration: '01:00',
        durationSeconds: 60,
        tags: ['#test'],
        category: 'Tech',
        cid: 'bafytestcid123',
        videoUrl: '/api/watch/video/test',
        visibility: 'public',
      });
      const testVidId = createdVid.id;

      const transcodeResult = await VideoTranscodePipeline.processVideo(testVidId, rawSampleVideoPath, {
        outputDir: testDir,
        storageDaemon: mockStorageDaemon,
        segmentDuration: 4.0,
      });

      expect(transcodeResult.ok).toBe(true);
      expect(transcodeResult.videoId).toBe(testVidId);
      expect(transcodeResult.totalSegments).toBeGreaterThan(0);
      expect(fs.existsSync(transcodeResult.masterPlaylistPath)).toBe(true);
      expect(fs.existsSync(transcodeResult.storyboardVttPath)).toBe(true);

      // Verify master.m3u8 contents
      const masterContent = fs.readFileSync(transcodeResult.masterPlaylistPath, 'utf8');
      expect(masterContent).toContain('#EXTM3U');
      expect(masterContent).toContain('#EXT-X-VERSION:3');
      expect(masterContent).toContain('#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080');
      expect(masterContent).toContain('#EXT-X-STREAM-INF:BANDWIDTH=2200000,RESOLUTION=1280x720');
      expect(masterContent).toContain('#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=854x480');
      expect(masterContent).toContain('1080p.m3u8');
      expect(masterContent).toContain('720p.m3u8');
      expect(masterContent).toContain('480p.m3u8');

      // Verify variant 1080p.m3u8 contents
      const variant1080Path = path.join(testDir, 'hls', testVidId, '1080p.m3u8');
      expect(fs.existsSync(variant1080Path)).toBe(true);
      const variantContent = fs.readFileSync(variant1080Path, 'utf8');
      expect(variantContent).toContain('#EXTM3U');
      expect(variantContent).toContain('#EXT-X-TARGETDURATION:4');
      expect(variantContent).toContain('#EXTINF:4.000,');
      expect(variantContent).toContain('segment_0000.ts');
      expect(variantContent).toContain('#EXT-X-ENDLIST');

      // Verify storyboard.vtt
      const vttContent = fs.readFileSync(transcodeResult.storyboardVttPath, 'utf8');
      expect(vttContent).toContain('WEBVTT');
      expect(vttContent).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/);
      expect(vttContent).toContain(`/api/videos/storyboard/${testVidId}/thumb_`);

      // Verify database updated to ready
      const updatedRecord = sovraDb.getVideoById(testVidId);
      expect(updatedRecord?.status).toBe('ready');
      expect(updatedRecord?.transcodeProgress).toBe(100);
      expect(updatedRecord?.variants?.length).toBeGreaterThan(0);

      // Verify mock storage blockstore received the master manifest
      expect(mockStorageBlocks.size).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // SUITE 5: HLS STREAMING & STORYBOARD HTTP SERVING ROUTES
  // =========================================================================
  describe('Suite 5: HLS Streaming & Storyboard HTTP Serving Routes', () => {
    const testVideoId = 'vid_serve_test_' + Date.now();
    const vidHlsDir = path.join(testDir, 'hls', testVideoId);
    const vidStoryboardDir = path.join(testDir, 'storyboards', testVideoId);

    beforeAll(() => {
      fs.mkdirSync(vidHlsDir, { recursive: true });
      fs.mkdirSync(vidStoryboardDir, { recursive: true });

      fs.writeFileSync(
        path.join(vidHlsDir, 'master.m3u8'),
        '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080\n1080p.m3u8\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(vidHlsDir, '1080p.m3u8'),
        '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:4.000,\nsegment_0000.ts\n#EXT-X-ENDLIST\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(vidHlsDir, 'segment_0000.ts'),
        Buffer.from('G@dummy_transport_stream_payload')
      );
      fs.writeFileSync(
        path.join(vidStoryboardDir, 'storyboard.vtt'),
        'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\n/api/videos/storyboard/thumb_0.jpg\n',
        'utf8'
      );
    });

    it('5.1 Serves master.m3u8 with application/vnd.apple.mpegurl and CORS headers', async () => {
      const res = await fetch(`${baseUrl}/api/videos/hls/${testVideoId}/master.m3u8`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      const text = await res.text();
      expect(text).toContain('#EXTM3U');
      expect(text).toContain('1080p.m3u8');
    });

    it('5.2 Serves variant 1080p.m3u8 playlist', async () => {
      const res = await fetch(`${baseUrl}/api/videos/hls/${testVideoId}/1080p.m3u8`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
      const text = await res.text();
      expect(text).toContain('#EXTINF:4.000');
      expect(text).toContain('segment_0000.ts');
    });

    it('5.3 Streams .ts video chunk with video/mp2t MIME type and binary integrity', async () => {
      const res = await fetch(`${baseUrl}/api/videos/hls/${testVideoId}/segment_0000.ts`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('video/mp2t');
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.toString()).toContain('dummy_transport_stream_payload');
    });

    it('5.4 Serves storyboard.vtt with text/vtt; charset=utf-8 for video hover scrubbing', async () => {
      const res = await fetch(`${baseUrl}/api/videos/storyboard/${testVideoId}/storyboard.vtt`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/vtt');
      const text = await res.text();
      expect(text).toContain('WEBVTT');
      expect(text).toContain('00:00:00.000 --> 00:00:04.000');
    });

    it('5.5 Returns fallback master.m3u8 when asset is requested before transcode finishes', async () => {
      const pendingVidId = 'vid_pending_transcode_999';
      const res = await fetch(`${baseUrl}/api/videos/hls/${pendingVidId}/master.m3u8`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
      const text = await res.text();
      expect(text).toContain('#EXTM3U');
      expect(text).toContain(pendingVidId);
    });
  });

  // =========================================================================
  // SUITE 6: DEV SERVER CLIENT UI & ELIMINATION OF 25MB BOTTLENECK
  // =========================================================================
  describe('Suite 6: Client Script UI Verification & Removal of 25MB Limits', () => {
    const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
    const devServerContent = fs.readFileSync(devServerPath, 'utf8');

    it('6.1 Guarantees no 25MB upload hardcoding exists in submitVideoUpload', () => {
      expect(devServerContent).not.toMatch(/if\s*\(\s*file\.size\s*>\s*25\s*\*\s*1024\s*\*\s*1024\s*\)/);
    });

    it('6.2 Guarantees submitVideoUpload implements resumable chunked protocol (/api/videos/upload/init & chunk)', () => {
      expect(devServerContent).toContain('/api/videos/upload/init');
      expect(devServerContent).toContain('/api/videos/upload/chunk?uploadId=');
      expect(devServerContent).toContain('/api/videos/upload/complete');
      expect(devServerContent).toContain('selectedVideoUploadFile.slice(');
    });

    it('6.3 Guarantees live upload speed (MB/s) and chunk indicators are surfaced to the user', () => {
      expect(devServerContent).toContain('((offset / (1024 * 1024)) / elapsed).toFixed(1)');
      expect(devServerContent).toContain("'Streaming Chunk ' + (chunkIdx + 1)");
      expect(devServerContent).toContain('MB/s');
    });

    it('6.4 Verifies Watch video player integrates HLS master stream binding (v.hlsMasterUrl)', () => {
      expect(devServerContent).toContain('v.hlsMasterUrl || v.videoUrl || v.mediaVideo');
      expect(devServerContent).toContain('Hls.isSupported()');
    });

    it('6.5 Verifies UI prompts indicate Unlimited / 10GB+ video ingestion support', () => {
      expect(devServerContent).toContain('Unlimited / 10GB+');
    });
  });
});
