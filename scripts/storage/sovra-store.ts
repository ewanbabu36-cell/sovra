import pg from 'pg';
import crypto from 'node:crypto';

export type SovraPersistenceBackend = 'postgresql' | 'sqlite';

export interface PgQueryResult<T = any> {
  rows: T[];
  rowCount: number | null;
}

export interface PgClientLike {
  query<T = any>(text: string, params?: any[]): Promise<PgQueryResult<T>>;
  release(): void;
}

export interface PgPoolLike {
  query<T = any>(text: string, params?: any[]): Promise<PgQueryResult<T>>;
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
}

export interface SovraStoreOptions {
  databaseUrl?: string;
  pgPool?: PgPoolLike;
  sqliteEngine?: any;
  poolMax?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
}

export interface KycVerificationRecord {
  did: string;
  tier: 0 | 1 | 2;
  status: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  provider: string;
  country?: string;
  documentHash?: string;
  reviewedBy?: string;
  rejectionReason?: string;
  submittedAt: number;
  verifiedAt?: number;
  updatedAt: number;
}

export interface FiatPayoutRecord {
  id: string;
  userDid: string;
  amountSov: number;
  fiatAmount: number;
  currency: string;
  destinationRef: string;
  provider: 'stripe' | 'razorpayx' | 'sandbox';
  externalPayoutId?: string;
  status: 'PENDING_BANK_PAYOUT' | 'SETTLED' | 'FAILED_REFUNDED';
  failureReason?: string;
  createdAt: number;
  updatedAt: number;
  settledAt?: number;
}

export const KYC_TIER_LIMITS: Record<0 | 1 | 2, { dailyFiatPayoutMaxSov: number; dailyBridgeMaxSov: number; label: string }> = {
  0: { dailyFiatPayoutMaxSov: 0, dailyBridgeMaxSov: 1000, label: 'Unverified (Tier 0)' },
  1: { dailyFiatPayoutMaxSov: 5000, dailyBridgeMaxSov: 10000, label: 'Standard KYC (Tier 1)' },
  2: { dailyFiatPayoutMaxSov: 50000, dailyBridgeMaxSov: 100000, label: 'Enhanced Institutional KYC (Tier 2)' },
};

