import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { sovraDb } from '../../scripts/database-engine.ts';
import { handleAuthRoutes } from '../../scripts/routes/auth.routes.ts';
import { generateEd25519KeyPair, signEd25519, bytesToHex } from '../../packages/crypto/dist/index.js';

function createMockReqRes(method: string, url: string, bodyObj?: any, headers: Record<string, string> = {}) {
  const req = new http.IncomingMessage(null as any);
  req.method = method;
  req.url = url;
  req.headers = { ...headers };

  const res = new http.ServerResponse(req);
  let statusCode = 200;
  let resHeaders: Record<string, string> = {};
  let body = '';

  res.writeHead = (status: number, h?: any) => {
    statusCode = status;
    if (h) resHeaders = { ...resHeaders, ...h };
    return res;
  };

  res.end = (chunk?: any) => {
    if (chunk) body += chunk;
    return res;
  };

  return {
    req,
    res,
    getResponse: () => ({
      statusCode,
      headers: resHeaders,
      body,
      json: () => JSON.parse(body || '{}'),
    }),
  };
}

describe('Target B: Guardian Recovery Hardening & One-Time Token Invalidation', () => {
  const runId = Date.now().toString(36);
  const userKp = generateEd25519KeyPair();
  const userDid = `did:sovra:lostuser_${runId}`;

  // 3 Authorized Guardians with authentic Ed25519 keypairs
  const g1Kp = generateEd25519KeyPair();
  const g1Did = `did:sovra:g1_${runId}`;
  const g2Kp = generateEd25519KeyPair();
  const g2Did = `did:sovra:g2_${runId}`;
  const g3Kp = generateEd25519KeyPair();
  const g3Did = `did:sovra:g3_${runId}`;

  // Attacker and attacker-controlled fake guardian
  const attackerKp = generateEd25519KeyPair();
  const attackerDid = `did:sovra:attacker_${runId}`;
  const fakeGuardianDid = `did:sovra:fake_g_${runId}`;

  sovraDb.registerUser({
    did: userDid,
    handle: `@lostuser_${runId}`,
    displayName: 'Lost Phone User',
    publicKey: bytesToHex(userKp.publicKey),
  });

  sovraDb.registerUser({
    did: g1Did,
    handle: `@g1_${runId}`,
    displayName: 'Guardian One',
    publicKey: bytesToHex(g1Kp.publicKey),
  });

  sovraDb.registerUser({
    did: g2Did,
    handle: `@g2_${runId}`,
    displayName: 'Guardian Two',
    publicKey: bytesToHex(g2Kp.publicKey),
  });

  sovraDb.registerUser({
    did: g3Did,
    handle: `@g3_${runId}`,
    displayName: 'Guardian Three',
    publicKey: bytesToHex(g3Kp.publicKey),
  });

  sovraDb.registerUser({
    did: attackerDid,
    handle: `@attacker_${runId}`,
    displayName: 'Attacker Impersonator',
    publicKey: bytesToHex(attackerKp.publicKey),
  });

  it('B1: Registers authorized guardians and prevents attacker guardian substitution during initiation', async () => {
    // 1. User pre-registers authorized guardians
    const regMock = createMockReqRes('POST', '/api/auth/guardians/register', {
      guardians: [g1Did, g2Did, g3Did],
    });
    const regCtx = {
      req: regMock.req,
      res: regMock.res,
      url: new URL('http://localhost:3001/api/auth/guardians/register'),
      readBoundedBody: async () => ({ body: JSON.stringify({ guardians: [g1Did, g2Did, g3Did] }), ok: true }),
      resolvePrincipal: () => ({ did: userDid, handle: `@lostuser_${runId}`, role: 'USER' } as any),
      enforceAuth: () => ({ did: userDid, handle: `@lostuser_${runId}`, role: 'USER' } as any),
    };

    await handleAuthRoutes(regCtx as any);
    expect(regMock.getResponse().statusCode).toBe(200);

    // 2. Attacker attempts to initiate recovery for userDid by supplying their own fake guardian
    const spoofInitMock = createMockReqRes('POST', '/api/auth/recovery/initiate', {
      targetDid: userDid,
      guardians: [attackerDid, fakeGuardianDid],
    });
    const spoofCtx = {
      req: spoofInitMock.req,
      res: spoofInitMock.res,
      url: new URL('http://localhost:3001/api/auth/recovery/initiate'),
      readBoundedBody: async () => ({ body: JSON.stringify({ targetDid: userDid, guardians: [attackerDid, fakeGuardianDid] }), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };

    await handleAuthRoutes(spoofCtx as any);
    expect(spoofInitMock.getResponse().statusCode).toBe(403);
    expect(spoofInitMock.getResponse().json().error).toMatch(/Cannot substitute guardians/i);
  });

  it('B2: Rejects dummy/forged signatures and enforces cryptographic verification for registered guardians', async () => {
    // Initiate legitimate recovery
    const initMock = createMockReqRes('POST', '/api/auth/recovery/initiate', { targetDid: userDid });
    const initCtx = {
      req: initMock.req,
      res: initMock.res,
      url: new URL('http://localhost:3001/api/auth/recovery/initiate'),
      readBoundedBody: async () => ({ body: JSON.stringify({ targetDid: userDid }), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };
    await handleAuthRoutes(initCtx as any);
    const recoveryId = initMock.getResponse().json().recoveryId;

    // Attacker submits dummy signature 0xdeadbeef on behalf of g1Did -> Must reject 401
    const dummyApproveMock = createMockReqRes('POST', '/api/auth/recovery/approve', {
      recoveryId,
      guardianId: g1Did,
      signature: '0xdeadbeef',
    });
    const dummyCtx = {
      req: dummyApproveMock.req,
      res: dummyApproveMock.res,
      url: new URL('http://localhost:3001/api/auth/recovery/approve'),
      readBoundedBody: async () => ({ body: JSON.stringify({ recoveryId, guardianId: g1Did, signature: '0xdeadbeef' }), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };
    await handleAuthRoutes(dummyCtx as any);
    expect(dummyApproveMock.getResponse().statusCode).toBe(401);
    expect(dummyApproveMock.getResponse().json().error).toMatch(/Invalid guardian cryptographic signature/i);

    // Attacker submits signature forged with attacker's key -> Must reject 401
    const challenge = new TextEncoder().encode(`sovra:recovery:approve:${recoveryId}:${g1Did}:${userDid}`);
    const forgedSig = bytesToHex(signEd25519(attackerKp.privateKey, challenge));
    const forgedApproveMock = createMockReqRes('POST', '/api/auth/recovery/approve', {
      recoveryId,
      guardianId: g1Did,
      signature: forgedSig,
    });
    const forgedCtx = {
      req: forgedApproveMock.req,
      res: forgedApproveMock.res,
      url: new URL('http://localhost:3001/api/auth/recovery/approve'),
      readBoundedBody: async () => ({ body: JSON.stringify({ recoveryId, guardianId: g1Did, signature: forgedSig }), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };
    await handleAuthRoutes(forgedCtx as any);
    expect(forgedApproveMock.getResponse().statusCode).toBe(401);
    expect(forgedApproveMock.getResponse().json().error).toMatch(/Invalid guardian cryptographic signature/i);
  });

  it('B3: Enforces quorum threshold, issues restoreToken, and guarantees single-use one-time consumption', async () => {
    // Initiate legitimate recovery
    const initMock = createMockReqRes('POST', '/api/auth/recovery/initiate', { targetDid: userDid });
    const initCtx = {
      req: initMock.req,
      res: initMock.res,
      url: new URL('http://localhost:3001/api/auth/recovery/initiate'),
      readBoundedBody: async () => ({ body: JSON.stringify({ targetDid: userDid }), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };
    await handleAuthRoutes(initCtx as any);
    const recoveryId = initMock.getResponse().json().recoveryId;

    // Guardian 1 signs legitimate approval
    const challenge1 = new TextEncoder().encode(`sovra:recovery:approve:${recoveryId}:${g1Did}:${userDid}`);
    const legitSig1 = bytesToHex(signEd25519(g1Kp.privateKey, challenge1));
    const g1ApproveMock = createMockReqRes('POST', '/api/auth/recovery/approve', {
      recoveryId,
      guardianId: g1Did,
      signature: legitSig1,
    });
    const g1Ctx = {
      req: g1ApproveMock.req,
      res: g1ApproveMock.res,
      url: new URL('http://localhost:3001/api/auth/recovery/approve'),
      readBoundedBody: async () => ({ body: JSON.stringify({ recoveryId, guardianId: g1Did, signature: legitSig1 }), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };
    await handleAuthRoutes(g1Ctx as any);
    expect(g1ApproveMock.getResponse().statusCode).toBe(200);
    expect(g1ApproveMock.getResponse().json().currentApprovals).toBe(1);

    // Premature finalize attempt before quorum -> Must fail 400
    const prematureFinMock = createMockReqRes('POST', '/api/auth/recovery/finalize', { recoveryId });
    const prematureCtx = {
      req: prematureFinMock.req,
      res: prematureFinMock.res,
      url: new URL('http://localhost:3001/api/auth/recovery/finalize'),
      readBoundedBody: async () => ({ body: JSON.stringify({ recoveryId }), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };
    await handleAuthRoutes(prematureCtx as any);
    expect(prematureFinMock.getResponse().statusCode).toBe(400);
    expect(prematureFinMock.getResponse().json().error).toMatch(/Quorum threshold not met/i);

    // Guardian 2 signs legitimate approval
    const challenge2 = new TextEncoder().encode(`sovra:recovery:approve:${recoveryId}:${g2Did}:${userDid}`);
    const legitSig2 = bytesToHex(signEd25519(g2Kp.privateKey, challenge2));
    const g2ApproveMock = createMockReqRes('POST', '/api/auth/recovery/approve', {
      recoveryId,
      guardianId: g2Did,
      signature: legitSig2,
    });
    const g2Ctx = {
      req: g2ApproveMock.req,
      res: g2ApproveMock.res,
      url: new URL('http://localhost:3001/api/auth/recovery/approve'),
      readBoundedBody: async () => ({ body: JSON.stringify({ recoveryId, guardianId: g2Did, signature: legitSig2 }), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };
    await handleAuthRoutes(g2Ctx as any);
    expect(g2ApproveMock.getResponse().statusCode).toBe(200);
    expect(g2ApproveMock.getResponse().json().currentApprovals).toBe(2);
    expect(g2ApproveMock.getResponse().json().isThresholdMet).toBe(true);

    // Finalize recovery -> Returns restoreToken
    const finMock = createMockReqRes('POST', '/api/auth/recovery/finalize', { recoveryId });
    const finCtx = {
      req: finMock.req,
      res: finMock.res,
      url: new URL('http://localhost:3001/api/auth/recovery/finalize'),
      readBoundedBody: async () => ({ body: JSON.stringify({ recoveryId }), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };
    await handleAuthRoutes(finCtx as any);
    expect(finMock.getResponse().statusCode).toBe(200);
    const restoreToken = finMock.getResponse().json().restoreToken;
    expect(restoreToken).toMatch(/^sovra-restore-/);

    // Consume restoreToken with new key
    const newKp = generateEd25519KeyPair();
    const newPubHex = bytesToHex(newKp.publicKey);

    const consumeMock1 = createMockReqRes('POST', '/api/auth/recovery/consume', {
      restoreToken,
      newPublicKey: newPubHex,
    });
    const consumeCtx1 = {
      req: consumeMock1.req,
      res: consumeMock1.res,
      url: new URL('http://localhost:3001/api/auth/recovery/consume'),
      readBoundedBody: async () => ({ body: JSON.stringify({ restoreToken, newPublicKey: newPubHex }), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };
    await handleAuthRoutes(consumeCtx1 as any);
    expect(consumeMock1.getResponse().statusCode).toBe(200);
    expect(consumeMock1.getResponse().json().consumed).toBe(true);

    // User's public key should be updated in DB
    const userAfter = sovraDb.findUserByDid(userDid);
    expect(userAfter?.publicKey).toBe(newPubHex);

    // Replay consumption attempt with same restoreToken -> MUST return 409 Conflict
    const consumeMock2 = createMockReqRes('POST', '/api/auth/recovery/consume', {
      restoreToken,
      newPublicKey: newPubHex,
    });
    const consumeCtx2 = {
      req: consumeMock2.req,
      res: consumeMock2.res,
      url: new URL('http://localhost:3001/api/auth/recovery/consume'),
      readBoundedBody: async () => ({ body: JSON.stringify({ restoreToken, newPublicKey: newPubHex }), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };
    await handleAuthRoutes(consumeCtx2 as any);
    expect(consumeMock2.getResponse().statusCode).toBe(409);
    expect(consumeMock2.getResponse().json().error).toMatch(/Restore token has already been consumed/i);
  });
});
