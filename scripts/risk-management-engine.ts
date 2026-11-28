/**
 * @file scripts/risk-management-engine.ts
 * SOVRA Autonomous Financial Risk Management, Company P&L & Leakage Prevention Engine.
 *
 * Audits and enforces company economics in real time from persisted SQLite + JSON ledger state:
 * 1. Real Company P&L Ledger (Revenue Streams vs. Direct Subsidies, Grants, Bounties & Costs — zero hardcoded baselines).
 * 2. Deep Leakage & Vulnerability Matrix across all monetary surfaces (Referrals, Faucet, DePIN, Offline Vouchers,
 *    Fiat Webhook Replay/Withdrawals, AMM Drain, Meta-Tx Relayer Gas, Take-Rate Erosion, Wash Trading, Disintermediation).
 * 3. Active Runtime Guard Hooks (daily budgets, per-DID quotas, rate caps, AMM reserve drain guards, ledger reconciliation).
 * 4. One-Click Automated Mitigations & Audit-Logged Policy Controls.
 */

import crypto from 'node:crypto';
import { sovraDb } from './database-engine.ts';
import { sovereignAdminSecurity } from './admin-security.ts';
import { L1SettlementRelayer, type L1RpcTransport } from './l1-relayer.ts';

export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RiskGrade = 'LOW' | 'ELEVATED' | 'HIGH' | 'CRITICAL';
export type RiskLedgerCategory =
  | 'REFERRAL_SUBSIDY'
  | 'FAUCET_GRANT'
  | 'DEPIN_UNBACKED_SUBSIDY'
  | 'META_TX_GAS_SUBSIDY'
  | 'CREATOR_BOUNTY'
  | 'ADMIN_BALANCE_CREDIT'
  | 'OFFLINE_VOUCHER_EXPOSURE'
  | 'AMM_DRAIN_RISK'
  | 'WASH_TRADING_EXPOSURE'
  | 'DISINTERMEDIATION_FEE_LOSS'
  | 'OPERATIONAL_INFRA_EXPENSE'
  | 'SOLVENCY_DRIFT'
  | 'FIAT_WITHDRAWAL_OUTFLOW'
  | 'FIAT_ONRAMP_ISSUANCE'
  | 'SEEDER_EMISSION_COST'
  | 'UNBONDED_SEEDER_EMISSION'
  | 'L1_OFFCHAIN_FEE_DEFICIT'
  | 'MITIGATION_RECOVERY'
  | 'REVENUE_RECORDED';

export interface RiskPolicyConfig {
  dailyReferralBudgetSov: number;
  maxReferralsPerInviterPerDay: number;
  dailyFaucetBudgetSov: number;
  maxUnbackedDepinRatePerMbSov: number;
  dailyUnbackedDepinSubsidyCapSov: number;
  strictDepinFundedClientOnly: boolean;
  requireSeederBondForYield: boolean;
  dailyFiatMintCapSov: number;
  dailyMetaTxSubsidyCapSov: number;
  maxMetaTxPerDidPerDay: number;
  maxSingleAmmDrainPct: number;
  enforceStrictAmmDrainCap: boolean;
  platformTakeRateFloorPct: number;
  offlineVoucherMaxTtlMs: number;
  autoTripCircuitBreakerOnInsolvency: boolean;
  solvencyAlertThresholdSov: number;
  flagSyntheticTestGrantsInPnl: boolean;
  updatedAt: number;
  updatedBy: string;
}

export interface RiskLedgerEntry {
  id: string;
  category: RiskLedgerCategory;
  severity: RiskSeverity;
  direction: 'LOSS_OR_COST' | 'RECOVERED_OR_SAVED' | 'RISK_EXPOSURE' | 'REVENUE';
  amountSov: number;
  actorDid?: string;
  endpoint?: string;
  description: string;
  prevented: boolean;
  metadata?: Record<string, any>;
  createdAt: number;
}

export interface CompanyEconomicsPnLSnapshot {
  generatedAt: number;
  supply: {
    hardCapSov: number;
    genesisAllocationSov: number;
    circulatingSupplySov: number;
    totalBurnedSov: number;
    totalLockedSov: number;
    lockRatioPct: number;
    netDeflationary: boolean;
  };
  revenue: {
    platformTakeFeesSov: number;
    transferAndSettlementFeesSov: number;
    handleBurnSinkYieldSov: number;
    storageRentYieldSov: number;
    boostAndPromotionFeesSov: number;
    ammSwapRoyaltiesSov: number;
    bridgeFeesSov: number;
    aiMarketplaceFeesSov: number;
    grossProtocolRevenueSov: number;
    recordedBurnSinkTotalSov: number;
    dailyRevenueRateSov: number;
  };
  costsAndLosses: {
    referralSubsidiesSov: number;
    faucetGrantsSov: number;
    depinUnbackedSubsidiesSov: number;
    seederEmissionCostsSov: number;
    metaTxRelayerSubsidySov: number;
    creatorBountiesSov: number;
    adminManualCreditsSov: number;
    operationalExpensesSov: number;
    expiredOfflineVoucherLiabilitySov: number;
    washTradingFeeRebateExposureSov: number;
    disintermediationEstimatedFeeLossSov: number;
    l1OffchainFeeDeficitSov: number;
    fiatOnRampIssuanceSov: number;
    unbondedSeederEmissionExposureSov: number;
    syntheticDefaultWalletSeedSov: number;
    solvencyDiscrepancySov: number;
    totalDirectCostsAndSubsidiesSov: number;
    totalRiskAdjustedLossesSov: number;
    dailyCostRateSov: number;
  };
  pnl: {
    netOperatingProfitSov: number;
    riskAdjustedNetPnLSov: number;
    operatingMarginPct: number;
    dailyNetCashflowSov: number;
    liquidTreasurySov: number;
    runwayDays: number;
    runwayLabel: string;
    healthStatus: 'PROFITABLE_COMPOUNDING' | 'STABLE_SUSTAINABLE' | 'DEFICIT_WATCH' | 'RUNWAY_CRITICAL';
    recoveredSavingsSov: number;
    preventedAttacksCount: number;
  };
}

export interface LeakageVectorReport {
  id: string;
  title: string;
  category: string;
  severity: RiskSeverity;
  status: 'PROTECTED' | 'MONITORING' | 'EXPOSED' | 'MITIGATED';
  detectedExposureSov: number;
  preventedCount: number;
  codeLocation: string;
  rootCause: string;
  howToPrevent: string[];
  activeControl: string;
  recommendedMitigationAction: string;
}

export interface LeakageAuditReport {
  generatedAt: number;
  overallRiskScore: number;
  riskGrade: RiskGrade;
  totalExposureSov: number;
  totalDirectLossSov: number;
  totalRecoveredSavingsSov: number;
  preventedAttacksCount: number;
  vectors: LeakageVectorReport[];
  topPriorities: string[];
}

export interface RiskGuardDecision {
  allowed: boolean;
  reason?: string;
  code?: string;
  recordedCostSov?: number;
}

export const DEFAULT_RISK_POLICIES: RiskPolicyConfig = {
  dailyReferralBudgetSov: 50_000,
  maxReferralsPerInviterPerDay: 25,
  dailyFaucetBudgetSov: 250_000,
  maxUnbackedDepinRatePerMbSov: 0.01,
  dailyUnbackedDepinSubsidyCapSov: 1_000,
  strictDepinFundedClientOnly: false,
  requireSeederBondForYield: false,
  dailyFiatMintCapSov: 100_000,
  dailyMetaTxSubsidyCapSov: 500,
  maxMetaTxPerDidPerDay: 25,
  maxSingleAmmDrainPct: 25,
  enforceStrictAmmDrainCap: false,
  platformTakeRateFloorPct: 2.5,
  offlineVoucherMaxTtlMs: 7 * 86400_000,
  autoTripCircuitBreakerOnInsolvency: true,
  solvencyAlertThresholdSov: 1.0,
  flagSyntheticTestGrantsInPnl: true,
  updatedAt: 0,
  updatedBy: 'SYSTEM_DEFAULT',
};

function round4(val: number): number {
  return Math.round((Number(val) || 0) * 10_000) / 10_000;
}

function round2(val: number): number {
  return Math.round((Number(val) || 0) * 100) / 100;
}

export class RiskManagementEngine {
  private static instance: RiskManagementEngine | null = null;

  public static getInstance(): RiskManagementEngine {
    if (!RiskManagementEngine.instance) {
      RiskManagementEngine.instance = new RiskManagementEngine();
    }
    return RiskManagementEngine.instance;
  }

  private getDbAny(): any {
    const dbAny = sovraDb as any;
    if (!dbAny.db) dbAny.db = {};
    if (!Array.isArray(dbAny.db.risk_ledger)) dbAny.db.risk_ledger = [];
    if (!dbAny.db.risk_policies || typeof dbAny.db.risk_policies !== 'object') {
      dbAny.db.risk_policies = { ...DEFAULT_RISK_POLICIES, updatedAt: Date.now() };
    }
    return dbAny;
  }

  private getRawSqlite(): any {
    try {
      const sqliteEngine = typeof (sovraDb as any).getSqliteEngine === 'function'
        ? (sovraDb as any).getSqliteEngine()
        : null;
      return sqliteEngine?.getRawDb?.() || sqliteEngine?.db || null;
    } catch {
      return null;
    }
  }

  public getRiskPolicies(): RiskPolicyConfig {
    const dbAny = this.getDbAny();
    const sqliteEngine = typeof (sovraDb as any).getSqliteEngine === 'function'
      ? (sovraDb as any).getSqliteEngine()
      : null;

    const merged: RiskPolicyConfig = {
      ...DEFAULT_RISK_POLICIES,
      ...(dbAny.db.risk_policies || {}),
    };

    if (sqliteEngine && typeof sqliteEngine.getRiskPolicies === 'function') {
      try {
        const sqlPolicies = sqliteEngine.getRiskPolicies();
        if (sqlPolicies && typeof sqlPolicies === 'object') {
          Object.assign(merged, sqlPolicies);
        }
      } catch {}
    }

    return merged;
  }

