import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dispatchApiRequest } from '../src/routes/index.js';
import { authController } from '../src/controllers/auth.controller.js';
import { clearReplayNonceCache } from '../src/middleware/auth.middleware.js';

// Base58-BTC alphabet
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function encodeBase58(bytes: Uint8Array): string {
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    for (let j = 0; j < digits.length; j++) {
      digits[j] = (digits[j] ?? 0) << 8;
    }
    digits[0] = (digits[0] ?? 0) + (bytes[i] ?? 0);
    let carry = 0;
    for (let j = 0; j < digits.length; j++) {
      digits[j] = (digits[j] ?? 0) + carry;
      carry = Math.floor((digits[j] ?? 0) / 58);
      digits[j] = (digits[j] ?? 0) % 58;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let leadingZeros = 0;
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    leadingZeros++;
  }
  return '1'.repeat(leadingZeros) + digits.reverse().map(d => B58_ALPHABET[d]).join('');
}

function createMockReqRes(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: any;
}) {
  const method = options.method || 'GET';
  const url = options.url || '/';
  const headers = options.headers || {};
  const bodyStr = options.body !== undefined
    ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body))
    : '';

  const req = new EventEmitter() as unknown as IncomingMessage;
  req.method = method;
  req.url = url;
  (req as any).socket = { remoteAddress: '127.0.0.1' };
  req.headers = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );

  let statusCode = 200;
  let responseHeaders: Record<string, string> = {};
  let responseBody = '';

  const res = {
    writeHead(code: number, headers?: Record<string, string>) {
      statusCode = code;
      if (headers) responseHeaders = { ...responseHeaders, ...headers };
      return this;
    },
    setHeader(key: string, value: string) {
      responseHeaders[key.toLowerCase()] = value;
      return this;
    },
    end(data?: any) {
      if (data) responseBody += data;
      this.emit('finish');
      return this;
    },
    on(event: string, handler: () => void) {
      if (event === 'finish') this.finishHandler = handler;
      return this;
    },
    emit(event: string) {
      if (event === 'finish' && this.finishHandler) this.finishHandler();
    },
    finishHandler: null as any,
  } as unknown as ServerResponse & { getStatusCode: () => number; getBody: () => any };

  (res as any).getStatusCode = () => statusCode;
  (res as any).getBody = () => {
    try {
      return JSON.parse(responseBody);
    } catch {
      return responseBody;
    }
  };

  // Push body chunks into req asynchronously
  process.nextTick(() => {
    if (bodyStr) {
      req.emit('data', Buffer.from(bodyStr));
    }
    req.emit('end');
  });

  return { req, res: res as ServerResponse & { getStatusCode: () => number; getBody: () => any } };
}

