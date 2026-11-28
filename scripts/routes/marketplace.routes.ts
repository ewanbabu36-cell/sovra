/**
 * @file scripts/routes/marketplace.routes.ts
 * Trustless P2P Escrow Marketplace & Geo-Spatial Neighborhood Groups API.
 *
 * Implements:
 * 1. GET /api/marketplace/items - Radius/Geohash item discovery
 * 2. POST /api/marketplace/items - Create item listing
 * 3. POST /api/marketplace/escrow/create - Lock buyer funds in escrow
 * 4. POST /api/marketplace/escrow/dispatch - Seller marks dispatched
 * 5. POST /api/marketplace/escrow/release - Physical QR code handover / cryptographic release
 * 6. POST /api/marketplace/escrow/dispute - Open transaction dispute
 * 7. GET /api/groups/nearby - Discover local geo-anchored groups
 * 8. POST /api/groups/create-local - Create geo-anchored neighborhood group
 */

import http from 'node:http';
import { sovraDb } from '../database-engine.ts';
import type { AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';
import { resolveAllowedOrigin, DEFAULT_SECURITY_POLICY } from '../../packages/shared/dist/index.js';

export interface MarketplaceRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, maxBytes?: number) => Promise<{ body: string; ok: boolean }>;
  resolvePrincipal: (req: http.IncomingMessage) => AuthenticatedPrincipal | null;
  enforceAuth: (req: http.IncomingMessage, res: http.ServerResponse) => AuthenticatedPrincipal | null;
}

function sendJson(res: http.ServerResponse, statusCode: number, data: Record<string, any>, req?: http.IncomingMessage): void {
  const payload = JSON.stringify(data);
  const headers: Record<string, string | number> = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sovra-Benchmark',
  };
  const origin = req?.headers?.origin;
  const allowedOrigin = resolveAllowedOrigin(origin, DEFAULT_SECURITY_POLICY);
  if (allowedOrigin && allowedOrigin !== '*') {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Vary'] = 'Origin';
  }
  res.writeHead(statusCode, headers);
  res.end(payload);
}

