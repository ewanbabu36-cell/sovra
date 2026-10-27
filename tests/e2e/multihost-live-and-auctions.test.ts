import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { handleLiveStreamingRoutes, type LiveRouteContext } from '../../scripts/routes/live.routes.ts';

function createMockLiveContext(method: string, pathname: string, bodyObj?: any, queryParams: Record<string, string> = {}): {
  ctx: LiveRouteContext;
  getResponse: () => { statusCode: number; body: string; json: () => any };
} {
  const req = new http.IncomingMessage(null as any);
  req.method = method;
  const url = new URL(`http://localhost${pathname}`);
  Object.entries(queryParams).forEach(([k, v]) => url.searchParams.set(k, v));
  req.url = url.pathname + url.search;

  const res = new http.ServerResponse(req);
  let statusCode = 200;
  let body = '';

  res.writeHead = (status: number) => {
    statusCode = status;
    return res;
  };

  res.end = (chunk?: any) => {
    if (chunk) body += chunk;
    return res;
  };

  const readBoundedBody = async () => {
    return {
      body: bodyObj !== undefined ? JSON.stringify(bodyObj) : '',
      ok: true,
    };
  };

  const resolvePrincipal = () => ({
    did: 'did:key:z6MkoVmKwZQZ9GyXrNEyztNNuYK3e36NqvfHri1vSTRQEFDD',
    role: 'USER' as any,
    handle: '@test_streamer',
    capabilities: [],
  });

  const enforceAuth = () => resolvePrincipal();

  return {
    ctx: {
      req,
      res,
      url,
      readBoundedBody,
      resolvePrincipal,
      enforceAuth,
    },
    getResponse: () => ({
      statusCode,
      body,
      json: () => (body ? JSON.parse(body) : null),
    }),
  };
}

describe('Cycle 3: Multi-Host Live Broadcast Swarm & 3D Spatial Audio Stages', () => {
  const testSessionId = `session_live_${Date.now()}`;

  it('POST /api/live/cohost/invite adds up to 3 co-hosts (max 4 total)', async () => {
    const { ctx, getResponse } = createMockLiveContext('POST', '/api/live/cohost/invite', {
      sessionId: testSessionId,
      cohostDid: 'did:key:cohost_1',
      cohostName: 'Guest 1',
    });

    const handled = await handleLiveStreamingRoutes(ctx);
    expect(handled).toBe(true);

    const json = getResponse().json();
    expect(json.ok).toBe(true);
    expect(json.count).toBe(2); // 1 host + 1 cohost
    expect(json.cohosts.some((c: any) => c.did === 'did:key:cohost_1')).toBe(true);

    // Add 2nd cohost
    const c2 = createMockLiveContext('POST', '/api/live/cohost/invite', {
      sessionId: testSessionId,
      cohostDid: 'did:key:cohost_2',
      cohostName: 'Guest 2',
    });
    await handleLiveStreamingRoutes(c2.ctx);
    expect(c2.getResponse().json().count).toBe(3);

    // Add 3rd cohost
    const c3 = createMockLiveContext('POST', '/api/live/cohost/invite', {
      sessionId: testSessionId,
      cohostDid: 'did:key:cohost_3',
      cohostName: 'Guest 3',
    });
    await handleLiveStreamingRoutes(c3.ctx);
    expect(c3.getResponse().json().count).toBe(4);

    // Attempt 4th cohost (exceeding limit)
    const c4 = createMockLiveContext('POST', '/api/live/cohost/invite', {
      sessionId: testSessionId,
      cohostDid: 'did:key:cohost_4',
      cohostName: 'Guest 4',
    });
    await handleLiveStreamingRoutes(c4.ctx);
    expect(c4.getResponse().statusCode).toBe(400);
    expect(c4.getResponse().json().error).toContain('Max 4 co-hosts limit');
  });

  it('POST /api/live/cohost/join returns 4_WAY_SPLIT mesh configuration', async () => {
    const { ctx, getResponse } = createMockLiveContext('POST', '/api/live/cohost/join', {
      sessionId: testSessionId,
    });

    const handled = await handleLiveStreamingRoutes(ctx);
    expect(handled).toBe(true);

    const json = getResponse().json();
    expect(json.ok).toBe(true);
    expect(json.meshLayout).toBe('4_WAY_SPLIT');
    expect(json.webrtcSignalingChannel).toContain(testSessionId);
  });

  it('POST /api/live/auction/create creates an active live auction', async () => {
    const { ctx, getResponse } = createMockLiveContext('POST', '/api/live/auction/create', {
      sessionId: testSessionId,
      title: 'Limited Edition Sovereign Hardware Key',
      reservePriceSov: 10.0,
      durationSeconds: 600,
    });

    const handled = await handleLiveStreamingRoutes(ctx);
    expect(handled).toBe(true);

    const json = getResponse().json();
    expect(json.ok).toBe(true);
    expect(json.auction.title).toBe('Limited Edition Sovereign Hardware Key');
    expect(json.auction.highestBidSov).toBe(10.0);
    expect(json.auction.status).toBe('ACTIVE');
  });

  it('POST /api/live/auction/bid processes competitive live bids and rejects lower bids', async () => {
    // 1. Valid higher bid
    const bid1 = createMockLiveContext('POST', '/api/live/auction/bid', {
      sessionId: testSessionId,
      bidderDid: 'did:key:bidder_alpha',
      bidderName: 'Alpha Collector',
      amountSov: 15.0,
    });
    await handleLiveStreamingRoutes(bid1.ctx);
    const json1 = bid1.getResponse().json();
    expect(json1.ok).toBe(true);
    expect(json1.auction.highestBidSov).toBe(15.0);
    expect(json1.auction.highestBidderName).toBe('Alpha Collector');

    // 2. Reject lower/equal bid
    const bid2 = createMockLiveContext('POST', '/api/live/auction/bid', {
      sessionId: testSessionId,
      bidderDid: 'did:key:bidder_beta',
      bidderName: 'Beta Collector',
      amountSov: 12.0,
    });
    await handleLiveStreamingRoutes(bid2.ctx);
    expect(bid2.getResponse().statusCode).toBe(400);
    expect(bid2.getResponse().json().error).toContain('Bid must be higher');

    // 3. Status check
    const statusCtx = createMockLiveContext('GET', '/api/live/auction/status', undefined, { sessionId: testSessionId });
    await handleLiveStreamingRoutes(statusCtx.ctx);
    const statusJson = statusCtx.getResponse().json();
    expect(statusJson.ok).toBe(true);
    expect(statusJson.hasActiveAuction).toBe(true);
    expect(statusJson.auction.highestBidSov).toBe(15.0);
  });
});
