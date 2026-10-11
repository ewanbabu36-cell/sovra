/**
 * @file scripts/routes/push.routes.ts
 * Zero-Knowledge Blind Push Gateway Route Controller.
 *
 * Implements isolated, type-safe push notification registration, dispatch,
 * and health status reporting for FCM and APNs devices.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import type { BlindPushRelayServer } from '../../packages/messaging/dist/index.js';

export interface PushRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  blindPushRelay: BlindPushRelayServer;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, limit?: number) => Promise<{ body: string; ok: boolean }>;
}

export async function handlePushRoutes(ctx: PushRouteContext): Promise<boolean> {
  const { req, res, url, blindPushRelay, readBoundedBody } = ctx;

  // Blind Push Gateway: Register Device
  if (url.pathname === '/api/push/register' && req.method === 'POST') {
    try {
      const { body: reqBody, ok: bodyOk } = await readBoundedBody(req, res);
      if (!bodyOk) return true;
      const parsed = reqBody ? JSON.parse(reqBody) : {};
      if (!parsed.deviceId || !parsed.pushToken || !parsed.blindChannelId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing deviceId, pushToken, or blindChannelId' }));
        return true;
      }
      blindPushRelay.registerDevice({
        deviceId: String(parsed.deviceId),
        deviceDid: String(parsed.deviceDid || 'did:sovra:anonymous'),
        platform: (parsed.platform === 'ios' ? 'ios' : (parsed.platform === 'web' ? 'web' : 'android')),
        pushToken: String(parsed.pushToken),
        blindChannelId: String(parsed.blindChannelId),
        updatedAt: Date.now(),
      });
      if (parsed.deviceDid && parsed.deviceDid !== 'did:sovra:anonymous') {
        const didBlindChannel = crypto.createHash('sha256').update(String(parsed.deviceDid)).digest('hex');
        if (didBlindChannel !== String(parsed.blindChannelId)) {
          blindPushRelay.registerDevice({
            deviceId: String(parsed.deviceId) + '_did',
            deviceDid: String(parsed.deviceDid),
            platform: (parsed.platform === 'ios' ? 'ios' : (parsed.platform === 'web' ? 'web' : 'android')),
            pushToken: String(parsed.pushToken),
            blindChannelId: didBlindChannel,
            updatedAt: Date.now(),
          });
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, registered: true, totalDevices: blindPushRelay.getRegisteredDeviceCount() }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Push registration failed' }));
    }
    return true;
  }

  // Blind Push Gateway: Dispatch Opaque Wakeup Ping
  if (url.pathname === '/api/push/dispatch' && req.method === 'POST') {
    try {
      const { body: reqBody, ok: bodyOk } = await readBoundedBody(req, res);
      if (!bodyOk) return true;
      const parsed = reqBody ? JSON.parse(reqBody) : {};
      if (!parsed.blindChannelId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing blindChannelId' }));
        return true;
      }
      const dispatchRes = await blindPushRelay.dispatchBlindSignal({
        blindChannelId: String(parsed.blindChannelId),
        opaqueWakeupHint: String(parsed.opaqueWakeupHint || crypto.randomBytes(16).toString('hex')),
        priority: parsed.priority === 'normal' ? 'normal' : 'high',
        timestamp: Date.now(),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: dispatchRes.ok, dispatchedCount: dispatchRes.ok ? dispatchRes.value.length : 0 }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Push dispatch failed' }));
    }
    return true;
  }

  // Blind Push Gateway: Status
  if (url.pathname === '/api/push/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, activeDevices: blindPushRelay.getRegisteredDeviceCount() }));
    return true;
  }

  return false;
}
