/**
 * @file scripts/trading-engine.ts
 * SOVRA High-Performance Deterministic Order Book & Matching Engine.
 *
 * Implements:
 * 1. Price-Time Priority (FIFO) matching algorithm.
 * 2. Strict BigInt integer arithmetic for all prices and quantities.
 * 3. Limit orders and Market orders with slippage protection.
 * 4. Self-Trade Prevention (STP) to eliminate wash trading.
 * 5. Atomic balance reservation, execution, and settlement reconciliation.
 * 6. Order cancellation and partial fill tracking.
 * 7. Authentic order book depth without fabricated volume or ghost liquidity.
 */

import crypto from 'node:crypto';
import {
  SOVRA_TOKEN_CONFIG,
  FIAT_SCALE,
  INDIAN_TDS_BPS,
  DEFAULT_MAKER_FEE_BPS,
  DEFAULT_TAKER_FEE_BPS,
  calculateBpsAmount,
  calculateSection194sTds,
  formatTokenUnits,
  formatFiatUnits,
  parseTokenUnits,
  parseFiatUnits,
} from './fractional-engine.ts';

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET';
export type OrderStatus = 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED' | 'REJECTED';
export type SelfTradePolicy = 'REJECT_TAKER' | 'CANCEL_MAKER';

export interface Order {
  id: string;
  clientOrderId?: string;
  userDid: string;
  userAddress?: string;
  pair: string;
  side: OrderSide;
  type: OrderType;
  priceScaled: bigint; // Scaled fiat price per 1 SOV (4 decimals, e.g. 1000 * 10000 = 10,000,000 for ₹1,000)
  quantityUsov: bigint; // Total order size in base units (1 uSOV = 10^-6 SOV)
  filledUsov: bigint; // Filled so far in base units
  remainingUsov: bigint; // Remaining unfilled base units
  lockedFiatScaled: bigint; // For BUY orders: reserved fiat budget
  lockedTokensUsov: bigint; // For SELL orders: reserved token units
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  sequence: number; // Monotonic sequence for exact FIFO tie-breaking
}

export interface TradeRecord {
  id: string;
  pair: string;
  takerOrderId: string;
  makerOrderId: string;
  takerDid: string;
  makerDid: string;
  takerSide: OrderSide;
  priceScaled: bigint;
  quantityUsov: bigint;
  grossFiatScaled: bigint;
  makerFeeScaled: bigint;
  takerFeeScaled: bigint;
  tdsWithheldScaled: bigint; // 1% Indian Section 194S TDS
  timestamp: number;
  settlementStatus: 'SETTLED' | 'PENDING';
  formattedPrice: string;
  formattedTokens: string;
  formattedFiat: string;
}

export interface OrderBookPriceLevel {
  priceScaled: bigint;
  formattedPrice: string;
  quantityUsov: bigint;
  formattedQuantity: string;
  orderCount: number;
}

export interface OrderBookDepth {
  pair: string;
  bids: OrderBookPriceLevel[]; // Sorted price DESC
  asks: OrderBookPriceLevel[]; // Sorted price ASC
  spreadScaled: bigint;
  formattedSpread: string;
  bestBidScaled: bigint | null;
  bestAskScaled: bigint | null;
  midPriceScaled: bigint | null;
  lastTradedPriceScaled: bigint | null;
  timestamp: number;
}

export interface PlaceOrderParams {
  clientOrderId?: string;
  userDid: string;
  userAddress?: string;
  pair?: string;
  side: OrderSide;
  type: OrderType;
  priceScaled?: bigint; // Required for LIMIT orders
  quantityUsov?: bigint; // Either quantityUsov or fiatBudgetScaled must be provided
  fiatBudgetScaled?: bigint; // For market buy with budget
  maxSlippageBps?: bigint; // Optional slippage tolerance for market orders (default 100 bps = 1%)
  selfTradePolicy?: SelfTradePolicy;
}

export interface PlaceOrderResult {
  ok: boolean;
  order?: Order;
  trades: TradeRecord[];
  error?: string;
  message?: string;
}

