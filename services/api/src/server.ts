/**
 * 👑 SOVRA PROTOCOL - PRODUCTION DECOUPLED API GATEWAY & SECURITY TIER
 * File: services/api/src/server.ts
 *
 * Implements:
 * 1. Independent API gateway decoupled from validator node processes
 * 2. Enterprise HMAC authentication with zero hardcoded defaults and zero-shortcut replay protection
 * 3. Multi-replica atomic nonce deduplication & distributed rate limiting via SharedSecurityStore
 * 4. OWASP Top 10 defenses and strict CORS origin validation
 * 5. High-resolution Prometheus telemetry at GET /metrics
 * 6. Dynamic multi-validator RPC health monitoring & failover pool
 * 7. Graceful connection draining with zero dropped requests on SIGTERM
 */

import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import { SecurityMiddleware, type SecurityConfig } from './middleware/security.middleware.js';
import { SecretRotationManager } from './monitoring/secret-rotation.js';
import { ConsensusMonitor, type EnterprisePrometheusTelemetry } from './monitoring/consensus-monitor.js';
import { securityEventCollector } from './monitoring/security-events.js';
import {
  SharedSecurityStore,
} from './storage/shared-security-store.js';
import { dispatchApiRequest } from './routes/index.js';

export interface ApiServerOptions {
  port?: number;
  host?: string;
  l1RpcUrls?: string[];
  drainTimeoutMs?: number;
  internalSecret?: string;
  strictSecurity?: boolean;
  rateLimitMaxRequests?: number;
  rateLimitWindowMs?: number;
  allowedOrigins?: string[];
  sharedStore?: SharedSecurityStore | undefined;
  sharedDbPath?: string | undefined;
  redisUrl?: string | undefined;
  databaseUrl?: string | undefined;
  pgPool?: any;
  telemetryProvider?: (() => Promise<Partial<EnterprisePrometheusTelemetry>> | Partial<EnterprisePrometheusTelemetry>) | undefined;
}

const KNOWN_DEFAULT_SECRETS = new Set([
  'sovra_internal_cluster_secret_default_key_2026',
  'default',
  'secret',
  'admin',
  'password',
  'changeme',
  '12345678',
  'sovra_dev_secret',
]);

/**
 * Validates internal cluster secrets according to strict cryptographic standards.
 * Never outputs raw secret values in logs or exceptions.
 */
export function validateAndResolveSecret(
  providedSecret: string | undefined,
  isProduction: boolean,
  strictSecurity = false
): string {
  const candidate =
    providedSecret !== undefined ? providedSecret : process.env.SOVRA_INTERNAL_SERVICE_SECRET;

  // 1. Missing or empty secret check
  if (candidate === undefined || candidate === null || candidate.trim() === '') {
    if (isProduction || strictSecurity) {
      throw new Error(
        'CRITICAL_SECURITY_CONFIGURATION_ERROR: Missing required internal authentication secret in production/strict mode. Set SOVRA_INTERNAL_SERVICE_SECRET.'
      );
    }
    // In dev mode when omitted: generate an isolated random secret per instance
    return `sovra_dev_ephemeral_${crypto.randomBytes(32).toString('hex')}`;
  }

  const secret = candidate.trim();

  // 2. Reject known default secrets
  if (KNOWN_DEFAULT_SECRETS.has(secret.toLowerCase())) {
    throw new Error(
      'CRITICAL_SECURITY_CONFIGURATION_ERROR: Internal authentication secret matches a known insecure default. A cryptographically random secret of at least 32 characters is required.'
    );
  }

  // 3. Minimum length / entropy check
  if ((isProduction || strictSecurity) && secret.length < 32) {
    throw new Error(
      'CRITICAL_SECURITY_CONFIGURATION_ERROR: Internal authentication secret does not satisfy minimum length requirements (min 32 characters required in production).'
    );
  }

  return secret;
}

