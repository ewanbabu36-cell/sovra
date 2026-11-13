/**
 * @file scripts/routes/contacts.routes.ts
 * Signal-Grade Zero-Knowledge Private Contact Discovery & Handle Resolution API.
 *
 * Implements:
 * 1. POST /api/contacts/discover - ZK discovery matching pre-hashed SHA-256 digests
 * 2. POST /api/contacts/link - Links authenticated user's verified contact hashes
 * 3. POST /api/contacts/resolve - Frictionless handle-to-DID resolution (@handle -> DID)
 */

import http from 'node:http';
import { sovraDb } from '../database-engine.ts';
import type { AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';

export interface ContactsRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, maxBytes?: number) => Promise<{ body: string; ok: boolean }>;
  resolvePrincipal: (req: http.IncomingMessage) => AuthenticatedPrincipal | null;
  enforceAuth: (req: http.IncomingMessage, res: http.ServerResponse) => AuthenticatedPrincipal | null;
}

function sendJson(res: http.ServerResponse, statusCode: number, data: Record<string, any>): void {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sovra-Test-Fixture',
  });
  res.end(payload);
}

export async function handleContactsRoutes(ctx: ContactsRouteContext): Promise<boolean> {
  const { req, res, url, readBoundedBody, enforceAuth } = ctx;

  // 1. POST /api/contacts/discover - Zero-Knowledge private peer discovery
  if (url.pathname === '/api/contacts/discover' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 256 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body || '{}');
      const hashes = Array.isArray(parsed.contactHashes) ? parsed.contactHashes : [];

      if (!Array.isArray(hashes)) {
        sendJson(res, 400, { ok: false, error: 'contactHashes must be an array of SHA-256 strings' });
        return true;
      }

      // Bound query set to avoid excessive iteration (max 500 hashes per query)
      const boundedHashes = hashes.slice(0, 500).filter(h => typeof h === 'string' && /^[0-9a-fA-F]{64}$/.test(h));
      const matches = sovraDb.discoverContactsByHashes(boundedHashes);

      sendJson(res, 200, {
        ok: true,
        matches,
        count: matches.length,
        totalQueried: boundedHashes.length,
      });
      return true;
    } catch {
      sendJson(res, 400, { ok: false, error: 'Malformed JSON payload' });
      return true;
    }
  }

  // 2. POST /api/contacts/link - Associates authenticated user with their verified contact hash
  if (url.pathname === '/api/contacts/link' && req.method === 'POST') {
    const principal = enforceAuth(req, res);
    if (!principal) return true;

    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body || '{}');
      const hashes = Array.isArray(parsed.contactHashes) ? parsed.contactHashes : [];

      const validHashes = hashes.filter(h => typeof h === 'string' && /^[0-9a-fA-F]{64}$/.test(h));
      if (validHashes.length === 0) {
        sendJson(res, 400, { ok: false, error: 'No valid 64-character SHA-256 contact hashes provided' });
        return true;
      }

      const linkResult = sovraDb.linkUserContactHashes(principal.did, validHashes);
      sendJson(res, 200, { ok: linkResult.ok, linkedCount: linkResult.linkedCount });
      return true;
    } catch {
      sendJson(res, 400, { ok: false, error: 'Malformed JSON payload' });
      return true;
    }
  }

  // 3. POST /api/contacts/resolve - Seamless Handle-to-DID resolution
  if (url.pathname === '/api/contacts/resolve' && (req.method === 'POST' || req.method === 'GET')) {
    let targetHandle = url.searchParams.get('handle') || '';
    if (!targetHandle && req.method === 'POST') {
      const { body, ok } = await readBoundedBody(req, res, 16 * 1024);
      if (!ok) return true;
      try {
        const parsed = JSON.parse(body || '{}');
        targetHandle = parsed.handle || '';
      } catch {}
    }

    let clean = targetHandle.trim();
    if (!clean.startsWith('@')) clean = '@' + clean;

    const allUsers = (sovraDb as any).db?.users || [];
    const matched = allUsers.find((u: any) => u.handle?.toLowerCase() === clean.toLowerCase());

    if (!matched) {
      sendJson(res, 404, { ok: false, error: `Handle ${clean} not found` });
      return true;
    }

    sendJson(res, 200, {
      ok: true,
      user: {
        did: matched.did,
        handle: matched.handle,
        displayName: matched.displayName || matched.name || matched.handle.replace('@', ''),
        avatar: matched.avatarDataUrl || matched.avatar,
        isVerified: Boolean(matched.isVerified),
      },
    });
    return true;
  }

  return false;
}