export interface OrderBookSnapshot {
  pair: string;
  orders: Order[];
  trades: TradeRecord[];
  lastTradedPriceScaled: bigint | null;
}

export interface WalletSettlementHook {
  reserveFunds: (order: Order) => boolean;
  unreserveFunds: (order: Order, unfillQuantityUsov: bigint, unfillFiatScaled: bigint) => void;
  settleTrade: (trade: TradeRecord) => void;
}

export class TradingEngine {
  private bids: Order[] = []; // Sorted price DESC, sequence ASC
  private asks: Order[] = []; // Sorted price ASC, sequence ASC
  private trades: TradeRecord[] = [];
  private orderIndex = new Map<string, Order>();
  private clientOrderIndex = new Map<string, string>(); // clientOrderId -> orderId
  private monotonicSequence = 0;
  private lastTradedPriceScaled: bigint | null = null;
  private walletHook: WalletSettlementHook | null = null;

  constructor(public readonly pair: string = 'SOV/INR') {}

  public setWalletHook(hook: WalletSettlementHook) {
    this.walletHook = hook;
  }

  public getLastTradedPrice(): bigint | null {
    return this.lastTradedPriceScaled;
  }

  public setInitialPrice(priceScaled: bigint) {
    if (!this.lastTradedPriceScaled) {
      this.lastTradedPriceScaled = priceScaled;
    }
  }

  /**
   * Returns live aggregated order book depth.
   */
  public getDepth(maxLevels: number = 20): OrderBookDepth {
    const aggregateLevels = (orders: Order[], isBid: boolean): OrderBookPriceLevel[] => {
      const levelMap = new Map<bigint, { quantityUsov: bigint; count: number }>();
      for (const ord of orders) {
        if (ord.status !== 'OPEN' && ord.status !== 'PARTIAL') continue;
        const current = levelMap.get(ord.priceScaled) || { quantityUsov: 0n, count: 0 };
        current.quantityUsov += ord.remainingUsov;
        current.count += 1;
        levelMap.set(ord.priceScaled, current);
      }

      const levels: OrderBookPriceLevel[] = [];
      for (const [price, data] of levelMap.entries()) {
        levels.push({
          priceScaled: price,
          formattedPrice: formatFiatUnits(price),
          quantityUsov: data.quantityUsov,
          formattedQuantity: formatTokenUnits(data.quantityUsov),
          orderCount: data.count,
        });
      }

      // Sort bids DESC, asks ASC
      levels.sort((a, b) => (isBid ? (b.priceScaled > a.priceScaled ? 1 : -1) : a.priceScaled > b.priceScaled ? 1 : -1));
      return levels.slice(0, maxLevels);
    };

    const bidsDepth = aggregateLevels(this.bids, true);
    const asksDepth = aggregateLevels(this.asks, false);

    const bestBid = bidsDepth.length > 0 ? bidsDepth[0].priceScaled : null;
    const bestAsk = asksDepth.length > 0 ? asksDepth[0].priceScaled : null;

    let spreadScaled = 0n;
    let midPriceScaled: bigint | null = null;

    if (bestBid !== null && bestAsk !== null && bestAsk >= bestBid) {
      spreadScaled = bestAsk - bestBid;
      midPriceScaled = (bestBid + bestAsk) / 2n;
    } else if (bestBid !== null) {
      midPriceScaled = bestBid;
    } else if (bestAsk !== null) {
      midPriceScaled = bestAsk;
    }

    return {
      pair: this.pair,
      bids: bidsDepth,
      asks: asksDepth,
      spreadScaled,
      formattedSpread: formatFiatUnits(spreadScaled),
      bestBidScaled: bestBid,
      bestAskScaled: bestAsk,
      midPriceScaled,
      lastTradedPriceScaled: this.lastTradedPriceScaled,
      timestamp: Date.now(),
    };
  }

