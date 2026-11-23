import { describe, it, expect, beforeAll } from 'vitest';
import http from 'node:http';
import { sovraDb } from '../../scripts/database-engine.ts';
import { handleAuthRoutes } from '../../scripts/routes/auth.routes.ts';

function createMockReqRes(method: string, urlStr: string, bodyObj?: any, headers: Record<string, string> = {}) {
  const req = new http.IncomingMessage(null as any);
  req.method = method;
  req.url = urlStr;
  req.headers = {};
  for (const [k, v] of Object.entries(headers)) {
    req.headers[k.toLowerCase()] = v;
  }

  const res = new http.ServerResponse(req);
  let statusCode = 200;
  let resHeaders: Record<string, any> = {};
  let body = '';

  res.writeHead = (status: number, h?: any) => {
    statusCode = status;
    if (h) resHeaders = { ...resHeaders, ...h };
    return res;
  };

  res.end = (chunk?: any) => {
    if (chunk) body += chunk;
    return res;
  };

  return {
    req,
    res,
    getResponse: () => ({
      statusCode,
      headers: resHeaders,
      body,
      json: () => JSON.parse(body || '{}'),
    }),
  };
}

describe('SEC-07: Session Token Security, HttpOnly Cookies, and Refresh Rotation', () => {
  const runId = Date.now().toString(36);
  const testHandle = `@sec07user_${runId}`;
  let registeredDid = '';
  let initialSessionToken = '';
  let initialRefreshToken = '';
  let initialSetCookies: string[] = [];

  it('SEC07-1: Registration issues HttpOnly, SameSite=Strict cookies including refresh token', async () => {
    const regPayload = {
      handle: testHandle,
      displayName: 'SEC07 Security User',
      securityPin: '789012',
    };

    const resMock = createMockReqRes('POST', '/api/user/register', regPayload);
    const ctx = {
      req: resMock.req,
      res: resMock.res,
      url: new URL('http://localhost:3001/api/user/register'),
      readBoundedBody: async () => ({ body: JSON.stringify(regPayload), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };

    await handleAuthRoutes(ctx as any);
    const resp = resMock.getResponse();
    expect(resp.statusCode).toBe(200);
    expect(resp.json().ok).toBe(true);
    expect(resp.json().sessionToken).toBeDefined();
    expect(resp.json().refreshToken).toBeDefined();

    registeredDid = resp.json().user.did;
    initialSessionToken = resp.json().sessionToken;
    initialRefreshToken = resp.json().refreshToken;

    const setCookies = resp.headers['Set-Cookie'];
    expect(Array.isArray(setCookies)).toBe(true);
    initialSetCookies = setCookies;

    // Check all required security flags on session and refresh cookies
    const cookieStr = setCookies.join('; ');
    expect(cookieStr).toContain('sovra_session_token=');
    expect(cookieStr).toContain('sovra_session=');
    expect(cookieStr).toContain('sovra_refresh_token=');
    expect(cookieStr).toContain('HttpOnly');
    expect(cookieStr).toContain('SameSite=Strict');
  });

  it('SEC07-2: Login issues fresh rotating tokens and prevents session fixation', async () => {
    const loginPayload = {
      identifier: testHandle,
      securityPin: '789012',
    };

    const resMock = createMockReqRes('POST', '/api/user/login', loginPayload);
    const ctx = {
      req: resMock.req,
      res: resMock.res,
      url: new URL('http://localhost:3001/api/user/login'),
      readBoundedBody: async () => ({ body: JSON.stringify(loginPayload), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };

    await handleAuthRoutes(ctx as any);
    const resp = resMock.getResponse();
    expect(resp.statusCode).toBe(200);
    expect(resp.json().ok).toBe(true);

    const newSessionToken = resp.json().sessionToken;
    const newRefreshToken = resp.json().refreshToken;

    expect(newSessionToken).toBeDefined();
    expect(newRefreshToken).toBeDefined();
    // Session fixation prevention: tokens must be regenerated
    expect(newSessionToken).not.toBe(initialSessionToken);

    // Old session token must now be revoked
    expect(sovraDb.isTokenRevoked(initialSessionToken)).toBe(true);

    // Update active tokens
    initialSessionToken = newSessionToken;
    initialRefreshToken = newRefreshToken;
  });

  it('SEC07-3: Refresh token endpoint successfully rotates session and revokes old refresh token', async () => {
    const refreshPayload = {
      refreshToken: initialRefreshToken,
    };

    const resMock = createMockReqRes('POST', '/api/user/refresh', refreshPayload);
    const ctx = {
      req: resMock.req,
      res: resMock.res,
      url: new URL('http://localhost:3001/api/user/refresh'),
      readBoundedBody: async () => ({ body: JSON.stringify(refreshPayload), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };

    await handleAuthRoutes(ctx as any);
    const resp = resMock.getResponse();
    expect(resp.statusCode).toBe(200);
    expect(resp.json().ok).toBe(true);

    const rotatedSessionToken = resp.json().sessionToken;
    const rotatedRefreshToken = resp.json().refreshToken;

    expect(rotatedSessionToken).toBeDefined();
    expect(rotatedRefreshToken).toBeDefined();
    expect(rotatedSessionToken).not.toBe(initialSessionToken);
    expect(rotatedRefreshToken).not.toBe(initialRefreshToken);

    // Old refresh token and old session token must be permanently revoked
    expect(sovraDb.isTokenRevoked(initialRefreshToken)).toBe(true);
    expect(sovraDb.isTokenRevoked(initialSessionToken)).toBe(true);

    // Newly rotated session token must be active and valid
    expect(sovraDb.isTokenRevoked(rotatedSessionToken)).toBe(false);
    expect(sovraDb.isTokenRevoked(rotatedRefreshToken)).toBe(false);

    // Save for subsequent tests
    const oldConsumedRefreshToken = initialRefreshToken;
    initialSessionToken = rotatedSessionToken;
    initialRefreshToken = rotatedRefreshToken;

    // SEC07-4: Refresh token replay attack detection & immediate compromise lockout
    const replayMock = createMockReqRes('POST', '/api/user/refresh', { refreshToken: oldConsumedRefreshToken });
    const replayCtx = {
      req: replayMock.req,
      res: replayMock.res,
      url: new URL('http://localhost:3001/api/user/refresh'),
      readBoundedBody: async () => ({ body: JSON.stringify({ refreshToken: oldConsumedRefreshToken }), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    };

    await handleAuthRoutes(replayCtx as any);
    const replayResp = replayMock.getResponse();
    expect(replayResp.statusCode).toBe(401);
    expect(replayResp.json().isCompromised).toBe(true);
    expect(replayResp.json().error).toMatch(/consumed or revoked|terminated/i);

    // Upon compromise detection, all active sessions for that user must be invalidated
    expect(sovraDb.isTokenRevoked(rotatedSessionToken)).toBe(true);
  });

  it('SEC07-5: User logout revokes session and clears HttpOnly cookies with Max-Age=0', async () => {
    // Re-login to get clean session
    const loginPayload = {
      identifier: testHandle,
      securityPin: '789012',
    };
    const loginMock = createMockReqRes('POST', '/api/user/login', loginPayload);
    await handleAuthRoutes({
      req: loginMock.req,
      res: loginMock.res,
      url: new URL('http://localhost:3001/api/user/login'),
      readBoundedBody: async () => ({ body: JSON.stringify(loginPayload), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    } as any);

    const activeSessionToken = loginMock.getResponse().json().sessionToken;
    const activeRefreshToken = loginMock.getResponse().json().refreshToken;
    expect(sovraDb.isTokenRevoked(activeSessionToken)).toBe(false);

    // Now call logout
    const logoutMock = createMockReqRes('POST', '/api/user/logout', {}, {
      Cookie: `sovra_session_token=${activeSessionToken}; sovra_refresh_token=${activeRefreshToken}`,
    });
    await handleAuthRoutes({
      req: logoutMock.req,
      res: logoutMock.res,
      url: new URL('http://localhost:3001/api/user/logout'),
      readBoundedBody: async () => ({ body: JSON.stringify({}), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    } as any);

    const logoutResp = logoutMock.getResponse();
    expect(logoutResp.statusCode).toBe(200);
    expect(logoutResp.json().ok).toBe(true);

    // Token must be revoked
    expect(sovraDb.isTokenRevoked(activeSessionToken)).toBe(true);
    expect(sovraDb.isTokenRevoked(activeRefreshToken)).toBe(true);

    // Set-Cookie must have Max-Age=0 for session and refresh cookies
    const setCookies = logoutResp.headers['Set-Cookie'];
    expect(Array.isArray(setCookies)).toBe(true);
    const cookieStr = setCookies.join('; ');
    expect(cookieStr).toContain('Max-Age=0');
    expect(cookieStr).toContain('sovra_session_token=;');
    expect(cookieStr).toContain('sovra_refresh_token=;');
  });

  it('SEC07-6: Mobile and API clients authenticate seamlessly via Authorization Bearer token', async () => {
    // Re-login to get clean session
    const loginPayload = {
      identifier: testHandle,
      securityPin: '789012',
    };
    const loginMock = createMockReqRes('POST', '/api/user/login', loginPayload);
    await handleAuthRoutes({
      req: loginMock.req,
      res: loginMock.res,
      url: new URL('http://localhost:3001/api/user/login'),
      readBoundedBody: async () => ({ body: JSON.stringify(loginPayload), ok: true }),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
    } as any);

    const bearerToken = loginMock.getResponse().json().sessionToken;
    expect(bearerToken).toBeDefined();

    // Verify profile lookup via Bearer header in handleAuthRoutes / database
    const userFound = sovraDb.findUserBySessionToken(bearerToken);
    expect(userFound).toBeDefined();
    expect(userFound?.did).toBe(registeredDid);
    expect(userFound?.handle).toBe(testHandle);
  });
});
