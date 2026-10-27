import { describe, it, expect } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleAgentRoutes } from '../../scripts/routes/agent.routes.ts';
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

describe('Cycle 2: Self-Sovereign Autonomous On-Node AI Agents (OpenAI Swarm Killer)', () => {
  const ownerDid = `did:sovra:agent_commander_${Date.now()}`;
  let agentId = '';

  it('POST /api/agents/deploy launches an autonomous agent daemon with a bounded sub-wallet', async () => {
    const { req, res, getResponse } = createMockReqRes('POST', '/api/agents/deploy', {
      ownerDid,
      name: 'P2P Arbitrage Scout',
      role: 'arbitrage_trader',
      budgetDailySov: 25.0,
      permissions: ['p2p_trade', 'price_oracle_read', 'micro_settle'],
    });

    const handled = await handleAgentRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(201);
    const json = resp.json();
    expect(json.ok).toBe(true);
    expect(json.agent.name).toBe('P2P Arbitrage Scout');
    expect(json.agent.role).toBe('arbitrage_trader');
    expect(json.agent.ownerDid).toBe(ownerDid);
    expect(json.agent.subWalletAddress).toMatch(/^sov1agent_/);
    expect(json.agent.status).toBe('active');

    agentId = json.agent.id;
  });

  it('GET /api/agents/list retrieves autonomous agents belonging to commander DID', async () => {
    const { req, res, getResponse } = createMockReqRes('GET', `/api/agents/list?ownerDid=${encodeURIComponent(ownerDid)}`);
    const handled = await handleAgentRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(200);
    const json = resp.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.agents)).toBe(true);
    expect(json.agents.length).toBeGreaterThanOrEqual(1);
    expect(json.agents.some((a: any) => a.id === agentId)).toBe(true);
  });

  it('POST /api/agents/trigger-cycle executes autonomous reasoning cycle within safety sandbox', async () => {
    const { req, res, getResponse } = createMockReqRes('POST', '/api/agents/trigger-cycle', {
      agentId,
      triggerReason: 'cron_tick_opportunity_scan',
    });

    const handled = await handleAgentRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(200);
    const json = resp.json();
    expect(json.ok).toBe(true);
    expect(json.executionReport).toBeDefined();
    expect(json.executionReport.status).toBe('COMPLETED');
    expect(json.agent.executionCount).toBeGreaterThanOrEqual(1);
  });

  it('verifies client UI exposes deployAutonomousMission agent launcher', () => {
    const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
    const content = fs.readFileSync(devServerPath, 'utf-8');
    expect(content).toContain('deployAutonomousMission');
    expect(content).toContain('autonomous-agent-card');
  });
});
