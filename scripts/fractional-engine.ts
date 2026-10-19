/**
 * @file scripts/fractional-engine.ts
 * SOVRA Fractional Digital Asset & Integer Precision Math Engine.
 *
 * Implements strict BigInt integer base-unit arithmetic for financial amounts.
 * NEVER uses floating-point arithmetic for balance calculations or trade execution.
 *
 * Base Denomination:
 * - 1 SOV = 1,000,000 uSOV (Micro-Sovra, 6 decimal places)
 * - Smallest Indivisible Base Unit: 1 uSOV = 0.000001 SOV
 *
 * Fiat Scaling (INR / USD):
 * - Scaled to 4 decimal places (1 INR = 10,000 fiat-units / 1 Paisa = 100 sub-units)
 * - Guarantees exact integer rounding for fees, TDS (1% Indian Section 194S), and quotes.
 */

export interface TokenPrecisionConfig {
  symbol: string;
  displayDenom: string;
  baseDenom: string;
  decimals: number;
  baseUnitsPerToken: bigint;
  smallestIndivisibleUnit: bigint;
  lifetimeHardCap: bigint;
}

export const SOVRA_TOKEN_CONFIG: TokenPrecisionConfig = {
  symbol: 'SOV',
  displayDenom: 'sov',
  baseDenom: 'usov',
  decimals: 6,
  baseUnitsPerToken: 1_000_000n,
  smallestIndivisibleUnit: 1n, // 1 uSOV
  lifetimeHardCap: 100_000_000_000_000n, // 100,000,000 SOV in uSOV
};

export const FIAT_SCALE = 10_000n; // 4 decimals: ₹1.0000 = 10,000 units (1 paisa = 100 units)
export const FIAT_DECIMALS = 4;
export const INDIAN_TDS_BPS = 100n; // 1.00% (100 basis points) Section 194S Income Tax Act
export const DEFAULT_MAKER_FEE_BPS = 10n; // 0.10% (10 bps)
export const DEFAULT_TAKER_FEE_BPS = 20n; // 0.20% (20 bps)

/**
 * Parses a fractional token string into integer base units (uSOV).
 * Rejects invalid strings, scientific notation, negative numbers, or fractions exceeding precision.
 */
export function parseTokenUnits(input: string | number | bigint, decimals: number = SOVRA_TOKEN_CONFIG.decimals): bigint {
  if (typeof input === 'bigint') {
    if (input < 0n) throw new Error('Token amount cannot be negative');
    return input;
  }

  const str = String(input).trim();
  if (!str) throw new Error('Token amount cannot be empty');
  if (str.startsWith('-')) throw new Error('Token amount cannot be negative');

  // Disallow scientific notation
  if (str.includes('e') || str.includes('E')) {
    throw new Error('Scientific notation is prohibited in financial token amounts');
  }

  if (!/^\d+(\.\d+)?$/.test(str)) {
    throw new Error(`Invalid token amount format: "${str}"`);
  }

  const parts = str.split('.');
  const wholePart = BigInt(parts[0]);
  const fractionStr = parts[1] || '';

  if (fractionStr.length > decimals) {
    throw new Error(`Token precision exceeds maximum allowed decimals of ${decimals}: "${str}"`);
  }

  const paddedFraction = fractionStr.padEnd(decimals, '0');
  const fractionPart = BigInt(paddedFraction);

  const multiplier = 10n ** BigInt(decimals);
  return wholePart * multiplier + fractionPart;
}

/**
 * Formats integer base units (uSOV) into a human-readable decimal string.
 * Optionally trims trailing decimal zeroes.
 */
export function formatTokenUnits(
  units: bigint | string | number,
  decimals: number = SOVRA_TOKEN_CONFIG.decimals,
  trimTrailingZeros: boolean = true
): string {
  const bn = typeof units === 'bigint' ? units : BigInt(String(units || '0'));
  const isNeg = bn < 0n;
  const absBn = isNeg ? -bn : bn;

  const multiplier = 10n ** BigInt(decimals);
  const whole = absBn / multiplier;
  const fraction = absBn % multiplier;

  let fractionStr = fraction.toString().padStart(decimals, '0');
  if (trimTrailingZeros) {
    fractionStr = fractionStr.replace(/0+$/, '');
  }

  const prefix = isNeg ? '-' : '';
  if (!fractionStr) {
    return `${prefix}${whole.toString()}`;
  }
  return `${prefix}${whole.toString()}.${fractionStr}`;
}

/**
 * Parses fiat currency amount (e.g. INR "1500.50") into scaled integer units.
 * Default scale: 4 decimals (1 INR = 10,000 units).
 */
