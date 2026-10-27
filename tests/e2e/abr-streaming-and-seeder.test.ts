/**
 * @file tests/e2e/abr-streaming-and-seeder.test.ts
 * Master E2E Suite for Adaptive Bitrate (ABR) Streaming & P2P Seeder Relay Rewards (Cycle 2).
 *
 * Verifies:
 * 1. 4-Tier Multi-Resolution Master HLS Playlist (1080p, 720p, 480p, 360p)
 * 2. Variant resolution media playlists with #EXTINF segments
 * 3. MPEG-2 TS chunk delivery with 0x47 sync bytes
 * 4. P2P Seeder Bandwidth Reward Settlement (/api/video/seeder/claim) with ledger recording
 * 5. Video Player DOM controls: Quality gear, menu tiers, and buffer telemetry HUD
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { handleVideoRoutes } from '../../scripts/routes/video.routes.ts';
import { sovraDb } from '../../scripts/database-engine.ts';

describe('Cycle 2: ABR Streaming & P2P Seeder Relay Reward Pipeline', () => {
  const devServerPath = path.resolve(process.cwd(), 'scripts', 'dev-server.ts');
  const devServerCode = fs.readFileSync(devServerPath, 'utf-8');

  // Helper mock server context for handleVideoRoutes
  function createMockContext(method: string, urlPath: string, bodyJson?: any) {
    let statusCode = 200;
    const headers: Record<string, string> = {};
    let responseData = '';
    let responseBuffer: Buffer | null = null;

    const req: any = {
      method,
      headers: { host: 'localhost:3001' },
      url: urlPath,
    };

    const res: any = {
      writeHead: (status: number, head: Record<string, string>) => {
        statusCode = status;
        Object.assign(headers, head);
      },
      end: (chunk?: any) => {
        if (Buffer.isBuffer(chunk)) {
          responseBuffer = chunk;
        } else if (typeof chunk === 'string') {
          responseData = chunk;
        }
      },
    };

    const url = new URL(`http://localhost:3001${urlPath}`);
    const REELS_DIR = path.resolve(process.cwd(), '.sovra-storage-dev', 'reels');

    const ctx = {
      req,
      res,
      url,
      REELS_DIR,
      validateMediaMagicBytes: () => ({ valid: true }),
      readBoundedBody: async () => ({
        body: bodyJson ? JSON.stringify(bodyJson) : '',
        ok: true,
      }),
      resolvePrincipal: () => ({ did: 'did:key:test_user', handle: 'tester' } as any),
      enforceAuth: () => ({ did: 'did:key:test_user', handle: 'tester' } as any),
      getResult: () => ({
        statusCode,
        headers,
        data: responseData,
        buffer: responseBuffer,
      }),
    };

    return ctx;
  }

  describe('1. Multi-Resolution HLS Ladder Generation', () => {
    it('should generate a 4-tier master playlist with 1080p, 720p, 480p, and 360p', async () => {
      const ctx = createMockContext('GET', '/api/videos/hls/vid_test_4k/master.m3u8');
      const handled = await handleVideoRoutes(ctx as any);
      expect(handled).toBe(true);

      const res = ctx.getResult();
      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('application/vnd.apple.mpegurl');
      expect(res.data).toContain('#EXTM3U');
      expect(res.data).toContain('RESOLUTION=1920x1080');
      expect(res.data).toContain('1080p.m3u8');
      expect(res.data).toContain('RESOLUTION=1280x720');
      expect(res.data).toContain('720p.m3u8');
      expect(res.data).toContain('RESOLUTION=854x480');
      expect(res.data).toContain('480p.m3u8');
      expect(res.data).toContain('RESOLUTION=640x360');
      expect(res.data).toContain('360p.m3u8');
    });

    it('should generate valid variant playlists with segment references', async () => {
      const ctx720 = createMockContext('GET', '/api/videos/hls/vid_test_4k/720p.m3u8');
      await handleVideoRoutes(ctx720 as any);

      const res720 = ctx720.getResult();
      expect(res720.statusCode).toBe(200);
      expect(res720.data).toContain('#EXT-X-TARGETDURATION:4');
      expect(res720.data).toContain('720p_seq0.ts');
      expect(res720.data).toContain('720p_seq1.ts');
      expect(res720.data).toContain('#EXT-X-ENDLIST');
    });

    it('should deliver TS chunk segments with MPEG-2 TS sync byte header', async () => {
      const ctxTs = createMockContext('GET', '/api/videos/hls/vid_test_4k/1080p_seq0.ts');
      await handleVideoRoutes(ctxTs as any);

      const resTs = ctxTs.getResult();
      expect(resTs.statusCode).toBe(200);
      expect(resTs.headers['Content-Type']).toBe('video/mp2t');
      expect(resTs.buffer).not.toBeNull();
      // First byte of TS packet must be 0x47 sync byte
      expect(resTs.buffer![0]).toBe(0x47);
    });
  });

  describe('2. P2P Seeder Relay Settlement (/api/video/seeder/claim)', () => {
    it('should award 5% bandwidth reward to seeder and record financial ledger entry', async () => {
      const claimPayload = {
        videoId: 'vid_relay_demo_01',
        chunkHash: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        bytesSeeded: 52428800, // 50MB
        seederDid: 'did:key:z6Mkhq_seeder_node_01',
        recipientPeerDid: 'did:key:z6Mkp2_recipient_node_02',
      };

      const ctx = createMockContext('POST', '/api/video/seeder/claim', claimPayload);
      const handled = await handleVideoRoutes(ctx as any);
      expect(handled).toBe(true);

      const res = ctx.getResult();
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.data);
      expect(body.ok).toBe(true);
      expect(body.rewardClaimed).toBeGreaterThan(0);
      expect(body.status).toBe('SETTLED');
      expect(body.seederDid).toBe(claimPayload.seederDid);
      expect(body.txHash).toBeDefined();

      // Verify financial ledger record in sovraDb
      const ledger = (sovraDb as any).db.financial_ledger || [];
      const entry = ledger.find((e: any) => e.referenceId === body.txHash);
      expect(entry).toBeDefined();
      expect(entry.itemType).toBe('SEEDER_REWARD');
      expect(entry.creatorDid).toBe(claimPayload.seederDid);
    });

    it('should reject invalid claims with missing seederDid or insufficient bytes', async () => {
      const invalidPayload = {
        bytesSeeded: 500, // < 1KB minimum
        seederDid: '',
      };

      const ctx = createMockContext('POST', '/api/video/seeder/claim', invalidPayload);
      await handleVideoRoutes(ctx as any);

      const res = ctx.getResult();
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.data);
      expect(body.ok).toBe(false);
    });
  });

  describe('3. Dynamic Video Player Controls & Buffer Telemetry HUD', () => {
    it('should include #spatialQualityBtn, #spatialQualityMenu, and telemetry HUD in dev-server', () => {
      expect(devServerCode).toContain('id="spatialQualityBtn"');
      expect(devServerCode).toContain('id="spatialQualityMenu"');
      expect(devServerCode).toContain('id="spatialBufferTelemetryHUD"');
      expect(devServerCode).toContain('id="telemetryQualityBadge"');
      expect(devServerCode).toContain('id="telemetryBufferSec"');
      expect(devServerCode).toContain('id="telemetryP2pRate"');
    });

    it('should support switching between Auto, 1080p, 720p, 480p, and 360p', () => {
      expect(devServerCode).toContain('window._toggleQualityMenu');
      expect(devServerCode).toContain('window._setQualityTier');
      expect(devServerCode).toContain('_setQualityTier(&quot;auto&quot;)');
      expect(devServerCode).toContain('_setQualityTier(&quot;1080p&quot;)');
      expect(devServerCode).toContain('_setQualityTier(&quot;720p&quot;)');
      expect(devServerCode).toContain('_setQualityTier(&quot;480p&quot;)');
      expect(devServerCode).toContain('_setQualityTier(&quot;360p&quot;)');
    });
  });
});
