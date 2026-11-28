import http from 'node:http';
import crypto from 'node:crypto';
import { sovraDb } from '../database-engine.ts';
import { verifyEd25519, hexToBytes } from '../../packages/crypto/dist/index.js';
import { decodeEd25519DidKey, isValidEd25519DidKey, type AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';
import { getVestingLockedForDid } from './economy.routes.ts';

export interface OfflinePayRouteContext {
  resolvePrincipal?: (req: http.IncomingMessage, bodyObj?: Record<string, any>) => AuthenticatedPrincipal | null;
  enforceAuth?: (req: http.IncomingMessage, res: http.ServerResponse, bodyObj?: Record<string, any>) => AuthenticatedPrincipal | null;
}

function resolveSenderPubKeyBytes(did: string, userRecord?: any, explicitPubKey?: string): Uint8Array | null {
  if (explicitPubKey) {
    try {
      const clean = String(explicitPubKey).replace(/^0x/, '');
      if (clean.length === 64) return hexToBytes(clean);
    } catch {}
  }
  if (typeof did === 'string' && did.startsWith('did:key:z')) {
    try {
      if (isValidEd25519DidKey(did)) return decodeEd25519DidKey(did);
    } catch {}
  }
  const storedKey = userRecord?.publicKey || userRecord?.publicKeyHex;
  if (storedKey) {
    try {
      const clean = String(storedKey).replace(/^0x/, '');
      if (clean.length === 64) return hexToBytes(clean);
      if (clean.startsWith('did:key:z') && isValidEd25519DidKey(clean)) {
        return decodeEd25519DidKey(clean);
      }
    } catch {}
  }
  return null;
}

function authenticateBearerPrincipal(req: http.IncomingMessage, ctx?: OfflinePayRouteContext): AuthenticatedPrincipal | null {
  if (ctx?.resolvePrincipal) {
    const p = ctx.resolvePrincipal(req);
    if (p && p.did) return p;
  }
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const user = sovraDb.findUserBySessionToken(token);
      if (user && user.did) {
        return {
          did: user.did,
          handle: user.handle,
          displayName: user.displayName,
          sessionId: token,
          role: (user as any).role || 'USER',
        } as unknown as AuthenticatedPrincipal;
      }
    }
  }
  return null;
}

function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sovra-DID, X-Sovra-Signature',
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req: http.IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    let received = 0;
    let aborted = false;
    req.on('data', chunk => {
      if (aborted) return;
      received += chunk.length;
      if (received > maxBytes) {
        aborted = true;
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', (err) => {
      if (!aborted) reject(err);
    });
  });
}

