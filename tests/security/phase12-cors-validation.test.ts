/**
 * 👑 SOVRA PROTOCOL - PHASE 12: CORS ORIGIN SECURITY & ALLOWLIST TEST SUITE
 * File: tests/security/phase12-cors-validation.test.ts
 *
 * Verifies Workstream 3:
 * 1. Approved origin reflection & Access-Control-Allow-Credentials: true
 * 2. Unapproved origin non-reflection (NEVER reflected)
 * 3. Never allow credentials for an untrusted origin
 * 4. Rejection of null origin ('null')
 * 5. Safe handling of missing Origin header (non-CORS requests)
 * 6. Rejection of malformed origin strings
 * 7. Correct handling of OPTIONS preflight (204 for allowed, 403 for unapproved)
 * 8. Substring & domain spoofing defense (e.g. allowed.com.attacker.com)
 * 9. Multiple configured origins support
 * 10. Verification that internal cluster headers are NOT exposed in CORS
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DecoupledApiServer } from '../../services/api/src/server.js';
import { SecurityMiddleware } from '../../services/api/src/middleware/security.middleware.js';

describe('SOVRA Phase 12: CORS Origin Security & Allowlist Enforcement', () => {
  let server: DecoupledApiServer;
  let serverPort: number;

  const allowedOrigins = [
    'https://sovra.network',
    'https://app.sovra.network',
    'http://localhost:3000',
  ];

  beforeAll(async () => {
    server = new DecoupledApiServer({
      port: 0,
      internalSecret: 'sovra_super_secret_phase12_production_key_32_bytes_long_valid',
      allowedOrigins,
    });
    serverPort = await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('1. accepts and reflects configured approved origin with credentials', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/health`, {
      method: 'GET',
      headers: {
        Origin: 'https://sovra.network',
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://sovra.network');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('vary')).toContain('Origin');
  });

  it('2. strictly refuses to reflect unapproved untrusted origin', async () => {
    const untrustedOrigin = 'https://evil-attacker-site.com';
    const res = await fetch(`http://127.0.0.1:${serverPort}/health`, {
      method: 'GET',
      headers: {
        Origin: untrustedOrigin,
      },
    });

    expect(res.status).toBe(200);
    // MUST NOT reflect untrusted origin!
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('3. rejects null origin string ("null")', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/health`, {
      method: 'GET',
      headers: {
        Origin: 'null',
      },
    });

    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('4. safely handles requests missing Origin header (same-origin / server-to-server)', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/health`, {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('5. rejects malformed or invalid origin URLs', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/health`, {
      method: 'GET',
      headers: {
        Origin: 'not-a-valid-url:///foo',
      },
    });

    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('6. handles OPTIONS preflight request for approved origin (204 No Content)', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.sovra.network',
        'Access-Control-Request-Method': 'GET',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.sovra.network');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('7. rejects OPTIONS preflight request for unapproved origin (403 Forbidden)', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://malicious-preflight.com',
        'Access-Control-Request-Method': 'POST',
      },
    });

    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    const body = await res.json();
    expect(body.code).toBe('CORS_ORIGIN_FORBIDDEN');
  });

  it('8. defends against origin suffix / subdomain spoofing attacks', async () => {
    // Suffix spoofing: attacker owns sovra.network.attacker.com
    const resSuffix = await fetch(`http://127.0.0.1:${serverPort}/health`, {
      method: 'GET',
      headers: {
        Origin: 'https://sovra.network.attacker.com',
      },
    });
    expect(resSuffix.headers.get('access-control-allow-origin')).toBeNull();

    // Prefix spoofing: attacker owns attacker-sovra.network
    const resPrefix = await fetch(`http://127.0.0.1:${serverPort}/health`, {
      method: 'GET',
      headers: {
        Origin: 'https://attacker-sovra.network',
      },
    });
    expect(resPrefix.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('9. supports all multiple configured origins correctly', async () => {
    for (const origin of allowedOrigins) {
      const res = await fetch(`http://127.0.0.1:${serverPort}/health`, {
        method: 'GET',
        headers: { Origin: origin },
      });
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    }
  });

  it('10. verifies internal authentication headers are NEVER exposed in Access-Control-Allow-Headers', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://sovra.network',
        'Access-Control-Request-Method': 'GET',
      },
    });

    const allowHeaders = res.headers.get('access-control-allow-headers') || '';
    // Must NOT expose internal headers to public browser environments
    expect(allowHeaders).not.toContain('X-Sovra-Internal-Auth');
    expect(allowHeaders).not.toContain('X-Sovra-Timestamp');
    expect(allowHeaders).not.toContain('X-Sovra-Nonce');
    expect(allowHeaders).not.toContain('X-Sovra-Body-Hash');
  });
});
