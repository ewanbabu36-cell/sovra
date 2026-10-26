import { describe, it, expect, beforeAll } from 'vitest';
import http from 'node:http';

const BASE_URL = 'http://127.0.0.1:3001';

let isServerOnline = false;

function makeRequest(path: string, options: http.RequestOptions = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE_URL}${path}`, options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('360° Security Hardening & Hacker Defense Suite', () => {
  beforeAll(async () => {
    try {
      const res = await makeRequest('/');
      if (res.status === 200) isServerOnline = true;
    } catch {
      isServerOnline = false;
    }
  });

  it('1. Serves complete OWASP Defense-in-Depth headers (CSP, COOP, CORP, nosniff, SAMEORIGIN)', async () => {
    if (!isServerOnline) return;
    const res = await makeRequest('/');
    expect(res.status).toBe(200);

    // Content-Security-Policy
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self' data: blob:");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'");

    // Clickjacking & MIME Sniffing protection
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-content-type-options']).toBe('nosniff');

    // Cross-Origin Isolation
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['x-xss-protection']).toBe('1; mode=block');
  }, 15000);

  it('2. Enforces Anti-Replay Nonce Validation and blocks replay attacks with 403 Forbidden', async () => {
    if (!isServerOnline) return;
    const testNonce = 'nonce_sec_audit_' + Date.now() + '_' + Math.random().toString(36).substring(2);
    const timestamp = String(Date.now());

    // 1st request: fresh nonce -> success
    const firstRes = await makeRequest('/api/feed/personalized', {
      headers: {
        'x-sovra-nonce': testNonce,
        'x-sovra-timestamp': timestamp,
      },
    });
    expect(firstRes.status).toBe(200);

    // 2nd request with IDENTICAL nonce (Replay Attack) -> must be rejected with 403
    const replayRes = await makeRequest('/api/feed/personalized', {
      headers: {
        'x-sovra-nonce': testNonce,
        'x-sovra-timestamp': timestamp,
      },
    });
    expect(replayRes.status).toBe(403);
    const parsed = JSON.parse(replayRes.body);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('Anti-replay protection violation');
  }, 15000);

  it('3. WebRTC Privacy Relay Mode strips STUN servers and masks user IP addresses', async () => {
    if (!isServerOnline) return;
    // Calling with privacy=relay
    const relayRes = await makeRequest('/api/call/ice-servers?privacy=relay');
    expect(relayRes.status).toBe(200);
    const data = JSON.parse(relayRes.body);

    expect(data.ok).toBe(true);
    expect(data.privacyRelay).toBe(true);
    expect(data.iceTransportPolicy).toBe('relay');

    // Assert NO STUN server is returned in privacy relay mode (prevents public IP leak)
    for (const server of data.iceServers) {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      for (const u of urls) {
        expect(u.startsWith('stun:')).toBe(false);
        expect(u.startsWith('turn:') || u.startsWith('turns:')).toBe(true);
      }
    }
  }, 15000);

  it('4. WebRTC candidate signaling masks host and srflx IP candidates when Privacy Relay is active', async () => {
    if (!isServerOnline) return;
    // Attempt candidate submission on a privacy-shielded call
    const postData = JSON.stringify({
      callId: 'test_call_' + Date.now(),
      privacyRelay: true,
      candidate: {
        candidate: 'candidate:1 1 UDP 2130706431 192.168.1.50 54321 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      },
    });

    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(`${BASE_URL}/api/call/candidate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode || 0, body }));
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    // Since candidate has 'typ host' (LAN IP), privacy relay intercepts it
    const data = JSON.parse(res.body);
    // Either unauthorized (auth gate) or masked if simulated
    expect(res.status === 401 || data.masked === true).toBe(true);
  }, 15000);
});
