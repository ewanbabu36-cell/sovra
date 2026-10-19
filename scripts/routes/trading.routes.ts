/**
 * @file scripts/routes/trading.routes.ts
 * Production-Oriented Fractional Digital Asset, Order Book & Trading Engine Controller.
 *
 * Implements:
 * 1. Configurable token precision (6 decimals = uSOV) & scaled fiat units (4 decimals = INR).
 * 2. Integer-only base unit arithmetic with zero floating point calculations.
 * 3. Server-authoritative double-entry audit ledger with available, locked, and pending balances.
 * 4. Deterministic price-time priority matching engine with limit & market orders and partial fills.
 * 5. Self-trade prevention, replay/duplicate order prevention, and atomic settlement.
 * 6. Indian VDA compliance gating: Section 194S 1% TDS withholding tracking & FIU-IND regulatory disclaimers.
 */

import http from 'node:http';
import {
  sovraDb,
  SOVRA_PRECISION_DECIMALS,
  SOVRA_BASE_UNIT_SCALE,
  FIAT_PRECISION_DECIMALS,
  FIAT_BASE_UNIT_SCALE,
  parseSovraToUsov,
  formatUsovToSovra,
  parseFiatToScaled,
  formatScaledToFiat,
} from '../database-engine.ts';
import type { AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';

export interface TradingRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, maxBytes: number) => Promise<{ body: string; ok: boolean }>;
  resolvePrincipal: (req: http.IncomingMessage) => AuthenticatedPrincipal | null;
  enforceAuth: (req: http.IncomingMessage, res: http.ServerResponse) => AuthenticatedPrincipal | null;
}

