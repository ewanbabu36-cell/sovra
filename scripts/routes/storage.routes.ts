/**
 * @file scripts/routes/storage.routes.ts
 * Sovereign P2P UnixFS / BitSwap Storage Controller.
 *
 * Exposes DAG publication, storage cluster statistics, replica verification,
 * garbage collection, and pin registry queries.
 */

import http from 'node:http';
import type { CID } from 'multiformats/cid';
import type { AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';
import { executeStorageRentBurnSink } from './economy.routes.ts';

export interface StorageRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, limit?: number) => Promise<{ body: string; ok: boolean }>;
  resolvePrincipal: (req: http.IncomingMessage, bodyObj?: Record<string, any>) => AuthenticatedPrincipal | null;
  enforceAuth: (req: http.IncomingMessage, res: http.ServerResponse, bodyObj?: Record<string, any>) => AuthenticatedPrincipal | null;
  storageDaemon: any;
  hasCapability: (principal: AuthenticatedPrincipal | null, cap: string) => boolean;
}

export async function handleStorageRoutes(ctx: StorageRouteContext): Promise<boolean> {
  const { req, res, url, readBoundedBody, resolvePrincipal, enforceAuth, storageDaemon, hasCapability } = ctx;

  // 1. POST /api/storage/publish - Publish & Pin UnixFS DAG
  if (url.pathname === '/api/storage/publish' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 25 * 1024 * 1024);
    if (!ok) return true;
    try {
      let parsed: { content?: string; mimeType?: string; rentMonths?: number; seederDid?: string; storageFeeSov?: number; storageGb?: number };
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = { content: body };
      }
      const principal = enforceAuth(req, res, parsed as Record<string, any>);
      if (!principal) return true;
      const dataBytes = new TextEncoder().encode(parsed.content ?? 'Default Sovra Media Asset');

      let storageRentReceipt: any = null;
      if (Number(parsed.rentMonths || 0) > 0 || parsed.seederDid || Number(parsed.storageFeeSov || 0) > 0) {
        const gb = Math.max(1, Number(parsed.storageGb || Math.ceil(dataBytes.byteLength / (1024 * 1024 * 1024)) || 1));
        const months = Math.max(1, Number(parsed.rentMonths || 1));
        const sinkRes = executeStorageRentBurnSink(
          principal.did,
          gb,
          months,
          parsed.seederDid,
          parsed.storageFeeSov !== undefined ? Number(parsed.storageFeeSov) : undefined,
        );
        if (!sinkRes.ok) {
          res.writeHead(sinkRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sinkRes));
          return true;
        }
        storageRentReceipt = sinkRes;
      }

      const pubRes = await storageDaemon.storageService.publishMedia(
        dataBytes,
        parsed.mimeType ?? 'text/plain',
      );
      if (pubRes.ok) {
        await storageDaemon.pin(pubRes.value.cid as unknown as CID);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            storageRentReceipt,
            asset: {
              cid: pubRes.value.cid.toString(),
              mimeType: pubRes.value.mimeType,
              byteLength: pubRes.value.byteLength,
              sha256Digest: pubRes.value.sha256Digest,
            },
          }),
        );
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: pubRes.error.message }));
      }
    } catch (e) {
      console.error('[STORAGE PUBLISH ERROR]', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return true;
  }

  // 2. GET /api/storage/stats - Storage Cluster Telemetry
  if (url.pathname === '/api/storage/stats' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    if (!principal) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Authentication required to view storage stats' }));
      return true;
    }
    const rawStats = storageDaemon.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        ...rawStats,
        blockCount: rawStats.totalBlocks,
      }, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      ),
    );
    return true;
  }

  // 3. POST /api/storage/verify - Storage Replica Verification
  if (url.pathname === '/api/storage/verify' && req.method === 'POST') {
    const principal = resolvePrincipal(req);
    if (!principal) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Authentication required for storage verification' }));
      return true;
    }
    if (principal.role !== 'SUPER_ADMIN' && !hasCapability(principal, 'storage:admin') && !hasCapability(principal, 'admin:metrics')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Forbidden: Storage administrator capability required' }));
      return true;
    }
    const repRes = await storageDaemon.verifyReplicas();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(repRes));
    return true;
  }

  // 4. POST /api/storage/gc - Storage Garbage Collection
  if (url.pathname === '/api/storage/gc' && req.method === 'POST') {
    const principal = resolvePrincipal(req);
    if (!principal) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Authentication required for storage maintenance' }));
      return true;
    }
    if (principal.role !== 'SUPER_ADMIN' && !hasCapability(principal, 'storage:admin') && !hasCapability(principal, 'admin:metrics')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Forbidden: Storage administrator capability required' }));
      return true;
    }
    const gcRes = await storageDaemon.runGarbageCollection();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(gcRes, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    );
    return true;
  }

  // 5. GET /api/storage/pins - Storage Pin Registry
  if (url.pathname === '/api/storage/pins' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    if (!principal) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Authentication required to inspect pin registry' }));
      return true;
    }
    const pins = storageDaemon.listPins();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(pins));
    return true;
  }

  return false;
}
