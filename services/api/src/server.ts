/**
 * 👑 SOVRA DECOUPLED PRODUCTION API SERVER
 * File: services/api/src/server.ts
 *
 * Standalone, horizontally scalable API microservice.
 * Fully decoupled from CometBFT consensus engine and background workers.
 * Features:
 *  - Native HTTP/REST request routing
 *  - Liveness, Readiness, and Consensus Health Checks
 *  - Secure Service-to-Service Authentication (X-Sovra-Internal-Auth)
 *  - Multi-Validator RPC Failover Driver
 *  - Graceful Shutdown with in-flight request draining and connection closing
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { dispatchApiRequest } from './routes/index.js';
import { securityMiddleware } from './middleware/security.middleware.js';

export interface ApiServerOptions {
  port?: number;
  host?: string;
  l1RpcUrls?: string[];
  internalSecret?: string;
  drainTimeoutMs?: number;
}

export class DecoupledApiServer {
  private server: http.Server | null = null;
  private port: number;
  private host: string;
  private l1RpcUrls: string[];
  private internalSecret: string;
  private drainTimeoutMs: number;
  private activeConnections = new Set<any>();
  private activeRequests = 0;
  private isShuttingDown = false;
  private startTime = Date.now();

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
    this.internalSecret =
      options.internalSecret ||
      process.env.SOVRA_INTERNAL_SERVICE_SECRET ||
      'sovra_internal_cluster_secret_default_key_2026';
    this.drainTimeoutMs = options.drainTimeoutMs || 10000;
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
   * Service-to-service authentication validator
   */
  public verifyServiceAuth(req: http.IncomingMessage): boolean {
    const authHeader = req.headers['x-sovra-internal-auth'];
    const timestampHeader = req.headers['x-sovra-timestamp'];

    if (!authHeader || typeof authHeader !== 'string') {
      return false;
    }

    // Direct bearer token match
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token === this.internalSecret) {
      return true;
    }

    // HMAC signature match if timestamp is provided
    if (timestampHeader && typeof timestampHeader === 'string') {
      const now = Date.now();
      const ts = Number(timestampHeader);
      // Replay prevention: reject timestamps older or ahead by > 5 minutes
      if (isNaN(ts) || Math.abs(now - ts) > 300_000) {
        return false;
      }
      const expectedHmac = crypto
        .createHmac('sha256', this.internalSecret)
        .update(`${req.method}:${req.url}:${timestampHeader}`)
        .digest('hex');

      return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedHmac));
    }

    return false;
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

        this.activeRequests++;
        res.on('finish', () => {
          this.activeRequests--;
        });

        // Apply enterprise OWASP security headers across all API responses
        securityMiddleware.applySecurityHeaders(req, res);

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

          if (pathname === '/health/liveness' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ alive: true, pid: process.pid }));
            return;
          }

          if (pathname === '/health/readiness' && req.method === 'GET') {
            const rpcInfo = await this.getHealthyValidatorRpc();
            if (rpcInfo) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  ready: true,
                  activeRpc: rpcInfo.url,
                  blockHeight: rpcInfo.status.height || rpcInfo.status.sync_info?.latest_block_height,
                })
              );
            } else {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  ready: false,
                  error: 'No healthy CometBFT validator RPC endpoint available',
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

          // -----------------------------------------------------------------
          // 2. SECURE SERVICE-TO-SERVICE INTERNAL ROUTING
          // -----------------------------------------------------------------
          if (pathname.startsWith('/internal/')) {
            if (!this.verifyServiceAuth(req)) {
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
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Internal Server Error', message: err.message }));
          }
        }
      });

      // Track active TCP sockets to enable graceful draining
      this.server.on('connection', (socket) => {
        this.activeConnections.add(socket);
        socket.on('close', () => {
          this.activeConnections.delete(socket);
        });
      });

      this.server.listen(this.port, this.host, () => {
        const address = this.server?.address();
        const actualPort = typeof address === 'object' && address ? address.port : this.port;
        this.port = actualPort;
        resolve(actualPort);
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Graceful shutdown routine: stops accepting new requests, drains in-flight requests,
   * closes open connections, and returns clean promise.
   */
  public async stop(): Promise<void> {
    if (this.isShuttingDown || !this.server) {
      return;
    }
    this.isShuttingDown = true;

    return new Promise((resolve) => {
      // Set shutdown grace timer
      const forceTimer = setTimeout(() => {
        for (const socket of this.activeConnections) {
          socket.destroy();
        }
        resolve();
      }, this.drainTimeoutMs);

      this.server?.close(() => {
        clearTimeout(forceTimer);
        resolve();
      });
    });
  }

  public getPort(): number {
    return this.port;
  }
}

// Direct CLI entrypoint if executed via `node services/api/src/server.ts`
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  const server = new DecoupledApiServer();
  server.start().then((port) => {
    console.log(`[SOVRA Decoupled API] Running on http://localhost:${port}`);
  });

  const handleTermination = async (signal: string) => {
    console.log(`[SOVRA Decoupled API] Received ${signal}, initiating graceful shutdown...`);
    await server.stop();
    console.log(`[SOVRA Decoupled API] Shutdown complete. Exiting.`);
    process.exit(0);
  };

  process.on('SIGTERM', () => handleTermination('SIGTERM'));
  process.on('SIGINT', () => handleTermination('SIGINT'));
}
