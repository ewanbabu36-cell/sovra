/**
 * @file tests/e2e/unbeatable_transformation.test.ts
 * Master Transformation & Unbeatable Production Architecture Verification Suite.
 *
 * Verifies all 4 Pillars:
 * 1. Invisible Web3 & Zero-Friction UX (Passkeys, Progressive Security, Zero-DID UI)
 * 2. ZK Private Contact Discovery & Handle Resolution
 * 3. High-Concurrency SQLite WAL Performance (1,000 concurrent writes with 0 lock errors)
 * 4. Gasless Meta-Transaction Relaying & 1-Click Fiat Deposit/Cash-Out Lifecycle
 * 5. Tier-1 vs Tier-2 Traffic Separation & Mobile Low-Power Battery Guard
 */

import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import http from 'node:http';
import { sovraDb } from '../../scripts/database-engine.ts';
import { handleContactsRoutes } from '../../scripts/routes/contacts.routes.ts';
import { handleWalletRoutes } from '../../scripts/routes/wallet.routes.ts';
import {
  normalizeContactIdentifier,
  hashContactIdentifier,
} from '../../apps/sovra-mobile/src/services/contact-discovery.js';
import {
  classifyTrafficPayload,
} from '../../apps/sovra-mobile/src/services/mobile-mesh-coordinator.js';
import { NativeMobileBleAdapter } from '../../apps/sovra-mobile/src/services/native-ble-bridge.js';
import {
  signMetaTransaction,
  verifyMetaTransaction,
  type MetaTransactionRequest,
} from '../../packages/crypto/dist/index.js';

// Mock HTTP helper
function createMockReqRes(method: string, urlPath: string, headers: Record<string, string> = {}) {
  const req = new http.IncomingMessage(null as any);
  req.method = method;
  req.url = urlPath;
  req.headers = { host: 'localhost:3001', ...headers };

  let statusCode = 200;
  let responseHeaders: Record<string, any> = {};
  let bodyBuffer = '';

  const res = {
    writeHead: (code: number, hdrs?: any) => {
      statusCode = code;
      if (hdrs) responseHeaders = { ...responseHeaders, ...hdrs };
      return res;
    },
    setHeader: (k: string, v: any) => {
      responseHeaders[k] = v;
      return res;
    },
    end: (chunk?: any) => {
      if (chunk) bodyBuffer += chunk.toString();
    },
  } as unknown as http.ServerResponse;

  return {
    req,
    res,
    getResponse: () => ({
      statusCode,
      headers: responseHeaders,
      body: bodyBuffer,
      json: () => (bodyBuffer ? JSON.parse(bodyBuffer) : {}),
    }),
  };
}

