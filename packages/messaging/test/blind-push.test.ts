/**
 * @file packages/messaging/test/blind-push.test.ts
 * Unit Test Suite for Zero-Knowledge Blind Push Notification Gateway.
 */

import http from 'node:http';
import { describe, it, expect } from 'vitest';
import { BlindPushRelayServer, HttpEndpointPushTransport } from '../src/blind-push.js';

describe('Zero-Knowledge Blind Push Gateway Suite (@sovra/messaging)', () => {
  it('registers devices under blind channel hashes without leaking identities', () => {
    const relay = new BlindPushRelayServer();

    const blindChannelId = BlindPushRelayServer.deriveBlindChannelId(
      'did:key:z6MksAliceP2P',
      'did:key:z6MksBob5G',
    );
    expect(blindChannelId).toHaveLength(64); // SHA-256 hex string

    relay.registerDevice({
      deviceId: 'dev_bob_pixel_8',
      deviceDid: 'did:key:z6MksBobDevice',
      platform: 'android',
      pushToken: 'fcm_token_blind_sample_opaque_123',
      blindChannelId,
      updatedAt: Date.now(),
    });

    expect(relay.getRegisteredDeviceCount()).toBe(1);
  });

  it('fails closed when dispatching without a real configured PushTransportProvider', async () => {
    const relay = new BlindPushRelayServer();
    const blindChannelId = BlindPushRelayServer.deriveBlindChannelId(
      'did:key:z6MksAliceP2P',
      'did:key:z6MksBob5G',
    );

    relay.registerDevice({
      deviceId: 'dev_bob_pixel_8',
      deviceDid: 'did:key:z6MksBobDevice',
      platform: 'android',
      pushToken: 'fcm_token_blind_sample_opaque_123',
      blindChannelId,
      updatedAt: Date.now(),
    });

    const dispatchRes = await relay.dispatchBlindSignal({
      blindChannelId,
      opaqueWakeupHint: 'iv_random_9918237',
      priority: 'high',
      timestamp: Date.now(),
    });

    expect(dispatchRes.ok).toBe(false);
  });

  it('dispatches real blind HTTP wake-up pings via HttpEndpointPushTransport without leaking user DIDs', async () => {
    const receivedRequests: Array<Record<string, unknown>> = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        receivedRequests.push(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messageId: 'fcm_live_msg_2026_real' }));
      });
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    try {
      const transport = new HttpEndpointPushTransport({
        endpointUrl: `http://127.0.0.1:${port}/push/v1`,
      });
      const relay = new BlindPushRelayServer({ transport });
      const blindChannelId = BlindPushRelayServer.deriveBlindChannelId(
        'did:key:z6MksAliceP2P',
        'did:key:z6MksBob5G',
      );

      relay.registerDevice({
        deviceId: 'dev_bob_pixel_8',
        deviceDid: 'did:key:z6MksBobSensitiveIdentity',
        platform: 'android',
        pushToken: 'fcm_token_blind_sample_opaque_123',
        blindChannelId,
        updatedAt: Date.now(),
      });

      const dispatchRes = await relay.dispatchBlindSignal({
        blindChannelId,
        opaqueWakeupHint: 'iv_random_9918237',
        priority: 'high',
        timestamp: Date.now(),
      });

      expect(dispatchRes.ok).toBe(true);
      if (!dispatchRes.ok) return;

      expect(dispatchRes.value).toHaveLength(1);
      const item = dispatchRes.value[0];
      expect(item?.targetDeviceId).toBe('dev_bob_pixel_8');
      expect(item?.platform).toBe('android');
      expect(item?.success).toBe(true);
      expect(item?.messageId).toBe('fcm_live_msg_2026_real');

      expect(receivedRequests).toHaveLength(1);
      expect(JSON.stringify(receivedRequests[0])).not.toContain('SensitiveIdentity');
      expect(receivedRequests[0]?.blindChannelId).toBe(blindChannelId);
      expect(receivedRequests[0]?.opaqueWakeupHint).toBe('iv_random_9918237');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('unregisters devices cleanly', () => {
    const relay = new BlindPushRelayServer();
    const blindChannelId = 'test_channel_hash_123';

    relay.registerDevice({
      deviceId: 'dev_1',
      deviceDid: 'did:key:1',
      platform: 'ios',
      pushToken: 'apns_token_abc',
      blindChannelId,
      updatedAt: Date.now(),
    });
    expect(relay.getRegisteredDeviceCount()).toBe(1);

    relay.unregisterDevice('dev_1');
    expect(relay.getRegisteredDeviceCount()).toBe(0);
  });
});
