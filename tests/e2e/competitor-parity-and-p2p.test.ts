import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';

describe('Competitor Parity & Multi-Device P2P Peer Discovery Hardening', () => {
  const SERVER_URL = process.env.TEST_SERVER_URL || 'http://localhost:3001';

  it('1. /api/peers/register accepts did:sovra:... format with HTTP 200', async () => {
    const res = await fetch(`${SERVER_URL}/api/peers/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: 'did:sovra:phone_real_test_' + Date.now(),
        name: 'Pixel Phone Peer',
        handle: '@pixel_tester',
        device: 'Mobile',
        isGuest: true
      })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.peers)).toBe(true);
  });

  it('2. /api/peers/register accepts ephemeral guest presence', async () => {
    const guestDid = 'did:sovra:guest_' + Math.random().toString(36).substring(2, 10);
    const res = await fetch(`${SERVER_URL}/api/peers/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: guestDid,
        name: 'Guest Explorer',
        handle: '@guest_visitor',
        isGuest: true
      })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('3. /api/peers/register rejects invalid DIDs with HTTP 400', async () => {
    const res = await fetch(`${SERVER_URL}/api/peers/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: 'invalid_did_format',
        name: 'Hacker'
      })
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe('Invalid peer DID format');
  });

  it('4. /api/peers/list returns the registered active peers', async () => {
    const res = await fetch(`${SERVER_URL}/api/peers/list`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.peers)).toBe(true);
    expect(data.peers.length).toBeGreaterThan(0);
  });

  it('5. Main web HTML contains #sovraImageLightboxModal and #sovraPhotoLightboxModal', async () => {
    const res = await fetch(`${SERVER_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="sovraPhotoLightboxModal"');
    expect(html).toContain('id="sovraImageLightboxModal"');
  });

  it('6. Chat header contains 1-tap call dispatch buttons #chatCallAudioBtn and #chatCallVideoBtn', async () => {
    const res = await fetch(`${SERVER_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="chatCallAudioBtn"');
    expect(html).toContain('id="chatCallVideoBtn"');
    expect(html).toContain('startE2eeCall');
  });

  it('7. Client logic includes registerPeerOnLan, formatPostCaptionWithHashtags, and openPostInWatchMode', async () => {
    const res = await fetch(`${SERVER_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('window.registerPeerOnLan');
    expect(html).toContain('window.formatPostCaptionWithHashtags');
    expect(html).toContain('window.openPostInWatchMode');
    expect(html).toContain('feed-watch-theater-btn');
    expect(html).toContain('Nearby Online Devices (LAN)');
  });
});