  /**
   * Places a limit or market order.
   * Atomically checks & locks balances via settlement hook, then executes matches.
   */
  public placeOrder(params: PlaceOrderParams): PlaceOrderResult {
    const pair = params.pair || this.pair;
    const selfTradePolicy = params.selfTradePolicy || 'REJECT_TAKER';

    // 1. Idempotency Check
    if (params.clientOrderId) {
      const existingId = this.clientOrderIndex.get(params.clientOrderId);
      if (existingId) {
        const existingOrder = this.orderIndex.get(existingId);
        if (existingOrder) {
          return {
            ok: true,
            order: existingOrder,
            trades: [],
            message: 'Order already submitted (idempotency key matched)',
          };
        }
      }
    }

    // 2. Validate Order Parameters
    let priceScaled = params.priceScaled || 0n;
    let quantityUsov = params.quantityUsov || 0n;
    let lockedFiat = 0n;
    let lockedTokens = 0n;

    if (params.type === 'LIMIT') {
      if (priceScaled <= 0n) {
        return { ok: false, trades: [], error: 'Limit orders require a positive price' };
      }
      if (quantityUsov < SOVRA_TOKEN_CONFIG.smallestIndivisibleUnit) {
        return { ok: false, trades: [], error: 'Order quantity must be at least 1 uSOV' };
      }

      if (params.side === 'BUY') {
        // Required fiat = (quantityUsov * priceScaled) / MICRO_PER_SOV + max taker fee
        const baseCost = (quantityUsov * priceScaled) / SOVRA_TOKEN_CONFIG.baseUnitsPerToken;
        const feeEst = calculateBpsAmount(baseCost, DEFAULT_TAKER_FEE_BPS, true);
        lockedFiat = baseCost + feeEst;
      } else {
        lockedTokens = quantityUsov;
      }
    } else if (params.type === 'MARKET') {
      if (params.side === 'BUY') {
        if (params.fiatBudgetScaled && params.fiatBudgetScaled > 0n) {
          lockedFiat = params.fiatBudgetScaled;
        } else if (quantityUsov > 0n) {
          // Estimate required fiat from top of asks or last traded price
          const topAsk = this.asks[0]?.priceScaled || this.lastTradedPriceScaled;
          if (!topAsk) {
            return { ok: false, trades: [], error: 'Market buy cannot execute: order book has no asks or reference price' };
          }
          const bufferPrice = (topAsk * 105n) / 100n; // 5% slippage buffer
          const baseCost = (quantityUsov * bufferPrice) / SOVRA_TOKEN_CONFIG.baseUnitsPerToken;
          const feeEst = calculateBpsAmount(baseCost, DEFAULT_TAKER_FEE_BPS, true);
          lockedFiat = baseCost + feeEst;
        } else {
          return { ok: false, trades: [], error: 'Market buy requires either fiat budget or token quantity' };
        }
      } else {
        // Market SELL
        if (quantityUsov < SOVRA_TOKEN_CONFIG.smallestIndivisibleUnit) {
          return { ok: false, trades: [], error: 'Market sell requires a token quantity >= 1 uSOV' };
        }
        lockedTokens = quantityUsov;
      }
    }

    const orderId = 'ord_' + Date.now() + '_' + crypto.randomBytes(6).toString('hex');
    const order: Order = {
      id: orderId,
      clientOrderId: params.clientOrderId,
      userDid: params.userDid,
      userAddress: params.userAddress,
      pair,
      side: params.side,
      type: params.type,
      priceScaled,
      quantityUsov,
      filledUsov: 0n,
      remainingUsov: quantityUsov,
      lockedFiatScaled: lockedFiat,
      lockedTokensUsov: lockedTokens,
      status: 'OPEN',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sequence: ++this.monotonicSequence,
    };

    // 3. Atomically Reserve Balance in Wallet Ledger
    if (this.walletHook) {
      const reserved = this.walletHook.reserveFunds(order);
      if (!reserved) {
        return {
          ok: false,
          trades: [],
          error: params.side === 'BUY'
            ? `Insufficient available fiat balance to reserve ₹${formatFiatUnits(lockedFiat)}`
            : `Insufficient available token balance to reserve ${formatTokenUnits(lockedTokens)} SOV`,
        };
      }
    }

    this.orderIndex.set(orderId, order);
    if (params.clientOrderId) {
      this.clientOrderIndex.set(params.clientOrderId, orderId);
    }

    // 4. Execute Matching
    const executedTrades: TradeRecord[] = [];

    if (order.side === 'BUY') {
      this.matchBuyOrder(order, executedTrades, selfTradePolicy, params.maxSlippageBps);
    } else {
      this.matchSellOrder(order, executedTrades, selfTradePolicy, params.maxSlippageBps);
    }

    // 5. If limit order remains unfilled/partially filled, insert into order book
    if (order.status === 'OPEN' || order.status === 'PARTIAL') {
      if (order.type === 'LIMIT') {
        if (order.side === 'BUY') {
          this.insertBid(order);
        } else {
          this.insertAsk(order);
        }
      } else {
        // Market orders do not rest on the book; cancel unfilled remainder and refund
        order.status = order.filledUsov > 0n ? 'PARTIAL' : 'CANCELLED';
        if (this.walletHook) {
          const unfillQty = order.remainingUsov;
          let unfillFiat = 0n;
          if (order.side === 'BUY' && order.lockedFiatScaled > 0n) {
            unfillFiat = order.lockedFiatScaled;
            order.lockedFiatScaled = 0n;
          }
          this.walletHook.unreserveFunds(order, unfillQty, unfillFiat);
        }
      }
    }

    return {
      ok: true,
      order,
      trades: executedTrades,
    };
  }

