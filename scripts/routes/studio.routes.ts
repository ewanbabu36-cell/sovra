/**
 * @file scripts/routes/studio.routes.ts
 * Sovereign Creator Studio & Multi-Resolution Transcoder Route Controller (Phase 10).
 *
 * Implements Creator Studio Pro dashboard analytics, multi-bitrate HLS
 * video ingestion and transcoding pipelines (1080p, 720p, 480p, 360p),
 * adaptive bitrate manifest generation (RFC 8216), and scheduled publish queues.
 */

import http from 'node:http';
import { sovraDb } from '../database-engine.ts';
import { TranscoderWorker, type VideoResolution } from '../../services/transcoder/dist/index.js';
import type { AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';

const transcoderWorker = new TranscoderWorker();

export interface StudioRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, maxBytes: number) => Promise<{ body: string; ok: boolean }>;
  resolvePrincipal: (req: http.IncomingMessage) => AuthenticatedPrincipal | null;
  enforceAuth: (req: http.IncomingMessage, res: http.ServerResponse) => AuthenticatedPrincipal | null;
}

function resolveCreatorDid(ctx: StudioRouteContext): string {
  const principal = ctx.resolvePrincipal(ctx.req);
  if (principal && principal.did) {
    return principal.did;
  }
  const qDid = ctx.url.searchParams.get('creatorDid') || ctx.url.searchParams.get('did');
  if (qDid && qDid.trim().length > 0) {
    return qDid.trim();
  }
  return 'did:sovra:creator_primary';
}