export const POSTGRES_ENTERPRISE_DDL = `
CREATE TABLE IF NOT EXISTS users (
  did TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  balance_sov DOUBLE PRECISION NOT NULL DEFAULT 0,
  staked_sov DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS financial_ledger (
  id TEXT PRIMARY KEY,
  from_did TEXT NOT NULL,
  to_did TEXT NOT NULL,
  amount_sov DOUBLE PRECISION NOT NULL,
  fee_sov DOUBLE PRECISION NOT NULL DEFAULT 0,
  tx_type TEXT NOT NULL,
  idempotency_key TEXT,
  metadata_json TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS financial_settlement_intents (
  id TEXT PRIMARY KEY,
  sender_did TEXT NOT NULL,
  recipient_did TEXT NOT NULL,
  amount_sov DOUBLE PRECISION NOT NULL,
  fee_sov DOUBLE PRECISION NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  idempotency_key TEXT,
  l1_tx_hash TEXT,
  l1_block_height BIGINT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  committed_at BIGINT,
  failed_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_pg_settlement_state ON financial_settlement_intents(state, created_at);

CREATE TABLE IF NOT EXISTS financial_idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  user_did TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  tx_id TEXT,
  status TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_management_policies (
  policy_key TEXT PRIMARY KEY,
  policy_json TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_management_ledger (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount_sov DOUBLE PRECISION NOT NULL,
  actor_did TEXT,
  endpoint TEXT,
  description TEXT NOT NULL,
  prevented BOOLEAN NOT NULL DEFAULT FALSE,
  metadata_json TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pg_risk_cat ON risk_management_ledger(category, created_at);

CREATE TABLE IF NOT EXISTS amm_pools (
  token_address TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  reserve_sov TEXT NOT NULL,
  reserve_token TEXT NOT NULL,
  fee_bps INTEGER NOT NULL DEFAULT 30,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS vesting_schedules (
  id TEXT PRIMARY KEY,
  beneficiary_did TEXT NOT NULL,
  total_locked_sov DOUBLE PRECISION NOT NULL,
  released_sov DOUBLE PRECISION NOT NULL DEFAULT 0,
  start_at BIGINT NOT NULL,
  unlock_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS seeder_bonds (
  seeder_did TEXT PRIMARY KEY,
  bonded_sov DOUBLE PRECISION NOT NULL DEFAULT 0,
  slashed_sov DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS bridge_transfers (
  id TEXT PRIMARY KEY,
  sender_did TEXT NOT NULL,
  target_chain TEXT NOT NULL,
  target_address TEXT NOT NULL,
  amount_sov DOUBLE PRECISION NOT NULL,
  relayer_fee_sov DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  tx_hash TEXT,
  created_at BIGINT NOT NULL,
  settled_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_pg_bridge_sender ON bridge_transfers(sender_did, created_at);

CREATE TABLE IF NOT EXISTS agent_jobs (
  id TEXT PRIMARY KEY,
  hirer_did TEXT NOT NULL,
  agent_did TEXT NOT NULL,
  escrow_sov DOUBLE PRECISION NOT NULL,
  fee_sov DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS offline_payment_vouchers (
  voucher_id TEXT PRIMARY KEY,
  sender_did TEXT NOT NULL,
  recipient_did TEXT,
  amount_sov DOUBLE PRECISION NOT NULL,
  nonce TEXT NOT NULL,
  signature TEXT NOT NULL,
  redeemed BOOLEAN NOT NULL DEFAULT FALSE,
  redeemed_by TEXT,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  redeemed_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_pg_vouchers_sender ON offline_payment_vouchers(sender_did, redeemed);

CREATE TABLE IF NOT EXISTS kyc_verifications (
  did TEXT PRIMARY KEY,
  tier INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  provider TEXT NOT NULL DEFAULT 'internal',
  country TEXT,
  document_hash TEXT,
  reviewed_by TEXT,
  rejection_reason TEXT,
  submitted_at BIGINT NOT NULL,
  verified_at BIGINT,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fiat_payouts (
  id TEXT PRIMARY KEY,
  user_did TEXT NOT NULL,
  amount_sov DOUBLE PRECISION NOT NULL,
  fiat_amount DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL,
  destination_ref TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_payout_id TEXT,
  status TEXT NOT NULL,
  failure_reason TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  settled_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_pg_fiat_payout_user ON fiat_payouts(user_did, created_at);
`;

export function createPgPoolFromUrl(
  databaseUrl: string,
  options?: { poolMax?: number; idleTimeoutMs?: number; connectionTimeoutMs?: number },
): PgPoolLike {
  const PoolCtor = (pg as any).Pool || (pg as any).default?.Pool;
  if (!PoolCtor) {
    throw new Error('pg.Pool constructor is unavailable');
  }
  return new PoolCtor({
    connectionString: databaseUrl,
    max: options?.poolMax ?? Number(process.env.SOVRA_PG_POOL_MAX || 20),
    idleTimeoutMillis: options?.idleTimeoutMs ?? 30_000,
    connectionTimeoutMillis: options?.connectionTimeoutMs ?? 5_000,
  });
}

export class SovraStore {
  private pgPool: PgPoolLike | null;
  private readonly databaseUrl: string | undefined;
  private sqliteEngine: any | null;
  private pgSchemaInitialized = false;

  constructor(options: SovraStoreOptions = {}) {
    this.databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
    this.sqliteEngine = options.sqliteEngine ?? null;
    if (options.pgPool) {
      this.pgPool = options.pgPool;
    } else if (this.databaseUrl && this.databaseUrl.trim().length > 0) {
      this.pgPool = createPgPoolFromUrl(this.databaseUrl.trim(), options);
    } else {
      this.pgPool = null;
    }
  }

  public setSqliteEngine(sqliteEngine: any): void {
    this.sqliteEngine = sqliteEngine;
  }

  public getSqliteEngine(): any | null {
    return this.sqliteEngine;
  }

  public getPgPool(): PgPoolLike | null {
    return this.pgPool;
  }

