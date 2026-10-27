/**
 * @file tests/e2e/sponsored-campaign-escrows.test.ts
 * Master E2E Suite for B2B Enterprise Sponsored Campaigns & Escrow Settlement Engine (Cycle 4).
 *
 * Verifies:
 * 1. Brand Bounty Creation with Escrowed SOV Balance deduction
 * 2. Creator draft submission and transition to SUBMITTED
 * 3. 1-Click Escrow Approval & Release with 95% creator payout & ledger recording
 * 4. Automatic Escrow Cancellation & Instant Wallet Refund
 * 5. Attested CPM Delivery Analytics dashboard endpoint
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { handleStudioTranscoderRoutes } from '../../scripts/routes/studio.routes.ts';
import { sovraDb } from '../../scripts/database-engine.ts';

function createMockContext(method: string, urlPath: string, bodyJson?: any, principalDid = 'did:key:brand_sponsor_org') {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let responseData = '';

  const req: any = {
    method,
    headers: { host: 'localhost:3001' },
    url: urlPath,
  };

  const res: any = {
    writeHead: (status: number, head: Record<string, string>) => {
      statusCode = status;
      Object.assign(headers, head);
    },
    end: (chunk?: any) => {
      if (typeof chunk === 'string') {
        responseData = chunk;
      }
    },
  };

  const url = new URL(`http://localhost:3001${urlPath}`);

  const ctx = {
    req,
    res,
    url,
    validateMediaMagicBytes: () => ({ valid: true }),
    readBoundedBody: async () => ({
      body: bodyJson ? JSON.stringify(bodyJson) : '',
      ok: true,
    }),
    resolvePrincipal: () => ({ did: principalDid, handle: 'sponsor_brand' } as any),
    enforceAuth: () => ({ did: principalDid, handle: 'sponsor_brand' } as any),
    getResult: () => ({
      statusCode,
      headers,
      data: responseData,
    }),
  };

  return ctx;
}

describe('Cycle 4: B2B Sponsored Campaigns & Escrow Settlement Engine Suite', () => {
  const brandDid = 'did:key:brand_nike_mesh';
  const creatorDid = 'did:key:creator_alice_video';

  // Seed users in sovraDb for test balance consistency
  sovraDb.createUser({
    did: brandDid,
    handle: 'brand_nike',
    displayName: 'Nike Mesh Labs',
    balanceSov: 500,
  } as any);

  sovraDb.createUser({
    did: creatorDid,
    handle: 'alice_creative',
    displayName: 'Alice Creative',
    balanceSov: 100,
  } as any);

  let createdEscrowId = '';

  describe('1. Sponsored Post Marketplace Bounty Creation', () => {
    it('should create funded bounty in sponsoredEscrows and deduct balance from brand', async () => {
      const createPayload = {
        sponsorDid: brandDid,
        sponsorName: 'Nike Mesh Labs',
        creatorDid: creatorDid,
        channelId: 'nike_running',
        bountyAmountSov: 150,
        requiredViews: 500,
        disclosureTag: '#sponsored #ad',
      };

      const ctx = createMockContext('POST', '/api/studio/sponsored/create', createPayload, brandDid);
      const handled = await handleStudioTranscoderRoutes(ctx as any);
      expect(handled).toBe(true);

      const res = ctx.getResult();
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.data);
      expect(body.ok).toBe(true);
      expect(body.id).toBeDefined();
      expect(body.status).toBe('ESCROWED');
      expect(body.bountyAmountSov).toBe(150);
      expect(body.newBalance).toBe(350); // 500 - 150

      createdEscrowId = body.id;

      // Verify in sovraDb
      const user = sovraDb.findUserByDid(brandDid);
      expect(user?.balanceSov).toBe(350);
    });
  });

  describe('2. Creator Draft Submission', () => {
    it('should transition escrow status to SUBMITTED with draft post ID', async () => {
      const submitPayload = {
        escrowId: createdEscrowId,
        draftPostId: 'post_draft_nike_shoes_01',
        creatorDid: creatorDid,
      };

      const ctx = createMockContext('POST', '/api/studio/sponsored/apply', submitPayload, creatorDid);
      const handled = await handleStudioTranscoderRoutes(ctx as any);
      expect(handled).toBe(true);

      const res = ctx.getResult();
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.data);
      expect(body.ok).toBe(true);
      expect(body.status).toBe('SUBMITTED');
      expect(body.submittedContentId).toBe('post_draft_nike_shoes_01');
    });
  });

  describe('3. Brand Escrow Release Payout', () => {
    it('should approve and release escrow payout with 95% creator share and ledger record', async () => {
      const releasePayload = {
        escrowId: createdEscrowId,
        callerDid: brandDid,
      };

      const ctx = createMockContext('POST', '/api/studio/sponsored/approve-release', releasePayload, brandDid);
      const handled = await handleStudioTranscoderRoutes(ctx as any);
      expect(handled).toBe(true);

      const res = ctx.getResult();
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.data);
      expect(body.ok).toBe(true);
      expect(body.status).toBe('RELEASED');
      expect(body.releaseTxHash).toBeDefined();
      expect(body.netPaidToCreator).toBe(142.5); // 150 * 0.95

      // Verify financial ledger has SPONSOR_ESCROW record
      const ledger = (sovraDb as any).db.financial_ledger || [];
      const entry = ledger.find((e: any) => e.referenceId === createdEscrowId);
      expect(entry).toBeDefined();
      expect(entry.itemType).toBe('SPONSOR_ESCROW');
      expect(entry.grossAmountSov).toBe(150);
      expect(entry.creatorDid).toBe(creatorDid);
    });

    it('should reject double release attempts with error', async () => {
      const ctx = createMockContext('POST', '/api/studio/sponsored/approve-release', {
        escrowId: createdEscrowId,
      }, brandDid);
      await handleStudioTranscoderRoutes(ctx as any);

      const res = ctx.getResult();
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.data);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('already released');
    });
  });

  describe('4. Automatic Escrow Cancellation & Instant Refund', () => {
    it('should allow brand to cancel unspent campaign with instant automated refund', async () => {
      // Create a second campaign
      const createPayload = {
        sponsorDid: brandDid,
        bountyAmountSov: 100,
      };
      const createCtx = createMockContext('POST', '/api/studio/sponsored/create', createPayload, brandDid);
      await handleStudioTranscoderRoutes(createCtx as any);
      const created = JSON.parse(createCtx.getResult().data);
      expect(created.ok).toBe(true);
      const escrowToCancel = created.id;

      // Current brand balance before refund
      const balBefore = sovraDb.findUserByDid(brandDid)?.balanceSov || 0;

      // Cancel and refund
      const refundCtx = createMockContext('POST', '/api/studio/sponsored/cancel-refund', {
        escrowId: escrowToCancel,
      }, brandDid);
      const handled = await handleStudioTranscoderRoutes(refundCtx as any);
      expect(handled).toBe(true);

      const res = refundCtx.getResult();
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.data);
      expect(body.ok).toBe(true);
      expect(body.status).toBe('REFUNDED');
      expect(body.refundedAmount).toBe(100);
      expect(body.newBalance).toBe(balBefore + 100);

      // Verify in db
      const brandAfter = sovraDb.findUserByDid(brandDid);
      expect(brandAfter?.balanceSov).toBe(balBefore + 100);
    });
  });

  describe('5. Attested CPM Delivery Analytics Dashboard', () => {
    it('should return aggregated metrics for active escrows, released, and refunded amounts', async () => {
      const analyticsCtx = createMockContext('GET', '/api/studio/sponsored/analytics');
      const handled = await handleStudioTranscoderRoutes(analyticsCtx as any);
      expect(handled).toBe(true);

      const res = analyticsCtx.getResult();
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.data);
      expect(body.ok).toBe(true);
      expect(body.summary).toBeDefined();
      expect(body.summary.totalEscrowedSov).toBeDefined();
      expect(body.summary.totalReleasedSov).toBeGreaterThan(0);
      expect(body.summary.totalRefundedSov).toBeGreaterThan(0);
      expect(Array.isArray(body.escrows)).toBe(true);
    });
  });
});