describe('services/api Security Middleware & Controller Hardening (BLK-06)', () => {
  beforeEach(() => {
    clearReplayNonceCache();
  });

  it('rejects unauthenticated requests to /api/wallet/balance with HTTP 401', async () => {
    const { req, res } = createMockReqRes({
      method: 'GET',
      url: '/api/wallet/balance',
    });

    const handled = await dispatchApiRequest(req, res, '/api/wallet/balance');
    expect(handled).toBe(true);
    expect(res.getStatusCode()).toBe(401);
    expect(res.getBody().ok).toBe(false);
    expect(res.getBody().error).toMatch(/Unauthorized/i);
  });

  it('rejects DID spoofing attack via forged X-Sovra-DID header without valid signature with HTTP 401', async () => {
    const { req, res } = createMockReqRes({
      method: 'GET',
      url: '/api/wallet/balance',
      headers: {
        'x-sovra-did': 'did:sovra:victim_user_99999',
      },
    });

    const handled = await dispatchApiRequest(req, res, '/api/wallet/balance');
    expect(handled).toBe(true);
    expect(res.getStatusCode()).toBe(401);
    expect(res.getBody().ok).toBe(false);
  });

  it('rejects unauthenticated transfer attempts with HTTP 401', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      url: '/api/wallet/transfer',
      headers: {
        'content-type': 'application/json',
      },
      body: {
        recipientDid: 'did:sovra:recipient',
        amount: 50,
      },
    });

    const handled = await dispatchApiRequest(req, res, '/api/wallet/transfer');
    expect(handled).toBe(true);
    expect(res.getStatusCode()).toBe(401);
    expect(res.getBody().ok).toBe(false);
  });

  it('authorizes requests with a valid Bearer session token', async () => {
    // 1. Register a user via public auth endpoint
    const regReqRes = createMockReqRes({
      method: 'POST',
      url: '/api/auth/register',
      headers: { 'content-type': 'application/json' },
      body: { handle: 'alice_citizen', displayName: 'Alice' },
    });
    await dispatchApiRequest(regReqRes.req, regReqRes.res, '/api/auth/register');
    expect(regReqRes.res.getStatusCode()).toBe(201);
    const regData = regReqRes.res.getBody();
    expect(regData.ok).toBe(true);
    const token = regData.token;
    const aliceDid = regData.user.did;

    // 2. Query wallet balance with Bearer token
    const balReqRes = createMockReqRes({
      method: 'GET',
      url: '/api/wallet/balance',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    await dispatchApiRequest(balReqRes.req, balReqRes.res, '/api/wallet/balance');
    expect(balReqRes.res.getStatusCode()).toBe(200);
    const balData = balReqRes.res.getBody();
    expect(balData.ok).toBe(true);
    expect(balData.balance).toBe(500.0);

    // 3. Create a post with Bearer token
    const postReqRes = createMockReqRes({
      method: 'POST',
      url: '/api/posts',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: {
        content: 'Hello Sovereign World from Alice!',
      },
    });
    await dispatchApiRequest(postReqRes.req, postReqRes.res, '/api/posts');
    expect(postReqRes.res.getStatusCode()).toBe(201);
    const postData = postReqRes.res.getBody();
    expect(postData.ok).toBe(true);
    expect(postData.post.authorDid).toBe(aliceDid);
  });

  it('rejects BOLA/IDOR attempt when authenticated caller attempts to post under another DID', async () => {
    // Register Alice
    const regReqRes = createMockReqRes({
      method: 'POST',
      url: '/api/auth/register',
      headers: { 'content-type': 'application/json' },
      body: { handle: 'alice_bola', displayName: 'Alice' },
    });
    await dispatchApiRequest(regReqRes.req, regReqRes.res, '/api/auth/register');
    const token = regReqRes.res.getBody().token;

    // Alice attempts to forge authorDid as Bob
    const postReqRes = createMockReqRes({
      method: 'POST',
      url: '/api/posts',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: {
        content: 'Forged post claiming to be Bob',
        authorDid: 'did:sovra:bob_victim_target',
      },
    });
    await dispatchApiRequest(postReqRes.req, postReqRes.res, '/api/posts');
    expect(postReqRes.res.getStatusCode()).toBe(403);
    expect(postReqRes.res.getBody().ok).toBe(false);
    expect(postReqRes.res.getBody().error).toMatch(/Author DID mismatch/i);
  });

  it('authorizes requests with valid cryptographic Ed25519 request signature (SOVRA-REQ-V2)', async () => {
    // Generate Ed25519 keypair
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const rawPub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12);

    // Encode to W3C did:key:z...
    const prefixed = new Uint8Array(34);
    prefixed[0] = 0xed;
    prefixed[1] = 0x01;
    prefixed.set(rawPub, 2);
    const didKey = `did:key:z${encodeBase58(prefixed)}`;

    const method = 'POST';
    const pathname = '/api/wallet/transfer';
    const query = '';
    const bodyObj = {
      recipientDid: 'did:sovra:carol_test',
      amount: 25,
    };
    const bodyStr = JSON.stringify(bodyObj);
    const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');

    const nonce = 'nonce_' + crypto.randomBytes(8).toString('hex');
    const ts = String(Date.now());

    const canonicalString = `SOVRA-REQ-V2\n${method}\n${pathname}\n${query}\n${bodyHash}\n${didKey}\n${nonce}\n${ts}`;
    const sigBytes = crypto.sign(null, Buffer.from(canonicalString, 'utf8'), privateKey);
    const sigHex = sigBytes.toString('hex');

    const { req, res } = createMockReqRes({
      method,
      url: pathname,
      headers: {
        'content-type': 'application/json',
        'x-sovra-did': didKey,
        'x-sovra-signature': sigHex,
        'x-sovra-nonce': nonce,
        'x-sovra-timestamp': ts,
      },
      body: bodyObj,
    });

    const handled = await dispatchApiRequest(req, res, pathname);
    expect(handled).toBe(true);
    expect(res.getStatusCode()).toBe(200);
    const data = res.getBody();
    expect(data.ok).toBe(true);
    expect(data.transaction.senderDid).toBe(didKey);
    expect(data.transaction.amount).toBe(25);
  });

  it('rejects tampered request payload when Ed25519 signature does not match body hash', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const rawPub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12);
    const prefixed = new Uint8Array(34);
    prefixed[0] = 0xed;
    prefixed[1] = 0x01;
    prefixed.set(rawPub, 2);
    const didKey = `did:key:z${encodeBase58(prefixed)}`;

    const method = 'POST';
    const pathname = '/api/wallet/transfer';
    const query = '';
    const originalBody = { recipientDid: 'did:sovra:bob', amount: 10 };
    const bodyHash = crypto.createHash('sha256').update(JSON.stringify(originalBody)).digest('hex');

    const nonce = 'nonce_' + crypto.randomBytes(8).toString('hex');
    const ts = String(Date.now());
    const canonicalString = `SOVRA-REQ-V2\n${method}\n${pathname}\n${query}\n${bodyHash}\n${didKey}\n${nonce}\n${ts}`;
    const sigHex = crypto.sign(null, Buffer.from(canonicalString, 'utf8'), privateKey).toString('hex');

    // Adversary tampers with amount (modifies 10 to 1000)
    const tamperedBody = { recipientDid: 'did:sovra:bob', amount: 1000 };

    const { req, res } = createMockReqRes({
      method,
      url: pathname,
      headers: {
        'content-type': 'application/json',
        'x-sovra-did': didKey,
        'x-sovra-signature': sigHex,
        'x-sovra-nonce': nonce,
        'x-sovra-timestamp': ts,
      },
      body: tamperedBody,
    });

    await dispatchApiRequest(req, res, pathname);
    expect(res.getStatusCode()).toBe(401);
    expect(res.getBody().ok).toBe(false);
  });

  it('rejects replayed nonce under the same DID with HTTP 401', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const rawPub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12);
    const prefixed = new Uint8Array(34);
    prefixed[0] = 0xed;
    prefixed[1] = 0x01;
    prefixed.set(rawPub, 2);
    const didKey = `did:key:z${encodeBase58(prefixed)}`;

    const method = 'POST';
    const pathname = '/api/wallet/transfer';
    const bodyObj = { recipientDid: 'did:sovra:carol_replay', amount: 5 };
    const bodyStr = JSON.stringify(bodyObj);
    const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');

    const nonce = 'replay_attack_nonce_123';
    const ts = String(Date.now());
    const canonicalString = `SOVRA-REQ-V2\n${method}\n${pathname}\n\n${bodyHash}\n${didKey}\n${nonce}\n${ts}`;
    const sigHex = crypto.sign(null, Buffer.from(canonicalString, 'utf8'), privateKey).toString('hex');

    // First request: succeeds
    const req1 = createMockReqRes({
      method,
      url: pathname,
      headers: {
        'content-type': 'application/json',
        'x-sovra-did': didKey,
        'x-sovra-signature': sigHex,
        'x-sovra-nonce': nonce,
        'x-sovra-timestamp': ts,
      },
      body: bodyObj,
    });
    await dispatchApiRequest(req1.req, req1.res, pathname);
    expect(req1.res.getStatusCode()).toBe(200);

    // Second request (replayed identical signature & nonce): MUST BE REJECTED
    const req2 = createMockReqRes({
      method,
      url: pathname,
      headers: {
        'content-type': 'application/json',
        'x-sovra-did': didKey,
        'x-sovra-signature': sigHex,
        'x-sovra-nonce': nonce,
        'x-sovra-timestamp': ts,
      },
      body: bodyObj,
    });
    await dispatchApiRequest(req2.req, req2.res, pathname);
    expect(req2.res.getStatusCode()).toBe(401);
  });

  it('rejects requests with timestamp skew > 5 minutes', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const rawPub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12);
    const prefixed = new Uint8Array(34);
    prefixed[0] = 0xed;
    prefixed[1] = 0x01;
    prefixed.set(rawPub, 2);
    const didKey = `did:key:z${encodeBase58(prefixed)}`;

    const method = 'POST';
    const pathname = '/api/wallet/transfer';
    const bodyObj = { recipientDid: 'did:sovra:carol_expired', amount: 5 };
    const bodyHash = crypto.createHash('sha256').update(JSON.stringify(bodyObj)).digest('hex');

    const nonce = 'nonce_expired_' + Date.now();
    // 10 minutes in the past
    const ts = String(Date.now() - 600_000);
    const canonicalString = `SOVRA-REQ-V2\n${method}\n${pathname}\n\n${bodyHash}\n${didKey}\n${nonce}\n${ts}`;
    const sigHex = crypto.sign(null, Buffer.from(canonicalString, 'utf8'), privateKey).toString('hex');

    const { req, res } = createMockReqRes({
      method,
      url: pathname,
      headers: {
        'content-type': 'application/json',
        'x-sovra-did': didKey,
        'x-sovra-signature': sigHex,
        'x-sovra-nonce': nonce,
        'x-sovra-timestamp': ts,
      },
      body: bodyObj,
    });

    await dispatchApiRequest(req, res, pathname);
    expect(res.getStatusCode()).toBe(401);
  });

  it('allows public read endpoints to execute anonymously', async () => {
    const statusReq = createMockReqRes({ method: 'GET', url: '/api/status' });
    await dispatchApiRequest(statusReq.req, statusReq.res, '/api/status');
    expect(statusReq.res.getStatusCode()).toBe(200);
    expect(statusReq.res.getBody().ok).toBe(true);

    const feedReq = createMockReqRes({ method: 'GET', url: '/api/posts' });
    await dispatchApiRequest(feedReq.req, feedReq.res, '/api/posts');
    expect(feedReq.res.getStatusCode()).toBe(200);
    expect(feedReq.res.getBody().ok).toBe(true);
  });

  it('enforces strict production Content-Security-Policy without unsafe-eval & exposes Redis health', async () => {
    const { SecurityMiddleware } = await import('../src/middleware/security.middleware.js');
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const mw = new SecurityMiddleware();
      const hdrs: Record<string, string> = {};
      const fakeReq = { headers: {}, socket: { remoteAddress: '127.0.0.1' } } as any;
      const fakeRes = { setHeader: (k: string, v: string) => { hdrs[k.toLowerCase()] = v; } } as any;
      mw.applySecurityHeaders(fakeReq, fakeRes);
      const csp = hdrs['content-security-policy'] || '';
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toContain('unsafe-eval');
      const health = await mw['sharedStore'].healthCheck();
      expect(health.ok).toBe(true);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});
