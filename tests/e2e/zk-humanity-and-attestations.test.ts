import { describe, it, expect, beforeAll } from 'vitest';
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
  beforeAll(() => {
    sovraDb.load();
    if (sovraDb.db && Array.isArray(sovraDb.db.zk_attestations)) {
      sovraDb.db.zk_attestations = sovraDb.db.zk_attestations.filter(
        (a: any) => !a.nullifierHash?.includes('4025600235867036485360802166153740453869990869637003463687751906119857470602')
      );
      sovraDb.save();
    }
  });
  const fixturePath = path.resolve(__dirname, '../fixtures/semaphore_proof_depth16.json');
  const proofFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  const testDid = `did:sovra:zk_human_${Date.now()}`;
  const nullifier = proofFixture.nullifierHash;

  // Genuine Semaphore v3 public signals:
  // [merkleTreeRoot, nullifierHash, signalHash, externalNullifierHash]
  // In the fixture, signal was "12345", externalNullifier was "99999"
  const canonicalPublicSignals = [
    proofFixture.merkleTreeRoot,
    proofFixture.nullifierHash,
    '405095862423832484797768386705071309801502669987320414707879031139592615459',
    '178012053046980844241059625537333166504617586244663939317393720226215395849',
  ];

  const canonicalSnarkProof = {
    pi_a: [proofFixture.proof[0], proofFixture.proof[1], '1'],
    pi_b: [
      [proofFixture.proof[3], proofFixture.proof[2]],
      [proofFixture.proof[5], proofFixture.proof[4]],
      ['1', '0'],
    ],
    pi_c: [proofFixture.proof[6], proofFixture.proof[7], '1'],
    protocol: 'groth16',
    curve: 'bn128',
  };

  it('POST /api/zk/humanity/verify validates genuine Semaphore Groth16 proof and issues ZK-Human badge', async () => {
    const { req, res, getResponse } = createMockReqRes('POST', '/api/zk/humanity/verify', {
      subjectDid: testDid,
      nullifierHash: nullifier,
      publicSignals: canonicalPublicSignals,
      proof: canonicalSnarkProof,
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
    expect(json.isHuman).toBe(true);
  });

  it('POST /api/zk/humanity/verify rejects replayed nullifier with 409 conflict', async () => {
    const { req, res, getResponse } = createMockReqRes('POST', '/api/zk/humanity/verify', {
      subjectDid: `did:sovra:attacker_${Date.now()}`,
      nullifierHash: nullifier, // reused nullifier
      publicSignals: canonicalPublicSignals,
      proof: canonicalSnarkProof,
    });

    const handled = await handleZkRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(409);
    const json = resp.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/already used|already been spent/i);
  });

  it('SEC-01-B: POST /api/zk/humanity/verify strictly rejects client-supplied vKey override attempts', async () => {
    const { req, res, getResponse } = createMockReqRes('POST', '/api/zk/humanity/verify', {
      subjectDid: `did:sovra:attacker_vkey_${Date.now()}`,
      nullifierHash: `nul_fake_${Date.now()}`,
      publicSignals: canonicalPublicSignals,
      proof: canonicalSnarkProof,
      vKey: {
        protocol: 'groth16',
        curve: 'bn128',
        nPublic: 4,
        vk_alpha_1: ['1', '2'],
        vk_beta_2: [['1', '2'], ['3', '4']],
        vk_gamma_2: [['1', '2'], ['3', '4']],
        vk_delta_2: [['1', '2'], ['3', '4']],
        IC: [['1', '2'], ['3', '4'], ['5', '6'], ['7', '8'], ['9', '10']],
      },
    });

    const handled = await handleZkRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(400);
    const json = resp.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain('Client-supplied verification keys are strictly forbidden');
  });

  it('POST /api/zk/humanity/verify rejects tampered proof or mismatched public signals', async () => {
    const { req, res, getResponse } = createMockReqRes('POST', '/api/zk/humanity/verify', {
      subjectDid: `did:sovra:attacker_forgery_${Date.now()}`,
      nullifierHash: `nul_forged_${Date.now()}`,
      publicSignals: [
        canonicalPublicSignals[0],
        `nul_forged_${Date.now()}`, // does not match math
        canonicalPublicSignals[2],
        canonicalPublicSignals[3],
      ],
      proof: canonicalSnarkProof,
    });

    const handled = await handleZkRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(400);
    const json = resp.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain('Cryptographic ZK-SNARK proof verification failed');
  });

  it('SEC-01-B: Concurrent registration of identical nullifier ensures atomic single-winner execution', async () => {
    // Generate fresh test nullifier and simulate race conditions
    const raceNullifier = `nullifier_race_${Date.now()}`;
    const raceSignals = [
      canonicalPublicSignals[0],
      raceNullifier,
      canonicalPublicSignals[2],
      canonicalPublicSignals[3],
    ];

    // Fire 5 concurrent requests with identical nullifier
    const attempts = Array.from({ length: 5 }, async (_, i) => {
      // Mock db atomicity check
      const record = {
        id: `zk_race_${i}_${Date.now()}`,
        subjectDid: `did:sovra:race_user_${i}`,
        attestationType: 'proof_of_humanity',
        proofSnarkJson: JSON.stringify(canonicalSnarkProof),
        issuerDid: 'did:sovra:test',
        nullifierHash: raceNullifier,
        expiresAt: Date.now() + 100000,
        createdAt: Date.now(),
      };
      return sovraDb.registerZkAttestation(record);
    });

    const results = await Promise.all(attempts);
    const successful = results.filter(r => r.ok);
    const failed = results.filter(r => !r.ok);

    expect(successful.length).toBe(1);
    expect(failed.length).toBe(4);
    for (const f of failed) {
      expect(f.error).toMatch(/already used|duplicate/i);
    }
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
