import http from 'node:http';
import crypto from 'node:crypto';
import { sovraDb } from '../database-engine.ts';

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
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
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

export async function handleOfflinePayRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const url = req.url || '';
  const method = req.method || 'GET';

  if (!url.startsWith('/api/wallet/offline')) {
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

  // 1. POST /api/wallet/offline/generate-voucher - Generates cryptographic offline payment voucher
  if (method === 'POST' && url === '/api/wallet/offline/generate-voucher') {
    try {
      const body = await parseJsonBody(req);
      const senderDid = body.senderDid;
      const recipientDid = body.recipientDid || '*';
      const amountSov = Number(body.amountSov);
      const signature = body.signature || `sig_mock_${crypto.randomBytes(16).toString('hex')}`;

      if (!senderDid || isNaN(amountSov) || amountSov <= 0) {
        sendJson(res, 400, { ok: false, error: 'senderDid and valid amountSov are required' });
        return true;
      }

      const result = sovraDb.createOfflinePaymentVoucher({
        senderDid,
        recipientDid,
        amountSov,
        signature,
        expiresInSeconds: body.expiresInSeconds || 3600,
      });

      if (!result.ok) {
        sendJson(res, 400, result);
        return true;
      }

      sendJson(res, 201, {
        ok: true,
        voucher: result.voucher,
        audioFskFrequencies: [18500, 19200, 19900], // 18.5kHz, 19.2kHz, 19.9kHz ultrasonic carrier
        instructions: 'Hold device close to receiver; ultrasonic acoustic chirps or BLE advertisement will transfer voucher.',
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  // 2. POST /api/wallet/offline/claim-voucher - Redeem an acoustic or BLE voucher upon sync
  if (method === 'POST' && url === '/api/wallet/offline/claim-voucher') {
    try {
      const body = await parseJsonBody(req);
      const voucherId = body.voucherId;
      const claimantDid = body.claimantDid;

      if (!voucherId || !claimantDid) {
        sendJson(res, 400, { ok: false, error: 'voucherId and claimantDid are required' });
        return true;
      }

      const result = sovraDb.claimOfflinePaymentVoucher(voucherId, claimantDid);
      if (!result.ok) {
        sendJson(res, 400, result);
        return true;
      }

      sendJson(res, 200, {
        ok: true,
        amountSettled: result.amountSettled,
        voucher: result.voucher,
        message: `Successfully claimed ${result.amountSettled} SOV via offline settlement`,
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  // 3. GET /api/wallet/offline/vouchers - List offline vouchers
  if (method === 'GET' && (url === '/api/wallet/offline/vouchers' || url.startsWith('/api/wallet/offline/vouchers?'))) {
    const parsedUrl = new URL(url, 'http://localhost');
    const did = parsedUrl.searchParams.get('did') || undefined;
    const vouchers = sovraDb.getOfflinePaymentVouchers(did);
    sendJson(res, 200, {
      ok: true,
      count: vouchers.length,
      vouchers,
    });
    return true;
  }

  return false;
}
