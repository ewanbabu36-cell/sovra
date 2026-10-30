/**
 * 👑 SOVRA PROTOCOL - MODULAR API ROUTE DISPATCHER
 * File: services/api/src/routes/index.ts
 *
 * Central dispatcher connecting incoming HTTP paths to modular controllers.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { authController } from '../controllers/auth.controller.ts';
import { walletController } from '../controllers/wallet.controller.ts';
import { telemetryController } from '../controllers/telemetry.controller.ts';
import { securityMiddleware } from '../middleware/security.middleware.ts';

export async function dispatchApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<boolean> {
  // Apply enterprise OWASP security headers
  securityMiddleware.applySecurityHeaders(req, res);

  // Rate limiting check
  if (!securityMiddleware.checkRateLimit(req)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Too Many Requests' }));
    return true;
  }

  // Pre-flight OPTIONS check
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  // 1. Auth & Identity Routes
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    await authController.handleRegister(req, res);
    return true;
  }
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    await authController.handleLogin(req, res);
    return true;
  }
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    authController.handleLogout(req, res);
    return true;
  }
  if (pathname === '/api/user/me' && req.method === 'GET') {
    authController.handleGetMe(req, res);
    return true;
  }

  // 2. Wallet & Sovereign Vault Routes
  if (pathname === '/api/wallet/balance' && req.method === 'GET') {
    walletController.handleGetBalance(req, res);
    return true;
  }
  if (pathname === '/api/wallet/transfer' && req.method === 'POST') {
    await walletController.handleTransfer(req, res);
    return true;
  }
  if (pathname === '/api/wallet/transactions' && req.method === 'GET') {
    walletController.handleGetTransactions(req, res);
    return true;
  }

  // 3. System Telemetry & Status Routes
  if (pathname === '/api/status' && req.method === 'GET') {
    telemetryController.handleGetStatus(req, res);
    return true;
  }
  if (pathname === '/api/alerts/active' && req.method === 'GET') {
    telemetryController.handleGetAlerts(req, res);
    return true;
  }

  return false; // Not handled by modular dispatcher, fallback to legacy handlers
}
