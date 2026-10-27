import http from 'node:http';
import { sovraDb } from '../database-engine.ts';

function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sovra-DID, X-Sovra-Signature',
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export async function handleDepinRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const url = req.url || '';
  const method = req.method || 'GET';

  if (!url.startsWith('/api/depin')) {
    return false;
  }

  if (method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sovra-DID, X-Sovra-Signature',
    });
    res.end();
    return true;
  }

  // 1. POST /api/depin/mesh/start - Register node as a local DePIN micro-ISP hotspot
  if (method === 'POST' && url === '/api/depin/mesh/start') {
    try {
      const body = await parseJsonBody(req);
      const hotspotNodeDid = body.hotspotNodeDid;
      const clientPeerDid = body.clientPeerDid || 'did:sovra:guest_mesh_peer';
      const ratePerMbSov = Number(body.ratePerMbSov || 0.001);

      if (!hotspotNodeDid) {
        sendJson(res, 400, { ok: false, error: 'hotspotNodeDid is required' });
        return true;
      }

      const result = sovraDb.startDepinSession({
        hotspotNodeDid,
        clientPeerDid,
        ratePerMbSov,
      });

      sendJson(res, 201, {
        ok: true,
        session: result.session,
        meshSsid: 'Sovra-Mesh-Hotspot',
        instructions: 'Relaying traffic earns 0.001 SOV per megabyte directly credited to hotspot operator.',
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  // 2. POST /api/depin/mesh/meter - Meter packet chunks relayed and disburse micro-SOV
  if (method === 'POST' && url === '/api/depin/mesh/meter') {
    try {
      const body = await parseJsonBody(req);
      const sessionId = body.sessionId;
      const bytesRelayed = Number(body.bytesRelayed || 0);

      if (!sessionId || bytesRelayed <= 0) {
        sendJson(res, 400, { ok: false, error: 'sessionId and valid positive bytesRelayed are required' });
        return true;
      }

      const result = sovraDb.meterDepinSession(sessionId, bytesRelayed);
      if (!result.ok) {
        sendJson(res, 400, result);
        return true;
      }

      const enrichedSession = result.session ? {
        ...result.session,
        earnedSov: result.session.totalEarnedSov,
      } : undefined;

      sendJson(res, 200, {
        ok: true,
        microEarnedSov: result.microEarnedSov,
        totalBytesRelayed: result.session?.bytesRelayed,
        totalEarnedSov: result.session?.totalEarnedSov,
        session: enrichedSession,
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  // 3. GET /api/depin/mesh/analytics - Hotspot traffic & revenue analytics
  if (method === 'GET' && (url === '/api/depin/mesh/analytics' || url.startsWith('/api/depin/mesh/analytics?'))) {
    const parsedUrl = new URL(url, 'http://localhost');
    const hotspotDid = parsedUrl.searchParams.get('hotspotDid') || parsedUrl.searchParams.get('hostDid') || undefined;
    const sessions = sovraDb.getDepinSessions(hotspotDid);

    let totalBytes = 0;
    let totalEarned = 0;
    sessions.forEach(s => {
      totalBytes += s.bytesRelayed;
      totalEarned += s.totalEarnedSov;
    });

    const totalMb = Math.round((totalBytes / (1024 * 1024)) * 100) / 100;
    const earnedSov = Math.round(totalEarned * 10000) / 10000;

    sendJson(res, 200, {
      ok: true,
      activeSessionsCount: sessions.filter(s => s.status === 'ACTIVE').length,
      totalSessionsCount: sessions.length,
      totalSessions: sessions.length,
      totalMbRelayed: totalMb,
      totalMbBridged: totalMb,
      totalEarnedSov: earnedSov,
      sessions,
    });
    return true;
  }

  return false;
}