  public getBackend(): SovraPersistenceBackend {
    return this.pgPool ? 'postgresql' : 'sqlite';
  }

  public isPostgresEnabled(): boolean {
    return Boolean(this.pgPool);
  }

  /**
   * Disables monolithic synchronous JSON snapshot writes when running in production with PostgreSQL.
   */
  public shouldDisableJsonSnapshotDiskWrites(): boolean {
    const isProd = process.env.NODE_ENV === 'production';
    const forceJson = process.env.SOVRA_FORCE_JSON_SNAPSHOT === 'true';
    const hasPg = Boolean(this.pgPool || (process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0));
    return isProd && hasPg && !forceJson;
  }

  public async healthCheck(): Promise<{
    ok: boolean;
    backend: SovraPersistenceBackend;
    latencyMs: number;
    error?: string;
  }> {
    const start = Date.now();
    if (this.pgPool) {
      try {
        await this.pgPool.query('SELECT 1 AS ok');
        return { ok: true, backend: 'postgresql', latencyMs: Date.now() - start };
      } catch (err: any) {
        return {
          ok: false,
          backend: 'postgresql',
          latencyMs: Date.now() - start,
          error: err?.message || 'PostgreSQL health check failed',
        };
      }
    }

    const rawDb = this.getRawSqlite();
    if (!rawDb) {
      return { ok: false, backend: 'sqlite', latencyMs: Date.now() - start, error: 'SQLite engine not attached' };
    }
    try {
      rawDb.prepare('SELECT 1 AS ok').get();
      return { ok: true, backend: 'sqlite', latencyMs: Date.now() - start };
    } catch (err: any) {
      return {
        ok: false,
        backend: 'sqlite',
        latencyMs: Date.now() - start,
        error: err?.message || 'SQLite health check failed',
      };
    }
  }

  public async ensurePostgresSchema(): Promise<void> {
    if (!this.pgPool || this.pgSchemaInitialized) return;
    await this.pgPool.query(POSTGRES_ENTERPRISE_DDL);
    this.pgSchemaInitialized = true;
  }

  public async withTransaction<T>(fn: (client: PgClientLike) => Promise<T>): Promise<T> {
    if (!this.pgPool) {
      throw new Error('PostgreSQL pool is not configured for transactional execution');
    }
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  }

  private getRawSqlite(): any | null {
    if (!this.sqliteEngine) return null;
    if (typeof this.sqliteEngine.getRawDb === 'function') return this.sqliteEngine.getRawDb();
    return this.sqliteEngine.db || null;
  }

