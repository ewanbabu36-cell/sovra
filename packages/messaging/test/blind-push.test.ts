/**
 * @file packages/messaging/test/blind-push.test.ts
 * Unit Test Suite for Zero-Knowledge Blind Push Notification Gateway.
 */

import { describe, it, expect } from 'vitest';
import { BlindPushRelayServer } from '../src/blind-push.js';

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

  it('dispatches blind silent wake-up pings to registered devices', async () => {
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

    expect(dispatchRes.ok).toBe(true);
    if (!dispatchRes.ok) return;

    expect(dispatchRes.value).toHaveLength(1);
    const item = dispatchRes.value[0];
    expect(item?.targetDeviceId).toBe('dev_bob_pixel_8');
    expect(item?.platform).toBe('android');
    expect(item?.success).toBe(true);
    expect(item?.messageId).toMatch(/^fcm_msg_/);
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
