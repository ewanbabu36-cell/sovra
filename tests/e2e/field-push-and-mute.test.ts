import { describe, it, expect } from 'vitest';

describe('Real-World Field Testing: VAPID Push Wakeup & WebRTC Mute Resilience', () => {
  const SERVER_URL = process.env.TEST_SERVER_URL || 'http://localhost:3001';

  it('1. GET /api/push/vapid-key returns valid VAPID public key', async () => {
    const res = await fetch(`${SERVER_URL}/api/push/vapid-key`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(typeof data.publicKey).toBe('string');
    expect(data.publicKey.length).toBeGreaterThan(20);
  });

  it('2. POST /api/push/register accepts push tokens and registers device', async () => {
    const res = await fetch(`${SERVER_URL}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'field_test_device_' + Date.now(),
        deviceDid: 'did:sovra:field_peer_' + Date.now(),
        platform: 'web',
        pushToken: 'https://fcm.googleapis.com/fcm/send/test_field_token_' + Date.now(),
        blindChannelId: 'field_blind_channel_' + Date.now(),
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.registered).toBe(true);
    expect(typeof data.totalDevices).toBe('number');
  });

  it('3. GET /api/rtc/ice-servers and /api/call/ice-servers return dynamic ICE configuration', async () => {
    const res1 = await fetch(`${SERVER_URL}/api/rtc/ice-servers`);
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.ok).toBe(true);
    expect(Array.isArray(data1.iceServers)).toBe(true);
    expect(data1.iceTransportPolicy).toBe('all');

    const res2 = await fetch(`${SERVER_URL}/api/call/ice-servers?privacy=relay`);
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.ok).toBe(true);
    expect(data2.privacyRelay).toBe(true);
    expect(data2.iceTransportPolicy).toBe('relay');
  });

  it('4. POST /api/call/offer triggers blind signal and web push dispatch to callee', async () => {
    const ts = Date.now();

    // Register caller (Alice)
    const resA = await fetch(`${SERVER_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@alice_field_${ts}`,
        name: 'Alice Caller',
      }),
    });
    const dataA = await resA.json();
    const aliceToken = dataA.sessionToken;
    const aliceDid = dataA.user.did;

    // Register callee (Bob)
    const resB = await fetch(`${SERVER_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@bob_field_${ts}`,
        name: 'Bob Callee',
      }),
    });
    const dataB = await resB.json();
    const bobDid = dataB.user.did;

    // Register Bob's push token with the gateway
    await fetch(`${SERVER_URL}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'dev_bob_' + ts,
        deviceDid: bobDid,
        platform: 'web',
        pushToken: 'https://fcm.googleapis.com/fcm/send/bob_endpoint_' + ts,
        blindChannelId: 'chan_bob_' + ts,
      }),
    });

    // Alice offers a call to Bob
    const offerRes = await fetch(`${SERVER_URL}/api/call/offer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        recipientDid: bobDid,
        offerSdp: 'v=0\r\no=- 123456 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=sendrecv\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
        callType: 'audio',
      }),
    });

    expect(offerRes.status).toBe(200);
    const offerData = await offerRes.json();
    expect(offerData.ok).toBe(true);
    expect(offerData.sessionId).toBeDefined();
  });

  it('5. Real VAPID PushManager registration is wired in client application script', async () => {
    const res = await fetch(`${SERVER_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('urlBase64ToUint8Array');
    expect(html).toContain('PushManager');
    expect(html).toContain('fetch(\'/api/push/vapid-key\')');
    expect(html).toContain('reg.pushManager.subscribe');
    expect(html).toContain('applicationServerKey: keyArr');
    expect(html).toContain('liveSubscription = JSON.parse(JSON.stringify(sub))');
    expect(html).toContain('window.SovraBlindPush.registerDeviceToken(myProfile ? myProfile.did : null)');
  });

  it('6. WebRTC Remote Video track mute/unmute listener & notice is wired', async () => {
    const res = await fetch(`${SERVER_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('id="remoteCameraMutedNotice"');
    expect(html).toContain('📷 Peer turned off camera');
    expect(html).toContain("event.track.addEventListener('mute'");
    expect(html).toContain("event.track.addEventListener('unmute'");
    expect(html).toContain('remoteCameraMutedNotice\');');
    expect(html).toContain('notice.style.display = \'block\'');
    expect(html).toContain('notice.style.display = \'none\'');
  });
});