export async function handleStudioTranscoderRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, url, readBoundedBody } = ctx;

  // 1. GET /api/studio/dashboard - Creator Studio Analytics & Summary
  if (url.pathname === '/api/studio/dashboard' && req.method === 'GET') {
    const creatorDid = resolveCreatorDid(ctx);
    const dashboard = sovraDb.getCreatorStudioDashboard(creatorDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, creatorDid, dashboard }));
    return true;
  }

  // 2. POST /api/studio/upload - Ingest video for multi-bitrate HLS transcoding
  if (url.pathname === '/api/studio/upload' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 10 * 1024 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const creatorDid = parsed.creatorDid || resolveCreatorDid(ctx);
      const title = parsed.title || 'Creator Studio Upload';
      const description = parsed.description || '';
      const tags = parsed.tags || '#creator #sovra';
      const sourceCid = parsed.sourceCid || `bafybeicreator_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const targetResolutions: VideoResolution[] = Array.isArray(parsed.targetResolutions) && parsed.targetResolutions.length > 0
        ? parsed.targetResolutions
        : ['1080p', '720p', '480p', '360p'];

      const scheduledPublishAt = typeof parsed.scheduledPublishAt === 'number' ? parsed.scheduledPublishAt : undefined;

      // Create tracking job in database
      const job = sovraDb.createStudioJob({
        creatorDid,
        title,
        description,
        tags,
        sourceCid,
        targetResolutions,
        scheduledPublishAt,
        thumbnailUrl: parsed.thumbnailUrl,
        category: parsed.category,
        chapters: parsed.chapters,
        monetization: parsed.monetization,
      });

      // Update to transcoding
      sovraDb.updateStudioJob(job.jobId, { status: 'transcoding', progress: 30 });

      // Execute real background multi-resolution HLS transcode via TranscoderWorker
      const transcodeRes = await transcoderWorker.transcode({
        jobId: job.jobId,
        sourceCid,
        targetResolutions,
        segmentDurationSeconds: 2,
      });

      if (transcodeRes.ok && transcodeRes.value) {
        const masterM3u8 = transcodeRes.value.masterM3u8 || transcoderWorker.generateMasterPlaylist(job.jobId, targetResolutions);
        const masterPlaylistUrl = `/api/feed/video/${job.jobId}/hls/master.m3u8`;

        const updated = sovraDb.updateStudioJob(job.jobId, {
          status: 'completed',
          progress: 100,
          masterManifestCid: transcodeRes.value.masterManifestCid,
          masterPlaylistUrl,
          resolutionCids: transcodeRes.value.resolutionCids as any,
          completedAt: Date.now(),
        });

        // Auto-publish if requested or not scheduled for future
        if (parsed.publishImmediately || (!scheduledPublishAt && parsed.autoPublish !== false)) {
          sovraDb.publishStudioJob(job.jobId);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          job: updated,
          masterManifestCid: transcodeRes.value.masterManifestCid,
          masterPlaylistUrl,
          resolutionVariants: Object.keys(transcodeRes.value.resolutionCids),
        }));
      } else {
        sovraDb.updateStudioJob(job.jobId, { status: 'failed', progress: 0 });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Transcoder worker pipeline failed' }));
      }
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid studio upload payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // 3. GET /api/studio/transcode/status - Poll status of background transcode job
  if (url.pathname === '/api/studio/transcode/status' && req.method === 'GET') {
    const jobId = url.searchParams.get('jobId');
    if (!jobId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Missing jobId query parameter' }));
      return true;
    }

    const job = sovraDb.getStudioJob(jobId);
    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Studio transcode job not found' }));
      return true;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, job }));
    return true;
  }

  // 4. POST /api/studio/schedule - Schedule release date & time
  if (url.pathname === '/api/studio/schedule' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const jobId = parsed.jobId;
      const scheduledPublishAt = Number(parsed.scheduledPublishAt);

      if (!jobId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing jobId' }));
        return true;
      }

      if (isNaN(scheduledPublishAt) || scheduledPublishAt <= Date.now()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'scheduledPublishAt must be a timestamp in the future' }));
        return true;
      }

      const job = sovraDb.getStudioJob(jobId);
      if (!job) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Job not found' }));
        return true;
      }

      const updated = sovraDb.updateStudioJob(jobId, {
        scheduledPublishAt,
        published: false,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, job: updated }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid request: ' + (err?.message || err) }));
    }
    return true;
  }

  // 5. GET /api/studio/schedule/queue - Get creator's pending scheduled releases
  if (url.pathname === '/api/studio/schedule/queue' && req.method === 'GET') {
    const creatorDid = resolveCreatorDid(ctx);
    const queue = sovraDb.getScheduledStudioQueue(creatorDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, creatorDid, count: queue.length, queue }));
    return true;
  }

  // 6. POST /api/studio/publish-now - Instantly publish a transcoded video
  if (url.pathname === '/api/studio/publish-now' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const jobId = parsed.jobId;
      if (!jobId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing jobId' }));
        return true;
      }

      const pubRes = sovraDb.publishStudioJob(jobId);
      if (!pubRes.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: pubRes.error }));
        return true;
      }

      const job = sovraDb.getStudioJob(jobId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, job, video: pubRes.video }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid request: ' + (err?.message || err) }));
    }
    return true;
  }

  // 7. GET /api/studio/analytics - Detailed 7-day trajectories & retention curve
  if (url.pathname === '/api/studio/analytics' && req.method === 'GET') {
    const creatorDid = resolveCreatorDid(ctx);
    const analytics = sovraDb.getCreatorStudioAnalytics(creatorDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, creatorDid, analytics }));
    return true;
  }

  // 8. GET /api/studio/content - All creator library content (videos, reels, scheduled)
  if (url.pathname === '/api/studio/content' && req.method === 'GET') {
    const creatorDid = resolveCreatorDid(ctx);
    const content = sovraDb.getCreatorStudioContent(creatorDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, creatorDid, count: content.count, items: content.items }));
    return true;
  }

  // 9. POST /api/studio/content/update - Inline edit metadata, thumbnail, monetization, chapters
  if (url.pathname === '/api/studio/content/update' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const creatorDid = resolveCreatorDid(ctx);
      const contentId = parsed.contentId || parsed.id;
      if (!contentId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing contentId' }));
        return true;
      }

      const updateRes = sovraDb.updateCreatorStudioContent(creatorDid, contentId, parsed.updates || parsed);
      if (!updateRes.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: updateRes.error }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, item: updateRes.item }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid update payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // 10. POST /api/studio/content/delete - Delete studio content / video
  if (url.pathname === '/api/studio/content/delete' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const creatorDid = resolveCreatorDid(ctx);
      const contentId = parsed.contentId || parsed.id;
      if (!contentId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing contentId' }));
        return true;
      }

      const delRes = sovraDb.deleteCreatorStudioContent(creatorDid, contentId);
      if (!delRes.ok) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: delRes.error }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Content deleted successfully' }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid delete payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // 11. GET /api/studio/video/details - Full video metadata for Post-Production Editor Modal
  if (url.pathname === '/api/studio/video/details' && req.method === 'GET') {
    const videoId = url.searchParams.get('id') || url.searchParams.get('videoId');
    const creatorDid = resolveCreatorDid(ctx);
    let video: any = null;
    if (videoId) {
      video = sovraDb.getVideoById(videoId);
      if (!video) {
        const job = sovraDb.getStudioJob(videoId);
        if (job) {
          video = {
            id: job.jobId,
            title: job.title,
            description: job.description,
            thumbnailUrl: job.thumbnailUrl,
            category: job.category || 'Tech',
            tags: job.tags ? job.tags.split(',').map(t => t.trim()) : [],
            chapters: job.chapters || [],
            monetization: job.monetization || { tier: 'free' },
            audience: 'all',
            hlsMasterUrl: job.masterPlaylistUrl,
            cid: job.masterManifestCid || job.sourceCid,
          };
        }
      }
    }
    if (!video) {
      const content = sovraDb.getCreatorStudioContent(creatorDid);
      video = content.items[0] || null;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, video }));
    return true;
  }

  // 12. POST /api/studio/video/update - Update video post-production details & metadata
  if (url.pathname === '/api/studio/video/update' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const creatorDid = resolveCreatorDid(ctx);
      const videoId = parsed.id || parsed.videoId;
      if (!videoId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing videoId' }));
        return true;
      }
      const updateRes = sovraDb.updateCreatorStudioContent(creatorDid, videoId, parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, video: updateRes.item }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Update failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // 13. GET /api/studio/comments - Community Comments & Moderation Studio
  if (url.pathname === '/api/studio/comments' && req.method === 'GET') {
    const creatorDid = resolveCreatorDid(ctx);
    const filter = url.searchParams.get('filter') || undefined;
    const comments = sovraDb.getCreatorStudioComments(creatorDid, filter);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, count: comments.length, comments }));
    return true;
  }

  // 14. POST /api/studio/comments/reply - Creator inline reply directly from studio
  if (url.pathname === '/api/studio/comments/reply' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const videoId = parsed.videoId || 'yt-video-1';
      const commentId = parsed.commentId || parsed.parentCommentId;
      const text = String(parsed.text || '').trim();
      const creatorDid = resolveCreatorDid(ctx);
      const user = sovraDb.findUserByDid(creatorDid);

      if (!commentId || !text) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing commentId or text' }));
        return true;
      }

      const reply = sovraDb.addVideoReply(videoId, commentId, {
        authorDid: creatorDid,
        authorName: user?.displayName || user?.name || 'Creator',
        authorHandle: user?.handle ? user.handle.replace('@', '') : 'creator',
        authorAvatar: user?.avatar || '🎬',
        isCreator: true,
        text,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, reply }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Reply failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // 15. GET /api/studio/subtitles - Dedicated Subtitles & Closed Captions Track Studio
  if (url.pathname === '/api/studio/subtitles' && req.method === 'GET') {
    const videoId = url.searchParams.get('videoId') || 'yt-video-1';
    const video = sovraDb.getVideoById(videoId);
    const defaultCues = [
      { start: 0, end: 5, text: "Welcome to the Sovra Protocol technical architecture session." },
      { start: 5, end: 14, text: "In this deep dive, we explore BitSwap DAG streaming and 4K playback." },
      { start: 14, end: 28, text: "Notice how zero centralized CDN servers are required for high throughput." },
      { start: 28, end: 45, text: "RFC 8216 HLS Master and Variant playlists enable seamless bitrate switching." },
      { start: 45, end: 70, text: "Speculative Segment 0 pre-warming guarantees sub-300ms time to first frame." },
      { start: 70, end: 120, text: "Cellular CGNAT is bypassed effortlessly via Birthday Paradox port prediction." },
      { start: 120, end: 200, text: "95% of micropayment revenue flows directly to creators with 0% platform take." }
    ];
    const tracks = (video && (video as any).subtitleTracks) || [
      { language: 'English (Original)', langCode: 'en', isDefault: true, cues: (video && (video as any).subtitles) || defaultCues },
      { language: 'Spanish (Community)', langCode: 'es', isDefault: false, cues: [
        { start: 0, end: 5, text: "Bienvenidos a la sesión técnica del Protocolo Sovra." },
        { start: 5, end: 14, text: "En esta sesión exploramos la transmisión DAG de BitSwap y reproducción 4K." }
      ]}
    ];
    const requestedLang = url.searchParams.get('language') || url.searchParams.get('lang') || 'en';
    const activeTrack = tracks.find((t: any) => t.langCode === requestedLang || (t.language && t.language.toLowerCase().includes(requestedLang.toLowerCase()))) || tracks[0];
    const cues = activeTrack ? activeTrack.cues : defaultCues;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, videoId, tracks, cues }));
    return true;
  }

  // 16. POST /api/studio/subtitles/save - Save subtitle cues and tracks
  if (url.pathname === '/api/studio/subtitles/save' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const videoId = parsed.videoId || 'yt-video-1';
      const creatorDid = resolveCreatorDid(ctx);
      const tracks = parsed.tracks || (parsed.cues ? [{ language: parsed.language || 'English', langCode: parsed.language || 'en', isDefault: true, cues: parsed.cues }] : []);
      sovraDb.updateCreatorStudioContent(creatorDid, videoId, { subtitleTracks: tracks });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, videoId, tracks, cues: parsed.cues || (tracks[0] ? tracks[0].cues : []) }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Save subtitles failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // 17. GET /api/studio/customization - Channel Customization & Branding Studio
  if (url.pathname === '/api/studio/customization' && req.method === 'GET') {
    const creatorDid = resolveCreatorDid(ctx);
    const customization = sovraDb.getCreatorChannelCustomization(creatorDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, creatorDid, customization }));
    return true;
  }

  // 18. POST /api/studio/customization/save - Save Channel Customization & Branding
  if (url.pathname === '/api/studio/customization/save' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const creatorDid = resolveCreatorDid(ctx);
      const resData = sovraDb.saveCreatorChannelCustomization(creatorDid, parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, customization: resData.customization }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Customization save failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // 19. GET /api/studio/audio-library - Sovereign Royalty-Free Audio & SFX Library
  if (url.pathname === '/api/studio/audio-library' && req.method === 'GET') {
    const tracks = sovraDb.getCreatorAudioLibrary();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, count: tracks.length, tracks }));
    return true;
  }

  return false;
}

export const handleStudioRoutes = handleStudioTranscoderRoutes;
