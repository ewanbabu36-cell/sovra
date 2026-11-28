/**
 * @file scripts/routes/economy.routes.ts
 * SOVRA 7-Pillar Tokenomics, Staking, DePIN Collateral, Vesting, Patron Staking,
 * Paid Usage Burn Sinks, Protocol-Owned Liquidity (POL), and Live Supply Dashboard API.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { sovraDb } from '../database-engine.ts';
import { riskManagementEngine } from '../risk-management-engine.ts';
import type { AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';
import { validateSeederCollateralRequirement } from '../../packages/protocol/dist/index.js';

const PRIMARY_RPC = process.env.SOVRA_L1_RPC || 'http://127.0.0.1:26657';

export const DEFAULT_UNBONDING_MS = 14 * 86400_000; // 14 days
export const MIN_SEEDER_BOND_SOV = 100;
export const SEEDER_BOND_PER_GB_SOV = 10;
export const HANDLE_REG_FEE_SOV = 10;
export const STORAGE_RENT_PER_GB_MONTH_SOV = 0.5;
export const DEFAULT_FEE_BURN_SHARE = 0.5;

export interface EconomyRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, maxBytes: number) => Promise<{ body: string; ok: boolean }>;
  resolvePrincipal: (req: http.IncomingMessage, bodyObj?: Record<string, any>) => AuthenticatedPrincipal | null;
  enforceAuth: (req: http.IncomingMessage, res: http.ServerResponse, bodyObj?: Record<string, any>) => AuthenticatedPrincipal | null;
}

function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sovra-DID, X-Sovra-Signature',
  });
  res.end(JSON.stringify(data));
}

function round6(val: number): number {
  return Math.round(val * 1_000_000) / 1_000_000;
}

export function resolveVeSovTier(lockDaysInput: number): { lockDays: number; lockTier: string; multiplier: number; lockMs: number } | null {
  const days = Number(lockDaysInput || 0);
  if (days === 0) return { lockDays: 0, lockTier: 'flexible', multiplier: 1.0, lockMs: 0 };
  if (days === 90) return { lockDays: 90, lockTier: '90d', multiplier: 1.5, lockMs: 90 * 86400_000 };
  if (days === 365) return { lockDays: 365, lockTier: '365d', multiplier: 2.5, lockMs: 365 * 86400_000 };
  if (days === 730) return { lockDays: 730, lockTier: '730d', multiplier: 3.0, lockMs: 730 * 86400_000 };
  return null;
}

function ensureEconomyState() {
  const dbAny = sovraDb as any;
  if (!dbAny.db) dbAny.db = {};
  if (!Array.isArray(dbAny.db.staking_delegations)) dbAny.db.staking_delegations = [];
  if (!Array.isArray(dbAny.db.unbonding_queue)) dbAny.db.unbonding_queue = [];
  if (!Array.isArray(dbAny.db.seeder_bonds)) dbAny.db.seeder_bonds = [];
  if (!Array.isArray(dbAny.db.patron_stakes)) dbAny.db.patron_stakes = [];
  if (!Array.isArray(dbAny.db.vesting_schedules)) dbAny.db.vesting_schedules = [];
  if (!Array.isArray(dbAny.db.paid_handles)) dbAny.db.paid_handles = [];
  if (!Array.isArray(dbAny.db.storage_rent_logs)) dbAny.db.storage_rent_logs = [];
  if (!Array.isArray(dbAny.db.pol_locks)) dbAny.db.pol_locks = [];
  if (!dbAny.db.claimable_staking_rewards) dbAny.db.claimable_staking_rewards = {};
  if (!dbAny.db.economy_totals) {
    dbAny.db.economy_totals = {
      feePoolSov: 0,
      burnedExtraSov: 0,
      dailyBurnedSov: 0,
      lastBurnResetAt: Date.now(),
    };
  }
  return dbAny;
}

function getUserBalanceSov(did: string): number {
  const sqlite = (sovraDb as any).getSqliteEngine?.()?.getRawDb?.() || (sovraDb as any).getSqliteEngine?.()?.db;
  if (sqlite) {
    try {
      const row = sqlite.prepare('SELECT balance_sov FROM users WHERE did = ?').get(did) as any;
      if (row && typeof row.balance_sov === 'number') {
        return Number(row.balance_sov);
      }
    } catch {}
  }
  const u = (sovraDb as any).db?.users?.find((x: any) => x.did === did);
  return Number(u?.balanceSov ?? u?.balance_sov ?? 0);
}

function adjustUserBalanceSov(did: string, deltaSov: number): number {
  const sqlite = (sovraDb as any).getSqliteEngine?.()?.getRawDb?.() || (sovraDb as any).getSqliteEngine?.()?.db;
  const roundedDelta = round6(deltaSov);
  if (sqlite) {
    try {
      const row = sqlite.prepare('SELECT balance_sov FROM users WHERE did = ?').get(did) as any;
      if (row) {
        sqlite.prepare('UPDATE users SET balance_sov = MAX(0, balance_sov + ?), updated_at = ? WHERE did = ?')
          .run(roundedDelta, Date.now(), did);
      }
    } catch {}
  }
  const dbAny = sovraDb as any;
  const u = dbAny.db?.users?.find((x: any) => x.did === did);
  if (u) {
    const next = Math.max(0, round6(Number(u.balanceSov ?? u.balance_sov ?? 0) + roundedDelta));
    u.balanceSov = next;
    u.balance_sov = next;
  }
  dbAny.save?.();
  return getUserBalanceSov(did);
}

export function calculateVestingLockedSov(sched: { originalAmountSov: number; cliffAt: number; endAt: number }, nowMs: number): number {
  if (nowMs < sched.cliffAt) return sched.originalAmountSov;
  if (sched.endAt <= sched.cliffAt || nowMs >= sched.endAt) return 0;
  const frac = (nowMs - sched.cliffAt) / (sched.endAt - sched.cliffAt);
  const vested = sched.originalAmountSov * frac;
  return Math.max(0, round6(sched.originalAmountSov - vested));
}

export function getVestingLockedForDid(did: string, nowMs = Date.now()): number {
  const dbAny = ensureEconomyState();
  const list = dbAny.db.vesting_schedules.filter((s: any) => s.did === did || s.address === did);
  return list.reduce((sum: number, s: any) => sum + calculateVestingLockedSov(s, nowMs), 0);
}

function getSpendableBalanceSov(did: string, nowMs = Date.now()): number {
  const bal = getUserBalanceSov(did);
  const locked = getVestingLockedForDid(did, nowMs);
  return Math.max(0, round6(bal - locked));
}

function recordPermanentBurn(amountSov: number, reason: 'GAS_FEE_BURN' | 'AD_SPEND_BURN' | 'DIRECT_BURN' | 'PROTOCOL_DEFLATION'): { burnedSov: number; burnTxId: string } {
  const dbAny = ensureEconomyState();
  const rounded = round6(amountSov);
  if (rounded <= 0) return { burnedSov: 0, burnTxId: '' };

  let burnTxId = 'tx_burn_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  try {
    if (typeof dbAny.burnToConsensusSink === 'function') {
      const res = dbAny.burnToConsensusSink(rounded, reason);
      burnTxId = res.burnTxId || burnTxId;
    } else {
      dbAny.db.economy_totals.burnedExtraSov = round6((dbAny.db.economy_totals.burnedExtraSov || 0) + rounded);
    }
  } catch {
    dbAny.db.economy_totals.burnedExtraSov = round6((dbAny.db.economy_totals.burnedExtraSov || 0) + rounded);
  }
  dbAny.db.economy_totals.dailyBurnedSov = round6((dbAny.db.economy_totals.dailyBurnedSov || 0) + rounded);
  dbAny.save?.();
  return { burnedSov: rounded, burnTxId };
}

export function applyRollingRewardVestingSov(did: string, lockedSov: number, durationDays: number, label: string): { lockedTotalSov: number; endAt: number } {
  const dbAny = ensureEconomyState();
  const nowMs = Date.now();
  const existing = dbAny.db.vesting_schedules.find((s: any) => s.did === did || s.address === did);
  const existingLocked = existing ? calculateVestingLockedSov(existing, nowMs) : 0;
  const totalLocked = round6(existingLocked + Math.max(0, lockedSov));
  const cliffAt = existing && Number(existing.cliffAt || 0) > nowMs ? Number(existing.cliffAt) : nowMs;
  const targetEndAt = nowMs + Math.max(1, durationDays) * 86400_000;
  const endAt = existing && Number(existing.endAt || 0) > targetEndAt ? Number(existing.endAt) : targetEndAt;

  const sched = {
    did,
    originalAmountSov: totalLocked,
    startAt: nowMs,
    cliffAt,
    endAt,
    label,
  };
  dbAny.db.vesting_schedules = dbAny.db.vesting_schedules.filter((s: any) => s.did !== did && s.address !== did);
  dbAny.db.vesting_schedules.push(sched);
  dbAny.save?.();
  return { lockedTotalSov: totalLocked, endAt };
}

export function executeHandleBurnSink(ownerDid: string, rawHandle: string, requestedFeeSov = HANDLE_REG_FEE_SOV) {
  const cleanHandle = String(rawHandle || '').trim().replace(/^@/, '').toLowerCase();
  const feeSov = Math.max(HANDLE_REG_FEE_SOV, round6(Number(requestedFeeSov || HANDLE_REG_FEE_SOV)));
  if (!/^[a-z0-9_]{3,32}$/.test(cleanHandle)) {
    return { ok: false as const, statusCode: 400, error: 'Handle must match 3-32 lowercase alphanumeric/underscore characters' };
  }
  const dbAny = ensureEconomyState();
  const nowMs = Date.now();
  const taken = dbAny.db.paid_handles.find((h: any) => h.handle === cleanHandle && h.ownerDid !== ownerDid && h.expiresAt > nowMs);
  if (taken) {
    return { ok: false as const, statusCode: 409, error: `Handle @${cleanHandle} is already leased` };
  }
  if (getSpendableBalanceSov(ownerDid, nowMs) < feeSov) {
    return { ok: false as const, statusCode: 400, error: `Insufficient spendable SOV (requires >= ${feeSov} SOV)` };
  }

  adjustUserBalanceSov(ownerDid, -feeSov);
  const burnedSov = round6(feeSov * 0.80);
  const yieldRoutedSov = round6(feeSov - burnedSov);
  const burn = recordPermanentBurn(burnedSov, 'PROTOCOL_DEFLATION');
  routeYieldToStakers(yieldRoutedSov);
  if (yieldRoutedSov > 0) {
    riskManagementEngine.recordRiskEvent({
      category: 'REVENUE_RECORDED',
      severity: 'LOW',
      direction: 'REVENUE',
      amountSov: yieldRoutedSov,
      actorDid: ownerDid,
      endpoint: '/api/economy/sinks/handle',
      description: `Handle registration protocol & staker yield (@${cleanHandle})`,
      prevented: false,
      metadata: { kind: 'HANDLE_SINK', handle: '@' + cleanHandle, feeSov, burnedSov },
    });
  }

  dbAny.db.paid_handles = dbAny.db.paid_handles.filter((h: any) => h.handle !== cleanHandle);
  dbAny.db.paid_handles.push({
    handle: cleanHandle,
    ownerDid,
    feeSov,
    burnedSov,
    burnTxId: burn.burnTxId,
    expiresAt: nowMs + 365 * 86400_000,
  });
  dbAny.save?.();
  return { ok: true as const, statusCode: 200, handle: '@' + cleanHandle, feeSov, burnedSov, yieldRoutedSov, burnTxId: burn.burnTxId };
}

export function executeStorageRentBurnSink(
  payerDid: string,
  storageGb: number,
  months: number,
  seederDidRaw?: string,
  requestedAmountSov?: number,
) {
  const gb = Math.max(1, Number(storageGb || 1));
  const m = Math.max(1, Number(months || 1));
  const minRent = round6(gb * m * STORAGE_RENT_PER_GB_MONTH_SOV);
  const totalRentSov = Math.max(minRent, round6(Number(requestedAmountSov || minRent)));
  if (getSpendableBalanceSov(payerDid) < totalRentSov) {
    return { ok: false as const, statusCode: 400, error: `Insufficient spendable SOV for storage rent (${totalRentSov} SOV required)` };
  }
  const dbAny = ensureEconomyState();
  const seederDid = String(seederDidRaw || '').trim();
  if (seederDid) {
    const bonded = dbAny.db.seeder_bonds.find((b: any) => b.did === seederDid && Number(b.bondedSov) >= MIN_SEEDER_BOND_SOV);
    if (!bonded) {
      return { ok: false as const, statusCode: 403, error: 'Target storage seeder must have >= 100 SOV collateral bonded' };
    }
  }

  adjustUserBalanceSov(payerDid, -totalRentSov);
  const burnedSov = round6(totalRentSov * 0.50);
  const seederPayoutSov = round6(totalRentSov - burnedSov);
  const burn = recordPermanentBurn(burnedSov, 'PROTOCOL_DEFLATION');
  if (seederDid) {
    adjustUserBalanceSov(seederDid, seederPayoutSov);
  } else {
    routeYieldToStakers(seederPayoutSov);
  }
  if (seederPayoutSov > 0) {
    riskManagementEngine.recordRiskEvent({
      category: 'REVENUE_RECORDED',
      severity: 'LOW',
      direction: 'REVENUE',
      amountSov: seederPayoutSov,
      actorDid: payerDid,
      endpoint: '/api/economy/sinks/storage-rent',
      description: `Storage rent yield (${gb} GB x ${m}m${seederDid ? `, seeder ${seederDid}` : ', protocol staker pool'})`,
      prevented: false,
      metadata: { kind: 'STORAGE_RENT', storageGb: gb, months: m, totalRentSov, burnedSov },
    });
  }
  dbAny.db.storage_rent_logs.push({
    payerDid,
    seederDid: seederDid || 'protocol_yield',
    storageGb: gb,
    months: m,
    totalRentSov,
    burnedSov,
    burnTxId: burn.burnTxId,
    timestamp: Date.now(),
  });
  dbAny.save?.();
  return { ok: true as const, statusCode: 200, totalRentSov, burnedSov, seederPayoutSov, burnTxId: burn.burnTxId };
}

export function executeBoostBurnSink(payerDid: string, amountSovRaw: number, postId?: string, kind = 'PROMOTION_BADGE') {
  const amountSov = round6(Number(amountSovRaw || 0));
  if (amountSov <= 0 || getSpendableBalanceSov(payerDid) < amountSov) {
    return { ok: false as const, statusCode: 400, error: 'Positive amountSov within spendable balance required' };
  }
  adjustUserBalanceSov(payerDid, -amountSov);
  const burnedSov = round6(amountSov * 0.80);
  const yieldRoutedSov = round6(amountSov - burnedSov);
  const burn = recordPermanentBurn(burnedSov, 'PROTOCOL_DEFLATION');
  routeYieldToStakers(yieldRoutedSov);
  if (yieldRoutedSov > 0) {
    riskManagementEngine.recordRiskEvent({
      category: 'REVENUE_RECORDED',
      severity: 'LOW',
      direction: 'REVENUE',
      amountSov: yieldRoutedSov,
      actorDid: payerDid,
      endpoint: '/api/economy/sinks/boost',
      description: `Boost/Promotion protocol & staker yield (${kind})`,
      prevented: false,
      metadata: { kind: 'BOOST', postId },
    });
  }

  const dbAny = ensureEconomyState();
  let boostedPostId: string | undefined;
  if (postId) {
    const targetPost = (dbAny.db.posts || []).find((pt: any) => pt.id === postId);
    if (targetPost) {
      targetPost.boostSov = round6(Number(targetPost.boostSov || 0) + amountSov);
      targetPost.boostUntil = Math.max(Number(targetPost.boostUntil || 0), Date.now()) + 7 * 86400_000;
      boostedPostId = postId;
      dbAny.save?.();
    }
  }
  return { ok: true as const, statusCode: 200, kind, amountSov, burnedSov, yieldRoutedSov, burnTxId: burn.burnTxId, postId: boostedPostId };
}

function routeYieldToStakers(yieldSov: number): void {
  const dbAny = ensureEconomyState();
  const rounded = round6(yieldSov);
  if (rounded <= 0) return;

  const delegs = dbAny.db.staking_delegations || [];
  const patrons = dbAny.db.patron_stakes || [];
  const entries: Array<{ beneficiary: string; effWeight: number }> = [];
  let totalWeight = 0;

  for (const d of delegs) {
    const w = Number(d.amountSov || 0) * Number(d.multiplier || 1);
    if (w > 0) {
      entries.push({ beneficiary: d.delegatorDid, effWeight: w });
      totalWeight += w;
    }
  }
  for (const p of patrons) {
    const w = Number(p.amountSov || 0) * Number(p.multiplier || 1);
    if (w > 0) {
      entries.push({ beneficiary: p.creatorDid, effWeight: w });
      totalWeight += w;
    }
  }

  if (totalWeight <= 0) {
    dbAny.db.economy_totals.feePoolSov = round6((dbAny.db.economy_totals.feePoolSov || 0) + rounded);
    dbAny.save?.();
    return;
  }

  for (const e of entries) {
    const share = round6((rounded * e.effWeight) / totalWeight);
    if (share > 0) {
      dbAny.db.claimable_staking_rewards[e.beneficiary] = round6(
        Number(dbAny.db.claimable_staking_rewards[e.beneficiary] || 0) + share,
      );
    }
  }
  dbAny.save?.();
}

export function buildEconomyOverviewSnapshot() {
  const dbAny = ensureEconomyState();
  const base = typeof (sovraDb as any).getUltraSoundMetrics === 'function'
    ? (sovraDb as any).getUltraSoundMetrics()
    : {
        maxLifetimeCapSov: 100_000_000,
        genesisSupplySov: 30_000_000,
        totalBurnedSov: 0,
        circulatingSupplySov: 30_000_000,
        totalSystemAccountingSov: 30_000_000,
        burnSinkAddress: 'sovra10000000000000000000000000000000000000dead',
        burnSinkHex: '0x000000000000000000000000000000000000dead',
        burnSinkDid: 'did:sov:burn:dead',
      };

  const nowMs = Date.now();
  const bondedStakeSov = round6(dbAny.db.staking_delegations.reduce((s: number, d: any) => s + Number(d.amountSov || 0), 0));
  const unbondingSov = round6(dbAny.db.unbonding_queue.reduce((s: number, u: any) => s + Number(u.amountSov || 0), 0));
  const seederCollateralSov = round6(dbAny.db.seeder_bonds.reduce((s: number, b: any) => s + Number(b.bondedSov || 0), 0));
  const patronStakedSov = round6(dbAny.db.patron_stakes.reduce((s: number, p: any) => s + Number(p.amountSov || 0), 0));
  const vestingLockedSov = round6(dbAny.db.vesting_schedules.reduce((s: number, v: any) => s + calculateVestingLockedSov(v, nowMs), 0));
  const polLockedSov = round6(
    (dbAny.db.pol_locks || []).reduce((s: number, l: any) => s + (l.permanent || l.unlockAt > nowMs ? Number(l.sovLockedApprox || 0) : 0), 0),
  );
  const totalBurnedSov = round6(Number(base.totalBurnedSov || 0) + Number(dbAny.db.economy_totals?.burnedExtraSov || 0));
  const totalLockedSov = round6(bondedStakeSov + unbondingSov + seederCollateralSov + patronStakedSov + vestingLockedSov + polLockedSov);
  const grossSupplySov = Number(base.circulatingSupplySov || base.totalSystemAccountingSov || 30_000_000);
  const liquidCirculatingSov = Math.max(0, round6(grossSupplySov - totalLockedSov));

  const dailyEmissionEra0Sov = 23_972.602738; // 2:1:4 ratio from constants.go
  const dailyBurnRateSov = Number(dbAny.db.economy_totals?.dailyBurnedSov || totalBurnedSov);
  const totalEffectiveWeight = round6(
    dbAny.db.staking_delegations.reduce((s: number, d: any) => s + Number(d.amountSov || 0) * Number(d.multiplier || 1), 0) +
      dbAny.db.patron_stakes.reduce((s: number, p: any) => s + Number(p.amountSov || 0) * Number(p.multiplier || 1), 0),
  );

  // Dynamic APR estimation grounded strictly in Era 0 validator daily mint + accrued protocol fees
  const validatorDailyMintSov = 6_849.315068;
  const effectiveAprPercent = bondedStakeSov > 0
    ? Math.min(45, Math.round((((validatorDailyMintSov * 365) / bondedStakeSov) * 100) * 100) / 100)
    : 0;

  return {
    ...base,
    totalBurnedSov,
    bondedStakeSov,
    unbondingSov,
    seederCollateralSov,
    patronStakedSov,
    vestingLockedSov,
    polLockedSov,
    totalLockedSov,
    liquidCirculatingSov,
    totalEffectiveVeSovWeight: totalEffectiveWeight,
    dailyEmissionEra0Sov,
    dailyBurnRateSov,
    netDailySupplyDeltaSov: round6(dailyEmissionEra0Sov - dailyBurnRateSov),
    isNetDeflationaryToday: dailyBurnRateSov > dailyEmissionEra0Sov,
    estimatedStakingAprPercent: effectiveAprPercent,
    unbondingPeriodDays: 14,
    minTxFeeSov: 0.0001,
    feeBurnPercent: 50,
    handleBurnPercent: 80,
    storageRentBurnPercent: 50,
    boostBurnPercent: 80,
    minSeederBondSov: MIN_SEEDER_BOND_SOV,
    seederBondPerGbSov: SEEDER_BOND_PER_GB_SOV,
    polLockCount: (dbAny.db.pol_locks || []).length,
    registeredHandlesCount: (dbAny.db.paid_handles || []).length,
  };
}

export async function handleEconomyRoutes(ctx: EconomyRouteContext): Promise<boolean> {
  const { req, res, url, readBoundedBody, resolvePrincipal, enforceAuth } = ctx;
  const p = url.pathname;

  if (req.method === 'OPTIONS' && (p.startsWith('/api/economy') || p.startsWith('/api/blockchain/validators') || p.startsWith('/api/blockchain/staking'))) {
    sendJson(res, 204, {});
    return true;
  }

  // 1. GET /api/economy/overview - Transparent Supply, Burned, Locked, Circulating Dashboard
  if (p === '/api/economy/overview' && req.method === 'GET') {
    let l1Economy: any = null;
    try {
      const c = new AbortController();
      const tid = setTimeout(() => c.abort(), 600);
      const rpcRes = await fetch(`${PRIMARY_RPC}/query/economy`, { signal: c.signal });
      clearTimeout(tid);
      if (rpcRes.ok) l1Economy = await rpcRes.json();
    } catch {}
    sendJson(res, 200, {
      ok: true,
      economy: buildEconomyOverviewSnapshot(),
      l1ChainTelemetry: l1Economy,
    });
    return true;
  }

  // 2. GET /api/blockchain/validators - Dynamic Validator Registry with Real Fee/APR Telemetry
  if (p === '/api/blockchain/validators' && req.method === 'GET') {
    const overview = buildEconomyOverviewSnapshot();
    let rpcValidators: any[] = [];
    try {
      const c = new AbortController();
      const tid = setTimeout(() => c.abort(), 700);
      const r = await fetch(`${PRIMARY_RPC}/validators`, { signal: c.signal });
      clearTimeout(tid);
      if (r.ok) {
        const d: any = await r.json();
        rpcValidators = Array.isArray(d.validators) ? d.validators : [];
      }
    } catch {}

    const baseVals = rpcValidators.length > 0 ? rpcValidators : [
      { moniker: 'validator-0', address: 'sovra12a806ca82d506a025d580d40600abc77a69e10e7', voting_power: 25 },
      { moniker: 'validator-1', address: 'sovra1664a83c922035ce28bb723e4e92aed1e60e26ea1', voting_power: 25 },
      { moniker: 'validator-2', address: 'sovra1cb55be9a3d2afab1c9bcbffb88367bec797d11cb', voting_power: 25 },
      { moniker: 'validator-3', address: 'sovra1d96f6140a4c4ae797d9e3a5badf467eb756d3d20', voting_power: 25 },
    ];

    const dbAny = ensureEconomyState();
    const validators = baseVals.map((v: any, idx: number) => {
      const delegatedToVal = dbAny.db.staking_delegations
        .filter((d: any) => d.validatorAddress === v.address)
        .reduce((s: number, d: any) => s + Number(d.amountSov || 0), 0);
      return {
        id: `val_${idx + 1}`,
        name: v.moniker || `validator-${idx}`,
        address: v.address,
        votingPower: `${(delegatedToVal + Number(v.voting_power || 25) * 100_000).toLocaleString()} SOV`,
        delegatedSov: round6(delegatedToVal),
        commission: '5.0%',
        apr: overview.estimatedStakingAprPercent,
        status: 'active',
        uptimePercent: 100.0,
      };
    });

    sendJson(res, 200, { ok: true, validators, lockTiers: [
      { lockDays: 0, label: 'Flexible (0d)', multiplier: 1.0 },
      { lockDays: 90, label: '90 Days (1.5x veSOV)', multiplier: 1.5 },
      { lockDays: 365, label: '1 Year (2.5x veSOV)', multiplier: 2.5 },
      { lockDays: 730, label: '2 Years (3.0x veSOV)', multiplier: 3.0 },
    ], unbondingPeriodDays: 14 });
    return true;
  }

  // 3. GET /api/blockchain/staking/positions
  if (p === '/api/blockchain/staking/positions' && req.method === 'GET') {
    const dbAny = ensureEconomyState();
    const principal = resolvePrincipal(req);
    const did = url.searchParams.get('did') || principal?.did || '';
    const delegations = did ? dbAny.db.staking_delegations.filter((d: any) => d.delegatorDid === did) : dbAny.db.staking_delegations;
    const unbondings = did ? dbAny.db.unbonding_queue.filter((u: any) => u.ownerDid === did) : dbAny.db.unbonding_queue;
    const claimableSov = did ? Number(dbAny.db.claimable_staking_rewards[did] || 0) : 0;
    sendJson(res, 200, { ok: true, did, delegations, unbondings, claimableSov, unbondingPeriodDays: 14 });
    return true;
  }

  // 4. POST /api/blockchain/staking/delegate (with veSOV lock tiers & spendable vesting check)
  if (p === '/api/blockchain/staking/delegate' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    const parsed = JSON.parse(body || '{}');
    const principal = enforceAuth(req, res, parsed);
    if (!principal) return true;

    const delegatorDid = principal.did;
    const validatorAddress = String(parsed.validatorAddress || '').trim();
    const amountSov = round6(Number(parsed.amount || 0));
    const tier = resolveVeSovTier(Number(parsed.lockDays || 0));
    if (!validatorAddress || amountSov <= 0 || !tier) {
      sendJson(res, 400, { ok: false, error: 'validatorAddress, positive amount, and valid lockDays (0/90/365/730) required' });
      return true;
    }

    const spendable = getSpendableBalanceSov(delegatorDid);
    if (spendable < amountSov) {
      sendJson(res, 400, { ok: false, error: `Insufficient spendable SOV (after vesting locks): have ${spendable}, need ${amountSov}` });
      return true;
    }

    adjustUserBalanceSov(delegatorDid, -amountSov);
    const dbAny = ensureEconomyState();
    const nowMs = Date.now();
    const existing = dbAny.db.staking_delegations.find((d: any) => d.delegatorDid === delegatorDid && d.validatorAddress === validatorAddress);
    if (existing) {
      existing.amountSov = round6(Number(existing.amountSov) + amountSov);
      existing.unlockAt = Math.max(Number(existing.unlockAt || 0), nowMs + tier.lockMs);
      if (tier.multiplier > Number(existing.multiplier || 1)) {
        existing.multiplier = tier.multiplier;
        existing.lockTier = tier.lockTier;
        existing.lockDays = tier.lockDays;
      }
      existing.updatedAt = nowMs;
    } else {
      dbAny.db.staking_delegations.push({
        delegatorDid,
        validatorAddress,
        amountSov,
        lockDays: tier.lockDays,
        lockTier: tier.lockTier,
        multiplier: tier.multiplier,
        lockedAt: nowMs,
        unlockAt: nowMs + tier.lockMs,
        updatedAt: nowMs,
      });
    }
    dbAny.save?.();
    const txHash = '0x' + crypto.createHash('sha256').update(`delegate:${delegatorDid}:${validatorAddress}:${nowMs}`).digest('hex');
    sendJson(res, 200, {
      ok: true,
      txHash,
      delegatorDid,
      validatorAddress,
      amountSov,
      lockTier: tier.lockTier,
      multiplier: tier.multiplier,
      unlockAt: nowMs + tier.lockMs,
      effectiveVeSov: round6(amountSov * tier.multiplier),
    });
    return true;
  }

  // 5. POST /api/blockchain/staking/undelegate (Enforces lock tier & 14-day unbonding queue)
  if (p === '/api/blockchain/staking/undelegate' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    const parsed = JSON.parse(body || '{}');
    const principal = enforceAuth(req, res, parsed);
    if (!principal) return true;

    const dbAny = ensureEconomyState();
    const validatorAddress = String(parsed.validatorAddress || '').trim();
    const amountSov = round6(Number(parsed.amount || 0));
    const rec = dbAny.db.staking_delegations.find((d: any) => d.delegatorDid === principal.did && d.validatorAddress === validatorAddress);
    const nowMs = Date.now();
    if (!rec || amountSov <= 0 || Number(rec.amountSov) < amountSov) {
      sendJson(res, 400, { ok: false, error: 'Insufficient delegated balance to undelegate' });
      return true;
    }
    if (Number(rec.unlockAt || 0) > nowMs) {
      sendJson(res, 403, { ok: false, error: `Stake is time-locked (${rec.lockTier}) until ${new Date(rec.unlockAt).toISOString()}` });
      return true;
    }

    rec.amountSov = round6(Number(rec.amountSov) - amountSov);
    if (rec.amountSov <= 0) {
      dbAny.db.staking_delegations = dbAny.db.staking_delegations.filter((d: any) => d !== rec);
    }
    const completionTime = nowMs + DEFAULT_UNBONDING_MS;
    const entry = {
      id: 'unbond_' + crypto.randomBytes(6).toString('hex'),
      ownerDid: principal.did,
      target: validatorAddress,
      poolKind: 'delegation',
      amountSov,
      createdAt: nowMs,
      completionTime,
    };
    dbAny.db.unbonding_queue.push(entry);
    dbAny.save?.();
    sendJson(res, 200, { ok: true, unbonding: entry, unbondingPeriodDays: 14 });
    return true;
  }

  // 6. POST /api/blockchain/staking/mature - Release matured unbonding entries
  if (p === '/api/blockchain/staking/mature' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 16 * 1024);
    if (!ok) return true;
    const parsed = JSON.parse(body || '{}');
    const principal = resolvePrincipal(req, parsed);
    const nowMs = Number(parsed.asOfTimestampMs || Date.now());
    const dbAny = ensureEconomyState();
    const remaining: any[] = [];
    const released: any[] = [];

    for (const u of dbAny.db.unbonding_queue) {
      const ownerMatch = !principal || u.ownerDid === principal.did;
      if (ownerMatch && nowMs >= Number(u.completionTime)) {
        adjustUserBalanceSov(u.ownerDid, Number(u.amountSov));
        released.push(u);
      } else {
        remaining.push(u);
      }
    }
    dbAny.db.unbonding_queue = remaining;
    dbAny.save?.();
    sendJson(res, 200, { ok: true, releasedCount: released.length, released, pendingCount: remaining.length });
    return true;
  }

  // 7. POST /api/blockchain/staking/claim - Real fee yield claim
  if (p === '/api/blockchain/staking/claim' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 16 * 1024);
    if (!ok) return true;
    const parsed = JSON.parse(body || '{}');
    const principal = enforceAuth(req, res, parsed);
    if (!principal) return true;

    const dbAny = ensureEconomyState();
    if (Number(dbAny.db.economy_totals?.feePoolSov || 0) > 0) {
      const pAmt = Number(dbAny.db.economy_totals.feePoolSov);
      dbAny.db.economy_totals.feePoolSov = 0;
      routeYieldToStakers(pAmt);
    }

    const claimable = round6(Number(dbAny.db.claimable_staking_rewards[principal.did] || 0));
    if (claimable <= 0) {
      sendJson(res, 400, { ok: false, claimedSov: 0, error: 'No claimable staking yield available yet' });
      return true;
    }
    dbAny.db.claimable_staking_rewards[principal.did] = 0;
    const newBal = adjustUserBalanceSov(principal.did, claimable);
    sendJson(res, 200, { ok: true, claimedSov: claimable, newBalanceSov: newBal });
    return true;
  }

  // 8. DePIN Seeder Stake-to-Work Collateral Endpoints
  if (p === '/api/economy/seeder/bond' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;
    const parsed = JSON.parse(body || '{}');
    const principal = enforceAuth(req, res, parsed);
    if (!principal) return true;

    const amountSov = round6(Number(parsed.amountSov || 0));
    const storageCapacityGb = Math.max(1, Number(parsed.storageCapacityGb || 10));
    const dbAny = ensureEconomyState();
    const existing = dbAny.db.seeder_bonds.find((b: any) => b.did === principal.did);
    const totalAfter = round6((existing?.bondedSov || 0) + amountSov);
    const colCheck = validateSeederCollateralRequirement(BigInt(Math.round(totalAfter * 1_000_000)), storageCapacityGb);
    if (!colCheck.eligible || amountSov <= 0) {
      sendJson(res, 400, {
        ok: false,
        error: `Seeder collateral requires >= ${Number(colCheck.requiredUsov) / 1_000_000} SOV for ${storageCapacityGb} GB`,
        requiredSov: Number(colCheck.requiredUsov) / 1_000_000,
      });
      return true;
    }
    if (getSpendableBalanceSov(principal.did) < amountSov) {
      sendJson(res, 400, { ok: false, error: 'Insufficient spendable SOV for seeder collateral bond' });
      return true;
    }
    adjustUserBalanceSov(principal.did, -amountSov);
    if (existing) {
      existing.bondedSov = totalAfter;
      existing.storageCapacityGb = Math.max(Number(existing.storageCapacityGb || 0), storageCapacityGb);
      existing.updatedAt = Date.now();
    } else {
      dbAny.db.seeder_bonds.push({
        did: principal.did,
        bondedSov: totalAfter,
        storageCapacityGb,
        slashedSov: 0,
        earnedSov: 0,
        bondedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    dbAny.save?.();
    sendJson(res, 200, { ok: true, seederDid: principal.did, bondedSov: totalAfter, storageCapacityGb });
    return true;
  }

  if (p === '/api/economy/seeder/claim-epoch' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;
    const parsed = JSON.parse(body || '{}');
    const principal = enforceAuth(req, res, parsed);
    if (!principal) return true;

    const dbAny = ensureEconomyState();
    const rec = dbAny.db.seeder_bonds.find((b: any) => b.did === principal.did);
    const capGb = Number(parsed.storageCapacityGb || rec?.storageCapacityGb || 10);
    const colCheck = validateSeederCollateralRequirement(BigInt(Math.round(Number(rec?.bondedSov || 0) * 1_000_000)), capGb);
    if (!colCheck.eligible) {
      sendJson(res, 403, {
        ok: false,
        error: 'Stake-to-Work enforcement: Insufficient SOV collateral bonded for Seeder Pool emissions',
        bondedSov: Number(rec?.bondedSov || 0),
        requiredSov: Number(colCheck.requiredUsov) / 1_000_000,
      });
      return true;
    }
    if (parsed.porFailed === true) {
      const slashAmt = round6(Number(rec.bondedSov) * 0.10);
      rec.bondedSov = round6(Number(rec.bondedSov) - slashAmt);
      rec.slashedSov = round6(Number(rec.slashedSov || 0) + slashAmt);
      const burn = recordPermanentBurn(slashAmt, 'PROTOCOL_DEFLATION');
      sendJson(res, 403, { ok: false, slashedSov: slashAmt, burnTxId: burn.burnTxId, error: 'PoR challenge failed: 10% seeder collateral permanently burned' });
      return true;
    }
    const rewardSov = Math.min(25, Math.max(0.01, round6(Number(parsed.rewardSov || 1))));
    const newBal = adjustUserBalanceSov(principal.did, rewardSov);
    rec.earnedSov = round6(Number(rec.earnedSov || 0) + rewardSov);
    // Lock 50% of daily Seeder emissions under a 30-day rolling linear vest to prevent immediate sell pressure
    const lockedRewardSov = round6(rewardSov * 0.50);
    const liquidRewardSov = round6(rewardSov - lockedRewardSov);
    if (lockedRewardSov > 0) {
      applyRollingRewardVestingSov(principal.did, lockedRewardSov, 30, 'Seeder Emission Linear Lock (30d)');
    }
    dbAny.save?.();
    sendJson(res, 200, { ok: true, rewardedSov: rewardSov, liquidRewardSov, lockedRewardSov, newBalanceSov: newBal, bond: rec });
    return true;
  }

  if (p === '/api/economy/seeder/status' && req.method === 'GET') {
    const dbAny = ensureEconomyState();
    const did = url.searchParams.get('did') || resolvePrincipal(req)?.did || '';
    const bond = did ? dbAny.db.seeder_bonds.find((b: any) => b.did === did) || null : null;
    sendJson(res, 200, { ok: true, did, bond, allBondsCount: dbAny.db.seeder_bonds.length, minBondSov: MIN_SEEDER_BOND_SOV });
    return true;
  }

  // 9. Creator Patron Staking (Fan keeps principal, Creator receives staking/fee yield)
  if (p === '/api/economy/patron/stake' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;
    const parsed = JSON.parse(body || '{}');
    const principal = enforceAuth(req, res, parsed);
    if (!principal) return true;

    const creatorDid = String(parsed.creatorDid || '').trim();
    const amountSov = round6(Number(parsed.amountSov || 0));
    const tier = resolveVeSovTier(Number(parsed.lockDays || 0));
    if (!creatorDid || amountSov <= 0 || !tier || creatorDid === principal.did) {
      sendJson(res, 400, { ok: false, error: 'Valid creatorDid (distinct from fan), positive amountSov, and lockDays required' });
      return true;
    }
    if (getSpendableBalanceSov(principal.did) < amountSov) {
      sendJson(res, 400, { ok: false, error: 'Insufficient spendable SOV for patron stake' });
      return true;
    }
    adjustUserBalanceSov(principal.did, -amountSov);
    const dbAny = ensureEconomyState();
    const nowMs = Date.now();
    const existing = dbAny.db.patron_stakes.find((s: any) => s.fanDid === principal.did && s.creatorDid === creatorDid);
    if (existing) {
      existing.amountSov = round6(Number(existing.amountSov) + amountSov);
      existing.unlockAt = Math.max(Number(existing.unlockAt || 0), nowMs + tier.lockMs);
      if (tier.multiplier > Number(existing.multiplier || 1)) {
        existing.multiplier = tier.multiplier;
      }
    } else {
      dbAny.db.patron_stakes.push({
        fanDid: principal.did,
        creatorDid,
        amountSov,
        lockDays: tier.lockDays,
        multiplier: tier.multiplier,
        unlockAt: nowMs + tier.lockMs,
        stakedAt: nowMs,
      });
    }
    dbAny.save?.();
    sendJson(res, 200, { ok: true, fanDid: principal.did, creatorDid, amountSov, multiplier: tier.multiplier, principalSafe: true });
    return true;
  }

  if (p === '/api/economy/patron/unstake' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;
    const parsed = JSON.parse(body || '{}');
    const principal = enforceAuth(req, res, parsed);
    if (!principal) return true;

    const creatorDid = String(parsed.creatorDid || '').trim();
    const amountSov = round6(Number(parsed.amountSov || 0));
    const dbAny = ensureEconomyState();
    const rec = dbAny.db.patron_stakes.find((s: any) => s.fanDid === principal.did && s.creatorDid === creatorDid);
    const nowMs = Date.now();
    if (!rec || amountSov <= 0 || Number(rec.amountSov) < amountSov) {
      sendJson(res, 400, { ok: false, error: 'Insufficient patron stake balance' });
      return true;
    }
    if (Number(rec.unlockAt || 0) > nowMs) {
      sendJson(res, 403, { ok: false, error: `Patron stake locked until ${new Date(rec.unlockAt).toISOString()}` });
      return true;
    }
    rec.amountSov = round6(Number(rec.amountSov) - amountSov);
    if (rec.amountSov <= 0) dbAny.db.patron_stakes = dbAny.db.patron_stakes.filter((s: any) => s !== rec);
    const entry = {
      id: 'unbond_patron_' + crypto.randomBytes(5).toString('hex'),
      ownerDid: principal.did,
      target: creatorDid,
      poolKind: 'patron',
      amountSov,
      createdAt: nowMs,
      completionTime: nowMs + DEFAULT_UNBONDING_MS,
    };
    dbAny.db.unbonding_queue.push(entry);
    dbAny.save?.();
    sendJson(res, 200, { ok: true, unbonding: entry, unbondingPeriodDays: 14 });
    return true;
  }

  // 10. Paid Usage Burn Sinks: @handle (80% burn), storage pinning rent (50% burn), boost/badge (80% burn)
  if (p === '/api/economy/sinks/handle' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;
    const parsed = JSON.parse(body || '{}');
    const principal = enforceAuth(req, res, parsed);
    if (!principal) return true;

    const result = executeHandleBurnSink(principal.did, parsed.handle, Number(parsed.feeSov || HANDLE_REG_FEE_SOV));
    sendJson(res, result.statusCode, result);
    return true;
  }

  if (p === '/api/economy/sinks/storage-rent' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;
    const parsed = JSON.parse(body || '{}');
    const principal = enforceAuth(req, res, parsed);
    if (!principal) return true;

    const result = executeStorageRentBurnSink(
      principal.did,
      Number(parsed.storageGb || 1),
      Number(parsed.months || 1),
      parsed.seederDid,
      parsed.amountSov !== undefined ? Number(parsed.amountSov) : undefined,
    );
    sendJson(res, result.statusCode, result);
    return true;
  }

  if ((p === '/api/economy/sinks/boost' || p === '/api/feed/boost') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;
    const parsed = JSON.parse(body || '{}');
    const principal = enforceAuth(req, res, parsed);
    if (!principal) return true;

    const result = executeBoostBurnSink(
      principal.did,
      Number(parsed.amountSov || 0),
      parsed.postId ? String(parsed.postId) : undefined,
      parsed.kind ? String(parsed.kind) : (p === '/api/feed/boost' ? 'POST_BOOST' : 'PROMOTION_BADGE'),
    );
    sendJson(res, result.statusCode, result);
    return true;
  }

  // 11. Hold-to-Access Gate Verification (Spend = 0 SOV; verifies held + staked SOV >= requirement)
  if (p === '/api/economy/hold-gate/verify' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 16 * 1024);
    if (!ok) return true;
    const parsed = JSON.parse(body || '{}');
    const principal = resolvePrincipal(req, parsed);
    const holderDid = String(parsed.holderDid || principal?.did || '').trim();
    const minHoldSov = Math.max(0, Number(parsed.minHoldSov || 100));
    if (!holderDid) {
      sendJson(res, 400, { ok: false, error: 'holderDid required' });
      return true;
    }
    const dbAny = ensureEconomyState();
    const liquidSov = getUserBalanceSov(holderDid);
    const stakedSov = round6(
      dbAny.db.staking_delegations.filter((d: any) => d.delegatorDid === holderDid).reduce((s: number, d: any) => s + Number(d.amountSov || 0), 0) +
        dbAny.db.patron_stakes.filter((pt: any) => pt.fanDid === holderDid).reduce((s: number, pt: any) => s + Number(pt.amountSov || 0), 0),
    );
    const totalHeldSov = round6(liquidSov + stakedSov);
    const unlocked = totalHeldSov >= minHoldSov;
    sendJson(res, unlocked ? 200 : 403, {
      ok: unlocked,
      holderDid,
      liquidSov,
      stakedSov,
      totalHeldSov,
      minHoldSov,
      spentSov: 0,
    });
    return true;
  }

  // 12. Genesis Vesting Registration, Query & Spend-Check
  if (p === '/api/economy/vesting' && req.method === 'GET') {
    const dbAny = ensureEconomyState();
    const did = url.searchParams.get('did') || resolvePrincipal(req)?.did || '';
    const nowMs = Date.now();
    const list = (did ? dbAny.db.vesting_schedules.filter((s: any) => s.did === did) : dbAny.db.vesting_schedules).map((s: any) => ({
      ...s,
      lockedSov: calculateVestingLockedSov(s, nowMs),
      vestedSov: round6(s.originalAmountSov - calculateVestingLockedSov(s, nowMs)),
    }));
    sendJson(res, 200, { ok: true, schedules: list, totalLockedSov: getVestingLockedForDid(did, nowMs) });
    return true;
  }

  if (p === '/api/economy/vesting/register' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;
    const parsed = JSON.parse(body || '{}');
    const principal = enforceAuth(req, res, parsed);
    if (!principal) return true;

    const targetDid = String(parsed.did || principal.did).trim();
    const originalAmountSov = round6(Number(parsed.originalAmountSov || 0));
    const cliffDays = Math.max(0, Number(parsed.cliffDays ?? 365));
    const vestingDays = Math.max(1, Number(parsed.vestingDays ?? 1095));
    const nowMs = Date.now();
    const dbAny = ensureEconomyState();
    const sched = {
      did: targetDid,
      originalAmountSov,
      startAt: nowMs,
      cliffAt: nowMs + cliffDays * 86400_000,
      endAt: nowMs + (cliffDays + vestingDays) * 86400_000,
      label: parsed.label || `${cliffDays}d Cliff + ${vestingDays}d Linear`,
    };
    dbAny.db.vesting_schedules = dbAny.db.vesting_schedules.filter((s: any) => s.did !== targetDid);
    dbAny.db.vesting_schedules.push(sched);
    dbAny.save?.();
    sendJson(res, 200, { ok: true, schedule: sched, lockedSov: calculateVestingLockedSov(sched, nowMs) });
    return true;
  }

  // 13. Protocol-Owned Liquidity (POL) Lock Status & Enforcement
  if (p === '/api/economy/pol/lock' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;
    const parsed = JSON.parse(body || '{}');
    const principal = enforceAuth(req, res, parsed);
    if (!principal) return true;

    const tokenAddress = String(parsed.tokenAddress || '').trim();
    const dbAny = ensureEconomyState();
    const pool = (dbAny.db.amm_pools || []).find((pl: any) => pl.tokenAddress === tokenAddress || pl.poolAddress === tokenAddress);
    if (!pool) {
      sendJson(res, 404, { ok: false, error: 'AMM pool not found for POL locking' });
      return true;
    }
    const permanent = Boolean(parsed.permanent ?? true);
    const lockDays = Math.max(30, Number(parsed.lockDays || 365));
    const unlockAt = permanent ? 0 : Date.now() + lockDays * 86400_000;
    pool.polLocked = true;
    pool.polPermanent = permanent;
    pool.polUnlockAt = unlockAt;

    const sovApprox = round6(Number(pool.reserveSov || 0) / 1_000_000);
    dbAny.db.pol_locks = dbAny.db.pol_locks.filter((l: any) => l.poolAddress !== pool.poolAddress);
    const lockRec = {
      poolAddress: pool.poolAddress,
      tokenAddress: pool.tokenAddress,
      lockerDid: principal.did,
      permanent,
      unlockAt,
      sovLockedApprox: sovApprox,
      lockedAt: Date.now(),
    };
    dbAny.db.pol_locks.push(lockRec);
    dbAny.save?.();
    sendJson(res, 200, { ok: true, polLock: lockRec });
    return true;
  }

  if (p === '/api/economy/pol/status' && req.method === 'GET') {
    const dbAny = ensureEconomyState();
    sendJson(res, 200, { ok: true, locks: dbAny.db.pol_locks, count: dbAny.db.pol_locks.length });
    return true;
  }

  return false;
}
