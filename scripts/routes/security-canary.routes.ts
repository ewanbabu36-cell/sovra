/**
 * @file scripts/routes/security-canary.routes.ts
 * Sovereign Security Canary, Honeypot Traps & CSP Violation Reporting Controller.
 *
 * Implements:
 * - Honeypot Canary Traps (crawler & exploit neutralizer)
 * - Emergency Nuclear Kill-Switch Gateways (blast-radius isolation)
 * - Cryptographic Anti-Replay Nonce Validation
 * - Strict Sanitized CSP Violation Telemetry
 */

import http from 'node:http';
import { sovraDb } from '../database-engine.ts';

export interface SecurityCanaryRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  checkAndRecordReplayNonce: (nonce: string, timestamp?: string | string[]) => boolean;
  getClientIp: (req: http.IncomingMessage) => string;
  isCspReportRateLimited: (ip: string) => boolean;
  logRedactedCspReport: (reportData: any, clientIp: string) => void;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, limit?: number) => Promise<{ body: string; ok: boolean }>;
}

export async function handleSecurityCanaryRoutes(ctx: SecurityCanaryRouteContext): Promise<boolean> {
  const {
    req,
    res,
    url,
    checkAndRecordReplayNonce,
    getClientIp,
    isCspReportRateLimited,
    logRedactedCspReport,
    readBoundedBody,
  } = ctx;

  // 1. 🍯 HONEYPOT CANARY TRAPS (CRAWLER & EXPLOIT NEUTRALIZER)
  if (url.pathname === '/.env' || url.pathname === '/wp-admin' || url.pathname === '/api/internal/debug-keys' || url.pathname === '/admin/config.json') {
    const clientIp = req.socket?.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown Crawler';
    const sqlite = sovraDb.getSqliteEngine();
    if (sqlite) {
      sqlite.recordHoneypotIntrusion(url.pathname, clientIp, userAgent);
    }
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Access Denied: Sovereign Honeypot Trap Sensor Engaged. Perimeter intrusion logged.' }));
    return true;
  }

  // 2. 🛑 NUCLEAR KILL-SWITCH GATEWAY (BLAST-RADIUS ISOLATION)
  const sqliteEngine = sovraDb.getSqliteEngine();
  if (sqliteEngine) {
    if (sqliteEngine.isKillSwitchActive('GLOBAL_LOCKDOWN_MODE') && !url.pathname.startsWith('/admin') && !url.pathname.startsWith('/api/admin')) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Sovereign Protocol is under emergency administrative lockdown. Standard consumer routing suspended.' }));
      return true;
    }
    if (sqliteEngine.isKillSwitchActive('GLOBAL_WITHDRAWALS_FROZEN') && url.pathname.includes('/withdraw')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Withdrawals temporarily suspended by Admin Nuclear Circuit Breaker.' }));
      return true;
    }
    if (sqliteEngine.isKillSwitchActive('NEW_REGISTRATIONS_FROZEN') && url.pathname.includes('/register')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'New registrations temporarily paused to prevent Sybil swarms.' }));
      return true;
    }
  }

  // 3. Anti-Replay Nonce Validation for cryptographic assertions & high-value mutations
  const nonceHeader = req.headers['x-sovra-nonce'];
  if (nonceHeader && typeof nonceHeader === 'string') {
    const isMutating = ['POST', 'PUT', 'DELETE', 'PATCH'].includes((req.method || 'GET').toUpperCase());
    const isStrictAntiReplayEndpoint = (isMutating && Boolean(
      url.pathname.startsWith('/api/transfer') ||
      url.pathname.startsWith('/api/wallet') ||
      url.pathname.startsWith('/api/voucher') ||
      url.pathname.startsWith('/api/tip') ||
      url.pathname.startsWith('/api/offline-pay') ||
      url.pathname.startsWith('/api/pay') ||
      url.pathname.startsWith('/api/security') ||
      url.pathname.startsWith('/api/auth/webauthn') ||
      url.pathname.startsWith('/api/keys/revoke')
    )) || url.pathname === '/api/feed/personalized';
    const isValidNonce = checkAndRecordReplayNonce(nonceHeader, req.headers['x-sovra-timestamp']);
    if (!isValidNonce && isStrictAntiReplayEndpoint) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Forbidden: Anti-replay protection violation. Nonce already seen or timestamp skew exceeds 300s.' }));
      return true;
    }
  }

  // 4. 🛡️ STRICT CSP VIOLATION TELEMETRY
  if (url.pathname === '/api/security/csp-report' && (req.method === 'POST' || req.method === 'PUT')) {
    const clientIp = getClientIp(req);
    if (isCspReportRateLimited(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
      res.end(JSON.stringify({ ok: false, error: 'Too many reports' }));
      return true;
    }

    const { body, ok } = await readBoundedBody(req, res, 65536);
    if (ok && body) {
      try {
        const parsed = JSON.parse(body);
        logRedactedCspReport(parsed, clientIp);
      } catch (_) {}
    }
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}
