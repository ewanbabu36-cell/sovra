/**
 * @file scripts/routes/media_player.routes.ts
 * Sovereign Media Player & External Stream Proxy Route Controller.
 *
 * Implements CORS-free streaming proxy with byte-range forwarding (RFC 7233)
 * for external audio/video URLs (MP4, MP3, M3U8, WebM, OGG, FLAC, HLS).
 */

import http from 'node:http';
import https from 'node:https';

export interface MediaPlayerContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, limit?: number) => Promise<{ body: string; ok: boolean }>;
}

export async function handleMediaPlayerRoutes(ctx: MediaPlayerContext): Promise<boolean> {
  const { req, res, url } = ctx;

  // 1. GET /api/media/proxy?url=<targetMediaUrl>
  if (url.pathname === '/api/media/proxy' && req.method === 'GET') {
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Valid http or https media URL is required' }));
      return true;
    }

    try {
      const parsedTarget = new URL(targetUrl);
      const isHttps = parsedTarget.protocol === 'https:';
      const client = isHttps ? https : http;

      const proxyHeaders: Record<string, string> = {
        'User-Agent': 'Sovra-Sovereign-Media-Player/2.4 (RFC 7233; P2P Mesh Media Engine)',
        'Accept': '*/*',
      };

      // Forward client range request for video scrubbing (HTTP 206)
      if (req.headers.range) {
        proxyHeaders['Range'] = req.headers.range;
      }

      const proxyReq = client.request(parsedTarget, {
        method: 'GET',
        headers: proxyHeaders,
        timeout: 15000,
      }, (proxyRes) => {
        const responseHeaders: Record<string, string | string[] | undefined> = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type',
          'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=3600',
        };

        if (proxyRes.headers['content-type']) {
          responseHeaders['Content-Type'] = proxyRes.headers['content-type'];
        }
        if (proxyRes.headers['content-length']) {
          responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
        }
        if (proxyRes.headers['content-range']) {
          responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
        }

        const statusCode = proxyRes.statusCode || 200;
        res.writeHead(statusCode, responseHeaders);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Media stream proxy error: ' + err.message }));
        }
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        if (!res.headersSent) {
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'External media stream gateway timeout' }));
        }
      });

      req.on('close', () => {
        proxyReq.destroy();
      });

      proxyReq.end();
    } catch (err: any) {
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid URL format: ' + err.message }));
      }
    }
    return true;
  }

  // 2. GET /api/media/sample-streams (Provides verified curated open media samples)
  if (url.pathname === '/api/media/sample-streams' && req.method === 'GET') {
    const samples = [
      {
        id: 'lofi_chill',
        title: 'Lo-Fi Study Beats (Relaxing Piano & Ambient)',
        artist: 'SoundHelix Audio Labs',
        type: 'audio',
        url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        duration: '06:12',
        coverUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300&q=80',
        genre: 'Ambient / Lo-Fi'
      },
      {
        id: 'synthwave_radio',
        title: 'Cyberpunk Synthwave Electro Journey',
        artist: 'SoundHelix Electronic Node',
        type: 'audio',
        url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
        duration: '07:05',
        coverUrl: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=300&q=80',
        genre: 'Synthwave / Retro'
      },
      {
        id: 'big_buck_bunny',
        title: 'Big Buck Bunny (4K Cinema Open Movie)',
        artist: 'Blender Open Movie Foundation',
        type: 'video',
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        duration: '09:56',
        coverUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg',
        genre: '4K Animation Video'
      },
      {
        id: 'elephants_dream',
        title: 'Elephants Dream (Open Sci-Fi Cinema)',
        artist: 'Blender Open Project',
        type: 'video',
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
        duration: '10:53',
        coverUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/ElephantsDream.jpg',
        genre: 'Sci-Fi Video'
      }
    ];

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ ok: true, samples }));
    return true;
  }

  return false;
}