export async function handleOfflinePayRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx?: OfflinePayRouteContext,
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

  // 1. POST /api/wallet/offline/generate-voucher - Generates authenticated & Ed25519-signed offline voucher
  if (method === 'POST' && url === '/api/wallet/offline/generate-voucher') {
    try {
      const principal = ctx?.enforceAuth
        ? ctx.enforceAuth(req, res)
        : authenticateBearerPrincipal(req, ctx);
      if (!principal) {
        if (!ctx?.enforceAuth) {
          sendJson(res, 401, { ok: false, error: 'Unauthorized: Valid session authentication required to issue offline vouchers' });
        }
        return true;
      }

      const body = await parseJsonBody(req);
      const senderDid = String(body.senderDid || principal.did).trim();
      const recipientDid = String(body.recipientDid || '*').trim();
      const amountSov = Number(body.amountSov);
      const signature = String(body.signature || body.signatureHex || '').trim();
      const nonce = String(body.nonce || '').trim();

      if (senderDid !== principal.did) {
        sendJson(res, 403, { ok: false, error: 'Forbidden: senderDid must match authenticated principal.did' });
        return true;
      }

      if (!senderDid || isNaN(amountSov) || amountSov <= 0) {
        sendJson(res, 400, { ok: false, error: 'senderDid and valid amountSov are required' });
        return true;
      }

      const sender = (sovraDb as any).getUserByDid ? (sovraDb as any).getUserByDid(senderDid) : (sovraDb.db.users || []).find((u: any) => u.did === senderDid);
      const currentBal = Number(sender?.balance_sov ?? (sender as any)?.balanceSov ?? 0);
      const vestedLockedSov = getVestingLockedForDid(senderDid);
      const spendableBal = Math.max(0, currentBal - vestedLockedSov);
      if (sender && currentBal < amountSov) {
        sendJson(res, 400, { ok: false, error: 'Insufficient SOV balance for offline voucher' });
        return true;
      }
      if (sender && spendableBal < amountSov) {
        sendJson(res, 403, {
          ok: false,
          error: `Offline voucher blocked by vesting lock (locked: ${vestedLockedSov} SOV, spendable: ${spendableBal} SOV)`,
        });
        return true;
      }

      if (!signature) {
        sendJson(res, 401, { ok: false, error: 'Unauthorized: Genuine Ed25519 signature is strictly required to generate an offline voucher' });
        return true;
      }

      const cleanSig = signature.replace(/^0x/, '');
      const senderPub = resolveSenderPubKeyBytes(senderDid, sender, body.publicKey || body.signerPublicKey);
      let sigVerified = false;
      if (senderPub && /^[0-9a-fA-F]{128}$/.test(cleanSig)) {
        try {
          const sigBytes = hexToBytes(cleanSig);
          const { signature: _s1, signatureHex: _s2, publicKey: _pk, ...payloadNoSig } = body;
          const candidates = [
            `${senderDid}:${recipientDid}:${amountSov}:${nonce}`,
            `sovra:offline-voucher:v1:${senderDid}:${recipientDid}:${amountSov}`,
            JSON.stringify({ senderDid, recipientDid, amountSov, ...(nonce ? { nonce } : {}) }),
            JSON.stringify(payloadNoSig),
          ];
          for (const msg of candidates) {
            if (verifyEd25519(senderPub, new TextEncoder().encode(msg), sigBytes)) {
              sigVerified = true;
              break;
            }
          }
        } catch {}
      }
      if (!sigVerified) {
        sendJson(res, 401, { ok: false, error: 'Unauthorized: Invalid or unverified Ed25519 cryptographic voucher signature' });
        return true;
      }

      const result = sovraDb.createOfflinePaymentVoucher({
        senderDid,
        recipientDid,
        amountSov,
        signature: cleanSig,
        nonce: nonce || undefined,
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

  // 2. POST /api/wallet/offline/claim-voucher - Redeem an acoustic or BLE voucher upon authenticated sync
  if (method === 'POST' && url === '/api/wallet/offline/claim-voucher') {
    try {
      const body = await parseJsonBody(req);
      const voucherId = body.voucherId;
      const claimantDid = body.claimantDid;

      if (!voucherId || !claimantDid) {
        sendJson(res, 400, { ok: false, error: 'voucherId and claimantDid are required' });
        return true;
      }

      // Header spoofing check first (preserves explicit 403 Forbidden assertion on mismatch)
      const xDid = (req.headers?.['x-sovra-did'] || req.headers?.['did']) as string;
      if (xDid && xDid.trim() !== claimantDid) {
        sendJson(res, 403, { ok: false, error: 'Forbidden: Cannot claim voucher on behalf of another sovereign DID' });
        return true;
      }

      const principal = ctx?.enforceAuth
        ? ctx.enforceAuth(req, res)
        : authenticateBearerPrincipal(req, ctx);
      if (!principal) {
        if (!ctx?.enforceAuth) {
          sendJson(res, 401, { ok: false, error: 'Unauthorized: Valid session authentication required to claim offline vouchers' });
        }
        return true;
      }

      if (principal.did !== claimantDid) {
        sendJson(res, 403, { ok: false, error: 'Forbidden: Cannot claim voucher on behalf of another sovereign DID' });
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

  // 3. GET /api/wallet/offline/vouchers - List offline vouchers (Privacy & Anti-Frontrunning Gated)
  if (method === 'GET' && (url === '/api/wallet/offline/vouchers' || url.startsWith('/api/wallet/offline/vouchers?'))) {
    const parsedUrl = new URL(url, 'http://localhost');
    const did = parsedUrl.searchParams.get('did') || undefined;

    const authHeader = req.headers.authorization;
    const xDid = (req.headers['x-sovra-did'] || req.headers['did']) as string;
    let callerDid: string | null = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      const user = sovraDb.findUserBySessionToken(token);
      if (user) callerDid = user.did;
    } else if (xDid) {
      callerDid = xDid.trim();
    }

    if (callerDid && did && callerDid !== did && callerDid !== 'did:sovra:admin') {
      sendJson(res, 403, { ok: false, error: 'Forbidden: Cannot view offline vouchers for another identity' });
      return true;
    }

    const effectiveDid = did || callerDid;
    const vouchers = sovraDb.getOfflinePaymentVouchers(effectiveDid);
    sendJson(res, 200, {
      ok: true,
      count: vouchers.length,
      vouchers,
    });
    return true;
  }

  return false;
}