  /**
   * Cancels an open or partially filled order.
   * Atomically unreserves remaining locked funds.
   */
  public cancelOrder(orderId: string, userDid: string): { ok: boolean; order?: Order; error?: string } {
    const order = this.orderIndex.get(orderId);
    if (!order) {
      return { ok: false, error: 'Order not found' };
    }
    if (order.userDid !== userDid) {
      return { ok: false, error: 'Unauthorized: order belongs to another DID' };
    }
    if (order.status !== 'OPEN' && order.status !== 'PARTIAL') {
      return { ok: false, error: `Cannot cancel order with status ${order.status}` };
    }

    // Remove from bids or asks
    if (order.side === 'BUY') {
      this.bids = this.bids.filter(b => b.id !== orderId);
    } else {
      this.asks = this.asks.filter(a => a.id !== orderId);
    }

    const unfillQuantity = order.remainingUsov;
    const unfillFiat = order.lockedFiatScaled;

    order.status = 'CANCELLED';
    order.remainingUsov = 0n;
    order.lockedFiatScaled = 0n;
    order.lockedTokensUsov = 0n;
    order.updatedAt = Date.now();

    // Release reserved funds
    if (this.walletHook) {
      this.walletHook.unreserveFunds(order, unfillQuantity, unfillFiat);
    }

    return { ok: true, order };
  }

