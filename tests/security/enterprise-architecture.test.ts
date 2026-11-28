import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import http2 from 'node:http2';
import crypto from 'node:crypto';
import { sovraDb, SovraDatabaseEngine } from '../../scripts/database-engine.ts';
import { SovraStore, KYC_TIER_LIMITS, type PgPoolLike, type PgClientLike } from '../../scripts/storage/sovra-store.ts';
import { L1SettlementRelayer, type L1RpcTransport } from '../../scripts/l1-relayer.ts';
import { StripePayoutAdapter, RazorpayXPayoutAdapter } from '../../scripts/payments/fiat-gateway.ts';
import { riskManagementEngine } from '../../scripts/risk-management-engine.ts';
import { handleWalletRoutes } from '../../scripts/routes/wallet.routes.ts';
import { handleEnterpriseProtocolRoutes, clearApnsJwtCacheForTest } from '../../scripts/routes/enterprise-protocol.routes.ts';
import { SharedSecurityStore, type RedisLike } from '../../services/api/src/storage/shared-security-store.ts';
import { DecoupledApiServer } from '../../services/api/src/server.ts';
import { startModerationWorkerServer } from '../../services/moderation-worker/src/server.ts';
import { startSearchWorkerServer } from '../../services/search/src/server.ts';
import { startTranscoderWorkerServer } from '../../services/transcoder/src/server.ts';

function createMockReqRes(
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
  rawBody = '',
) {
  let statusCode = 200;
  const respHeaders: Record<string, string> = {};
  let bodyStr = '';
  const listeners: Record<string, Function[]> = {};
  const req = {
    method,
    url: urlPath,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
    on(ev: string, fn: Function) {
      listeners[ev] = listeners[ev] || [];
      listeners[ev].push(fn);
      if (ev === 'data' && rawBody) fn(Buffer.from(rawBody, 'utf8'));
      if (ev === 'end') setTimeout(() => fn(), 0);
      return req;
    },
    destroy: () => {},
  } as unknown as http.IncomingMessage;
  const res = {
    setHeader(k: string, v: string) { respHeaders[k.toLowerCase()] = v; },
    writeHead(code: number, hdrs?: Record<string, string>) {
      statusCode = code;
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) respHeaders[k.toLowerCase()] = v;
      }
      return res;
    },
    end(chunk?: any) {
      if (chunk) bodyStr += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    },
  } as unknown as http.ServerResponse;
  return {
    req,
    res,
    getResponse: () => ({
      statusCode,
      headers: respHeaders,
      text: bodyStr,
      json: () => JSON.parse(bodyStr || '{}'),
    }),
  };
}

class InMemoryMockPgPool implements PgPoolLike {
  public readonly users = new Map<string, { did: string; balance_sov: number }>();
  public readonly ledger: any[] = [];
  public readonly idempotencyKeys = new Set<string>();
  public readonly queriesSeen: string[] = [];

  public seedUser(did: string, balanceSov: number): void {
    this.users.set(did, { did, balance_sov: balanceSov });
  }

  public async query<T = any>(text: string, params: any[] = []): Promise<{ rows: T[]; rowCount: number | null }> {
    this.queriesSeen.push(text.trim());
    if (/SELECT 1/i.test(text)) {
      return { rows: [{ ok: 1 } as any], rowCount: 1 };
    }
    if (/CREATE TABLE/i.test(text)) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  }