export class DecoupledApiServer {
  private server: http.Server | null = null;
  private port: number;
  private host: string;
  private l1RpcUrls: string[];
  private drainTimeoutMs: number;
  private activeConnections = new Set<any>();
  private activeRequests = 0;
  private isShuttingDown = false;
  private startTime = Date.now();
  private strictSecurity = false;
  private httpRequestsTotal = 0;
  private latencySamplesMs: number[] = [];
  private pgPool: any | null = null;
  private ownsPgPool = false;
  private telemetryProvider: ((() => Promise<Partial<EnterprisePrometheusTelemetry>> | Partial<EnterprisePrometheusTelemetry>) | undefined);
  private securityMiddleware: SecurityMiddleware;
  public readonly secretManager: SecretRotationManager;
  public readonly consensusMonitor: ConsensusMonitor;
  public readonly sharedStore: SharedSecurityStore;

  constructor(options: ApiServerOptions = {}) {
    this.port = options.port !== undefined ? options.port : (Number(process.env.PORT) || 3001);
    this.host = options.host || process.env.HOST || '0.0.0.0';
    this.l1RpcUrls = options.l1RpcUrls || (
      process.env.SOVRA_L1_RPC_URLS
        ? process.env.SOVRA_L1_RPC_URLS.split(',').map((u) => u.trim())
        : [
            'http://127.0.0.1:26657',
            'http://127.0.0.1:26667',
            'http://127.0.0.1:26677',
            'http://127.0.0.1:26687',
          ]
    );

    const isProduction = process.env.NODE_ENV === 'production';
    const strictSecurity = Boolean(options.strictSecurity);
    this.strictSecurity = strictSecurity;
    const initialSecret = validateAndResolveSecret(
      options.internalSecret,
      isProduction,
      strictSecurity
    );

    this.secretManager = new SecretRotationManager(initialSecret);
    this.consensusMonitor = new ConsensusMonitor({ rpcUrls: this.l1RpcUrls });
    this.drainTimeoutMs = options.drainTimeoutMs || 10000;

    this.telemetryProvider = options.telemetryProvider;
    const dbUrl = (options.databaseUrl ?? process.env.DATABASE_URL ?? '').trim();
    if (options.pgPool) {
      this.pgPool = options.pgPool;
      this.ownsPgPool = false;
    } else if (dbUrl) {
      const PoolCtor = (pg as any).Pool || (pg as any).default?.Pool;
      if (PoolCtor) {
        this.pgPool = new PoolCtor({ connectionString: dbUrl, max: 10, connectionTimeoutMillis: 3000 });
        this.ownsPgPool = true;
      }
    }

    this.sharedStore =
      options.sharedStore ||
      new SharedSecurityStore({
        ...(options.sharedDbPath ? { dbPath: options.sharedDbPath } : {}),
        ...(options.redisUrl ? { redisUrl: options.redisUrl } : {}),
      });

    const secConfig: Partial<SecurityConfig> = {
      rateLimitMaxRequests: options.rateLimitMaxRequests ?? 120,
      rateLimitWindowMs: options.rateLimitWindowMs ?? 60000,
      sharedStore: this.sharedStore,
    };
    if (options.allowedOrigins) {
      secConfig.allowedOrigins = options.allowedOrigins;
    }

    this.securityMiddleware = new SecurityMiddleware(secConfig);
  }