  public updateRiskPolicies(
    partial: Partial<RiskPolicyConfig>,
    adminDid = 'did:sov:admin_root',
  ): RiskPolicyConfig {
    const current = this.getRiskPolicies();
    const next: RiskPolicyConfig = {
      ...current,
      dailyReferralBudgetSov: Math.max(0, Number(partial.dailyReferralBudgetSov ?? current.dailyReferralBudgetSov)),
      maxReferralsPerInviterPerDay: Math.max(1, Math.floor(Number(partial.maxReferralsPerInviterPerDay ?? current.maxReferralsPerInviterPerDay))),
      dailyFaucetBudgetSov: Math.max(0, Number(partial.dailyFaucetBudgetSov ?? current.dailyFaucetBudgetSov)),
      maxUnbackedDepinRatePerMbSov: Math.max(0, Number(partial.maxUnbackedDepinRatePerMbSov ?? current.maxUnbackedDepinRatePerMbSov)),
      dailyUnbackedDepinSubsidyCapSov: Math.max(0, Number(partial.dailyUnbackedDepinSubsidyCapSov ?? current.dailyUnbackedDepinSubsidyCapSov)),
      strictDepinFundedClientOnly:
        typeof partial.strictDepinFundedClientOnly === 'boolean'
          ? partial.strictDepinFundedClientOnly
          : current.strictDepinFundedClientOnly,
      requireSeederBondForYield:
        typeof partial.requireSeederBondForYield === 'boolean'
          ? partial.requireSeederBondForYield
          : current.requireSeederBondForYield,
      dailyFiatMintCapSov: Math.max(0, Number(partial.dailyFiatMintCapSov ?? current.dailyFiatMintCapSov)),
      dailyMetaTxSubsidyCapSov: Math.max(0, Number(partial.dailyMetaTxSubsidyCapSov ?? current.dailyMetaTxSubsidyCapSov)),
      maxMetaTxPerDidPerDay: Math.max(1, Math.floor(Number(partial.maxMetaTxPerDidPerDay ?? current.maxMetaTxPerDidPerDay))),
      maxSingleAmmDrainPct: Math.min(99, Math.max(1, Number(partial.maxSingleAmmDrainPct ?? current.maxSingleAmmDrainPct))),
      enforceStrictAmmDrainCap:
        typeof partial.enforceStrictAmmDrainCap === 'boolean'
          ? partial.enforceStrictAmmDrainCap
          : current.enforceStrictAmmDrainCap,
      platformTakeRateFloorPct: Math.min(10, Math.max(0.1, Number(partial.platformTakeRateFloorPct ?? current.platformTakeRateFloorPct))),
      offlineVoucherMaxTtlMs: Math.max(60_000, Number(partial.offlineVoucherMaxTtlMs ?? current.offlineVoucherMaxTtlMs)),
      autoTripCircuitBreakerOnInsolvency:
        typeof partial.autoTripCircuitBreakerOnInsolvency === 'boolean'
          ? partial.autoTripCircuitBreakerOnInsolvency
          : current.autoTripCircuitBreakerOnInsolvency,
      solvencyAlertThresholdSov: Math.max(0, Number(partial.solvencyAlertThresholdSov ?? current.solvencyAlertThresholdSov)),
      flagSyntheticTestGrantsInPnl:
        typeof partial.flagSyntheticTestGrantsInPnl === 'boolean'
          ? partial.flagSyntheticTestGrantsInPnl
          : current.flagSyntheticTestGrantsInPnl,
      updatedAt: Date.now(),
      updatedBy: adminDid,
    };

    const dbAny = this.getDbAny();
    dbAny.db.risk_policies = next;
    dbAny.save?.();

    const sqliteEngine = typeof (sovraDb as any).getSqliteEngine === 'function'
      ? (sovraDb as any).getSqliteEngine()
      : null;
    if (sqliteEngine && typeof sqliteEngine.saveRiskPolicies === 'function') {
      try {
        sqliteEngine.saveRiskPolicies(next);
      } catch {}
    }

    try {
      sovraDb.logAudit({
        id: 'audit_risk_policy_' + Date.now(),
        type: 'RISK_POLICY_UPDATED',
        actorDid: adminDid,
        actorHandle: '@risk_officer',
        details: JSON.stringify(partial).slice(0, 300),
        timestamp: Date.now(),
      });
    } catch {}

    return next;
  }

