import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { sovraDb } from '../../scripts/database-engine.ts';
import { handleWalletRoutes } from '../../scripts/routes/wallet.routes.ts';
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

describe('Target A: Wallet Voucher Authorization Hardening', () => {
  const runId = Date.now().toString(36);
  const victimKp = generateEd25519KeyPair();
  const victimPubHex = bytesToHex(victimKp.publicKey);
  const victimDid = `did:sovra:victim_${runId}`;

  const attackerKp = generateEd25519KeyPair();
  const attackerPubHex = bytesToHex(attackerKp.publicKey);
  const attackerDid = `did:sovra:attacker_${runId}`;

  const legitimatePayeeKp = generateEd25519KeyPair();
  const legitimatePayeeDid = `did:sovra:payee_${runId}`;

  sovraDb.registerUser({
    did: victimDid,
    handle: `@victim_${runId}`,
    displayName: 'Victim User',
    balanceSov: 500.0,
    publicKey: victimPubHex,
  });

  sovraDb.registerUser({
    did: attackerDid,
    handle: `@attacker_${runId}`,
    displayName: 'Attacker User',
    balanceSov: 10.0,
    publicKey: attackerPubHex,
  });

  sovraDb.registerUser({
    did: legitimatePayeeDid,
    handle: `@payee_${runId}`,
    displayName: 'Legitimate Payee',
    balanceSov: 50.0,
    publicKey: bytesToHex(legitimatePayeeKp.publicKey),
  });

  it('A1: Rejects voucher with missing cryptographic signature (401)', async () => {
    const unsignedVoucher = {
      voucherId: `vch_unsigned_${runId}`,
      senderDid: victimDid,
      payeeDid: attackerDid,
      amount: 100.0,
      tokenSymbol: 'SOV',
      expiresAt: Date.now() + 3600000,
    };

    const resMock = createMockReqRes('POST', '/api/wallet/transfer');
    const ctx = {
      req: resMock.req,
      res: resMock.res,
      url: new URL('http://localhost:3001/api/wallet/transfer'),
      readBoundedBody: async () => ({ body: JSON.stringify({ voucher: unsignedVoucher }), ok: true }),
      resolvePrincipal: () => ({ did: attackerDid, handle: `@attacker_${runId}`, role: 'USER' } as any),
      enforceAuth: () => ({ did: attackerDid, handle: `@attacker_${runId}`, role: 'USER' } as any),
    };

    await handleWalletRoutes(ctx as any);
    const resp = resMock.getResponse();
    expect(resp.statusCode).toBe(401);
    expect(resp.json().error).toMatch(/Cryptographic signature is strictly required/i);
  });

  it('A2: Rejects voucher with forged cryptographic signature (401)', async () => {
    const forgedVoucher: any = {
      voucherId: `vch_forged_${runId}`,
      senderDid: victimDid,
      payeeDid: attackerDid,
      amount: 150.0,
      tokenSymbol: 'SOV',
      expiresAt: Date.now() + 3600000,
    };

    // Attacker signs voucher intended to debit victim with attacker's own private key
    const canonical = new TextEncoder().encode(JSON.stringify(forgedVoucher));
    forgedVoucher.signature = bytesToHex(signEd25519(attackerKp.privateKey, canonical));

    const resMock = createMockReqRes('POST', '/api/wallet/transfer');
    const ctx = {
      req: resMock.req,
      res: resMock.res,
      url: new URL('http://localhost:3001/api/wallet/transfer'),
      readBoundedBody: async () => ({ body: JSON.stringify({ voucher: forgedVoucher }), ok: true }),
      resolvePrincipal: () => ({ did: attackerDid, handle: `@attacker_${runId}`, role: 'USER' } as any),
      enforceAuth: () => ({ did: attackerDid, handle: `@attacker_${runId}`, role: 'USER' } as any),
    };

    await handleWalletRoutes(ctx as any);
    const resp = resMock.getResponse();
    expect(resp.statusCode).toBe(401);
    expect(resp.json().error).toMatch(/Invalid voucher cryptographic signature/i);

    // Victim balance must remain completely untouched
    const victim = sovraDb.findUserByDid(victimDid);
    expect(victim?.balanceSov).toBe(500.0);
  });

  it('A3: Rejects voucher redemption by unauthorized third-party claimant (403)', async () => {
    const legitimateVoucher: any = {
      voucherId: `vch_legit_${runId}`,
      senderDid: victimDid,
      payeeDid: legitimatePayeeDid,
      amount: 50.0,
      tokenSymbol: 'SOV',
      expiresAt: Date.now() + 3600000,
    };

    // Victim legitimately signs voucher for legitimatePayee
    const canonical = new TextEncoder().encode(JSON.stringify(legitimateVoucher));
    legitimateVoucher.signature = bytesToHex(signEd25519(victimKp.privateKey, canonical));

    // Attacker intercepts and attempts to claim the voucher intended for legitimatePayee
    const resMock = createMockReqRes('POST', '/api/wallet/transfer');
    const ctx = {
      req: resMock.req,
      res: resMock.res,
      url: new URL('http://localhost:3001/api/wallet/transfer'),
      readBoundedBody: async () => ({ body: JSON.stringify({ voucher: legitimateVoucher }), ok: true }),
      resolvePrincipal: () => ({ did: attackerDid, handle: `@attacker_${runId}`, role: 'USER' } as any),
      enforceAuth: () => ({ did: attackerDid, handle: `@attacker_${runId}`, role: 'USER' } as any),
    };

    await handleWalletRoutes(ctx as any);
    const resp = resMock.getResponse();
    expect(resp.statusCode).toBe(403);
    expect(resp.json().error).toMatch(/Cannot claim voucher on behalf of another/i);
  });

  it('A4: Successfully redeems legitimate voucher and strictly blocks replay double-spend (409)', async () => {
    const replayTestVoucher: any = {
      voucherId: `vch_replay_${runId}`,
      senderDid: victimDid,
      payeeDid: legitimatePayeeDid,
      amount: 25.0,
      tokenSymbol: 'SOV',
      expiresAt: Date.now() + 3600000,
    };

    const canonical = new TextEncoder().encode(JSON.stringify(replayTestVoucher));
    replayTestVoucher.signature = bytesToHex(signEd25519(victimKp.privateKey, canonical));

    // First claim: Should succeed
    const resMock1 = createMockReqRes('POST', '/api/wallet/transfer');
    const ctx1 = {
      req: resMock1.req,
      res: resMock1.res,
      url: new URL('http://localhost:3001/api/wallet/transfer'),
      readBoundedBody: async () => ({ body: JSON.stringify({ voucher: replayTestVoucher }), ok: true }),
      resolvePrincipal: () => ({ did: legitimatePayeeDid, handle: `@payee_${runId}`, role: 'USER' } as any),
      enforceAuth: () => ({ did: legitimatePayeeDid, handle: `@payee_${runId}`, role: 'USER' } as any),
    };

    await handleWalletRoutes(ctx1 as any);
    const resp1 = resMock1.getResponse();
    expect(resp1.statusCode).toBe(200);
    expect(resp1.json().ok).toBe(true);
    expect(resp1.json().amount).toBe(25.0);

    const victimAfter1 = sovraDb.findUserByDid(victimDid);
    const payeeAfter1 = sovraDb.findUserByDid(legitimatePayeeDid);
    expect(victimAfter1?.balanceSov).toBe(475.0);
    expect(payeeAfter1?.balanceSov).toBe(75.0);

    // Second claim: Replay attack with same voucherId -> MUST fail 409
    const resMock2 = createMockReqRes('POST', '/api/wallet/transfer');
    const ctx2 = {
      req: resMock2.req,
      res: resMock2.res,
      url: new URL('http://localhost:3001/api/wallet/transfer'),
      readBoundedBody: async () => ({ body: JSON.stringify({ voucher: replayTestVoucher }), ok: true }),
      resolvePrincipal: () => ({ did: legitimatePayeeDid, handle: `@payee_${runId}`, role: 'USER' } as any),
      enforceAuth: () => ({ did: legitimatePayeeDid, handle: `@payee_${runId}`, role: 'USER' } as any),
    };

    await handleWalletRoutes(ctx2 as any);
    const resp2 = resMock2.getResponse();
    expect(resp2.statusCode).toBe(409);
    expect(resp2.json().error).toMatch(/already been redeemed/i);

    // Balances must remain at post-first-claim state, no double-debit
    const victimAfter2 = sovraDb.findUserByDid(victimDid);
    const payeeAfter2 = sovraDb.findUserByDid(legitimatePayeeDid);
    expect(victimAfter2?.balanceSov).toBe(475.0);
    expect(payeeAfter2?.balanceSov).toBe(75.0);
  });
});
