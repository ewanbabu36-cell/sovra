import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { handleEnterpriseProtocolRoutes } from '../../scripts/routes/enterprise-protocol.routes.ts';
import { sovraDb } from '../../scripts/database-engine.ts';
import { EventEmitter } from 'node:events';

function createMockReqRes(method: string, url: string, body?: any) {
  const req = new EventEmitter() as any;
  req.method = method;
  req.url = url;
  req.headers = { 'content-type': 'application/json' };

  let statusCode = 200;
  let responseData = '';
  const headers: Record<string, string> = {};

  const res = {
    writeHead(code: number, hdrs?: Record<string, string>) {
      statusCode = code;
      if (hdrs) Object.assign(headers, hdrs);
      return res;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(data?: string) {
      if (data) responseData += data;
      res.emit?.('finish');
    },
  } as any;

  process.nextTick(() => {
    if (body) {
      req.emit('data', Buffer.from(JSON.stringify(body)));
    }
    req.emit('end');
  });

  return {
    req,
    res,
    getResponse: () => ({
      statusCode,
      headers,
      body: responseData,
      json: () => JSON.parse(responseData || '{}'),
    }),
  };
}

describe('Target Multi-Chain Non-Custodial Liquidity Settlement Bridge', () => {
  const recipientDid = `did:sovra:creator_lightning_${Date.now()}`;

  beforeAll(() => {
    try {
      sovraDb.registerUser({
        did: recipientDid,
        handle: `creator_lightning_${Date.now()}`,
        displayName: 'Creator Lightning',
        balanceSov: 100.0,
      });
    } catch (_) {}
  });

  // 1. Bitcoin Lightning BOLT-11
  describe('Bitcoin Lightning BOLT-11 Invoices and Preimage Settlement', () => {
    let generatedInvoice = '';
    let generatedPaymentHash = '';
    let generatedPreimage = '';

    it('generates genuine BOLT-11 invoice with cryptographically bound payment hash', async () => {
      const { req, res, getResponse } = createMockReqRes('POST', '/api/bridge/lightning/generate-invoice', {
        amountSats: 25000,
        recipientDid,
        memo: 'Creator VIP Subscription',
      });

      const handled = await handleEnterpriseProtocolRoutes(req, res);
      expect(handled).toBe(true);

      const resp = getResponse();
      expect(resp.statusCode).toBe(200);
      const json = resp.json();
      expect(json.ok).toBe(true);
      expect(json.protocol).toBe('BOLT-11');
      expect(json.invoice).toMatch(/^lnbc25000u/);
      expect(json.paymentHash).toHaveLength(64);
      expect(json.preimage).toHaveLength(64);
      expect(json.sovEquiv).toBe(25); // 25000 / 1000 = 25 SOV
      expect(json.state).toBe('PENDING_RELAY');

      // Verify SHA-256 cryptographic relation: sha256(preimage) === paymentHash
      const computedHash = crypto
        .createHash('sha256')
        .update(Buffer.from(json.preimage, 'hex'))
        .digest('hex');
      expect(computedHash).toBe(json.paymentHash);

      generatedInvoice = json.invoice;
      generatedPaymentHash = json.paymentHash;
      generatedPreimage = json.preimage;
    });

    it('settles Lightning payment upon valid preimage revelation (PENDING_RELAY -> COMPLETED)', async () => {
      const userBefore = sovraDb.findUserByDid(recipientDid);
      const initialBalance = userBefore ? Number(userBefore.balanceSov || 0) : 100.0;

      const { req, res, getResponse } = createMockReqRes('POST', '/api/bridge/lightning/verify-payment', {
        paymentHash: generatedPaymentHash,
        preimage: generatedPreimage,
      });

      const handled = await handleEnterpriseProtocolRoutes(req, res);
      expect(handled).toBe(true);

      const resp = getResponse();
      expect(resp.statusCode).toBe(200);
      const json = resp.json();
      expect(json.ok).toBe(true);
      expect(json.settled).toBe(true);
      expect(json.state).toBe('COMPLETED');
      expect(json.preimageVerified).toBe(true);
      expect(json.amountSats).toBe(25000);
      expect(json.sovCredited).toBe(25);

      // Recipient balance should be credited by 25 SOV
      const userAfter = sovraDb.findUserByDid(recipientDid);
      const newBalance = userAfter ? Number(userAfter.balanceSov || 0) : 0;
      expect(newBalance).toBe(initialBalance + 25);
    });

    it('strictly rejects invalid / forged preimage with state REVERTED (Fail-Closed)', async () => {
      const forgedPreimage = crypto.randomBytes(32).toString('hex');
      const { req, res, getResponse } = createMockReqRes('POST', '/api/bridge/lightning/verify-payment', {
        paymentHash: generatedPaymentHash,
        preimage: forgedPreimage,
      });

      const handled = await handleEnterpriseProtocolRoutes(req, res);
      expect(handled).toBe(true);

      const resp = getResponse();
      expect(resp.statusCode).toBe(400);
      const json = resp.json();
      expect(json.ok).toBe(false);
      expect(json.state).toBe('REVERTED');
      expect(json.error).toContain('Cryptographic preimage verification failed');
    });

    it('rejects non-positive amountSats on invoice generation', async () => {
      const { req, res, getResponse } = createMockReqRes('POST', '/api/bridge/lightning/generate-invoice', {
        amountSats: 0,
        recipientDid,
      });

      const handled = await handleEnterpriseProtocolRoutes(req, res);
      expect(handled).toBe(true);

      const resp = getResponse();
      expect(resp.statusCode).toBe(400);
      expect(resp.json().ok).toBe(false);
    });
  });

  // 2. Base L2 USDC Settlement
  describe('Base L2 USDC Non-Custodial Meta-Transaction Settlement', () => {
    it('settles SOV earnings into Base L2 USDC with strict state machine', async () => {
      const targetAddress = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
      const { req, res, getResponse } = createMockReqRes('POST', '/api/bridge/evm/settle', {
        creatorDid: recipientDid,
        targetAddress,
        network: 'base',
        token: 'USDC',
        amountSov: 50.0,
      });

      const handled = await handleEnterpriseProtocolRoutes(req, res);
      expect(handled).toBe(true);

      const resp = getResponse();
      expect(resp.statusCode).toBe(200);
      const json = resp.json();
      expect(json.ok).toBe(true);
      expect(json.chainId).toBe(8453);
      expect(json.network).toBe('base');
      expect(json.settledUsdc).toBe(50.0);
      expect(json.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(json.targetAddress).toBe(targetAddress);
      expect(json.state).toBe('COMPLETED');
      expect(json.settlementStatus).toBe('COMMITTED_L2');
    });

    it('rejects malformed EVM addresses (Fail-Closed Non-Custodial Binding)', async () => {
      const { req, res, getResponse } = createMockReqRes('POST', '/api/bridge/evm/settle', {
        creatorDid: recipientDid,
        targetAddress: '0xinvalid_address_not_hex',
        network: 'base',
        token: 'USDC',
        amountSov: 50.0,
      });

      const handled = await handleEnterpriseProtocolRoutes(req, res);
      expect(handled).toBe(true);

      const resp = getResponse();
      expect(resp.statusCode).toBe(400);
      expect(resp.json().error).toContain('Invalid EVM targetAddress format');
    });

    it('rejects non-positive amountSov on EVM settlement', async () => {
      const { req, res, getResponse } = createMockReqRes('POST', '/api/bridge/evm/settle', {
        creatorDid: recipientDid,
        targetAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
        amountSov: -10.0,
      });

      const handled = await handleEnterpriseProtocolRoutes(req, res);
      expect(handled).toBe(true);

      const resp = getResponse();
      expect(resp.statusCode).toBe(400);
      expect(resp.json().error).toContain('amountSov must be greater than zero');
    });
  });

  // 3. Solana SPL Liquidity & Micro-Swaps
  describe('Solana SPL Micro-Liquidity Quote and Settlement', () => {
    const validSolanaAddress = 'SovraSol99999999999999999999999999999999999';
    let generatedQuoteId = '';

    it('generates real-time micro-liquidity swap quote for Solana SPL', async () => {
      const { req, res, getResponse } = createMockReqRes('POST', '/api/bridge/solana/quote', {
        creatorDid: recipientDid,
        solanaAddress: validSolanaAddress,
        amountSov: 40.0,
      });

      const handled = await handleEnterpriseProtocolRoutes(req, res);
      expect(handled).toBe(true);

      const resp = getResponse();
      expect(resp.statusCode).toBe(200);
      const json = resp.json();
      expect(json.ok).toBe(true);
      expect(json.quoteId).toMatch(/^sol_quote_/);
      expect(json.rate).toBe(0.05);
      expect(json.solAmount).toBe(2.0); // 40 * 0.05 = 2.0 SOL
      expect(json.lamports).toBe(2000000000);
      expect(json.state).toBe('PENDING_RELAY');

      generatedQuoteId = json.quoteId;
    });

    it('settles Solana SPL micro-liquidity swap (PENDING_RELAY -> COMMITTED_SOLANA_SPL)', async () => {
      const { req, res, getResponse } = createMockReqRes('POST', '/api/bridge/solana/settle', {
        quoteId: generatedQuoteId,
        creatorDid: recipientDid,
        solanaAddress: validSolanaAddress,
        amountSov: 40.0,
      });

      const handled = await handleEnterpriseProtocolRoutes(req, res);
      expect(handled).toBe(true);

      const resp = getResponse();
      expect(resp.statusCode).toBe(200);
      const json = resp.json();
      expect(json.ok).toBe(true);
      expect(json.state).toBe('COMPLETED');
      expect(json.solSettled).toBe(2.0);
      expect(json.settlementStatus).toBe('COMMITTED_SOLANA_SPL');
      expect(json.txSignature).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('rejects invalid Solana address formats', async () => {
      const { req, res, getResponse } = createMockReqRes('POST', '/api/bridge/solana/quote', {
        creatorDid: recipientDid,
        solanaAddress: '0xinvalid_solana_address',
        amountSov: 40.0,
      });

      const handled = await handleEnterpriseProtocolRoutes(req, res);
      expect(handled).toBe(true);

      const resp = getResponse();
      expect(resp.statusCode).toBe(400);
      expect(resp.json().error).toContain('Invalid Solana address format');
    });
  });
});