export function parseFiatUnits(input: string | number | bigint, decimals: number = FIAT_DECIMALS): bigint {
  if (typeof input === 'bigint') {
    if (input < 0n) throw new Error('Fiat amount cannot be negative');
    return input;
  }

  const str = String(input).trim();
  if (!str) throw new Error('Fiat amount cannot be empty');
  if (str.startsWith('-')) throw new Error('Fiat amount cannot be negative');

  if (str.includes('e') || str.includes('E')) {
    throw new Error('Scientific notation is prohibited in fiat currency amounts');
  }

  if (!/^\d+(\.\d+)?$/.test(str)) {
    throw new Error(`Invalid fiat amount format: "${str}"`);
  }

  const parts = str.split('.');
  const wholePart = BigInt(parts[0]);
  const fractionStr = parts[1] || '';

  if (fractionStr.length > decimals) {
    throw new Error(`Fiat precision exceeds maximum allowed decimals of ${decimals}: "${str}"`);
  }

  const paddedFraction = fractionStr.padEnd(decimals, '0');
  const fractionPart = BigInt(paddedFraction);

  const multiplier = 10n ** BigInt(decimals);
  return wholePart * multiplier + fractionPart;
}

/**
 * Formats scaled fiat units (4 decimals) into standard currency string (e.g. "1500.50").
 */
export function formatFiatUnits(
  units: bigint | string | number,
  decimals: number = FIAT_DECIMALS,
  displayDecimals: number = 2
): string {
  const bn = typeof units === 'bigint' ? units : BigInt(String(units || '0'));
  const isNeg = bn < 0n;
  const absBn = isNeg ? -bn : bn;

  const multiplier = 10n ** BigInt(decimals);
  const whole = absBn / multiplier;
  const fraction = absBn % multiplier;

  const fullFraction = fraction.toString().padStart(decimals, '0');
  const roundedFraction = fullFraction.slice(0, displayDecimals).padEnd(displayDecimals, '0');

  const prefix = isNeg ? '-' : '';
  return `${prefix}${whole.toString()}.${roundedFraction}`;
}

/**
 * Calculates basis point fees with integer rounding.
 * basisPoints: e.g. 20n = 0.20%, 100n = 1.00%.
 */
export function calculateBpsAmount(amount: bigint, bps: bigint, roundUp: boolean = true): bigint {
  if (amount <= 0n || bps <= 0n) return 0n;
  const numerator = amount * bps;
  const denominator = 10_000n;
  if (roundUp) {
    return (numerator + denominator - 1n) / denominator;
  }
  return numerator / denominator;
}

/**
 * Computes Indian Virtual Digital Asset (VDA) Tax Deducted at Source (TDS)
 * under Section 194S of the Income Tax Act (1% on sale/transfer consideration).
 */
export function calculateSection194sTds(grossFiatScaled: bigint): bigint {
  return calculateBpsAmount(grossFiatScaled, INDIAN_TDS_BPS, true);
}

/**
 * Computes exact purchase quote when user inputs a fiat budget.
 *
 * Example:
 * User wants to spend ₹1,000 when price is ₹1,000/SOV:
 * Gross Fiat: 1,000 * 10,000 = 10,000,000 units.
 * Net Fiat after platform fee (0.20%): 9,980,000 units.
 * Token Base Units: (Net Fiat * 1,000,000) / PricePerToken = 998,000 uSOV (0.998 SOV).
 */
export function calculateBuyQuoteFromFiat(params: {
  fiatBudgetScaled: bigint;
  pricePerTokenScaled: bigint;
  takerFeeBps?: bigint;
}): {
  grossFiatScaled: bigint;
  feeFiatScaled: bigint;
  netFiatScaled: bigint;
  tokenQuantityUsov: bigint;
  pricePerTokenScaled: bigint;
  effectivePriceScaled: bigint;
  formattedTokens: string;
  formattedFiatGross: string;
  formattedFee: string;
} {
  const { fiatBudgetScaled, pricePerTokenScaled, takerFeeBps = DEFAULT_TAKER_FEE_BPS } = params;

  if (fiatBudgetScaled <= 0n) throw new Error('Fiat budget must be greater than zero');
  if (pricePerTokenScaled <= 0n) throw new Error('Price per token must be greater than zero');

  const feeFiat = calculateBpsAmount(fiatBudgetScaled, takerFeeBps, true);
  const netFiat = fiatBudgetScaled - feeFiat;

  if (netFiat <= 0n) {
    throw new Error('Fiat budget is too small to cover trading fee');
  }

  // Token Quantity (uSOV) = (netFiat * MICRO_PER_SOV) / pricePerTokenScaled
  const tokenQuantityUsov = (netFiat * SOVRA_TOKEN_CONFIG.baseUnitsPerToken) / pricePerTokenScaled;

  if (tokenQuantityUsov < SOVRA_TOKEN_CONFIG.smallestIndivisibleUnit) {
    throw new Error('Fiat budget results in token quantity below smallest indivisible unit (1 uSOV)');
  }

  // Effective price = (grossFiat * MICRO_PER_SOV) / tokenQuantityUsov
  const effectivePriceScaled = (fiatBudgetScaled * SOVRA_TOKEN_CONFIG.baseUnitsPerToken) / tokenQuantityUsov;

  return {
    grossFiatScaled: fiatBudgetScaled,
    feeFiatScaled: feeFiat,
    netFiatScaled: netFiat,
    tokenQuantityUsov,
    pricePerTokenScaled,
    effectivePriceScaled,
    formattedTokens: formatTokenUnits(tokenQuantityUsov),
    formattedFiatGross: formatFiatUnits(fiatBudgetScaled),
    formattedFee: formatFiatUnits(feeFiat),
  };
}

