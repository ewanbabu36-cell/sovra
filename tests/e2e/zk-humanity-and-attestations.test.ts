import { describe, it, expect } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleZkRoutes } from '../../scripts/routes/zk.routes.ts';
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

describe('Cycle 1: Zero-Knowledge Proof-of-Humanity & Selective Disclosure (Worldcoin Killer)', () => {
  const testDid = `did:sovra:zk_human_${Date.now()}`;
  const nullifier = `nullifier_poh_${Date.now()}_abc123`;

  it('POST /api/zk/humanity/verify validates Semaphore ZK proof and issues ZK-Human badge', async () => {
    const { req, res, getResponse } = createMockReqRes('POST', '/api/zk/humanity/verify', {
      subjectDid: testDid,
      nullifierHash: nullifier,
      proofSnark: {
        pi_a: ['0x111', '0x222'],
        pi_b: [['0x333', '0x444'], ['0x555', '0x666']],
        pi_c: ['0x777', '0x888'],
        protocol: 'groth16',
        curve: 'bn128',
      },
    });

    const handled = await handleZkRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(200);
    const json = resp.json();
    expect(json.ok).toBe(true);
    expect(json.attestation.attestationType).toBe('proof_of_humanity');
    expect(json.attestation.nullifierHash).toBe(nullifier);
    expect(json.badge).toBe('🛡️ ZK-Human');
  });

  it('POST /api/zk/humanity/verify rejects replayed nullifier with 409 conflict', async () => {
    const { req, res, getResponse } = createMockReqRes('POST', '/api/zk/humanity/verify', {
      subjectDid: `did:sovra:attacker_${Date.now()}`,
      nullifierHash: nullifier, // reused nullifier
      proofSnark: { dummy: true },
    });

    const handled = await handleZkRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(409);
    const json = resp.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/already been spent/i);
  });

  it('GET /api/zk/badge/:did verifies peer humanity status', async () => {
    const { req, res, getResponse } = createMockReqRes('GET', `/api/zk/badge/${testDid}`);
    const handled = await handleZkRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(200);
    const json = resp.json();
    expect(json.ok).toBe(true);
    expect(json.isHuman).toBe(true);
    expect(json.badge).toBe('🛡️ ZK-Human');
    expect(json.attestations.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/zk/attest/selective-disclosure issues zero-knowledge credential without raw identity leak', async () => {
    const { req, res, getResponse } = createMockReqRes('POST', '/api/zk/attest/selective-disclosure', {
      subjectDid: testDid,
      claimType: 'age_over_18',
      claimValue: 25,
      threshold: 18,
    });

    const handled = await handleZkRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(200);
    const json = resp.json();
    expect(json.ok).toBe(true);
    expect(json.credential.claimType).toBe('age_over_18');
    expect(json.credential.satisfied).toBe(true);
    expect(json.credential.nullifierHash).toBeDefined();
    // Raw value should not be in the public credential
    expect(json.credential.rawClaimValue).toBeUndefined();
  });

  it('confirms dev-server incorporates ZK-Human badge styling and client hook', () => {
    const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
    const content = fs.readFileSync(devServerPath, 'utf-8');
    expect(content).toContain('checkAndRenderZkBadge');
    expect(content).toContain('🛡️ ZK-Human');
    expect(content).toContain('zk-human-badge');
  });
});
