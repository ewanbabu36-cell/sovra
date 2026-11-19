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

function enrichCampaign(c?: any) {
  if (!c) return c;
  return {
    ...c,
    id: c.campaignId || c.id,
    milestones: (c.milestones || []).map((m: any) => ({
      ...m,
      status: m.isReleased ? 'RELEASED' : 'PENDING',
    })),
  };
}

function parseJsonBody(req: http.IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    let received = 0;
    let aborted = false;
    req.on('data', chunk => {
      if (aborted) return;
      received += chunk.length;
      if (received > maxBytes) {
        aborted = true;
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', (err) => {
      if (!aborted) reject(err);
    });
  });
}

export async function handleQuadraticRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const url = req.url || '';
  const method = req.method || 'GET';

  if (!url.startsWith('/api/studio/quadratic')) {
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

  // 1. POST /api/studio/quadratic/create - Launches a milestone-governed crowdfunding campaign
  if (method === 'POST' && url === '/api/studio/quadratic/create') {
    try {
      const body = await parseJsonBody(req);
      const { creatorDid, title, goalAmountSov, milestones, durationDays } = body;

      if (!creatorDid || !title || !goalAmountSov) {
        sendJson(res, 400, { ok: false, error: 'creatorDid, title, and goalAmountSov are required' });
        return true;
      }

      const result = sovraDb.createQuadraticEscrow({
        creatorDid,
        title,
        goalAmountSov: Number(goalAmountSov),
        milestones: Array.isArray(milestones) ? milestones : [{ title: 'Initial Prototype & Demo', targetAmountSov: Number(goalAmountSov) * 0.5 }],
        durationDays: Number(durationDays || 30),
      });

      sendJson(res, 201, {
        ok: true,
        campaign: enrichCampaign(result.campaign),
        message: 'Quadratic funding campaign deployed with milestone escrow protection',
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  // 2. POST /api/studio/quadratic/pledge - Pledges SOV and recomputes quadratic matching pool
  if (method === 'POST' && url === '/api/studio/quadratic/pledge') {
    try {
      const body = await parseJsonBody(req);
      const { campaignId, backerDid, amountSov } = body;

      if (!campaignId || !backerDid || isNaN(Number(amountSov)) || Number(amountSov) <= 0) {
        sendJson(res, 400, { ok: false, error: 'campaignId, backerDid, and valid positive amountSov are required' });
        return true;
      }

      // Authorization / BOLA Defense
      const authHeader = req.headers.authorization;
      const xDid = (req.headers['x-sovra-did'] || req.headers['did']) as string;
      let callerDid: string | null = null;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7).trim();
        const user = sovraDb.findUserBySessionToken(token);
        if (user) callerDid = user.did;
      } else if (xDid) {
        callerDid = xDid.trim();
      }

      if (callerDid && callerDid !== backerDid) {
        sendJson(res, 403, { ok: false, error: 'Forbidden: Cannot pledge funds on behalf of another sovereign DID' });
        return true;
      }

      const result = sovraDb.pledgeQuadraticEscrow(campaignId, backerDid, Number(amountSov));
      if (!result.ok) {
        sendJson(res, 400, result);
        return true;
      }

      sendJson(res, 200, {
        ok: true,
        campaign: enrichCampaign(result.campaign),
        quadraticMatchSov: result.campaign?.quadraticMatchSov,
        contributorsCount: result.campaign?.contributorsCount,
        message: `Pledge of ${amountSov} SOV confirmed. Quadratic match increased to ${result.campaign?.quadraticMatchSov} SOV.`,
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  // 3. POST /api/studio/quadratic/release-milestone - Unlocks milestone funds upon delivery verification
  if (method === 'POST' && url === '/api/studio/quadratic/release-milestone') {
    try {
      const body = await parseJsonBody(req);
      const { campaignId, milestoneIndex } = body;

      if (!campaignId || milestoneIndex === undefined) {
        sendJson(res, 400, { ok: false, error: 'campaignId and milestoneIndex are required' });
        return true;
      }

      // Authorization: Only campaign creator or admin can release milestone funds
      const authHeader = req.headers.authorization;
      const xDid = (req.headers['x-sovra-did'] || req.headers['did']) as string;
      let callerDid: string | null = null;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7).trim();
        const user = sovraDb.findUserBySessionToken(token);
        if (user) callerDid = user.did;
      } else if (xDid) {
        callerDid = xDid.trim();
      }

      const campaign = (sovraDb.getQuadraticEscrows() || []).find((c: any) => c.campaignId === campaignId || c.id === campaignId);
      if (campaign && callerDid && callerDid !== campaign.creatorDid && callerDid !== 'did:sovra:admin') {
        sendJson(res, 403, { ok: false, error: 'Forbidden: Only the campaign creator can release milestones' });
        return true;
      }

      const result = sovraDb.releaseQuadraticMilestone(campaignId, Number(milestoneIndex));
      if (!result.ok) {
        sendJson(res, 400, result);
        return true;
      }

      sendJson(res, 200, {
        ok: true,
        amountReleased: result.amountReleased,
        campaign: enrichCampaign(result.campaign),
        message: `Milestone #${milestoneIndex} released (${result.amountReleased} SOV) directly to creator wallet`,
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  // 4. POST /api/studio/quadratic/refund - Auto-refunds backers if campaign goal or deadline expires
  if (method === 'POST' && url === '/api/studio/quadratic/refund') {
    try {
      const body = await parseJsonBody(req);
      const campaignId = body.campaignId;

      if (!campaignId) {
        sendJson(res, 400, { ok: false, error: 'campaignId is required' });
        return true;
      }

      const result = sovraDb.refundQuadraticEscrow(campaignId);
      if (!result.ok) {
        sendJson(res, 400, result);
        return true;
      }

      sendJson(res, 200, {
        ok: true,
        refundsCount: result.refundsCount,
        totalRefundedSov: result.totalRefundedSov,
        message: `All ${result.refundsCount} backers refunded with 100% of their pledged SOV (${result.totalRefundedSov} SOV)`,
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  // 5. GET /api/studio/quadratic/campaigns - Lists active quadratic campaigns
  if (method === 'GET' && (url === '/api/studio/quadratic/campaigns' || url.startsWith('/api/studio/quadratic/campaigns?'))) {
    const parsedUrl = new URL(url, 'http://localhost');
    const creatorDid = parsedUrl.searchParams.get('creatorDid') || undefined;
    const campaigns = sovraDb.getQuadraticEscrows(creatorDid);
    sendJson(res, 200, {
      ok: true,
      count: campaigns.length,
      campaigns: campaigns.map(enrichCampaign),
    });
    return true;
  }

  return false;
}
