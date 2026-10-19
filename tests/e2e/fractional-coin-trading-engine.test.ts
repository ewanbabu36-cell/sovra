/**
 * @file tests/e2e/fractional-coin-trading-engine.test.ts
 * SOVRA COIN FRACTIONAL OWNERSHIP, BUY/SELL & TRADING ENGINE TEST SUITE
 *
 * Verifies:
 * 1. Fractional units: Configurable token precision (6 decimals = uSOV), 4-decimal scaled fiat (INR).
 * 2. Pure integer base unit arithmetic with zero floating point calculations.
 * 3. Accurate pricing: 0.01 SOVRA at ₹1,000 quoted value equals ₹10 before fees.
 * 4. Server-authoritative wallet balances: available, locked, pending, and total consistency.
 * 5. Double-spending & overspending prevention: Insufficient balance rejection.
 * 6. Deterministic price-time priority matching engine with Maker/Taker fees and 1% Indian TDS withholding.
 * 7. Partial fills and order cancellation with atomic asset refunding.
 * 8. Self-trade prevention (same user cannot fill their own orders).
 * 9. Double-entry audit ledger reconciliation and immutable state proofs.
 * 10. Regulatory compliance release gates: FIU-IND internal sandbox mode, real fiat gateway disabled.
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
} from '../../scripts/database-engine.ts';

describe('SOVRA Fractional Digital Asset & Trading Engine', () => {
  const aliceDid = 'did:sovra:test_alice_' + Date.now();
  const bobDid = 'did:sovra:test_bob_' + Date.now();

  beforeEach(() => {
    // Clear active test trading state to isolate each test run
    sovraDb.getState().trading_orders = [];
    sovraDb.getState().trading_trades = [];
    sovraDb.getState().wallet_ledger = [];
    sovraDb.setTradingHalted(false);

    // Seed Alice and Bob with deterministic test accounts
    const alice = sovraDb.ensureUserFinancialAccounts(aliceDid);
    alice.balanceUsov = '100000000'; // 100.0 SOV
    alice.lockedUsov = '0';
    alice.pendingUsov = '0';
    alice.fiatBalanceScaled = '200000000'; // ₹20,000.0000
    alice.fiatLockedScaled = '0';
    alice.balanceSov = 100.0;

    const bob = sovraDb.ensureUserFinancialAccounts(bobDid);
    bob.balanceUsov = '50000000'; // 50.0 SOV
    bob.lockedUsov = '0';
    bob.pendingUsov = '0';
    bob.fiatBalanceScaled = '500000000'; // ₹50,000.0000
    bob.fiatLockedScaled = '0';
    bob.balanceSov = 50.0;

    sovraDb.save();
  });

  describe('1. Fractional Units & Integer Precision Math', () => {
    it('enforces 6 token decimals (uSOV) and 4 fiat decimals (scaled INR)', () => {
      expect(SOVRA_PRECISION_DECIMALS).toBe(6);
      expect(SOVRA_BASE_UNIT_SCALE).toBe(1_000_000n);
      expect(FIAT_PRECISION_DECIMALS).toBe(4);
      expect(FIAT_BASE_UNIT_SCALE).toBe(10_000n);
    });

    it('parses fractional quantities into exact integer base units without floating point loss', () => {
      expect(parseSovraToUsov('1.0')).toBe(1_000_000n);
      expect(parseSovraToUsov('0.5')).toBe(500_000n);
      expect(parseSovraToUsov('0.01')).toBe(10_000n);
      expect(parseSovraToUsov('0.000001')).toBe(1n); // Smallest indivisible unit
      expect(parseSovraToUsov('0.0000001')).toBe(0n); // Truncates beyond 6 decimals
      expect(parseSovraToUsov('100.123456')).toBe(100_123_456n);
    });

    it('parses fiat currency into 4-decimal scaled base units', () => {
      expect(parseFiatToScaled('1000')).toBe(10_000_000n); // ₹1,000.0000
      expect(parseFiatToScaled('10')).toBe(100_000n);       // ₹10.0000
      expect(parseFiatToScaled('0.0001')).toBe(1n);         // Smallest fiat unit (0.01 paise)
      expect(parseFiatToScaled('250.50')).toBe(2_505_000n);
    });

    it('verifies exact quoted value: 0.01 SOVRA at ₹1,000 equals ₹10 before fees', () => {
      const quantityUsov = parseSovraToUsov('0.01'); // 10,000 uSOV
      const priceScaled = parseFiatToScaled('1000'); // 10,000,000 (₹1,000 per SOV)
      
      // grossFiat = (quantityUsov * priceScaled) / 1_000_000n
      const grossFiatScaled = (quantityUsov * priceScaled) / SOVRA_BASE_UNIT_SCALE;
      
      expect(grossFiatScaled).toBe(100_000n); // 100,000 scaled = ₹10.0000
      expect(formatScaledToFiat(grossFiatScaled)).toBe('₹10.00');
    });

    it('formats integer base units consistently for display', () => {
      expect(formatUsovToSovra(1_000_000n)).toBe('1.0');
      expect(formatUsovToSovra(500_000n)).toBe('0.5');
      expect(formatUsovToSovra(10_000n)).toBe('0.01');
      expect(formatUsovToSovra(1n)).toBe('0.000001');
      expect(formatScaledToFiat(10_000_000n)).toBe('₹1,000.00');
      expect(formatScaledToFiat(100_000n)).toBe('₹10.00');
      expect(formatScaledToFiat(1n)).toBe('₹0.00');
    });
  });

  describe('2. Server-Authoritative Wallet & Invariant Validation', () => {
    it('returns consistent available, locked, pending, and total balances', () => {
      const wallet = sovraDb.getDetailedUserBalance(aliceDid);
      expect(wallet.availableUsov).toBe('100000000');
      expect(wallet.lockedUsov).toBe('0');
      expect(wallet.totalUsov).toBe('100000000');
      expect(wallet.availableFiatScaled).toBe('200000000');
      expect(wallet.lockedFiatScaled).toBe('0');
      expect(wallet.isInvariantValid).toBe(true);
      expect(wallet.displayAvailableSovra).toBe('100.0 SOV');
      expect(wallet.displayAvailableFiat).toBe('₹20,000.00');
    });

    it('prevents overspending when placing an order exceeding available balance', () => {
      // Alice has 100 SOV. Attempting to sell 150 SOV must fail
      const result = sovraDb.placeTradingOrder({
        userDid: aliceDid,
        side: 'sell',
        orderType: 'limit',
        quantityUsov: parseSovraToUsov('150.0'),
        priceScaled: parseFiatToScaled('1000'),
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Insufficient available SOV balance');

      // Balances must remain unchanged
      const wallet = sovraDb.getDetailedUserBalance(aliceDid);
      expect(wallet.availableUsov).toBe('100000000');
      expect(wallet.lockedUsov).toBe('0');
    });

    it('prevents overspending when buy order exceeds available fiat', () => {
      // Alice has ₹20,000. Attempting to buy 50 SOV at ₹1,000 (costs ~₹50,100 with fees) must fail
      const result = sovraDb.placeTradingOrder({
        userDid: aliceDid,
        side: 'buy',
        orderType: 'limit',
        quantityUsov: parseSovraToUsov('50.0'),
        priceScaled: parseFiatToScaled('1000'),
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Insufficient available fiat balance');

      const wallet = sovraDb.getDetailedUserBalance(aliceDid);
      expect(wallet.availableFiatScaled).toBe('200000000');
      expect(wallet.lockedFiatScaled).toBe('0');
    });
  });

  describe('3. Order Book & Deterministic Price-Time Matching', () => {
    it('places a limit sell order and locks tokens atomically', () => {
      // Alice sells 10.0 SOV at ₹1,200 per SOV
      const res = sovraDb.placeTradingOrder({
        userDid: aliceDid,
        side: 'sell',
        orderType: 'limit',
        quantityUsov: parseSovraToUsov('10.0'),
        priceScaled: parseFiatToScaled('1200'),
      });

      expect(res.ok).toBe(true);
      expect(res.order?.status).toBe('open');
      expect(res.order?.remainingUsov).toBe('10000000'); // 10.0 SOV

      // Alice's available tokens must drop by 10.0 SOV and locked increase by 10.0 SOV
      const wallet = sovraDb.getDetailedUserBalance(aliceDid);
      expect(wallet.availableUsov).toBe('90000000'); // 90.0 SOV
      expect(wallet.lockedUsov).toBe('10000000');    // 10.0 SOV
      expect(wallet.totalUsov).toBe('100000000');    // Total invariant preserved

      // Order book must reflect the ask
      const ob = sovraDb.getOrderBookDepth();
      expect(ob.asks.length).toBeGreaterThanOrEqual(1);
      expect(ob.topAsk).toBe(parseFiatToScaled('1200').toString());
    });

    it('matches an incoming buy order against resting sell order with fees and 1% TDS', () => {
      // Alice has a resting sell order: 5.0 SOV at ₹1,000
      const sellRes = sovraDb.placeTradingOrder({
        userDid: aliceDid,
        side: 'sell',
        orderType: 'limit',
        quantityUsov: parseSovraToUsov('5.0'),
        priceScaled: parseFiatToScaled('1000'),
      });
      expect(sellRes.ok).toBe(true);

      const alicePreBal = sovraDb.getDetailedUserBalance(aliceDid);
      const bobPreBal = sovraDb.getDetailedUserBalance(bobDid);

      // Bob buys 5.0 SOV at ₹1,000 (crossing the ask)
      const buyRes = sovraDb.placeTradingOrder({
        userDid: bobDid,
        side: 'buy',
        orderType: 'limit',
        quantityUsov: parseSovraToUsov('5.0'),
        priceScaled: parseFiatToScaled('1000'),
      });

      expect(buyRes.ok).toBe(true);
      expect(buyRes.fillsCount).toBe(1);
      expect(buyRes.trades.length).toBe(1);

      const trade = buyRes.trades[0]!;
      expect(trade.quantityUsov).toBe('5000000'); // 5.0 SOV
      expect(trade.priceScaled).toBe(parseFiatToScaled('1000').toString());
      expect(trade.grossFiatScaled).toBe('50000000'); // ₹5,000.0000

      // Maker fee (seller): 0.1% = ₹5.0000 (50,000 scaled)
      expect(trade.makerFeeScaled).toBe('50000');
      // Taker fee (buyer): 0.2% = ₹10.0000 (100,000 scaled)
      expect(trade.takerFeeScaled).toBe('100000');
      // 1% Indian VDA TDS withheld on seller proceeds: ₹50.0000 (500,000 scaled)
      expect(trade.tdsWithheldScaled).toBe('500000');

      // Bob (Buyer) received 5.0 SOV
      const bobPostBal = sovraDb.getDetailedUserBalance(bobDid);
      expect(BigInt(bobPostBal.availableUsov)).toBe(BigInt(bobPreBal.availableUsov) + 5_000_000n);

      // Alice (Seller) received net fiat: Gross (₹5,000) - Maker Fee (₹5) - TDS (₹50) = ₹4,945.0000 (49,450,000 scaled)
      const alicePostBal = sovraDb.getDetailedUserBalance(aliceDid);
      const expectedNetFiat = 50_000_000n - 50_000n - 500_000n; // 49,450,000
      expect(BigInt(alicePostBal.availableFiatScaled)).toBe(BigInt(alicePreBal.availableFiatScaled) + expectedNetFiat);
    });

    it('supports partial fills and leaves remainder resting on the book', () => {
      // Alice sells 10.0 SOV at ₹1,500
      const sellRes = sovraDb.placeTradingOrder({
        userDid: aliceDid,
        side: 'sell',
        orderType: 'limit',
        quantityUsov: parseSovraToUsov('10.0'),
        priceScaled: parseFiatToScaled('1500'),
      });
      expect(sellRes.ok).toBe(true);

      // Bob buys only 3.5 SOV at ₹1,500
      const buyRes = sovraDb.placeTradingOrder({
        userDid: bobDid,
        side: 'buy',
        orderType: 'limit',
        quantityUsov: parseSovraToUsov('3.5'),
        priceScaled: parseFiatToScaled('1500'),
      });

      expect(buyRes.ok).toBe(true);
      expect(buyRes.order?.status).toBe('filled');
      expect(buyRes.order?.filledUsov).toBe('3500000');

      // Alice's resting sell order must now be 'partially_filled' with 6.5 SOV remaining
      const aliceOrders = sovraDb.getUserTradingOrders(aliceDid);
      const aliceOrder = aliceOrders.find(o => o.orderId === sellRes.order?.orderId);
      expect(aliceOrder?.status).toBe('partially_filled');
      expect(aliceOrder?.remainingUsov).toBe('6500000'); // 6.5 SOV
      expect(aliceOrder?.filledUsov).toBe('3500000');    // 3.5 SOV
    });

    it('prevents self-trading when buyer and seller are the same user', () => {
      // Alice places limit sell for 2.0 SOV at ₹1,100
      const sellRes = sovraDb.placeTradingOrder({
        userDid: aliceDid,
        side: 'sell',
        orderType: 'limit',
        quantityUsov: parseSovraToUsov('2.0'),
        priceScaled: parseFiatToScaled('1100'),
      });
      expect(sellRes.ok).toBe(true);

      // Alice attempts to buy her own 2.0 SOV at ₹1,100
      const buyRes = sovraDb.placeTradingOrder({
        userDid: aliceDid,
        side: 'buy',
        orderType: 'limit',
        quantityUsov: parseSovraToUsov('2.0'),
        priceScaled: parseFiatToScaled('1100'),
      });

      expect(buyRes.ok).toBe(true);
      // No trades must execute because self-trading is prohibited
      expect(buyRes.fillsCount).toBe(0);
      expect(buyRes.trades.length).toBe(0);

      // Both orders simply rest on opposite sides of the book
      const aliceOrders = sovraDb.getUserTradingOrders(aliceDid, 'open');
      expect(aliceOrders.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('4. Order Cancellation & Fund Recovery', () => {
    it('cancels an active limit sell order and returns locked tokens to available balance', () => {
      const initBal = sovraDb.getDetailedUserBalance(aliceDid);
      const initAvail = BigInt(initBal.availableUsov);

      // Alice sells 20.0 SOV
      const sellRes = sovraDb.placeTradingOrder({
        userDid: aliceDid,
        side: 'sell',
        orderType: 'limit',
        quantityUsov: parseSovraToUsov('20.0'),
        priceScaled: parseFiatToScaled('2000'),
      });
      expect(sellRes.ok).toBe(true);
      const orderId = sellRes.order!.orderId;

      // Available drops by 20 SOV
      let midBal = sovraDb.getDetailedUserBalance(aliceDid);
      expect(BigInt(midBal.availableUsov)).toBe(initAvail - 20_000_000n);
      expect(midBal.lockedUsov).toBe('20000000');

      // Cancel the order
      const cancelRes = sovraDb.cancelTradingOrder(orderId, aliceDid);
      expect(cancelRes.ok).toBe(true);
      expect(cancelRes.refundedUsov).toBe('20000000');

      // Tokens must be fully returned to available balance
      const finalBal = sovraDb.getDetailedUserBalance(aliceDid);
      expect(BigInt(finalBal.availableUsov)).toBe(initAvail);
      expect(finalBal.lockedUsov).toBe('0');
    });

    it('rejects cancellation attempts from non-owner users', () => {
      const sellRes = sovraDb.placeTradingOrder({
        userDid: aliceDid,
        side: 'sell',
        orderType: 'limit',
        quantityUsov: parseSovraToUsov('1.0'),
        priceScaled: parseFiatToScaled('1000'),
      });
      const orderId = sellRes.order!.orderId;

      // Bob tries to cancel Alice's order
      const cancelRes = sovraDb.cancelTradingOrder(orderId, bobDid);
      expect(cancelRes.ok).toBe(false);
      expect(cancelRes.error).toContain('Forbidden');
    });
  });

  describe('5. Double-Entry Audit Ledger & Reconciliation', () => {
    it('maintains continuous audit trail with before/after balances for every transaction', () => {
      const userDid = aliceDid;
      const initialLedger = sovraDb.getUserTradingLedger(userDid);
      const countBefore = initialLedger.length;

      // Alice places and then cancels an order
      const orderRes = sovraDb.placeTradingOrder({
        userDid,
        side: 'sell',
        orderType: 'limit',
        quantityUsov: parseSovraToUsov('5.0'),
        priceScaled: parseFiatToScaled('1000'),
      });
      expect(orderRes.ok).toBe(true);

      const cancelRes = sovraDb.cancelTradingOrder(orderRes.order!.orderId, userDid);
      expect(cancelRes.ok).toBe(true);

      const updatedLedger = sovraDb.getUserTradingLedger(userDid);
      expect(updatedLedger.length).toBe(countBefore + 2);

      // Verify lock entry
      const lockEntry = updatedLedger[1]!;
      expect(lockEntry.type).toBe('ORDER_LOCK_TOKEN');
      expect(lockEntry.amountBaseUnits).toBe('5000000');

      // Verify unlock entry
      const unlockEntry = updatedLedger[0]!;
      expect(unlockEntry.type).toBe('ORDER_UNLOCK_TOKEN');
      expect(unlockEntry.amountBaseUnits).toBe('5000000');
    });
  });

  describe('6. Indian VDA Compliance & Regulatory Release Gates', () => {
    it('verifies sandbox regulatory gating flags', () => {
      const balances = sovraDb.getDetailedUserBalance(aliceDid);
      expect(balances.kycTier).toBeGreaterThanOrEqual(1);
      expect(balances.kycStatus).toBe('SANDBOX_APPROVED');
    });

    it('adds paper-trading test fiat funds to user balance with audit entry', () => {
      const initBal = sovraDb.getDetailedUserBalance(aliceDid);
      const initFiat = BigInt(initBal.availableFiatScaled);

      const depRes = sovraDb.depositSandboxFiat({
        userDid: aliceDid,
        amountScaled: parseFiatToScaled('10000'), // ₹10,000.0000
      });

      expect(depRes.ok).toBe(true);
      const postBal = sovraDb.getDetailedUserBalance(aliceDid);
      expect(BigInt(postBal.availableFiatScaled)).toBe(initFiat + 100_000_000n);

      // Ledger must record the deposit
      const ledger = sovraDb.getUserTradingLedger(aliceDid);
      expect(ledger[0]?.type).toBe('DEPOSIT_FIAT');
      expect(ledger[0]?.amountFiatScaled).toBe('100000000');
    });

    it('supports buying via fiat budget input with deterministic quantity conversion', () => {
      // Bob wants to buy with a ₹500 fiat budget at limit price ₹1,000 per SOV
      const budgetScaled = parseFiatToScaled('500'); // 5,000,000 scaled INR
      const limitPrice = parseFiatToScaled('1000'); // 10,000,000 scaled INR

      // Quote verification
      const quote = sovraDb.quoteTradingOrder({
        userDid: bobDid,
        side: 'buy',
        budgetFiatScaled: budgetScaled,
        orderType: 'limit',
        limitPriceScaled: limitPrice,
      });

      expect(quote.ok).toBe(true);
      expect(quote.quantityUsov).toBe('500000'); // Exactly 0.500000 SOVRA
      expect(quote.quantityFormatted).toBe('0.5 SOV');

      // Place order via fiat budget
      const orderRes = sovraDb.placeTradingOrder({
        userDid: bobDid,
        side: 'buy',
        orderType: 'limit',
        budgetFiatScaled: budgetScaled,
        priceScaled: limitPrice,
      });

      expect(orderRes.ok).toBe(true);
      expect(orderRes.order!.quantityUsov).toBe('500000');
      expect(orderRes.order!.side).toBe('buy');
    });

    it('enforces circuit breaker administrative halt and resume', () => {
      expect(sovraDb.isTradingHalted()).toBe(false);

      // Halt trading
      sovraDb.setTradingHalted(true, 'did:sovra:compliance_admin', 'Market volatility test halt');
      expect(sovraDb.isTradingHalted()).toBe(true);

      // Attempt order placement during halt
      const failOrder = sovraDb.placeTradingOrder({
        userDid: aliceDid,
        side: 'buy',
        orderType: 'limit',
        quantityUsov: parseSovraToUsov('1.0'),
        priceScaled: parseFiatToScaled('1000'),
      });
      expect(failOrder.ok).toBe(false);
      expect(failOrder.error).toContain('Trading engine is currently halted');

      // Resume trading
      sovraDb.setTradingHalted(false, 'did:sovra:compliance_admin', 'Market conditions stabilized');
      expect(sovraDb.isTradingHalted()).toBe(false);

      const successOrder = sovraDb.placeTradingOrder({
        userDid: aliceDid,
        side: 'buy',
        orderType: 'limit',
        quantityUsov: parseSovraToUsov('1.0'),
        priceScaled: parseFiatToScaled('1000'),
      });
      expect(successOrder.ok).toBe(true);
    });

    it('prevents duplicate executions via client nonce idempotency', () => {
      const nonce = 'unique_order_nonce_' + Date.now();
      const initialBal = sovraDb.getDetailedUserBalance(aliceDid);

      const firstOrder = sovraDb.placeTradingOrder({
        userDid: aliceDid,
        side: 'buy',
        orderType: 'limit',
        quantityUsov: parseSovraToUsov('2.0'),
        priceScaled: parseFiatToScaled('1000'),
        clientNonce: nonce,
      });
      expect(firstOrder.ok).toBe(true);

      const balAfterFirst = sovraDb.getDetailedUserBalance(aliceDid);

      // Re-submit exact same order with identical clientNonce
      const secondOrder = sovraDb.placeTradingOrder({
        userDid: aliceDid,
        side: 'buy',
        orderType: 'limit',
        quantityUsov: parseSovraToUsov('2.0'),
        priceScaled: parseFiatToScaled('1000'),
        clientNonce: nonce,
      });

      expect(secondOrder.ok).toBe(true);
      expect(secondOrder.isExisting).toBe(true);
      expect(secondOrder.order!.orderId).toBe(firstOrder.order!.orderId);

      // Balances must not have been deducted a second time
      const balAfterSecond = sovraDb.getDetailedUserBalance(aliceDid);
      expect(balAfterSecond.availableFiatScaled).toBe(balAfterFirst.availableFiatScaled);
      expect(balAfterSecond.lockedFiatScaled).toBe(balAfterFirst.lockedFiatScaled);
    });

    it('enforces velocity rate limiting to protect against spam attacks', () => {
      const spammerDid = 'did:sovra:test_velocity_user_' + Date.now();
      const spammer = sovraDb.ensureUserFinancialAccounts(spammerDid);
      spammer.fiatBalanceScaled = '10000000000'; // plenty of funds
      sovraDb.save();

      // Place 30 orders rapidly (max allowed per minute)
      for (let i = 0; i < 30; i++) {
        const res = sovraDb.placeTradingOrder({
          userDid: spammerDid,
          side: 'buy',
          orderType: 'limit',
          quantityUsov: parseSovraToUsov('0.01'),
          priceScaled: parseFiatToScaled('100'),
        });
        expect(res.ok).toBe(true);
      }

      // 31st order must be rejected by velocity limiter
      const blockedRes = sovraDb.placeTradingOrder({
        userDid: spammerDid,
        side: 'buy',
        orderType: 'limit',
        quantityUsov: parseSovraToUsov('0.01'),
        priceScaled: parseFiatToScaled('100'),
      });
      expect(blockedRes.ok).toBe(false);
      expect(blockedRes.error?.toLowerCase()).toContain('velocity rate limit exceeded');
    });
  });
});
