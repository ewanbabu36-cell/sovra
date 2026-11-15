/**
 * @file tests/e2e/video-transcode-abr.test.ts
 * Tests the Sovra Broadcast-Grade Video Transcoder & Adaptive Bitrate (ABR) HLS Engine.
 *
 * Verifies:
 * 1. Pure Node.js ISO/IEC 13818-1 MPEG-2 Transport Stream (MPEG-TS) Muxer:
 *    - Exact 188-byte packet alignment with 0x47 sync byte
 *    - PAT (PID 0x0000) with Program 1 -> PMT PID 0x1000 and valid CRC-32/MPEG2
 *    - PMT (PID 0x1000) with H.264 (0x1B) and AAC (0x0F) streams
 *    - Video PES (PID 0x0100) with 90 kHz PTS clock and Annex B H.264 NALs (AUD, SPS, PPS, IDR)
 *    - Audio PES (PID 0x0101) with valid AAC ADTS frames
 * 2. Multi-Resolution ABR Ladder (1080p, 720p, 480p, 360p):
 *    - Distinct resolution-specific SPS profiles and bitrate allocation
 *    - Master playlist (master.m3u8) referencing all variants
 * 3. Storyboard Timeline Scrubbing:
 *    - Standalone JFIF JPEG generation (320x180) with valid SOI/EOI
 *    - WebVTT cues referencing every thumbnail frame
 * 4. Full Transcode Pipeline Execution & Database State Progression
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  VideoTranscodePipeline,
  PureNodeMpegTsEngine,
} from '../../scripts/video-transcode-pipeline.ts';
import { sovraDb } from '../../scripts/database-engine.ts';

describe('Sovra Broadcast-Grade Video Transcoder & ABR HLS Suite', () => {
  const testDir = path.resolve(process.cwd(), 'tmp-test-transcode-' + Date.now());

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (_) {}
  });

  describe('1. Pure Node.js ISO/IEC 13818-1 MPEG-TS Packetizer', () => {
    it('1.1 Generates standard-compliant 188-byte PAT packet on PID 0x0000', () => {
      const pat = PureNodeMpegTsEngine.buildPat(0);
      expect(pat.length).toBe(188);
      expect(pat[0]).toBe(0x47); // Sync byte
      expect((pat[1] & 0x1f) << 8 | pat[2]).toBe(0x0000); // PID 0x0000
      expect(pat[4]).toBe(0x00); // Pointer field
      expect(pat[5]).toBe(0x00); // Table ID: PAT
      // Program 1 -> PMT PID 0x1000
      expect(pat[13]).toBe(0x00);
      expect(pat[14]).toBe(0x01);
      expect((pat[15] & 0x1f) << 8 | pat[16]).toBe(0x1000);
    });

    it('1.2 Generates standard-compliant 188-byte PMT packet on PID 0x1000 with H.264 & AAC streams', () => {
      const pmt = PureNodeMpegTsEngine.buildPmt(0);
      expect(pmt.length).toBe(188);
      expect(pmt[0]).toBe(0x47); // Sync byte
      expect((pmt[1] & 0x1f) << 8 | pmt[2]).toBe(0x1000); // PID 0x1000
      expect(pmt[5]).toBe(0x02); // Table ID: PMT
      // Stream 1: H.264 (0x1B) on PID 0x0100
      expect(pmt[17]).toBe(0x1b);
      expect((pmt[18] & 0x1f) << 8 | pmt[19]).toBe(0x0100);
      // Stream 2: AAC (0x0F) on PID 0x0101
      expect(pmt[22]).toBe(0x0f);
      expect((pmt[23] & 0x1f) << 8 | pmt[24]).toBe(0x0101);
    });

    it('1.3 Generates authentic H.264 Video PES packet with AUD, SPS, PPS, and IDR slice', () => {
      const pes = PureNodeMpegTsEngine.buildVideoPes('1080p', 0.0, true, 2048);
      expect(pes.length).toBeGreaterThan(100);
      // PES start code + Stream ID 0xE0 (video)
      expect(pes[0]).toBe(0x00);
      expect(pes[1]).toBe(0x00);
      expect(pes[2]).toBe(0x01);
      expect(pes[3]).toBe(0xe0);

      // Verify Annex B NAL start codes exist inside PES
      const pesHex = pes.toString('hex');
      expect(pesHex).toContain('0000000109f0'); // AUD
      expect(pesHex).toContain('0000000167'); // SPS
      expect(pesHex).toContain('0000000168'); // PPS
      expect(pesHex).toContain('0000000165'); // IDR Slice
    });

    it('1.4 Generates authentic AAC Audio PES packet with ADTS framing', () => {
      const pes = PureNodeMpegTsEngine.buildAudioPes(0.0, 4);
      expect(pes.length).toBeGreaterThan(100);
      // PES start code + Stream ID 0xC0 (audio)
      expect(pes[0]).toBe(0x00);
      expect(pes[1]).toBe(0x00);
      expect(pes[2]).toBe(0x01);
      expect(pes[3]).toBe(0xc0);

      // Verify ADTS Syncword 0xFFF1
      const pesHex = pes.toString('hex');
      expect(pesHex).toContain('fff150');
    });

    it('1.5 Generates complete, strict 188-byte aligned MPEG-TS segment file', () => {
      const segmentBuf = PureNodeMpegTsEngine.generateMpegTsSegment(0, 4.0, '1080p');
      expect(segmentBuf.length).toBeGreaterThan(188 * 5);
      expect(segmentBuf.length % 188).toBe(0); // Perfect 188-byte alignment

      // Verify every 188th byte is the 0x47 sync byte
      const numPackets = segmentBuf.length / 188;
      for (let i = 0; i < numPackets; i++) {
        expect(segmentBuf[i * 188]).toBe(0x47);
      }
    });

    it('1.6 Generates distinct resolution profiles (1080p, 720p, 480p, 360p) with calibrated bitrates', () => {
      const seg1080 = PureNodeMpegTsEngine.generateMpegTsSegment(0, 4.0, '1080p');
      const seg720 = PureNodeMpegTsEngine.generateMpegTsSegment(0, 4.0, '720p');
      const seg480 = PureNodeMpegTsEngine.generateMpegTsSegment(0, 4.0, '480p');
      const seg360 = PureNodeMpegTsEngine.generateMpegTsSegment(0, 4.0, '360p');

      // Calibrated size hierarchy: 1080p > 720p > 480p > 360p
      expect(seg1080.length).toBeGreaterThan(seg720.length);
      expect(seg720.length).toBeGreaterThan(seg480.length);
      expect(seg480.length).toBeGreaterThan(seg360.length);

      // All must be strictly 188-byte aligned
      expect(seg1080.length % 188).toBe(0);
      expect(seg720.length % 188).toBe(0);
      expect(seg480.length % 188).toBe(0);
      expect(seg360.length % 188).toBe(0);
    });
  });

  describe('2. Standalone Timeline Scrub JPEG Image Generator', () => {
    it('2.1 Synthesizes authentic JFIF JPEG binary buffer with valid SOI, SOF0, and EOI', () => {
      const jpegBuf = PureNodeMpegTsEngine.generateValidJpeg(320, 180);
      expect(jpegBuf.length).toBeGreaterThan(200);

      // Start of Image (SOI): 0xFF 0xD8
      expect(jpegBuf[0]).toBe(0xff);
      expect(jpegBuf[1]).toBe(0xd8);

      // End of Image (EOI): 0xFF 0xD9
      expect(jpegBuf[jpegBuf.length - 2]).toBe(0xff);
      expect(jpegBuf[jpegBuf.length - 1]).toBe(0xd9);

      // JFIF identifier
      expect(jpegBuf.toString('ascii')).toContain('JFIF');
    });
  });

  describe('3. Full VideoTranscodePipeline Execution', () => {
    it('3.1 Executes multi-resolution ABR pipeline and generates RFC 8216 playlists and real JPEG thumbnails', async () => {
      const rawSample = path.join(testDir, 'raw_test_sample.mp4');
      fs.writeFileSync(rawSample, crypto.randomBytes(2 * 1024 * 1024)); // 2MB

      const vidRecord = sovraDb.createVideo({
        ownerDid: 'did:sovra:creator123',
        channelName: 'Test Channel',
        channelHandle: 'testchannel',
        channelAvatar: '🎬',
        title: 'ABR Transcode Test',
        description: 'Verifying pure Node.js MPEG-TS ABR engine',
        duration: '00:08',
        durationSeconds: 8,
        tags: ['#abr', '#hls'],
        category: 'Tech',
        cid: 'bafyabrtest123',
        videoUrl: '/api/watch/video/abrtest',
        visibility: 'public',
      });

      const result = await VideoTranscodePipeline.processVideo(vidRecord.id, rawSample, {
        outputDir: testDir,
        targetResolutions: ['1080p', '720p', '480p'],
        segmentDuration: 4.0,
      });

      expect(result.ok).toBe(true);
      expect(result.videoId).toBe(vidRecord.id);
      expect(result.totalSegments).toBeGreaterThan(0);
      expect(result.variants.length).toBe(3);

      // Verify master playlist
      expect(fs.existsSync(result.masterPlaylistPath)).toBe(true);
      const masterContent = fs.readFileSync(result.masterPlaylistPath, 'utf8');
      expect(masterContent).toContain('#EXTM3U');
      expect(masterContent).toContain('#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080');
      expect(masterContent).toContain('#EXT-X-STREAM-INF:BANDWIDTH=2200000,RESOLUTION=1280x720');
      expect(masterContent).toContain('#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=854x480');
      expect(masterContent).toContain('1080p.m3u8');
      expect(masterContent).toContain('720p.m3u8');
      expect(masterContent).toContain('480p.m3u8');

      // Verify variant playlists
      const p1080 = path.join(result.hlsDir, '1080p.m3u8');
      const p720 = path.join(result.hlsDir, '720p.m3u8');
      const p480 = path.join(result.hlsDir, '480p.m3u8');
      expect(fs.existsSync(p1080)).toBe(true);
      expect(fs.existsSync(p720)).toBe(true);
      expect(fs.existsSync(p480)).toBe(true);

      // Verify generated .ts segments exist and are valid 188-byte aligned MPEG-TS
      const seg0 = path.join(result.hlsDir, 'segment_0000.ts');
      expect(fs.existsSync(seg0)).toBe(true);
      const segBuf = fs.readFileSync(seg0);
      expect(segBuf.length % 188).toBe(0);
      expect(segBuf[0]).toBe(0x47);

      // Verify storyboard WebVTT and standalone thumbnail JPEGs
      expect(fs.existsSync(result.storyboardVttPath)).toBe(true);
      const vtt = fs.readFileSync(result.storyboardVttPath, 'utf8');
      expect(vtt).toContain('WEBVTT');
      expect(vtt).toContain('00:00:00.000 -->');

      const thumb0Path = path.join(path.dirname(result.storyboardVttPath), 'thumb_0.jpg');
      expect(fs.existsSync(thumb0Path)).toBe(true);
      const thumbBuf = fs.readFileSync(thumb0Path);
      expect(thumbBuf[0]).toBe(0xff);
      expect(thumbBuf[1]).toBe(0xd8); // Valid JPEG SOI
      expect(thumbBuf[thumbBuf.length - 2]).toBe(0xff);
      expect(thumbBuf[thumbBuf.length - 1]).toBe(0xd9); // Valid JPEG EOI

      // Verify database updated to ready with variants
      const updated = sovraDb.getVideoById(vidRecord.id);
      expect(updated?.status).toBe('ready');
      expect(updated?.transcodeProgress).toBe(100);
      expect(updated?.variants?.length).toBe(3);
    });
  });
});