  /**
   * Matches a BUY order against the asks order book.
   */
  private matchBuyOrder(
    buyerOrder: Order,
    trades: TradeRecord[],
    selfTradePolicy: SelfTradePolicy,
    maxSlippageBps?: bigint
  ): void {
    let askIndex = 0;

    while (askIndex < this.asks.length) {
      const makerAsk = this.asks[askIndex];

      // Price limit check: For LIMIT BUY, maker ask must be <= buyer price
      if (buyerOrder.type === 'LIMIT' && makerAsk.priceScaled > buyerOrder.priceScaled) {
        break; // Asks are sorted ASC; no further matches possible
      }

      // Slippage check for market order
      if (buyerOrder.type === 'MARKET' && maxSlippageBps && this.lastTradedPriceScaled) {
        const maxAllowedPrice = (this.lastTradedPriceScaled * (10_000n + maxSlippageBps)) / 10_000n;
        if (makerAsk.priceScaled > maxAllowedPrice) {
          break; // Exceeded slippage tolerance
        }
      }

      // Self-Trade Prevention (STP)
      if (makerAsk.userDid === buyerOrder.userDid) {
        if (selfTradePolicy === 'CANCEL_MAKER') {
          // Cancel maker ask
          this.asks.splice(askIndex, 1);
          makerAsk.status = 'CANCELLED';
          if (this.walletHook) {
            this.walletHook.unreserveFunds(makerAsk, makerAsk.remainingUsov, 0n);
          }
          continue;
        } else {
          // REJECT_TAKER: stop matching immediately
          buyerOrder.status = buyerOrder.filledUsov > 0n ? 'PARTIAL' : 'REJECTED';
          break;
        }
      }

      // Determine match quantity
      const matchPrice = makerAsk.priceScaled;
      let matchQty = 0n;

      if (buyerOrder.type === 'MARKET' && buyerOrder.quantityUsov === 0n && buyerOrder.lockedFiatScaled > 0n) {
        // Market buy by fiat budget
        const maxTokensAffordable = (buyerOrder.lockedFiatScaled * SOVRA_TOKEN_CONFIG.baseUnitsPerToken) / matchPrice;
        matchQty = maxTokensAffordable < makerAsk.remainingUsov ? maxTokensAffordable : makerAsk.remainingUsov;
        if (matchQty < SOVRA_TOKEN_CONFIG.smallestIndivisibleUnit) {
          break; // Insufficient remaining fiat to buy even 1 uSOV
        }
      } else {
        matchQty = buyerOrder.remainingUsov < makerAsk.remainingUsov ? buyerOrder.remainingUsov : makerAsk.remainingUsov;
      }

      if (matchQty <= 0n) break;

      // Calculate trade financials
      const grossFiat = (matchQty * matchPrice) / SOVRA_TOKEN_CONFIG.baseUnitsPerToken;
      const makerFee = calculateBpsAmount(grossFiat, DEFAULT_MAKER_FEE_BPS, true);
      const takerFee = calculateBpsAmount(grossFiat, DEFAULT_TAKER_FEE_BPS, true);
      const tdsWithheld = calculateSection194sTds(grossFiat); // 1% Indian VDA TDS from seller

      // Create trade record
      const trade: TradeRecord = {
        id: 'trd_' + Date.now() + '_' + crypto.randomBytes(6).toString('hex'),
        pair: this.pair,
        takerOrderId: buyerOrder.id,
        makerOrderId: makerAsk.id,
        takerDid: buyerOrder.userDid,
        makerDid: makerAsk.userDid,
        takerSide: 'BUY',
        priceScaled: matchPrice,
        quantityUsov: matchQty,
        grossFiatScaled: grossFiat,
        makerFeeScaled: makerFee,
        takerFeeScaled: takerFee,
        tdsWithheldScaled: tdsWithheld,
        timestamp: Date.now(),
        settlementStatus: 'SETTLED',
        formattedPrice: formatFiatUnits(matchPrice),
        formattedTokens: formatTokenUnits(matchQty),
        formattedFiat: formatFiatUnits(grossFiat),
      };

      // Settle balances atomically
      if (this.walletHook) {
        this.walletHook.settleTrade(trade);
      }

      trades.push(trade);
      this.trades.unshift(trade);
      if (this.trades.length > 500) this.trades.pop();
      this.lastTradedPriceScaled = matchPrice;

      // Update Order Quantities
      buyerOrder.filledUsov += matchQty;
      if (buyerOrder.quantityUsov > 0n) {
        buyerOrder.remainingUsov -= matchQty;
      }
      const buyerFiatSpent = grossFiat + takerFee;
      if (buyerOrder.lockedFiatScaled >= buyerFiatSpent) {
        buyerOrder.lockedFiatScaled -= buyerFiatSpent;
      } else {
        buyerOrder.lockedFiatScaled = 0n;
      }

      makerAsk.filledUsov += matchQty;
      makerAsk.remainingUsov -= matchQty;
      if (makerAsk.lockedTokensUsov >= matchQty) {
        makerAsk.lockedTokensUsov -= matchQty;
      } else {
        makerAsk.lockedTokensUsov = 0n;
      }

      // Check Maker Completion
      if (makerAsk.remainingUsov === 0n) {
        makerAsk.status = 'FILLED';
        this.asks.splice(askIndex, 1);
      } else {
        makerAsk.status = 'PARTIAL';
        askIndex++;
      }

      // Check Buyer Completion
      if (buyerOrder.type === 'LIMIT' && buyerOrder.remainingUsov === 0n) {
        buyerOrder.status = 'FILLED';
        break;
      }
      if (buyerOrder.type === 'MARKET' && buyerOrder.lockedFiatScaled <= 0n) {
        buyerOrder.status = 'FILLED';
        break;
      }
    }

    if (buyerOrder.filledUsov > 0n && buyerOrder.status !== 'FILLED') {
      buyerOrder.status = 'PARTIAL';
    }
  }

