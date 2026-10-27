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
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
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

export async function handleNotesRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const url = req.url || '';
  const method = req.method || 'GET';

  if (!url.startsWith('/api/notes')) {
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

  // 1. GET /api/notes/post/:postId - Get verified community notes for post
  const postMatch = url.match(/^\/api\/notes\/post\/([a-zA-Z0-9_-]+)$/);
  if (method === 'GET' && postMatch) {
    const postId = postMatch[1];
    const notes = sovraDb.getCommunityNotesForPost(postId);
    sendJson(res, 200, {
      ok: true,
      postId,
      count: notes.length,
      notes,
    });
    return true;
  }

  // 2. POST /api/notes/submit - Submit community note
  if (method === 'POST' && url === '/api/notes/submit') {
    try {
      const body = await parseJsonBody(req);
      const { postId, authorDid, summary, classification, sources } = body;

      if (!postId || !authorDid || !summary) {
        sendJson(res, 400, { ok: false, error: 'postId, authorDid, and summary are required' });
        return true;
      }

      const result = sovraDb.submitCommunityNote({
        postId,
        authorDid,
        summary,
        classification: classification || 'lacks_context',
        sources: Array.isArray(sources) ? sources : [],
      });

      if (!result.ok) {
        sendJson(res, 400, result);
        return true;
      }

      sendJson(res, 201, {
        ok: true,
        note: result.note,
        message: 'Community note submitted to decentralized rating pool',
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  // 3. POST /api/notes/rate - Rate note with cross-cluster bridging consensus
  if (method === 'POST' && url === '/api/notes/rate') {
    try {
      const body = await parseJsonBody(req);
      const { noteId, raterDid, clusterId, helpful, reason } = body;

      if (!noteId || !raterDid || typeof helpful !== 'boolean') {
        sendJson(res, 400, { ok: false, error: 'noteId, raterDid, and boolean helpful are required' });
        return true;
      }

      const result = sovraDb.rateCommunityNote({
        noteId,
        raterDid,
        clusterId: clusterId || 'cluster_neutral',
        helpful,
        reason,
      });

      if (!result.ok) {
        sendJson(res, 400, result);
        return true;
      }

      sendJson(res, 200, {
        ok: true,
        note: result.note,
        status: result.note?.status,
        divergentClusterAgreement: result.note?.divergentClusterAgreement,
        helpfulnessScore: result.note?.helpfulnessScore,
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  return false;
}