  public async connect(): Promise<PgClientLike> {
    const pool = this;
    let snapshotUsers: Map<string, { did: string; balance_sov: number }> | null = null;
    let snapshotLedgerLen = 0;
    let snapshotKeys: Set<string> | null = null;
    return {
      async query<T = any>(text: string, params: any[] = []): Promise<{ rows: T[]; rowCount: number | null }> {
        pool.queriesSeen.push(text.trim());
        const sql = text.trim().toUpperCase();
        if (sql === 'BEGIN') {
          snapshotUsers = new Map(Array.from(pool.users.entries()).map(([k, v]) => [k, { ...v }]));
          snapshotLedgerLen = pool.ledger.length;
          snapshotKeys = new Set(pool.idempotencyKeys);
          return { rows: [], rowCount: 0 };
        }
        if (sql === 'COMMIT') {
          snapshotUsers = null;
          return { rows: [], rowCount: 0 };
        }
        if (sql === 'ROLLBACK') {
          if (snapshotUsers) {
            pool.users.clear();
            for (const [k, v] of snapshotUsers.entries()) pool.users.set(k, v);
            pool.ledger.length = snapshotLedgerLen;
            pool.idempotencyKeys.clear();
            for (const k of snapshotKeys || []) pool.idempotencyKeys.add(k);
          }
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('FROM financial_idempotency_keys')) {
          const hit = pool.idempotencyKeys.has(params[0]);
          return { rows: hit ? ([{ tx_id: 'replay' }] as any) : [], rowCount: hit ? 1 : 0 };
        }
        if (text.includes('FOR UPDATE')) {
          const dids: string[] = Array.isArray(params[0]) ? params[0] : [];
          const rows = dids
            .slice()
            .sort()
            .map((d) => pool.users.get(d))
            .filter(Boolean)
            .map((r) => ({ ...r })) as any[];
          return { rows, rowCount: rows.length };
        }
        if (text.startsWith('UPDATE users SET balance_sov')) {
          const [bal, , did] = params;
          const u = pool.users.get(did);
          if (u) u.balance_sov = Number(bal);
          return { rows: [], rowCount: u ? 1 : 0 };
        }
        if (text.startsWith('INSERT INTO financial_ledger')) {
          pool.ledger.push({ id: params[0], from: params[1], to: params[2], amount: params[3] });
          return { rows: [], rowCount: 1 };
        }
        if (text.startsWith('INSERT INTO financial_idempotency_keys')) {
          pool.idempotencyKeys.add(params[0]);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };
  }

  public async end(): Promise<void> {}
}

class InMemoryMockRedis implements RedisLike {
  private kv = new Map<string, { val: string; expiresAt: number }>();

  public async get(key: string): Promise<string | null> {
    const entry = this.kv.get(key);
    if (!entry) return null;
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.kv.delete(key);
      return null;
    }
    return entry.val;
  }

  public async set(key: string, value: string, ...args: any[]): Promise<string | null> {
    let ttlMs = 0;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      if (String(args[i]).toUpperCase() === 'PX' && args[i + 1] !== undefined) {
        ttlMs = Number(args[i + 1]);
        i++;
      } else if (String(args[i]).toUpperCase() === 'NX') {
        nx = true;
      }
    }
    const existing = await this.get(key);
    if (nx && existing !== null) return null;
    this.kv.set(key, { val: value, expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0 });
    return 'OK';
  }

  public async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const k of keys) {
      if (this.kv.delete(k)) removed++;
    }
    return removed;
  }

  public async incr(key: string): Promise<number> {
    const cur = await this.get(key);
    const next = (cur ? Number(cur) : 0) + 1;
    const prevExp = this.kv.get(key)?.expiresAt ?? 0;
    this.kv.set(key, { val: String(next), expiresAt: prevExp });
    return next;
  }

  public async pexpire(key: string, ms: number): Promise<number> {
    const entry = this.kv.get(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + ms;
    return 1;
  }

  public async pttl(key: string): Promise<number> {
    const entry = this.kv.get(key);
    if (!entry || entry.expiresAt <= 0) return -1;
    return Math.max(0, entry.expiresAt - Date.now());
  }

  public async ping(): Promise<string> {
    return 'PONG';
  }
}