  /**
   * Matches a SELL order against the bids order book.
   */
  private matchSellOrder(
    sellerOrder: Order,
    trades: TradeRecord[],
    selfTradePolicy: SelfTradePolicy,
    maxSlippageBps?: bigint
  ): void {
    let bidIndex = 0;

    while (bidIndex < this.bids.length) {
      const makerBid = this.bids[bidIndex];

      // Price limit check: For LIMIT SELL, maker bid must be >= seller price
      if (sellerOrder.type === 'LIMIT' && makerBid.priceScaled < sellerOrder.priceScaled) {
        break; // Bids are sorted DESC; no further matches possible
      }

      // Slippage check for market sell
      if (sellerOrder.type === 'MARKET' && maxSlippageBps && this.lastTradedPriceScaled) {
        const minAllowedPrice = (this.lastTradedPriceScaled * (10_000n - maxSlippageBps)) / 10_000n;
        if (makerBid.priceScaled < minAllowedPrice) {
          break;
        }
      }

      // Self-Trade Prevention (STP)
      if (makerBid.userDid === sellerOrder.userDid) {
        if (selfTradePolicy === 'CANCEL_MAKER') {
          this.bids.splice(bidIndex, 1);
          makerBid.status = 'CANCELLED';
          if (this.walletHook) {
            this.walletHook.unreserveFunds(makerBid, makerBid.remainingUsov, makerBid.lockedFiatScaled);
          }
          continue;
        } else {
          sellerOrder.status = sellerOrder.filledUsov > 0n ? 'PARTIAL' : 'REJECTED';
          break;
        }
      }

      // Determine match quantity
      const matchPrice = makerBid.priceScaled;
      const matchQty = sellerOrder.remainingUsov < makerBid.remainingUsov ? sellerOrder.remainingUsov : makerBid.remainingUsov;

      if (matchQty <= 0n) break;

      const grossFiat = (matchQty * matchPrice) / SOVRA_TOKEN_CONFIG.baseUnitsPerToken;
      const makerFee = calculateBpsAmount(grossFiat, DEFAULT_MAKER_FEE_BPS, true);
      const takerFee = calculateBpsAmount(grossFiat, DEFAULT_TAKER_FEE_BPS, true);
      const tdsWithheld = calculateSection194sTds(grossFiat); // 1% Indian TDS on seller

      const trade: TradeRecord = {
        id: 'trd_' + Date.now() + '_' + crypto.randomBytes(6).toString('hex'),
        pair: this.pair,
        takerOrderId: sellerOrder.id,
        makerOrderId: makerBid.id,
        takerDid: sellerOrder.userDid,
        makerDid: makerBid.userDid,
        takerSide: 'SELL',
        priceScaled: matchPrice,
        quantityUsov: matchQty,
        grossFiatScaled: grossFiat,
        makerFeeScaled: makerFee,
        takerFeeScaled: takerFee,
        tdsWithheldScaled: tdsWithheld,
        timestamp: Date.now(),
        settlementStatus: 'SETTLED',
        formattedPrice: formatFiatUnits(matchPrice),
        formattedTokens: formatTokenUnits(matchQty),
        formattedFiat: formatFiatUnits(grossFiat),
      };

      if (this.walletHook) {
        this.walletHook.settleTrade(trade);
      }

      trades.push(trade);
      this.trades.unshift(trade);
      if (this.trades.length > 500) this.trades.pop();
      this.lastTradedPriceScaled = matchPrice;

      // Update Order Quantities
      sellerOrder.filledUsov += matchQty;
      sellerOrder.remainingUsov -= matchQty;
      if (sellerOrder.lockedTokensUsov >= matchQty) {
        sellerOrder.lockedTokensUsov -= matchQty;
      } else {
        sellerOrder.lockedTokensUsov = 0n;
      }

      makerBid.filledUsov += matchQty;
      makerBid.remainingUsov -= matchQty;
      const makerFiatSpent = grossFiat + makerFee;
      if (makerBid.lockedFiatScaled >= makerFiatSpent) {
        makerBid.lockedFiatScaled -= makerFiatSpent;
      } else {
        makerBid.lockedFiatScaled = 0n;
      }

      if (makerBid.remainingUsov === 0n) {
        makerBid.status = 'FILLED';
        this.bids.splice(bidIndex, 1);
      } else {
        makerBid.status = 'PARTIAL';
        bidIndex++;
      }

      if (sellerOrder.remainingUsov === 0n) {
        sellerOrder.status = 'FILLED';
        break;
      }
    }

    if (sellerOrder.filledUsov > 0n && sellerOrder.status !== 'FILLED') {
      sellerOrder.status = 'PARTIAL';
    }
  }

