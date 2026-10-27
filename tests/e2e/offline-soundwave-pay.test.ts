import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { handleOfflinePayRoutes } from '../../scripts/routes/offline-pay.routes.ts';
import { sovraDb } from '../../scripts/database-engine.ts';

function createMockReqRes(method: string, url: string, bodyObj?: any) {
  const req = new http.IncomingMessage(null as any);
  req.method = method;
  req.url = url;

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
  const senderDid = 'did:sovra:soundwave_sender';
  const recipientDid = 'did:sovra:soundwave_merchant';

  it('POST /api/wallet/offline/generate-voucher locks funds and returns ultrasonic frequencies and payloads', async () => {
    // Ensure sender has balance
    sovraDb.saveUser({
      did: senderDid,
      handle: 'sender_offline',
      name: 'Offline Sender',
      balance_sov: 100.0,
    } as any);

    const { req, res, getResponse } = createMockReqRes('POST', '/api/wallet/offline/generate-voucher', {
      senderDid,
      recipientDid,
      amountSov: 15.0,
      signature: 'sig_ed25519_offline_test_signature',
    });

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

  it('POST /api/wallet/offline/generate-voucher rejects when sender has insufficient funds', async () => {
    const { req, res, getResponse } = createMockReqRes('POST', '/api/wallet/offline/generate-voucher', {
      senderDid,
      recipientDid,
      amountSov: 9999.0, // Insufficient
    });

    const handled = await handleOfflinePayRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(400);
    expect(resp.json().error).toContain('Insufficient SOV balance');
  });

  it('POST /api/wallet/offline/claim-voucher redeems acoustic voucher and credits recipient wallet', async () => {
    // 1. Setup recipient
    sovraDb.saveUser({
      did: recipientDid,
      handle: 'merchant_offline',
      name: 'Offline Merchant',
      balance_sov: 20.0,
    } as any);

    // 2. Generate voucher
    const gen = createMockReqRes('POST', '/api/wallet/offline/generate-voucher', {
      senderDid,
      recipientDid,
      amountSov: 10.0,
      signature: 'sig_claim_test',
    });
    await handleOfflinePayRoutes(gen.req, gen.res);
    const voucherId = gen.getResponse().json().voucher.voucherId;

    // 3. Claim voucher
    const claim = createMockReqRes('POST', '/api/wallet/offline/claim-voucher', {
      voucherId,
      claimantDid: recipientDid,
    });
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
    const doubleClaim = createMockReqRes('POST', '/api/wallet/offline/claim-voucher', {
      voucherId,
      claimantDid: recipientDid,
    });
    await handleOfflinePayRoutes(doubleClaim.req, doubleClaim.res);
    expect(doubleClaim.getResponse().statusCode).toBe(400);
    expect(doubleClaim.getResponse().json().error).toContain('already been settled');
  });

  it('GET /api/wallet/offline/vouchers lists vouchers for user DID', async () => {
    const { req, res, getResponse } = createMockReqRes('GET', `/api/wallet/offline/vouchers?did=${senderDid}`);
    const handled = await handleOfflinePayRoutes(req, res);
    expect(handled).toBe(true);

    const json = getResponse().json();
    expect(json.ok).toBe(true);
    expect(json.vouchers.length).toBeGreaterThanOrEqual(1);
    expect(json.vouchers.every((v: any) => v.senderDid === senderDid || v.recipientDid === senderDid)).toBe(true);
  });
});