/**
 * Computes exact purchase quote when user inputs a token quantity.
 */
export function calculateBuyQuoteFromTokens(params: {
  tokenQuantityUsov: bigint;
  pricePerTokenScaled: bigint;
  takerFeeBps?: bigint;
}): {
  tokenQuantityUsov: bigint;
  baseFiatScaled: bigint;
  feeFiatScaled: bigint;
  totalFiatRequiredScaled: bigint;
  pricePerTokenScaled: bigint;
  formattedTokens: string;
  formattedBaseFiat: string;
  formattedFee: string;
  formattedTotalFiat: string;
} {
  const { tokenQuantityUsov, pricePerTokenScaled, takerFeeBps = DEFAULT_TAKER_FEE_BPS } = params;

  if (tokenQuantityUsov < SOVRA_TOKEN_CONFIG.smallestIndivisibleUnit) {
    throw new Error('Token quantity must be at least 1 uSOV');
  }
  if (pricePerTokenScaled <= 0n) throw new Error('Price per token must be greater than zero');

  // Base Fiat = (tokenQuantityUsov * pricePerTokenScaled) / MICRO_PER_SOV
  const baseFiat = (tokenQuantityUsov * pricePerTokenScaled) / SOVRA_TOKEN_CONFIG.baseUnitsPerToken;
  const feeFiat = calculateBpsAmount(baseFiat, takerFeeBps, true);
  const totalFiat = baseFiat + feeFiat;

  return {
    tokenQuantityUsov,
    baseFiatScaled: baseFiat,
    feeFiatScaled: feeFiat,
    totalFiatRequiredScaled: totalFiat,
    pricePerTokenScaled,
    formattedTokens: formatTokenUnits(tokenQuantityUsov),
    formattedBaseFiat: formatFiatUnits(baseFiat),
    formattedFee: formatFiatUnits(feeFiat),
    formattedTotalFiat: formatFiatUnits(totalFiat),
  };
}

/**
 * Computes exact sell quote when user sells fractional tokens.
 * Deducts platform fee and 1% Section 194S TDS.
 */
export function calculateSellQuote(params: {
  tokenQuantityUsov: bigint;
  pricePerTokenScaled: bigint;
  takerFeeBps?: bigint;
  deductTds?: boolean;
}): {
  tokenQuantityUsov: bigint;
  grossFiatScaled: bigint;
  feeFiatScaled: bigint;
  tdsFiatScaled: bigint;
  netFiatSettlementScaled: bigint;
  pricePerTokenScaled: bigint;
  formattedTokens: string;
  formattedGrossFiat: string;
  formattedFee: string;
  formattedTds: string;
  formattedNetFiat: string;
} {
  const { tokenQuantityUsov, pricePerTokenScaled, takerFeeBps = DEFAULT_TAKER_FEE_BPS, deductTds = true } = params;

  if (tokenQuantityUsov < SOVRA_TOKEN_CONFIG.smallestIndivisibleUnit) {
    throw new Error('Token quantity must be at least 1 uSOV');
  }
  if (pricePerTokenScaled <= 0n) throw new Error('Price per token must be greater than zero');

  const grossFiat = (tokenQuantityUsov * pricePerTokenScaled) / SOVRA_TOKEN_CONFIG.baseUnitsPerToken;
  const feeFiat = calculateBpsAmount(grossFiat, takerFeeBps, true);
  const tdsFiat = deductTds ? calculateSection194sTds(grossFiat) : 0n;

  const totalDeductions = feeFiat + tdsFiat;
  const netFiat = grossFiat > totalDeductions ? grossFiat - totalDeductions : 0n;

  return {
    tokenQuantityUsov,
    grossFiatScaled: grossFiat,
    feeFiatScaled: feeFiat,
    tdsFiatScaled: tdsFiat,
    netFiatSettlementScaled: netFiat,
    pricePerTokenScaled,
    formattedTokens: formatTokenUnits(tokenQuantityUsov),
    formattedGrossFiat: formatFiatUnits(grossFiat),
    formattedFee: formatFiatUnits(feeFiat),
    formattedTds: formatFiatUnits(tdsFiat),
    formattedNetFiat: formatFiatUnits(netFiat),
  };
}
