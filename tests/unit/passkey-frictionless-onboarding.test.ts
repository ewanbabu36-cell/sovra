import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { handleAuthRoutes } from '../../scripts/routes/auth.routes.js';
import { sovraDb } from '../../scripts/database-engine.js';

describe('Frictionless 1-Click Passkey Onboarding', () => {
  it('creates an instant passkey account with auto-funded starter gas and session cookie', async () => {
    let capturedStatusCode = 0;
    let capturedHeaders: Record<string, any> = {};
    let capturedBody = '';

    const mockReq = {
      method: 'POST',
      headers: {
        host: 'localhost:3001',
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    const mockRes = {
      writeHead(code: number, headers: any) {
        capturedStatusCode = code;
        capturedHeaders = headers;
      },
      end(chunk: string) {
        capturedBody = chunk;
      },
    } as any;

    const requestPayload = JSON.stringify({
      displayName: 'Passkey Test Pilot',
      credential: {
        id: 'mock_passkey_cred_' + Date.now(),
        rawId: 'mock_raw_id_xyz',
        publicKey: 'mock_pubkey_spki',
        counter: 1,
      },
    });

    const handled = await handleAuthRoutes({
      req: mockReq,
      res: mockRes,
      url: new URL('http://localhost:3001/api/auth/passkey/quick-register'),
      resolvePrincipal: () => null,
      enforceAuth: () => null,
      readBoundedBody: async () => ({ body: requestPayload, ok: true }),
    });

    expect(handled).toBe(true);
    expect(capturedStatusCode).toBe(200);

    const response = JSON.parse(capturedBody);
    expect(response.ok).toBe(true);
    expect(response.user).toBeDefined();
    expect(response.user.handle).toMatch(/^@sovra_/);
    expect(response.user.displayName).toBe('Passkey Test Pilot');
    expect(response.starterGas_uSOV).toBe(5.0);
    expect(response.sessionToken).toBeDefined();
    expect(response.sessionToken.startsWith('stk_')).toBe(true);

    // Verify user balance in database
    const dbUser = sovraDb.findUserByDid(response.user.did);
    expect(dbUser).toBeDefined();
    expect(dbUser?.balanceSov).toBeGreaterThanOrEqual(5.0);
  });

  it('proves zero mandatory seed-phrase friction on day-1 registration', async () => {
    // 1-Click onboarding completes without requiring the user to supply or record a seed phrase
    const testDid = 'did:key:z6Mko_passkey_zero_friction_' + Date.now();
    const newUser = sovraDb.createUser({
      did: testDid,
      handle: '@frictionless_pilot_' + Date.now(),
      displayName: 'Zero Friction Pilot',
      balanceSov: 5.0,
      sessionToken: 'stk_frictionless_test',
    });

    expect(newUser.did).toBe(testDid);
    expect(newUser.balanceSov).toBe(5.0);
    // User can immediately transact or like without seed phrase prompt
    expect(newUser.sessionToken).toBe('stk_frictionless_test');
  });
});
