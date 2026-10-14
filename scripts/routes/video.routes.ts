/**
 * @file scripts/routes/video.routes.ts
 * Sovereign Video, Reels, Watch, Playlists & Storage Pruning Route Controller.
 *
 * Implements high-throughput ABR streaming, creator uploads, tipping,
 * playlist aggregation, and automated device cache quota eviction.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sovraDb, type ReelRecord, type YoutubeVideoRecord } from '../database-engine.ts';
import type { AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';

export interface VideoRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  REELS_DIR: string;
  storageDaemon?: any;
  validateMediaMagicBytes: (buffer: Buffer, declaredMime?: string) => { valid: boolean; detectedMime?: string; error?: string };
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, limit?: number) => Promise<{ body: string; ok: boolean }>;
  resolvePrincipal: (req: http.IncomingMessage, parsedBody?: Record<string, any>) => AuthenticatedPrincipal | null;
  enforceAuth: (req: http.IncomingMessage, res: http.ServerResponse, parsedBody?: Record<string, any>) => AuthenticatedPrincipal | null;
}

export async function handleVideoRoutes(ctx: VideoRouteContext): Promise<boolean> {
  const {
    req,
    res,
    url,
    REELS_DIR,
    storageDaemon,
    validateMediaMagicBytes,
    readBoundedBody,
    resolvePrincipal,
    enforceAuth,
  } = ctx;

  // ==========================================
  // 1. INSTAGRAM REELS API
  // ==========================================

  // List Reels
  if (url.pathname === '/api/reels/list' && req.method === 'GET') {
    const allReels = sovraDb.getAllReels();
    const reels = allReels.map(r => ({
      ...r,
      title: r.caption || 'Reel',
      likes: r.likesCount,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, reels }));
    return true;
  }

  // Create Reel with ABR Metadata
  if (url.pathname === '/api/reels/create' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 25 * 1024 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      let cid = '';
      let videoUrl: string | undefined;
      let videoPath: string | undefined;
      let mimeType = parsed.mimeType || 'video/mp4';

      const rawVideo = parsed.videoData || parsed.mediaBase64 || parsed.content;
      if (rawVideo) {
        let base64Data = String(rawVideo);
        const commaIdx = base64Data.indexOf(',');
        if (commaIdx !== -1) {
          const header = base64Data.substring(0, commaIdx);
          const match = header.match(/data:([^;]+);base64/);
          if (match) mimeType = match[1];
          base64Data = base64Data.substring(commaIdx + 1);
        }
        const buffer = Buffer.from(base64Data, 'base64');
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        cid = 'bafy' + hash.substring(0, 32);

        if (!fs.existsSync(REELS_DIR)) {
          fs.mkdirSync(REELS_DIR, { recursive: true });
        }

        const ext = mimeType.includes('webm') ? 'webm' : (mimeType.includes('quicktime') || mimeType.includes('mov') ? 'mov' : 'mp4');
        const fileName = `${cid}.${ext}`;
        const filePath = path.join(REELS_DIR, fileName);
        fs.writeFileSync(filePath, buffer);

        videoPath = filePath;
        videoUrl = `/api/reels/video/${cid}`;

        try {
          if (storageDaemon) await storageDaemon.putBlock(cid, buffer);
        } catch {}
      } else {
        cid = 'bafy' + crypto.randomBytes(16).toString('hex');
      }

      let tags = parsed.tags;
      if (typeof tags === 'string') {
        tags = tags.split(',').map((t: string) => t.trim()).filter(Boolean);
      }
      if (!Array.isArray(tags)) {
        tags = ['#sovra', '#p2p'];
      }

      const entityType = parsed.entityType === 'channel' || parsed.entityType === 'page' ? parsed.entityType : 'personal';
      const entityId = parsed.entityId ? String(parsed.entityId) : undefined;

      const user = sovraDb.findUserByDid(principal.did);
      const newReel = sovraDb.createReel({
        creatorDid: principal.did,
        creatorHandle: user?.handle || principal.handle || 'you_peer',
        creatorName: user?.displayName || principal.displayName || 'You',
        creatorAvatar: user?.avatar,
        caption: parsed.caption || parsed.title || 'Untitled Sovereign Reel',
        shortHeader: parsed.shortHeader || undefined,
        summary: parsed.summary || undefined,
        description: parsed.description || undefined,
        relatedVideoId: parsed.relatedVideoId || undefined,
        entityType,
        entityId,
        tags,
        audioTrack: parsed.audioTrack || 'Original Audio',
        bgGradient: parsed.bgGradient || 'linear-gradient(180deg, #1e1b4b 0%, #312e81 40%, #0f172a 100%)',
        cid,
        videoUrl,
        videoPath,
        videoMimeType: mimeType,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, reel: newReel }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // Stream Reel Video Chunks (HTTP 206 Partial Content)
  if (url.pathname.startsWith('/api/reels/video/') && req.method === 'GET') {
    const cid = path.basename(url.pathname);
    if (!cid || cid.includes('..') || cid.includes('/') || cid.includes('\\')) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid CID');
      return true;
    }

    let foundFilePath: string | null = null;
    let foundMimeType = 'video/mp4';

    if (fs.existsSync(REELS_DIR)) {
      const files = fs.readdirSync(REELS_DIR);
      const match = files.find(f => f.startsWith(cid));
      if (match) {
        foundFilePath = path.join(REELS_DIR, match);
        if (match.endsWith('.webm')) foundMimeType = 'video/webm';
        else if (match.endsWith('.mov')) foundMimeType = 'video/quicktime';
      }
    }

    if (!foundFilePath) {
      try {
        if (storageDaemon) {
          const blk = await storageDaemon.getBlock(cid);
          if (blk) {
            res.writeHead(200, {
              'Content-Type': 'video/mp4',
              'Content-Length': blk.length,
              'Accept-Ranges': 'bytes',
            });
            res.end(blk);
            return true;
          }
        }
      } catch {}
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Video not found');
      return true;
    }

    const stat = fs.statSync(foundFilePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (start >= fileSize) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
        res.end();
        return true;
      }
      const chunksize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': foundMimeType,
        'Cache-Control': 'public, max-age=3600',
      });
      fs.createReadStream(foundFilePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': foundMimeType,
        'Cache-Control': 'public, max-age=3600',
      });
      fs.createReadStream(foundFilePath).pipe(res);
    }
    return true;
  }

  // Like Reel
  if (url.pathname === '/api/reels/like' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const userDid = principal.did;
      const result = sovraDb.toggleReelLike(parsed.reelId, userDid);
      if (result) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, likes: result.likesCount, likesCount: result.likesCount, isLiked: result.isLiked }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Reel not found' }));
      }
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  // Get Reel Comments
  if (url.pathname === '/api/reels/comments' && req.method === 'GET') {
    const reelId = url.searchParams.get('reelId') || '';
    const comments = sovraDb.getReelComments(reelId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, comments }));
    return true;
  }

  // Add Reel Comment
  if (url.pathname === '/api/reels/comment' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      if (!parsed.reelId || !parsed.text) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'reelId and text required' }));
        return true;
      }
      const comment = sovraDb.addReelComment(parsed.reelId, {
        authorDid: principal.did,
        authorHandle: String(parsed.authorHandle || 'you_peer'),
        authorName: String(parsed.authorName || 'Verified Peer'),
        authorAvatar: parsed.authorAvatar ? String(parsed.authorAvatar) : undefined,
        text: String(parsed.text),
      });
      if (comment) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, comment }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Reel not found' }));
      }
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  // ==========================================
  // 2. YOUTUBE WATCH PLAYER & TIPPING API
  // ==========================================

  // List Long-Form Videos
  if ((url.pathname === '/api/youtube/videos' || url.pathname === '/api/watch/videos') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, videos: sovraDb.getAllVideos() }));
    return true;
  }

  // Get Video Detail with Comments & Recommendations
  if ((url.pathname === '/api/youtube/video' || url.pathname === '/api/watch/video') && req.method === 'GET') {
    const allVideos = sovraDb.getAllVideos();
    const vidId = url.searchParams.get('id') || allVideos[0]?.id;
    const found = allVideos.find(v => v.id === vidId) || allVideos[0];
    const comments = found ? sovraDb.getVideoComments(found.id) : [];
    const recommended = allVideos.filter(v => found && v.id !== found.id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        video: found,
        comments,
        recommended,
      }),
    );
    return true;
  }

  // Switch Current Video
  if (url.pathname === '/api/youtube/switch' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const found = sovraDb.getVideoById(parsed.videoId);
      if (found) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, video: found }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Video not found' }));
      }
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  // Upload Watch Video
  if ((url.pathname === '/api/youtube/upload' || url.pathname === '/api/watch/upload') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 50 * 1024 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const title = String(parsed.title || '').trim();
      if (!title) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Video title is required' }));
        return true;
      }

      let cid = '';
      let mimeType = parsed.mimeType || 'video/mp4';
      const rawMedia = parsed.videoData || parsed.mediaBase64 || parsed.content;
      if (rawMedia && typeof rawMedia === 'string') {
        let base64Data = rawMedia;
        const commaIdx = base64Data.indexOf(',');
        if (commaIdx !== -1) {
          const header = base64Data.substring(0, commaIdx);
          const match = header.match(/data:([^;]+);base64/);
          if (match) mimeType = match[1];
          base64Data = base64Data.substring(commaIdx + 1);
        }
        const fileBuffer = Buffer.from(base64Data, 'base64');
        const check = validateMediaMagicBytes(fileBuffer, mimeType);
        if (!check.valid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `Invalid video format: ${check.error}` }));
          return true;
        }

        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        cid = 'bafy' + hash.substring(0, 32);

        if (!fs.existsSync(REELS_DIR)) {
          fs.mkdirSync(REELS_DIR, { recursive: true });
        }
        const ext = mimeType.includes('webm') ? 'webm' : 'mp4';
        const filePath = path.join(REELS_DIR, `${cid}.${ext}`);
        fs.writeFileSync(filePath, fileBuffer);

        try {
          if (storageDaemon) await storageDaemon.putBlock(cid, fileBuffer);
        } catch {}
      } else {
        cid = 'bafy' + crypto.randomBytes(16).toString('hex');
      }

      const entityType = parsed.entityType === 'channel' || parsed.entityType === 'page' ? parsed.entityType : 'personal';
      const entityId = parsed.entityId ? String(parsed.entityId) : undefined;

      const user = sovraDb.findUserByDid(principal.did);
      const video = sovraDb.createVideo({
        creatorDid: principal.did,
        channelName: user?.displayName || principal.displayName || 'You',
        channelHandle: user?.handle || principal.handle || 'you_peer',
        channelAvatar: user?.avatar || '🎬',
        title,
        description: String(parsed.description || ''),
        duration: String(parsed.duration || '5:00'),
        durationSeconds: Number(parsed.durationSeconds || 300),
        entityType,
        entityId,
        tags: Array.isArray(parsed.tags) ? parsed.tags : ['#sovra'],
        cid,
        videoMimeType: mimeType,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, video }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // Like Video
  if ((url.pathname === '/api/youtube/like' || url.pathname === '/api/watch/like') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const videoId = parsed.videoId;
      if (!videoId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing videoId' }));
        return true;
      }

      const result = sovraDb.toggleVideoLike(videoId, principal.did);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, likes: result.likesCount, isLiked: result.isLiked }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  // Delete Video
  if ((url.pathname === '/api/youtube/delete' || url.pathname === '/api/watch/delete') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const deleted = sovraDb.deleteVideo(parsed.videoId, principal.did);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: deleted }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  // Universal Creator SOV Tipping (Watch Videos, Reels, Feed Posts & Profiles)
  if (
    (url.pathname === '/api/youtube/tip' ||
      url.pathname === '/api/watch/tip' ||
      url.pathname === '/api/reels/tip' ||
      url.pathname === '/api/feed/tip' ||
      url.pathname === '/api/creator/tip') &&
    req.method === 'POST'
  ) {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const amount = Number(parsed.amountSov || parsed.amount || 5.0);
      const targetType: 'video' | 'reel' | 'post' | 'profile' =
        parsed.targetType ||
        (url.pathname === '/api/reels/tip' || parsed.reelId
          ? 'reel'
          : url.pathname === '/api/feed/tip' || parsed.postId
            ? 'post'
            : parsed.videoId
              ? 'video'
              : 'profile');
      const targetId = String(
        parsed.targetId || parsed.reelId || parsed.postId || parsed.videoId || 'yt-video-1'
      );

      const tipResult = sovraDb.processTip({
        fromDid: principal.did,
        toDid: parsed.creatorDid || parsed.recipientDid || parsed.toDid,
        amount,
        targetType,
        targetId,
        videoId: parsed.videoId,
        reelId: parsed.reelId,
        postId: parsed.postId,
        senderName: parsed.authorName || principal.displayName,
        message: parsed.message || parsed.comment,
        signatureHex: parsed.signatureHex || parsed.signature,
        rootHash: parsed.rootHash || (parsed.voucher && parsed.voucher.rootHash),
      });

      if (!tipResult.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: tipResult.error || 'Failed to process SOV micro-tip' }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          voucher: tipResult.voucher,
          newBalance: tipResult.senderBalance,
          recipientBalance: tipResult.recipientBalance,
          settlement: {
            total: tipResult.split.total,
            creator: tipResult.split.creator,
            seeder: tipResult.split.seeder,
            platformTake: 0,
            split95_5: {
              creatorShare: tipResult.split.creator,
              seederShare: tipResult.split.seeder,
            },
          },
        }),
      );
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // Get Creator SOV Tipping Ledger & Earnings Breakdown
  if (url.pathname === '/api/creator/tips/ledger' && req.method === 'GET') {
    const creatorDid = url.searchParams.get('did') || url.searchParams.get('creatorDid') || undefined;
    const ledger = sovraDb.getCreatorTipsLedger(creatorDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...ledger }));
    return true;
  }

  // Subscribe to Channel
  if ((url.pathname === '/api/youtube/subscribe' || url.pathname === '/api/watch/subscribe') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const handle = String(parsed.channelHandle || parsed.channelId || parsed.channel || '');
      const result = sovraDb.toggleChannelSubscription(handle, principal.did);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        isSubscribed: result.isSubscribed,
        subscribed: result.isSubscribed,
        subscribersCount: result.subscribersCount,
      }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  // Comment on Video
  if (url.pathname === '/api/youtube/comment' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const user = sovraDb.findUserByDid(principal.did);
      const comment = sovraDb.addVideoComment(parsed.videoId, {
        authorDid: principal.did,
        authorName: user?.displayName || principal.displayName || 'Verified Peer',
        authorAvatar: user?.avatar || '🎬',
        authorHandle: user?.handle || principal.handle || 'peer',
        text: String(parsed.text || ''),
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, comment }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  // Like Video Comment
  if (url.pathname === '/api/youtube/comment/like' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const newLikes = sovraDb.likeVideoComment(parsed.videoId, parsed.commentId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, likes: newLikes }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  // ==========================================
  // 3. PLAYLISTS API
  // ==========================================

  if (url.pathname === '/api/playlists' && req.method === 'GET') {
    const channelId = url.searchParams.get('channelId') || undefined;
    const principal = resolvePrincipal(req);
    const userDid = principal?.did;
    const playlists = sovraDb.getAllPlaylists(channelId, userDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, playlists }));
    return true;
  }

  if (url.pathname === '/api/playlists/view' && req.method === 'GET') {
    const id = url.searchParams.get('id');
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Playlist ID is required' }));
      return true;
    }
    const playlist = sovraDb.getPlaylistById(id);
    if (!playlist) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Playlist not found' }));
      return true;
    }
    const allVideos = sovraDb.getAllVideos();
    const videos = (playlist.videoIds || []).map(vid => {
      return allVideos.find(v => v.id === vid) || {
        id: vid,
        title: `Video ${vid}`,
        channelName: playlist.creatorName || 'Creator',
        channelHandle: playlist.creatorHandle || 'creator',
        channelAvatar: '🎬',
        viewsText: '1.2K views',
        duration: '10:00',
        durationSeconds: 600,
        publishedAt: 'Recently',
        description: '',
        tags: ['#sovra'],
        likes: 50,
      };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, playlist, videos }));
    return true;
  }

  if (url.pathname === '/api/playlists/create' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const title = String(parsed.title || '').trim();
      if (!title) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Playlist title is required' }));
        return true;
      }
      const user = sovraDb.findUserByDid(principal.did);
      const playlist = sovraDb.createPlaylist({
        channelId: parsed.channelId,
        creatorDid: principal.did,
        creatorHandle: user?.handle || 'creator',
        creatorName: user?.displayName || 'Creator',
        title,
        description: parsed.description,
        thumbnailUrl: parsed.thumbnailUrl,
        videoIds: Array.isArray(parsed.videoIds) ? parsed.videoIds : [],
        privacy: parsed.privacy || 'public',
      });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, playlist }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/playlists/update' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const id = String(parsed.id || '');
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Playlist ID required' }));
        return true;
      }
      const result = sovraDb.updatePlaylist(id, principal.did, parsed);
      if (result.ok) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, playlist: result.playlist }));
      } else {
        const code = result.error?.startsWith('Unauthorized') ? 403 : 404;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: result.error }));
      }
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/playlists/reorder' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const id = String(parsed.id || '');
      const videoIds = parsed.videoIds;
      if (!id || !Array.isArray(videoIds)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Playlist ID and videoIds array are required' }));
        return true;
      }
      const result = sovraDb.reorderPlaylist(id, principal.did, videoIds);
      if (result.ok) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, playlist: result.playlist }));
      } else {
        const code = result.error?.startsWith('Unauthorized') ? 403 : 404;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: result.error }));
      }
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/playlists/delete' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const id = String(parsed.id || '');
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Playlist ID required' }));
        return true;
      }
      const result = sovraDb.deletePlaylist(id, principal.did);
      if (result.ok) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        const code = result.error?.startsWith('Unauthorized') ? 403 : 404;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: result.error }));
      }
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/playlists/add-video' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const id = String(parsed.id || '');
      const videoId = String(parsed.videoId || '');
      if (!id || !videoId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'id and videoId are required' }));
        return true;
      }
      const result = sovraDb.addVideoToPlaylist(id, videoId, principal.did);
      if (result.ok) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, playlist: result.playlist }));
      } else {
        const code = result.error?.startsWith('Unauthorized') ? 403 : 404;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: result.error }));
      }
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/playlists/remove-video' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const id = String(parsed.id || '');
      const videoId = String(parsed.videoId || '');
      if (!id || !videoId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'id and videoId are required' }));
        return true;
      }
      const result = sovraDb.removeVideoFromPlaylist(id, videoId, principal.did);
      if (result.ok) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, playlist: result.playlist }));
      } else {
        const code = result.error?.startsWith('Unauthorized') ? 403 : 404;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: result.error }));
      }
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // ==========================================
  // 4. STORAGE PRUNING & QUOTA API
  // (Solves Bottleneck #3: Device Bloat)
  // ==========================================

  if (url.pathname === '/api/video/prune-cache' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = body ? JSON.parse(body) : {};
      const maxBytes = Number(parsed.maxBytes || 500 * 1024 * 1024);
      const pruneResult = sovraDb.pruneVideoCache(maxBytes);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...pruneResult }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/video/storage-quota' && req.method === 'GET') {
    try {
      let totalBytes = 0;
      let count = 0;
      if (fs.existsSync(REELS_DIR)) {
        const files = fs.readdirSync(REELS_DIR);
        count = files.length;
        for (const f of files) {
          try {
            totalBytes += fs.statSync(path.join(REELS_DIR, f)).size;
          } catch {}
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, totalBytes, fileCount: count, quotaBytes: 500 * 1024 * 1024 }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message }));
    }
    return true;
  }

  return false;
}
