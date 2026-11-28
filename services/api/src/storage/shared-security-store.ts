import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import IORedis from 'ioredis';

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: any[]): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  pttl(key: string): Promise<number>;
  ping(): Promise<string>;
  publish?(channel: string, message: string): Promise<number>;
  quit?(): Promise<any>;
  disconnect?(): void;
}

export interface SharedSecurityStoreOptions {
  dbPath?: string;
  busyTimeoutMs?: number;
  redisUrl?: string;
  redisClient?: RedisLike;
  keyPrefix?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  count: number;
}

function createRedisClient(redisUrl: string): RedisLike {
  const RedisCtor = (IORedis as any).default || IORedis;
  return new RedisCtor(redisUrl, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: true,
  });
}

export class SharedSecurityStore {
  private db: DatabaseSync | null = null;
  private dbPath: string;
  private isOutageSimulated = false;
  private redisClient: RedisLike | null = null;
  private ownsRedisClient = false;
  private readonly redisUrl: string | undefined;
  private readonly keyPrefix: string;

  constructor(options: SharedSecurityStoreOptions = {}) {
    this.dbPath = options.dbPath || process.env.SOVRA_SHARED_SECURITY_DB || ':memory:';
    this.keyPrefix = options.keyPrefix || 'sovra:sec:';
    this.redisUrl = options.redisUrl ?? process.env.REDIS_URL;

    if (options.redisClient) {
      this.redisClient = options.redisClient;
      this.ownsRedisClient = false;
    } else if (this.redisUrl && this.redisUrl.trim().length > 0) {
      this.redisClient = createRedisClient(this.redisUrl.trim());
      this.ownsRedisClient = true;
    }

    this.initDatabase(options.busyTimeoutMs ?? 5000);
  }