  /**
   * Inserts an unfilled BUY limit order into the bids book.
   * Priority: Price DESC, then Sequence ASC.
   */
  private insertBid(order: Order): void {
    let idx = 0;
    while (idx < this.bids.length) {
      const cur = this.bids[idx];
      if (order.priceScaled > cur.priceScaled) {
        break;
      }
      if (order.priceScaled === cur.priceScaled && order.sequence < cur.sequence) {
        break;
      }
      idx++;
    }
    this.bids.splice(idx, 0, order);
  }

  /**
   * Inserts an unfilled SELL limit order into the asks book.
   * Priority: Price ASC, then Sequence ASC.
   */
  private insertAsk(order: Order): void {
    let idx = 0;
    while (idx < this.asks.length) {
      const cur = this.asks[idx];
      if (order.priceScaled < cur.priceScaled) {
        break;
      }
      if (order.priceScaled === cur.priceScaled && order.sequence < cur.sequence) {
        break;
      }
      idx++;
    }
    this.asks.splice(idx, 0, order);
  }

  public getOrder(orderId: string): Order | undefined {
    return this.orderIndex.get(orderId);
  }

  public getUserOrders(userDid: string, statusFilter?: OrderStatus): Order[] {
    const list: Order[] = [];
    for (const ord of this.orderIndex.values()) {
      if (ord.userDid === userDid) {
        if (!statusFilter || ord.status === statusFilter) {
          list.push(ord);
        }
      }
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  public getRecentTrades(limit: number = 50): TradeRecord[] {
    return this.trades.slice(0, limit);
  }

  public getSnapshot(): OrderBookSnapshot {
    return {
      pair: this.pair,
      orders: Array.from(this.orderIndex.values()),
      trades: this.trades.slice(0, 100),
      lastTradedPriceScaled: this.lastTradedPriceScaled,
    };
  }

  public loadSnapshot(snapshot: OrderBookSnapshot): void {
    this.orderIndex.clear();
    this.clientOrderIndex.clear();
    this.bids = [];
    this.asks = [];
    this.trades = [...snapshot.trades];
    this.lastTradedPriceScaled = snapshot.lastTradedPriceScaled;

    for (const ord of snapshot.orders) {
      this.orderIndex.set(ord.id, ord);
      if (ord.clientOrderId) {
        this.clientOrderIndex.set(ord.clientOrderId, ord.id);
      }
      if (ord.status === 'OPEN' || ord.status === 'PARTIAL') {
        if (ord.side === 'BUY') {
          this.insertBid(ord);
        } else {
          this.insertAsk(ord);
        }
      }
      if (ord.sequence > this.monotonicSequence) {
        this.monotonicSequence = ord.sequence;
      }
    }
  }
}
