import { describe, it, expect } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleDepinRoutes } from '../../scripts/routes/depin.routes.ts';
import { sovraDb } from '../../scripts/database-engine.ts';

function createMockReqRes(method: string, url: string, bodyObj?: any) {
  const req = new http.IncomingMessage(null as any);
  req.method = method;
  req.url = url;

  const res = new http.ServerResponse(req);
  let statusCode = 200;
  let headers: Record<string, string> = {};
  let body = '';

  res.writeHead = (status: number, h?: any) => {
    statusCode = status;
    if (h) headers = { ...headers, ...h };
    return res;
  };

  res.end = (chunk?: any) => {
    if (chunk) body += chunk;
    return res;
  };

  if (bodyObj !== undefined) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(bodyObj)));
      req.emit('end');
    });
  } else {
    process.nextTick(() => {
      req.emit('end');
    });
  }

  return {
    req,
    res,
    getResponse: () => ({
      statusCode,
      headers,
      body,
      json: () => (body ? JSON.parse(body) : null),
    }),
  };
}

describe('Cycle 4: DePIN Mesh Hotspot Micro-ISP & Bandwidth Metering (Helium Killer)', () => {
  const hostDid = `did:sovra:hotspot_host_${Date.now()}`;
  const clientDid = `did:sovra:mesh_client_${Date.now()}`;
  let sessionId = '';

  it('POST /api/depin/mesh/start initializes a DePIN tethering hotspot session', async () => {
    const { req, res, getResponse } = createMockReqRes('POST', '/api/depin/mesh/start', {
      hotspotNodeDid: hostDid,
      clientPeerDid: clientDid,
      ratePerMbSov: 0.001,
    });

    const handled = await handleDepinRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(201);
    const json = resp.json();
    expect(json.ok).toBe(true);
    expect(json.session).toBeDefined();
    expect(json.session.hotspotNodeDid).toBe(hostDid);
    expect(json.session.ratePerMbSov).toBe(0.001);
    expect(json.session.status).toBe('ACTIVE');

    sessionId = json.session.sessionId;
  });

  it('POST /api/depin/mesh/meter meters relayed bandwidth and disburses micro-SOV', async () => {
    const bytesToRelay = 10 * 1024 * 1024; // 10 MB
    const { req, res, getResponse } = createMockReqRes('POST', '/api/depin/mesh/meter', {
      sessionId,
      bytesRelayed: bytesToRelay,
    });

    const handled = await handleDepinRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(200);
    const json = resp.json();
    expect(json.ok).toBe(true);
    expect(json.session.bytesRelayed).toBeGreaterThanOrEqual(bytesToRelay);
    expect(json.session.earnedSov).toBeCloseTo(0.01, 3);
  });

  it('GET /api/depin/mesh/analytics aggregates DePIN network performance and operator yield', async () => {
    const { req, res, getResponse } = createMockReqRes('GET', `/api/depin/mesh/analytics?hostDid=${encodeURIComponent(hostDid)}`);
    const handled = await handleDepinRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(200);
    const json = resp.json();
    expect(json.ok).toBe(true);
    expect(json.totalSessions).toBeGreaterThanOrEqual(1);
    expect(json.totalMbBridged).toBeGreaterThanOrEqual(10);
    expect(json.totalEarnedSov).toBeGreaterThan(0);
  });

  it('verifies client UI exposes toggleDepinHotspot helper', () => {
    const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
    const content = fs.readFileSync(devServerPath, 'utf-8');
    expect(content).toContain('toggleDepinHotspot');
  });
});
