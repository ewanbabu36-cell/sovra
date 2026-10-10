/**
 * Sovra Protocol - Universal App Links & Blind Push Notification Gateway Test
 * File: tests/e2e/universal-links-and-blind-push.test.ts
 */

import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('Universal App Links & Blind Push Notification Gateway', () => {
  it('serves Android Digital Asset Links (assetlinks.json) with exact package name and keystore fingerprint', async () => {
    const res = await fetch(`${BASE_URL}/.well-known/assetlinks.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].target.namespace).toBe('android_app');
    expect(data[0].target.package_name).toBe('network.sovra.mobile');
    expect(data[0].target.sha256_cert_fingerprints).toContain(
      '5F:E9:60:5F:17:55:F2:0A:9E:6C:F9:55:9D:3A:DF:B2:EC:88:23:25:18:32:9C:45:57:E4:66:A6:33:D6:2B:1C'
    );
  });

  it('serves Apple App Site Association (apple-app-site-association) with deep link routing paths', async () => {
    const res = await fetch(`${BASE_URL}/.well-known/apple-app-site-association`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');

    const data = await res.json();
    expect(data.applinks).toBeDefined();
    expect(data.applinks.details[0].appID).toContain('network.sovra.mobile');
    expect(data.applinks.details[0].paths).toContain('/feed/*');
  });

  it('registers a mobile device in the Blind Push Relay Gateway and queries status', async () => {
    const registerRes = await fetch(`${BASE_URL}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: `test_device_${Date.now()}`,
        deviceDid: 'did:sovra:e2e_user',
        platform: 'android',
        pushToken: 'fcm_test_token_sample_123',
        blindChannelId: 'blind_channel_topic_abc',
      }),
    });
    expect(registerRes.status).toBe(200);
    const regData = await registerRes.json();
    expect(regData.ok).toBe(true);
    expect(regData.registered).toBe(true);
    expect(regData.totalDevices).toBeGreaterThanOrEqual(1);

    const statusRes = await fetch(`${BASE_URL}/api/push/status`);
    expect(statusRes.status).toBe(200);
    const statData = await statusRes.json();
    expect(statData.ok).toBe(true);
    expect(statData.activeDevices).toBeGreaterThanOrEqual(1);
  });

  it('dispatches an opaque silent push signal to a registered blind channel', async () => {
    const dispatchRes = await fetch(`${BASE_URL}/api/push/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blindChannelId: 'blind_channel_topic_abc',
        priority: 'high',
      }),
    });
    expect(dispatchRes.status).toBe(200);
    const dispatchData = await dispatchRes.json();
    expect(dispatchData.ok).toBe(true);
    expect(dispatchData.dispatchedCount).toBeGreaterThanOrEqual(1);
  });
});
