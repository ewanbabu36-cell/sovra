import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';

describe('SEC-07: Secure Session Architecture & CSRF Defense', () => {
  let serverProcess: ChildProcess;
  const testPort = 3188;
  const baseUrl = `http://127.0.0.1:${testPort}`;

  beforeAll(async () => {
    // Boot test server instance (clear VITEST env var so dev-server boots)
    const env: Record<string, string | undefined> = { ...process.env, PORT: String(testPort), SOVRA_DISABLE_HTTPS: 'true' };
    delete env.VITEST;

    serverProcess = spawn(
      process.execPath,
      ['--experimental-strip-types', path.resolve(__dirname, '../../scripts/dev-server.ts')],
      {
        env,
        stdio: 'ignore',
      }
    );

    // Wait for server to become responsive
    let ready = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        await new Promise<void>((resolve, reject) => {
          const req = http.get(`${baseUrl}/api/status`, res => {
            if (res.statusCode === 200) resolve();
            else reject();
          });
          req.on('error', reject);
          req.setTimeout(500, () => req.destroy());
        });
        ready = true;
        break;
      } catch {}
    }
    expect(ready).toBe(true);
  }, 15000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
  });

  function makeRequest(
    method: string,
    reqPath: string,
    headers: Record<string, string> = {},
    bodyObj?: any
  ): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: any }> {
    return new Promise((resolve, reject) => {
      const payload = bodyObj !== undefined ? JSON.stringify(bodyObj) : '';
      const reqHeaders: Record<string, string> = { ...headers };
      if (bodyObj !== undefined) {
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = String(Buffer.byteLength(payload));
      }

      const req = http.request(
        `${baseUrl}${reqPath}`,
        {
          method,
          headers: reqHeaders,
        },
        res => {
          let raw = '';
          res.on('data', chunk => (raw += chunk));
          res.on('end', () => {
            let parsed = null;
            try {
              parsed = raw ? JSON.parse(raw) : null;
            } catch {
              parsed = raw;
            }
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              body: parsed,
            });
          });
        }
      );

      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  const testHandle = `@sec07_${Date.now()}`;
  let sessionCookie = '';
  let sessionToken = '';

  it('POST /api/user/register sets HttpOnly, SameSite=Strict session cookie', async () => {
    const res = await makeRequest('POST', '/api/user/register', {}, {
      handle: testHandle,
      displayName: 'SEC-07 Session User',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sessionToken).toBeDefined();
    sessionToken = res.body.sessionToken;

    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
    expect(cookieHeader).toContain('sovra_session_token=');
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Strict');

    const match = cookieHeader.match(/sovra_session_token=([^;]+)/);
    expect(match).not.toBeNull();
    sessionCookie = `sovra_session_token=${match![1]}`;
  });

  it('authenticates protected read endpoints using HttpOnly session cookie alone', async () => {
    const res = await makeRequest('GET', '/api/user/me', {
      Cookie: sessionCookie,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.handle).toBe(testHandle);
  });

  it('blocks cross-site mutating requests (CSRF Defense) using cookie session', async () => {
    const res = await makeRequest(
      'POST',
      '/api/feed/create',
      {
        Cookie: sessionCookie,
        'Sec-Fetch-Site': 'cross-site',
        Origin: 'https://malicious-attacker.com',
      },
      { text: 'CSRF Attack Injected Post' }
    );

    // Cross-site mutating request must be rejected as unauthorized
    expect([401, 403]).toContain(res.statusCode);
  });

  it('allows same-site mutating requests with CSRF token header', async () => {
    const res = await makeRequest(
      'POST',
      '/api/feed/create',
      {
        Cookie: sessionCookie,
        'X-CSRF-Token': 'valid_csrf_token',
      },
      { caption: 'Legitimate Post from Authenticated User' }
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /api/user/logout clears HttpOnly cookie with Max-Age=0 and revokes token', async () => {
    const res = await makeRequest('POST', '/api/user/logout', {
      Cookie: sessionCookie,
      'X-CSRF-Token': 'valid_csrf_token',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);

    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
    expect(cookieHeader).toContain('Max-Age=0');

    // Subsequent call with the revoked cookie must be unauthorized
    const checkRes = await makeRequest('GET', '/api/user/me', {
      Cookie: sessionCookie,
    });
    expect([401, 403]).toContain(checkRes.statusCode);
  });
});
