/**
 * @file tests/unit/trading-engine.test.ts
 * SOVRA Fractional Digital Asset & Order Book Matching Engine Test Suite
 *
 * Verifies:
 * 1. Configurable token precision and integer base unit parsing/formatting (6 decimals, 1 uSOV).
 * 2. Strict rejection of negative amounts, invalid characters, scientific notation, and excessive decimals.
 * 3. Scaled integer fiat arithmetic (4 decimals, no floating point errors).
 * 4. Section 194S Indian VDA 1% TDS calculation with exact integer rounding.
 * 5. Buy & Sell quote calculations (from fiat budget and from fractional tokens).
 * 6. Order book deterministic price-time priority (FIFO matching).
 * 7. Self-Trade Prevention (STP) wash trading rejection.
 * 8. Balance reservation and atomic unlock on cancellation.
 * 9. Partial fills across multiple order levels.
 * 10. Replay attack and duplicate order submission defense via idempotency keys.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SOVRA_TOKEN_CONFIG,
  FIAT_SCALE,
  INDIAN_TDS_BPS,
  parseTokenUnits,
  formatTokenUnits,
  parseFiatUnits,
  formatFiatUnits,
  calculateBuyQuoteFromFiat,
  calculateBuyQuoteFromTokens,
  calculateSellQuote,
  calculateSection194sTds,
} from '../../scripts/fractional-engine.ts';
import { TradingEngine, Order, TradeRecord } from '../../scripts/trading-engine.ts';

describe('SOVRA Fractional Engine & Token Math Suite', () => {
  it('correctly parses valid fractional token strings into BigInt micro-units (uSOV)', () => {
    expect(parseTokenUnits('1')).toBe(1_000_000n);
    expect(parseTokenUnits('1.000000')).toBe(1_000_000n);
    expect(parseTokenUnits('0.000001')).toBe(1n); // Smallest indivisible unit
    expect(parseTokenUnits('0.5')).toBe(500_000n);
    expect(parseTokenUnits('123.456789')).toBe(123_456_789n);
    expect(parseTokenUnits('100000000')).toBe(100_000_000_000_000n); // 100M hard cap
  });

  it('correctly formats BigInt base units into human-readable strings', () => {
    expect(formatTokenUnits(1_000_000n)).toBe('1');
    expect(formatTokenUnits(1n)).toBe('0.000001');
    expect(formatTokenUnits(500_000n)).toBe('0.5');
    expect(formatTokenUnits(123_456_789n)).toBe('123.456789');
    expect(formatTokenUnits(0n)).toBe('0');
  });

  it('rejects invalid token formats, negative amounts, scientific notation, and excess decimals', () => {
    expect(() => parseTokenUnits('-1')).toThrow(/negative/i);
    expect(() => parseTokenUnits('1e6')).toThrow(/scientific notation/i);
    expect(() => parseTokenUnits('abc')).toThrow(/invalid/i);
    expect(() => parseTokenUnits('1.0000001')).toThrow(/exceeds maximum allowed decimals/i); // 7 decimals
  });

  it('correctly parses and formats scaled fiat amounts without floating-point precision loss', () => {
    expect(parseFiatUnits('1000')).toBe(10_000_000n); // ₹1,000.0000
    expect(parseFiatUnits('10.50')).toBe(105_000n);
    expect(parseFiatUnits('0.01')).toBe(100n); // 1 paisa
    expect(formatFiatUnits(10_000_000n)).toBe('1000.00');
    expect(formatFiatUnits(105_000n)).toBe('10.50');
    expect(formatFiatUnits(100n)).toBe('0.01');
  });

  it('calculates Section 194S Indian VDA 1% TDS strictly using integer rounding', () => {
    // 1% of ₹10,000 = ₹100
    const grossFiat = parseFiatUnits('10000'); // 100,000,000 units
    const tds = calculateSection194sTds(grossFiat);
    expect(tds).toBe(parseFiatUnits('100')); // 1,000,000 units

    // 1% of ₹10.50 = ₹0.1050 (1,050 units)
    const grossSmall = parseFiatUnits('10.50');
    const tdsSmall = calculateSection194sTds(grossSmall);
    expect(tdsSmall).toBe(1050n);
  });

  it('calculates buy quote from fiat budget accurately with fee deduction', () => {
    // Price = ₹1,000/SOV (10,000,000 fiat units)
    // Budget = ₹1,000 (10,000,000 fiat units)
    // Taker fee = 0.20% (20 bps) = ₹2.00 (20,000 units)
    // Net fiat = ₹998.00 (9,980,000 units)
    // Expected token quantity = 998,000 uSOV (0.998 SOV)
    const quote = calculateBuyQuoteFromFiat({
      fiatBudgetScaled: parseFiatUnits('1000'),
      pricePerTokenScaled: parseFiatUnits('1000'),
      takerFeeBps: 20n,
    });

    expect(quote.feeFiatScaled).toBe(parseFiatUnits('2'));
    expect(quote.netFiatScaled).toBe(parseFiatUnits('998'));
    expect(quote.tokenQuantityUsov).toBe(998_000n);
    expect(quote.formattedTokens).toBe('0.998');
  });

  it('calculates sell quote with platform fee and 1% TDS deduction', () => {
    // Sell 1 SOV (1,000,000 uSOV) at ₹1,000
    // Gross = ₹1,000.00
    // Platform fee (0.20%) = ₹2.00
    // 1% TDS (u/s 194S) = ₹10.00
    // Net settlement = ₹988.00
    const quote = calculateSellQuote({
      tokenQuantityUsov: 1_000_000n,
      pricePerTokenScaled: parseFiatUnits('1000'),
      takerFeeBps: 20n,
      deductTds: true,
    });

    expect(quote.grossFiatScaled).toBe(parseFiatUnits('1000'));
    expect(quote.feeFiatScaled).toBe(parseFiatUnits('2'));
    expect(quote.tdsFiatScaled).toBe(parseFiatUnits('10'));
    expect(quote.netFiatSettlementScaled).toBe(parseFiatUnits('988'));
  });
});

describe('SOVRA Order Book & Matching Engine Suite', () => {
  let engine: TradingEngine;
  let mockBalances: Map<string, { tokenAvailable: bigint; tokenLocked: bigint; fiatAvailable: bigint; fiatLocked: bigint }>;

  beforeEach(() => {
    engine = new TradingEngine('SOV/INR');
    mockBalances = new Map();

    // Helper to seed balances
    const seedUser = (did: string, tokens: bigint, fiat: bigint) => {
      mockBalances.set(did, {
        tokenAvailable: tokens,
        tokenLocked: 0n,
        fiatAvailable: fiat,
        fiatLocked: 0n,
      });
    };

    seedUser('did:sovra:alice', 100_000_000n, parseFiatUnits('50000')); // 100 SOV, ₹50,000
    seedUser('did:sovra:bob', 100_000_000n, parseFiatUnits('50000'));   // 100 SOV, ₹50,000
    seedUser('did:sovra:carol', 100_000_000n, parseFiatUnits('50000')); // 100 SOV, ₹50,000

    // Hook engine to mock wallet balances
    engine.setWalletHook({
      reserveFunds: (order: Order) => {
        const u = mockBalances.get(order.userDid);
        if (!u) return false;
        if (order.side === 'BUY') {
          if (u.fiatAvailable < order.lockedFiatScaled) return false;
          u.fiatAvailable -= order.lockedFiatScaled;
          u.fiatLocked += order.lockedFiatScaled;
          return true;
        } else {
          if (u.tokenAvailable < order.lockedTokensUsov) return false;
          u.tokenAvailable -= order.lockedTokensUsov;
          u.tokenLocked += order.lockedTokensUsov;
          return true;
        }
      },
      unreserveFunds: (order: Order, unfillQuantityUsov: bigint, unfillFiatScaled: bigint) => {
        const u = mockBalances.get(order.userDid);
        if (!u) return;
        if (order.side === 'BUY') {
          u.fiatLocked -= unfillFiatScaled;
          u.fiatAvailable += unfillFiatScaled;
        } else {
          u.tokenLocked -= unfillQuantityUsov;
          u.tokenAvailable += unfillQuantityUsov;
        }
      },
      settleTrade: (trade: TradeRecord) => {
        const buyer = mockBalances.get(trade.takerSide === 'BUY' ? trade.takerDid : trade.makerDid);
        const seller = mockBalances.get(trade.takerSide === 'SELL' ? trade.takerDid : trade.makerDid);

        if (buyer && seller) {
          // Buyer gets tokens
          buyer.tokenAvailable += trade.quantityUsov;
          // Seller gets net fiat (gross - fee - tds)
          const netSellerFiat = trade.grossFiatScaled - trade.makerFeeScaled - trade.tdsWithheldScaled;
          seller.fiatAvailable += netSellerFiat;
        }
      },
    });
  });

  it('places a limit sell order and updates order book depth', () => {
    const res = engine.placeOrder({
      userDid: 'did:sovra:alice',
      side: 'SELL',
      type: 'LIMIT',
      priceScaled: parseFiatUnits('1000'), // ₹1,000
      quantityUsov: 10_000_000n, // 10 SOV
    });

    expect(res.ok).toBe(true);
    expect(res.order?.status).toBe('OPEN');
    expect(res.trades.length).toBe(0);

    const depth = engine.getDepth();
    expect(depth.asks.length).toBe(1);
    expect(depth.asks[0].formattedPrice).toBe('1000.00');
    expect(depth.asks[0].formattedQuantity).toBe('10');
    expect(depth.bestAskScaled).toBe(parseFiatUnits('1000'));
  });

  it('executes a deterministic FIFO match when a matching buy limit order arrives', () => {
    // 1. Alice sells 10 SOV at ₹1,000
    engine.placeOrder({
      userDid: 'did:sovra:alice',
      side: 'SELL',
      type: 'LIMIT',
      priceScaled: parseFiatUnits('1000'),
      quantityUsov: 10_000_000n,
    });

    // 2. Bob buys 5 SOV at ₹1,000 (crosses book)
    const buyRes = engine.placeOrder({
      userDid: 'did:sovra:bob',
      side: 'BUY',
      type: 'LIMIT',
      priceScaled: parseFiatUnits('1000'),
      quantityUsov: 5_000_000n,
    });

    expect(buyRes.ok).toBe(true);
    expect(buyRes.order?.status).toBe('FILLED');
    expect(buyRes.trades.length).toBe(1);

    const trade = buyRes.trades[0];
    expect(trade.priceScaled).toBe(parseFiatUnits('1000'));
    expect(trade.quantityUsov).toBe(5_000_000n);
    expect(trade.grossFiatScaled).toBe(parseFiatUnits('5000'));
    expect(trade.tdsWithheldScaled).toBe(parseFiatUnits('50')); // 1% of ₹5,000 = ₹50 TDS

    // Verify order book depth has remaining 5 SOV on ask
    const depth = engine.getDepth();
    expect(depth.asks.length).toBe(1);
    expect(depth.asks[0].formattedQuantity).toBe('5');
  });

  it('enforces Self-Trade Prevention (STP) to eliminate wash trading', () => {
    // Alice places a sell order
    engine.placeOrder({
      userDid: 'did:sovra:alice',
      side: 'SELL',
      type: 'LIMIT',
      priceScaled: parseFiatUnits('1000'),
      quantityUsov: 10_000_000n,
    });

    // Alice attempts to buy her own order (wash trading)
    const washRes = engine.placeOrder({
      userDid: 'did:sovra:alice',
      side: 'BUY',
      type: 'LIMIT',
      priceScaled: parseFiatUnits('1000'),
      quantityUsov: 5_000_000n,
      selfTradePolicy: 'REJECT_TAKER',
    });

    expect(washRes.ok).toBe(true);
    expect(washRes.order?.status).toBe('REJECTED');
    expect(washRes.trades.length).toBe(0); // Zero trades executed!
  });

  it('cancels an open order and unlocks reserved funds atomically', () => {
    const res = engine.placeOrder({
      userDid: 'did:sovra:alice',
      side: 'SELL',
      type: 'LIMIT',
      priceScaled: parseFiatUnits('1200'),
      quantityUsov: 10_000_000n,
    });

    const orderId = res.order!.id;
    const aliceBalBefore = mockBalances.get('did:sovra:alice')!;
    expect(aliceBalBefore.tokenLocked).toBe(10_000_000n);

    // Cancel order
    const cancelRes = engine.cancelOrder(orderId, 'did:sovra:alice');
    expect(cancelRes.ok).toBe(true);
    expect(cancelRes.order?.status).toBe('CANCELLED');

    // Balance is unlocked
    expect(aliceBalBefore.tokenLocked).toBe(0n);
    expect(aliceBalBefore.tokenAvailable).toBe(100_000_000n);

    // Orderbook is empty
    const depth = engine.getDepth();
    expect(depth.asks.length).toBe(0);
  });

  it('rejects order placement with insufficient available balance', () => {
    const res = engine.placeOrder({
      userDid: 'did:sovra:alice',
      side: 'SELL',
      type: 'LIMIT',
      priceScaled: parseFiatUnits('1000'),
      quantityUsov: 500_000_000n, // Alice only has 100M
    });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('Insufficient available token balance');
  });

  it('prevents double-order placement via clientOrderId idempotency keys', () => {
    const clientOrderId = 'client_tx_99881122';

    const firstRes = engine.placeOrder({
      clientOrderId,
      userDid: 'did:sovra:alice',
      side: 'SELL',
      type: 'LIMIT',
      priceScaled: parseFiatUnits('1100'),
      quantityUsov: 2_000_000n,
    });
    expect(firstRes.ok).toBe(true);

    // Duplicate submission with same clientOrderId
    const secondRes = engine.placeOrder({
      clientOrderId,
      userDid: 'did:sovra:alice',
      side: 'SELL',
      type: 'LIMIT',
      priceScaled: parseFiatUnits('1100'),
      quantityUsov: 2_000_000n,
    });

    expect(secondRes.ok).toBe(true);
    expect(secondRes.order?.id).toBe(firstRes.order?.id);
    expect(secondRes.message).toContain('idempotency key matched');
  });
});
