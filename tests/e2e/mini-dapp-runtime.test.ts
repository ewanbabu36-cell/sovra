import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { handleDAppRoutes } from '../../scripts/routes/dapp.routes.ts';
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

describe('Cycle 1: Sovereign Mini-DApp Sandbox Runtime', () => {
  it('GET /api/dapps/explore returns seeded mini-dapps with categories', async () => {
    const { req, res, getResponse } = createMockReqRes('GET', '/api/dapps/explore');
    const handled = await handleDAppRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(200);
    const json = resp.json();
    expect(json.ok).toBe(true);
    expect(json.dapps.length).toBeGreaterThanOrEqual(4);
    expect(json.dapps.some((d: any) => d.id === 'dapp_flappy_sov')).toBe(true);
    expect(json.dapps.some((d: any) => d.category === 'defi')).toBe(true);
  });

  it('GET /api/dapps/explore?category=games filters appropriately', async () => {
    const { req, res, getResponse } = createMockReqRes('GET', '/api/dapps/explore?category=games');
    const handled = await handleDAppRoutes(req, res);
    expect(handled).toBe(true);

    const json = getResponse().json();
    expect(json.ok).toBe(true);
    expect(json.dapps.every((d: any) => d.category === 'games')).toBe(true);
  });

  it('POST /api/dapps/publish registers a new decentralized Mini-DApp', async () => {
    const newDApp = {
      name: 'P2P Chess Masters',
      authorDid: 'did:key:z6MkoVmKwZQZ9GyXrNEyztNNuYK3e36NqvfHri1vSTRQEFDD',
      version: '1.0.0',
      bundleCid: 'bafybeigchess7ug3vsqbqum46x762f5bftn33u4p6k23d72fxh5hsp36yymu',
      category: 'games',
      permissions: ['wallet:pay', 'identity:profile'],
      description: 'E2EE turn-based P2P chess on libp2p gossip mesh.',
    };

    const { req, res, getResponse } = createMockReqRes('POST', '/api/dapps/publish', newDApp);
    const handled = await handleDAppRoutes(req, res);
    expect(handled).toBe(true);

    const json = getResponse().json();
    expect(json.ok).toBe(true);
    expect(json.dapp.name).toBe('P2P Chess Masters');
    expect(json.dapp.id).toBeDefined();
  });

  it('POST /api/dapps/launch issues a scoped capability token and increments installs', async () => {
    const { req, res, getResponse } = createMockReqRes('POST', '/api/dapps/launch', {
      dappId: 'dapp_flappy_sov',
      userDid: 'did:key:z6MkoVmKwZQZ9GyXrNEyztNNuYK3e36NqvfHri1vSTRQEFDD',
    });
    const handled = await handleDAppRoutes(req, res);
    expect(handled).toBe(true);

    const json = getResponse().json();
    expect(json.ok).toBe(true);
    expect(json.launchToken).toMatch(/^tok_dapp_/);
    expect(json.sandboxUrl).toContain('dapp_flappy_sov');
    expect(json.dapp.permissions).toContain('wallet:pay');
  });

  it('GET /api/dapps/:id/bundle serves the sandboxed entry HTML', async () => {
    const { req, res, getResponse } = createMockReqRes('GET', '/api/dapps/dapp_flappy_sov/bundle');
    const handled = await handleDAppRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(200);
    expect(resp.body).toContain('Flappy SOV');
  });

  it('POST /api/dapps/rpc executes wallet:pay when permitted and settles user balance', async () => {
    // 1. Launch to obtain token
    const launch = createMockReqRes('POST', '/api/dapps/launch', {
      dappId: 'dapp_flappy_sov',
      userDid: 'did:key:z6MkoVmKwZQZ9GyXrNEyztNNuYK3e36NqvfHri1vSTRQEFDD',
    });
    await handleDAppRoutes(launch.req, launch.res);
    const token = launch.getResponse().json().launchToken;

    // Ensure user has initial balance
    let user = sovraDb.getUserByDid('did:key:z6MkoVmKwZQZ9GyXrNEyztNNuYK3e36NqvfHri1vSTRQEFDD');
    if (!user) {
      sovraDb.saveUser({
        did: 'did:key:z6MkoVmKwZQZ9GyXrNEyztNNuYK3e36NqvfHri1vSTRQEFDD',
        handle: 'creator',
        name: 'Creator',
        balance_sov: 50.0,
      } as any);
    } else {
      user.balance_sov = 50.0;
      sovraDb.save();
    }

    // 2. Execute RPC
    const rpc = createMockReqRes('POST', '/api/dapps/rpc', {
      launchToken: token,
      method: 'wallet:pay',
      params: { amount: 2.5, memo: 'Flappy SOV High Score Bounty' },
    });
    const handled = await handleDAppRoutes(rpc.req, rpc.res);
    expect(handled).toBe(true);

    const json = rpc.getResponse().json();
    expect(json.ok).toBe(true);
    expect(json.result.status).toBe('CONFIRMED');
    expect(json.result.amount).toBe(2.5);
    expect(json.result.remainingBalance).toBe(47.5);
  });
});