export async function handleMarketplaceRoutes(ctx: MarketplaceRouteContext): Promise<boolean> {
  const { req, res, url, readBoundedBody, enforceAuth } = ctx;

  // 1. GET /api/marketplace/items - Discover items within radius
  if (url.pathname === '/api/marketplace/items' && req.method === 'GET') {
    const geohash = url.searchParams.get('geohash') || undefined;
    const latStr = url.searchParams.get('lat') || url.searchParams.get('latitude');
    const lonStr = url.searchParams.get('lon') || url.searchParams.get('longitude');
    const radiusStr = url.searchParams.get('radius') || url.searchParams.get('radiusKm');
    const category = url.searchParams.get('category') || undefined;
    const limitStr = url.searchParams.get('limit');

    const latitude = latStr ? parseFloat(latStr) : undefined;
    const longitude = lonStr ? parseFloat(lonStr) : undefined;
    const radiusKm = radiusStr ? parseFloat(radiusStr) : 25;
    const limit = limitStr ? parseInt(limitStr, 10) : 50;

    const items = sovraDb.getMarketplaceItems({
      geohash,
      latitude,
      longitude,
      radiusKm,
      category,
      limit,
    });

    sendJson(res, 200, {
      ok: true,
      items,
      count: items.length,
      filters: { geohash, latitude, longitude, radiusKm, category },
    }, req);
    return true;
  }

  // 2. POST /api/marketplace/items - Create item listing
  if (url.pathname === '/api/marketplace/items' && req.method === 'POST') {
    const principal = enforceAuth(req, res);
    if (!principal) return true;

    const { body, ok } = await readBoundedBody(req, res, 256 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body || '{}');
      const { title, description, priceSov, category, latitude, longitude, images, condition } = parsed;

      if (!title || typeof title !== 'string' || title.trim().length < 3) {
        sendJson(res, 400, { ok: false, error: 'Title is required (min 3 chars)' }, req);
        return true;
      }

      if (typeof priceSov !== 'number' || priceSov <= 0) {
        sendJson(res, 400, { ok: false, error: 'priceSov must be a positive number' }, req);
        return true;
      }

      const lat = typeof latitude === 'number' ? latitude : 0;
      const lon = typeof longitude === 'number' ? longitude : 0;

      const item = sovraDb.createMarketplaceItem({
        sellerDid: principal.did,
        title,
        description: description || '',
        priceSov,
        category: category || 'general',
        latitude: lat,
        longitude: lon,
        images: Array.isArray(images) ? images : [],
        condition: condition || 'good',
      });

      sendJson(res, 201, { ok: true, item }, req);
      return true;
    } catch (err: any) {
      sendJson(res, 400, { ok: false, error: err.message || 'Failed to create item listing' }, req);
      return true;
    }
  }

  // 3. POST /api/marketplace/escrow/create - Lock buyer funds in escrow
  if (url.pathname === '/api/marketplace/escrow/create' && req.method === 'POST') {
    const principal = enforceAuth(req, res);
    if (!principal) return true;

    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body || '{}');
      const { itemId } = parsed;
      if (!itemId) {
        sendJson(res, 400, { ok: false, error: 'itemId is required' }, req);
        return true;
      }

      const { escrow, deliverySecret } = sovraDb.createMarketplaceEscrow(principal.did, itemId);

      sendJson(res, 200, {
        ok: true,
        escrow,
        deliverySecret,
        qrPayload: {
          escrowId: escrow.id,
          deliverySecret,
          amountSov: escrow.amountSov,
        },
      }, req);
      return true;
    } catch (err: any) {
      sendJson(res, 400, { ok: false, error: err.message || 'Failed to create escrow' }, req);
      return true;
    }
  }

  // 4. POST /api/marketplace/escrow/dispatch - Seller marks dispatched
  if (url.pathname === '/api/marketplace/escrow/dispatch' && req.method === 'POST') {
    const principal = enforceAuth(req, res);
    if (!principal) return true;

    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body || '{}');
      const { escrowId } = parsed;
      if (!escrowId) {
        sendJson(res, 400, { ok: false, error: 'escrowId is required' }, req);
        return true;
      }

      const escrow = sovraDb.dispatchMarketplaceEscrow(principal.did, escrowId);
      sendJson(res, 200, { ok: true, escrow }, req);
      return true;
    } catch (err: any) {
      sendJson(res, 400, { ok: false, error: err.message || 'Failed to dispatch escrow' }, req);
      return true;
    }
  }

  // 5. POST /api/marketplace/escrow/release - Physical QR scan handover / release funds
  if (url.pathname === '/api/marketplace/escrow/release' && req.method === 'POST') {
    const principal = enforceAuth(req, res);
    if (!principal) return true;

    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body || '{}');
      const { escrowId, deliverySecret } = parsed;
      if (!escrowId || !deliverySecret) {
        sendJson(res, 400, { ok: false, error: 'escrowId and deliverySecret are required' }, req);
        return true;
      }

      const escrow = sovraDb.releaseMarketplaceEscrow(principal.did, escrowId, deliverySecret);
      sendJson(res, 200, { ok: true, escrow, released: true }, req);
      return true;
    } catch (err: any) {
      sendJson(res, 400, { ok: false, error: err.message || 'Failed to release escrow' }, req);
      return true;
    }
  }

  // 6. POST /api/marketplace/escrow/dispute - Open transaction dispute
  if (url.pathname === '/api/marketplace/escrow/dispute' && req.method === 'POST') {
    const principal = enforceAuth(req, res);
    if (!principal) return true;

    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body || '{}');
      const { escrowId, reason } = parsed;
      if (!escrowId) {
        sendJson(res, 400, { ok: false, error: 'escrowId is required' }, req);
        return true;
      }

      const escrow = sovraDb.disputeMarketplaceEscrow(principal.did, escrowId, reason || 'Transaction disputed');
      sendJson(res, 200, { ok: true, escrow, disputed: true }, req);
      return true;
    } catch (err: any) {
      sendJson(res, 400, { ok: false, error: err.message || 'Failed to dispute escrow' }, req);
      return true;
    }
  }

  // 7. GET /api/groups/nearby - Discover local geo-anchored groups
  if (url.pathname === '/api/groups/nearby' && req.method === 'GET') {
    const geohash = url.searchParams.get('geohash') || undefined;
    const latStr = url.searchParams.get('lat') || url.searchParams.get('latitude');
    const lonStr = url.searchParams.get('lon') || url.searchParams.get('longitude');
    const radiusStr = url.searchParams.get('radius') || url.searchParams.get('radiusKm');

    const latitude = latStr ? parseFloat(latStr) : undefined;
    const longitude = lonStr ? parseFloat(lonStr) : undefined;
    const radiusKm = radiusStr ? parseFloat(radiusStr) : 25;

    const groups = sovraDb.getNearbyLocalGroups({
      geohash,
      latitude,
      longitude,
      radiusKm,
    });

    sendJson(res, 200, {
      ok: true,
      groups,
      count: groups.length,
    }, req);
    return true;
  }

  // 8. POST /api/groups/create-local - Create geo-anchored neighborhood group
  if (url.pathname === '/api/groups/create-local' && req.method === 'POST') {
    const principal = enforceAuth(req, res);
    if (!principal) return true;

    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body || '{}');
      const { name, description, latitude, longitude, radiusKm, category, isPrivate } = parsed;

      if (!name || typeof name !== 'string' || name.trim().length < 3) {
        sendJson(res, 400, { ok: false, error: 'Group name is required (min 3 chars)' }, req);
        return true;
      }

      const lat = typeof latitude === 'number' ? latitude : 0;
      const lon = typeof longitude === 'number' ? longitude : 0;

      const group = sovraDb.createLocalGroup({
        name,
        description: description || '',
        creatorDid: principal.did,
        latitude: lat,
        longitude: lon,
        radiusKm: typeof radiusKm === 'number' ? radiusKm : 10,
        category: category || 'community',
        isPrivate: Boolean(isPrivate),
      });

      sendJson(res, 201, { ok: true, group }, req);
      return true;
    } catch (err: any) {
      sendJson(res, 400, { ok: false, error: err.message || 'Failed to create local group' }, req);
      return true;
    }
  }

  return false;
}
