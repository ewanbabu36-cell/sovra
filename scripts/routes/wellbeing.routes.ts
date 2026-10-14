/**
 * @file scripts/routes/wellbeing.routes.ts
 * Device-Side Screen-Time Controls & Digital Wellbeing Route Controller (Phase 8).
 *
 * Implements privacy-preserving device-side screen-time tracking,
 * daily usage limits (App, Feed, Reels, Explore), quiet hours wind-down schedule,
 * tamper-resistant clock verification, and mindful break challenges.
 */

import http from 'node:http';
import { sovraDb } from '../database-engine.ts';
import type { AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';

export interface WellbeingRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, maxBytes: number) => Promise<{ body: string; ok: boolean }>;
  resolvePrincipal: (req: http.IncomingMessage) => AuthenticatedPrincipal | null;
  enforceAuth: (req: http.IncomingMessage, res: http.ServerResponse) => AuthenticatedPrincipal | null;
}

function resolveUserDid(ctx: WellbeingRouteContext): string {
  const principal = ctx.resolvePrincipal(ctx.req);
  if (principal && principal.did) {
    return principal.did;
  }
  const qDid = ctx.url.searchParams.get('userDid') || ctx.url.searchParams.get('did');
  if (qDid && qDid.trim().length > 0) {
    return qDid.trim();
  }
  return 'did:sovra:device_local';
}

export async function handleWellbeingRoutes(ctx: WellbeingRouteContext): Promise<boolean> {
  const { req, res, url, readBoundedBody } = ctx;

  // 1. GET /api/wellbeing/limits - Get daily limits & quiet hours configuration
  if (url.pathname === '/api/wellbeing/limits' && req.method === 'GET') {
    const userDid = resolveUserDid(ctx);
    const limits = sovraDb.getWellbeingLimits(userDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, limits }));
    return true;
  }

  // 2. POST /api/wellbeing/limits - Update daily limits & quiet hours configuration
  if (url.pathname === '/api/wellbeing/limits' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const userDid = parsed.userDid || resolveUserDid(ctx);

      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
      if (parsed.quietHoursStart && !timeRegex.test(parsed.quietHoursStart)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid quietHoursStart format. Must be HH:MM in 24-hour format.' }));
        return true;
      }
      if (parsed.quietHoursEnd && !timeRegex.test(parsed.quietHoursEnd)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid quietHoursEnd format. Must be HH:MM in 24-hour format.' }));
        return true;
      }

      if (parsed.dailyAppLimitMinutes !== undefined && (typeof parsed.dailyAppLimitMinutes !== 'number' || parsed.dailyAppLimitMinutes < 0)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'dailyAppLimitMinutes must be a non-negative number' }));
        return true;
      }
      if (parsed.feedLimitMinutes !== undefined && (typeof parsed.feedLimitMinutes !== 'number' || parsed.feedLimitMinutes < 0)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'feedLimitMinutes must be a non-negative number' }));
        return true;
      }
      if (parsed.shortVideoLimitMinutes !== undefined && (typeof parsed.shortVideoLimitMinutes !== 'number' || parsed.shortVideoLimitMinutes < 0)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'shortVideoLimitMinutes must be a non-negative number' }));
        return true;
      }
      if (parsed.exploreLimitMinutes !== undefined && (typeof parsed.exploreLimitMinutes !== 'number' || parsed.exploreLimitMinutes < 0)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'exploreLimitMinutes must be a non-negative number' }));
        return true;
      }

      const updated = sovraDb.updateWellbeingLimits(userDid, parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, limits: updated }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid request body: ' + (err?.message || err) }));
    }
    return true;
  }

  // 3. GET /api/wellbeing/usage - Get today's usage summary & lockout status
  if (url.pathname === '/api/wellbeing/usage' && req.method === 'GET') {
    const userDid = resolveUserDid(ctx);
    const dateParam = url.searchParams.get('date') || undefined;
    const summary = sovraDb.getWellbeingSummary(userDid, dateParam);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      usage: summary.usage,
      limits: summary.limits,
      isQuietHours: summary.isQuietHours,
      isLockoutActive: summary.isLockoutActive,
      exceededCategories: summary.exceededCategories,
      gracePeriodRemainingMs: summary.gracePeriodRemainingMs,
    }));
    return true;
  }

  // 4. POST /api/wellbeing/log-usage - Log active session screen time
  if (url.pathname === '/api/wellbeing/log-usage' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const userDid = parsed.userDid || resolveUserDid(ctx);
      const category = (parsed.category || 'app').toLowerCase();
      const validCategories = ['feed', 'reels', 'explore', 'app'];

      if (!validCategories.includes(category)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid category. Must be feed, reels, explore, or app.' }));
        return true;
      }

      const seconds = typeof parsed.seconds === 'number' ? parsed.seconds : 60;
      if (seconds <= 0 || seconds > 3600) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'seconds must be between 1 and 3600' }));
        return true;
      }

      const result = sovraDb.logWellbeingUsage(userDid, category as any, seconds);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        usage: result.usage,
        limits: result.limits,
        isQuietHours: result.isQuietHours,
        isLockoutActive: result.isLockoutActive,
        exceededCategories: result.exceededCategories,
        gracePeriodRemainingMs: result.gracePeriodRemainingMs,
      }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid request body: ' + (err?.message || err) }));
    }
    return true;
  }

  // 5. POST /api/wellbeing/break-challenge/complete - Verify completion of mindful break
  if (url.pathname === '/api/wellbeing/break-challenge/complete' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;

    try {
      const parsed = body ? JSON.parse(body) : {};
      const userDid = parsed.userDid || resolveUserDid(ctx);
      const graceMinutes = typeof parsed.graceMinutes === 'number' ? parsed.graceMinutes : 5;

      const result = sovraDb.completeBreakChallenge(userDid, graceMinutes);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        message: 'Mindful break completed successfully. Temporary grace unlock granted.',
        unlockedUntil: result.unlockedUntil,
        graceMinutes: result.graceMinutes,
        breaksTaken: result.breaksTaken,
      }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid request body: ' + (err?.message || err) }));
    }
    return true;
  }

  return false;
}
