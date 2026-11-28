import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { handleOfflinePayRoutes } from '../../scripts/routes/offline-pay.routes.ts';
import { sovraDb } from '../../scripts/database-engine.ts';
import { generateEd25519KeyPair, signEd25519, bytesToHex } from '../../packages/crypto/dist/index.js';

function createMockReqRes(method: string, url: string, bodyObj?: any, headers: Record<string, string> = {}) {
  const req = new http.IncomingMessage(null as any);
  req.method = method;
  req.url = url;
  req.headers = { ...headers };

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
      body,
      json: () => (body ? JSON.parse(body) : null),
    }),
  };
}

describe('Cycle 4: Offline Ultrasonic Sound-Wave & BLE Tap-to-Pay', () => {
  const senderKp = generateEd25519KeyPair();
  const recipientKp = generateEd25519KeyPair();
  const senderDid = 'did:sovra:soundwave_sender';
  const recipientDid = 'did:sovra:soundwave_merchant';
  const senderToken = 'stk_soundwave_sender_' + Date.now();
  const recipientToken = 'stk_soundwave_merchant_' + Date.now();

  it('POST /api/wallet/offline/generate-voucher locks funds and returns ultrasonic frequencies and payloads', async () => {
    // Ensure sender has registered publicKey, session token, and balance
    sovraDb.saveUser({
      did: senderDid,
      handle: 'sender_offline',
      name: 'Offline Sender',
      balance_sov: 100.0,
      balanceSov: 100.0,
      publicKey: bytesToHex(senderKp.publicKey),
      sessionToken: senderToken,
    } as any);

    const payload = `${senderDid}:${recipientDid}:15:n_gen_1`;
    const sigHex = bytesToHex(signEd25519(senderKp.privateKey, new TextEncoder().encode(payload)));

    const { req, res, getResponse } = createMockReqRes(
      'POST',
      '/api/wallet/offline/generate-voucher',
      {
        senderDid,
        recipientDid,
        amountSov: 15.0,
        nonce: 'n_gen_1',
        signature: sigHex,
      },
      { authorization: `Bearer ${senderToken}` },
    );

    const handled = await handleOfflinePayRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(201);
    const json = resp.json();
    expect(json.ok).toBe(true);
    expect(json.voucher.amountSov).toBe(15.0);
    expect(json.voucher.status).toBe('pending_sync');
    expect(json.audioFskFrequencies).toEqual([18500, 19200, 19900]);
    expect(json.voucher.audioFskPayload).toContain('SOV:V1:');
    expect(json.voucher.blePayload).toContain('SOV_BLE_');

    // Verify sender balance was decremented by 15.0
    const updatedSender = sovraDb.getUserByDid(senderDid);
    expect(updatedSender?.balance_sov).toBe(85.0);
  });

  it('POST /api/wallet/offline/generate-voucher rejects unauthenticated, forged-signature, and insufficient-balance requests', async () => {
    // 1. Unauthenticated request rejected with 401
    const unauth = createMockReqRes('POST', '/api/wallet/offline/generate-voucher', {
      senderDid,
      recipientDid,
      amountSov: 5.0,
      signature: 'sig_dummy_string',
    });
    await handleOfflinePayRoutes(unauth.req, unauth.res);
    expect(unauth.getResponse().statusCode).toBe(401);

    // 2. Forged non-Ed25519 dummy signature rejected with 401
    const forged = createMockReqRes(
      'POST',
      '/api/wallet/offline/generate-voucher',
      {
        senderDid,
        recipientDid,
        amountSov: 5.0,
        signature: 'sig_fake_forged_string',
      },
      { authorization: `Bearer ${senderToken}` },
    );
    await handleOfflinePayRoutes(forged.req, forged.res);
    expect(forged.getResponse().statusCode).toBe(401);

    // 3. Insufficient funds rejected with 400
    const insuf = createMockReqRes(
      'POST',
      '/api/wallet/offline/generate-voucher',
      {
        senderDid,
        recipientDid,
        amountSov: 9999.0, // Insufficient
      },
      { authorization: `Bearer ${senderToken}` },
    );
    await handleOfflinePayRoutes(insuf.req, insuf.res);
    expect(insuf.getResponse().statusCode).toBe(400);
    expect(insuf.getResponse().json().error).toContain('Insufficient SOV balance');
  });

  it('POST /api/wallet/offline/claim-voucher redeems acoustic voucher and credits recipient wallet', async () => {
    // 1. Setup recipient with valid session token
    sovraDb.saveUser({
      did: recipientDid,
      handle: 'merchant_offline',
      name: 'Offline Merchant',
      balance_sov: 20.0,
      balanceSov: 20.0,
      publicKey: bytesToHex(recipientKp.publicKey),
      sessionToken: recipientToken,
    } as any);

    // 2. Generate authenticated & Ed25519-signed voucher
    const claimPayload = `${senderDid}:${recipientDid}:10:n_claim_1`;
    const claimSigHex = bytesToHex(signEd25519(senderKp.privateKey, new TextEncoder().encode(claimPayload)));
    const gen = createMockReqRes(
      'POST',
      '/api/wallet/offline/generate-voucher',
      {
        senderDid,
        recipientDid,
        amountSov: 10.0,
        nonce: 'n_claim_1',
        signature: claimSigHex,
      },
      { authorization: `Bearer ${senderToken}` },
    );
    await handleOfflinePayRoutes(gen.req, gen.res);
    const voucherId = gen.getResponse().json().voucher.voucherId;

    // 3. Claim voucher as authenticated recipient
    const claim = createMockReqRes(
      'POST',
      '/api/wallet/offline/claim-voucher',
      {
        voucherId,
        claimantDid: recipientDid,
      },
      { authorization: `Bearer ${recipientToken}` },
    );
    const handled = await handleOfflinePayRoutes(claim.req, claim.res);
    expect(handled).toBe(true);

    const claimJson = claim.getResponse().json();
    expect(claimJson.ok).toBe(true);
    expect(claimJson.amountSettled).toBe(10.0);
    expect(claimJson.voucher.status).toBe('settled');

    // 4. Verify recipient balance incremented by 10.0
    const updatedRecipient = sovraDb.getUserByDid(recipientDid);
    expect(updatedRecipient?.balance_sov).toBe(30.0);

    // 5. Verify double-spend rejection
    const doubleClaim = createMockReqRes(
      'POST',
      '/api/wallet/offline/claim-voucher',
      {
        voucherId,
        claimantDid: recipientDid,
      },
      { authorization: `Bearer ${recipientToken}` },
    );
    await handleOfflinePayRoutes(doubleClaim.req, doubleClaim.res);
    expect(doubleClaim.getResponse().statusCode).toBe(400);
    expect(doubleClaim.getResponse().json().error).toContain('already been settled');
  });

  it('GET /api/wallet/offline/vouchers lists vouchers for user DID', async () => {
    const { req, res, getResponse } = createMockReqRes('GET', `/api/wallet/offline/vouchers?did=${senderDid}`, undefined, {
      authorization: `Bearer ${senderToken}`,
    });
    const handled = await handleOfflinePayRoutes(req, res);
    expect(handled).toBe(true);

    const json = getResponse().json();
    expect(json.ok).toBe(true);
    expect(json.vouchers.length).toBeGreaterThanOrEqual(1);
    expect(json.vouchers.every((v: any) => v.senderDid === senderDid || v.recipientDid === senderDid)).toBe(true);
  });
});