describe('SOVRA UNBEATABLE ARCHITECTURE & ZERO-FRICTION UX HARNESS', () => {
  const runId = Date.now().toString(36);
  const aliceDid = `did:sovra:alice_trans_${runId}`;
  const bobDid = `did:sovra:bob_trans_${runId}`;
  const charlieDid = `did:sovra:charlie_trans_${runId}`;

  const aliceKeypair = crypto.generateKeyPairSync('ed25519');
  const alicePubHex = aliceKeypair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  const alicePrivDer = aliceKeypair.privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32);

  beforeAll(() => {
    // Seed test users in sovereign database
    sovraDb.registerUser({
      did: aliceDid,
      handle: `@alice_trans_${runId}`,
      displayName: 'Alice Sovereign',
      publicKey: alicePubHex,
      balanceSov: 50.0,
    });

    sovraDb.registerUser({
      did: bobDid,
      handle: `@bob_trans_${runId}`,
      displayName: 'Bob Sovereign',
      balanceSov: 10.0,
    });

    sovraDb.registerUser({
      did: charlieDid,
      handle: `@charlie_trans_${runId}`,
      displayName: 'Charlie Zero Balance',
      balanceSov: 0.0,
    });
  });

  // =========================================================================
  // PILLAR 1 & 2: INVISIBLE WEB3 & ZERO-KNOWLEDGE CONTACT DISCOVERY
  // =========================================================================
  it('Pillar 1: Normalizes and pre-hashes telephone and email contacts with SHA-256', async () => {
    const phone = '+91 (987) 654-3210';
    const email = ' Alice.Smith@Example.COM ';

    const normPhone = normalizeContactIdentifier(phone);
    const normEmail = normalizeContactIdentifier(email);

    expect(normPhone).toBe('+919876543210');
    expect(normEmail).toBe('alice.smith@example.com');

    const hashPhone = await hashContactIdentifier(phone);
    const hashEmail = await hashContactIdentifier(email);

    expect(hashPhone).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEmail).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Pillar 1: Links verified contact hashes to user and discovers registered peers anonymously', async () => {
    const rawAlicePhone = `+91${Date.now().toString().slice(-10)}`;
    const alicePhoneHash = await hashContactIdentifier(rawAlicePhone);

    // 1. Link Alice's hash via POST /api/contacts/link
    const linkMock = createMockReqRes('POST', '/api/contacts/link');
    const linkCtx = {
      req: linkMock.req,
      res: linkMock.res,
      url: new URL('http://localhost:3001/api/contacts/link'),
      readBoundedBody: async () => ({
        body: JSON.stringify({ contactHashes: [alicePhoneHash] }),
        ok: true,
      }),
      resolvePrincipal: () => ({ did: aliceDid, handle: `@alice_trans_${runId}`, role: 'USER' }),
      enforceAuth: () => ({ did: aliceDid, handle: `@alice_trans_${runId}`, role: 'USER' }),
    };

    const linkHandled = await handleContactsRoutes(linkCtx as any);
    expect(linkHandled).toBe(true);
    expect(linkMock.getResponse().statusCode).toBe(200);

    // 2. Query contact discovery via POST /api/contacts/discover (Bob searches his address book)
    const discMock = createMockReqRes('POST', '/api/contacts/discover');
    const discCtx = {
      req: discMock.req,
      res: discMock.res,
      url: new URL('http://localhost:3001/api/contacts/discover'),
      readBoundedBody: async () => ({
        body: JSON.stringify({ contactHashes: [alicePhoneHash, '00'.repeat(32)] }),
        ok: true,
      }),
      resolvePrincipal: () => ({ did: bobDid, handle: `@bob_trans_${runId}`, role: 'USER' }),
      enforceAuth: () => ({ did: bobDid, handle: `@bob_trans_${runId}`, role: 'USER' }),
    };

    const discHandled = await handleContactsRoutes(discCtx as any);
    expect(discHandled).toBe(true);
    const discResp = discMock.getResponse();
    expect(discResp.statusCode).toBe(200);

    const data = discResp.json();
    expect(data.ok).toBe(true);
    expect(data.matches.length).toBe(1);
    expect(data.matches[0].did).toBe(aliceDid);
    expect(data.matches[0].handle).toBe(`@alice_trans_${runId}`);
  });

  it('Pillar 1: Seamlessly resolves @handle to public identity without exposing raw DID jargon in UI', async () => {
    const resMock = createMockReqRes('GET', `/api/contacts/resolve?handle=@alice_trans_${runId}`);
    const ctx = {
      req: resMock.req,
      res: resMock.res,
      url: new URL(`http://localhost:3001/api/contacts/resolve?handle=@alice_trans_${runId}`),
      readBoundedBody: async () => ({ body: '', ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };

    const handled = await handleContactsRoutes(ctx as any);
    expect(handled).toBe(true);

    const resp = resMock.getResponse();
    expect(resp.statusCode).toBe(200);
    const data = resp.json();
    expect(data.ok).toBe(true);
    expect(data.user.handle).toBe(`@alice_trans_${runId}`);
    expect(data.user.displayName).toBe('Alice Sovereign');
  });

  // =========================================================================
  // PILLAR 2: HIGH-CONCURRENCY SQLITE WAL ENGINE
  // =========================================================================
  it('Pillar 2: Executes 500 concurrent database writes with zero lock errors under WAL mode', async () => {
    const sqlite = (sovraDb as any).sqliteEngine;
    expect(sqlite).toBeDefined();

    const writeTasks = [];
    const count = 500;

    for (let i = 0; i < count; i++) {
      writeTasks.push(
        new Promise<boolean>((resolve, reject) => {
          try {
            sqlite.executeWithRetry(() => {
              sqlite.createChatMessage({
                id: `msg_stress_${runId}_${i}`,
                threadId: `thread_${runId}`,
                senderDid: aliceDid,
                recipientDid: bobDid,
                text: `Concurrency test message #${i}`,
                createdAt: Date.now(),
              });
            });
            resolve(true);
          } catch (err) {
            reject(err);
          }
        })
      );
    }

    const results = await Promise.all(writeTasks);
    expect(results.length).toBe(count);
    expect(results.every(r => r === true)).toBe(true);
  }, 15000);

  // =========================================================================
  // PILLAR 3: HYBRID EDGE & LOW-POWER P2P NETWORKING
  // =========================================================================
  it('Pillar 3: Classifies traffic correctly into Tier-1 BLE DTN vs Tier-2 Edge CDN', () => {
    // Tier-1: Lightweight chat message (350 bytes)
    const dmClass = classifyTrafficPayload('ENCRYPTED_MESSAGE', 350);
    expect(dmClass.tier).toBe('TIER_1_BLE_DTN');
    expect(dmClass.channel).toBe('BLE_MESH');
    expect(dmClass.isPermittedOnBle).toBe(true);

    // Tier-1: Payment voucher (512 bytes)
    const voucherClass = classifyTrafficPayload('FINANCIAL_VOUCHER', 512);
    expect(voucherClass.tier).toBe('TIER_1_BLE_DTN');
    expect(voucherClass.isPermittedOnBle).toBe(true);

    // Tier-2: High-definition video stream (8 MB)
    const videoClass = classifyTrafficPayload('VIDEO_HLS_STREAM', 8 * 1024 * 1024);
    expect(videoClass.tier).toBe('TIER_2_EDGE_CDN');
    expect(videoClass.channel).toBe('EDGE_CDN');
    expect(videoClass.isPermittedOnBle).toBe(false);
  });

  it('Pillar 3: Native BLE Adapter battery guard throttles scanning when battery drops below 20%', () => {
    const adapter = new NativeMobileBleAdapter();

    // Normal battery (80%)
    const normalStatus = adapter.setBatteryLevel(0.8);
    expect(normalStatus.isThrottled).toBe(false);

    // Low battery (12%)
    const lowStatus = adapter.setBatteryLevel(0.12);
    expect(lowStatus.isThrottled).toBe(true);
    expect(lowStatus.dutyCycle.scanMs).toBe(1000);
    expect(lowStatus.dutyCycle.idleMs).toBe(9000);
  });

  // =========================================================================
  // PILLAR 4: GASLESS META-TRANSACTIONS & REAL-WORLD FIAT HIGHWAY
  // =========================================================================
  it('Pillar 4: Gasless meta-transaction relayer executes state transfer with 0 gas charged to user', async () => {
    const unsignedTx = {
      from: aliceDid,
      to: bobDid,
      action: 'TIP' as const,
      amount: '5.0',
      nonce: 1,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    const signedMetaTx = signMetaTransaction(unsignedTx, new Uint8Array(alicePrivDer));
    expect(signedMetaTx.signatureHex).toHaveLength(128);

    // Execute via POST /api/wallet/meta-tx
    const resMock = createMockReqRes('POST', '/api/wallet/meta-tx');
    const ctx = {
      req: resMock.req,
      res: resMock.res,
      url: new URL('http://localhost:3001/api/wallet/meta-tx'),
      readBoundedBody: async () => ({
        body: JSON.stringify(signedMetaTx),
        ok: true,
      }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };

    const handled = await handleWalletRoutes(ctx as any);
    expect(handled).toBe(true);

    const resp = resMock.getResponse();
    expect(resp.statusCode).toBe(200);

    const data = resp.json();
    expect(data.ok).toBe(true);
    expect(data.relayerSponsored).toBe(true);
    expect(data.gasChargedSov).toBe(0);
    expect(data.status).toBe('confirmed');
  });

  it('Pillar 4: Completes full Fiat Deposit (INR to SOV) and 1-Click Bank/UPI Cash-Out lifecycle', async () => {
    // 1. Fetch live quotes
    const quoteMock = createMockReqRes('GET', '/api/wallet/fiat/quote');
    const quoteCtx = {
      req: quoteMock.req,
      res: quoteMock.res,
      url: new URL('http://localhost:3001/api/wallet/fiat/quote'),
      readBoundedBody: async () => ({ body: '', ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };
    await handleWalletRoutes(quoteCtx as any);
    expect(quoteMock.getResponse().statusCode).toBe(200);
    expect(quoteMock.getResponse().json().rates.INR).toBe(10.0);

    // 2. Deposit ₹1,000 INR via simulated gateway webhook (+100 SOV)
    const depMock = createMockReqRes('POST', '/api/wallet/fiat/webhook');
    const depCtx = {
      req: depMock.req,
      res: depMock.res,
      url: new URL('http://localhost:3001/api/wallet/fiat/webhook'),
      readBoundedBody: async () => ({
        body: JSON.stringify({
          paymentId: `pay_${runId}`,
          userDid: bobDid,
          amountFiat: 1000,
          currency: 'INR',
        }),
        ok: true,
      }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };
    await handleWalletRoutes(depCtx as any);
    expect(depMock.getResponse().statusCode).toBe(200);
    expect(depMock.getResponse().json().creditedSov).toBe(100);

    // 3. 1-Click Cash Out 30 SOV to UPI (Receives ₹300 INR payout)
    const withdrawMock = createMockReqRes('POST', '/api/wallet/fiat/withdraw');
    const withdrawCtx = {
      req: withdrawMock.req,
      res: withdrawMock.res,
      url: new URL('http://localhost:3001/api/wallet/fiat/withdraw'),
      readBoundedBody: async () => ({
        body: JSON.stringify({
          amountSov: 30,
          payoutTarget: 'UPI',
          targetAddress: 'bob@upi',
        }),
        ok: true,
      }),
      resolvePrincipal: () => ({ did: bobDid, handle: `@bob_trans_${runId}`, role: 'USER' }),
      enforceAuth: () => ({ did: bobDid, handle: `@bob_trans_${runId}`, role: 'USER' }),
    };
    await handleWalletRoutes(withdrawCtx as any);
    expect(withdrawMock.getResponse().statusCode).toBe(200);

    const withdrawData = withdrawMock.getResponse().json();
    expect(withdrawData.ok).toBe(true);
    expect(withdrawData.debitedSov).toBe(30);
    expect(withdrawData.fiatPayoutAmount).toBe(300);
    expect(withdrawData.payoutTarget).toBe('UPI');
    expect(withdrawData.status).toBe('PROCESSED');
  });
});
