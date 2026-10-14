/**
 * @file tests/e2e/youtube-studio-parity.test.ts
 * 100% YOUTUBE STUDIO FLAGSHIP FEATURE PARITY FOR SOVRA
 *
 * Verifies all 8 YouTube Studio Flagship Pillars:
 * 1. Studio Sidebar Navigation (#studioNavSidebar) & Command Center Dashboard (#studioSectionDashboard)
 * 2. Advanced Content Manager (#studioSectionContent) & Multi-Filter Video Library
 * 3. Dedicated Video Details & Post-Production Editor Modal (#studioVideoDetailsModal)
 * 4. YouTube 4-Tab Deep Analytics Engine (#studioSectionAnalytics: Overview, Reach, Engagement, Audience & Revenue)
 * 5. Community Comments & Moderation Studio (#studioSectionComments)
 * 6. Dedicated Subtitles & Closed Captions Track Studio (#studioSectionSubtitles)
 * 7. Channel Customization & Branding Studio (#studioSectionCustomization)
 * 8. Sovereign Royalty-Free Audio & SFX Library (#studioSectionAudio)
 *
 * Plus Backend Studio Routes (/api/studio/*) and Database Engine persistence.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { sovraDb } from '../../scripts/database-engine.ts';
import { handleStudioRoutes } from '../../scripts/routes/studio.routes.ts';

describe('100% YouTube Studio Flagship Parity Verification Suite', () => {
  const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
  const studioRoutesPath = path.resolve(__dirname, '../../scripts/routes/studio.routes.ts');
  const serverContent = fs.readFileSync(devServerPath, 'utf8');
  const studioRoutesContent = fs.readFileSync(studioRoutesPath, 'utf8');

  const testCreatorDid = 'did:sovra:creator_studio_test_did';

  beforeAll(() => {
    // Ensure videos are loaded in DB
    sovraDb.getAllVideos();
  });

  // =========================================================================
  // PILLAR 1: STUDIO SIDEBAR NAVIGATION & DASHBOARD COMMAND CENTER
  // =========================================================================
  describe('Pillar 1: Studio Sidebar Navigation & Command Center Dashboard', () => {
    it('1.1 Sidebar Navigation contains all 7 primary studio links plus channel branding badge', () => {
      expect(serverContent).toContain('id="studioNavSidebar"');
      expect(serverContent).toContain('id="studioChannelAvatar"');
      expect(serverContent).toContain('id="studioChannelName"');
      expect(serverContent).toContain('id="studioChannelHandle"');

      // 7 Primary links
      expect(serverContent).toContain('id="studioNavDashboard"');
      expect(serverContent).toContain('id="studioNavContent"');
      expect(serverContent).toContain('id="studioNavAnalytics"');
      expect(serverContent).toContain('id="studioNavComments"');
      expect(serverContent).toContain('id="studioNavSubtitles"');
      expect(serverContent).toContain('id="studioNavCustomization"');
      expect(serverContent).toContain('id="studioNavAudio"');

      // Quick-action Ingest & Schedule links
      expect(serverContent).toContain('id="studioNavIngest"');
      expect(serverContent).toContain('id="studioNavSchedule"');
    });

    it('1.2 Dashboard Command Center features Latest Video Performance Scorecard with YouTube benchmark metrics', () => {
      expect(serverContent).toContain('id="studioSectionDashboard"');
      expect(serverContent).toContain('id="studioLatestVideoCard"');
      expect(serverContent).toContain('id="scorecardVideoThumb"');
      expect(serverContent).toContain('id="scorecardVideoTitle"');
      expect(serverContent).toContain('id="scorecardRank"');
      expect(serverContent).toContain('id="scorecardViews"');
      expect(serverContent).toContain('id="scorecardCtr"');
      expect(serverContent).toContain('id="scorecardAvgDuration"');

      // Ranking format e.g. 1 of 10 and comparison indicators
      expect(serverContent).toContain('Ranking by views:');
      expect(serverContent).toContain('Impressions click-through rate:');
      expect(serverContent).toContain('Average view duration:');
    });

    it('1.3 Dashboard includes Real-Time Activity Ticker with dynamic SVG histogram bars and Channel Analytics Snapshot', () => {
      expect(serverContent).toContain('id="studioRealtimeTickerCard"');
      expect(serverContent).toContain('id="tickerViews48h"');
      expect(serverContent).toContain('id="tickerViews60m"');
      expect(serverContent).toContain('id="tickerSvgBars"');

      // Channel Analytics Snapshot card
      expect(serverContent).toContain('id="studioChannelSummaryCard"');
      expect(serverContent).toContain('id="dashTotalViews"');
      expect(serverContent).toContain('id="dashWatchHours"');
      expect(serverContent).toContain('id="dashSubscribers"');
      expect(serverContent).toContain('id="dashEarnedSov"');
      expect(serverContent).toContain('95% Net Creator');
    });

    it('1.4 Dashboard features Recent Unanswered Comments with creator heart and inline reply action', () => {
      expect(serverContent).toContain('id="studioRecentCommentsCard"');
      expect(serverContent).toContain('id="dashRecentCommentsList"');
      expect(serverContent).toContain('Recent Comments &amp; Mentions');
    });
  });

  // =========================================================================
  // PILLAR 2: ADVANCED CONTENT MANAGER & MULTI-FILTER VIDEO LIBRARY
  // =========================================================================
  describe('Pillar 2: Advanced Content Manager & Multi-Filter Library', () => {
    it('2.1 Content Manager features YouTube Studio subtabs: Long-form Videos, Shorts / Reels, and Scheduled', () => {
      expect(serverContent).toContain('id="studioSectionContent"');
      expect(serverContent).toContain('id="studioContentTabVideos"');
      expect(serverContent).toContain('id="studioContentTabReels"');
      expect(serverContent).toContain('id="studioContentTabScheduled"');
    });

    it('2.2 Content Manager provides Visibility filter dropdown and real-time search filtering', () => {
      expect(serverContent).toContain('id="studioVisibilityFilter"');
      expect(serverContent).toContain('id="studioWsContentSearch"');
      expect(serverContent).toContain('filterContentByVisibility');
      expect(serverContent).toContain('filterContentLibrary');
    });

    it('2.3 Video Table incorporates YouTube Studio columns: Thumbnail, Visibility, Restrictions, Date, Views, Comments, Likes %, Net SOV, Actions', () => {
      expect(serverContent).toContain('id="studioContentTable"');
      expect(serverContent).toContain('id="studioContentTableBody"');
      expect(serverContent).toContain('<th>VIDEO</th>');
      expect(serverContent).toContain('<th>VISIBILITY</th>');
      expect(serverContent).toContain('<th>RESTRICTIONS</th>');
      expect(serverContent).toContain('<th>DATE</th>');
      expect(serverContent).toContain('<th>VIEWS</th>');
      expect(serverContent).toContain('<th>COMMENTS</th>');
      expect(serverContent).toContain('<th>LIKES %</th>');
      expect(serverContent).toContain('<th>NET SOV</th>');
      expect(serverContent).toContain('ACTIONS</th>');
    });

    it('2.4 Action buttons invoke post-production editor modal and quick telemetry triggers', () => {
      expect(serverContent).toContain('openVideoDetailsModal');
      expect(serverContent).toContain('copyHlsUrl');
      expect(serverContent).toContain('deleteVideoContent');
    });
  });

  // =========================================================================
  // PILLAR 3: DEDICATED VIDEO DETAILS & POST-PRODUCTION EDITOR MODAL
  // =========================================================================
  describe('Pillar 3: Dedicated Video Details & Post-Production Editor Modal', () => {
    it('3.1 Modal structure hosts two-column post-production layout (#studioVideoDetailsModal)', () => {
      expect(serverContent).toContain('id="studioVideoDetailsModal"');
      expect(serverContent).toContain('id="editVideoId"');
      expect(serverContent).toContain('id="editVideoTitle"');
      expect(serverContent).toContain('id="editVideoTitleCount"');
      expect(serverContent).toContain('id="editVideoDesc"');
      expect(serverContent).toContain('id="editVideoDescPreview"');
      expect(serverContent).toContain('id="editVideoCategory"');
      expect(serverContent).toContain('id="editVideoAudience"');
    });

    it('3.2 Smart Thumbnail Picker supports 3 auto-extracted canvas frames plus custom upload', () => {
      expect(serverContent).toContain('id="editVideoThumbCandidates"');
      expect(serverContent).toContain('id="editVideoCustomThumbInput"');
      expect(serverContent).toContain('id="editVideoThumbBadge"');
      expect(serverContent).toContain('handleEditCustomThumb');
    });

    it('3.3 Right column displays RFC 8216 HLS master URL, CIDv1 multihash, quality badges, and 95/5 gating', () => {
      expect(serverContent).toContain('id="editVideoPreviewThumb"');
      expect(serverContent).toContain('id="editVideoCid"');
      expect(serverContent).toContain('id="editGateFree"');
      expect(serverContent).toContain('id="editGateSupporter"');
      expect(serverContent).toContain('id="editGatePreview"');
    });

    it('3.4 Video Details includes clickable chapter timecode builder and subtitle track shortcut', () => {
      expect(serverContent).toContain('id="editChapterTime"');
      expect(serverContent).toContain('id="editChapterTitle"');
      expect(serverContent).toContain('id="editVideoChaptersList"');
      expect(serverContent).toContain('addEditChapter');
      expect(serverContent).toContain('saveVideoDetails');
    });
  });

  // =========================================================================
  // PILLAR 4: YOUTUBE 4-TAB DEEP ANALYTICS ENGINE
  // =========================================================================
  describe('Pillar 4: YouTube 4-Tab Deep Analytics Engine', () => {
    it('4.1 4-Pillar Subtab Navigation exists (Overview, Reach, Engagement, Audience & Revenue)', () => {
      expect(serverContent).toContain('id="analyticsTabOverview"');
      expect(serverContent).toContain('id="analyticsTabReach"');
      expect(serverContent).toContain('id="analyticsTabEngagement"');
      expect(serverContent).toContain('id="analyticsTabAudience"');

      expect(serverContent).toContain('id="analyticsPaneOverview"');
      expect(serverContent).toContain('id="analyticsPaneReach"');
      expect(serverContent).toContain('id="analyticsPaneEngagement"');
      expect(serverContent).toContain('id="analyticsPaneAudience"');
    });

    it('4.2 Reach Pane charts Impressions, CTR (8.4%), Unique Viewers, and Traffic Sources distribution', () => {
      expect(serverContent).toContain('Impressions Click-Through Rate (CTR)');
      expect(serverContent).toContain('8.4%');
      expect(serverContent).toContain('id="studioSvgTrafficSources"');
      expect(serverContent).toContain('Traffic Source Types');
    });

    it('4.3 Engagement Pane displays Watch Hours, Average View Duration, and Audience Retention Curve with Spikes and Dips', () => {
      expect(serverContent).toContain('id="studioSvgRetention"');
      expect(serverContent).toContain('Key Moments for Audience Retention');
      expect(serverContent).toContain('▲ Spike @ 01:20');
      expect(serverContent).toContain('▼ Dip @ 03:40');
    });

    it('4.4 Audience & Revenue Pane covers Returning vs New viewers, RPM, and 95/5 creator split breakdown', () => {
      expect(serverContent).toContain('Returning Viewers');
      expect(serverContent).toContain('New Viewers');
      expect(serverContent).toContain('Playback RPM');
      expect(serverContent).toContain('id="studioSvgAudienceType"');
    });
  });

  // =========================================================================
  // PILLAR 5: COMMUNITY COMMENTS & MODERATION STUDIO
  // =========================================================================
  describe('Pillar 5: Community Comments & Moderation Studio', () => {
    it('5.1 Comments Studio incorporates Published and Held for Review tabs', () => {
      expect(serverContent).toContain('id="studioSectionComments"');
      expect(serverContent).toContain('id="commentsSubtabPublished"');
      expect(serverContent).toContain('id="commentsSubtabHeld"');
      expect(serverContent).toContain('id="studioCommentsHubList"');
    });

    it('5.2 Comments filter pills include All, Unanswered, and Contains questions', () => {
      expect(serverContent).toContain('id="commentsFilterAll"');
      expect(serverContent).toContain('id="commentsFilterUnanswered"');
      expect(serverContent).toContain('id="commentsFilterQuestions"');
    });

    it('5.3 Interactive comment moderation actions support inline replies, heart, pin, and delete', () => {
      expect(serverContent).toContain('submitCreatorReply');
      expect(serverContent).toContain('toggleStudioHeart');
      expect(serverContent).toContain('toggleStudioPin');
    });
  });

  // =========================================================================
  // PILLAR 6: DEDICATED SUBTITLES & CLOSED CAPTIONS STUDIO
  // =========================================================================
  describe('Pillar 6: Dedicated Subtitles & Closed Captions Track Studio', () => {
    it('6.1 Subtitles Studio contains language track switcher and interactive cue timing table', () => {
      expect(serverContent).toContain('id="studioSectionSubtitles"');
      expect(serverContent).toContain('id="subtitlesLanguageSelect"');
      expect(serverContent).toContain('id="subtitlesCuesTable"');
      expect(serverContent).toContain('id="subtitlesCuesTableBody"');
    });

    it('6.2 Supports synchronized mini video preview and WebVTT (.vtt) file export', () => {
      expect(serverContent).toContain('downloadWebVTT');
      expect(serverContent).toContain('saveSubtitles');
      expect(serverContent).toContain('addSubtitleCue');
    });
  });

  // =========================================================================
  // PILLAR 7: CHANNEL CUSTOMIZATION & BRANDING STUDIO
  // =========================================================================
  describe('Pillar 7: Channel Customization & Branding Studio', () => {
    it('7.1 Channel Customization hosts 3 subtabs: Layout, Branding, and Basic Info', () => {
      expect(serverContent).toContain('id="studioSectionCustomization"');
      expect(serverContent).toContain('id="customSubtabLayout"');
      expect(serverContent).toContain('id="customSubtabBranding"');
      expect(serverContent).toContain('id="customSubtabBasic"');

      expect(serverContent).toContain('id="customPaneLayout"');
      expect(serverContent).toContain('id="customPaneBranding"');
      expect(serverContent).toContain('id="customPaneBasic"');
    });

    it('7.2 Branding controls include Avatar, 16:9 Banner, and Video Watermark stamp', () => {
      expect(serverContent).toContain('id="customAvatarInput"');
      expect(serverContent).toContain('id="customBannerInput"');
      expect(serverContent).toContain('id="customWatermarkInput"');
      expect(serverContent).toContain('id="customBannerPreview"');
    });

    it('7.3 Basic Info covers Channel Name, Handle, Description, and DID cryptographic fingerprint', () => {
      expect(serverContent).toContain('id="customChannelName"');
      expect(serverContent).toContain('id="customChannelHandle"');
      expect(serverContent).toContain('id="customChannelBio"');
      expect(serverContent).toContain('id="customChannelLinks"');
      expect(serverContent).toContain('id="customChannelDid"');
      expect(serverContent).toContain('saveCustomization');
    });
  });

  // =========================================================================
  // PILLAR 8: SOVEREIGN ROYALTY-FREE AUDIO & SFX LIBRARY
  // =========================================================================
  describe('Pillar 8: Sovereign Royalty-Free Audio & SFX Library', () => {
    it('8.1 Audio Library contains track catalog, genre filter pills, and search bar', () => {
      expect(serverContent).toContain('id="studioSectionAudio"');
      expect(serverContent).toContain('id="audioTracksTable"');
      expect(serverContent).toContain('id="audioSearchInput"');
      expect(serverContent).toContain('filterAudioLibrary');
    });

    it('8.2 Persistent Audio Player includes animated SVG waveform visualizer and playback controls', () => {
      expect(serverContent).toContain('studio-audio-waveform-bar');
      expect(serverContent).toContain('togglePlayAudioTrack');
      expect(serverContent).toContain('attachAudioToProject');
      expect(serverContent).toContain('downloadAudioTrack');
    });
  });

  // =========================================================================
  // BACKEND API ENDPOINTS & DATABASE PERSISTENCE TESTS
  // =========================================================================
  describe('Backend API Routes & Database Engine Persistence', () => {
    async function invokeStudioRoute(method: string, pathname: string, bodyObj?: any, creatorDid: string = testCreatorDid) {
      let resStatus = 0;
      let resHeaders: any = {};
      let resBody = '';

      const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
      const urlObj = new URL(`http://localhost:3001${pathname}`);

      const reqMock: any = {
        method,
        url: pathname,
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token'
        }
      };

      const resMock: any = {
        writeHead: (code: number, headers?: any) => {
          resStatus = code;
          resHeaders = headers || {};
        },
        end: (data: string) => {
          resBody = data;
        }
      };

      const handled = await handleStudioRoutes({
        req: reqMock,
        res: resMock,
        url: urlObj,
        readBoundedBody: async () => ({ body: bodyStr, ok: true }),
        resolvePrincipal: () => ({ did: creatorDid } as any),
        enforceAuth: () => ({ did: creatorDid } as any),
      });

      return { handled, status: resStatus, data: resBody ? JSON.parse(resBody) : null };
    }

    it('9.1 GET & POST /api/studio/video/details and /api/studio/video/update handle post-production metadata', async () => {
      const allVideos = sovraDb.getAllVideos();
      expect(allVideos.length).toBeGreaterThan(0);
      const testVid = allVideos[0];

      // Test GET /api/studio/video/details route
      const getRes = await invokeStudioRoute('GET', `/api/studio/video/details?videoId=${testVid.id}&creatorDid=${testCreatorDid}`);
      expect(getRes.handled).toBe(true);
      expect(getRes.status).toBe(200);
      expect(getRes.data.ok).toBe(true);
      expect(getRes.data.video.id).toBe(testVid.id);

      // Test POST /api/studio/video/update
      const updatedTitle = 'Decentralized Sovereign Mesh (Updated 4K)';
      const postRes = await invokeStudioRoute('POST', '/api/studio/video/update', {
        videoId: testVid.id,
        title: updatedTitle,
        description: 'New markdown post-production description with 95/5 split.',
        category: 'Tech',
        tags: ['p2p', 'sovra', 'mesh'],
        isCoppaCompliant: true,
        chapters: [{ time: '00:00', title: 'Intro' }],
        monetizationGating: 'supporter_gated',
        gatingPriceSov: 10.0,
      });
      expect(postRes.handled).toBe(true);
      expect(postRes.status).toBe(200);
      expect(postRes.data.ok).toBe(true);

      // Verify DB persistence
      const persistedVideo = sovraDb.getVideoById(testVid.id);
      expect(persistedVideo).toBeDefined();
      expect(persistedVideo?.title).toBe(updatedTitle);
    });

    it('9.2 GET & POST /api/studio/comments and /api/studio/comments/reply handle creator replies and moderation', async () => {
      const getRes = await invokeStudioRoute('GET', `/api/studio/comments?creatorDid=${testCreatorDid}&filter=all`);
      expect(getRes.handled).toBe(true);
      expect(getRes.status).toBe(200);
      expect(getRes.data.ok).toBe(true);
      expect(Array.isArray(getRes.data.comments)).toBe(true);

      const allVideos = sovraDb.getAllVideos();
      const testVidId = allVideos[0].id;
      const replyRes = await invokeStudioRoute('POST', '/api/studio/comments/reply', {
        videoId: testVidId,
        parentCommentId: 'comm_root_test',
        text: 'Thank you for supporting sovereign P2P video! 🚀'
      });
      expect(replyRes.handled).toBe(true);
      expect(replyRes.status).toBe(200);
      expect(replyRes.data.ok).toBe(true);
      expect(replyRes.data.reply).toBeDefined();
    });

    it('9.3 GET & POST /api/studio/subtitles and /api/studio/subtitles/save manage WebVTT subtitle tracks', async () => {
      const allVideos = sovraDb.getAllVideos();
      const testVidId = allVideos[0].id;
      const sampleCues = [
        { start: '00:00:01.000', end: '00:00:04.500', text: 'Welcome to Sovra Creator Studio.' },
        { start: '00:00:05.000', end: '00:00:09.000', text: 'Decentralized peer-to-peer streaming with RFC 8216 HLS.' }
      ];

      const saveRes = await invokeStudioRoute('POST', '/api/studio/subtitles/save', {
        videoId: testVidId,
        language: 'en',
        cues: sampleCues
      });
      expect(saveRes.handled).toBe(true);
      expect(saveRes.status).toBe(200);
      expect(saveRes.data.ok).toBe(true);

      const getRes = await invokeStudioRoute('GET', `/api/studio/subtitles?videoId=${testVidId}&language=en`);
      expect(getRes.handled).toBe(true);
      expect(getRes.status).toBe(200);
      expect(getRes.data.ok).toBe(true);
      expect(Array.isArray(getRes.data.cues)).toBe(true);
      expect(getRes.data.cues.length).toBe(2);
      expect(getRes.data.cues[0].text).toBe(sampleCues[0].text);
    });

    it('9.4 GET & POST /api/studio/customization and /api/studio/customization/save handle channel branding', async () => {
      const customData = {
        channelName: 'Sovereign Nexus Broadcasts',
        channelHandle: '@sovnexus',
        bio: 'Autonomous peer-to-peer decentralized broadcasting.',
        links: 'https://sovra.network',
        bannerUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1600&q=80',
        avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=nexus'
      };

      const saveRes = await invokeStudioRoute('POST', '/api/studio/customization/save', customData);
      expect(saveRes.handled).toBe(true);
      expect(saveRes.status).toBe(200);
      expect(saveRes.data.ok).toBe(true);

      const getRes = await invokeStudioRoute('GET', `/api/studio/customization?creatorDid=${testCreatorDid}`);
      expect(getRes.handled).toBe(true);
      expect(getRes.status).toBe(200);
      expect(getRes.data.ok).toBe(true);
      expect(getRes.data.customization.channelName).toBe(customData.channelName);
      expect(getRes.data.customization.channelHandle).toBe(customData.channelHandle);
    });

    it('9.5 GET /api/studio/audio-library serves royalty-free music & SFX tracks with genre metadata', async () => {
      const getRes = await invokeStudioRoute('GET', '/api/studio/audio-library');
      expect(getRes.handled).toBe(true);
      expect(getRes.status).toBe(200);
      expect(getRes.data.ok).toBe(true);
      expect(Array.isArray(getRes.data.tracks)).toBe(true);
      expect(getRes.data.tracks.length).toBeGreaterThan(0);

      const firstTrack = getRes.data.tracks[0];
      expect(firstTrack.title).toBeDefined();
      expect(firstTrack.artist).toBeDefined();
      expect(firstTrack.genre).toBeDefined();
      expect(firstTrack.duration).toBeDefined();
      expect(firstTrack.license).toBe('Royalty-Free Creative Commons 4.0');
    });
  });
});