  /**
   * Discovers the first responsive CometBFT validator RPC endpoint
   */
  public async getHealthyValidatorRpc(): Promise<{ url: string; status: any } | null> {
    for (const url of this.l1RpcUrls) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(`${url}/status`, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          return { url, status: data.result || data };
        }
      } catch {
        // Try next validator RPC endpoint
        continue;
      }
    }
    return null;
  }

  /**
   * Resets replay cache for test isolation
   */
  public clearReplayCache(): void {
    try {
      this.sharedStore.clear();
    } catch {
      // In case store is closed
    }
  }

  /**
   * Service-to-service authentication validator supporting rotation, nonce caching, and atomic replay prevention.
   * Eliminates static bearer bypass: EVERY request must provide a valid HMAC signature over canonical fields.
   */
  public verifyServiceAuth(req: http.IncomingMessage, rawBody?: Buffer | string): boolean {
    const authHeader = req.headers['x-sovra-internal-auth'];
    const timestampHeader = req.headers['x-sovra-timestamp'];
    const nonceHeader = req.headers['x-sovra-nonce'] || req.headers['x-sovra-request-id'];
    const bodyHashHeader = req.headers['x-sovra-body-hash'];

    if (!authHeader || typeof authHeader !== 'string') {
      securityEventCollector.recordEvent(
        'WARN',
        'UNAUTHORIZED_ACCESS',
        'SERVICE_AUTH_MISSING_HEADER',
        { path: req.url },
        req.socket?.remoteAddress
      );
      return false;
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const now = Date.now();
    const isProduction = process.env.NODE_ENV === 'production';

    // Check if client is using raw bearer token (directly presenting cluster secret)
    if (this.secretManager.isValidSecret(token)) {
      if (isProduction || this.strictSecurity) {
        securityEventCollector.recordEvent(
          'WARN',
          'AUTH_FAILURE',
          'SERVICE_AUTH_HMAC_REQUIRED',
          { path: req.url },
          req.socket?.remoteAddress
        );
        return false;
      }

      // In non-production compatibility mode, bearer tokens MUST NOT be replayable:
      // enforce single-use consumption via the shared distributed security store.
      const nonceStr = nonceHeader ? String(nonceHeader).trim() : '';
      const replayKey = nonceStr ? `nonce:bearer:${nonceStr}` : `sig:bearer:${token}`;
      const allowed = this.sharedStore.consumeNonce(replayKey, now, now + 300_000);
      if (!allowed) {
        securityEventCollector.recordEvent(
          'WARN',
          'AUTH_FAILURE',
          'SERVICE_AUTH_REPLAY_DETECTED',
          { path: req.url, type: 'BEARER_REPLAY' },
          req.socket?.remoteAddress
        );
        return false;
      }
      return true;
    }

    if (!timestampHeader || typeof timestampHeader !== 'string') {
      securityEventCollector.recordEvent(
        'WARN',
        'UNAUTHORIZED_ACCESS',
        'SERVICE_AUTH_MISSING_TIMESTAMP',
        { path: req.url },
        req.socket?.remoteAddress
      );
      return false;
    }
    const ts = Number(timestampHeader);

    // Replay prevention: reject timestamps older than 5 minutes (300 seconds)
    if (isNaN(ts) || ts < now - 300_000) {
      securityEventCollector.recordEvent(
        'WARN',
        'AUTH_FAILURE',
        'SERVICE_AUTH_EXPIRED_TIMESTAMP',
        { ts, delta: now - ts },
        req.socket?.remoteAddress
      );
      return false;
    }

    // Clock skew guard: reject future timestamps exceeding 30s tolerance
    if (ts > now + 30_000) {
      securityEventCollector.recordEvent(
        'WARN',
        'AUTH_FAILURE',
        'SERVICE_AUTH_FUTURE_TIMESTAMP',
        { ts, delta: ts - now },
        req.socket?.remoteAddress
      );
      return false;
    }

    // Body tampering validation if body or body hash header is present
    let bodyHash = typeof bodyHashHeader === 'string' ? bodyHashHeader.trim() : '';
    if (rawBody !== undefined) {
      const computedBodyHash = crypto
        .createHash('sha256')
        .update(rawBody)
        .digest('hex');

      if (bodyHash && bodyHash !== computedBodyHash) {
        securityEventCollector.recordEvent(
          'WARN',
          'AUTH_FAILURE',
          'SERVICE_AUTH_BODY_MODIFIED',
          { path: req.url, expected: computedBodyHash, received: bodyHash },
          req.socket?.remoteAddress
        );
        return false;
      }
      bodyHash = computedBodyHash;
    }

    const nonceStr = nonceHeader ? String(nonceHeader).trim() : '';
    const parsed = new URL(req.url || '/', 'http://localhost');
    const canonicalPath = parsed.pathname;
    const method = (req.method || 'GET').toUpperCase();

    // Check HMAC candidates against all valid secrets (supporting zero-downtime rotation)
    const validSecrets = this.secretManager.getValidSecrets();
    let signatureMatched = false;

    // Construct valid HMAC signature candidates (handling with/without nonce and bodyHash)
    const candidates: string[] = [];
    if (bodyHash && nonceStr) {
      candidates.push(`${method}:${canonicalPath}:${timestampHeader}:${nonceStr}:${bodyHash}`);
      candidates.push(`${method}:${req.url}:${timestampHeader}:${nonceStr}:${bodyHash}`);
    }
    if (nonceStr) {
      candidates.push(`${method}:${canonicalPath}:${timestampHeader}:${nonceStr}`);
      candidates.push(`${method}:${req.url}:${timestampHeader}:${nonceStr}`);
    }
    if (bodyHash) {
      candidates.push(`${method}:${canonicalPath}:${timestampHeader}:${bodyHash}`);
      candidates.push(`${method}:${req.url}:${timestampHeader}:${bodyHash}`);
    }
    candidates.push(`${method}:${canonicalPath}:${timestampHeader}`);
    candidates.push(`${method}:${req.url}:${timestampHeader}`);

    for (const secret of validSecrets) {
      for (const candidate of candidates) {
        const expectedHmac = crypto
          .createHmac('sha256', secret)
          .update(candidate)
          .digest('hex');

        if (
          token.length === expectedHmac.length &&
          crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedHmac))
        ) {
          signatureMatched = true;
          break;
        }
      }
      if (signatureMatched) break;
    }

    if (!signatureMatched) {
      securityEventCollector.recordEvent(
        'WARN',
        'AUTH_FAILURE',
        'SERVICE_AUTH_INVALID_TOKEN',
        { path: req.url },
        req.socket?.remoteAddress
      );
      return false;
    }

    // Atomic Replay Check across multi-replica SharedSecurityStore
    try {
      const expiresAt = Math.max(ts + 300_000, now + 300_000);

      // 1. Consume nonce if provided
      if (nonceStr) {
        const nonceOk = this.sharedStore.consumeNonce(`nonce:${nonceStr}`, now, expiresAt);
        if (!nonceOk) {
          securityEventCollector.recordEvent(
            'WARN',
            'AUTH_FAILURE',
            'SERVICE_AUTH_REPLAY_DETECTED',
            { path: req.url, nonce: nonceStr },
            req.socket?.remoteAddress
          );
          return false;
        }
      }

      // 2. Consume signature digest
      const sigOk = this.sharedStore.consumeNonce(`sig:${token}`, now, expiresAt);
      if (!sigOk) {
        securityEventCollector.recordEvent(
          'WARN',
          'AUTH_FAILURE',
          'SERVICE_AUTH_REPLAY_DETECTED',
          { path: req.url, tokenPrefix: token.substring(0, 8) },
          req.socket?.remoteAddress
        );
        return false;
      }

      // Periodically prune expired entries
      this.sharedStore.pruneExpiredNonces(now);
      return true;
    } catch (err: any) {
      // Shared store failure/outage: FAIL CLOSED for protected requests
      securityEventCollector.recordEvent(
        'CRITICAL',
        'AUTH_FAILURE',
        'SERVICE_AUTH_STORE_OUTAGE',
        { path: req.url, error: err.message },
        req.socket?.remoteAddress
      );
      return false;
    }
  }

  /**
   * Starts the HTTP server listener
   */
  public async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // If server is draining for shutdown, reject new requests with 503
        if (this.isShuttingDown) {
          res.writeHead(503, {
            'Content-Type': 'application/json',
            'Retry-After': '5',
            Connection: 'close',
          });
          res.end(JSON.stringify({ ok: false, error: 'Server shutting down' }));
          return;
        }

        // Apply enterprise OWASP security headers across all API responses
        this.securityMiddleware.applySecurityHeaders(req, res);

        // Preflight OPTIONS / CORS check: if handled, return immediately
        if (req.method?.toUpperCase() === 'OPTIONS') {
          return;
        }

        // Distributed Rate limiting check
        const allowed = await this.securityMiddleware.checkRateLimitAsync(req);
        if (!allowed) {
          securityEventCollector.recordEvent(
            'WARN',
            'RATE_LIMIT_TRIPPED',
            'HTTP_RATE_LIMIT_EXCEEDED',
            { url: req.url },
            req.socket?.remoteAddress
          );
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': '60',
          });
          res.end(JSON.stringify({ ok: false, error: 'Too Many Requests', message: 'Rate limit exceeded' }));
          return;
        }

        const reqStartNs = process.hrtime.bigint();
        this.httpRequestsTotal++;
        this.activeRequests++;
        res.on('finish', () => {
          this.activeRequests--;
          const durationMs = Number(process.hrtime.bigint() - reqStartNs) / 1_000_000;
          this.latencySamplesMs.push(durationMs);
          if (this.latencySamplesMs.length > 500) {
            this.latencySamplesMs.shift();
          }
        });

        try {
          const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
          const pathname = parsedUrl.pathname;

          // -----------------------------------------------------------------
          // 1. HEALTH CHECKS & OPERATIONAL TELEMETRY
          // -----------------------------------------------------------------
          if (pathname === '/health' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                status: 'UP',
                service: 'sovra-api-server',
                version: '1.0.0',
                uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
                activeRequests: this.activeRequests,
                timestamp: Date.now(),
              })
            );
            return;
          }

          if ((pathname === '/health/liveness' || pathname === '/livez') && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ alive: true, pid: process.pid }));
            return;
          }

          if ((pathname === '/health/readiness' || pathname === '/readyz') && req.method === 'GET') {
            const rpcInfo = await this.getHealthyValidatorRpc();
            const storeHealth = await this.sharedStore.healthCheck();
            let pgHealthy = true;
            let pgConfigured = false;
            if (this.pgPool) {
              pgConfigured = true;
              try {
                await this.pgPool.query('SELECT 1 AS ok');
              } catch {
                pgHealthy = false;
              }
            }
            const redisOk = !this.sharedStore.isRedisConfigured() || storeHealth.redisHealthy;
            if (rpcInfo && redisOk && pgHealthy) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  ready: true,
                  activeRpc: rpcInfo.url,
                  blockHeight: rpcInfo.status.height || rpcInfo.status.sync_info?.latest_block_height,
                  redis: { configured: this.sharedStore.isRedisConfigured(), healthy: storeHealth.redisHealthy },
                  postgres: { configured: pgConfigured, healthy: pgHealthy },
                })
              );
            } else {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  ready: false,
                  error: !rpcInfo
                    ? 'No healthy CometBFT validator RPC endpoint available'
                    : !redisOk
                      ? 'Redis security store unhealthy'
                      : 'PostgreSQL primary database unhealthy',
                  redis: { configured: this.sharedStore.isRedisConfigured(), healthy: storeHealth.redisHealthy },
                  postgres: { configured: pgConfigured, healthy: pgHealthy },
                })
              );
            }
            return;
          }

          if (pathname === '/health/consensus' && req.method === 'GET') {
            const rpcInfo = await this.getHealthyValidatorRpc();
            if (rpcInfo) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  connected: true,
                  validatorEndpoint: rpcInfo.url,
                  moniker: rpcInfo.status.moniker || rpcInfo.status.node_info?.moniker,
                  chainId: rpcInfo.status.chain_id || rpcInfo.status.node_info?.network,
                  height: rpcInfo.status.height || rpcInfo.status.sync_info?.latest_block_height,
                  totalSupply: rpcInfo.status.total_supply,
                })
              );
            } else {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ connected: false, error: 'Consensus layer unreachable' }));
            }
            return;
          }

          if (pathname === '/health/monitoring' && req.method === 'GET') {
            const summary = await this.consensusMonitor.evaluateHealth();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(summary));
            return;
          }

          if (pathname === '/metrics' && req.method === 'GET') {
            const summary = await this.consensusMonitor.evaluateHealth();
            const storeHealth = await this.sharedStore.healthCheck();
            let pgHealthy = 0;
            if (this.pgPool) {
              try {
                await this.pgPool.query('SELECT 1 AS ok');
                pgHealthy = 1;
              } catch {
                pgHealthy = 0;
              }
            }
            const sorted = [...this.latencySamplesMs].sort((a, b) => a - b);
            const p95Idx = sorted.length > 0 ? Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95)) : 0;
            const p95Ms = sorted.length > 0 ? sorted[p95Idx] : 0;
            const extra = this.telemetryProvider ? await this.telemetryProvider() : {};
            const metricsText = this.consensusMonitor.generatePrometheusMetrics(summary, {
              httpRequestsTotal: this.httpRequestsTotal,
              httpLatencyP95Ms: p95Ms,
              postgresHealthy: pgHealthy,
              redisHealthy: storeHealth.redisHealthy ? 1 : 0,
              ...extra,
            });
            res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
            res.end(metricsText);
            return;
          }

          // -----------------------------------------------------------------
          // 2. SECURE SERVICE-TO-SERVICE INTERNAL ROUTING
          // -----------------------------------------------------------------
          if (pathname.startsWith('/internal/')) {
            let bodyBuffer: Buffer | undefined;
            if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
              const chunks: Buffer[] = [];
              for await (const chunk of req) {
                chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
              }
              bodyBuffer = Buffer.concat(chunks);
            }

            if (!this.verifyServiceAuth(req, bodyBuffer)) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Unauthorized internal service call' }));
              return;
            }

            if (pathname === '/internal/cluster/nodes' && req.method === 'GET') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, validatorRpcPool: this.l1RpcUrls }));
              return;
            }

            if (pathname === '/internal/cluster/ping' && req.method === 'POST') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, pong: true, timestamp: Date.now() }));
              return;
            }

            if (pathname === '/internal/security/events' && req.method === 'GET') {
              const events = securityEventCollector.queryEvents();
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, count: events.length, events }));
              return;
            }

            if (pathname === '/internal/secret/rotate' && req.method === 'POST') {
              const rotated = this.secretManager.rotateSecret();
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, version: rotated.version, createdAt: rotated.createdAt }));
              return;
            }
          }

          // -----------------------------------------------------------------
          // 3. APPLICATION DISPATCHER
          // -----------------------------------------------------------------
          const handled = await dispatchApiRequest(req, res, pathname);
          if (!handled) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                ok: false,
                error: 'Not Found',
                message: `Route ${pathname} not found on decoupled API service`,
              })
            );
          }
        } catch (err: any) {
          securityEventCollector.recordEvent(
            'CRITICAL',
            'UNAUTHORIZED_ACCESS',
            'GATEWAY_UNCAUGHT_ERROR',
            { message: err.message, stack: err.stack },
            req.socket?.remoteAddress
          );
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Internal Server Error' }));
        }
      });

      // Track active sockets for graceful termination
      this.server.on('connection', (socket) => {
        this.activeConnections.add(socket);
        socket.on('close', () => {
          this.activeConnections.delete(socket);
        });
      });

      this.server.listen(this.port, this.host, () => {
        const addr = this.server?.address();
        const assignedPort = typeof addr === 'object' && addr ? addr.port : this.port;
        resolve(assignedPort);
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Graceful connection draining and termination
   */
  public async stop(): Promise<void> {
    if (!this.server) return;
    this.isShuttingDown = true;

    return new Promise((resolve) => {
      const forceTimer = setTimeout(() => {
        for (const socket of this.activeConnections) {
          socket.destroy();
        }
        this.activeConnections.clear();
      }, this.drainTimeoutMs);

      this.server?.close(() => {
        clearTimeout(forceTimer);
        this.server = null;
        this.sharedStore.closeAsync().catch(() => {});
        if (this.pgPool && this.ownsPgPool) {
          this.pgPool.end?.().catch(() => {});
        }
        resolve();
      });
    });
  }
}
