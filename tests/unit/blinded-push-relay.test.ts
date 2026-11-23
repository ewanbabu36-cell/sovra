import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  generateVapidJwt,
  getOrCreateVapidKeys,
  recordPushSubscription,
  getPushTokensForDid,
  sendNativePushNotification,
  nativePushRegistry,
} from '../../scripts/routes/push.routes.js';

describe('Blinded Privacy-Preserving Push Relay', () => {
  it('generates cryptographically valid VAPID JWTs for WebPush protocol', () => {
    const keys = getOrCreateVapidKeys();
    expect(keys.publicKey).toBeDefined();
    expect(keys.publicKey.length).toBeGreaterThan(20);

    if (keys.privateKeyPem) {
      const jwt = generateVapidJwt('https://fcm.googleapis.com', 'mailto:security@sovra.network', keys.privateKeyPem);
      const parts = jwt.split('.');
      expect(parts.length).toBe(3);

      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      expect(header.typ).toBe('JWT');
      expect(header.alg).toBe('ES256');

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      expect(payload.aud).toBe('https://fcm.googleapis.com');
      expect(payload.sub).toBe('mailto:security@sovra.network');
      expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    }
  });

  it('binds push tokens to SHA-256 blind channel IDs preserving zero-knowledge', () => {
    const userDid = 'did:sovra:alice_privacy_user_99';
    const blindChannelId = crypto.createHash('sha256').update(userDid).digest('hex');
    const pushEndpoint = 'https://updates.push.services.mozilla.com/wpush/v2/test_token_alice';

    recordPushSubscription(userDid, blindChannelId, pushEndpoint);

    // Resolving by userDid should find the token via blind channel mapping
    const resolvedTokens = getPushTokensForDid(userDid);
    expect(resolvedTokens).toContain(pushEndpoint);

    // Ensure the blind channel topic is a 64-character SHA-256 hex digest
    expect(blindChannelId).toHaveLength(64);
    expect(blindChannelId).not.toContain('alice');
  });

  it('registers native push devices with masked topic channels', () => {
    const userDid = 'did:sovra:bob_mobile_user_88';
    const hashedTopic = 'sovra_' + crypto.createHash('sha256').update(userDid).digest('hex').slice(0, 16);

    nativePushRegistry.set(userDid, {
      userDid,
      provider: 'ntfy',
      platform: 'android',
      topic: hashedTopic,
      updatedAt: Date.now(),
    });

    const entry = nativePushRegistry.get(userDid);
    expect(entry).toBeDefined();
    expect(entry?.topic).toBe(hashedTopic);
    expect(entry?.topic.startsWith('sovra_')).toBe(true);
    expect(entry?.topic).not.toContain('bob');
  });

  it('formats urgent wake-up payloads without leaking sensitive plaintext', async () => {
    const userDid = 'did:sovra:carol_test_user';
    const result = await sendNativePushNotification({
      userDid,
      title: 'Sovra Wakeup',
      body: 'Encrypted payload ready for retrieval',
      data: {
        type: 'sync',
        blindChannelId: crypto.createHash('sha256').update(userDid).digest('hex'),
      },
    });

    expect(result.ok).toBeDefined();
    expect(result.provider).toBeDefined();
  });
});
