/**
 * @file tests/e2e/creator-studio-parity.test.ts
 * Creator Studio Pro: YouTube Studio Parity & Production Hardening Test Suite.
 *
 * Verifies:
 * 1. Milestone 1: Dynamic Video Dropdowns (Trailer, Featured & End-Screens)
 *    - loadCustomization dynamically populates #customTrailerSelect and #customFeaturedSelect from this.contentLibrary.
 *    - openVideoDetailsModal dynamically populates #editVideoEndScreenSelect excluding current video.
 * 2. Milestone 2: Edit Video Thumbnail, Gating & Chapters Full Persistence
 *    - openVideoDetailsModal sets gating tier radio buttons (#editGateFree, #editGateSupporter, #editGatePreview).
 *    - saveVideoDetails reads active thumbnail, checked gating radio, and chapters, persisting via /api/studio/video/update.
 * 3. Milestone 3: Real Creator Comment Heart & Pin Synchronization
 *    - moderateComment in database-engine.ts supports 'heart' (toggles isHearted) and 'pin' (toggles isPinned and clears previous pin).
 *    - /api/studio/comments/moderate endpoint handles 'heart' and 'pin'.
 *    - toggleStudioHeart and toggleStudioPin call POST /api/studio/comments/moderate.
 * 4. Milestone 4: Lossless Video Trimmer & Timeline Scrubber
 *    - layout.view.ts contains #studioVideoTrimmerModal with player, start/end inputs, scrubber slider, and apply button.
 *    - Content table rows have "✂️ Trim" action button.
 *    - SovraCreatorStudioEngine has openVideoTrimmerModal, closeVideoTrimmerModal, and applyVideoTrim calling /api/studio/video/trim.
 *    - Database trimVideo stores trimConfig with startOffsetSec and endOffsetSec.
 * 5. Milestone 5: Channel Customization Full Persistence
 *    - #customAvatarInput and #customWatermarkInput have onchange handlers.
 *    - handleAvatarUploaded and handleWatermarkUploaded read data URLs.
 *    - saveCustomization persists avatar, bannerUrl, watermark, and socialLinks to database.
 * 6. Milestone 6: Live Streaming RTMP Ingest Keys Card
 *    - layout.view.ts contains #studioLiveIngestCard with RTMP Stream URL, masked Stream Key, reveal/copy/reset, and low-latency toggle.
 *    - SovraCreatorStudioEngine implements toggleStreamKeyVisibility, copyStreamKey, resetStreamKey, copyRtmpUrl, and toggleLowLatency.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sovraDb } from '../../scripts/database-engine.ts';
import { handleStudioTranscoderRoutes } from '../../scripts/routes/studio.routes.ts';

describe('Creator Studio Pro: YouTube Parity & Production Hardening', () => {
  const scriptsViewPath = path.resolve(__dirname, '../../scripts/views/scripts.view.ts');
  const layoutViewPath = path.resolve(__dirname, '../../scripts/views/layout.view.ts');
  const studioRoutesPath = path.resolve(__dirname, '../../scripts/routes/studio.routes.ts');

  const scriptsViewContent = fs.readFileSync(scriptsViewPath, 'utf8');
  const layoutViewContent = fs.readFileSync(layoutViewPath, 'utf8');
  const studioRoutesContent = fs.readFileSync(studioRoutesPath, 'utf8');

  const testCreatorDid = 'did:sovra:creator_parity_' + Date.now();
  let testVideoId1 = 'vid-parity-1-' + Date.now();
  let testVideoId2 = 'vid-parity-2-' + Date.now();
  let testCommentId1 = 'comm-parity-1-' + Date.now();
  let testCommentId2 = 'comm-parity-2-' + Date.now();

  beforeAll(() => {
    sovraDb.load();
    if (!(sovraDb as any).db.videos) (sovraDb as any).db.videos = [];
    if (!(sovraDb as any).db.video_comments) (sovraDb as any).db.video_comments = {};

    // Seed test videos
    (sovraDb as any).db.videos.push({
      id: testVideoId1,
      title: 'Decentralized P2P Mesh Architecture',
      description: 'Deep dive into Sovra BitSwap and gossip protocols.',
      category: 'Tech',
      creatorDid: testCreatorDid,
      channelId: 'ch-parity-test',
      status: 'ready',
      views: 450,
      durationSeconds: 180,
      thumbnailUrl: 'https://images.unsplash.com/photo-test-1.jpg',
      createdAt: Date.now()
    });

    (sovraDb as any).db.videos.push({
      id: testVideoId2,
      title: 'Cellular CGNAT Traversal Guide',
      description: 'NAT hole punching using STUN and TURN relays.',
      category: 'Mesh',
      creatorDid: testCreatorDid,
      channelId: 'ch-parity-test',
      status: 'ready',
      views: 320,
      durationSeconds: 120,
      thumbnailUrl: 'https://images.unsplash.com/photo-test-2.jpg',
      createdAt: Date.now()
    });

    // Seed test comments
    (sovraDb as any).db.video_comments[testVideoId1] = [
      {
        id: testCommentId1,
        videoId: testVideoId1,
        authorName: 'SovereignPeer_A',
        authorHandle: '@peer_a',
        authorDid: 'did:sovra:peer_a',
        text: 'This 4K HLS mesh streaming is blistering fast!',
        createdAt: Date.now(),
        likes: 12,
        isHearted: false,
        isPinned: false,
        moderationState: 'PUBLISHED'
      },
      {
        id: testCommentId2,
        videoId: testVideoId1,
        authorName: 'SovereignPeer_B',
        authorHandle: '@peer_b',
        authorDid: 'did:sovra:peer_b',
        text: 'How does it perform over high-latency cellular connections?',
        createdAt: Date.now() + 1000,
        likes: 5,
        isHearted: false,
        isPinned: false,
        moderationState: 'PUBLISHED'
      }
    ];

    sovraDb.save();
  });

  // =========================================================================
  // MILESTONE 1: Dynamic Video Dropdowns (Trailer, Featured & End-Screens)
  // =========================================================================
  describe('Milestone 1: Dynamic Video Dropdowns', () => {
    it('loadCustomization dynamically iterates contentLibrary for trailer & featured video selects', () => {
      expect(scriptsViewContent).toContain('loadCustomization: function()');
      expect(scriptsViewContent).toContain('customTrailerSelect');
      expect(scriptsViewContent).toContain('customFeaturedSelect');
      expect(scriptsViewContent).toMatch(/self\.contentLibrary\.map\(function\(vid\)/);
    });

    it('openVideoDetailsModal dynamically populates endScreen options excluding current videoId', () => {
      expect(scriptsViewContent).toContain('editVideoEndScreenSelect');
      expect(scriptsViewContent).toMatch(/if\s*\(item\.id\s*!==\s*videoId\)/);
      expect(scriptsViewContent).toContain('<option value="none">No end screen</option>');
    });
  });

  // =========================================================================
  // MILESTONE 2: Edit Video Thumbnail, Gating & Chapters Full Persistence
  // =========================================================================
  describe('Milestone 2: Edit Video Thumbnail, Gating & Chapters Persistence', () => {
    it('openVideoDetailsModal sets checked state for gating radios', () => {
      expect(scriptsViewContent).toContain('editGateSupporter');
      expect(scriptsViewContent).toContain('editGatePreview');
      expect(scriptsViewContent).toContain('editGateFree');
    });

    it('saveVideoDetails extracts active thumbnail, gating radio, and chapters', () => {
      expect(scriptsViewContent).toContain('editVideoPreviewThumb');
      expect(scriptsViewContent).toContain('input[name="editGatingTier"]:checked');
      expect(scriptsViewContent).toContain('editVideoChaptersList');
      expect(scriptsViewContent).toContain('monetizationGating: gatingTier');
    });

    it('POST /api/studio/video/update persists thumbnail, gating, and chapters in database', async () => {
      let status = 0;
      let bodyData = '';
      const mockRes: any = {
        writeHead: (s: number) => { status = s; },
        end: (d: string) => { bodyData = d; }
      };

      const ctx: any = {
        url: new URL('http://localhost:3000/api/studio/video/update'),
        req: { method: 'POST', url: '/api/studio/video/update', headers: {} },
        res: mockRes,
        readBoundedBody: async () => ({
          body: JSON.stringify({
            id: testVideoId1,
            title: 'Decentralized P2P Mesh Architecture (Updated)',
            thumbnailUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD',
            monetizationGating: 'supporter_gated',
            monetization: { tier: 'supporter_gated' },
            chapters: [
              { time: '00:00', timecode: '00:00', title: 'Mesh Overview' },
              { time: '01:15', timecode: '01:15', title: 'BitSwap Bitrate Switching' }
            ]
          }),
          ok: true
        }),
        resolvePrincipal: () => ({ did: testCreatorDid, handle: '@creator' }),
        enforceAuth: () => ({ did: testCreatorDid, handle: '@creator' })
      };

      const handled = await handleStudioTranscoderRoutes(ctx);

      expect(handled).toBe(true);
      expect(status).toBe(200);

      const parsed = JSON.parse(bodyData);
      expect(parsed.ok).toBe(true);
      expect(parsed.video.thumbnailUrl).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD');
      expect(parsed.video.monetizationGating).toBe('supporter_gated');
      expect(parsed.video.chapters).toHaveLength(2);
      expect(parsed.video.chapters[0].title).toBe('Mesh Overview');
    });
  });

  // =========================================================================
  // MILESTONE 3: Real Creator Comment Heart & Pin Synchronization
  // =========================================================================
  describe('Milestone 3: Real Creator Comment Heart & Pin Synchronization', () => {
    it('sovraDb.moderateComment supports action: "heart" and toggles isHearted', () => {
      // Initially false
      const res1 = sovraDb.moderateComment(testVideoId1, testCommentId1, 'heart');
      expect(res1.ok).toBe(true);
      expect(res1.comment?.isHearted).toBe(true);

      // Second call toggles to false
      const res2 = sovraDb.moderateComment(testVideoId1, testCommentId1, 'heart');
      expect(res2.ok).toBe(true);
      expect(res2.comment?.isHearted).toBe(false);
    });

    it('sovraDb.moderateComment supports action: "pin" and toggles isPinned while unpinning others', () => {
      // Pin comment 1
      const res1 = sovraDb.moderateComment(testVideoId1, testCommentId1, 'pin');
      expect(res1.ok).toBe(true);
      expect(res1.comment?.isPinned).toBe(true);

      // Pin comment 2 -> comment 1 should be unpinned, comment 2 should be pinned
      const res2 = sovraDb.moderateComment(testVideoId1, testCommentId2, 'pin');
      expect(res2.ok).toBe(true);
      expect(res2.comment?.isPinned).toBe(true);

      sovraDb.load();
      const comments = (sovraDb as any).db.video_comments[testVideoId1];
      const comm1 = comments.find((c: any) => c.id === testCommentId1);
      const comm2 = comments.find((c: any) => c.id === testCommentId2);
      expect(comm1.isPinned).toBe(false);
      expect(comm2.isPinned).toBe(true);
    });

    it('POST /api/studio/comments/moderate processes heart & pin actions', async () => {
      let status = 0;
      let bodyData = '';
      const mockRes: any = {
        writeHead: (s: number) => { status = s; },
        end: (d: string) => { bodyData = d; }
      };

      const ctx: any = {
        url: new URL('http://localhost:3000/api/studio/comments/moderate'),
        req: { method: 'POST', url: '/api/studio/comments/moderate', headers: {} },
        res: mockRes,
        readBoundedBody: async () => ({
          body: JSON.stringify({
            videoId: testVideoId1,
            commentId: testCommentId1,
            action: 'heart'
          }),
          ok: true
        }),
        resolvePrincipal: () => ({ did: testCreatorDid, handle: '@creator' }),
        enforceAuth: () => ({ did: testCreatorDid, handle: '@creator' })
      };

      const handled = await handleStudioTranscoderRoutes(ctx);

      expect(handled).toBe(true);
      expect(status).toBe(200);
      const parsed = JSON.parse(bodyData);
      expect(parsed.ok).toBe(true);
      expect(parsed.comment.isHearted).toBe(true);
    });

    it('toggleStudioHeart and toggleStudioPin in scripts.view.ts call /api/studio/comments/moderate', () => {
      expect(scriptsViewContent).toContain('toggleStudioHeart: function(videoId, commentId)');
      expect(scriptsViewContent).toContain('toggleStudioPin: function(videoId, commentId)');
      expect(scriptsViewContent).toMatch(/\/api\/studio\/comments\/moderate/);
    });
  });

  // =========================================================================
  // MILESTONE 4: Lossless Video Trimmer & Timeline Scrubber
  // =========================================================================
  describe('Milestone 4: Lossless Video Trimmer & Timeline Scrubber', () => {
    it('layout.view.ts contains #studioVideoTrimmerModal with required controls', () => {
      expect(layoutViewContent).toContain('id="studioVideoTrimmerModal"');
      expect(layoutViewContent).toContain('id="studioTrimVideoPlayer"');
      expect(layoutViewContent).toContain('id="studioTrimStartSec"');
      expect(layoutViewContent).toContain('id="studioTrimEndSec"');
      expect(layoutViewContent).toContain('id="studioTrimRangeSlider"');
      expect(layoutViewContent).toContain('id="btnApplyVideoTrim"');
    });

    it('Content table rows include "✂️ Trim" action button', () => {
      expect(scriptsViewContent).toContain('SovraCreatorStudioEngine.openVideoTrimmerModal');
      expect(scriptsViewContent).toContain('✂️ Trim');
    });

    it('SovraCreatorStudioEngine implements trimmer methods', () => {
      expect(scriptsViewContent).toContain('openVideoTrimmerModal: function(videoId)');
      expect(scriptsViewContent).toContain('closeVideoTrimmerModal: function()');
      expect(scriptsViewContent).toContain('onTrimInputChange: function()');
      expect(scriptsViewContent).toContain('applyVideoTrim: function()');
    });

    it('POST /api/studio/video/trim trims video boundaries in database', async () => {
      let status = 0;
      let bodyData = '';
      const mockRes: any = {
        writeHead: (s: number) => { status = s; },
        end: (d: string) => { bodyData = d; }
      };

      const ctx: any = {
        url: new URL('http://localhost:3000/api/studio/video/trim'),
        req: { method: 'POST', url: '/api/studio/video/trim', headers: {} },
        res: mockRes,
        readBoundedBody: async () => ({
          body: JSON.stringify({
            videoId: testVideoId1,
            startOffsetSec: 15.5,
            endOffsetSec: 120.0
          }),
          ok: true
        }),
        resolvePrincipal: () => ({ did: testCreatorDid, handle: '@creator' }),
        enforceAuth: () => ({ did: testCreatorDid, handle: '@creator' })
      };

      const handled = await handleStudioTranscoderRoutes(ctx);

      expect(handled).toBe(true);
      expect(status).toBe(200);

      const parsed = JSON.parse(bodyData);
      expect(parsed.ok).toBe(true);
      expect(parsed.video.startOffsetSec).toBe(15.5);
      expect(parsed.video.endOffsetSec).toBe(120.0);
      expect(parsed.video.trimConfig.durationSec).toBe(104.5);
    });
  });

  // =========================================================================
  // MILESTONE 5: Channel Customization Full Persistence
  // =========================================================================
  describe('Milestone 5: Channel Customization Full Persistence', () => {
    it('layout.view.ts binds onchange to #customAvatarInput and #customWatermarkInput', () => {
      expect(layoutViewContent).toContain('id="customAvatarInput"');
      expect(layoutViewContent).toContain('onchange="SovraCreatorStudioEngine.handleAvatarUploaded(event)"');
      expect(layoutViewContent).toContain('id="customWatermarkInput"');
      expect(layoutViewContent).toContain('onchange="SovraCreatorStudioEngine.handleWatermarkUploaded(event)"');
    });

    it('SovraCreatorStudioEngine handles avatar, banner, watermark and links', () => {
      expect(scriptsViewContent).toContain('handleAvatarUploaded: function(e)');
      expect(scriptsViewContent).toContain('handleWatermarkUploaded: function(e)');
      expect(scriptsViewContent).toContain('handleBannerUploaded: function(e)');
      expect(scriptsViewContent).toContain('socialLinks: links');
    });

    it('POST /api/studio/customization/save stores avatar, banner, watermark and socialLinks', async () => {
      let status = 0;
      let bodyData = '';
      const mockRes: any = {
        writeHead: (s: number) => { status = s; },
        end: (d: string) => { bodyData = d; }
      };

      const ctx: any = {
        url: new URL('http://localhost:3000/api/studio/customization/save'),
        req: { method: 'POST', url: '/api/studio/customization/save', headers: {} },
        res: mockRes,
        readBoundedBody: async () => ({
          body: JSON.stringify({
            channelName: 'Sovereign Lab Tech',
            channelHandle: 'sovereign_lab',
            channelBio: 'Decentralized systems engineering and research.',
            avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9h',
            bannerUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9h',
            watermark: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9h',
            socialLinks: 'https://sovra.network, https://github.com/sovra'
          }),
          ok: true
        }),
        resolvePrincipal: () => ({ did: testCreatorDid, handle: '@sovereign_lab' }),
        enforceAuth: () => ({ did: testCreatorDid, handle: '@sovereign_lab' })
      };

      const handled = await handleStudioTranscoderRoutes(ctx);

      expect(handled).toBe(true);
      expect(status).toBe(200);

      const parsed = JSON.parse(bodyData);
      expect(parsed.ok).toBe(true);
      expect(parsed.customization.avatar).toContain('data:image/png');
      expect(parsed.customization.watermark).toContain('data:image/png');
      expect(parsed.customization.socialLinks).toBe('https://sovra.network, https://github.com/sovra');
    });
  });

  // =========================================================================
  // MILESTONE 6: Live Streaming RTMP Ingest Keys Card
  // =========================================================================
  describe('Milestone 6: Live Streaming RTMP Ingest Keys Card', () => {
    it('layout.view.ts contains #studioLiveIngestCard with RTMP elements', () => {
      expect(layoutViewContent).toContain('id="studioLiveIngestCard"');
      expect(layoutViewContent).toContain('id="studioRtmpStreamUrl"');
      expect(layoutViewContent).toContain('rtmp://live.sovra.network/live');
      expect(layoutViewContent).toContain('id="studioRtmpStreamKey"');
      expect(layoutViewContent).toContain('id="btnToggleStreamKey"');
      expect(layoutViewContent).toContain('id="btnCopyStreamKey"');
      expect(layoutViewContent).toContain('id="btnResetStreamKey"');
      expect(layoutViewContent).toContain('id="studioRtmpLowLatency"');
    });

    it('SovraCreatorStudioEngine implements Live Streaming management methods', () => {
      expect(scriptsViewContent).toContain('toggleStreamKeyVisibility: function()');
      expect(scriptsViewContent).toContain('copyStreamKey: function()');
      expect(scriptsViewContent).toContain('resetStreamKey: function()');
      expect(scriptsViewContent).toContain('copyRtmpUrl: function()');
      expect(scriptsViewContent).toContain('toggleLowLatency: function(enabled)');
    });
  });
});