export async function handleTradingRoutes(ctx: TradingRouteContext): Promise<boolean> {
  const { req, res, url, readBoundedBody, resolvePrincipal, enforceAuth } = ctx;

  // 1. GET /api/trading/config - Fractional Token Parameters & Regulatory Status
  if (url.pathname === '/api/trading/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      asset: {
        symbol: 'SOVRA',
        name: 'Sovra Fractional Digital Asset',
        precisionDecimals: SOVRA_PRECISION_DECIMALS,
        baseUnitScale: SOVRA_BASE_UNIT_SCALE.toString(),
        smallestUnitName: 'uSOV (micro-SOVRA)',
        smallestUnitValue: '0.000001 SOV',
      },
      quoteCurrency: {
        symbol: 'INR',
        currencySign: '₹',
        precisionDecimals: FIAT_PRECISION_DECIMALS,
        baseUnitScale: FIAT_BASE_UNIT_SCALE.toString(),
        smallestUnitName: 'Scaled Unit (0.01 Paise)',
        smallestUnitValue: '₹0.0001',
      },
      tradingFees: {
        makerFeeBps: 10, // 0.10%
        takerFeeBps: 20, // 0.20%
        tdsWithholdingBps: 100, // 1.00% Indian Section 194S TDS on sale consideration
      },
      compliance: {
        mode: 'SANDBOX_INTERNAL_LEDGER',
        realFiatGatewayEnabled: false,
        fiuIndReportingStatus: 'INTERNAL_SANDBOX_READY',
        kycTiers: [
          { tier: 0, label: 'Unverified Sandbox', maxOrderValueFiat: '₹10,000' },
          { tier: 1, label: 'DID Key Verified Sandbox', maxOrderValueFiat: '₹1,00,000' },
          { tier: 2, label: 'FIU-IND Certified Account', maxOrderValueFiat: '₹10,00,000' },
        ],
        regulatoryNotice:
          'Sovra Internal Sandbox Digital Asset System — Server-authoritative double-entry ledger with integer base unit accounting. ' +
          'All assets are internal ledger balances and are NOT represented as an independently transferable public mainnet cryptocurrency ' +
          'or legal tender fiat. Real public trading and external money transfers remain strictly gated pending FIU-IND registration, ' +
          'banking approvals, and Section 194S TDS reporting infrastructure.',
      },
    }));
    return true;
  }

  // 2. GET /api/trading/wallet - Detailed User Balances & Ledger Snapshot
  if (url.pathname === '/api/trading/wallet' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    const userDid = url.searchParams.get('did') || principal?.did || 'did:sovra:guest_user';
    const balances = sovraDb.getDetailedUserBalance(userDid);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      wallet: balances,
    }));
    return true;
  }

  // 3. GET /api/trading/orderbook - Live Order Book Depth
  if (url.pathname === '/api/trading/orderbook' && req.method === 'GET') {
    const depth = sovraDb.getOrderBookDepth();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      orderBook: depth,
    }));
    return true;
  }

  // 4. GET /api/trading/trades - Real Executed Trades
  if (url.pathname === '/api/trading/trades' && req.method === 'GET') {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    const trades = sovraDb.getRecentTrades(limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      trades: trades.map(t => ({
        ...t,
        priceFormatted: formatScaledToFiat(t.priceScaled),
        quantityFormatted: formatUsovToSovra(t.quantityUsov) + ' SOV',
        grossFiatFormatted: formatScaledToFiat(t.grossFiatScaled),
        makerFeeFormatted: formatScaledToFiat(t.makerFeeScaled),
        takerFeeFormatted: formatScaledToFiat(t.takerFeeScaled),
        tdsWithheldFormatted: formatScaledToFiat(t.tdsWithheldScaled),
      })),
      count: trades.length,
    }));
    return true;
  }

  // 5. POST /api/trading/quote - Pre-Trade Indicative Price, Fee & TDS Calculation
  if (url.pathname === '/api/trading/quote' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body || '{}');
      const principal = resolvePrincipal(req);
      const userDid = parsed.did || principal?.did || 'did:sovra:guest_user';
      const rawSide = String(parsed.side || 'buy').toLowerCase();
      const side = rawSide === 'sell' ? 'sell' : 'buy';
      const rawType = String(parsed.orderType || 'limit').toLowerCase();
      const orderType = rawType === 'market' ? 'market' : 'limit';

      let quantityUsov: bigint | undefined;
      const rawQty = parsed.quantity ?? parsed.quantitySov ?? parsed.quantitySovra;
      if (rawQty !== undefined && rawQty !== null && String(rawQty).trim() !== '') {
        quantityUsov = parseSovraToUsov(rawQty);
      } else if (parsed.quantityUsov) {
        quantityUsov = BigInt(parsed.quantityUsov);
      }

      let budgetFiatScaled: bigint | undefined;
      const rawBudget = parsed.budget ?? parsed.budgetFiat ?? parsed.fiatBudgetInr;
      if (rawBudget !== undefined && rawBudget !== null && String(rawBudget).trim() !== '') {
        budgetFiatScaled = parseFiatToScaled(rawBudget);
      } else if (parsed.budgetFiatScaled) {
        budgetFiatScaled = BigInt(parsed.budgetFiatScaled);
      }

      let limitPriceScaled: bigint | undefined;
      const rawPrice = parsed.price ?? parsed.priceFiat ?? parsed.priceInr;
      if (rawPrice !== undefined && rawPrice !== null && String(rawPrice).trim() !== '') {
        limitPriceScaled = parseFiatToScaled(rawPrice);
      } else if (parsed.limitPriceScaled) {
        limitPriceScaled = BigInt(parsed.limitPriceScaled);
      }

      const quote = sovraDb.quoteTradingOrder({
        userDid,
        side,
        quantityUsov,
        budgetFiatScaled,
        orderType,
        limitPriceScaled,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(quote));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid quote request: ' + (err?.message || err) }));
    }
    return true;
  }

  // 6. POST /api/trading/order - Place Limit or Market Order with Atomic Matching
  if (url.pathname === '/api/trading/order' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body || '{}');
      const principal = resolvePrincipal(req);
      const userDid = parsed.did || principal?.did;
      if (!userDid) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Authentication required to place trading orders' }));
        return true;
      }

      const rawSide = String(parsed.side || 'buy').toLowerCase();
      const side = rawSide === 'sell' ? 'sell' : 'buy';
      const rawType = String(parsed.orderType || 'limit').toLowerCase();
      const orderType = rawType === 'market' ? 'market' : 'limit';

      let quantityUsov: bigint | undefined;
      const rawOrderQty = parsed.quantity ?? parsed.quantitySov ?? parsed.quantitySovra;
      if (rawOrderQty !== undefined && rawOrderQty !== null && String(rawOrderQty).trim() !== '') {
        quantityUsov = parseSovraToUsov(rawOrderQty);
      } else if (parsed.quantityUsov) {
        quantityUsov = BigInt(parsed.quantityUsov);
      }

      let budgetFiatScaled: bigint | undefined;
      const rawOrderBudget = parsed.budget ?? parsed.budgetFiat ?? parsed.fiatBudgetInr;
      if (rawOrderBudget !== undefined && rawOrderBudget !== null && String(rawOrderBudget).trim() !== '') {
        budgetFiatScaled = parseFiatToScaled(rawOrderBudget);
      } else if (parsed.budgetFiatScaled) {
        budgetFiatScaled = BigInt(parsed.budgetFiatScaled);
      }

      let priceScaled: bigint | undefined;
      const rawOrderPrice = parsed.price ?? parsed.priceFiat ?? parsed.priceInr;
      if (rawOrderPrice !== undefined && rawOrderPrice !== null && String(rawOrderPrice).trim() !== '') {
        priceScaled = parseFiatToScaled(rawOrderPrice);
      } else if (parsed.priceScaled) {
        priceScaled = BigInt(parsed.priceScaled);
      }

      const clientNonce = parsed.clientNonce ? String(parsed.clientNonce) : undefined;
      const isDemo = Boolean(parsed.isDemo !== false); // Defaults to true in sandbox

      const result = sovraDb.placeTradingOrder({
        userDid,
        side,
        orderType,
        quantityUsov,
        budgetFiatScaled,
        priceScaled,
        clientNonce,
        isDemo,
      });

      if (!result.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return true;
      }

      const updatedWallet = sovraDb.getDetailedUserBalance(userDid);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ...result,
        updatedWallet,
        message: result.fillsCount > 0
          ? `Order executed! Matched ${result.fillsCount} trade(s) on the order book.`
          : `Limit order placed on the order book at ${formatScaledToFiat(result.order!.priceScaled)}. Waiting for counterparty.`,
      }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Order execution error: ' + (err?.message || err) }));
    }
    return true;
  }

  // 7. POST /api/trading/order/cancel - Cancel Active Order & Unlock Reserved Assets
  if (url.pathname === '/api/trading/order/cancel' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body || '{}');
      const principal = resolvePrincipal(req);
      const userDid = parsed.did || principal?.did;
      const orderId = parsed.orderId ? String(parsed.orderId).trim() : '';

      if (!userDid || !orderId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'orderId and valid user identification required' }));
        return true;
      }

      const result = sovraDb.cancelTradingOrder(orderId, userDid);
      if (!result.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return true;
      }

      const updatedWallet = sovraDb.getDetailedUserBalance(userDid);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ...result,
        updatedWallet,
        message: `Order ${orderId} cancelled successfully. Unlocked assets returned to available balance.`,
      }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Cancel error: ' + (err?.message || err) }));
    }
    return true;
  }

  // 8. GET /api/trading/orders - User's Open & Past Orders
  if (url.pathname === '/api/trading/orders' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    const userDid = url.searchParams.get('did') || principal?.did || 'did:sovra:guest_user';
    const status = url.searchParams.get('status') || undefined;

    const orders = sovraDb.getUserTradingOrders(userDid, status);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      orders: orders.map(o => ({
        ...o,
        priceFormatted: formatScaledToFiat(o.priceScaled),
        quantityFormatted: formatUsovToSovra(o.quantityUsov) + ' SOV',
        remainingFormatted: formatUsovToSovra(o.remainingUsov) + ' SOV',
        filledFormatted: formatUsovToSovra(o.filledUsov) + ' SOV',
      })),
      count: orders.length,
    }));
    return true;
  }

  // 9. GET /api/trading/ledger - User's Double-Entry Audit Ledger
  if (url.pathname === '/api/trading/ledger' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    const userDid = url.searchParams.get('did') || principal?.did || 'did:sovra:guest_user';
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));

    const ledger = sovraDb.getUserTradingLedger(userDid, limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      ledger: ledger.map(l => ({
        ...l,
        amountTokensFormatted: l.amountBaseUnits ? formatUsovToSovra(l.amountBaseUnits) + ' SOV' : undefined,
        amountFiatFormatted: l.amountFiatScaled ? formatScaledToFiat(l.amountFiatScaled) : undefined,
        balanceTokensFormatted: formatUsovToSovra(l.balanceTokensAfterUsov) + ' SOV',
        balanceFiatFormatted: formatScaledToFiat(l.balanceFiatAfterScaled),
      })),
      count: ledger.length,
    }));
    return true;
  }

  // 10. POST /api/trading/fiat/deposit - Sandbox Paper-Trading Fiat Funding
  if (url.pathname === '/api/trading/fiat/deposit' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body || '{}');
      const principal = resolvePrincipal(req);
      const userDid = parsed.did || principal?.did || 'did:sovra:guest_user';

      let amountScaled: bigint = 100_000_000n; // Default ₹10,000.0000 test credits
      if (parsed.amount || parsed.amountFiat) {
        amountScaled = parseFiatToScaled(parsed.amount || parsed.amountFiat);
      } else if (parsed.amountScaled) {
        amountScaled = BigInt(parsed.amountScaled);
      }

      if (amountScaled <= 0n) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Deposit amount must be positive' }));
        return true;
      }

      const result = sovraDb.depositSandboxFiat({ userDid, amountScaled });
      const balances = sovraDb.getDetailedUserBalance(userDid);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ...result,
        wallet: balances,
        message: `🎁 ${formatScaledToFiat(amountScaled)} Sandbox Paper-Trading Credits added to wallet!`,
      }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Deposit error: ' + (err?.message || err) }));
    }
    return true;
  }

  // 11. GET /api/trading/stats - Global Order Book & TDS Withholding Analytics
  if (url.pathname === '/api/trading/stats' && req.method === 'GET') {
    const stats = sovraDb.getTradingStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      stats,
      complianceNotice: 'All data reflects deterministic double-entry sandbox ledger state.',
    }));
    return true;
  }

  // 12. POST /api/admin/trading/circuit-breaker - Administrative Emergency Halt Switch
  if (url.pathname === '/api/admin/trading/circuit-breaker' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body || '{}');
      const principal = resolvePrincipal(req);
      const adminDid = parsed.adminDid || principal?.did || 'did:sovra:admin';
      const halt = Boolean(parsed.halt);
      const reason = parsed.reason || (halt ? 'Administrative protocol circuit breaker activated' : 'Circuit breaker lifted by admin');

      const isHalted = sovraDb.setTradingHalted(halt, adminDid, reason);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        tradingHalted: isHalted,
        action: isHalted ? 'HALTED' : 'RESUMED',
        reason,
        timestamp: Date.now(),
      }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Circuit breaker error: ' + (err?.message || err) }));
    }
    return true;
  }

  return false;
}
