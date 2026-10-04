import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateHlsMasterPlaylist,
  generateHlsMediaPlaylist,
  parseM3u8MediaPlaylist,
  SlidingWindowFetcher,
  HlsVideoSegment,
  HlsStreamVariant,
} from '../src/hls.js';
import { MemoryBlockstore } from '../src/blockstore.js';
import { BitSwapEngine } from '../src/bitswap.js';
import { CID } from '../src/cid.js';

describe('Milestone 3: HLS Segmented Video Streaming & Sliding Window Pre-Fetching', () => {
  describe('Playlist Generation & Parsing', () => {
    it('generates compliant HLS Master Playlist', () => {
      const variants: HlsStreamVariant[] = [
        { resolution: '360p', bandwidth: 800000, width: 640, height: 360, uri: 'stream_360p.m3u8' },
        { resolution: '720p', bandwidth: 2800000, width: 1280, height: 720, uri: 'stream_720p.m3u8' },
        { resolution: '1080p', bandwidth: 5000000, width: 1920, height: 1080, uri: 'stream_1080p.m3u8' },
      ];

      const m3u8 = generateHlsMasterPlaylist(variants);
      expect(m3u8).toContain('#EXTM3U');
      expect(m3u8).toContain('#EXT-X-VERSION:3');
      expect(m3u8).toContain('BANDWIDTH=800000,RESOLUTION=640x360');
      expect(m3u8).toContain('stream_360p.m3u8');
      expect(m3u8).toContain('BANDWIDTH=5000000,RESOLUTION=1920x1080');
      expect(m3u8).toContain('stream_1080p.m3u8');
    });

    it('generates and parses HLS Media Playlist with segment CIDs', () => {
      const segments: HlsVideoSegment[] = [
        { sequenceNumber: 0, durationSeconds: 2.0, cid: 'bafkreibm1', byteLength: 1000 },
        { sequenceNumber: 1, durationSeconds: 2.0, cid: 'bafkreibm2', byteLength: 1000 },
        { sequenceNumber: 2, durationSeconds: 1.8, cid: 'bafkreibm3', byteLength: 900 },
      ];

      const m3u8 = generateHlsMediaPlaylist(segments, 2);
      expect(m3u8).toContain('#EXTM3U');
      expect(m3u8).toContain('#EXT-X-TARGETDURATION:2');
      expect(m3u8).toContain('#EXTINF:2.0,');
      expect(m3u8).toContain('ipfs://bafkreibm1');
      expect(m3u8).toContain('#EXT-X-ENDLIST');

      const parsed = parseM3u8MediaPlaylist(m3u8);
      expect(parsed).toHaveLength(3);
      expect(parsed[0]?.cid).toBe('bafkreibm1');
      expect(parsed[0]?.sequenceNumber).toBe(0);
      expect(parsed[2]?.durationSeconds).toBe(1.8);
      expect(parsed[2]?.cid).toBe('bafkreibm3');
    });
  });

  describe('SlidingWindowFetcher Sub-300ms Video Playback & Scrubbing', () => {
    let blockstore: MemoryBlockstore;
    let bitswap: BitSwapEngine;
    let segments: HlsVideoSegment[];

    beforeEach(async () => {
      blockstore = new MemoryBlockstore();
      bitswap = new BitSwapEngine(blockstore);

      segments = [];
      // Create 6 realistic video segment blocks
      for (let i = 0; i < 6; i++) {
        const dummyChunk = new Uint8Array(2048);
        dummyChunk.fill(i + 1);
        const cid = CID.create('raw', dummyChunk);
        await blockstore.put(cid, dummyChunk);

        segments.push({
          sequenceNumber: i,
          durationSeconds: 2.0,
          cid: cid.toString(),
          byteLength: dummyChunk.length,
          resolution: '720p',
        });
      }
    });

    it('starts playback immediately with segment 0 and pre-buffers forward window', async () => {
      const fetcher = new SlidingWindowFetcher(segments, bitswap, {
        windowSize: 3,
        keepBehindCount: 2,
      });

      const startTime = Date.now();
      const seg0 = await fetcher.startPlayback();
      const startupLatency = Date.now() - startTime;

      // Sub-300ms playback startup verification
      expect(startupLatency).toBeLessThan(300);
      expect(seg0).toBeDefined();
      expect(seg0[0]).toBe(1); // segment 0 byte value
      expect(fetcher.currentIndex).toBe(0);

      // Wait a tick for background window prefetch
      await new Promise(r => setTimeout(r, 50));

      const status = fetcher.getBufferStatus();
      expect(status.bufferedIndices).toContain(0);
      expect(status.bufferedIndices).toContain(1);
    });

    it('retrieves subsequent segments and advances sliding window', async () => {
      const fetcher = new SlidingWindowFetcher(segments, bitswap, {
        windowSize: 2,
        keepBehindCount: 1,
      });

      await fetcher.startPlayback();
      const seg1 = await fetcher.getSegment(1);
      expect(seg1[0]).toBe(2);
      expect(fetcher.currentIndex).toBe(1);

      const seg2 = await fetcher.getSegment(2);
      expect(seg2[0]).toBe(3);
      expect(fetcher.currentIndex).toBe(2);
    });

    it('scrubs/seeks to segment 4, evicts old passed segments to avoid memory bloat', async () => {
      const fetcher = new SlidingWindowFetcher(segments, bitswap, {
        windowSize: 2,
        keepBehindCount: 1,
      });

      await fetcher.startPlayback();
      await fetcher.getSegment(1);

      // Seek to segment 4
      const seg4 = await fetcher.seekToSegment(4);
      expect(seg4[0]).toBe(5);
      expect(fetcher.currentIndex).toBe(4);

      // Past segments (0, 1, 2) must be evicted since keepBehindCount = 1
      const status = fetcher.getBufferStatus();
      expect(status.bufferedIndices).not.toContain(0);
      expect(status.bufferedIndices).not.toContain(1);
      expect(status.bufferedIndices).not.toContain(2);
      expect(status.bufferedIndices).toContain(4);
    });
  });
});
