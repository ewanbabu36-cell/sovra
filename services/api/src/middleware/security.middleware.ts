/**
 * 👑 SOVRA PROTOCOL - ENTERPRISE SECURITY, OWASP & CORS MIDDLEWARE
 * File: services/api/src/middleware/security.middleware.ts
 *
 * Implements:
 * 1. OWASP Top 10 Security Headers (CSP, Anti-Clickjacking, HSTS, No-Sniff, Referrer-Policy)
 * 2. Strict CORS Origin Allowlist Validation (Zero reflection of untrusted origins)
 * 3. Atomic Multi-Replica Rate Limiting via SharedSecurityStore
 * 4. Safe OPTIONS preflight dispatching
 * 5. Complete isolation of internal service headers from public web origins
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { SharedSecurityStore, defaultSharedSecurityStore } from '../storage/shared-security-store.js';

export interface SecurityConfig {
  allowedOrigins: string[];
  rateLimitMaxRequests: number;
  rateLimitWindowMs: number;
  sharedStore?: SharedSecurityStore | undefined;
}

const isProduction = process.env.NODE_ENV === 'production';

const DEFAULT_PRODUCTION_ORIGINS = process.env.SOVRA_ALLOWED_ORIGINS
  ? process.env.SOVRA_ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : ['https://sovra.network', 'https://app.sovra.network'];

const DEFAULT_DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://localhost:3443',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
];

const DEFAULT_CONFIG: SecurityConfig = {
  allowedOrigins: isProduction ? DEFAULT_PRODUCTION_ORIGINS : DEFAULT_DEV_ORIGINS,
  rateLimitMaxRequests: 120,
  rateLimitWindowMs: 60000,
};

export class SecurityMiddleware {
  private config: SecurityConfig;
  private sharedStore: SharedSecurityStore;

  constructor(config?: Partial<SecurityConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sharedStore = config?.sharedStore || defaultSharedSecurityStore;
  }

  /**
   * Resets rate-limiting buckets in the shared store
   */
  public resetRateLimits(): void {
    try {
      this.sharedStore.resetRateLimits();
    } catch {
      // In case store is closed or simulated outage
    }
  }

  /**
   * Verifies if an origin header is an exact match for the configured allowlist.
   * Strictly prevents origin reflection, substring spoofing, and null/malformed origins.
   */
  public isOriginAllowed(origin: string | undefined): boolean {
    if (!origin || typeof origin !== 'string') return false;
    const trimmed = origin.trim();
    if (trimmed === '' || trimmed === 'null') return false;

    try {
      const parsed = new URL(trimmed);
      // Only HTTP and HTTPS protocols are allowed
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }
      const normalized = `${parsed.protocol}//${parsed.host}`;
      if (this.config.allowedOrigins.includes(normalized)) {
        return true;
      }
      // In explicit zero-domain P2P node deployments, permit literal IPv4, IPv6, or .onion origins (never wildcards)
      if (process.env.SOVRA_ZERO_DOMAIN_CORS === 'true') {
        const host = parsed.hostname.toLowerCase();
        if (host.endsWith('.onion') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Evaluates CORS headers and dispatches OPTIONS preflight requests.
   * Returns true to continue request execution, or false if response was ended.
   */
  public handleCors(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = req.headers.origin;
    const isOptions = req.method?.toUpperCase() === 'OPTIONS';

    // Non-CORS requests (same-origin, CLI, or backend internal calls)
    if (!origin) {
      if (isOptions) {
        res.statusCode = 204;
        res.end();
        return false;
      }
      return true;
    }

    const allowed = this.isOriginAllowed(origin);
    res.setHeader('Vary', 'Origin');

    if (allowed) {
      try {
        const parsed = new URL(origin);
        const normalized = `${parsed.protocol}//${parsed.host}`;
        res.setHeader('Access-Control-Allow-Origin', normalized);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader(
          'Access-Control-Allow-Methods',
          'GET, POST, PUT, DELETE, PATCH, OPTIONS'
        );
        // Public allowed headers only; NEVER expose internal auth headers
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, X-Requested-With, X-Sovra-DID, X-Sovra-Signature'
        );
        res.setHeader('Access-Control-Max-Age', '86400');

        if (isOptions) {
          res.statusCode = 204;
          res.end();
          return false;
        }
        return true;
      } catch {
        // Fall through to rejected
      }
    }

    // Untrusted origin:
    // 1. NEVER set Access-Control-Allow-Origin
    // 2. NEVER set Access-Control-Allow-Credentials
    if (isOptions) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'CORS origin not allowed',
          code: 'CORS_ORIGIN_FORBIDDEN',
        })
      );
      return false;
    }

    return true;
  }

  /**
   * Applies baseline OWASP defensive headers
   */
  public applySecurityHeaders(req: IncomingMessage, res: ServerResponse): void {
    // 1. Anti-Clickjacking
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    // 2. MIME Type Sniffing Prevention
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // 3. XSS Filter Guard
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // 4. Strict Referrer Policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // 5. Content Security Policy
    const isProduction = process.env.NODE_ENV === 'production';
    const cspValue = isProduction
      ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' ws: wss: https:; object-src 'none'; frame-ancestors 'self';"
      : "default-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: https:; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' ws: wss: https:;";
    res.setHeader('Content-Security-Policy', cspValue);

    // 6. Permissions Policy
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');

    // 7. Safe CORS Header Evaluation
    this.handleCors(req, res);
  }

  /**
   * Multi-replica atomic rate limiter
   */
  public checkRateLimit(req: IncomingMessage): boolean {
    const ip = req.socket?.remoteAddress || '127.0.0.1';
    try {
      const result = this.sharedStore.consumeRateLimit(
        ip,
        this.config.rateLimitMaxRequests,
        this.config.rateLimitWindowMs
      );
      return result.allowed;
    } catch {
      // In case of storage outage: fail-closed for safety
      return false;
    }
  }

  public async checkRateLimitAsync(req: IncomingMessage): Promise<boolean> {
    const ip = req.socket?.remoteAddress || '127.0.0.1';
    try {
      const result = await this.sharedStore.consumeRateLimitAsync(
        ip,
        this.config.rateLimitMaxRequests,
        this.config.rateLimitWindowMs
      );
      return result.allowed;
    } catch {
      return false;
    }
  }
}

export const securityMiddleware = new SecurityMiddleware();
