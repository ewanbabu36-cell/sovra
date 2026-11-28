/**
 * @file tests/security/risk-management-engine.test.ts
 * Comprehensive verification suite for SOVRA Risk Management Engine, Company P&L Ledger,
 * Financial Leakage Prevention Controls, Solvency Drift Detection & Admin Risk Operations API.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { sovraDb } from '../../scripts/database-engine.ts';
import { SqliteSocialDatabaseEngine } from '../../scripts/database-sqlite.ts';
import { riskManagementEngine, DEFAULT_RISK_POLICIES } from '../../scripts/risk-management-engine.ts';
import { handleReferralRoutes } from '../../scripts/routes/referral.routes.ts';
import { handleWalletRoutes } from '../../scripts/routes/wallet.routes.ts';
import { handleAdminConsoleRoutes } from '../../scripts/routes/admin-console.routes.ts';
import { sovereignAdminSecurity } from '../../scripts/admin-security.ts';
import { AdminSecurityEngine } from '../../packages/identity/dist/index.js';

function createMockReqRes(method: string, urlPath: string, headers: Record<string, string> = {}) {
  let statusCode = 200;
  const respHeaders: Record<string, any> = {};
  let bodyStr = '';

  const req: any = Readable.from([]);
  req.method = method;
  req.url = urlPath;
  req.headers = { host: 'localhost:3001', ...headers };
  req.socket = { remoteAddress: '127.0.0.1' };

  const res: any = {
    writeHead(code: number, hdrs?: Record<string, any>) {
      statusCode = code;
      if (hdrs) Object.assign(respHeaders, hdrs);
      return res;
    },
    setHeader(k: string, v: any) {
      respHeaders[k] = v;
    },
    write(chunk: any) {
      bodyStr += chunk ? chunk.toString() : '';
      return true;
    },
    end(chunk?: any) {
      if (chunk) bodyStr += chunk.toString();
    },
  };

  return {
    req,
    res,
    url: new URL(`http://localhost:3001${urlPath}`),
    getResult: () => ({
      status: statusCode,
      headers: respHeaders,
      raw: bodyStr,
      data: bodyStr ? JSON.parse(bodyStr) : null,
    }),
  };
}

describe('SOVRA Company Risk Management Engine, P&L & Leakage Prevention Suite', () => {
  const uid = crypto.randomBytes(4).toString('hex');
  const testSqliteDir = path.resolve(`./.sovra-risk-test-${uid}`);
  let sqliteEngine: SqliteSocialDatabaseEngine;

  beforeEach(() => {
    sovraDb.load();
    const dbAny = sovraDb as any;
    dbAny.db.users = [];
    dbAny.db.financial_ledger = [];
    dbAny.db.promotion_campaigns = [];
    dbAny.db.sponsored_escrows = [];
    dbAny.db.offline_payment_vouchers = [];
    dbAny.db.depin_mesh_sessions = [];
    dbAny.db.referrals = [];
    dbAny.db.referral_ledger = [];
    dbAny.db.creator_referrals = [];
    dbAny.db.amm_pools = [];
    dbAny.db.risk_ledger = [];
    dbAny.db.processed_fiat_payments = [];
    dbAny.db.meta_tx_used_nonces = [];
    dbAny.db.vesting_schedules = [];
    dbAny.db.risk_policies = { ...DEFAULT_RISK_POLICIES, updatedAt: Date.now() };
    dbAny.save();

    const attachedSqlite = (sovraDb as any).getSqliteEngine?.();
    const rawAttached = attachedSqlite?.getRawDb?.() || attachedSqlite?.db;
    if (rawAttached) {
      try {
        rawAttached.exec('DELETE FROM risk_management_ledger; DELETE FROM risk_management_policies;');
      } catch {}
    }
    try { attachedSqlite?.setPlatformTakeRate?.(5.0); } catch {}

    sovereignAdminSecurity.toggleCircuitBreaker(false, [], {
      did: 'did:sov:admin_root',
      handle: 'root',
      role: 'SUPER_ADMIN',
      authMethod: 'DEVICE_KEY',
      authenticatedAt: Date.now(),
    }, 'Risk test reset');
  });

  afterAll(() => {
    try {
      const attachedSqlite = (sovraDb as any).getSqliteEngine?.();
      const rawAttached = attachedSqlite?.getRawDb?.() || attachedSqlite?.db;
      rawAttached?.exec('DELETE FROM risk_management_ledger; DELETE FROM risk_management_policies;');
      try { attachedSqlite?.setPlatformTakeRate?.(5.0); } catch {}
      const dbAny = sovraDb as any;
      if (dbAny.db) {
        dbAny.db.risk_ledger = [];
        dbAny.db.risk_policies = { ...DEFAULT_RISK_POLICIES, updatedAt: Date.now() };
        dbAny.save?.();
      }
    } catch {}
    try {
      sqliteEngine?.close();
    } catch {}
    try {
      fs.rmSync(testSqliteDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. Removes hardcoded runway & bounty mocks in SqliteSocialDatabaseEngine and aligns 100M supply cap', () => {
    fs.mkdirSync(testSqliteDir, { recursive: true });
    sqliteEngine = new SqliteSocialDatabaseEngine(testSqliteDir);

    const runwayEmpty = sqliteEngine.getRunwayForecast();
    // Previously hardcoded +125.00 intake and 45.00 burn! Must now be 0 on empty ledger
    expect(runwayEmpty.dailyIntakeSov).toBe(0);
    expect(runwayEmpty.dailyBurnSov).toBe(0);
    expect(runwayEmpty.netCashflowSov).toBe(0);

    sqliteEngine.registerUser({
      did: `did:sovra:roi_creator_${uid}`,
      handle: '@roi_creator',
      displayName: 'ROI Creator',
      avatar: 'S',
      avatarBg: '#10b981',
      bio: '',
      website: '',
      websiteUrl: '',
      deviceType: 'Desktop',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const roiList = sqliteEngine.getCreatorRoiAttribution();
    expect(roiList.length).toBeGreaterThanOrEqual(1);
    expect(roiList[0].bountiesReceivedSov).toBe(0); // Previously hardcoded 100.0

    const summary = sqliteEngine.getProtocolFinancialSummary();
    expect(summary?.treasury?.genesisAllocation).toBe(100_000_000);
  });

  it('2. Computes honest Company P&L across revenue streams vs direct subsidies, expenses & leakage losses', () => {
    // Seed real revenue: 200 SOV Super Chat -> 10 SOV platform fee
    sovraDb.recordFinancialLedgerEntry({
      channelId: 'ch_pnl_1',
      creatorDid: `did:sovra:creator_${uid}`,
      customerDid: `did:sovra:fan_${uid}`,
      customerHandle: '@fan',
      itemType: 'SUPER_CHAT',
      referenceId: 'sc_pnl_1',
      description: 'Live stream SuperChat',
      grossAmountSov: 200,
    });

    // Seed real costs: 1 referral (+75 SOV) + 1 infra expense (40 SOV)
    riskManagementEngine.checkAndRecordReferralPayout(`did:sovra:inv_${uid}`, `did:sovra:ref_${uid}`, 75);
    riskManagementEngine.recordRiskEvent({
      category: 'OPERATIONAL_INFRA_EXPENSE',
      severity: 'MEDIUM',
      direction: 'LOSS_OR_COST',
      amountSov: 40,
      description: 'Dedicated libp2p Bootstrap Relay Node Hosting',
      prevented: false,
    });

    const pnl = riskManagementEngine.computeCompanyEconomicsAndPnL();
    expect(pnl.revenue.platformTakeFeesSov).toBeGreaterThanOrEqual(10);
    expect(pnl.costsAndLosses.referralSubsidiesSov).toBeGreaterThanOrEqual(75);
    expect(pnl.costsAndLosses.operationalExpensesSov).toBeGreaterThanOrEqual(40);
    expect(pnl.costsAndLosses.totalDirectCostsAndSubsidiesSov).toBeGreaterThanOrEqual(115);
    expect(pnl.pnl.netOperatingProfitSov).toBeLessThan(0); // 10 - 115 = -105 SOV
    expect(pnl.supply.hardCapSov).toBe(100_000_000);
  });

  it('3. Seals DePIN unbacked printing while preserving micro guest onboarding caps', () => {
    const hostDid = `did:sovra:depin_host_${uid}`;
    const guestDid = `did:sovra:unregistered_guest_${uid}`;
    const dbAny = sovraDb as any;
    dbAny.db.users.push({ did: hostDid, handle: '@host', balanceSov: 10, balance_sov: 10 });
    dbAny.save();

    // A. Inflated unbacked rate (1.0 SOV/MB) must be blocked cleanly!
    const highRate = sovraDb.startDepinSession({
      hotspotNodeDid: hostDid,
      clientPeerDid: guestDid,
      ratePerMbSov: 1.0,
    });
    expect(highRate.ok).toBe(true);
    const blockedRes = sovraDb.meterDepinSession(highRate.session!.sessionId, 10 * 1024 * 1024);
    expect(blockedRes.ok).toBe(false);
    expect(blockedRes.error).toMatch(/exceeds max safe limit/i);

    // B. Normal micro guest rate (0.01 SOV/MB) succeeds once and is tracked as P&L subsidy loss
    const okSess = sovraDb.startDepinSession({
      hotspotNodeDid: hostDid,
      clientPeerDid: guestDid,
      ratePerMbSov: 0.01,
    });
    const okRes = sovraDb.meterDepinSession(okSess.session!.sessionId, 10 * 1024 * 1024);
    expect(okRes.ok).toBe(true);
    expect(okRes.microEarnedSov).toBe(0.1);

    // C. When strictDepinFundedClientOnly is enabled, unbacked guest sessions are rejected
    riskManagementEngine.updateRiskPolicies({ strictDepinFundedClientOnly: true }, 'did:sov:admin_root');
    const strictBlocked = sovraDb.meterDepinSession(okSess.session!.sessionId, 5 * 1024 * 1024);
    expect(strictBlocked.ok).toBe(false);
    expect(strictBlocked.error).toMatch(/Client peer funding required/i);
  });

  it('4. Enforces daily Referral & Faucet & Meta-Tx budgets and logs prevented exploits', async () => {
    const dbAny = sovraDb as any;
    const inviterDid = `did:sovra:inviter_${uid}`;
    dbAny.db.users.push({ did: inviterDid, handle: '@inviter', balanceSov: 100, balance_sov: 100 });
    dbAny.save();

    // Tighten budgets cleanly to test guard enforcement
    riskManagementEngine.updateRiskPolicies({
      dailyReferralBudgetSov: 75,
      dailyFaucetBudgetSov: 50,
    }, 'did:sov:admin_root');

    const { computeReferralCode } = await import('../../scripts/routes/referral.routes.ts');
    const code = computeReferralCode(inviterDid);

    const ref1 = createMockReqRes('POST', '/api/referral/claim');
    const ref1Handled = await handleReferralRoutes({
      req: ref1.req,
      res: ref1.res,
      url: ref1.url,
      readBoundedBody: async () => ({
        body: JSON.stringify({ inviteeDid: `did:sovra:invitee1_${uid}`, referralCode: code }),
        ok: true,
      }),
      resolvePrincipal: () => ({ did: `did:sovra:invitee1_${uid}`, displayName: 'Invitee 1' } as any),
      enforceAuth: () => ({ did: `did:sovra:invitee1_${uid}`, displayName: 'Invitee 1' } as any),
    });
    expect(ref1Handled).toBe(true);
    expect(ref1.getResult().status).toBe(200);

    // Second referral exceeds 75 SOV/day budget -> 429
    const ref2 = createMockReqRes('POST', '/api/referral/claim');
    const ref2Handled = await handleReferralRoutes({
      req: ref2.req,
      res: ref2.res,
      url: ref2.url,
      readBoundedBody: async () => ({
        body: JSON.stringify({ inviteeDid: `did:sovra:invitee2_${uid}`, referralCode: code }),
        ok: true,
      }),
      resolvePrincipal: () => ({ did: `did:sovra:invitee2_${uid}`, displayName: 'Invitee 2' } as any),
      enforceAuth: () => ({ did: `did:sovra:invitee2_${uid}`, displayName: 'Invitee 2' } as any),
    });
    expect(ref2Handled).toBe(true);
    expect(ref2.getResult().status).toBe(429);
    expect(ref2.getResult().data.code).toBe('REFERRAL_DAILY_BUDGET_EXCEEDED');

    // Faucet first claim (50 SOV) allowed; second claim (diff user) hits daily 50 SOV global budget -> 429
    const f1 = createMockReqRes('POST', '/api/wallet/faucet/claim');
    await handleWalletRoutes({
      req: f1.req,
      res: f1.res,
      url: f1.url,
      readBoundedBody: async () => ({ body: JSON.stringify({ amount: 50 }), ok: true }),
      resolvePrincipal: () => ({ did: `did:sovra:faucet_a_${uid}`, displayName: `FA_${uid}` } as any),
      enforceAuth: () => ({ did: `did:sovra:faucet_a_${uid}`, displayName: `FA_${uid}` } as any),
    });
    expect(f1.getResult().status).toBe(200);

    const f2 = createMockReqRes('POST', '/api/wallet/faucet/claim');
    await handleWalletRoutes({
      req: f2.req,
      res: f2.res,
      url: f2.url,
      readBoundedBody: async () => ({ body: JSON.stringify({ amount: 50 }), ok: true }),
      resolvePrincipal: () => ({ did: `did:sovra:faucet_b_${uid}`, displayName: `FB_${uid}` } as any),
      enforceAuth: () => ({ did: `did:sovra:faucet_b_${uid}`, displayName: `FB_${uid}` } as any),
    });
    expect(f2.getResult().status).toBe(429);
    expect(f2.getResult().data.code).toBe('GLOBAL_FAUCET_BUDGET_EXCEEDED');

    const audit = riskManagementEngine.auditSystemLeakageAndRisks();
    expect(audit.preventedAttacksCount).toBeGreaterThanOrEqual(2);
    expect(audit.totalRecoveredSavingsSov).toBeGreaterThanOrEqual(125);
  });

  it('5. Enforces strict AMM pool drain guard, expired voucher reclaim, and durable Fiat replay/vesting controls', async () => {
    const dbAny = sovraDb as any;
    const traderDid = `did:sovra:trader_${uid}`;
    dbAny.db.users.push({
      did: traderDid,
      handle: '@trader',
      balanceSov: 500,
      balance_sov: 500,
    });
    const tokAddr = `sovra1wasm_risk_${uid}`;
    dbAny.db.amm_pools.push({
      tokenAddress: tokAddr,
      tokenSymbol: 'RSK',
      tokenName: 'Risk Token',
      creatorDid: `did:sovra:creator_${uid}`,
      creatorAddress: 'sovra1creator_risk',
      poolAddress: 'pool_risk_1',
      reserveSov: '10000000', // 10 SOV
      sovReserve: '10000000',
      reserveToken: '1000000000',
      tokenReserve: '1000000000',
      createdAt: Date.now(),
    });
    dbAny.save();

    // Enable strict AMM cap (max 25%) -> 5 SOV input against 10 SOV pool drains ~50% -> blocked 403!
    riskManagementEngine.updateRiskPolicies({ enforceStrictAmmDrainCap: true, maxSingleAmmDrainPct: 25 }, 'did:sov:admin_root');
    const swapRes = createMockReqRes('POST', '/api/wallet/swap');
    await handleWalletRoutes({
      req: swapRes.req,
      res: swapRes.res,
      url: swapRes.url,
      readBoundedBody: async () => ({
        body: JSON.stringify({ tokenAddress: tokAddr, direction: 'buy', amount: '5000000' }),
        ok: true,
      }),
      resolvePrincipal: () => ({ did: traderDid, displayName: 'Trader' } as any),
      enforceAuth: () => ({ did: traderDid, displayName: 'Trader' } as any),
    });
    expect(swapRes.getResult().status).toBe(403);
    expect(swapRes.getResult().data.code).toBe('AMM_MAX_POOL_DRAIN_EXCEEDED');

    // Create & expire an offline payment voucher -> reclaim restores sender balance!
    const createdVouch = sovraDb.createOfflinePaymentVoucher({
      senderDid: traderDid,
      recipientDid: '*',
      amountSov: 40,
      signature: 'sig_vouch_test',
      expiresInSeconds: -10,
    });
    expect(createdVouch.ok).toBe(true);
    const afterLockUser = sovraDb.getUserByDid(traderDid);
    expect(afterLockUser!.balance_sov).toBe(460);

    const mit = riskManagementEngine.executeMitigation('RECLAIM_EXPIRED_VOUCHERS', 'did:sov:admin_root');
    expect(mit.ok).toBe(true);
    expect(mit.details.reclaimedCount).toBe(1);
    expect(mit.details.totalRefundedSov).toBe(40);
    expect(sovraDb.getUserByDid(traderDid)!.balance_sov).toBe(500);

    // Durable Fiat webhook replay protection (persisted in processed_fiat_payments & SQLite)
    const payId = `pay_durable_${uid}`;
    const fiatBody = JSON.stringify({ paymentId: payId, userDid: traderDid, amountFiat: 100, currency: 'INR' });
    const sig = crypto.createHmac('sha256', 'sovra_test_webhook_secret_2026').update(fiatBody).digest('hex');

    const w1 = createMockReqRes('POST', '/api/wallet/fiat/webhook', { 'x-webhook-signature': sig });
    await handleWalletRoutes({
      req: w1.req,
      res: w1.res,
      url: w1.url,
      readBoundedBody: async () => ({ body: fiatBody, ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    });
    expect(w1.getResult().status).toBe(200);
    expect(dbAny.db.processed_fiat_payments).toContain(payId);

    const w2 = createMockReqRes('POST', '/api/wallet/fiat/webhook', { 'x-webhook-signature': sig });
    await handleWalletRoutes({
      req: w2.req,
      res: w2.res,
      url: w2.url,
      readBoundedBody: async () => ({ body: fiatBody, ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    });
    expect(w2.getResult().status).toBe(409);

    // Vesting lock blocks fiat/withdraw exceeding unlocked spendable balance
    dbAny.db.vesting_schedules.push({
      did: traderDid,
      originalAmountSov: 500,
      startAt: Date.now(),
      cliffAt: Date.now() + 365 * 86400_000,
      endAt: Date.now() + 1095 * 86400_000,
    });
    dbAny.save();
    const wdBlocked = createMockReqRes('POST', '/api/wallet/fiat/withdraw');
    await handleWalletRoutes({
      req: wdBlocked.req,
      res: wdBlocked.res,
      url: wdBlocked.url,
      readBoundedBody: async () => ({ body: JSON.stringify({ amountSov: '100', payoutTarget: 'UPI' }), ok: true }),
      resolvePrincipal: () => ({ did: traderDid } as any),
      enforceAuth: () => ({ did: traderDid } as any),
    });
    expect(wdBlocked.getResult().status).toBe(400);
    expect(wdBlocked.getResult().data.error).toMatch(/vesting/i);
  });

  it('6. Exposes RBAC-protected /api/admin/risk/* endpoints and renders Risk Management tab in Admin Console HTML', async () => {
    const adminSecret = process.env.SOVRA_ADMIN_SECRET_KEY || 'sovra-test-admin-secret-key-32-chars-ok!';
    const adminSecurityEngine = new AdminSecurityEngine(adminSecret);
    const adminSess = adminSecurityEngine.createAdminSession({
      did: 'did:sov:admin_root',
      role: 'SUPER_ADMIN',
      adminKey: adminSecret,
    });
    const modSess = adminSecurityEngine.createAdminSession({
      did: 'did:sov:admin_moderator',
      role: 'CONTENT_MODERATOR',
      adminKey: adminSecret,
    });
    expect(adminSess.ok && modSess.ok).toBe(true);
    if (!adminSess.ok || !modSess.ok) return;

    const adminCtxBase = {
      adminSecurity: adminSecurityEngine,
      startTime: Date.now(),
      STORAGE_DIR: './.sovra-storage-dev',
      getDirectorySize: () => 0,
      resolvePrincipal: () => null,
      enforceAuth: () => null,
      getRealSystemTelemetry: () => ({}),
      node: null,
      storageDaemon: null,
      tcpPort: 4001,
      HTTP_PORT: 3001,
      HTTPS_PORT: 3443,
      injectCspNonce: (h: string) => h,
      broadcastChatEvent: () => {},
      broadcastControlPlaneEvent: () => {},
      masterKey: Buffer.alloc(32),
      binding: {},
      dynamicSocialStore: null,
    } as any;

    // 1. Overview GET
    const ov = createMockReqRes('GET', '/api/admin/risk/overview', {
      authorization: `Bearer ${adminSess.sessionToken}`,
      'x-sovra-session-token': adminSess.sessionToken,
      'x-admin-did': 'did:sov:admin_root',
    });
    const handled = await handleAdminConsoleRoutes({
      ...adminCtxBase,
      req: ov.req,
      res: ov.res,
      url: ov.url,
      readBoundedBody: async () => ({ body: '', ok: true }),
    });
    expect(handled).toBe(true);
    expect(ov.getResult().status).toBe(200);
    expect(ov.getResult().data.ok).toBe(true);
    expect(ov.getResult().data.leakageAudit.vectors.length).toBe(10);

    // 2. RBAC blocks moderator from modifying Risk Policy
    const modPost = createMockReqRes('POST', '/api/admin/risk/policies', {
      authorization: `Bearer ${modSess.sessionToken}`,
      'x-sovra-session-token': modSess.sessionToken,
      'x-admin-did': 'did:sov:admin_moderator',
    });
    await handleAdminConsoleRoutes({
      ...adminCtxBase,
      req: modPost.req,
      res: modPost.res,
      url: modPost.url,
      readBoundedBody: async () => ({ body: JSON.stringify({ dailyFaucetBudgetSov: 999999 }), ok: true }),
    });
    expect(modPost.getResult().status).toBe(403);

    // 3. Super Admin updates policy and runs mitigation cleanly
    const rootPost = createMockReqRes('POST', '/api/admin/risk/policies', {
      authorization: `Bearer ${adminSess.sessionToken}`,
      'x-sovra-session-token': adminSess.sessionToken,
      'x-admin-did': 'did:sov:admin_root',
    });
    await handleAdminConsoleRoutes({
      ...adminCtxBase,
      req: rootPost.req,
      res: rootPost.res,
      url: rootPost.url,
      readBoundedBody: async () => ({ body: JSON.stringify({ dailyFaucetBudgetSov: 12000 }), ok: true }),
    });
    expect(rootPost.getResult().status).toBe(200);
    expect(rootPost.getResult().data.policies.dailyFaucetBudgetSov).toBe(12000);

    const htmlCode = fs.readFileSync(path.resolve(process.cwd(), 'scripts', 'admin-console.ts'), 'utf-8');
    expect(htmlCode).toContain('id="view-risk-management"');
    expect(htmlCode).toContain('loadRiskManagementOverview');
    expect(htmlCode).toContain('executeRiskMitigation');
    expect(htmlCode).not.toContain('200,000,000 SOV');
    expect(htmlCode).not.toContain('+125.00 SOV');
    expect(htmlCode).not.toContain('-45.00 SOV');

    // Verify zero inline onclick= inside #view-risk-management and take-rate slider floor >= 2.5%
    const sectionMatch = htmlCode.match(/<section[^>]*id="view-risk-management"[\s\S]*?<\/section>/);
    expect(sectionMatch).toBeTruthy();
    expect(sectionMatch![0]).not.toMatch(/onclick=/i);
    expect(sectionMatch![0]).not.toMatch(/oninput=/i);
    expect(htmlCode).toContain('id="adminTakeRateSlider" min="2.5"');
    const dynRenderMatch = htmlCode.match(/function renderRiskManagementDashboard[\s\S]*?function loadRiskManagementOverview/);
    expect(dynRenderMatch).toBeTruthy();
    expect(dynRenderMatch![0]).not.toMatch(/onclick=/i);
    expect(dynRenderMatch![0]).toContain('data-risk-action=');
  });

  it('7. Aggregates >1,500 SQLite risk ledger rows without truncation and logs AI Agent, Bridge & Sink revenue', async () => {
    const dbAny = sovraDb as any;
    const rawSql = dbAny.getSqliteEngine?.()?.getRawDb?.() || dbAny.getSqliteEngine?.()?.db;
    const employerDid = `did:sovra:employer_${uid}`;
    const payerDid = `did:sovra:sink_payer_${uid}`;
    dbAny.db.users.push(
      { did: employerDid, handle: '@employer', balanceSov: 200, balance_sov: 200 },
      { did: payerDid, handle: '@payer', balanceSov: 100, balance_sov: 100 },
    );
    dbAny.save(true);
    if (rawSql) {
      const now = Date.now();
      const sqEng = dbAny.getSqliteEngine();
      sqEng?.registerUser?.({
        did: employerDid,
        handle: `@employer_${uid}`,
        displayName: 'Employer',
        avatar: 'E',
        avatarBg: '#10b981',
        bio: '',
        website: '',
        websiteUrl: '',
        deviceType: 'Desktop',
        createdAt: now,
        updatedAt: now,
      });
      sqEng?.registerUser?.({
        did: payerDid,
        handle: `@payer_${uid}`,
        displayName: 'Payer',
        avatar: 'P',
        avatarBg: '#38bdf8',
        bio: '',
        website: '',
        websiteUrl: '',
        deviceType: 'Desktop',
        createdAt: now,
        updatedAt: now,
      });
      rawSql.prepare('UPDATE users SET balance_sov = ? WHERE did = ?').run(200, employerDid);
      rawSql.prepare('UPDATE users SET balance_sov = ? WHERE did = ?').run(100, payerDid);

      // Insert 1,650 rows (exceeding legacy getRiskLedger(1500) cap!) directly into SQLite
      rawSql.exec('BEGIN TRANSACTION');
      const ins = rawSql.prepare(`
        INSERT INTO risk_management_ledger
        (id, category, severity, direction, amount_sov, actor_did, endpoint, description, prevented, metadata_json, created_at)
        VALUES (?, 'REVENUE_RECORDED', 'LOW', 'REVENUE', 0.1, ?, '/api/economy/sinks/boost', 'Bulk boost fee', 0, '{"kind":"BOOST"}', ?)
      `);
      for (let i = 0; i < 1650; i++) {
        ins.run(`bulk_boost_${uid}_${i}`, payerDid, now);
      }
      rawSql.exec('COMMIT');
    }

    // Bridge fee -> numeric feeSov + BRIDGE_FEE P&L revenue
    const bridgeRec = (sovraDb as any).createBridgeTransfer({
      senderAddress: 'sovra1bridge_' + uid,
      senderDid: payerDid,
      targetChain: 'osmosis',
      targetAddress: 'osmo1dest_' + uid,
      amount: '10',
      relayerFee: '500000',
    });
    expect(bridgeRec.feeSov).toBe(0.5);

    // Economy Handle & Storage sinks -> revenue logged
    const { executeHandleBurnSink, executeStorageRentBurnSink } = await import('../../scripts/routes/economy.routes.ts');
    const hRes = executeHandleBurnSink(payerDid, `test_${uid.slice(0, 6)}`, 10);
    expect(hRes.ok).toBe(true);
    const sRes = executeStorageRentBurnSink(payerDid, 10, 2, undefined, 10);
    expect(sRes.ok).toBe(true);

    // AI Agent hire -> real balance debit, job persistence, and AI_MARKETPLACE_FEE P&L logging
    const { handleEnterpriseProtocolRoutes } = await import('../../scripts/routes/enterprise-protocol.routes.ts');
    const hireBody = JSON.stringify({
      agentId: 'agent_moderator_v1',
      employerDid,
      role: 'COMMUNITY_MODERATOR',
      escrowBudgetSov: 100,
      durationDays: 14,
    });
    const hireReqRes = createMockReqRes('POST', '/api/ai/agents/hire');
    hireReqRes.req = Readable.from([Buffer.from(hireBody, 'utf8')]) as any;
    hireReqRes.req.method = 'POST';
    hireReqRes.req.url = '/api/ai/agents/hire';
    hireReqRes.req.headers = { host: 'localhost:3001', 'content-type': 'application/json' };
    hireReqRes.req.socket = { remoteAddress: '127.0.0.1' };
    await handleEnterpriseProtocolRoutes(hireReqRes.req, hireReqRes.res);
    const hireOut = hireReqRes.getResult();
    expect(hireOut.status).toBe(200);
    expect(hireOut.data.ok).toBe(true);
    expect(hireOut.data.contract.platformFeeSov).toBeGreaterThanOrEqual(5);
    expect(hireOut.data.employerBalanceAfterSov).toBe(100);

    const pnl = riskManagementEngine.computeCompanyEconomicsAndPnL();
    if (rawSql) {
      expect(pnl.revenue.boostAndPromotionFeesSov).toBe(165);
    }
    expect(pnl.revenue.bridgeFeesSov).toBeGreaterThanOrEqual(0.5);
    expect(pnl.revenue.handleBurnSinkYieldSov).toBeGreaterThanOrEqual(2);
    expect(pnl.revenue.storageRentYieldSov).toBeGreaterThanOrEqual(5);
    expect(pnl.revenue.aiMarketplaceFeesSov).toBeGreaterThanOrEqual(5);
    expect(pnl.revenue.grossProtocolRevenueSov).toBeGreaterThanOrEqual(rawSql ? 177.5 : 12.5);
  });

  it('8. Hardens Offline Payment Vouchers with enforceAuth, Ed25519 signature verification & vesting checks', async () => {
    const { handleOfflinePayRoutes } = await import('../../scripts/routes/offline-pay.routes.ts');
    const { generateEd25519KeyPair, signEd25519, bytesToHex } = await import('../../packages/crypto/dist/index.js');
    const kp = generateEd25519KeyPair();
    const pubHex = bytesToHex(kp.publicKey);

    const senderDid = `did:sovra:off_sender_${uid}`;
    const receiverDid = `did:sovra:off_recv_${uid}`;
    const dbAny = sovraDb as any;
    dbAny.db.users.push(
      { did: senderDid, handle: '@off_s', publicKey: pubHex, publicKeyHex: pubHex, balanceSov: 100, balance_sov: 100 },
      { did: receiverDid, handle: '@off_r', balanceSov: 0, balance_sov: 0 },
    );
    // Lock 50 SOV in vesting so only 50 SOV is spendable
    dbAny.db.vesting_schedules.push({
      did: senderDid,
      originalAmountSov: 50,
      startAt: Date.now(),
      cliffAt: Date.now() + 86400_000,
      endAt: Date.now() + 10 * 86400_000,
    });
    dbAny.save(true);

    // 1. Unauthenticated request blocked -> 401
    const unauth = createMockReqRes('POST', '/api/wallet/offline/generate-voucher');
    await handleOfflinePayRoutes(unauth.req, unauth.res, {
      resolvePrincipal: () => null,
      enforceAuth: (_req, r) => {
        r.writeHead(401, { 'Content-Type': 'application/json' });
        r.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
        return null;
      },
    });
    expect(unauth.getResult().status).toBe(401);

    // 2. Forged signature rejected -> 401
    const forgedPayload = { senderDid, recipientDid: receiverDid, amountSov: 25, nonce: 'n_forged', signature: '00'.repeat(64) };
    const forged = createMockReqRes('POST', '/api/wallet/offline/generate-voucher');
    forged.req = Readable.from([Buffer.from(JSON.stringify(forgedPayload))]) as any;
    forged.req.method = 'POST';
    forged.req.url = '/api/wallet/offline/generate-voucher';
    forged.req.headers = { host: 'localhost:3001' };
    await handleOfflinePayRoutes(forged.req, forged.res, {
      resolvePrincipal: () => ({ did: senderDid } as any),
      enforceAuth: () => ({ did: senderDid } as any),
    });
    expect(forged.getResult().status).toBe(401);

    // 3. Valid signature exceeding spendable (80 > 50 spendable due to vesting) rejected -> 403
    const overVestNonce = `n_vest_${uid}`;
    const overVestMsg = `${senderDid}:${receiverDid}:80:${overVestNonce}`;
    const overVestSig = bytesToHex(signEd25519(kp.privateKey, new TextEncoder().encode(overVestMsg)));
    const overVest = createMockReqRes('POST', '/api/wallet/offline/generate-voucher');
    overVest.req = Readable.from([Buffer.from(JSON.stringify({
      senderDid, recipientDid: receiverDid, amountSov: 80, nonce: overVestNonce, signature: overVestSig,
    }))]) as any;
    overVest.req.method = 'POST';
    overVest.req.url = '/api/wallet/offline/generate-voucher';
    overVest.req.headers = { host: 'localhost:3001' };
    await handleOfflinePayRoutes(overVest.req, overVest.res, {
      resolvePrincipal: () => ({ did: senderDid } as any),
      enforceAuth: () => ({ did: senderDid } as any),
    });
    expect(overVest.getResult().status).toBe(403);
    expect(overVest.getResult().data.error).toMatch(/spendable|vesting/i);

    // 4. Valid signature within spendable (30 <= 50) succeeds -> 201 & claims cleanly
    const validNonce = `n_ok_${uid}`;
    const validMsg = `${senderDid}:${receiverDid}:30:${validNonce}`;
    const validSig = bytesToHex(signEd25519(kp.privateKey, new TextEncoder().encode(validMsg)));
    const genOk = createMockReqRes('POST', '/api/wallet/offline/generate-voucher');
    genOk.req = Readable.from([Buffer.from(JSON.stringify({
      senderDid, recipientDid: receiverDid, amountSov: 30, nonce: validNonce, signature: validSig,
    }))]) as any;
    genOk.req.method = 'POST';
    genOk.req.url = '/api/wallet/offline/generate-voucher';
    genOk.req.headers = { host: 'localhost:3001' };
    await handleOfflinePayRoutes(genOk.req, genOk.res, {
      resolvePrincipal: () => ({ did: senderDid } as any),
      enforceAuth: () => ({ did: senderDid } as any),
    });
    expect(genOk.getResult().status).toBe(201);
    expect(genOk.getResult().data.voucher.voucherId).toBeTruthy();

    const claimOk = createMockReqRes('POST', '/api/wallet/offline/claim-voucher');
    claimOk.req = Readable.from([Buffer.from(JSON.stringify({
      voucherId: genOk.getResult().data.voucher.voucherId,
      claimantDid: receiverDid,
    }))]) as any;
    claimOk.req.method = 'POST';
    claimOk.req.url = '/api/wallet/offline/claim-voucher';
    claimOk.req.headers = { host: 'localhost:3001' };
    await handleOfflinePayRoutes(claimOk.req, claimOk.res, {
      resolvePrincipal: () => ({ did: receiverDid } as any),
      enforceAuth: () => ({ did: receiverDid } as any),
    });
    expect(claimOk.getResult().status).toBe(200);
    expect(claimOk.getResult().data.amountSettled).toBe(30);
  });

  it('9. Enforces Seeder Stake-to-Work + 30d vesting, Fiat AMM/cap routing & >= 2.5% take-rate floor', async () => {
    const dbAny = sovraDb as any;
    const { generateEd25519KeyPair, bytesToHex } = await import('../../packages/crypto/dist/index.js');
    const { signBandwidthReceipt } = await import('../../packages/protocol/src/index.js');
    const seederKp = generateEd25519KeyPair();
    const dlKp = generateEd25519KeyPair();
    const dlPubHex = bytesToHex(dlKp.publicKey);
    const sPubHex = bytesToHex(seederKp.publicKey);

    const seederDid = `did:sovra:seeder_bond_${uid}`;
    const dlDid = `did:sovra:dl_peer_${uid}`;
    dbAny.db.users.push(
      { did: seederDid, handle: '@seeder', publicKey: sPubHex, publicKeyHex: sPubHex, balanceSov: 10, balance_sov: 10 },
      { did: dlDid, handle: '@dl', publicKey: dlPubHex, publicKeyHex: dlPubHex, balanceSov: 100, balance_sov: 100 },
    );
    const poolTok = `sovra1fiat_pool_${uid}`;
    dbAny.db.amm_pools.push({
      tokenAddress: poolTok,
      tokenSymbol: 'AMM',
      reserveSov: '500000000',
      sovReserve: '500000000',
      reserveToken: '500000000',
      tokenReserve: '500000000',
    });
    dbAny.save(true);

    const makeReceipt = (rid: string) => {
      const base = {
        receiptId: rid,
        contentCid: 'bafy_cid_' + uid,
        seederDid,
        downloaderDid: dlDid,
        bytesServed: 2 * 1024 * 1024 * 1024, // 2 GiB -> 0.10 SOV
        totalMediaBytes: 2 * 1024 * 1024 * 1024,
        timestamp: Date.now(),
      };
      return {
        ...signBandwidthReceipt(base, dlKp.privateKey),
        downloaderPublicKeyHex: dlPubHex,
      };
    };

    // A. Default policy allows yield with warning log & applies 50% 30-day rolling vesting lock
    const { getVestingLockedForDid } = await import('../../scripts/routes/economy.routes.ts');
    const r1 = makeReceipt(`rcpt_1_${uid}`);
    const y1 = createMockReqRes('POST', '/api/wallet/claim-seeder-yield');
    await handleWalletRoutes({
      req: y1.req,
      res: y1.res,
      url: y1.url,
      readBoundedBody: async () => ({ body: JSON.stringify({ receipts: [r1] }), ok: true }),
      resolvePrincipal: () => ({ did: seederDid } as any),
      enforceAuth: () => ({ did: seederDid } as any),
    });
    expect(y1.getResult().status).toBe(200);
    expect(y1.getResult().data.claimedSov).toBe(0.1);
    expect(y1.getResult().data.vestedLockedSov).toBe(0.05);
    expect(getVestingLockedForDid(seederDid)).toBeCloseTo(0.05, 3);

    // B. Strict Stake-to-Work blocks unbonded Seeder -> 403 until >= 100 SOV bonded
    riskManagementEngine.updateRiskPolicies({ requireSeederBondForYield: true }, 'did:sov:admin_root');
    const r2 = makeReceipt(`rcpt_2_${uid}`);
    const y2 = createMockReqRes('POST', '/api/wallet/claim-seeder-yield');
    await handleWalletRoutes({
      req: y2.req,
      res: y2.res,
      url: y2.url,
      readBoundedBody: async () => ({ body: JSON.stringify({ receipts: [r2] }), ok: true }),
      resolvePrincipal: () => ({ did: seederDid } as any),
      enforceAuth: () => ({ did: seederDid } as any),
    });
    expect(y2.getResult().status).toBe(403);
    expect(y2.getResult().data.code).toBe('SEEDER_BOND_REQUIRED');

    dbAny.db.seeder_bonds = [{ did: seederDid, bondedSov: 100 }];
    dbAny.save();
    const y2Ok = createMockReqRes('POST', '/api/wallet/claim-seeder-yield');
    await handleWalletRoutes({
      req: y2Ok.req,
      res: y2Ok.res,
      url: y2Ok.url,
      readBoundedBody: async () => ({ body: JSON.stringify({ receipts: [r2] }), ok: true }),
      resolvePrincipal: () => ({ did: seederDid } as any),
      enforceAuth: () => ({ did: seederDid } as any),
    });
    expect(y2Ok.getResult().status).toBe(200);
    expect(y2Ok.getResult().data.claimedSov).toBe(0.1);

    // C. Fiat on-ramp routes via AMM DEX pool & enforces daily cap
    riskManagementEngine.updateRiskPolicies({ dailyFiatMintCapSov: 20 }, 'did:sov:admin_root');
    const fiatSwapBody = JSON.stringify({ paymentId: `pay_amm_${uid}`, userDid: seederDid, amountFiat: 100, tokenAddress: poolTok });
    const fiatSig = crypto.createHmac('sha256', 'sovra_test_webhook_secret_2026').update(fiatSwapBody).digest('hex');
    const fSwap = createMockReqRes('POST', '/api/wallet/fiat/webhook', { 'x-webhook-signature': fiatSig });
    await handleWalletRoutes({
      req: fSwap.req,
      res: fSwap.res,
      url: fSwap.url,
      readBoundedBody: async () => ({ body: fiatSwapBody, ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    });
    expect(fSwap.getResult().status).toBe(200);
    expect(fSwap.getResult().data.fundingSource).toBe('AMM_DEX_SWAP');

    const fiatCapBody = JSON.stringify({ paymentId: `pay_cap_${uid}`, userDid: seederDid, amountFiat: 500 }); // 50 SOV > 20 cap
    const fiatCapSig = crypto.createHmac('sha256', 'sovra_test_webhook_secret_2026').update(fiatCapBody).digest('hex');
    const fCap = createMockReqRes('POST', '/api/wallet/fiat/webhook', { 'x-webhook-signature': fiatCapSig });
    await handleWalletRoutes({
      req: fCap.req,
      res: fCap.res,
      url: fCap.url,
      readBoundedBody: async () => ({ body: fiatCapBody, ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    });
    expect(fCap.getResult().status).toBe(429);
    expect(fCap.getResult().data.code).toBe('DAILY_FIAT_MINT_CAP_EXCEEDED');

    // D. Both Admin console routes enforce >= 2.5% platformTakeRateFloorPct
    const { handleAdminFeatureRoute } = await import('../../scripts/routes/admin_features.routes.ts');
    const trReq = createMockReqRes('POST', '/api/admin/revenue/take-rate');
    await handleAdminFeatureRoute({
      req: trReq.req,
      res: trReq.res,
      url: trReq.url,
      readBoundedBody: async () => ({ body: JSON.stringify({ takeRate: 1.0 }), ok: true }),
      checkAdminRbac: () => ({ authorized: true, adminDid: 'did:sov:admin_root', role: 'SUPER_ADMIN', statusCode: 200 }),
    });
    expect(trReq.getResult().status).toBe(200);
    expect(trReq.getResult().data.takeRate).toBe(2.5);
    expect(trReq.getResult().data.clampedToFloor).toBe(true);
  });
});
