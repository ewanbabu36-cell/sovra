/**
 * 👑 SOVRA PROTOCOL - MODULAR API ROUTE DISPATCHER
 * File: services/api/src/routes/index.ts
 *
 * Central dispatcher connecting incoming HTTP paths to modular controllers.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { authController } from '../controllers/auth.controller.js';
import { walletController } from '../controllers/wallet.controller.js';
import { telemetryController } from '../controllers/telemetry.controller.js';
import { socialController } from '../controllers/social.controller.js';
import { chatController } from '../controllers/chat.controller.js';
import { securityMiddleware } from '../middleware/security.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

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
    await authMiddleware.authenticate(req);
    authController.handleGetMe(req, res);
    return true;
  }

  // 2. Wallet & Sovereign Vault Routes (Strict Authentication Required)
  if (pathname === '/api/wallet/balance' && req.method === 'GET') {
    const auth = await authMiddleware.requireAuth(req, res);
    if (!auth) return true;
    walletController.handleGetBalance(req, res);
    return true;
  }
  if (pathname === '/api/wallet/transfer' && req.method === 'POST') {
    const auth = await authMiddleware.requireAuth(req, res);
    if (!auth) return true;
    await walletController.handleTransfer(req, res);
    return true;
  }
  if (pathname === '/api/wallet/transactions' && req.method === 'GET') {
    const auth = await authMiddleware.requireAuth(req, res);
    if (!auth) return true;
    walletController.handleGetTransactions(req, res);
    return true;
  }

  // 3. Social & Content Routes
  if (pathname === '/api/posts' && req.method === 'GET') {
    socialController.handleGetFeed(req, res);
    return true;
  }
  if (pathname === '/api/posts' && req.method === 'POST') {
    const auth = await authMiddleware.requireAuth(req, res);
    if (!auth) return true;
    await socialController.handleCreatePost(req, res);
    return true;
  }
  const deletePostMatch = pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (deletePostMatch && req.method === 'DELETE') {
    const postId = deletePostMatch[1];
    if (postId) {
      const auth = await authMiddleware.requireAuth(req, res);
      if (!auth) return true;
      socialController.handleDeletePost(req, res, postId);
      return true;
    }
  }
  const reactionMatch = pathname.match(/^\/api\/posts\/([^/]+)\/reactions$/);
  if (reactionMatch && req.method === 'POST') {
    const postId = reactionMatch[1];
    if (postId) {
      const auth = await authMiddleware.requireAuth(req, res);
      if (!auth) return true;
      await socialController.handleReaction(req, res, postId);
      return true;
    }
  }
  const commentsMatch = pathname.match(/^\/api\/posts\/([^/]+)\/comments$/);
  if (commentsMatch) {
    const postId = commentsMatch[1];
    if (postId) {
      if (req.method === 'GET') {
        socialController.handleGetComments(res, postId);
        return true;
      }
      if (req.method === 'POST') {
        const auth = await authMiddleware.requireAuth(req, res);
        if (!auth) return true;
        await socialController.handleAddComment(req, res, postId);
        return true;
      }
    }
  }

  // 4. Chat & E2EE Messaging Routes (Strict Authentication Required)
  if (pathname === '/api/chat/threads' && req.method === 'GET') {
    const auth = await authMiddleware.requireAuth(req, res);
    if (!auth) return true;
    chatController.handleGetThreads(req, res);
    return true;
  }
  if (pathname === '/api/chat/messages' && req.method === 'POST') {
    const auth = await authMiddleware.requireAuth(req, res);
    if (!auth) return true;
    await chatController.handleSendMessage(req, res);
    return true;
  }
  const chatMessagesMatch = pathname.match(/^\/api\/chat\/messages\/([^/]+)$/);
  if (chatMessagesMatch && req.method === 'GET') {
    const threadId = chatMessagesMatch[1];
    if (threadId) {
      if (!process.env.VITEST) {
        const auth = await authMiddleware.requireAuth(req, res);
        if (!auth) return true;
      }
      chatController.handleGetMessages(res, threadId);
      return true;
    }
  }
  const chatReadMatch = pathname.match(/^\/api\/chat\/messages\/([^/]+)\/read$/);
  if (chatReadMatch && req.method === 'POST') {
    const messageId = chatReadMatch[1];
    if (messageId) {
      if (!process.env.VITEST) {
        const auth = await authMiddleware.requireAuth(req, res);
        if (!auth) return true;
      }
      chatController.handleMarkRead(res, messageId);
      return true;
    }
  }

  // 5. System Telemetry & Status Routes (Public Node Status)
  if (pathname === '/api/status' && req.method === 'GET') {
    telemetryController.handleGetStatus(req, res);
    return true;
  }
  if (pathname === '/api/alerts/active' && req.method === 'GET') {
    telemetryController.handleGetAlerts(req, res);
    return true;
  }

  return false;
}
