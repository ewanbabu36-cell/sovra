import http from 'node:http';
import crypto from 'node:crypto';
import { sovraDb, type AutonomousAgentRecord } from '../database-engine.ts';

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

export async function handleAgentRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const url = req.url || '';
  const method = req.method || 'GET';

  if (!url.startsWith('/api/agents')) {
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

  // 1. GET /api/agents/list - Lists active agents
  if (method === 'GET' && (url === '/api/agents/list' || url.startsWith('/api/agents/list?'))) {
    const parsedUrl = new URL(url, 'http://localhost');
    const ownerDid = parsedUrl.searchParams.get('ownerDid') || undefined;
    const rawAgents = sovraDb.getAutonomousAgents(ownerDid);
    const agents = rawAgents.map(a => ({
      ...a,
      id: a.agentId,
      status: a.isActive ? 'active' : 'inactive',
      executionCount: (a.logs || []).length,
    }));
    sendJson(res, 200, {
      ok: true,
      count: agents.length,
      agents,
    });
    return true;
  }

  // 2. POST /api/agents/deploy - Deploys a new autonomous agent mission with bounded sub-wallet
  if (method === 'POST' && url === '/api/agents/deploy') {
    try {
      const body = await parseJsonBody(req);
      const ownerDid = body.ownerDid;
      const name = body.name || 'Sovereign Worker Agent';
      const role = body.role || 'FEED_CURATOR';
      const dailyBudget = Number(body.dailyBudgetSov || body.budgetDailySov || 5.0);

      if (!ownerDid) {
        sendJson(res, 400, { ok: false, error: 'ownerDid is required' });
        return true;
      }

      const agentId = `agent_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const subWallet = `sov1agent_${crypto.randomBytes(8).toString('hex')}`;

      const agentRecord: AutonomousAgentRecord = {
        agentId,
        ownerDid,
        name,
        role: role as any,
        subWalletAddress: subWallet,
        dailyBudgetSov: dailyBudget,
        spentTodaySov: 0.0,
        capabilities: body.permissions || body.capabilities || ['read_feed', 'auto_curate'],
        isActive: true,
        lastExecutedAt: Date.now(),
        logs: [],
        createdAt: Date.now(),
      };

      const result = sovraDb.deployAutonomousAgent(agentRecord);
      const enrichedAgent = {
        ...result.agent,
        id: agentId,
        status: 'active',
        executionCount: 0,
      };

      sendJson(res, 201, {
        ok: true,
        agent: enrichedAgent,
        message: `Autonomous Agent [${name}] deployed with ${dailyBudget} SOV/day maximum spending limit`,
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  // 3. POST /api/agents/trigger-cycle - Executes an autonomous mission cycle
  if (method === 'POST' && url === '/api/agents/trigger-cycle') {
    try {
      const body = await parseJsonBody(req);
      const agentId = body.agentId;
      const spentSov = Number(body.spentSov || 0.0);
      const action = body.action || body.triggerReason || 'EXECUTE_AUTONOMOUS_STEP';

      if (!agentId) {
        sendJson(res, 400, { ok: false, error: 'agentId is required' });
        return true;
      }

      const agent = sovraDb.getAutonomousAgentById(agentId);
      if (!agent) {
        sendJson(res, 404, { ok: false, error: 'Agent not found' });
        return true;
      }

      const simResult = {
        status: 'SUCCESS',
        action,
        itemsProcessed: 14,
        timestamp: Date.now(),
      };

      const execResult = sovraDb.recordAgentExecution(agentId, spentSov, action, simResult);
      if (!execResult.ok) {
        sendJson(res, 400, execResult);
        return true;
      }

      const updatedAgent = sovraDb.getAutonomousAgentById(agentId) || agent;
      const enrichedAgent = {
        ...updatedAgent,
        id: updatedAgent.agentId,
        status: updatedAgent.isActive ? 'active' : 'inactive',
        executionCount: (updatedAgent.logs || []).length,
      };

      sendJson(res, 200, {
        ok: true,
        agentId,
        spentSov,
        currentSpentToday: updatedAgent.spentTodaySov,
        dailyBudgetRemaining: Math.round((updatedAgent.dailyBudgetSov - updatedAgent.spentTodaySov) * 1000) / 1000,
        result: simResult,
        executionReport: {
          status: 'COMPLETED',
          action,
          result: simResult,
        },
        agent: enrichedAgent,
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  return false;
}