  private initDatabase(busyTimeoutMs: number): void {
    if (this.dbPath !== ':memory:') {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`PRAGMA busy_timeout = ${Math.max(1000, busyTimeoutMs)};`);
    if (this.dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS replay_cache (
        nonce_key TEXT PRIMARY KEY,
        seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_replay_expires ON replay_cache(expires_at);

      CREATE TABLE IF NOT EXISTS rate_limits (
        ip_key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        window_reset_at INTEGER NOT NULL
      );
    `);
  }

  public isRedisConfigured(): boolean {
    return Boolean(this.redisClient);
  }

  public simulateOutage(active: boolean): void {
    this.isOutageSimulated = active;
  }

  public async healthCheck(): Promise<{
    ok: boolean;
    backend: 'redis+sqlite' | 'sqlite';
    redisHealthy: boolean;
    sqliteHealthy: boolean;
    error?: string;
  }> {
    if (this.isOutageSimulated) {
      return {
        ok: false,
        backend: this.redisClient ? 'redis+sqlite' : 'sqlite',
        redisHealthy: false,
        sqliteHealthy: false,
        error: 'Simulated SharedSecurityStore outage',
      };
    }

    let sqliteHealthy = false;
    try {
      if (this.db) {
        this.db.prepare('SELECT 1 AS ok').get();
        sqliteHealthy = true;
      }
    } catch {
      sqliteHealthy = false;
    }

    if (!this.redisClient) {
      return {
        ok: sqliteHealthy,
        backend: 'sqlite',
        redisHealthy: false,
        sqliteHealthy,
        ...(!sqliteHealthy ? { error: 'SQLite security store unavailable' } : {}),
      };
    }

    try {
      const pong = await this.redisClient.ping();
      const redisHealthy = String(pong).toUpperCase().includes('PONG');
      return {
        ok: redisHealthy && sqliteHealthy,
        backend: 'redis+sqlite',
        redisHealthy,
        sqliteHealthy,
        ...(!redisHealthy ? { error: `Unexpected Redis PING response: ${pong}` } : {}),
      };
    } catch (err: any) {
      return {
        ok: false,
        backend: 'redis+sqlite',
        redisHealthy: false,
        sqliteHealthy,
        error: err?.message || 'Redis health check failed',
      };
    }
  }

  /**
   * Atomically records a nonce or signature key synchronously (SQLite WAL + background Redis mirror).
   * Returns true if fresh (accepted), false if duplicate/replayed.
   */
  public consumeNonce(key: string, seenAt: number, expiresAt: number): boolean {
    if (this.isOutageSimulated || !this.db) {
      throw new Error('SharedSecurityStore is unavailable (outage or closed)');
    }

    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM replay_cache WHERE nonce_key = ? AND expires_at < ?').run(key, now);
      const existing = this.db.prepare('SELECT nonce_key FROM replay_cache WHERE nonce_key = ?').get(key);
      if (existing) {
        this.db.exec('ROLLBACK');
        return false;
      }

      this.db
        .prepare('INSERT INTO replay_cache (nonce_key, seen_at, expires_at) VALUES (?, ?, ?)')
        .run(key, seenAt, expiresAt);

      this.db.exec('COMMIT');

      if (this.redisClient) {
        const ttlMs = Math.max(1000, expiresAt - now);
        this.redisClient
          .set(`${this.keyPrefix}nonce:${key}`, String(seenAt), 'PX', ttlMs, 'NX')
          .catch(() => {});
      }

      return true;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch (_) {}
      throw err;
    }
  }

  /**
   * Distributed cluster-safe nonce deduplication across API replicas using Redis SET NX PX,
   * falling back to SQLite WAL when REDIS_URL is not configured.
   */
  public async consumeNonceAsync(key: string, seenAt: number, expiresAt: number): Promise<boolean> {
    if (this.isOutageSimulated || !this.db) {
      throw new Error('SharedSecurityStore is unavailable (outage or closed)');
    }

    const now = Date.now();
    const ttlMs = Math.max(1000, expiresAt - now);

    if (this.redisClient) {
      const redisKey = `${this.keyPrefix}nonce:${key}`;
      const setRes = await this.redisClient.set(redisKey, String(seenAt), 'PX', ttlMs, 'NX');
      if (setRes !== 'OK') {
        return false;
      }
      // Best-effort local SQLite sync record for single-process diagnostics
      try {
        this.db
          .prepare('INSERT OR REPLACE INTO replay_cache (nonce_key, seen_at, expires_at) VALUES (?, ?, ?)')
          .run(key, seenAt, expiresAt);
      } catch (_) {}
      return true;
    }

    return this.consumeNonce(key, seenAt, expiresAt);
  }

  public hasNonce(key: string, now = Date.now()): boolean {
    if (this.isOutageSimulated || !this.db) {
      throw new Error('SharedSecurityStore is unavailable');
    }
    const row = this.db
      .prepare('SELECT expires_at FROM replay_cache WHERE nonce_key = ?')
      .get(key) as { expires_at: number } | undefined;
    if (!row) return false;
    return row.expires_at >= now;
  }

  public pruneExpiredNonces(now = Date.now()): number {
    if (this.isOutageSimulated || !this.db) {
      throw new Error('SharedSecurityStore is unavailable');
    }
    const res = this.db.prepare('DELETE FROM replay_cache WHERE expires_at < ?').run(now);
    return Number(res.changes || 0);
  }

  public consumeRateLimit(
    ip: string,
    maxRequests: number,
    windowMs: number,
    now = Date.now(),
  ): RateLimitResult {
    if (this.isOutageSimulated || !this.db) {
      throw new Error('SharedSecurityStore rate limiter unavailable (outage or closed)');
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db
        .prepare('SELECT count, window_reset_at FROM rate_limits WHERE ip_key = ?')
        .get(ip) as { count: number; window_reset_at: number } | undefined;

      let count = 1;
      let resetAt = now + windowMs;

      if (existing && now <= existing.window_reset_at) {
        count = existing.count + 1;
        resetAt = existing.window_reset_at;
        this.db.prepare('UPDATE rate_limits SET count = ? WHERE ip_key = ?').run(count, ip);
      } else {
        this.db
          .prepare('INSERT OR REPLACE INTO rate_limits (ip_key, count, window_reset_at) VALUES (?, ?, ?)')
          .run(ip, count, resetAt);
      }

      this.db.exec('COMMIT');

      const allowed = count <= maxRequests;
      const remaining = Math.max(0, maxRequests - count);
      return { allowed, remaining, resetAt, count };
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch (_) {}
      throw err;
    }
  }

  public async consumeRateLimitAsync(
    ip: string,
    maxRequests: number,
    windowMs: number,
    now = Date.now(),
  ): Promise<RateLimitResult> {
    if (this.isOutageSimulated || !this.db) {
      throw new Error('SharedSecurityStore rate limiter unavailable (outage or closed)');
    }

    if (this.redisClient) {
      const rlKey = `${this.keyPrefix}rl:${ip}`;
      const count = await this.redisClient.incr(rlKey);
      let ttlMs = await this.redisClient.pttl(rlKey);
      if (count === 1 || ttlMs <= 0) {
        await this.redisClient.pexpire(rlKey, windowMs);
        ttlMs = windowMs;
      }
      const allowed = count <= maxRequests;
      const remaining = Math.max(0, maxRequests - count);
      return {
        allowed,
        remaining,
        resetAt: now + Math.max(0, ttlMs),
        count,
      };
    }

    return this.consumeRateLimit(ip, maxRequests, windowMs, now);
  }

  public async publishCacheInvalidation(namespace: string, key: string): Promise<boolean> {
    if (this.isOutageSimulated || !this.redisClient?.publish) {
      return false;
    }
    try {
      await this.redisClient.publish(
        `${this.keyPrefix}cache:invalidate`,
        JSON.stringify({ namespace, key, timestamp: Date.now() }),
      );
      return true;
    } catch {
      return false;
    }
  }

  public resetRateLimits(): void {
    if (this.db) {
      this.db.exec('DELETE FROM rate_limits;');
    }
  }

  public clear(): void {
    if (this.db) {
      this.db.exec('DELETE FROM replay_cache; DELETE FROM rate_limits;');
    }
  }

  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    if (this.redisClient && this.ownsRedisClient) {
      try {
        this.redisClient.disconnect?.();
      } catch (_) {}
    }
  }

  public async closeAsync(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    if (this.redisClient && this.ownsRedisClient) {
      try {
        await this.redisClient.quit?.();
      } catch (_) {
        try {
          this.redisClient.disconnect?.();
        } catch (_) {}
      }
      this.redisClient = null;
    }
  }

  public reopen(busyTimeoutMs = 5000): void {
    if (!this.db) {
      this.initDatabase(busyTimeoutMs);
    }
  }
}

export const defaultSharedSecurityStore = new SharedSecurityStore();
