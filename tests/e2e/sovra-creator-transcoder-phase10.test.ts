/**
 * @file tests/e2e/sovra-creator-transcoder-phase10.test.ts
 * SOVRA PHASE 10: SOVEREIGN CREATOR STUDIO PRO & MULTI-RESOLUTION TRANSCODER ENGINE
 *
 * Verifies:
 * 1. Creator Studio Dashboard analytics & job summary (/api/studio/dashboard)
 * 2. Multi-bitrate HLS video ingestion & background transcoding (1080p, 720p, 480p, 360p)
 * 3. Master RFC 8216 HLS playlist generation & variant CID mapping
 * 4. Job status polling and validation error handling (/api/studio/transcode/status)
 * 5. Scheduled video publication pipeline & queue management (/api/studio/schedule & /api/studio/schedule/queue)
 * 6. Instant publication of scheduled releases (/api/studio/publish-now)
 * 7. Client UI elements and engine exposure (#sovraCreatorStudioModal, window.SovraCreatorStudioEngine)
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('SOVRA Phase 10: Sovereign Creator Studio Pro & Transcoder Engine', () => {
  const ts = Date.now();
  let creatorToken: string;
  let creatorDid: string;
  let primaryJobId: string;
  let scheduledJobId: string;

  beforeAll(async () => {
    // Register creator test user
    const regRes = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@creator_studio_${ts}`,
        name: 'Pro Studio Creator',
        bio: 'Sovereign 4K/HLS creator node operator #studio #creator',
      }),
    });
    expect(regRes.status).toBe(200);
    const regData = await regRes.json();
    expect(regData.ok).toBe(true);
    creatorToken = regData.sessionToken;
    creatorDid = regData.user.did;
  });

  describe('1. Creator Studio Dashboard Analytics', () => {
    it('retrieves initial studio dashboard analytics with zero/default state', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/dashboard?creatorDid=${encodeURIComponent(creatorDid)}`, {
        headers: { Authorization: `Bearer ${creatorToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.creatorDid).toBe(creatorDid);
      expect(data.dashboard).toBeDefined();
      expect(typeof data.dashboard.totalJobs).toBe('number');
      expect(typeof data.dashboard.totalViews).toBe('number');
      expect(typeof data.dashboard.totalEarnedSov).toBe('number');
      expect(typeof data.dashboard.scheduledVideos).toBe('number');
      expect(typeof data.dashboard.publishedVideos).toBe('number');
      expect(Array.isArray(data.dashboard.recentJobs)).toBe(true);
    });

    it('retrieves default studio dashboard without explicit creatorDid parameter', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/dashboard`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.dashboard).toBeDefined();
    });
  });

  describe('2. Multi-Bitrate Video Ingestion & HLS Transcoding', () => {
    it('ingests and transcodes video across 1080p, 720p, 480p, 360p with master playlist', async () => {
      const uploadPayload = {
        creatorDid,
        title: `Decentralized Mesh Architecture Deep Dive ${ts}`,
        description: 'Complete breakdown of peer-to-peer gossip sub protocols.',
        tags: '#p2p #mesh #sovereign',
        targetResolutions: ['1080p', '720p', '480p', '360p'],
        publishImmediately: true,
      };

      const res = await fetch(`${BASE_URL}/api/studio/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creatorToken}`,
        },
        body: JSON.stringify(uploadPayload),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.job).toBeDefined();
      expect(data.job.jobId).toBeDefined();
      primaryJobId = data.job.jobId;

      expect(data.job.status).toBe('completed');
      expect(data.job.progress).toBe(100);
      expect(data.job.published).toBe(true);
      expect(data.job.masterManifestCid).toMatch(/^bafybei(_master_|hls_)/);
      expect(data.job.masterPlaylistUrl).toContain(`/api/feed/video/${primaryJobId}/hls/master.m3u8`);

      // Verify all 4 requested resolutions were transcoded
      expect(Array.isArray(data.resolutionVariants)).toBe(true);
      expect(data.resolutionVariants).toContain('1080p');
      expect(data.resolutionVariants).toContain('720p');
      expect(data.resolutionVariants).toContain('480p');
      expect(data.resolutionVariants).toContain('360p');

      // Verify resolution CID mappings
      expect(data.job.resolutionCids).toBeDefined();
      expect(data.job.resolutionCids['1080p']).toBeDefined();
      expect(data.job.resolutionCids['720p']).toBeDefined();
      expect(data.job.resolutionCids['480p']).toBeDefined();
      expect(data.job.resolutionCids['360p']).toBeDefined();
    });

    it('rejects upload with malformed JSON body gracefully', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creatorToken}`,
        },
        body: 'invalid-json-body',
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toBeDefined();
    });
  });

  describe('3. Transcode Status Polling & Validation', () => {
    it('retrieves status and details of existing transcode job', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/transcode/status?jobId=${encodeURIComponent(primaryJobId)}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.job.jobId).toBe(primaryJobId);
      expect(data.job.status).toBe('completed');
      expect(data.job.progress).toBe(100);
      expect(data.job.masterManifestCid).toBeDefined();
    });

    it('returns 400 when jobId query parameter is missing', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/transcode/status`);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Missing jobId');
    });

    it('returns 404 when querying a non-existent jobId', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/transcode/status?jobId=non_existent_job_999`);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('not found');
    });
  });

  describe('4. Scheduled Video Publishing & Queue Management', () => {
    it('ingests a video scheduled for future release', async () => {
      const futureTime = Date.now() + 24 * 60 * 60 * 1000; // 24 hours in future
      const schedPayload = {
        creatorDid,
        title: `Premiering Tomorrow: Autonomous AI Swarms ${ts}`,
        description: 'Scheduled multi-camera presentation.',
        tags: '#premier #ai #swarm',
        targetResolutions: ['1080p', '720p'],
        publishImmediately: false,
        scheduledPublishAt: futureTime,
      };

      const res = await fetch(`${BASE_URL}/api/studio/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creatorToken}`,
        },
        body: JSON.stringify(schedPayload),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.job.published).toBe(false);
      expect(data.job.scheduledPublishAt).toBe(futureTime);
      scheduledJobId = data.job.jobId;
    });

    it('retrieves pending scheduled releases in the creator queue', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/schedule/queue?creatorDid=${encodeURIComponent(creatorDid)}`, {
        headers: { Authorization: `Bearer ${creatorToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.count).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(data.queue)).toBe(true);

      const found = data.queue.find((j: any) => j.jobId === scheduledJobId);
      expect(found).toBeDefined();
      expect(found.published).toBe(false);
      expect(found.title).toContain('Autonomous AI Swarms');
    });

    it('updates release schedule timestamp via /api/studio/schedule', async () => {
      const updatedTime = Date.now() + 48 * 60 * 60 * 1000; // 48 hours in future
      const res = await fetch(`${BASE_URL}/api/studio/schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creatorToken}`,
        },
        body: JSON.stringify({
          jobId: scheduledJobId,
          scheduledPublishAt: updatedTime,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.job.scheduledPublishAt).toBe(updatedTime);
    });

    it('rejects scheduling in the past with 400', async () => {
      const pastTime = Date.now() - 3600 * 1000;
      const res = await fetch(`${BASE_URL}/api/studio/schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creatorToken}`,
        },
        body: JSON.stringify({
          jobId: scheduledJobId,
          scheduledPublishAt: pastTime,
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('future');
    });
  });

  describe('5. Instant Publishing of Scheduled Releases', () => {
    it('instantly publishes scheduled video to watch catalog', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/publish-now`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creatorToken}`,
        },
        body: JSON.stringify({ jobId: scheduledJobId }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.job.published).toBe(true);
      expect(data.job.publishedAt).toBeDefined();
      expect(data.video).toBeDefined();
      expect(data.video.title).toContain('Autonomous AI Swarms');
    });

    it('verifies published video is removed from pending scheduled queue', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/schedule/queue?creatorDid=${encodeURIComponent(creatorDid)}`, {
        headers: { Authorization: `Bearer ${creatorToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      const found = data.queue.find((j: any) => j.jobId === scheduledJobId);
      expect(found).toBeUndefined();
    });

    it('returns error when attempting to re-publish already published job', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/publish-now`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creatorToken}`,
        },
        body: JSON.stringify({ jobId: scheduledJobId }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('already published');
    });
  });

  describe('6. Updated Studio Dashboard Metrics Verification', () => {
    it('reflects both completed jobs in creator dashboard metrics', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/dashboard?creatorDid=${encodeURIComponent(creatorDid)}`, {
        headers: { Authorization: `Bearer ${creatorToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.dashboard.totalJobs).toBeGreaterThanOrEqual(2);
      expect(data.dashboard.publishedVideos).toBeGreaterThanOrEqual(2);
      expect(data.dashboard.scheduledVideos).toBe(0);
      expect(data.dashboard.recentJobs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('7. Client Markup & Script Engine Validation', () => {
    it('serves client HTML containing Creator Studio Pro modal and controller script', async () => {
      const res = await fetch(`${BASE_URL}/`);
      expect(res.status).toBe(200);
      const html = await res.text();

      // UI elements presence
      expect(html).toContain('id="sovraCreatorStudioModal"');
      expect(html).toContain('id="studioAnalyticsCard"');
      expect(html).toContain('id="studioTotalViews"');
      expect(html).toContain('id="studioTotalEarnedSov"');
      expect(html).toContain('id="studioScheduledCount"');
      expect(html).toContain('id="studioVideoDropzone"');
      expect(html).toContain('id="studioInputTitle"');
      expect(html).toContain('id="studioInputTags"');
      expect(html).toContain('id="studioUploadBtn"');
      expect(html).toContain('id="studioScheduleBtn"');
      expect(html).toContain('id="studioTranscodeMonitor"');
      expect(html).toContain('id="studioScheduledQueueContainer"');
      expect(html).toContain('id="studioScheduledQueueList"');

      // Drawer item presence
      expect(html).toContain('openCreatorStudioModal()');
      expect(html).toContain('Creator Studio Pro');

      // Engine and global script bindings
      expect(html).toContain('window.SovraCreatorStudioEngine = {');
      expect(html).toContain('window.openCreatorStudioModal');
      expect(html).toContain('window.closeCreatorStudioModal');
      expect(html).toContain('window.submitStudioUpload');
      expect(html).toContain('window.scheduleStudioReleasePrompt');
    });
  });
});
