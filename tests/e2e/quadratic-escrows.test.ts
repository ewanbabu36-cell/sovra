import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { handleQuadraticRoutes } from '../../scripts/routes/quadratic.routes.ts';
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

describe('Cycle 5: Programmable Quadratic Funding Escrows (Patreon & Kickstarter Killer)', () => {
  const creatorDid = `did:sovra:creator_${Date.now()}`;
  let campaignId = '';

  it('POST /api/studio/quadratic/create deploys a milestone-governed quadratic crowdfunding campaign', async () => {
    const { req, res, getResponse } = createMockReqRes('POST', '/api/studio/quadratic/create', {
      creatorDid,
      title: 'Decentralized 4K Mesh Transcoder Hardware',
      goalAmountSov: 500.0,
      durationDays: 30,
      milestones: [
        { title: 'Alpha FPGA Prototype Board', targetAmountSov: 250.0 },
        { title: 'Beta Firmware & Production Run', targetAmountSov: 250.0 },
      ],
    });

    const handled = await handleQuadraticRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(201);
    const json = resp.json();
    expect(json.ok).toBe(true);
    expect(json.campaign.title).toBe('Decentralized 4K Mesh Transcoder Hardware');
    expect(json.campaign.goalAmountSov).toBe(500.0);
    expect(json.campaign.milestones.length).toBe(2);

    campaignId = json.campaign.id;
  });

  it('POST /api/studio/quadratic/pledge calculates quadratic matching boost across multiple distinct backers', async () => {
    // Backer 1 pledges 100 SOV: sqrt(100) = 10
    const pledge1 = createMockReqRes('POST', '/api/studio/quadratic/pledge', {
      campaignId,
      backerDid: `did:sovra:backer_1_${Date.now()}`,
      amountSov: 100,
    });
    await handleQuadraticRoutes(pledge1.req, pledge1.res);
    expect(pledge1.getResponse().statusCode).toBe(200);

    // Backer 2 pledges 100 SOV: sqrt(100) = 10. Sum = 20. (20)^2 = 400. Direct = 200. Quadratic Match = 200.
    const pledge2 = createMockReqRes('POST', '/api/studio/quadratic/pledge', {
      campaignId,
      backerDid: `did:sovra:backer_2_${Date.now()}`,
      amountSov: 100,
    });
    await handleQuadraticRoutes(pledge2.req, pledge2.res);
    const resp2 = pledge2.getResponse();
    expect(resp2.statusCode).toBe(200);
    const json2 = resp2.json();
    expect(json2.ok).toBe(true);
    expect(json2.campaign.contributorsCount).toBe(2);
    expect(json2.campaign.pledgedAmountSov).toBe(200);
    expect(json2.campaign.quadraticMatchSov).toBeGreaterThan(0);
  });

  it('POST /api/studio/quadratic/release-milestone releases tranche funds upon milestone completion', async () => {
    const { req, res, getResponse } = createMockReqRes('POST', '/api/studio/quadratic/release-milestone', {
      campaignId,
      milestoneIndex: 0,
    });

    const handled = await handleQuadraticRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(200);
    const json = resp.json();
    expect(json.ok).toBe(true);
    expect(json.amountReleased).toBe(250.0);
    expect(json.campaign.milestones[0].status).toBe('RELEASED');
  });

  it('POST /api/studio/quadratic/refund returns 100% of escrowed funds if campaign is canceled or expired', async () => {
    // Create an expired or failing campaign
    const createReq = createMockReqRes('POST', '/api/studio/quadratic/create', {
      creatorDid: `did:sovra:canceled_creator_${Date.now()}`,
      title: 'Abandoned Video Documentary',
      goalAmountSov: 1000.0,
      milestones: [{ title: 'Full Film Delivery', targetAmountSov: 1000.0 }],
    });
    await handleQuadraticRoutes(createReq.req, createReq.res);
    const refundCampaignId = createReq.getResponse().json().campaign.id;

    // Backer pledges 50 SOV
    const pledge = createMockReqRes('POST', '/api/studio/quadratic/pledge', {
      campaignId: refundCampaignId,
      backerDid: `did:sovra:backer_refund_${Date.now()}`,
      amountSov: 50.0,
    });
    await handleQuadraticRoutes(pledge.req, pledge.res);

    // Trigger refund
    const refundReq = createMockReqRes('POST', '/api/studio/quadratic/refund', {
      campaignId: refundCampaignId,
    });
    const handled = await handleQuadraticRoutes(refundReq.req, refundReq.res);
    expect(handled).toBe(true);

    const refundResp = refundReq.getResponse();
    expect(refundResp.statusCode).toBe(200);
    const refundJson = refundResp.json();
    expect(refundJson.ok).toBe(true);
    expect(refundJson.totalRefundedSov).toBe(50.0);
    expect(refundJson.refundsCount).toBe(1);
  });

  it('GET /api/studio/quadratic/campaigns lists all active campaigns', async () => {
    const { req, res, getResponse } = createMockReqRes('GET', '/api/studio/quadratic/campaigns');
    const handled = await handleQuadraticRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(200);
    const json = resp.json();
    expect(json.ok).toBe(true);
    expect(json.campaigns.length).toBeGreaterThanOrEqual(1);
  });
});