  /**
   * Executes an ACID balance transfer with row-level SELECT ... FOR UPDATE locks in PostgreSQL,
   * or BEGIN IMMEDIATE atomic transaction in SQLite.
   */
  public async executeTransferAtomic(params: {
    txId?: string;
    fromDid: string;
    toDid: string;
    amountSov: number;
    feeSov?: number;
    idempotencyKey?: string;
    txType?: string;
  }): Promise<{ ok: boolean; txId?: string; fromBalance?: number; toBalance?: number; isReplay?: boolean; error?: string }> {
    const amountSov = Number(params.amountSov || 0);
    const feeSov = Number(params.feeSov || 0);
    if (!params.fromDid || !params.toDid || !Number.isFinite(amountSov) || amountSov <= 0 || !Number.isFinite(feeSov) || feeSov < 0) {
      return { ok: false, error: 'Invalid transfer parameters' };
    }
    const txId = params.txId || `tx_${crypto.randomUUID()}`;
    const totalDebit = Math.round((amountSov + feeSov) * 1_000_000) / 1_000_000;
    const now = Date.now();
    const txType = params.txType || 'P2P_TRANSFER';

    if (this.pgPool) {
      try {
        return await this.withTransaction(async (client) => {
          if (params.idempotencyKey) {
            const existingKey = await client.query<{ tx_id: string }>(
              'SELECT tx_id FROM financial_idempotency_keys WHERE idempotency_key = $1',
              [params.idempotencyKey],
            );
            if (existingKey.rows.length > 0) {
              return { ok: true, isReplay: true, txId: existingKey.rows[0].tx_id };
            }
          }

          // Lock rows in canonical DID order to prevent deadlocks
          const lockedRows = await client.query<{ did: string; balance_sov: number }>(
            'SELECT did, balance_sov FROM users WHERE did = ANY($1) ORDER BY did ASC FOR UPDATE',
            [[params.fromDid, params.toDid]],
          );
          const sender = lockedRows.rows.find((r) => r.did === params.fromDid);
          const recipient = lockedRows.rows.find((r) => r.did === params.toDid);

          if (!sender) {
            throw new Error(`Sender account not found: ${params.fromDid}`);
          }
          if (!recipient) {
            throw new Error(`Recipient account not found: ${params.toDid}`);
          }
          const senderBal = Number(sender.balance_sov || 0);
          if (senderBal < totalDebit) {
            throw new Error(`Insufficient balance: available=${senderBal} SOV required=${totalDebit} SOV`);
          }

          const nextFrom = Math.round((senderBal - totalDebit) * 1_000_000) / 1_000_000;
          const nextTo = Math.round((Number(recipient.balance_sov || 0) + amountSov) * 1_000_000) / 1_000_000;

          await client.query(
            'UPDATE users SET balance_sov = $1, updated_at = $2 WHERE did = $3',
            [nextFrom, now, params.fromDid],
          );
          await client.query(
            'UPDATE users SET balance_sov = $1, updated_at = $2 WHERE did = $3',
            [nextTo, now, params.toDid],
          );
          await client.query(
            `INSERT INTO financial_ledger (id, from_did, to_did, amount_sov, fee_sov, tx_type, idempotency_key, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [txId, params.fromDid, params.toDid, amountSov, feeSov, txType, params.idempotencyKey || null, now],
          );
          if (params.idempotencyKey) {
            await client.query(
              `INSERT INTO financial_idempotency_keys
               (idempotency_key, user_did, operation_type, payload_hash, payload_json, tx_id, status, status_code, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, 'COMMITTED', 200, $7, $8)
               ON CONFLICT (idempotency_key) DO NOTHING`,
              [params.idempotencyKey, params.fromDid, txType, txId, '{}', txId, now, now],
            );
          }

          return { ok: true, txId, fromBalance: nextFrom, toBalance: nextTo };
        });
      } catch (err: any) {
        return { ok: false, error: err?.message || 'PostgreSQL atomic transfer failed' };
      }
    }

    const rawDb = this.getRawSqlite();
    if (!rawDb) {
      return { ok: false, error: 'Neither PostgreSQL nor SQLite storage is initialized' };
    }
    try {
      rawDb.exec('BEGIN IMMEDIATE');
      if (params.idempotencyKey) {
        const existingKey = rawDb
          .prepare('SELECT tx_id FROM financial_idempotency_keys WHERE idempotency_key = ?')
          .get(params.idempotencyKey) as any;
        if (existingKey) {
          rawDb.exec('ROLLBACK');
          return { ok: true, isReplay: true, txId: existingKey.tx_id };
        }
      }
      const sender = rawDb.prepare('SELECT did, balance_sov FROM users WHERE did = ?').get(params.fromDid) as any;
      const recipient = rawDb.prepare('SELECT did, balance_sov FROM users WHERE did = ?').get(params.toDid) as any;
      if (!sender) {
        rawDb.exec('ROLLBACK');
        return { ok: false, error: `Sender account not found: ${params.fromDid}` };
      }
      if (!recipient) {
        rawDb.exec('ROLLBACK');
        return { ok: false, error: `Recipient account not found: ${params.toDid}` };
      }
      const senderBal = Number(sender.balance_sov || 0);
      if (senderBal < totalDebit) {
        rawDb.exec('ROLLBACK');
        return { ok: false, error: `Insufficient balance: available=${senderBal} SOV required=${totalDebit} SOV` };
      }
      const nextFrom = Math.round((senderBal - totalDebit) * 1_000_000) / 1_000_000;
      const nextTo = Math.round((Number(recipient.balance_sov || 0) + amountSov) * 1_000_000) / 1_000_000;

      rawDb.prepare('UPDATE users SET balance_sov = ?, updated_at = ? WHERE did = ?').run(nextFrom, now, params.fromDid);
      rawDb.prepare('UPDATE users SET balance_sov = ?, updated_at = ? WHERE did = ?').run(nextTo, now, params.toDid);
      rawDb.prepare(
        `INSERT INTO token_transfers (id, from_did, to_did, amount_sov, fee_sov, tx_type, created_at, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(txId, params.fromDid, params.toDid, amountSov, feeSov, txType, now, params.idempotencyKey || null);
      if (params.idempotencyKey) {
        rawDb.prepare(
          `INSERT OR IGNORE INTO financial_idempotency_keys
           (idempotency_key, user_did, operation_type, payload_hash, payload_json, tx_id, status, status_code, created_at, updated_at)
           VALUES (?, ?, ?, ?, '{}', ?, 'COMMITTED', 200, ?, ?)`,
        ).run(params.idempotencyKey, params.fromDid, txType, txId, txId, now, now);
      }
      rawDb.exec('COMMIT');
      return { ok: true, txId, fromBalance: nextFrom, toBalance: nextTo };
    } catch (err: any) {
      try { rawDb.exec('ROLLBACK'); } catch (_) {}
      return { ok: false, error: err?.message || 'SQLite atomic transfer failed' };
    }
  }

  public async getPendingSettlementIntents(): Promise<any[]> {
    if (this.pgPool) {
      const res = await this.pgPool.query(
        "SELECT * FROM financial_settlement_intents WHERE state IN ('SUBMITTED', 'RECONCILIATION_REQUIRED') ORDER BY created_at ASC",
      );
      return res.rows;
    }
    if (this.sqliteEngine && typeof this.sqliteEngine.getPendingSettlementIntents === 'function') {
      return this.sqliteEngine.getPendingSettlementIntents();
    }
    return [];
  }

  public async commitSettlementIntent(params: {
    intentId: string;
    l1TxHash: string;
    l1BlockHeight: number;
  }): Promise<{ ok: boolean; fromBalance?: number; toBalance?: number; isReplay?: boolean; error?: string }> {
    const now = Date.now();
    if (this.pgPool) {
      try {
        return await this.withTransaction(async (client) => {
          const res = await client.query(
            'SELECT * FROM financial_settlement_intents WHERE id = $1 FOR UPDATE',
            [params.intentId],
          );
          const intent = res.rows[0];
          if (!intent) {
            throw new Error('Settlement intent not found');
          }
          if (intent.state === 'COMMITTED') {
            return { ok: true, isReplay: true };
          }
          await client.query(
            'UPDATE users SET balance_sov = balance_sov + $1, updated_at = $2 WHERE did = $3',
            [Number(intent.amount_sov), now, intent.recipient_did],
          );
          await client.query(
            `UPDATE financial_settlement_intents
             SET state = 'COMMITTED', l1_tx_hash = $1, l1_block_height = $2, committed_at = $3, updated_at = $4
             WHERE id = $5`,
            [params.l1TxHash, params.l1BlockHeight, now, now, intent.id],
          );
          await client.query(
            `INSERT INTO financial_ledger (id, from_did, to_did, amount_sov, fee_sov, tx_type, idempotency_key, created_at)
             VALUES ($1, $2, $3, $4, $5, 'L1_RECONCILED_TRANSFER', $6, $7)
             ON CONFLICT (id) DO NOTHING`,
            [intent.id, intent.sender_did, intent.recipient_did, Number(intent.amount_sov), Number(intent.fee_sov || 0), intent.idempotency_key || null, now],
          );
          const senderRes = await client.query<{ balance_sov: number }>('SELECT balance_sov FROM users WHERE did = $1', [intent.sender_did]);
          const recipRes = await client.query<{ balance_sov: number }>('SELECT balance_sov FROM users WHERE did = $1', [intent.recipient_did]);
          return {
            ok: true,
            fromBalance: senderRes.rows[0]?.balance_sov,
            toBalance: recipRes.rows[0]?.balance_sov,
          };
        });
      } catch (err: any) {
        return { ok: false, error: err?.message || 'Postgres settlement commit failed' };
      }
    }
    if (this.sqliteEngine && typeof this.sqliteEngine.commitSettlementIntent === 'function') {
      return this.sqliteEngine.commitSettlementIntent(params);
    }
    return { ok: false, error: 'Storage backend unavailable' };
  }

  public async failAndRefundSettlementIntent(params: {
    intentId: string;
    errorReason: string;
  }): Promise<{ ok: boolean; refunded?: boolean; error?: string }> {
    const now = Date.now();
    if (this.pgPool) {
      try {
        return await this.withTransaction(async (client) => {
          const res = await client.query(
            'SELECT * FROM financial_settlement_intents WHERE id = $1 FOR UPDATE',
            [params.intentId],
          );
          const intent = res.rows[0];
          if (!intent) throw new Error('Settlement intent not found');
          if (intent.state === 'FAILED') return { ok: true, refunded: false };
          if (intent.state === 'COMMITTED') throw new Error('Cannot refund committed settlement intent');

          const totalRefund = Number(intent.amount_sov) + Number(intent.fee_sov || 0);
          await client.query(
            'UPDATE users SET balance_sov = balance_sov + $1, updated_at = $2 WHERE did = $3',
            [totalRefund, now, intent.sender_did],
          );
          await client.query(
            `UPDATE financial_settlement_intents
             SET state = 'FAILED', last_error = $1, failed_at = $2, updated_at = $3
             WHERE id = $4`,
            [params.errorReason, now, now, intent.id],
          );
          return { ok: true, refunded: true };
        });
      } catch (err: any) {
        return { ok: false, error: err?.message || 'Postgres refund failed' };
      }
    }
    if (this.sqliteEngine && typeof this.sqliteEngine.failAndRefundSettlementIntent === 'function') {
      return this.sqliteEngine.failAndRefundSettlementIntent(params);
    }
    return { ok: false, error: 'Storage backend unavailable' };
  }

  public async upsertKycVerification(record: KycVerificationRecord): Promise<void> {
    if (this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO kyc_verifications
         (did, tier, status, provider, country, document_hash, reviewed_by, rejection_reason, submitted_at, verified_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (did) DO UPDATE SET
           tier = EXCLUDED.tier,
           status = EXCLUDED.status,
           provider = EXCLUDED.provider,
           country = EXCLUDED.country,
           document_hash = EXCLUDED.document_hash,
           reviewed_by = EXCLUDED.reviewed_by,
           rejection_reason = EXCLUDED.rejection_reason,
           verified_at = EXCLUDED.verified_at,
           updated_at = EXCLUDED.updated_at`,
        [
          record.did,
          record.tier,
          record.status,
          record.provider,
          record.country || null,
          record.documentHash || null,
          record.reviewedBy || null,
          record.rejectionReason || null,
          record.submittedAt,
          record.verifiedAt || null,
          record.updatedAt,
        ],
      );
    }
    const rawDb = this.getRawSqlite();
    if (rawDb) {
      rawDb.prepare(
        `INSERT OR REPLACE INTO kyc_verifications
         (did, tier, status, provider, country, document_hash, reviewed_by, rejection_reason, submitted_at, verified_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.did,
        record.tier,
        record.status,
        record.provider,
        record.country || null,
        record.documentHash || null,
        record.reviewedBy || null,
        record.rejectionReason || null,
        record.submittedAt,
        record.verifiedAt || null,
        record.updatedAt,
      );
    }
  }

  public async getKycVerification(did: string): Promise<KycVerificationRecord> {
    const fallback: KycVerificationRecord = {
      did,
      tier: 0,
      status: 'UNVERIFIED',
      provider: 'none',
      submittedAt: 0,
      updatedAt: 0,
    };
    if (this.pgPool) {
      const res = await this.pgPool.query('SELECT * FROM kyc_verifications WHERE did = $1', [did]);
      if (res.rows[0]) {
        const r = res.rows[0];
        return {
          did: r.did,
          tier: Number(r.tier || 0) as 0 | 1 | 2,
          status: r.status,
          provider: r.provider,
          country: r.country || undefined,
          documentHash: r.document_hash || undefined,
          reviewedBy: r.reviewed_by || undefined,
          rejectionReason: r.rejection_reason || undefined,
          submittedAt: Number(r.submitted_at || 0),
          verifiedAt: r.verified_at ? Number(r.verified_at) : undefined,
          updatedAt: Number(r.updated_at || 0),
        };
      }
      return fallback;
    }
    const rawDb = this.getRawSqlite();
    if (!rawDb) return fallback;
    try {
      const r = rawDb.prepare('SELECT * FROM kyc_verifications WHERE did = ?').get(did) as any;
      if (!r) return fallback;
      return {
        did: r.did,
        tier: Number(r.tier || 0) as 0 | 1 | 2,
        status: r.status,
        provider: r.provider,
        country: r.country || undefined,
        documentHash: r.document_hash || undefined,
        reviewedBy: r.reviewed_by || undefined,
        rejectionReason: r.rejection_reason || undefined,
        submittedAt: Number(r.submitted_at || 0),
        verifiedAt: r.verified_at ? Number(r.verified_at) : undefined,
        updatedAt: Number(r.updated_at || 0),
      };
    } catch {
      return fallback;
    }
  }

  public async recordFiatPayout(payout: FiatPayoutRecord): Promise<void> {
    if (this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO fiat_payouts
         (id, user_did, amount_sov, fiat_amount, currency, destination_ref, provider, external_payout_id, status, failure_reason, created_at, updated_at, settled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET
           external_payout_id = COALESCE(EXCLUDED.external_payout_id, fiat_payouts.external_payout_id),
           status = EXCLUDED.status,
           failure_reason = EXCLUDED.failure_reason,
           updated_at = EXCLUDED.updated_at,
           settled_at = EXCLUDED.settled_at`,
        [
          payout.id,
          payout.userDid,
          payout.amountSov,
          payout.fiatAmount,
          payout.currency,
          payout.destinationRef,
          payout.provider,
          payout.externalPayoutId || null,
          payout.status,
          payout.failureReason || null,
          payout.createdAt,
          payout.updatedAt,
          payout.settledAt || null,
        ],
      );
    }
    const rawDb = this.getRawSqlite();
    if (rawDb) {
      rawDb.prepare(
        `INSERT OR REPLACE INTO fiat_payouts
         (id, user_did, amount_sov, fiat_amount, currency, destination_ref, provider, external_payout_id, status, failure_reason, created_at, updated_at, settled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        payout.id,
        payout.userDid,
        payout.amountSov,
        payout.fiatAmount,
        payout.currency,
        payout.destinationRef,
        payout.provider,
        payout.externalPayoutId || null,
        payout.status,
        payout.failureReason || null,
        payout.createdAt,
        payout.updatedAt,
        payout.settledAt || null,
      );
    }
  }

  public async getFiatPayout(payoutId: string): Promise<FiatPayoutRecord | null> {
    if (this.pgPool) {
      const res = await this.pgPool.query('SELECT * FROM fiat_payouts WHERE id = $1 OR external_payout_id = $1 LIMIT 1', [payoutId]);
      const r = res.rows[0];
      if (!r) return null;
      return {
        id: r.id,
        userDid: r.user_did,
        amountSov: Number(r.amount_sov),
        fiatAmount: Number(r.fiat_amount),
        currency: r.currency,
        destinationRef: r.destination_ref,
        provider: r.provider,
        externalPayoutId: r.external_payout_id || undefined,
        status: r.status,
        failureReason: r.failure_reason || undefined,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        settledAt: r.settled_at ? Number(r.settled_at) : undefined,
      };
    }
    const rawDb = this.getRawSqlite();
    if (!rawDb) return null;
    try {
      const r = rawDb
        .prepare('SELECT * FROM fiat_payouts WHERE id = ? OR external_payout_id = ? LIMIT 1')
        .get(payoutId, payoutId) as any;
      if (!r) return null;
      return {
        id: r.id,
        userDid: r.user_did,
        amountSov: Number(r.amount_sov),
        fiatAmount: Number(r.fiat_amount),
        currency: r.currency,
        destinationRef: r.destination_ref,
        provider: r.provider,
        externalPayoutId: r.external_payout_id || undefined,
        status: r.status,
        failureReason: r.failure_reason || undefined,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        settledAt: r.settled_at ? Number(r.settled_at) : undefined,
      };
    } catch {
      return null;
    }
  }

  public async getDailyFiatPayoutSov(did: string, windowMs = 86_400_000): Promise<number> {
    const cutoff = Date.now() - windowMs;
    if (this.pgPool) {
      const res = await this.pgPool.query<{ total: number }>(
        "SELECT COALESCE(SUM(amount_sov), 0) AS total FROM fiat_payouts WHERE user_did = $1 AND status IN ('PENDING_BANK_PAYOUT', 'SETTLED') AND created_at >= $2",
        [did, cutoff],
      );
      return Number(res.rows[0]?.total || 0);
    }
    const rawDb = this.getRawSqlite();
    if (!rawDb) return 0;
    try {
      const row = rawDb.prepare(
        "SELECT COALESCE(SUM(amount_sov), 0) AS total FROM fiat_payouts WHERE user_did = ? AND status IN ('PENDING_BANK_PAYOUT', 'SETTLED') AND created_at >= ?",
      ).get(did, cutoff) as any;
      return Number(row?.total || 0);
    } catch {
      return 0;
    }
  }

  public async getDailyBridgeSov(did: string, windowMs = 86_400_000): Promise<number> {
    const cutoff = Date.now() - windowMs;
    if (this.pgPool) {
      const res = await this.pgPool.query<{ total: number }>(
        "SELECT COALESCE(SUM(amount_sov), 0) AS total FROM bridge_transfers WHERE sender_did = $1 AND status != 'FAILED' AND created_at >= $2",
        [did, cutoff],
      );
      return Number(res.rows[0]?.total || 0);
    }
    const rawDb = this.getRawSqlite();
    if (!rawDb) return 0;
    try {
      const row = rawDb.prepare(
        "SELECT COALESCE(SUM(CAST(amount_sov AS REAL)), 0) AS total FROM bridge_transfers WHERE (sender_did = ? OR sender_address = ?) AND created_at >= ?",
      ).get(did, did, cutoff) as any;
      return Number(row?.total || 0);
    } catch {
      return 0;
    }
  }

  public async getSettlementBacklogStats(): Promise<{ pendingCount: number; reconciliationCount: number; failedCount: number }> {
    if (this.pgPool) {
      const res = await this.pgPool.query<{ state: string; cnt: string }>(
        'SELECT state, COUNT(*) AS cnt FROM financial_settlement_intents GROUP BY state',
      );
      let pendingCount = 0;
      let reconciliationCount = 0;
      let failedCount = 0;
      for (const r of res.rows) {
        const cnt = Number(r.cnt || 0);
        if (r.state === 'SUBMITTED') pendingCount += cnt;
        else if (r.state === 'RECONCILIATION_REQUIRED') {
          pendingCount += cnt;
          reconciliationCount += cnt;
        } else if (r.state === 'FAILED') failedCount += cnt;
      }
      return { pendingCount, reconciliationCount, failedCount };
    }
    const rawDb = this.getRawSqlite();
    if (!rawDb) return { pendingCount: 0, reconciliationCount: 0, failedCount: 0 };
    try {
      const rows = rawDb.prepare('SELECT state, COUNT(*) AS cnt FROM financial_settlement_intents GROUP BY state').all() as any[];
      let pendingCount = 0;
      let reconciliationCount = 0;
      let failedCount = 0;
      for (const r of rows) {
        const cnt = Number(r.cnt || 0);
        if (r.state === 'SUBMITTED') pendingCount += cnt;
        else if (r.state === 'RECONCILIATION_REQUIRED') {
          pendingCount += cnt;
          reconciliationCount += cnt;
        } else if (r.state === 'FAILED') failedCount += cnt;
      }
      return { pendingCount, reconciliationCount, failedCount };
    } catch {
      return { pendingCount: 0, reconciliationCount: 0, failedCount: 0 };
    }
  }

  public async close(): Promise<void> {
    if (this.pgPool) {
      await this.pgPool.end();
      this.pgPool = null;
    }
  }
}