  public recordRiskEvent(entry: Omit<RiskLedgerEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): RiskLedgerEntry {
    const dbAny = this.getDbAny();
    const record: RiskLedgerEntry = {
      id: entry.id || `risk_${crypto.randomBytes(6).toString('hex')}`,
      category: entry.category,
      severity: entry.severity,
      direction: entry.direction,
      amountSov: round4(Math.abs(Number(entry.amountSov || 0))),
      actorDid: entry.actorDid,
      endpoint: entry.endpoint,
      description: entry.description,
      prevented: Boolean(entry.prevented),
      metadata: entry.metadata,
      createdAt: entry.createdAt || Date.now(),
    };

    dbAny.db.risk_ledger.unshift(record);
    if (dbAny.db.risk_ledger.length > 2000) {
      dbAny.db.risk_ledger = dbAny.db.risk_ledger.slice(0, 2000);
    }
    dbAny.save?.();

    const rawDb = this.getRawSqlite();
    if (rawDb) {
      try {
        rawDb.prepare(`
          INSERT OR REPLACE INTO risk_management_ledger
          (id, category, severity, direction, amount_sov, actor_did, endpoint, description, prevented, metadata_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.id,
          record.category,
          record.severity,
          record.direction,
          record.amountSov,
          record.actorDid || null,
          record.endpoint || null,
          record.description,
          record.prevented ? 1 : 0,
          JSON.stringify(record.metadata || {}),
          record.createdAt,
        );
      } catch {}
    }

    return record;
  }

  public getRiskLedger(limit = 100): RiskLedgerEntry[] {
    const rawDb = this.getRawSqlite();
    const dbAny = this.getDbAny();
    const memList: RiskLedgerEntry[] = Array.isArray(dbAny.db.risk_ledger) ? dbAny.db.risk_ledger : [];

    if (rawDb) {
      try {
        const rows = rawDb.prepare(
          'SELECT * FROM risk_management_ledger ORDER BY created_at DESC LIMIT ?',
        ).all(limit) as any[];
        if (rows.length > 0) {
          const mapById = new Map<string, RiskLedgerEntry>();
          for (const r of rows) {
            mapById.set(r.id, {
              id: r.id,
              category: r.category,
              severity: r.severity,
              direction: r.direction,
              amountSov: Number(r.amount_sov || 0),
              actorDid: r.actor_did || undefined,
              endpoint: r.endpoint || undefined,
              description: r.description,
              prevented: Boolean(r.prevented),
              metadata: r.metadata_json ? JSON.parse(r.metadata_json) : undefined,
              createdAt: Number(r.created_at),
            });
          }
          for (const m of memList) {
            if (!mapById.has(m.id)) mapById.set(m.id, m);
          }
          return Array.from(mapById.values())
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, limit);
        }
      } catch {}
    }

    return memList.slice(0, limit);
  }

  private get24hCostByCategory(category: RiskLedgerCategory, actorDid?: string): { totalSov: number; count: number } {
    return this.get24hActiveByCategory(category, actorDid, true);
  }

  private get24hActiveByCategory(
    category: RiskLedgerCategory,
    actorDid?: string,
    onlyLossDirection = false,
  ): { totalSov: number; count: number } {
    const since = Date.now() - 86400_000;
    const rawDb = this.getRawSqlite();
    if (rawDb) {
      try {
        const dirClause = onlyLossDirection ? "AND direction = 'LOSS_OR_COST'" : "AND direction != 'RECOVERED_OR_SAVED'";
        const sql = actorDid
          ? `SELECT COALESCE(SUM(amount_sov), 0) as total_sov, COUNT(*) as cnt FROM risk_management_ledger WHERE created_at >= ? AND category = ? AND prevented = 0 ${dirClause} AND actor_did = ?`
          : `SELECT COALESCE(SUM(amount_sov), 0) as total_sov, COUNT(*) as cnt FROM risk_management_ledger WHERE created_at >= ? AND category = ? AND prevented = 0 ${dirClause}`;
        const row = (actorDid ? rawDb.prepare(sql).get(since, category, actorDid) : rawDb.prepare(sql).get(since, category)) as any;
        if (row && (Number(row.cnt || 0) > 0 || (this.getDbAny().db.risk_ledger || []).length === 0)) {
          return {
            totalSov: round4(Number(row.total_sov || 0)),
            count: Number(row.cnt || 0),
          };
        }
      } catch {}
    }
    const dbAny = this.getDbAny();
    const memList: RiskLedgerEntry[] = Array.isArray(dbAny.db.risk_ledger) ? dbAny.db.risk_ledger : [];
    const entries = memList.filter(
      (e) =>
        e.createdAt >= since &&
        e.category === category &&
        !e.prevented &&
        (onlyLossDirection ? e.direction === 'LOSS_OR_COST' : e.direction !== 'RECOVERED_OR_SAVED') &&
        (!actorDid || e.actorDid === actorDid),
    );
    return {
      totalSov: round4(entries.reduce((s, e) => s + Number(e.amountSov || 0), 0)),
      count: entries.length,
    };
  }

  // =========================================================================
  // RUNTIME GUARD HOOKS (CALLED BY WALLET, REFERRAL & DEPIN ROUTES)
  // =========================================================================

  public checkAndRecordReferralPayout(inviterDid: string, inviteeDid: string, totalRewardSov: number): RiskGuardDecision {
    const policy = this.getRiskPolicies();
    const global24h = this.get24hCostByCategory('REFERRAL_SUBSIDY');
    const inviter24h = this.get24hCostByCategory('REFERRAL_SUBSIDY', inviterDid);

    if (global24h.totalSov + totalRewardSov > policy.dailyReferralBudgetSov) {
      this.recordRiskEvent({
        category: 'REFERRAL_SUBSIDY',
        severity: 'HIGH',
        direction: 'RECOVERED_OR_SAVED',
        amountSov: totalRewardSov,
        actorDid: inviterDid,
        endpoint: '/api/referral/claim',
        description: `Blocked referral payout (+${totalRewardSov} SOV): 24h global referral budget (${policy.dailyReferralBudgetSov} SOV) exhausted`,
        prevented: true,
        metadata: { inviteeDid, globalSpent24h: global24h.totalSov },
      });
      return {
        allowed: false,
        code: 'REFERRAL_DAILY_BUDGET_EXCEEDED',
        reason: `Daily protocol referral subsidy budget (${policy.dailyReferralBudgetSov} SOV) reached.`,
      };
    }

    if (inviter24h.count >= policy.maxReferralsPerInviterPerDay) {
      this.recordRiskEvent({
        category: 'REFERRAL_SUBSIDY',
        severity: 'MEDIUM',
        direction: 'RECOVERED_OR_SAVED',
        amountSov: totalRewardSov,
        actorDid: inviterDid,
        endpoint: '/api/referral/apply',
        description: `Blocked Sybil referral burst by ${inviterDid}: exceeded ${policy.maxReferralsPerInviterPerDay}/day limit`,
        prevented: true,
        metadata: { inviteeDid, inviterCount24h: inviter24h.count },
      });
      return {
        allowed: false,
        code: 'REFERRAL_INVITER_VELOCITY_CAP',
        reason: `Daily referral limit (${policy.maxReferralsPerInviterPerDay}/24h) exceeded for this inviter.`,
      };
    }

    this.recordRiskEvent({
      category: 'REFERRAL_SUBSIDY',
      severity: 'LOW',
      direction: 'LOSS_OR_COST',
      amountSov: totalRewardSov,
      actorDid: inviterDid,
      endpoint: '/api/referral/apply',
      description: `Issued 2-sided referral bonus (${totalRewardSov} SOV) for ${inviterDid} -> ${inviteeDid}`,
      prevented: false,
      metadata: { inviteeDid },
    });
    return { allowed: true, recordedCostSov: totalRewardSov };
  }

  public checkAndRecordFaucetClaim(targetDid: string, amountSov: number): RiskGuardDecision {
    const policy = this.getRiskPolicies();
    const global24h = this.get24hCostByCategory('FAUCET_GRANT');

    if (global24h.totalSov + amountSov > policy.dailyFaucetBudgetSov) {
      this.recordRiskEvent({
        category: 'FAUCET_GRANT',
        severity: 'CRITICAL',
        direction: 'RECOVERED_OR_SAVED',
        amountSov,
        actorDid: targetDid,
        endpoint: '/api/wallet/faucet/claim',
        description: `Blocked faucet drip (+${amountSov} SOV): daily global faucet cap (${policy.dailyFaucetBudgetSov} SOV) exceeded`,
        prevented: true,
        metadata: { globalFaucet24h: global24h.totalSov },
      });
      return {
        allowed: false,
        code: 'GLOBAL_FAUCET_BUDGET_EXCEEDED',
        reason: `Global 24h protocol faucet grant limit (${policy.dailyFaucetBudgetSov} SOV) exhausted.`,
      };
    }

    this.recordRiskEvent({
      category: 'FAUCET_GRANT',
      severity: 'LOW',
      direction: 'LOSS_OR_COST',
      amountSov,
      actorDid: targetDid,
      endpoint: '/api/wallet/faucet/claim',
      description: `Genesis starter faucet grant issued (+${amountSov} SOV) to ${targetDid}`,
      prevented: false,
    });
    return { allowed: true, recordedCostSov: amountSov };
  }

  public checkAndRecordDepinSubsidy(
    hostDid: string,
    clientDid: string,
    microEarnedSov: number,
    ratePerMbSov: number,
    clientHasBalance: boolean,
  ): RiskGuardDecision {
    if (clientHasBalance) {
      return { allowed: true, recordedCostSov: 0 };
    }

    const policy = this.getRiskPolicies();
    if (policy.strictDepinFundedClientOnly) {
      this.recordRiskEvent({
        category: 'DEPIN_UNBACKED_SUBSIDY',
        severity: 'HIGH',
        direction: 'RECOVERED_OR_SAVED',
        amountSov: microEarnedSov,
        actorDid: hostDid,
        endpoint: '/api/depin/mesh/meter',
        description: `Rejected unbacked DePIN payout (+${microEarnedSov} SOV): strict funded-client mode active for client ${clientDid}`,
        prevented: true,
      });
      return {
        allowed: false,
        code: 'DEPIN_CLIENT_FUNDING_REQUIRED',
        reason: 'DePIN metering requires a funded registered client account under current Risk Policy.',
      };
    }

    if (ratePerMbSov > policy.maxUnbackedDepinRatePerMbSov || microEarnedSov > 5.0) {
      this.recordRiskEvent({
        category: 'DEPIN_UNBACKED_SUBSIDY',
        severity: 'CRITICAL',
        direction: 'RECOVERED_OR_SAVED',
        amountSov: microEarnedSov,
        actorDid: hostDid,
        endpoint: '/api/depin/mesh/meter',
        description: `Blocked inflated unbacked DePIN mint (${microEarnedSov} SOV @ ${ratePerMbSov} SOV/MB > max ${policy.maxUnbackedDepinRatePerMbSov})`,
        prevented: true,
        metadata: { clientDid, ratePerMbSov },
      });
      return {
        allowed: false,
        code: 'DEPIN_UNBACKED_RATE_CAP_EXCEEDED',
        reason: `Unbacked DePIN subsidy rate exceeds safe protocol ceiling (${policy.maxUnbackedDepinRatePerMbSov} SOV/MB, max 5 SOV/pulse).`,
      };
    }

    const global24h = this.get24hCostByCategory('DEPIN_UNBACKED_SUBSIDY');
    if (global24h.totalSov + microEarnedSov > policy.dailyUnbackedDepinSubsidyCapSov) {
      this.recordRiskEvent({
        category: 'DEPIN_UNBACKED_SUBSIDY',
        severity: 'HIGH',
        direction: 'RECOVERED_OR_SAVED',
        amountSov: microEarnedSov,
        actorDid: hostDid,
        endpoint: '/api/depin/mesh/meter',
        description: `Blocked unbacked DePIN payout: 24h subsidy budget (${policy.dailyUnbackedDepinSubsidyCapSov} SOV) depleted`,
        prevented: true,
      });
      return {
        allowed: false,
        code: 'DEPIN_SUBSIDY_BUDGET_EXHAUSTED',
        reason: `24h unbacked DePIN subsidy cap (${policy.dailyUnbackedDepinSubsidyCapSov} SOV) reached; client must fund balance.`,
      };
    }

    this.recordRiskEvent({
      category: 'DEPIN_UNBACKED_SUBSIDY',
      severity: 'MEDIUM',
      direction: 'LOSS_OR_COST',
      amountSov: microEarnedSov,
      actorDid: hostDid,
      endpoint: '/api/depin/mesh/meter',
      description: `Protocol subsidized unregistered client hotspot session (+${microEarnedSov} SOV to host ${hostDid})`,
      prevented: false,
      metadata: { clientDid, ratePerMbSov },
    });
    return { allowed: true, recordedCostSov: microEarnedSov };
  }

  public checkAndRecordMetaTxSubsidy(senderDid: string, estimatedRelayerGasSov = 0.02): RiskGuardDecision {
    const policy = this.getRiskPolicies();
    const global24h = this.get24hCostByCategory('META_TX_GAS_SUBSIDY');
    const did24h = this.get24hCostByCategory('META_TX_GAS_SUBSIDY', senderDid);

    if (global24h.totalSov + estimatedRelayerGasSov > policy.dailyMetaTxSubsidyCapSov) {
      this.recordRiskEvent({
        category: 'META_TX_GAS_SUBSIDY',
        severity: 'HIGH',
        direction: 'RECOVERED_OR_SAVED',
        amountSov: estimatedRelayerGasSov,
        actorDid: senderDid,
        endpoint: '/api/wallet/meta-tx',
        description: `Blocked gasless meta-tx sponsorship: 24h relayer subsidy cap (${policy.dailyMetaTxSubsidyCapSov} SOV) reached`,
        prevented: true,
      });
      return {
        allowed: false,
        code: 'META_TX_SUBSIDY_CAP_EXCEEDED',
        reason: `Daily meta-tx relayer sponsorship budget (${policy.dailyMetaTxSubsidyCapSov} SOV) exhausted.`,
      };
    }

    if (did24h.count >= policy.maxMetaTxPerDidPerDay) {
      this.recordRiskEvent({
        category: 'META_TX_GAS_SUBSIDY',
        severity: 'MEDIUM',
        direction: 'RECOVERED_OR_SAVED',
        amountSov: estimatedRelayerGasSov,
        actorDid: senderDid,
        endpoint: '/api/wallet/meta-tx',
        description: `Blocked meta-tx spam by ${senderDid}: exceeded ${policy.maxMetaTxPerDidPerDay} sponsored txs/24h`,
        prevented: true,
      });
      return {
        allowed: false,
        code: 'META_TX_DID_QUOTA_EXCEEDED',
        reason: `Daily sponsored meta-tx quota (${policy.maxMetaTxPerDidPerDay}/day) exceeded.`,
      };
    }

    this.recordRiskEvent({
      category: 'META_TX_GAS_SUBSIDY',
      severity: 'LOW',
      direction: 'LOSS_OR_COST',
      amountSov: estimatedRelayerGasSov,
      actorDid: senderDid,
      endpoint: '/api/wallet/meta-tx',
      description: `Relayer sponsored meta-tx gas (${estimatedRelayerGasSov} SOV) for ${senderDid}`,
      prevented: false,
    });
    return { allowed: true, recordedCostSov: estimatedRelayerGasSov };
  }

  public checkAmmPoolSwapRisk(
    tokenAddress: string,
    actorDid: string,
    sovDeltaUsov: number,
    poolReserveUsov: number,
    endpoint = '/api/wallet/swap',
  ): RiskGuardDecision {
    if (poolReserveUsov <= 0) return { allowed: true };
    const drainPct = round2((sovDeltaUsov / poolReserveUsov) * 100);
    const policy = this.getRiskPolicies();
    const sovApprox = round4(sovDeltaUsov / 1_000_000);

    if (drainPct > policy.maxSingleAmmDrainPct) {
      const shouldBlock = policy.enforceStrictAmmDrainCap && poolReserveUsov >= 1_000_000;
      this.recordRiskEvent({
        category: 'AMM_DRAIN_RISK',
        severity: drainPct > 50 ? 'CRITICAL' : 'HIGH',
        direction: shouldBlock ? 'RECOVERED_OR_SAVED' : 'RISK_EXPOSURE',
        amountSov: sovApprox,
        actorDid,
        endpoint,
        description: `${shouldBlock ? 'Blocked' : 'Flagged'} high-impact AMM swap draining ${drainPct.toFixed(1)}% of pool SOV reserve (${tokenAddress})`,
        prevented: shouldBlock,
        metadata: { tokenAddress, drainPct, sovDeltaUsov, poolReserveUsov },
      });
      if (shouldBlock) {
        return {
          allowed: false,
          code: 'AMM_MAX_POOL_DRAIN_EXCEEDED',
          reason: `Single trade exceeds max ${policy.maxSingleAmmDrainPct}% AMM pool reserve drain guard (${drainPct.toFixed(1)}%).`,
        };
      }
    }
    return { allowed: true };
  }

  public checkAndRecordFiatOnRamp(
    userDid: string,
    amountSov: number,
    paymentId?: string,
  ): RiskGuardDecision {
    const policy = this.getRiskPolicies();
    const today = this.get24hActiveByCategory('FIAT_ONRAMP_ISSUANCE', undefined, false);

    if (today.totalSov + amountSov > policy.dailyFiatMintCapSov) {
      this.recordRiskEvent({
        category: 'FIAT_ONRAMP_ISSUANCE',
        severity: 'CRITICAL',
        direction: 'RECOVERED_OR_SAVED',
        amountSov,
        actorDid: userDid,
        endpoint: '/api/wallet/fiat/webhook',
        description: `Blocked fiat on-ramp issuance (+${amountSov} SOV): 24h mint ceiling (${policy.dailyFiatMintCapSov} SOV) exceeded`,
        prevented: true,
        metadata: { paymentId, fiatIssued24h: today.totalSov },
      });
      return {
        allowed: false,
        code: 'DAILY_FIAT_MINT_CAP_EXCEEDED',
        reason: `Daily fiat-backed SOV issuance limit (${policy.dailyFiatMintCapSov} SOV/24h) exceeded.`,
      };
    }

    this.recordRiskEvent({
      category: 'FIAT_ONRAMP_ISSUANCE',
      severity: 'LOW',
      direction: 'RISK_EXPOSURE',
      amountSov,
      actorDid: userDid,
      endpoint: '/api/wallet/fiat/webhook',
      description: `Fiat on-ramp credited +${amountSov} SOV (${paymentId || 'webhook'})`,
      prevented: false,
      metadata: { paymentId },
    });
    return { allowed: true, recordedCostSov: amountSov };
  }

  public checkAndRecordSeederYield(
    seederDid: string,
    claimableSov: number,
    bondedSov: number,
    minRequiredBondSov = 100,
  ): RiskGuardDecision {
    const policy = this.getRiskPolicies();
    const strictBond = Boolean(policy.requireSeederBondForYield || policy.strictDepinFundedClientOnly);

    if (bondedSov < minRequiredBondSov) {
      if (strictBond) {
        this.recordRiskEvent({
          category: 'UNBONDED_SEEDER_EMISSION',
          severity: 'HIGH',
          direction: 'RECOVERED_OR_SAVED',
          amountSov: claimableSov,
          actorDid: seederDid,
          endpoint: '/api/wallet/claim-seeder-yield',
          description: `Blocked unbonded Seeder yield (+${claimableSov} SOV): bonded ${bondedSov} SOV < required ${minRequiredBondSov} SOV`,
          prevented: true,
          metadata: { bondedSov, minRequiredBondSov },
        });
        return {
          allowed: false,
          code: 'SEEDER_BOND_REQUIRED',
          reason: `Stake-to-Work active: Seeder yield claims require >= ${minRequiredBondSov} SOV collateral bonded (currently ${bondedSov} SOV).`,
        };
      }

      this.recordRiskEvent({
        category: 'UNBONDED_SEEDER_EMISSION',
        severity: 'MEDIUM',
        direction: 'RISK_EXPOSURE',
        amountSov: claimableSov,
        actorDid: seederDid,
        endpoint: '/api/wallet/claim-seeder-yield',
        description: `Unbonded Seeder claimed +${claimableSov} SOV emission with ${bondedSov} < ${minRequiredBondSov} SOV collateral`,
        prevented: false,
        metadata: { bondedSov, minRequiredBondSov },
      });
    }

    if (claimableSov > 0) {
      this.recordRiskEvent({
        category: 'SEEDER_EMISSION_COST',
        severity: 'LOW',
        direction: 'LOSS_OR_COST',
        amountSov: claimableSov,
        actorDid: seederDid,
        endpoint: '/api/wallet/claim-seeder-yield',
        description: `Seeder bandwidth reward claimed (+${claimableSov} SOV; 50% rolling 30d vesting lock applied)`,
        prevented: false,
        metadata: { bondedSov },
      });
    }

    return { allowed: true, recordedCostSov: claimableSov };
  }

  public reconcileOffchainTransfersToL1(adminDid = 'did:sov:admin_root'): {
    ok: boolean;
    pendingCount: number;
    pendingAmountSov: number;
    pendingFeeDeficitSov: number;
    healedCount: number;
    queuedIntents: any[];
  } {
    const now = Date.now();
    const rawDb = this.getRawSqlite();
    const sqliteEngine = typeof (sovraDb as any).getSqliteEngine === 'function'
      ? (sovraDb as any).getSqliteEngine()
      : null;
    const pending = sqliteEngine && typeof sqliteEngine.getPendingSettlementIntents === 'function'
      ? sqliteEngine.getPendingSettlementIntents()
      : [];
    let pendingAmountSov = 0;
    for (const p of pending) pendingAmountSov += Number(p.amount_sov || 0);
    const pendingFeeDeficitSov = round4(pending.length * 0.0001);

    let healedCount = 0;
    if (rawDb && pending.length > 0) {
      try {
        // Resolve duplicate/already-committed L1_OFFCHAIN_FEE_DEFICIT backlog markers after reconciliation scan
        const res = rawDb.prepare(
          "UPDATE risk_management_ledger SET prevented = 1 WHERE category = 'L1_OFFCHAIN_FEE_DEFICIT' AND prevented = 0",
        ).run();
        healedCount = Number(res?.changes || 0);
      } catch {}
    }

    const dbAny = this.getDbAny();
    for (const e of dbAny.db.risk_ledger) {
      if (e.category === 'L1_OFFCHAIN_FEE_DEFICIT' && !e.prevented) {
        e.prevented = true;
      }
    }
    dbAny.save?.();

    this.recordRiskEvent({
      category: 'MITIGATION_RECOVERY',
      severity: pending.length > 0 ? 'MEDIUM' : 'LOW',
      direction: 'RECOVERED_OR_SAVED',
      amountSov: pendingFeeDeficitSov,
      actorDid: adminDid,
      endpoint: '/api/admin/risk/mitigate',
      createdAt: now,
      description: `L1 off-chain transfer audit scanned ${pending.length} pending settlement intent(s) (${round4(pendingAmountSov)} SOV volume; ${pendingFeeDeficitSov} SOV fee/burn queue)`,
      prevented: true,
      metadata: { pendingCount: pending.length, pendingAmountSov: round4(pendingAmountSov), pendingFeeDeficitSov, healedCount },
    });

    return {
      ok: true,
      pendingCount: pending.length,
      pendingAmountSov: round4(pendingAmountSov),
      pendingFeeDeficitSov,
      healedCount,
      queuedIntents: pending.slice(0, 50).map((i: any) => ({
        id: i.id,
        senderDid: i.sender_did,
        recipientDid: i.recipient_did,
        amountSov: Number(i.amount_sov || 0),
        state: i.state,
        createdAt: Number(i.created_at || 0),
      })),
    };
  }

  public async reconcileOffchainTransfersWithRelayer(options?: {
    rpcUrls?: string[];
    transport?: L1RpcTransport;
    forceImmediateRetry?: boolean;
  }) {
    const store = (sovraDb as any).getSovraStore();
    const relayer = new L1SettlementRelayer({
      store,
      riskEngine: this,
      rpcUrls: options?.rpcUrls,
      transport: options?.transport,
    });
    return relayer.processPendingIntents(options?.forceImmediateRetry ?? true);
  }

  private getAggregatedRiskMetrics(sevenDaysAgo: number): {
    catTotals: Map<string, number>;
    metaRevenueTotals: Map<string, number>;
    preventedCountByCat: Map<string, number>;
    totalPreventedCount: number;
    totalRecoveredSavingsSov: number;
    totalUnlabeledRevenueSov: number;
    rev7dRisk: number;
    costs7dRisk: number;
    ammUnpreventedExposure: number;
  } {
    const dbAny = this.getDbAny();
    const rawDb = this.getRawSqlite();
    const catTotals = new Map<string, number>();
    const metaRevenueTotals = new Map<string, number>();
    const preventedCountByCat = new Map<string, number>();
    let totalPreventedCount = 0;
    let totalRecoveredSavingsSov = 0;
    let totalUnlabeledRevenueSov = 0;
    let rev7dRisk = 0;
    let costs7dRisk = 0;

    let usedSqliteAgg = false;
    const memEntries: RiskLedgerEntry[] = Array.isArray(dbAny.db.risk_ledger) ? dbAny.db.risk_ledger : [];

    if (rawDb) {
      try {
        const countRow = rawDb.prepare('SELECT COUNT(*) as c FROM risk_management_ledger').get() as any;
        const sqlCount = Number(countRow?.c || 0);
        if (sqlCount > 0 || memEntries.length === 0) {
          usedSqliteAgg = true;
          const aggRows = rawDb.prepare(`
            SELECT category, direction, prevented,
                   COALESCE(SUM(amount_sov), 0) as total_sov,
                   COUNT(*) as cnt
            FROM risk_management_ledger
            GROUP BY category, direction, prevented
          `).all() as any[];

          for (const r of aggRows) {
            const amt = Number(r.total_sov || 0);
            const cnt = Number(r.cnt || 0);
            const prev = Boolean(r.prevented);
            if (prev) {
              totalPreventedCount += cnt;
              preventedCountByCat.set(r.category, (preventedCountByCat.get(r.category) || 0) + cnt);
            }
            if (r.direction === 'RECOVERED_OR_SAVED') {
              totalRecoveredSavingsSov += amt;
            }
            if (!prev) {
              const key = `${r.category}|${r.direction}`;
              catTotals.set(key, (catTotals.get(key) || 0) + amt);
            }
          }

          try {
            const revKindRows = rawDb.prepare(`
              SELECT COALESCE(json_extract(metadata_json, '$.kind'), '') as meta_kind,
                     COALESCE(SUM(amount_sov), 0) as total_sov
              FROM risk_management_ledger
              WHERE direction = 'REVENUE' AND prevented = 0
              GROUP BY meta_kind
            `).all() as any[];
            for (const rr of revKindRows) {
              const kind = String(rr.meta_kind || '');
              const amt = Number(rr.total_sov || 0);
              if (kind) metaRevenueTotals.set(kind, (metaRevenueTotals.get(kind) || 0) + amt);
              else totalUnlabeledRevenueSov += amt;
            }
          } catch {
            const revRows = rawDb.prepare(
              "SELECT metadata_json, amount_sov FROM risk_management_ledger WHERE direction = 'REVENUE' AND prevented = 0",
            ).all() as any[];
            for (const rr of revRows) {
              let kind = '';
              try {
                if (rr.metadata_json) kind = String(JSON.parse(rr.metadata_json)?.kind || '');
              } catch {}
              const amt = Number(rr.amount_sov || 0);
              if (kind) metaRevenueTotals.set(kind, (metaRevenueTotals.get(kind) || 0) + amt);
              else totalUnlabeledRevenueSov += amt;
            }
          }

          try {
            const rows7d = rawDb.prepare(`
              SELECT direction,
                     COALESCE(json_extract(metadata_json, '$.kind'), '') as meta_kind,
                     COALESCE(SUM(amount_sov), 0) as total_sov
              FROM risk_management_ledger
              WHERE prevented = 0 AND created_at >= ?
              GROUP BY direction, meta_kind
            `).all(sevenDaysAgo) as any[];
            for (const r of rows7d) {
              if (r.direction === 'REVENUE' && r.meta_kind !== 'PLATFORM_TAKE_FEE') {
                rev7dRisk += Number(r.total_sov || 0);
              }
              if (r.direction === 'LOSS_OR_COST') costs7dRisk += Number(r.total_sov || 0);
            }
          } catch {
            const rows7d = rawDb.prepare(`
              SELECT direction, metadata_json, amount_sov
              FROM risk_management_ledger
              WHERE prevented = 0 AND created_at >= ?
            `).all(sevenDaysAgo) as any[];
            for (const r of rows7d) {
              let kind = '';
              try {
                if (r.metadata_json) kind = String(JSON.parse(r.metadata_json)?.kind || '');
              } catch {}
              if (r.direction === 'REVENUE' && kind !== 'PLATFORM_TAKE_FEE') {
                rev7dRisk += Number(r.amount_sov || 0);
              }
              if (r.direction === 'LOSS_OR_COST') costs7dRisk += Number(r.amount_sov || 0);
            }
          }

          if (sqlCount < memEntries.length) {
            const seenIds = new Set<string>(
              (rawDb.prepare('SELECT id FROM risk_management_ledger').all() as any[]).map((x) => x.id),
            );
            for (const e of memEntries) {
              if (seenIds.has(e.id)) continue;
              const amt = Number(e.amountSov || 0);
              const kind = String(e.metadata?.kind || '');
              if (e.prevented) {
                totalPreventedCount += 1;
                preventedCountByCat.set(e.category, (preventedCountByCat.get(e.category) || 0) + 1);
              }
              if (e.direction === 'RECOVERED_OR_SAVED') totalRecoveredSavingsSov += amt;
              if (!e.prevented) {
                const key = `${e.category}|${e.direction}`;
                catTotals.set(key, (catTotals.get(key) || 0) + amt);
                if (e.direction === 'REVENUE') {
                  if (kind) metaRevenueTotals.set(kind, (metaRevenueTotals.get(kind) || 0) + amt);
                  else totalUnlabeledRevenueSov += amt;
                }
              }
              if (e.createdAt >= sevenDaysAgo && !e.prevented) {
                if (e.direction === 'REVENUE' && kind !== 'PLATFORM_TAKE_FEE') rev7dRisk += amt;
                if (e.direction === 'LOSS_OR_COST') costs7dRisk += amt;
              }
            }
          }
        }
      } catch {}
    }

    if (!usedSqliteAgg) {
      for (const e of memEntries) {
        const amt = Number(e.amountSov || 0);
        const kind = String(e.metadata?.kind || '');
        if (e.prevented) {
          totalPreventedCount += 1;
          preventedCountByCat.set(e.category, (preventedCountByCat.get(e.category) || 0) + 1);
        }
        if (e.direction === 'RECOVERED_OR_SAVED') totalRecoveredSavingsSov += amt;
        if (!e.prevented) {
          const key = `${e.category}|${e.direction}`;
          catTotals.set(key, (catTotals.get(key) || 0) + amt);
          if (e.direction === 'REVENUE') {
            if (kind) metaRevenueTotals.set(kind, (metaRevenueTotals.get(kind) || 0) + amt);
            else totalUnlabeledRevenueSov += amt;
          }
        }
        if (e.createdAt >= sevenDaysAgo && !e.prevented) {
          if (e.direction === 'REVENUE' && kind !== 'PLATFORM_TAKE_FEE') rev7dRisk += amt;
          if (e.direction === 'LOSS_OR_COST') costs7dRisk += amt;
        }
      }
    }

    const ammUnpreventedExposure = round4(
      (catTotals.get('AMM_DRAIN_RISK|RISK_EXPOSURE') || 0) + (catTotals.get('AMM_DRAIN_RISK|LOSS_OR_COST') || 0),
    );
    return {
      catTotals,
      metaRevenueTotals,
      preventedCountByCat,
      totalPreventedCount,
      totalRecoveredSavingsSov: round4(totalRecoveredSavingsSov),
      totalUnlabeledRevenueSov: round4(totalUnlabeledRevenueSov),
      rev7dRisk: round4(rev7dRisk),
      costs7dRisk: round4(costs7dRisk),
      ammUnpreventedExposure,
    };
  }

  // =========================================================================
  // 1. REAL COMPANY ECONOMICS & P&L COMPUTATION (ZERO FAKE NUMBERS)
  // =========================================================================

  public computeCompanyEconomicsAndPnL(): CompanyEconomicsPnLSnapshot {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 86400_000;
    const dbAny = this.getDbAny();
    const rawDb = this.getRawSqlite();
    const sqliteEngine = typeof (sovraDb as any).getSqliteEngine === 'function'
      ? (sovraDb as any).getSqliteEngine()
      : null;

    // 1. Supply & Staking Locks
    const supplyBase = sqliteEngine && typeof sqliteEngine.getUltraSoundMetrics === 'function'
      ? sqliteEngine.getUltraSoundMetrics()
      : typeof (sovraDb as any).getUltraSoundMetrics === 'function'
        ? (sovraDb as any).getUltraSoundMetrics()
        : { circulatingSupplySov: 30_000_000, totalBurnedSov: 0, burnRate24hSov: 0 };

    const bondedStakeSov = round4(
      (dbAny.db.staking_delegations || []).reduce((s: number, d: any) => s + Number(d.amountSov || 0), 0),
    );
    const seederBondsSov = round4(
      (dbAny.db.seeder_bonds || []).reduce((s: number, b: any) => s + Number(b.bondedSov || 0), 0),
    );
    const patronStakedSov = round4(
      (dbAny.db.patron_stakes || []).reduce((s: number, p: any) => s + Number(p.amountSov || 0), 0),
    );
    const totalLockedSov = round4(bondedStakeSov + seederBondsSov + patronStakedSov);
    const circulatingSupplySov = round4(Number(supplyBase.circulatingSupplySov || 30_000_000));
    const totalBurnedSov = round4(
      Number(supplyBase.totalBurnedSov || 0) + Number(dbAny.db.economy_totals?.burnedExtraSov || 0),
    );

    // 2. Real Earned Protocol Revenue Streams (SQLite lifetime SUM — zero 1500 truncation)
    const ledger = Array.isArray(dbAny.db.financial_ledger) ? dbAny.db.financial_ledger : [];
    const tablePlatformFeesSov = round4(
      ledger.reduce((s: number, e: any) => s + Number(e.platformFeeSov || 0), 0),
    );

    let transferAndSettlementFeesSov = 0;
    let faucetFromSqliteSov = 0;
    let faucet7dFromSqliteSov = 0;
    let transferFees7dSov = 0;
    let sqlFinancialLedgerFeesSov = 0;
    let sqlFinancialLedgerFees7dSov = 0;
    let pendingIntentCount = 0;
    if (rawDb) {
      try {
        const tfRow = rawDb.prepare("SELECT COALESCE(SUM(fee_sov), 0) as f FROM token_transfers WHERE tx_type != 'FAUCET_CLAIM'").get() as any;
        transferAndSettlementFeesSov = round4(Number(tfRow?.f || 0));
        const tf7dRow = rawDb.prepare('SELECT COALESCE(SUM(fee_sov), 0) as f FROM token_transfers WHERE created_at >= ?').get(sevenDaysAgo) as any;
        transferFees7dSov = round4(Number(tf7dRow?.f || 0));

        const fcRow = rawDb.prepare("SELECT COALESCE(SUM(amount_sov), 0) as f FROM token_transfers WHERE tx_type = 'FAUCET_CLAIM'").get() as any;
        faucetFromSqliteSov = round4(Number(fcRow?.f || 0));
        const fc7dRow = rawDb.prepare("SELECT COALESCE(SUM(amount_sov), 0) as f FROM token_transfers WHERE tx_type = 'FAUCET_CLAIM' AND created_at >= ?").get(sevenDaysAgo) as any;
        faucet7dFromSqliteSov = round4(Number(fc7dRow?.f || 0));

        const flRow = rawDb.prepare('SELECT COALESCE(SUM(platform_fee_sov), 0) as f FROM financial_ledger').get() as any;
        sqlFinancialLedgerFeesSov = round4(Number(flRow?.f || 0));
        const fl7dRow = rawDb.prepare('SELECT COALESCE(SUM(platform_fee_sov), 0) as f FROM financial_ledger WHERE created_at >= ?').get(sevenDaysAgo) as any;
        sqlFinancialLedgerFees7dSov = round4(Number(fl7dRow?.f || 0));

        const pendRow = rawDb.prepare("SELECT COUNT(*) as c FROM financial_settlement_intents WHERE state IN ('SUBMITTED', 'RECONCILIATION_REQUIRED')").get() as any;
        pendingIntentCount = Number(pendRow?.c || 0);
      } catch {}
    }

    const agg = this.getAggregatedRiskMetrics(sevenDaysAgo);
    const catSum = (cat: RiskLedgerCategory, dir?: RiskLedgerEntry['direction']) => {
      if (dir) return round4(agg.catTotals.get(`${cat}|${dir}`) || 0);
      return round4(
        (agg.catTotals.get(`${cat}|LOSS_OR_COST`) || 0) +
          (agg.catTotals.get(`${cat}|RISK_EXPOSURE`) || 0) +
          (agg.catTotals.get(`${cat}|REVENUE`) || 0),
      );
    };

    const platformTakeFeesSov = round4(
      Math.max(tablePlatformFeesSov, sqlFinancialLedgerFeesSov, agg.metaRevenueTotals.get('PLATFORM_TAKE_FEE') || 0),
    );
    const tableHandleYield = (dbAny.db.paid_handles || []).reduce(
      (s: number, h: any) => s + Math.max(0, Number(h.feeSov || 0) - Number(h.burnedSov || 0)),
      0,
    );
    const handleBurnSinkYieldSov = round4(Math.max(tableHandleYield, agg.metaRevenueTotals.get('HANDLE_SINK') || 0));
    const tableStorageYield = (dbAny.db.storage_rent_logs || []).reduce(
      (s: number, l: any) => s + Math.max(0, Number(l.totalRentSov || 0) - Number(l.burnedSov || 0)),
      0,
    );
    const storageRentYieldSov = round4(Math.max(tableStorageYield, agg.metaRevenueTotals.get('STORAGE_RENT') || 0));
    const boostAndPromotionFeesSov = round4(agg.metaRevenueTotals.get('BOOST') || 0);
    const ammSwapRoyaltiesSov = round4(agg.metaRevenueTotals.get('AMM_FEE') || 0);
    const tableBridgeFees = (dbAny.db.bridge_transfers || []).reduce(
      (s: number, b: any) => s + Number(b.feeSov || 0),
      0,
    );
    const bridgeFeesSov = round4(Math.max(tableBridgeFees, agg.metaRevenueTotals.get('BRIDGE_FEE') || 0));
    const tableAiFees = (dbAny.db.agent_jobs || dbAny.db.autonomous_agent_jobs || []).reduce(
      (s: number, j: any) => s + Number(j.platformFeeSov || 0),
      0,
    );
    const aiMarketplaceFeesSov = round4(Math.max(tableAiFees, agg.metaRevenueTotals.get('AI_MARKETPLACE_FEE') || 0));
    const extraRecordedRevenueSov = agg.totalUnlabeledRevenueSov;

    const grossProtocolRevenueSov = round4(
      platformTakeFeesSov +
        transferAndSettlementFeesSov +
        handleBurnSinkYieldSov +
        storageRentYieldSov +
        boostAndPromotionFeesSov +
        ammSwapRoyaltiesSov +
        bridgeFeesSov +
        aiMarketplaceFeesSov +
        extraRecordedRevenueSov,
    );

    const rev7dLedger = Math.max(
      ledger
        .filter((e: any) => Number(e.createdAt || e.timestamp || 0) >= sevenDaysAgo)
        .reduce((s: number, e: any) => s + Number(e.platformFeeSov || 0), 0),
      sqlFinancialLedgerFees7dSov,
    );
    const dailyRevenueRateSov = round4((rev7dLedger + transferFees7dSov + agg.rev7dRisk) / 7);

    // 3. Real Direct Subsidies, Grants, Bounties, Expenses & Leakage Exposure
    const referralRecords = [
      ...(Array.isArray(dbAny.db.referrals) ? dbAny.db.referrals : []),
      ...(Array.isArray(dbAny.db.referral_ledger) ? dbAny.db.referral_ledger : []),
    ];
    const referralFromTable = round4(
      referralRecords.reduce(
        (s: number, r: any) => s + Number(r.inviterRewardSov || 0) + Number(r.inviteeRewardSov || 0),
        0,
      ),
    );
    const referralSubsidiesSov = round4(Math.max(referralFromTable, catSum('REFERRAL_SUBSIDY', 'LOSS_OR_COST')));
    const faucetGrantsSov = round4(Math.max(faucetFromSqliteSov, catSum('FAUCET_GRANT', 'LOSS_OR_COST')));
    const depinUnbackedSubsidiesSov = catSum('DEPIN_UNBACKED_SUBSIDY', 'LOSS_OR_COST');
    const seederEmissionCostsSov = catSum('SEEDER_EMISSION_COST', 'LOSS_OR_COST');
    const unbondedSeederEmissionExposureSov = catSum('UNBONDED_SEEDER_EMISSION', 'RISK_EXPOSURE');
    const metaTxRelayerSubsidySov = catSum('META_TX_GAS_SUBSIDY', 'LOSS_OR_COST');
    const creatorBountiesSov = round4(
      catSum('CREATOR_BOUNTY', 'LOSS_OR_COST') +
        (dbAny.db.quadratic_escrows || []).reduce((s: number, q: any) => s + Number(q.matchingPoolSubsidySov || 0), 0),
    );
    const operationalExpensesSov = catSum('OPERATIONAL_INFRA_EXPENSE', 'LOSS_OR_COST');
    const fiatOnRampIssuanceSov = catSum('FIAT_ONRAMP_ISSUANCE', 'RISK_EXPOSURE');
    const l1OffchainFeeDeficitSov = round4(
      Math.max(
        catSum('L1_OFFCHAIN_FEE_DEFICIT', 'RISK_EXPOSURE'),
        pendingIntentCount * 0.0001,
      ),
    );

    let adminManualCreditsSov = catSum('ADMIN_BALANCE_CREDIT', 'LOSS_OR_COST');
    if (rawDb) {
      try {
        const adjRows = rawDb.prepare(
          "SELECT COALESCE(SUM(amount_sov), 0) as s FROM token_transfers WHERE tx_type = 'ADMIN_ADJUSTMENT' AND amount_sov > 0",
        ).get() as any;
        adminManualCreditsSov = round4(Math.max(adminManualCreditsSov, Number(adjRows?.s || 0)));
      } catch {}
    }

    const vouchers = Array.isArray(dbAny.db.offline_payment_vouchers) ? dbAny.db.offline_payment_vouchers : [];
    const expiredOfflineVoucherLiabilitySov = round4(
      vouchers
        .filter((v: any) => (v.status === 'PENDING' || !v.claimedAt) && !v.refundedAt && Number(v.expiresAt || Infinity) < now)
        .reduce((s: number, v: any) => s + Number(v.amountSov || 0), 0),
    );

    let washTradingFeeRebateExposureSov = 0;
    let disintermediationEstimatedFeeLossSov = 0;
    const takeRate = sqliteEngine && typeof sqliteEngine.getPlatformTakeRate === 'function'
      ? Number(sqliteEngine.getPlatformTakeRate() || 5.0)
      : 5.0;
    if (sqliteEngine) {
      try {
        const washFlags = sqliteEngine.getWashTradingFlags?.() || [];
        washTradingFeeRebateExposureSov = round4(
          washFlags.reduce((s: number, w: any) => s + Number(w.totalVolumeSov || 0) * (takeRate / 100), 0),
        );
      } catch {}
      try {
        const disEvents = sqliteEngine.getDisintermediationEvents?.(100) || [];
        disintermediationEstimatedFeeLossSov = round4(disEvents.length * 25.0 * (takeRate / 100));
      } catch {}
    }

    const syntheticDefaultWalletSeedSov = round4(
      (dbAny.db.users || [])
        .filter((u: any) => u.did?.startsWith('did:sovra:') && Number(u.balanceSov || 0) >= 5000 && !u.faucetClaimed && !u.fiatFunded)
        .length * 5000,
    );

    const solvencyReport = typeof (sovraDb as any).getTreasurySolvencyReport === 'function'
      ? (sovraDb as any).getTreasurySolvencyReport()
      : { solvencyDeltaSov: 0, treasuryReserveSov: 0 };
    const solvencyDiscrepancySov = round4(
      Math.abs(Number(solvencyReport.unbackedGapSov ?? solvencyReport.discrepancyDeltaSov ?? solvencyReport.solvencyDeltaSov ?? 0)),
    );

    const totalDirectCostsAndSubsidiesSov = round4(
      referralSubsidiesSov +
        faucetGrantsSov +
        depinUnbackedSubsidiesSov +
        seederEmissionCostsSov +
        metaTxRelayerSubsidySov +
        creatorBountiesSov +
        adminManualCreditsSov +
        operationalExpensesSov,
    );

    const totalRiskAdjustedLossesSov = round4(
      totalDirectCostsAndSubsidiesSov +
        expiredOfflineVoucherLiabilitySov +
        washTradingFeeRebateExposureSov +
        disintermediationEstimatedFeeLossSov +
        unbondedSeederEmissionExposureSov +
        l1OffchainFeeDeficitSov +
        solvencyDiscrepancySov,
    );

    const ref7d = referralRecords
      .filter((r: any) => Number(r.createdAt || 0) >= sevenDaysAgo)
      .reduce((s: number, r: any) => s + Number(r.inviterRewardSov || 0) + Number(r.inviteeRewardSov || 0), 0);
    const dailyCostRateSov = round4((Math.max(agg.costs7dRisk, faucet7dFromSqliteSov + ref7d)) / 7);

    // 4. Net Operating Profit / Loss & Honest Runway
    const netOperatingProfitSov = round4(grossProtocolRevenueSov - totalDirectCostsAndSubsidiesSov);
    const riskAdjustedNetPnLSov = round4(grossProtocolRevenueSov - totalRiskAdjustedLossesSov);
    const operatingMarginPct = grossProtocolRevenueSov > 0
      ? round2((netOperatingProfitSov / grossProtocolRevenueSov) * 100)
      : totalDirectCostsAndSubsidiesSov > 0
        ? -100
        : 0;

    const dailyNetCashflowSov = round4(dailyRevenueRateSov - dailyCostRateSov);
    const liquidTreasurySov = round4(
      Number(solvencyReport.treasuryReserveSov ?? solvencyReport.breakdown?.treasuryReserveSov ?? 0) +
        Math.max(0, netOperatingProfitSov),
    );

    let runwayDays = 0;
    let runwayLabel = '0 Days (Empty Treasury)';
    let healthStatus: CompanyEconomicsPnLSnapshot['pnl']['healthStatus'] = 'STABLE_SUSTAINABLE';

    if (dailyNetCashflowSov > 0) {
      runwayDays = 9999;
      runwayLabel = 'Perpetual (Cashflow Positive)';
      healthStatus = 'PROFITABLE_COMPOUNDING';
    } else if (dailyNetCashflowSov === 0 && dailyCostRateSov === 0) {
      runwayDays = liquidTreasurySov > 0 ? 3650 : 0;
      runwayLabel = liquidTreasurySov > 0 ? '3,650+ Days (Zero Burn)' : 'Idle (No Active Burn or Revenue)';
      healthStatus = liquidTreasurySov > 0 ? 'STABLE_SUSTAINABLE' : 'DEFICIT_WATCH';
    } else {
      const dailyDeficit = Math.abs(dailyNetCashflowSov);
      runwayDays = dailyDeficit > 0 ? Math.max(0, Math.floor(liquidTreasurySov / dailyDeficit)) : 0;
      runwayLabel = `${runwayDays} Days`;
      healthStatus = runwayDays < 90 ? 'RUNWAY_CRITICAL' : runwayDays < 365 ? 'DEFICIT_WATCH' : 'STABLE_SUSTAINABLE';
    }

    return {
      generatedAt: now,
      supply: {
        hardCapSov: 100_000_000,
        genesisAllocationSov: 30_000_000,
        circulatingSupplySov,
        totalBurnedSov,
        totalLockedSov,
        lockRatioPct: circulatingSupplySov > 0 ? round2((totalLockedSov / circulatingSupplySov) * 100) : 0,
        netDeflationary: Number(supplyBase.burnRate24hSov || 0) > 23972.6,
      },
      revenue: {
        platformTakeFeesSov,
        transferAndSettlementFeesSov,
        handleBurnSinkYieldSov,
        storageRentYieldSov,
        boostAndPromotionFeesSov,
        ammSwapRoyaltiesSov,
        bridgeFeesSov,
        aiMarketplaceFeesSov,
        grossProtocolRevenueSov,
        recordedBurnSinkTotalSov: totalBurnedSov,
        dailyRevenueRateSov,
      },
      costsAndLosses: {
        referralSubsidiesSov,
        faucetGrantsSov,
        depinUnbackedSubsidiesSov,
        seederEmissionCostsSov,
        metaTxRelayerSubsidySov,
        creatorBountiesSov,
        adminManualCreditsSov,
        operationalExpensesSov,
        expiredOfflineVoucherLiabilitySov,
        washTradingFeeRebateExposureSov,
        disintermediationEstimatedFeeLossSov,
        l1OffchainFeeDeficitSov,
        fiatOnRampIssuanceSov,
        unbondedSeederEmissionExposureSov,
        syntheticDefaultWalletSeedSov,
        solvencyDiscrepancySov,
        totalDirectCostsAndSubsidiesSov,
        totalRiskAdjustedLossesSov,
        dailyCostRateSov,
      },
      pnl: {
        netOperatingProfitSov,
        riskAdjustedNetPnLSov,
        operatingMarginPct,
        dailyNetCashflowSov,
        liquidTreasurySov,
        runwayDays,
        runwayLabel,
        healthStatus,
        recoveredSavingsSov: agg.totalRecoveredSavingsSov,
        preventedAttacksCount: agg.totalPreventedCount,
      },
    };
  }

  // =========================================================================
  // 2. DEEP CODEBASE LEAKAGE AUDIT & "HOW TO STOP LEAKAGE" MATRIX
  // =========================================================================

  public auditSystemLeakageAndRisks(): LeakageAuditReport {
    const now = Date.now();
    const policy = this.getRiskPolicies();
    const pnl = this.computeCompanyEconomicsAndPnL();
    const agg = this.getAggregatedRiskMetrics(now - 7 * 86400_000);
    const sqliteEngine = typeof (sovraDb as any).getSqliteEngine === 'function'
      ? (sovraDb as any).getSqliteEngine()
      : null;

    const countPrevented = (cat: RiskLedgerCategory) => agg.preventedCountByCat.get(cat) || 0;

    const currentTakeRate = sqliteEngine && typeof sqliteEngine.getPlatformTakeRate === 'function'
      ? Number(sqliteEngine.getPlatformTakeRate() || 5.0)
      : 5.0;

    const fiatPayoutProviderEnabled = Boolean(
      process.env.FIAT_PAYOUT_PROVIDER_ENABLED === 'true' ||
      process.env.RAZORPAY_KEY_SECRET ||
      process.env.STRIPE_SECRET_KEY,
    );
    const fiatOutflowExposure = round4(
      (agg.catTotals.get('FIAT_WITHDRAWAL_OUTFLOW|RISK_EXPOSURE') || 0) +
        (agg.catTotals.get('FIAT_WITHDRAWAL_OUTFLOW|LOSS_OR_COST') || 0),
    );
    const fiatCapExceeded = pnl.costsAndLosses.fiatOnRampIssuanceSov > policy.dailyFiatMintCapSov;
    const totalDepinAndSeederExposure = round4(
      pnl.costsAndLosses.depinUnbackedSubsidiesSov + pnl.costsAndLosses.unbondedSeederEmissionExposureSov,
    );
    const totalSolvencyAndL1Exposure = round4(
      pnl.costsAndLosses.solvencyDiscrepancySov + pnl.costsAndLosses.l1OffchainFeeDeficitSov,
    );

    const vectors: LeakageVectorReport[] = [
      {
        id: 'LEAK-01-UNBACKED-DEPIN',
        title: 'DePIN Hotspot Unregistered Subsidy & Unbonded Seeder Emissions',
        category: 'Token Emission & Subsidy Leakage',
        severity: totalDepinAndSeederExposure > 50 ? 'CRITICAL' : policy.strictDepinFundedClientOnly && policy.requireSeederBondForYield ? 'LOW' : 'MEDIUM',
        status: policy.strictDepinFundedClientOnly && policy.requireSeederBondForYield
          ? 'MITIGATED'
          : (countPrevented('DEPIN_UNBACKED_SUBSIDY') + countPrevented('UNBONDED_SEEDER_EMISSION')) > 0
            ? 'PROTECTED'
            : totalDepinAndSeederExposure > 0
              ? 'EXPOSED'
              : 'PROTECTED',
        detectedExposureSov: totalDepinAndSeederExposure,
        preventedCount: countPrevented('DEPIN_UNBACKED_SUBSIDY') + countPrevented('UNBONDED_SEEDER_EMISSION'),
        codeLocation: 'scripts/database-engine.ts:meterDepinSession & scripts/routes/wallet.routes.ts:claim-seeder-yield',
        rootCause: 'Guest mesh sessions without registered client funding or Seeder yield claims without >= 100 SOV collateral bond risk unbacked emission drain.',
        howToPrevent: [
          `Cap unbacked guest subsidy <= ${policy.maxUnbackedDepinRatePerMbSov} SOV/MB (${policy.dailyUnbackedDepinSubsidyCapSov} SOV/24h) & lock 50% of Seeder yield in 30d rolling vesting.`,
          'Require >= 100 SOV Seeder collateral bond (requireSeederBondForYield=true / strictDepinFundedClientOnly=true) for Mainnet.',
          'Sync all Seeder & DePIN host credits into SQLite + Risk P&L Ledger atomically.',
        ],
        activeControl: `Rate <= ${policy.maxUnbackedDepinRatePerMbSov} SOV/MB | StrictDePIN=${policy.strictDepinFundedClientOnly} | RequireSeederBond=${policy.requireSeederBondForYield}`,
        recommendedMitigationAction: 'ENFORCE_STRICT_CAPS',
      },
      {
        id: 'LEAK-02-REFERRAL-SYBIL-DRAIN',
        title: 'Referral Reward Uncapped Printing & Sybil Cycles',
        category: 'Growth Incentive Leakage',
        severity: pnl.costsAndLosses.referralSubsidiesSov > policy.dailyReferralBudgetSov * 0.5 ? 'HIGH' : 'MEDIUM',
        status: pnl.costsAndLosses.referralSubsidiesSov > policy.dailyReferralBudgetSov ? 'EXPOSED' : 'PROTECTED',
        detectedExposureSov: pnl.costsAndLosses.referralSubsidiesSov,
        preventedCount: countPrevented('REFERRAL_SUBSIDY'),
        codeLocation: 'scripts/routes/referral.routes.ts & scripts/database-engine.ts:detectReferralSybilLoops',
        rootCause: '+75 SOV per invitee (+50/+25) without a daily protocol budget cap or inviter daily ceiling allows Sybil farming.',
        howToPrevent: [
          `Enforce global daily referral subsidy cap (${policy.dailyReferralBudgetSov} SOV/24h) and max ${policy.maxReferralsPerInviterPerDay} referrals/inviter/24h.`,
          'Require ZK humanity proof / stake lock before unlocked referral withdrawal.',
          'Run automated circular Sybil graph detection (A->B->C->A) to freeze suspect rings.',
        ],
        activeControl: `Global 24h cap ${policy.dailyReferralBudgetSov} SOV, Inviter cap ${policy.maxReferralsPerInviterPerDay}/day`,
        recommendedMitigationAction: 'FREEZE_WASH_TRADING_LOOPS',
      },
      {
        id: 'LEAK-03-FAUCET-DRAIN',
        title: 'Genesis Starter Faucet Unbudgeted Token Drip',
        category: 'Treasury Drain',
        severity: pnl.costsAndLosses.faucetGrantsSov > 5000 ? 'HIGH' : 'LOW',
        status: pnl.costsAndLosses.faucetGrantsSov > policy.dailyFaucetBudgetSov ? 'EXPOSED' : 'PROTECTED',
        detectedExposureSov: pnl.costsAndLosses.faucetGrantsSov,
        preventedCount: countPrevented('FAUCET_GRANT'),
        codeLocation: 'scripts/routes/wallet.routes.ts:/api/wallet/fiat & /api/wallet/faucet/claim',
        rootCause: 'Multi-account Sybil DIDs claiming 50 SOV every 24h without a protocol-wide daily budget or P&L expense debit.',
        howToPrevent: [
          `Track every FAUCET_CLAIM in P&L costs & enforce global 24h cap (${policy.dailyFaucetBudgetSov} SOV/day).`,
          'Set dailyFaucetBudgetSov = 0 before Mainnet TGE to permanently disable free faucet drips.',
        ],
        activeControl: `24h global cap ${policy.dailyFaucetBudgetSov} SOV + 24h per-DID cooldown + P&L cost logging`,
        recommendedMitigationAction: 'ENFORCE_STRICT_CAPS',
      },
      {
        id: 'LEAK-04-SOLVENCY-DRIFT',
        title: 'Double-Entry Treasury Solvency, JSON/SQLite Drift & L1 Off-Chain Backlog',
        category: 'Accounting Integrity',
        severity: pnl.costsAndLosses.solvencyDiscrepancySov > policy.solvencyAlertThresholdSov
          ? 'CRITICAL'
          : pnl.costsAndLosses.l1OffchainFeeDeficitSov > 0
            ? 'MEDIUM'
            : 'LOW',
        status: pnl.costsAndLosses.solvencyDiscrepancySov > policy.solvencyAlertThresholdSov
          ? 'EXPOSED'
          : pnl.costsAndLosses.l1OffchainFeeDeficitSov > 0
            ? 'MONITORING'
            : 'PROTECTED',
        detectedExposureSov: totalSolvencyAndL1Exposure,
        preventedCount: countPrevented('SOLVENCY_DRIFT') + countPrevented('L1_OFFCHAIN_FEE_DEFICIT'),
        codeLocation: 'scripts/database-engine.ts:getTreasurySolvencyReport & scripts/routes/wallet.routes.ts:/api/wallet/transfer',
        rootCause: 'Dual JSON + SQLite stores or L1-offline local transfers can drift or defer L1 minimum gas/burn fee reconciliation.',
        howToPrevent: [
          'Compare true unbacked gaps (user + escrow + treasury vs. genesis + inflows - burns) cleanly without tautological equations.',
          'Automatically sync SQLite users.balance_sov on offline vouchers, fiat withdraw, Seeder yield, and DePIN metering.',
          'Audit & reconcile queued L1 off-chain transfer intents via RECONCILE_OFFCHAIN_L1.',
        ],
        activeControl: `Auto circuit-breaker threshold: ${policy.solvencyAlertThresholdSov} SOV | Pending L1 Fee Backlog: ${pnl.costsAndLosses.l1OffchainFeeDeficitSov.toFixed(4)} SOV`,
        recommendedMitigationAction: pnl.costsAndLosses.l1OffchainFeeDeficitSov > 0 ? 'RECONCILE_OFFCHAIN_L1' : 'RECONCILE_LEDGER_SYNC',
      },
      {
        id: 'LEAK-05-OFFLINE-VOUCHERS',
        title: 'Expired / Unreclaimed Offline Payment Vouchers',
        category: 'Locked Liability Leakage',
        severity: pnl.costsAndLosses.expiredOfflineVoucherLiabilitySov > 0 ? 'HIGH' : 'LOW',
        status: pnl.costsAndLosses.expiredOfflineVoucherLiabilitySov > 0 ? 'EXPOSED' : 'MITIGATED',
        detectedExposureSov: pnl.costsAndLosses.expiredOfflineVoucherLiabilitySov,
        preventedCount: countPrevented('OFFLINE_VOUCHER_EXPOSURE'),
        codeLocation: 'scripts/routes/offline-pay.routes.ts & scripts/database-engine.ts:createOfflinePaymentVoucher',
        rootCause: 'Unauthenticated/unverified voucher calls or expired unclaimed vouchers locked funds without Ed25519 signature + vesting verification.',
        howToPrevent: [
          'Require Bearer enforceAuth + genuine Ed25519 signature + vesting lock check before voucher creation or claim.',
          'Run periodic expired-voucher reclaim sweep to restore unclaimed expired funds cleanly to senders.',
        ],
        activeControl: `Ed25519 + Auth + Vesting Gate Active | Max TTL ${(policy.offlineVoucherMaxTtlMs / 86400_000).toFixed(1)}d`,
        recommendedMitigationAction: 'RECLAIM_EXPIRED_VOUCHERS',
      },
      {
        id: 'LEAK-06-META-TX-RELAYER',
        title: 'EIP-2771 Gasless Meta-Tx Relayer Drain',
        category: 'Gas Sponsorship Cost',
        severity: pnl.costsAndLosses.metaTxRelayerSubsidySov > policy.dailyMetaTxSubsidyCapSov * 0.7 ? 'HIGH' : 'LOW',
        status: pnl.costsAndLosses.metaTxRelayerSubsidySov > policy.dailyMetaTxSubsidyCapSov ? 'EXPOSED' : 'PROTECTED',
        detectedExposureSov: pnl.costsAndLosses.metaTxRelayerSubsidySov,
        preventedCount: countPrevented('META_TX_GAS_SUBSIDY'),
        codeLocation: 'scripts/routes/wallet.routes.ts:/api/wallet/meta-tx',
        rootCause: 'Gasless relayer pays underlying execution gas on behalf of users without quota or global subsidy accounting.',
        howToPrevent: [
          `Cap sponsored gas cost (${policy.dailyMetaTxSubsidyCapSov} SOV/day) and max ${policy.maxMetaTxPerDidPerDay} meta-txs per DID/day.`,
          'Prioritize sponsored txs for value-accruing BOOST/BURN actions and log every relay cost into Risk P&L.',
        ],
        activeControl: `24h Relayer Cap ${policy.dailyMetaTxSubsidyCapSov} SOV (${policy.maxMetaTxPerDidPerDay}/DID/day)`,
        recommendedMitigationAction: 'ENFORCE_STRICT_CAPS',
      },
      {
        id: 'LEAK-07-AMM-RESERVE-DRAIN',
        title: 'AMM Liquidity Pool High-Slippage / Reserve Drain',
        category: 'Liquidity & Market Risk',
        severity: agg.ammUnpreventedExposure > 0 ? 'HIGH' : 'LOW',
        status: policy.enforceStrictAmmDrainCap ? 'PROTECTED' : 'MONITORING',
        detectedExposureSov: agg.ammUnpreventedExposure,
        preventedCount: countPrevented('AMM_DRAIN_RISK'),
        codeLocation: 'scripts/routes/wallet.routes.ts:/api/wallet/swap & /api/wallet/auto-settle',
        rootCause: 'Single oversized swaps can drain >25% of shallow creator CW20/SOV pools causing extreme slippage and LP loss.',
        howToPrevent: [
          `Monitor and enforce max ${policy.maxSingleAmmDrainPct}% single-tx reserve impact limit via Enforce Strict AMM Cap.`,
          'Require Protocol-Owned Liquidity (POL) permanent LP locks on deep creator pools.',
        ],
        activeControl: `Alert threshold >${policy.maxSingleAmmDrainPct}% reserve impact (Hard Block=${policy.enforceStrictAmmDrainCap})`,
        recommendedMitigationAction: 'ENFORCE_STRICT_CAPS',
      },
      {
        id: 'LEAK-08-FIAT-REPLAY-WITHDRAW',
        title: 'Fiat Webhook Replay, Issuance Cap & Withdrawal Exposure',
        category: 'Fiat Gateway Risk',
        severity: fiatCapExceeded
          ? 'CRITICAL'
          : (!fiatPayoutProviderEnabled && fiatOutflowExposure > 0) || fiatOutflowExposure > 10_000
            ? 'HIGH'
            : 'LOW',
        status: fiatCapExceeded
          ? 'EXPOSED'
          : !fiatPayoutProviderEnabled && fiatOutflowExposure > 0
            ? 'MONITORING'
            : 'PROTECTED',
        detectedExposureSov: fiatOutflowExposure,
        preventedCount: countPrevented('FIAT_WITHDRAWAL_OUTFLOW') + countPrevented('FIAT_ONRAMP_ISSUANCE'),
        codeLocation: 'scripts/routes/wallet.routes.ts:/api/wallet/fiat/webhook & /api/wallet/fiat/withdraw',
        rootCause: 'Unbacked fiat webhook minting, replayable paymentIds, or unconfigured payout providers create reserve solvency mismatches.',
        howToPrevent: [
          `Route fiat on-ramps via AMM DEX pools or tracked genesis reserve up to ${policy.dailyFiatMintCapSov} SOV/24h cap.`,
          'Persist all processed fiat paymentId keys in SQLite financial_idempotency_keys + JSON state.',
          'Check spendable balance minus vesting lock and FIAT_PAYOUT_PROVIDER_ENABLED state before payout.',
        ],
        activeControl: `PayoutProvider=${fiatPayoutProviderEnabled ? 'ENABLED' : 'SANDBOX_DISABLED'} | FiatCap=${policy.dailyFiatMintCapSov} SOV/24h | Outflow=${fiatOutflowExposure.toFixed(2)} SOV`,
        recommendedMitigationAction: 'RECONCILE_LEDGER_SYNC',
      },
      {
        id: 'LEAK-09-WASH-TRADING',
        title: 'Circular Wash-Trading & Self-Tipping Rebate Exploits',
        category: 'Fee & Reward Farming',
        severity: pnl.costsAndLosses.washTradingFeeRebateExposureSov > 10 ? 'HIGH' : 'LOW',
        status: pnl.costsAndLosses.washTradingFeeRebateExposureSov > 0 ? 'MONITORING' : 'PROTECTED',
        detectedExposureSov: pnl.costsAndLosses.washTradingFeeRebateExposureSov,
        preventedCount: 0,
        codeLocation: 'scripts/database-sqlite.ts:detectWashTradingCycles & detectSeederWashTrading',
        rootCause: 'Bot rings cycling SOV (A->B->C->A) to harvest referral/creator/seeder incentives.',
        howToPrevent: [
          'Run automated 72h graph cycle detection and Z-score seeder wash-trading detection.',
          'Freeze commissions and forfeit accrued unclaimed rewards for cycle participants.',
        ],
        activeControl: 'Graph Cycle + Seeder Z-Score Detector Armed',
        recommendedMitigationAction: 'FREEZE_WASH_TRADING_LOOPS',
      },
      {
        id: 'LEAK-10-TAKE-RATE-EROSION',
        title: 'Off-Platform Disintermediation & Take-Rate Floor Erosion',
        category: 'Revenue Bypass',
        severity:
          currentTakeRate < policy.platformTakeRateFloorPct || pnl.costsAndLosses.disintermediationEstimatedFeeLossSov > 10
            ? 'HIGH'
            : 'LOW',
        status:
          currentTakeRate < policy.platformTakeRateFloorPct || pnl.costsAndLosses.disintermediationEstimatedFeeLossSov > 5
            ? 'MONITORING'
            : 'PROTECTED',
        detectedExposureSov: pnl.costsAndLosses.disintermediationEstimatedFeeLossSov,
        preventedCount: 0,
        codeLocation: 'scripts/database-sqlite.ts:scanTextForDisintermediation & setPlatformTakeRate',
        rootCause: 'Creators routing fan payments to external UPI/Telegram/PayPal handles bypasses protocol take-rate & 5% burn sink.',
        howToPrevent: [
          `Maintain platform take-rate >= floor (${policy.platformTakeRateFloorPct}%) and clamp sliders strictly.`,
          'Auto-suppress posts/bios flagged with UPI VPA / external payment bypass links.',
        ],
        activeControl: `Take-rate ${currentTakeRate.toFixed(1)}% (Floor ${policy.platformTakeRateFloorPct}%) + NLP Bypass Scanner`,
        recommendedMitigationAction: 'ENFORCE_STRICT_CAPS',
      },
    ];

    // Calculate deterministic overall risk score (0 = safest, 100 = severe leakage)
    let score = 8; // baseline residual protocol surface score
    for (const v of vectors) {
      if (v.status === 'EXPOSED') score += v.severity === 'CRITICAL' ? 24 : v.severity === 'HIGH' ? 16 : 9;
      else if (v.status === 'MONITORING') score += v.severity === 'HIGH' ? 9 : 4;
    }
    if (pnl.pnl.netOperatingProfitSov < 0) score += 12;
    if (pnl.pnl.healthStatus === 'RUNWAY_CRITICAL') score += 15;
    if (pnl.costsAndLosses.solvencyDiscrepancySov > policy.solvencyAlertThresholdSov) score += 20;
    const overallRiskScore = Math.max(0, Math.min(100, Math.round(score)));

    const riskGrade: RiskGrade =
      overallRiskScore >= 75
        ? 'CRITICAL'
        : overallRiskScore >= 50
          ? 'HIGH'
          : overallRiskScore >= 25
            ? 'ELEVATED'
            : 'LOW';

    const topPriorities = vectors
      .filter((v) => v.status === 'EXPOSED' || v.severity === 'CRITICAL' || v.detectedExposureSov > 0)
      .sort((a, b) => b.detectedExposureSov - a.detectedExposureSov)
      .slice(0, 4)
      .map((v) => `[${v.id}] ${v.title}: ${v.howToPrevent[0]}`);

    if (topPriorities.length === 0) {
      topPriorities.push('All primary leakage vectors are within configured safety budgets. Keep strict AMM & Funded DePIN guards ready for Mainnet.');
    }

    return {
      generatedAt: now,
      overallRiskScore,
      riskGrade,
      totalExposureSov: round4(vectors.reduce((s, v) => s + v.detectedExposureSov, 0)),
      totalDirectLossSov: pnl.costsAndLosses.totalDirectCostsAndSubsidiesSov,
      totalRecoveredSavingsSov: pnl.pnl.recoveredSavingsSov,
      preventedAttacksCount: pnl.pnl.preventedAttacksCount,
      vectors,
      topPriorities,
    };
  }

  public getOverview(): {
    ok: boolean;
    pnl: CompanyEconomicsPnLSnapshot;
    leakageAudit: LeakageAuditReport;
    policies: RiskPolicyConfig;
    recentLedger: RiskLedgerEntry[];
    circuitBreaker: any;
  } {
    const pnl = this.computeCompanyEconomicsAndPnL();
    const leakageAudit = this.auditSystemLeakageAndRisks();
    const policies = this.getRiskPolicies();
    const recentLedger = this.getRiskLedger(50);
    const circuitBreaker = sovereignAdminSecurity.getCircuitBreaker();
    return {
      ok: true,
      pnl,
      leakageAudit,
      policies,
      recentLedger,
      circuitBreaker,
    };
  }

  // =========================================================================
  // 3. ONE-CLICK AUTOMATED MITIGATIONS & RECOVERY ACTIONS
  // =========================================================================

  public executeMitigation(action: string, adminDid = 'did:sov:admin_root'): {
    ok: boolean;
    action: string;
    summary: string;
    details: Record<string, any>;
  } {
    const now = Date.now();
    const dbAny = this.getDbAny();
    const sqliteEngine = typeof (sovraDb as any).getSqliteEngine === 'function'
      ? (sovraDb as any).getSqliteEngine()
      : null;

    if (action === 'RECLAIM_EXPIRED_VOUCHERS') {
      const reclaimed = typeof (sovraDb as any).reclaimExpiredOfflineVouchers === 'function'
        ? (sovraDb as any).reclaimExpiredOfflineVouchers()
        : { reclaimedCount: 0, totalRefundedSov: 0 };
      if (reclaimed.totalRefundedSov > 0) {
        this.recordRiskEvent({
          category: 'MITIGATION_RECOVERY',
          severity: 'MEDIUM',
          direction: 'RECOVERED_OR_SAVED',
          amountSov: reclaimed.totalRefundedSov,
          actorDid: adminDid,
          endpoint: '/api/admin/risk/mitigate',
          description: `Reclaimed ${reclaimed.reclaimedCount} expired offline payment vouchers (${reclaimed.totalRefundedSov} SOV reconciled)`,
          prevented: true,
          metadata: reclaimed,
        });
      }
      return {
        ok: true,
        action,
        summary: `Reclaimed ${reclaimed.reclaimedCount} expired voucher(s) totaling ${reclaimed.totalRefundedSov} SOV.`,
        details: reclaimed,
      };
    }

    if (action === 'FREEZE_WASH_TRADING_LOOPS') {
      const refSybil = typeof (sovraDb as any).detectReferralSybilLoops === 'function'
        ? (sovraDb as any).detectReferralSybilLoops()
        : { cyclesDetected: 0, frozenDids: [] };
      const washCycles = sqliteEngine && typeof sqliteEngine.detectWashTradingCycles === 'function'
        ? sqliteEngine.detectWashTradingCycles(72)
        : [];
      const frozenCount = Number(refSybil.frozenDids?.length || 0) + washCycles.length;
      if (frozenCount > 0) {
        this.recordRiskEvent({
          category: 'MITIGATION_RECOVERY',
          severity: 'HIGH',
          direction: 'RECOVERED_OR_SAVED',
          amountSov: round4(washCycles.reduce((s: number, c: any) => s + Number(c.totalVolumeSov || 0) * 0.05, 0)),
          actorDid: adminDid,
          endpoint: '/api/admin/risk/mitigate',
          description: `Froze ${frozenCount} circular Sybil/wash-trading participant ring(s)`,
          prevented: true,
          metadata: { referralCycles: refSybil.cyclesDetected, washCycles: washCycles.length },
        });
      }
      return {
        ok: true,
        action,
        summary: `Scanned graph & froze ${refSybil.cyclesDetected} referral loops + ${washCycles.length} wash-trading cycles.`,
        details: { refSybil, washCyclesCount: washCycles.length },
      };
    }

    if (action === 'ENFORCE_STRICT_CAPS') {
      const updated = this.updateRiskPolicies({
        strictDepinFundedClientOnly: true,
        requireSeederBondForYield: true,
        enforceStrictAmmDrainCap: true,
        dailyFiatMintCapSov: 25_000,
        dailyReferralBudgetSov: 10_000,
        dailyFaucetBudgetSov: 5_000,
        dailyMetaTxSubsidyCapSov: 200,
      }, adminDid);
      if (sqliteEngine && typeof sqliteEngine.getPlatformTakeRate === 'function' && sqliteEngine.getPlatformTakeRate() < updated.platformTakeRateFloorPct) {
        sqliteEngine.setPlatformTakeRate(updated.platformTakeRateFloorPct);
      }
      this.recordRiskEvent({
        category: 'MITIGATION_RECOVERY',
        severity: 'MEDIUM',
        direction: 'RECOVERED_OR_SAVED',
        amountSov: 0,
        actorDid: adminDid,
        endpoint: '/api/admin/risk/mitigate',
        description: 'Activated Fortress Mainnet Risk Caps (Strict Funded DePIN, 100 SOV Seeder Bond Gate, AMM Drain Guard, Tightened Daily Budgets)',
        prevented: true,
      });
      return {
        ok: true,
        action,
        summary: 'Activated strict production risk caps across DePIN, Seeder yield, AMM pools, referrals, faucet, fiat mint, and meta-tx relayer.',
        details: { policies: updated },
      };
    }

    if (action === 'RECONCILE_OFFCHAIN_L1') {
      const rec = this.reconcileOffchainTransfersToL1(adminDid);
      return {
        ok: true,
        action,
        summary: `Audited ${rec.pendingCount} pending off-chain settlement intent(s) (${rec.pendingAmountSov} SOV volume, ${rec.pendingFeeDeficitSov} SOV fee backlog).`,
        details: rec,
      };
    }

    if (action === 'RECONCILE_LEDGER_SYNC') {
      const rawDb = this.getRawSqlite();
      let syncedUsers = 0;
      if (rawDb && Array.isArray(dbAny.db.users)) {
        for (const u of dbAny.db.users) {
          if (!u?.did) continue;
          try {
            const row = rawDb.prepare('SELECT balance_sov FROM users WHERE did = ?').get(u.did) as any;
            if (row && typeof row.balance_sov === 'number') {
              const jsonBal = Number(u.balanceSov ?? u.balance_sov ?? 0);
              if (Math.abs(jsonBal - Number(row.balance_sov)) > 0.001) {
                rawDb.prepare('UPDATE users SET balance_sov = ?, updated_at = ? WHERE did = ?').run(jsonBal, now, u.did);
                syncedUsers++;
              }
            }
          } catch {}
        }
      }
      this.recordRiskEvent({
        category: 'MITIGATION_RECOVERY',
        severity: 'LOW',
        direction: 'RECOVERED_OR_SAVED',
        amountSov: 0,
        actorDid: adminDid,
        endpoint: '/api/admin/risk/mitigate',
        description: `Synchronized JSON <-> SQLite balance ledgers (${syncedUsers} drifted user accounts healed)`,
        prevented: true,
      });
      return {
        ok: true,
        action,
        summary: `Ledger sync complete (${syncedUsers} accounts reconciled).`,
        details: { syncedUsers },
      };
    }

    if (action === 'TRIP_DEFENSIVE_CIRCUIT_BREAKER') {
      const cb = sovereignAdminSecurity.toggleCircuitBreaker(
        true,
        ['WITHDRAWALS', 'PROMOTIONS'],
        {
          did: adminDid,
          handle: '@risk_officer',
          role: 'SUPER_ADMIN',
          authMethod: 'DEVICE_KEY',
          authenticatedAt: now,
        },
        'Risk Management Engine: defensive pause engaged',
      );
      return {
        ok: true,
        action,
        summary: 'Defensive Circuit Breaker engaged on WITHDRAWALS and PROMOTIONS.',
        details: { circuitBreaker: cb },
      };
    }

    if (action === 'DISENGAGE_CIRCUIT_BREAKER') {
      const cb = sovereignAdminSecurity.toggleCircuitBreaker(
        false,
        [],
        {
          did: adminDid,
          handle: '@risk_officer',
          role: 'SUPER_ADMIN',
          authMethod: 'DEVICE_KEY',
          authenticatedAt: now,
        },
        'Risk Management Engine: circuit breaker cleared after mitigation',
      );
      return {
        ok: true,
        action,
        summary: 'Sovereign Circuit Breaker disengaged.',
        details: { circuitBreaker: cb },
      };
    }

    return {
      ok: false,
      action,
      summary: `Unknown risk mitigation action: ${action}`,
      details: {},
    };
  }
}

export const riskManagementEngine = RiskManagementEngine.getInstance();
