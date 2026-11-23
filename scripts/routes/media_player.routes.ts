/**
 * @file scripts/routes/media_player.routes.ts
 * Sovereign Media Player & External Stream Proxy Route Controller.
 *
 * Implements CORS-free streaming proxy with byte-range forwarding (RFC 7233)
 * for external audio/video URLs (MP4, MP3, M3U8, WebM, OGG, FLAC, HLS).
 */

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

export function isPrivateOrReservedIp(ip: string): boolean {
  if (!ip) return true;
  const cleanIp = ip.toLowerCase().replace(/^::ffff:/, '');

  if (net.isIPv4(cleanIp)) {
    const parts = cleanIp.split('.').map(Number);
    const [b0, b1] = parts;
    if (b0 === 0) return true; // 0.0.0.0/8
    if (b0 === 10) return true; // 10.0.0.0/8 (RFC 1918)
    if (b0 === 127) return true; // 127.0.0.0/8 (Loopback)
    if (b0 === 169 && b1 === 254) return true; // 169.254.0.0/16 (Link-local / Cloud Metadata 169.254.169.254)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true; // 172.16.0.0/12 (RFC 1918)
    if (b0 === 192 && b1 === 168) return true; // 192.168.0.0/16 (RFC 1918)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true; // 100.64.0.0/10 (Carrier Grade NAT)
    if (b0 >= 224) return true; // 224.0.0.0/4 (Multicast / Reserved)
    return false;
  }

  if (net.isIPv6(cleanIp)) {
    if (cleanIp === '::1' || cleanIp === '::') return true; // Loopback & Unspecified
    if (cleanIp.startsWith('fe80:') || cleanIp.startsWith('fe8') || cleanIp.startsWith('fe9') || cleanIp.startsWith('fea') || cleanIp.startsWith('feb')) return true; // Link-local
    if (cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) return true; // Unique local (fc00::/7)
    if (cleanIp.startsWith('ff')) return true; // Multicast
    return false;
  }

  return false;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  'instance-data',
]);

export function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')) return true;
  if (isPrivateOrReservedIp(lower)) return true;
  return false;
}

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
      if (parsedTarget.username || parsedTarget.password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'SSRF Protection: URL credentials are prohibited' }));
        return true;
      }

      const hostname = parsedTarget.hostname;
      if (!hostname || isBlockedHostname(hostname)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Forbidden: Access to private, loopback, or metadata network is blocked' }));
        return true;
      }

      // Port restrictions: block sensitive internal ports
      const port = parsedTarget.port ? Number(parsedTarget.port) : (parsedTarget.protocol === 'https:' ? 443 : 80);
      const BLOCKED_PORTS = new Set([21, 22, 23, 25, 53, 69, 110, 123, 137, 138, 139, 143, 389, 445, 636, 1433, 1521, 2049, 2375, 2376, 26656, 26657, 26658, 26756, 26757, 3000, 3001, 3306, 3443, 4001, 5000, 5432, 6379, 8000, 9090, 9200, 27017]);
      if (BLOCKED_PORTS.has(port)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `Forbidden: Port ${port} is restricted by SSRF security policy` }));
        return true;
      }

      // DNS Resolution Check to prevent DNS rebinding attacks
      let resolvedIps: string[] = [];
      try {
        const records = await dns.promises.lookup(hostname, { all: true });
        resolvedIps = records.map(r => r.address);
      } catch (dnsErr: any) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'DNS resolution failed for media host: ' + dnsErr.message }));
        return true;
      }

      if (resolvedIps.length === 0) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'No DNS records found for media host' }));
        return true;
      }

      for (const ip of resolvedIps) {
        if (isPrivateOrReservedIp(ip)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `Forbidden: Hostname resolves to private/internal IP address (${ip})` }));
          return true;
        }
      }

      const validatedIp = resolvedIps[0]!;
      const isHttps = parsedTarget.protocol === 'https:';
      const client = isHttps ? https : http;

      const proxyHeaders: Record<string, string> = {
        'User-Agent': 'Sovra-Sovereign-Media-Player/2.4 (RFC 7233; P2P Mesh Media Engine; SSRF-Hardened)',
        'Accept': '*/*',
        'Host': parsedTarget.host,
      };

      // Forward client range request for video scrubbing (HTTP 206)
      if (req.headers.range) {
        proxyHeaders['Range'] = req.headers.range;
      }

      const reqOptions: https.RequestOptions = {
        protocol: parsedTarget.protocol,
        hostname: parsedTarget.hostname,
        port: parsedTarget.port || (isHttps ? 443 : 80),
        path: parsedTarget.pathname + parsedTarget.search,
        method: 'GET',
        headers: proxyHeaders,
        timeout: 15000,
        lookup: (_h: any, _opt: any, cb: any) => {
          cb(null, validatedIp, net.isIPv4(validatedIp) ? 4 : 6);
        },
      };

      const proxyReq = client.request(reqOptions, (proxyRes) => {
        // Redirect SSRF Defense: Check redirect targets
        const statusCode = proxyRes.statusCode || 200;
        if ([301, 302, 303, 307, 308].includes(statusCode) && proxyRes.headers.location) {
          try {
            const redirectUrl = new URL(proxyRes.headers.location, targetUrl);
            if (isBlockedHostname(redirectUrl.hostname)) {
              res.writeHead(403, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Forbidden: Redirect target attempts access to restricted private network' }));
              proxyRes.resume();
              return;
            }
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Invalid redirect Location header' }));
            proxyRes.resume();
            return;
          }
        }

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