describe('Enterprise Architecture Pillars E2E Verification', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-ent-'));
    sovraDb.load();
  });

  afterAll(() => {
    delete process.env.FIAT_PAYOUT_PROVIDER_ENABLED;
    delete process.env.FIAT_PAYOUT_PROVIDER;
    delete process.env.SOVRA_STRICT_KYC_GATES;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.RAZORPAYX_KEY_ID;
    delete process.env.RAZORPAYX_KEY_SECRET;
    delete process.env.RAZORPAYX_ACCOUNT_NUMBER;
    delete process.env.RAZORPAYX_WEBHOOK_SECRET;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('Pillar 1A: SovraStore executes ACID SELECT FOR UPDATE transfers in Postgres & skips JSON snapshots in prod', async () => {
    const pgPool = new InMemoryMockPgPool();
    pgPool.seedUser('did:sov:pg_alice', 100);
    pgPool.seedUser('did:sov:pg_bob', 25);

    const store = new SovraStore({ pgPool, databaseUrl: 'postgres://sovra:pw@localhost:5432/sovra' });
    await store.ensurePostgresSchema();
    expect(pgPool.queriesSeen.some((q) => q.includes('kyc_verifications'))).toBe(true);
    expect(pgPool.queriesSeen.some((q) => q.includes('fiat_payouts'))).toBe(true);

    const transferRes = await store.executeTransferAtomic({
      fromDid: 'did:sov:pg_alice',
      toDid: 'did:sov:pg_bob',
      amountSov: 30,
      feeSov: 0.5,
      idempotencyKey: 'pg_idem_1',
    });
    expect(transferRes.ok).toBe(true);
    expect(pgPool.users.get('did:sov:pg_alice')?.balance_sov).toBe(69.5);
    expect(pgPool.users.get('did:sov:pg_bob')?.balance_sov).toBe(55);
    expect(pgPool.queriesSeen.some((q) => q.includes('FOR UPDATE'))).toBe(true);

    // Overdraft triggers ROLLBACK preserving exact balances
    const failRes = await store.executeTransferAtomic({
      fromDid: 'did:sov:pg_alice',
      toDid: 'did:sov:pg_bob',
      amountSov: 500,
    });
    expect(failRes.ok).toBe(false);
    expect(pgPool.users.get('did:sov:pg_alice')?.balance_sov).toBe(69.5);
    expect(pgPool.queriesSeen).toContain('ROLLBACK');

    // In production + DATABASE_URL, SovraDatabaseEngine skips synchronous whole-file JSON disk dumps
    const prodDir = path.join(tmpDir, 'prod-no-json');
    const prevNodeEnv = process.env.NODE_ENV;
    const prevDbUrl = process.env.DATABASE_URL;
    try {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgres://sovra:pw@localhost:5432/sovra';
      const prodDb = new SovraDatabaseEngine(prodDir);
      expect(prodDb.getSovraStore().shouldDisableJsonSnapshotDiskWrites()).toBe(true);
      prodDb.save(true);
      expect(fs.existsSync(path.join(prodDir, 'dynamic-social-state.json'))).toBe(false);
      expect(prodDb.getDbInfo().backend).toBe('postgresql');
      await prodDb.getSovraStore().close().catch(() => {});
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevDbUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevDbUrl;
    }
  });

  it('Pillar 1B: Redis SharedSecurityStore syncs replay nonces & rate limits across replicas + strict prod CSP + worker services', async () => {
    const sharedRedis = new InMemoryMockRedis();
    const replicaA = new SharedSecurityStore({ redisClient: sharedRedis });
    const replicaB = new SharedSecurityStore({ redisClient: sharedRedis });

    const exp = Date.now() + 60_000;
    expect(await replicaA.consumeNonceAsync('cross_replica_nonce_1', Date.now(), exp)).toBe(true);
    expect(await replicaB.consumeNonceAsync('cross_replica_nonce_1', Date.now(), exp)).toBe(false);

    const rl1 = await replicaA.consumeRateLimitAsync('10.0.0.9', 2, 60_000);
    const rl2 = await replicaB.consumeRateLimitAsync('10.0.0.9', 2, 60_000);
    const rl3 = await replicaA.consumeRateLimitAsync('10.0.0.9', 2, 60_000);
    expect(rl1.allowed).toBe(true);
    expect(rl2.allowed).toBe(true);
    expect(rl3.allowed).toBe(false);

    replicaA.simulateOutage(true);
    expect((await replicaA.healthCheck()).ok).toBe(false);
    await expect(replicaA.consumeNonceAsync('outage_nonce', Date.now(), exp)).rejects.toThrow();
    replicaA.simulateOutage(false);

    // Production API Server CSP + Prometheus metrics
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const apiServer = new DecoupledApiServer({
      port: 0,
      host: '127.0.0.1',
      internalSecret: 'enterprise_api_test_secret_minimum_32_characters_long',
      sharedStore: replicaA,
      pgPool: new InMemoryMockPgPool(),
      telemetryProvider: () => ({ pendingSettlementIntents: 3, riskNetPnlSov: 120.5, riskExposureSov: 10 }),
    });
    const port = await apiServer.start();
    try {
      const mRes = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(mRes.status).toBe(200);
      const csp = mRes.headers.get('content-security-policy') || '';
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toContain('unsafe-eval');
      const mText = await mRes.text();
      expect(mText).toContain('sovra_http_request_duration_p95_ms');
      expect(mText).toContain('sovra_postgres_healthy 1');
      expect(mText).toContain('sovra_redis_healthy 1');
      expect(mText).toContain('sovra_settlement_pending_intents 3');
      expect(mText).toContain('sovra_risk_net_pnl_sov 120.5000');
    } finally {
      process.env.NODE_ENV = prevEnv;
      await apiServer.stop();
    }

    // Runnable HTTP Workers enforce secret & pass health/work calls
    const secret = 'worker_cluster_auth_token_32bytes_min';
    const modSrv = await startModerationWorkerServer({ port: 0, host: '127.0.0.1', serviceSecret: secret });
    const searchSrv = await startSearchWorkerServer({ port: 0, host: '127.0.0.1', serviceSecret: secret });
    const txSrv = await startTranscoderWorkerServer({ port: 0, host: '127.0.0.1', serviceSecret: secret });
    try {
      const unauth = await fetch(`http://127.0.0.1:${modSrv.port}/scan`, { method: 'POST', body: '{}' });
      expect(unauth.status).toBe(401);
      const okScan = await fetch(`http://127.0.0.1:${modSrv.port}/scan`, {
        method: 'POST',
        headers: { 'x-sovra-service-secret': secret, 'content-type': 'application/json' },
        body: JSON.stringify({ contentCid: 'cid1', mimeType: 'text/plain', textContent: 'sovereign identity note' }),
      });
      expect(okScan.status).toBe(200);

      const idxRes = await fetch(`http://127.0.0.1:${searchSrv.port}/index`, {
        method: 'POST',
        headers: { 'x-sovra-service-secret': secret, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'p1', authorDid: 'did:sov:alice', caption: 'Enterprise Kubernetes scale' }),
      });
      expect(idxRes.status).toBe(200);
      const sRes = await fetch(`http://127.0.0.1:${searchSrv.port}/search`, {
        method: 'POST',
        headers: { 'x-sovra-service-secret': secret, 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'Kubernetes' }),
      });
      expect(sRes.status).toBe(200);

      const tRes = await fetch(`http://127.0.0.1:${txSrv.port}/transcode`, {
        method: 'POST',
        headers: { 'x-sovra-service-secret': secret, 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: 'j1', sourceCid: 'bafy123', targetResolutions: ['360p', '720p'] }),
      });
      expect(tRes.status).toBe(200);
    } finally {
      await modSrv.close();
      await searchSrv.close();
      await txSrv.close();
    }
  });

  it('Pillar 2: Autonomous L1SettlementRelayer fails over RPCs to COMMIT, atomically refunds REJECTED intents, & manifests contain zero hardcoded secrets', async () => {
    const sqliteEngine = (sovraDb as any).getSqliteEngine();
    const rawDb = sqliteEngine.getRawDb();
    const runTag = crypto.randomBytes(4).toString('hex');
    const sDid = `did:sov:relayer_s_${runTag}`;
    const rDid = `did:sov:relayer_r_${runTag}`;
    const sFailDid = `did:sov:relayer_sf_${runTag}`;
    const now = Date.now();

    rawDb.prepare('INSERT OR REPLACE INTO users (did, handle, display_name, avatar, avatar_bg, balance_sov, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(sDid, `@s_${runTag}`, 'Sender', 'S', '#112233', 50, now, now);
    rawDb.prepare('INSERT OR REPLACE INTO users (did, handle, display_name, avatar, avatar_bg, balance_sov, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(rDid, `@r_${runTag}`, 'Recip', 'R', '#112233', 10, now, now);
    rawDb.prepare('INSERT OR REPLACE INTO users (did, handle, display_name, avatar, avatar_bg, balance_sov, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(sFailDid, `@sf_${runTag}`, 'FailSender', 'F', '#112233', 40, now, now);

    const intentCommitId = `intent_commit_${runTag}`;
    const intentRejectId = `intent_reject_${runTag}`;
    rawDb.prepare(`
      INSERT INTO financial_settlement_intents (id, sender_did, recipient_did, amount_sov, fee_sov, state, created_at, updated_at)
      VALUES (?, ?, ?, 20, 0.01, 'RECONCILIATION_REQUIRED', ?, ?)
    `).run(intentCommitId, sDid, rDid, now, now);
    rawDb.prepare(`
      INSERT INTO financial_settlement_intents (id, sender_did, recipient_did, amount_sov, fee_sov, state, created_at, updated_at)
      VALUES (?, ?, ?, 15, 0.02, 'RECONCILIATION_REQUIRED', ?, ?)
    `).run(intentRejectId, sFailDid, rDid, now + 1, now + 1);

    const mockTransport: L1RpcTransport = {
      async getClusterStatus(ep) {
        if (ep.includes('dead')) return { ok: false, latestBlockHeight: 0, catchingUp: true };
        return { ok: true, latestBlockHeight: 4210, catchingUp: false };
      },
      async queryTx() {
        return { found: false, committed: false, code: -1, blockHeight: 0 };
      },
      async broadcastTxCommit(ep, bytes) {
        const str = Buffer.from(bytes).toString('utf8');
        if (ep.includes('dead')) return { status: 'RETRYABLE', reason: 'timeout', endpoint: ep };
        if (str.includes(intentRejectId)) {
          return { status: 'REJECTED', code: 5, log: 'Invalid sequence or signature', endpoint: ep };
        }
        return { status: 'COMMITTED', txHash: `L1HASH_${runTag}`, blockHeight: 4211, endpoint: ep };
      },
    };

    const relayer = new L1SettlementRelayer({
      store: sovraDb.getSovraStore(),
      riskEngine: riskManagementEngine,
      rpcUrls: ['http://dead-node:26657', 'http://live-val1:26657'],
      transport: mockTransport,
    });
    const res = await relayer.processPendingIntents(true);
    expect(res.committed).toBeGreaterThanOrEqual(1);
    expect(res.refunded).toBeGreaterThanOrEqual(1);
    expect(res.healthyRpcCount).toBe(1);

    const commitRow = rawDb.prepare('SELECT state, l1_block_height FROM financial_settlement_intents WHERE id = ?').get(intentCommitId) as any;
    expect(commitRow.state).toBe('COMMITTED');
    expect(commitRow.l1_block_height).toBe(4211);
    expect((rawDb.prepare('SELECT balance_sov FROM users WHERE did = ?').get(rDid) as any).balance_sov).toBe(30);

    const rejectRow = rawDb.prepare('SELECT state FROM financial_settlement_intents WHERE id = ?').get(intentRejectId) as any;
    expect(rejectRow.state).toBe('FAILED');
    expect((rawDb.prepare('SELECT balance_sov FROM users WHERE did = ?').get(sFailDid) as any).balance_sov).toBeCloseTo(55.02, 4);

    // Zero hardcoded secrets & no shared sqlite mounts across deploy/docker
    const filesToCheck = [
      'docker/docker-compose.decoupled.yml',
      'docker/docker-compose.production.yml',
      'docker/turnserver.conf',
      'deploy/docker-compose.prod.yml',
      'deploy/coturn/turnserver.conf',
      'deploy/kubernetes/sovra-coturn.yaml',
      'deploy/kubernetes/sovra-node.yaml',
      'deploy/terraform/variables.tf',
    ];
    const forbiddenLiterals = [
      'sovra_cluster_secret_production_2026_prod',
      'sovra-prod-turn-secret-change-before-apply',
      'sovra-production-admin-secret-key-32chars!',
      'sovra-dev-turn-secret-change-in-prod-replace-with-env!',
      'change-this-in-terraform-tfvars-before-apply',
    ];
    for (const rel of filesToCheck) {
      const content = fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf8');
      for (const literal of forbiddenLiterals) {
        expect(content, `${rel} must not contain ${literal}`).not.toContain(literal);
      }
    }
    const decoupled = fs.readFileSync(path.resolve(__dirname, '../../docker/docker-compose.decoupled.yml'), 'utf8');
    expect(decoupled).not.toContain('sovra-storage-shared');
    expect(decoupled).toContain('postgres:16-alpine');
    expect(decoupled).toContain('redis:7-alpine');
  });

  it('Pillar 3: Enforces Stripe/RazorpayX fail-closed payouts, KYC tier caps, HMAC webhook refund state machine & APNs retry/JWT cache', async () => {
    const tag = crypto.randomBytes(4).toString('hex');
    const userDid = `did:sov:fiat_user_${tag}`;
    const adminDid = `did:sov:compliance_${tag}`;
    const nowUser = Date.now();
    const rawUserDb = (sovraDb as any).getSqliteEngine().getRawDb();
    rawUserDb.prepare('INSERT OR REPLACE INTO users (did, handle, display_name, avatar, avatar_bg, balance_sov, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(userDid, `@fiat_${tag}`, 'Fiat User', 'FU', '#112233', 12000, nowUser, nowUser);
    (sovraDb as any).db.users.push({ did: userDid, id: userDid, handle: `@fiat_${tag}`, displayName: 'Fiat User', balanceSov: 12000, balance_sov: 12000 });

    // 1. Live banking mode without credentials fails closed 503 BEFORE KYC/debit when unconfigured or blocked at KYC 403
    process.env.FIAT_PAYOUT_PROVIDER_ENABLED = 'true';
    process.env.FIAT_PAYOUT_PROVIDER = 'razorpayx';
    delete process.env.RAZORPAYX_KEY_ID;
    delete process.env.RAZORPAYX_KEY_SECRET;
    delete process.env.RAZORPAYX_ACCOUNT_NUMBER;

    // Tier 0 user MUST be rejected with 403 KYC_TIER_REQUIRED
    const wdTier0 = createMockReqRes('POST', '/api/wallet/fiat/withdraw', {}, JSON.stringify({ amountSov: 100, targetAddress: 'u@upi' }));
    await handleWalletRoutes({
      req: wdTier0.req,
      res: wdTier0.res,
      url: new URL('http://localhost:3001/api/wallet/fiat/withdraw'),
      readBoundedBody: async () => ({ body: JSON.stringify({ amountSov: 100, targetAddress: 'u@upi' }), ok: true }),
      resolvePrincipal: () => ({ did: userDid, handle: `@fiat_${tag}`, role: 'USER' } as any),
      enforceAuth: () => ({ did: userDid, handle: `@fiat_${tag}`, role: 'USER' } as any),
    });
    expect(wdTier0.getResponse().statusCode).toBe(403);
    expect(wdTier0.getResponse().json().code).toBe('KYC_TIER_REQUIRED');

    // Non-admin blocked from /api/admin/kyc/verify
    const kycUnauth = createMockReqRes('POST', '/api/admin/kyc/verify');
    await handleWalletRoutes({
      req: kycUnauth.req,
      res: kycUnauth.res,
      url: new URL('http://localhost:3001/api/admin/kyc/verify'),
      readBoundedBody: async () => ({ body: JSON.stringify({ did: userDid, tier: 1 }), ok: true }),
      resolvePrincipal: () => ({ did: userDid, handle: `@fiat_${tag}`, role: 'USER' } as any),
      enforceAuth: () => ({ did: userDid, handle: `@fiat_${tag}`, role: 'USER' } as any),
    });
    expect(kycUnauth.getResponse().statusCode).toBe(403);

    // Compliance Admin approves Tier 1 KYC (limit 5000 SOV/day payout)
    const kycAdmin = createMockReqRes('POST', '/api/admin/kyc/verify');
    await handleWalletRoutes({
      req: kycAdmin.req,
      res: kycAdmin.res,
      url: new URL('http://localhost:3001/api/admin/kyc/verify'),
      readBoundedBody: async () => ({ body: JSON.stringify({ did: userDid, tier: 1, approve: true }), ok: true }),
      resolvePrincipal: () => ({ did: adminDid, handle: '@compliance', role: 'ADMIN' } as any),
      enforceAuth: () => ({ did: adminDid, handle: '@compliance', role: 'ADMIN' } as any),
    });
    expect(kycAdmin.getResponse().statusCode).toBe(200);
    expect(kycAdmin.getResponse().json().limits.dailyFiatPayoutMaxSov).toBe(KYC_TIER_LIMITS[1].dailyFiatPayoutMaxSov);

    // Missing provider API credentials -> 503 ERR_FIAT_CREDENTIALS_MISSING (fail closed, balance intact!)
    const wdMissingKey = createMockReqRes('POST', '/api/wallet/fiat/withdraw');
    await handleWalletRoutes({
      req: wdMissingKey.req,
      res: wdMissingKey.res,
      url: new URL('http://localhost:3001/api/wallet/fiat/withdraw'),
      readBoundedBody: async () => ({ body: JSON.stringify({ amountSov: 100, targetAddress: 'fa_123' }), ok: true }),
      resolvePrincipal: () => ({ did: userDid, handle: `@fiat_${tag}`, role: 'USER' } as any),
      enforceAuth: () => ({ did: userDid, handle: `@fiat_${tag}`, role: 'USER' } as any),
    });
    expect(wdMissingKey.getResponse().statusCode).toBe(503);
    expect(wdMissingKey.getResponse().json().code).toBe('ERR_FIAT_CREDENTIALS_MISSING');
    expect(sovraDb.findUserByDid(userDid)?.balanceSov).toBe(12000);

    // Configure RazorpayX keys + inject mock fetch returning queued payout
    process.env.RAZORPAYX_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAYX_KEY_SECRET = 'rzp_test_secret';
    process.env.RAZORPAYX_ACCOUNT_NUMBER = '232323000111222';
    process.env.RAZORPAYX_WEBHOOK_SECRET = 'rzp_webhook_secret_32chars_valid';

    const wdLive = createMockReqRes('POST', '/api/wallet/fiat/withdraw');
    await handleWalletRoutes({
      req: wdLive.req,
      res: wdLive.res,
      url: new URL('http://localhost:3001/api/wallet/fiat/withdraw'),
      readBoundedBody: async () => ({ body: JSON.stringify({ amountSov: 200, payoutTarget: 'IMPS', targetAddress: 'fa_real_1' }), ok: true }),
      resolvePrincipal: () => ({ did: userDid, handle: `@fiat_${tag}`, role: 'USER' } as any),
      enforceAuth: () => ({ did: userDid, handle: `@fiat_${tag}`, role: 'USER' } as any),
      fetchFn: async () => new Response(JSON.stringify({ id: `pout_${tag}`, status: 'processing' }), { status: 200 }),
    });
    expect(wdLive.getResponse().statusCode).toBe(200);
    const liveData = wdLive.getResponse().json();
    expect(liveData.status).toBe('PENDING_BANK_PAYOUT');
    expect(liveData.payoutProvider).toBe('razorpayx');
    expect(sovraDb.findUserByDid(userDid)?.balanceSov).toBe(11800);

    // Exceeding Tier 1 24h cap (5000 SOV) fails closed 403 KYC_TIER_LIMIT_EXCEEDED
    const wdCap = createMockReqRes('POST', '/api/wallet/fiat/withdraw');
    await handleWalletRoutes({
      req: wdCap.req,
      res: wdCap.res,
      url: new URL('http://localhost:3001/api/wallet/fiat/withdraw'),
      readBoundedBody: async () => ({ body: JSON.stringify({ amountSov: 4900, targetAddress: 'fa_real_1' }), ok: true }),
      resolvePrincipal: () => ({ did: userDid, handle: `@fiat_${tag}`, role: 'USER' } as any),
      enforceAuth: () => ({ did: userDid, handle: `@fiat_${tag}`, role: 'USER' } as any),
    });
    expect(wdCap.getResponse().statusCode).toBe(403);
    expect(wdCap.getResponse().json().code).toBe('KYC_TIER_LIMIT_EXCEEDED');

    // Forged RazorpayX webhook rejected 401
    const badWhBody = JSON.stringify({ event: 'payout.failed', payload: { payout: { entity: { reference_id: liveData.payoutReceiptId } } } });
    const badWh = createMockReqRes('POST', '/api/wallet/fiat/payout-webhook?provider=razorpayx', { 'x-razorpay-signature': 'deadbeef' }, badWhBody);
    await handleWalletRoutes({
      req: badWh.req,
      res: badWh.res,
      url: new URL('http://localhost:3001/api/wallet/fiat/payout-webhook?provider=razorpayx'),
      readBoundedBody: async () => ({ body: badWhBody, ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    });
    expect(badWh.getResponse().statusCode).toBe(401);

    // Valid HMAC payout.failed webhook atomically refunds 200 SOV
    const goodSig = crypto.createHmac('sha256', process.env.RAZORPAYX_WEBHOOK_SECRET!).update(badWhBody).digest('hex');
    const goodWh = createMockReqRes('POST', '/api/wallet/fiat/payout-webhook?provider=razorpayx', { 'x-razorpay-signature': goodSig }, badWhBody);
    await handleWalletRoutes({
      req: goodWh.req,
      res: goodWh.res,
      url: new URL('http://localhost:3001/api/wallet/fiat/payout-webhook?provider=razorpayx'),
      readBoundedBody: async () => ({ body: badWhBody, ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    });
    expect(goodWh.getResponse().statusCode).toBe(200);
    expect(goodWh.getResponse().json().status).toBe('FAILED_REFUNDED');
    expect(sovraDb.findUserByDid(userDid)?.balanceSov).toBe(12000);

    // Stripe HMAC signature + replay timestamp check
    const stripe = new StripePayoutAdapter({ secretKey: 'sk_test_1', webhookSecret: 'whsec_test_1' });
    const stripeBody = JSON.stringify({ type: 'payout.paid', data: { object: { id: 'po_1', metadata: { sovra_payout_id: 'p1' } } } });
    const staleTs = Math.floor(Date.now() / 1000) - 900;
    const staleSig = crypto.createHmac('sha256', 'whsec_test_1').update(`${staleTs}.${stripeBody}`).digest('hex');
    expect(stripe.verifyWebhookSignature(stripeBody, { 'stripe-signature': `t=${staleTs},v1=${staleSig}` }).valid).toBe(false);
    const freshTs = Math.floor(Date.now() / 1000);
    const freshSig = crypto.createHmac('sha256', 'whsec_test_1').update(`${freshTs}.${stripeBody}`).digest('hex');
    expect(stripe.verifyWebhookSignature(stripeBody, { 'stripe-signature': `t=${freshTs},v1=${freshSig}` }).event?.outcome).toBe('SETTLED');

    // APNs HTTP/2 retry & cached ES256 JWT verification against live h2c server
    clearApnsJwtCacheForTest();
    let apnsCallCount = 0;
    const h2Server = http2.createServer((req, res) => {
      apnsCallCount++;
      if (apnsCallCount === 1) {
        res.writeHead(503);
        res.end('transient');
        return;
      }
      res.writeHead(200, { 'apns-id': 'apns-msg-ok-1' });
      res.end('');
    });
    await new Promise<void>((resolve) => h2Server.listen(0, '127.0.0.1', () => resolve()));
    const h2Port = (h2Server.address() as any).port;
    const { privateKey: apnsPriv } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const prevKeyId = process.env.APNS_KEY_ID;
    const prevTeam = process.env.APNS_TEAM_ID;
    const prevPem = process.env.APNS_PRIVATE_KEY;
    const prevEp = process.env.APNS_ENDPOINT;
    try {
      process.env.APNS_KEY_ID = 'KEY123';
      process.env.APNS_TEAM_ID = 'TEAM456';
      process.env.APNS_PRIVATE_KEY = String(apnsPriv.export({ type: 'pkcs8', format: 'pem' }));
      process.env.APNS_ENDPOINT = `http://127.0.0.1:${h2Port}`;
      const apnsMock = createMockReqRes(
        'POST',
        '/api/push/apns/dispatch-wakeup',
        { 'content-type': 'application/json' },
        JSON.stringify({ deviceToken: 'devtok_abc', payload: { aps: { 'content-available': 1 } } }),
      );
      await handleEnterpriseProtocolRoutes(apnsMock.req, apnsMock.res);
      expect(apnsMock.getResponse().statusCode).toBe(200);
      expect(apnsMock.getResponse().json().attempts).toBe(2);
      expect(apnsMock.getResponse().json().jwtCached).toBe(true);
    } finally {
      h2Server.close();
      if (prevKeyId === undefined) delete process.env.APNS_KEY_ID; else process.env.APNS_KEY_ID = prevKeyId;
      if (prevTeam === undefined) delete process.env.APNS_TEAM_ID; else process.env.APNS_TEAM_ID = prevTeam;
      if (prevPem === undefined) delete process.env.APNS_PRIVATE_KEY; else process.env.APNS_PRIVATE_KEY = prevPem;
      if (prevEp === undefined) delete process.env.APNS_ENDPOINT; else process.env.APNS_ENDPOINT = prevEp;
    }
  });

  it('Pillar 4: 100 concurrent SovraStore atomic transfers preserve conservation of value + /api/metrics exposes Risk & PG telemetry', async () => {
    const pgPool = new InMemoryMockPgPool();
    pgPool.seedUser('did:sov:cc_sender', 1000);
    pgPool.seedUser('did:sov:cc_recip', 0);
    const store = new SovraStore({ pgPool, databaseUrl: 'postgres://sovra:pw@localhost:5432/sovra' });

    const ops = Array.from({ length: 100 }, (_, i) =>
      store.executeTransferAtomic({
        fromDid: 'did:sov:cc_sender',
        toDid: 'did:sov:cc_recip',
        amountSov: 1,
        feeSov: 0,
        idempotencyKey: `cc_${i}`,
      }),
    );
    const results = await Promise.all(ops);
    const succeeded = results.filter((r) => r.ok).length;
    expect(succeeded).toBe(100);
    expect(pgPool.users.get('did:sov:cc_sender')!.balance_sov + pgPool.users.get('did:sov:cc_recip')!.balance_sov).toBe(1000);

    const mReq = createMockReqRes('GET', '/api/metrics');
    await handleEnterpriseProtocolRoutes(mReq.req, mReq.res);
    expect(mReq.getResponse().statusCode).toBe(200);
    expect(mReq.getResponse().text).toContain('sovra_settlement_pending_intents');
    expect(mReq.getResponse().text).toContain('sovra_risk_net_pnl_sov');
  });
});
