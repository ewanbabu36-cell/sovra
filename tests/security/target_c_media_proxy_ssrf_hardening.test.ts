import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { handleMediaPlayerRoutes, isPrivateOrReservedIp, isBlockedHostname } from '../../scripts/routes/media_player.routes.ts';

function createMockReqRes(method: string, url: string) {
  const req = new http.IncomingMessage(null as any);
  req.method = method;
  req.url = url;
  req.headers = {};

  const res = new http.ServerResponse(req);
  let statusCode = 200;
  let resHeaders: Record<string, string> = {};
  let body = '';

  res.writeHead = (status: number, h?: any) => {
    statusCode = status;
    if (h) resHeaders = { ...resHeaders, ...h };
    return res;
  };

  res.end = (chunk?: any) => {
    if (chunk) body += chunk;
    return res;
  };

  return {
    req,
    res,
    getResponse: () => ({
      statusCode,
      headers: resHeaders,
      body,
      json: () => JSON.parse(body || '{}'),
    }),
  };
}

describe('Target C: Media Proxy SSRF Hardening & Private Network Isolation', () => {
  it('C1: Identifies private, loopback, link-local and cloud metadata IPs correctly', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('127.1.2.3')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true); // AWS / GCP metadata
    expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.0.5')).toBe(true);
    expect(isPrivateOrReservedIp('172.31.255.255')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.100')).toBe(true);
    expect(isPrivateOrReservedIp('0.0.0.0')).toBe(true);
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true);

    // Public Internet IPs
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);
    expect(isPrivateOrReservedIp('142.250.190.46')).toBe(false);
  });

  it('C2: Strictly blocks loopback access via localhost and 127.0.0.1 (403)', async () => {
    const loopbackUrls = [
      'http://127.0.0.1:3001/api/status',
      'http://localhost:3001/admin',
      'http://localhost/sample.mp4',
    ];

    for (const targetUrl of loopbackUrls) {
      const mock = createMockReqRes('GET', `/api/media/proxy?url=${encodeURIComponent(targetUrl)}`);
      const ctx = {
        req: mock.req,
        res: mock.res,
        url: new URL(`http://localhost:3001/api/media/proxy?url=${encodeURIComponent(targetUrl)}`),
        readBoundedBody: async () => ({ body: '', ok: true }),
      };

      await handleMediaPlayerRoutes(ctx);
      const resp = mock.getResponse();
      expect(resp.statusCode).toBe(403);
      expect(resp.json().error).toMatch(/Forbidden/i);
    }
  });

  it('C3: Strictly blocks cloud metadata access (169.254.169.254 / metadata.google.internal) (403)', async () => {
    const metadataUrls = [
      'http://169.254.169.254/latest/meta-data/',
      'http://169.254.169.254/computeMetadata/v1/',
      'http://metadata.google.internal/computeMetadata/v1/',
    ];

    for (const targetUrl of metadataUrls) {
      const mock = createMockReqRes('GET', `/api/media/proxy?url=${encodeURIComponent(targetUrl)}`);
      const ctx = {
        req: mock.req,
        res: mock.res,
        url: new URL(`http://localhost:3001/api/media/proxy?url=${encodeURIComponent(targetUrl)}`),
        readBoundedBody: async () => ({ body: '', ok: true }),
      };

      await handleMediaPlayerRoutes(ctx);
      const resp = mock.getResponse();
      expect(resp.statusCode).toBe(403);
      expect(resp.json().error).toMatch(/Forbidden/i);
    }
  });

  it('C4: Strictly blocks private RFC 1918 subnets (10.x, 172.16-31.x, 192.168.x) (403)', async () => {
    const privateUrls = [
      'http://10.0.0.1/internal_audio.mp3',
      'http://172.16.10.5/stream.m3u8',
      'http://192.168.1.1/camera.mjpg',
    ];

    for (const targetUrl of privateUrls) {
      const mock = createMockReqRes('GET', `/api/media/proxy?url=${encodeURIComponent(targetUrl)}`);
      const ctx = {
        req: mock.req,
        res: mock.res,
        url: new URL(`http://localhost:3001/api/media/proxy?url=${encodeURIComponent(targetUrl)}`),
        readBoundedBody: async () => ({ body: '', ok: true }),
      };

      await handleMediaPlayerRoutes(ctx);
      const resp = mock.getResponse();
      expect(resp.statusCode).toBe(403);
      expect(resp.json().error).toMatch(/Forbidden/i);
    }
  });

  it('C5: Strictly blocks internal port scanning and URL embedded credentials', async () => {
    // Restricted port (CometBFT RPC port 26657)
    const portScanUrl = 'http://external-media.org:26657/status';
    const mockPort = createMockReqRes('GET', `/api/media/proxy?url=${encodeURIComponent(portScanUrl)}`);
    const ctxPort = {
      req: mockPort.req,
      res: mockPort.res,
      url: new URL(`http://localhost:3001/api/media/proxy?url=${encodeURIComponent(portScanUrl)}`),
      readBoundedBody: async () => ({ body: '', ok: true }),
    };
    await handleMediaPlayerRoutes(ctxPort);
    expect(mockPort.getResponse().statusCode).toBe(403);
    expect(mockPort.getResponse().json().error).toMatch(/restricted by SSRF security policy/i);

    // URL with embedded credentials
    const credUrl = 'http://admin:supersecret@external-media.org/video.mp4';
    const mockCred = createMockReqRes('GET', `/api/media/proxy?url=${encodeURIComponent(credUrl)}`);
    const ctxCred = {
      req: mockCred.req,
      res: mockCred.res,
      url: new URL(`http://localhost:3001/api/media/proxy?url=${encodeURIComponent(credUrl)}`),
      readBoundedBody: async () => ({ body: '', ok: true }),
    };
    await handleMediaPlayerRoutes(ctxCred);
    expect(mockCred.getResponse().statusCode).toBe(400);
    expect(mockCred.getResponse().json().error).toMatch(/URL credentials are prohibited/i);
  });
});
