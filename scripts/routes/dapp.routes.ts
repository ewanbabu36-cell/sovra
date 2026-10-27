import http from 'node:http';
import crypto from 'node:crypto';
import { sovraDb, type MiniDAppRecord } from '../database-engine.ts';

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

// Scoped in-memory launch tokens for sandboxed DApp sessions
const activeLaunchTokens = new Map<string, {
  dappId: string;
  userDid: string;
  permissions: string[];
  expiresAt: number;
}>();

export async function handleDAppRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const url = req.url || '';
  const method = req.method || 'GET';

  if (!url.startsWith('/api/dapps')) {
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

  // 1. GET /api/dapps/explore - Browse categorized mini-dapps
  if (method === 'GET' && (url === '/api/dapps/explore' || url.startsWith('/api/dapps/explore?'))) {
    const parsedUrl = new URL(url, 'http://localhost');
    const category = parsedUrl.searchParams.get('category') || undefined;
    const dapps = sovraDb.getMiniDApps(category);
    sendJson(res, 200, {
      ok: true,
      count: dapps.length,
      category: category || 'all',
      dapps,
    });
    return true;
  }

  // 2. GET /api/dapps/info/:id - Retrieve specific DApp metadata
  const infoMatch = url.match(/^\/api\/dapps\/info\/([a-zA-Z0-9_-]+)$/);
  if (method === 'GET' && infoMatch) {
    const dappId = infoMatch[1];
    const dapp = sovraDb.getMiniDAppById(dappId);
    if (!dapp) {
      sendJson(res, 404, { ok: false, error: 'Mini-DApp not found' });
      return true;
    }
    sendJson(res, 200, { ok: true, dapp });
    return true;
  }

  // 3. POST /api/dapps/publish - Register a decentralized Mini-DApp
  if (method === 'POST' && url === '/api/dapps/publish') {
    try {
      const body = await parseJsonBody(req);
      if (!body.name || !body.bundleCid || !body.authorDid) {
        sendJson(res, 400, { ok: false, error: 'Missing name, bundleCid, or authorDid' });
        return true;
      }

      const id = body.id || `dapp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const dappRecord: MiniDAppRecord = {
        id,
        name: body.name,
        authorDid: body.authorDid,
        version: body.version || '1.0.0',
        bundleCid: body.bundleCid,
        iconUrl: body.iconUrl || '📱',
        category: body.category || 'tools',
        permissions: Array.isArray(body.permissions) ? body.permissions : ['identity:profile'],
        installsCount: 0,
        rating: 5.0,
        description: body.description || '',
        entryHtml: body.entryHtml || `<!DOCTYPE html><html><body><h3>${body.name}</h3><p>Decentralized DApp loaded from CID: ${body.bundleCid}</p></body></html>`,
        createdAt: Date.now(),
      };

      const result = sovraDb.registerMiniDApp(dappRecord);
      sendJson(res, 201, result);
      return true;
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  // 4. POST /api/dapps/launch - Issue scoped execution token
  if (method === 'POST' && url === '/api/dapps/launch') {
    try {
      const body = await parseJsonBody(req);
      const dappId = body.dappId;
      const userDid = body.userDid || 'did:sovra:anonymous';
      const dapp = sovraDb.getMiniDAppById(dappId);

      if (!dapp) {
        sendJson(res, 404, { ok: false, error: 'Mini-DApp not found' });
        return true;
      }

      sovraDb.incrementDAppInstalls(dappId);

      const token = `tok_dapp_${crypto.randomBytes(16).toString('hex')}`;
      const expiresAt = Date.now() + 3600 * 1000; // 1 hour token
      activeLaunchTokens.set(token, {
        dappId,
        userDid,
        permissions: dapp.permissions,
        expiresAt,
      });

      sendJson(res, 200, {
        ok: true,
        launchToken: token,
        dapp: {
          id: dapp.id,
          name: dapp.name,
          permissions: dapp.permissions,
          bundleCid: dapp.bundleCid,
        },
        sandboxUrl: `/api/dapps/${dapp.id}/bundle?token=${token}`,
        expiresAt,
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  // 5. GET /api/dapps/:id/bundle - Render sandboxed iframe HTML
  const bundleMatch = url.match(/^\/api\/dapps\/([a-zA-Z0-9_-]+)\/bundle/);
  if (method === 'GET' && bundleMatch) {
    const dappId = bundleMatch[1];
    const dapp = sovraDb.getMiniDAppById(dappId);
    if (!dapp) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Mini-DApp not found');
      return true;
    }

    const html = dapp.entryHtml || `<!DOCTYPE html><html><body><h2>${dapp.name}</h2></body></html>`;
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(html);
    return true;
  }

  // 6. POST /api/dapps/rpc - Sandboxed client RPC proxy (wallet:pay, identity:profile)
  if (method === 'POST' && url === '/api/dapps/rpc') {
    try {
      const body = await parseJsonBody(req);
      const { launchToken, method: rpcMethod, params } = body;

      const session = activeLaunchTokens.get(launchToken);
      if (!session || Date.now() > session.expiresAt) {
        sendJson(res, 401, { ok: false, error: 'Invalid or expired launch token' });
        return true;
      }

      if (rpcMethod === 'wallet:pay') {
        if (!session.permissions.includes('wallet:pay')) {
          sendJson(res, 403, { ok: false, error: 'DApp does not have permission: wallet:pay' });
          return true;
        }
        const amount = Number(params?.amount || 0);
        const memo = params?.memo || 'Mini-DApp Payment';
        const user = sovraDb.getUserByDid(session.userDid);

        if (!user || (user.balance_sov || 0) < amount) {
          sendJson(res, 400, { ok: false, error: 'Insufficient SOV balance' });
          return true;
        }

        user.balance_sov = Math.round(((user.balance_sov || 0) - amount) * 1000) / 1000;
        sovraDb.save();

        sendJson(res, 200, {
          ok: true,
          result: {
            status: 'CONFIRMED',
            txId: `tx_dapp_${crypto.randomBytes(6).toString('hex')}`,
            amount,
            remainingBalance: user.balance_sov,
            memo,
          },
        });
        return true;
      }

      if (rpcMethod === 'identity:profile') {
        if (!session.permissions.includes('identity:profile')) {
          sendJson(res, 403, { ok: false, error: 'DApp does not have permission: identity:profile' });
          return true;
        }
        const user = sovraDb.getUserByDid(session.userDid);
        sendJson(res, 200, {
          ok: true,
          result: {
            did: session.userDid,
            displayName: user?.display_name || user?.name || 'Sovereign Citizen',
            handle: user?.handle || 'citizen',
            avatar: user?.avatar_data_url || user?.avatar || '👤',
          },
        });
        return true;
      }

      sendJson(res, 400, { ok: false, error: `Unsupported RPC method: ${rpcMethod}` });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  return false;
}
