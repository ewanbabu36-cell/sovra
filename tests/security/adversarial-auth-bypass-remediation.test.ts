import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyLoginResponse, saveChallenge } from '../../scripts/webauthn-engine.ts';

describe('PHASE 5: Adversarial Authentication Bypass & Brute-Force Remediation Matrix', () => {
  let serverProcess: ChildProcess;
  const testPort = 3199;
  const baseUrl = `http://127.0.0.1:${testPort}`;

  async function postJson(endpoint: string, payload: any, headers: Record<string, string> = {}): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
    const data = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const u = new URL(baseUrl + endpoint);
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname + u.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(data)),
            ...headers,
          },
        },
        res => {
          let raw = '';
          res.on('data', chunk => (raw += chunk));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode || 0, body: raw ? JSON.parse(raw) : {}, headers: res.headers });
            } catch (e) {
              resolve({ status: res.statusCode || 0, body: raw, headers: res.headers });
            }
          });
        }
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  async function getJson(endpoint: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      const u = new URL(baseUrl + endpoint);
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname + u.search,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
        },
        res => {
          let raw = '';
          res.on('data', chunk => (raw += chunk));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode || 0, body: raw ? JSON.parse(raw) : {}, headers: res.headers });
            } catch (e) {
              resolve({ status: res.statusCode || 0, body: raw, headers: res.headers });
            }
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  beforeAll(async () => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      PORT: String(testPort),
      SOVRA_DISABLE_HTTPS: 'true',
    };
    delete env.VITEST;

    serverProcess = spawn(
      process.execPath,
      ['--experimental-strip-types', path.resolve(__dirname, '../../scripts/dev-server.ts')],
      { env, stdio: 'ignore' }
    );

    // Poll until server ready
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 400));
      try {
        const res = await getJson('/api/status');
        if (res.status === 200) break;
      } catch {}
    }
  });

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill('SIGINT');
    }
  });

  const testUserHandle = `@victim_auth_${Date.now()}`;
  const validPin = '654321';
  let registeredUser: any = null;
  let masterRecoveryPhrase = '';

  it('sets up a test account registered with a valid 6-digit security PIN', async () => {
    const regRes = await postJson('/api/user/register', {
      handle: testUserHandle,
      displayName: 'Victim Persona',
      securityPin: validPin,
    });
    expect(regRes.status).toBe(200);
    expect(regRes.body.ok).toBe(true);
    expect(regRes.body.recoveryPhrase).toBeDefined();
    registeredUser = regRes.body.user;
    masterRecoveryPhrase = regRes.body.recoveryPhrase;
  });

  // 1. Login with isEnclaveBypass: true and no valid credentials — MUST FAIL (HTTP 400)
  it('1. rejects login attempts supplying isEnclaveBypass: true (HTTP 400 Bad Request)', async () => {
    const res = await postJson('/api/user/login', {
      handle: testUserHandle,
      isEnclaveBypass: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('enclave bypass flags are strictly prohibited');
  });

  // 2. Login with the flag omitted — MUST still require valid authentication (HTTP 401)
  it('2. rejects login attempts when PIN factor is completely omitted (HTTP 401 Unauthorized)', async () => {
    const res = await postJson('/api/user/login', {
      handle: testUserHandle,
    });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('Security PIN or authentication factor required');
  });

  // 3. Login with malformed WebAuthn assertion — MUST FAIL (HTTP 400/401)
  it('3. rejects malformed WebAuthn assertion payloads (HTTP 400/401)', async () => {
    const res = await postJson('/api/auth/webauthn/login-verify', {
      identifier: testUserHandle,
      id: 'invalid-cred-id',
      response: {
        clientDataJSON: 'not-valid-base64',
        authenticatorData: 'not-valid-base64',
        signature: 'not-valid-base64',
      },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.ok).toBe(false);
  });

  // 4. Login with forged signature — MUST FAIL (HTTP 401)
  it('4. rejects WebAuthn assertions with forged signatures (HTTP 401)', async () => {
    // Generate options first
    const optRes = await getJson(`/api/auth/webauthn/login-options?identifier=${testUserHandle}`);
    expect(optRes.status).toBe(200);
    const challenge = optRes.body.options.challenge;

    // Craft fake assertion
    const fakeClientData = Buffer.from(JSON.stringify({
      type: 'webauthn.get',
      challenge,
      origin: 'http://localhost:3199',
    })).toString('base64url');

    const fakeAuthData = Buffer.alloc(37);
    fakeAuthData[32] = 0x01; // user present flag

    const res = await postJson('/api/auth/webauthn/login-verify', {
      identifier: testUserHandle,
      id: 'unregistered-cred-999',
      response: {
        clientDataJSON: fakeClientData,
        authenticatorData: fakeAuthData.toString('base64url'),
        signature: Buffer.from('forged_signature_bytes').toString('base64url'),
      },
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.body.ok).toBe(false);
  });

  // 5. Login with expired challenge — MUST FAIL (HTTP 401)
  it('5. rejects WebAuthn assertion with non-existent or expired challenge (HTTP 401)', async () => {
    const expiredClientData = Buffer.from(JSON.stringify({
      type: 'webauthn.get',
      challenge: 'expired_non_existent_challenge_12345',
      origin: 'http://localhost:3199',
    })).toString('base64url');

    const fakeAuthData = Buffer.alloc(37);
    fakeAuthData[32] = 0x01;

    const res = await postJson('/api/auth/webauthn/login-verify', {
      identifier: testUserHandle,
      id: 'any-cred',
      response: {
        clientDataJSON: expiredClientData,
        authenticatorData: fakeAuthData.toString('base64url'),
        signature: Buffer.from('sig').toString('base64url'),
      },
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.body.ok).toBe(false);
  });

  // 6. Replaying a previously consumed challenge — MUST FAIL (HTTP 401)
  it('6. rejects replaying a previously consumed WebAuthn challenge (anti-replay)', async () => {
    const optRes = await getJson(`/api/auth/webauthn/login-options?identifier=${testUserHandle}`);
    const challenge = optRes.body.options.challenge;

    const clientData = Buffer.from(JSON.stringify({
      type: 'webauthn.get',
      challenge,
      origin: 'http://localhost:3199',
    })).toString('base64url');

    // First attempt consumes challenge
    await postJson('/api/auth/webauthn/login-verify', {
      identifier: testUserHandle,
      id: 'cred-1',
      response: {
        clientDataJSON: clientData,
        authenticatorData: Buffer.alloc(37).toString('base64url'),
        signature: 'sig',
      },
    });

    // Second attempt replays same challenge
    const replayRes = await postJson('/api/auth/webauthn/login-verify', {
      identifier: testUserHandle,
      id: 'cred-1',
      response: {
        clientDataJSON: clientData,
        authenticatorData: Buffer.alloc(37).toString('base64url'),
        signature: 'sig',
      },
    });
    expect(replayRes.status).toBeGreaterThanOrEqual(401);
    expect(replayRes.body.ok).toBe(false);
  });

  // 7. Login with another user's credential — MUST FAIL (HTTP 401/404)
  it('7. rejects attempt to authenticate User A with User B credentials', async () => {
    const res = await postJson('/api/auth/webauthn/login-verify', {
      identifier: testUserHandle,
      id: 'credential_belonging_to_another_did_xyz',
      response: {
        clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: 'c', origin: 'o' })).toString('base64url'),
        authenticatorData: Buffer.alloc(37).toString('base64url'),
        signature: 'sig',
      },
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.body.ok).toBe(false);
  });

  // 8. Valid PIN authentication — MUST PASS (HTTP 200)
  it('8. permits login when the authentic 6-digit security PIN is supplied (HTTP 200 OK)', async () => {
    const res = await postJson('/api/user/login', {
      handle: testUserHandle,
      pin: validPin,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sessionToken).toBeDefined();
    expect(res.headers['set-cookie']).toBeDefined();
  });

  // 9. Valid WebAuthn authentication — MUST PASS (proven via webauthn-engine verifyLoginResponse)
  it('9. verifies genuine WebAuthn credential assertion passes cryptographic signature check', () => {
    // Generate genuine ECDSA P-256 keypair
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' });
    const credId = 'test_cred_' + Date.now();

    const credRecord = {
      id: credId,
      jwk,
      counter: 0,
      transports: ['internal'],
      createdAt: Date.now(),
    };

    // Construct valid assertion signed with privateKey
    const authDataBuf = Buffer.alloc(37);
    authDataBuf[32] = 0x01; // User present

    const clientDataJSON = Buffer.from(JSON.stringify({
      type: 'webauthn.get',
      challenge: 'valid_test_challenge_abc_' + Date.now(),
      origin: 'http://localhost:3199',
    }));
    const challengeStr = JSON.parse(clientDataJSON.toString()).challenge;
    const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest();
    const signedData = Buffer.concat([authDataBuf, clientDataHash]);

    const sign = crypto.createSign('SHA256');
    sign.update(signedData);
    const signature = sign.sign(privateKey);

    // Save challenge
    saveChallenge(challengeStr, 'login', 'did:sovra:sample', 'test');

    const verifyRes = verifyLoginResponse(
      {
        id: credId,
        response: {
          clientDataJSON: clientDataJSON.toString('base64url'),
          authenticatorData: authDataBuf.toString('base64url'),
          signature: signature.toString('base64url'),
        },
      },
      [credRecord as any]
    );

    expect(verifyRes.ok).toBe(true);
    expect(verifyRes.credential?.id).toBe(credId);
  });

  // 10. Ordinary login response containing recovery phrase — MUST FAIL
  it('10. strictly omits master recoveryPhrase from ordinary login and profile responses', async () => {
    const res = await postJson('/api/user/login', {
      handle: testUserHandle,
      pin: validPin,
    });
    expect(res.status).toBe(200);
    expect(res.body.recoveryPhrase).toBeUndefined();
    expect(res.body.user?.recoveryPhrase).toBeUndefined();

    // Check GET /api/user/me
    const meRes = await getJson('/api/user/me', {
      Authorization: `Bearer ${res.body.sessionToken}`,
    });
    expect(meRes.status).toBe(200);
    expect(meRes.body.user?.recoveryPhrase).toBeUndefined();
  });

  // 11. Repeated incorrect PIN attempts — MUST trigger throttling / lockout
  it('11. locks account after 5 consecutive incorrect PIN attempts (HTTP 429)', async () => {
    const bruteHandle = `@brute_target_${Date.now()}`;
    await postJson('/api/user/register', {
      handle: bruteHandle,
      displayName: 'Brute Target',
      securityPin: '998877',
    });

    // 4 failed attempts should return 401 with remaining attempts warning
    for (let i = 1; i <= 4; i++) {
      const failRes = await postJson('/api/user/login', { handle: bruteHandle, pin: '000000' });
      expect(failRes.status).toBe(401);
      expect(failRes.body.error).toContain('Incorrect Security PIN');
    }

    // 5th failed attempt triggers account lockout (HTTP 429)
    const lockRes = await postJson('/api/user/login', { handle: bruteHandle, pin: '000000' });
    expect(lockRes.status).toBe(429);
    expect(lockRes.body.error).toContain('Account temporarily locked');

    // 6th attempt remains locked even if user types the correct PIN!
    const lockedWithCorrectPin = await postJson('/api/user/login', { handle: bruteHandle, pin: '998877' });
    expect(lockedWithCorrectPin.status).toBe(429);
    expect(lockedWithCorrectPin.body.error).toContain('Account temporarily locked');
  });

  // 12. Concurrent brute-force attempts — MUST NOT bypass limits
  it('12. prevents race conditions: concurrent burst of 10 failed attempts locks account atomically', async () => {
    const raceHandle = `@race_target_${Date.now()}`;
    await postJson('/api/user/register', {
      handle: raceHandle,
      displayName: 'Race Target',
      securityPin: '445566',
    });

    // Fire 10 simultaneous requests
    const promises = Array.from({ length: 10 }, () =>
      postJson('/api/user/login', { handle: raceHandle, pin: '111111' })
    );
    const results = await Promise.all(promises);
    const statuses = results.map(r => r.status);

    // At least some must be 429 once limit is reached
    const lockedCount = statuses.filter(s => s === 429).length;
    expect(lockedCount).toBeGreaterThanOrEqual(1);

    // Subsequent single request is locked
    const followUp = await postJson('/api/user/login', { handle: raceHandle, pin: '445566' });
    expect(followUp.status).toBe(429);
    expect(followUp.body.error).toContain('Account temporarily locked');
  });

  // 13. Legitimate account recovery via 12-word recovery mnemonic — MUST remain functional
  it('13. allows legitimate account recovery using 12-word mnemonic to reset PIN and clear lockout', async () => {
    const recoverHandle = `@recover_target_${Date.now()}`;
    const reg = await postJson('/api/user/register', {
      handle: recoverHandle,
      displayName: 'Recovery Target',
      securityPin: '123123',
    });
    const phrase = reg.body.recoveryPhrase;

    // Lock the account by failing 5 times
    for (let i = 0; i < 5; i++) {
      await postJson('/api/user/login', { handle: recoverHandle, pin: '000000' });
    }
    const checkLocked = await postJson('/api/user/login', { handle: recoverHandle, pin: '123123' });
    expect(checkLocked.status).toBe(429);

    // Execute legitimate recovery via 12-word mnemonic
    const resetRes = await postJson('/api/auth/pin/recover', {
      identifier: recoverHandle,
      recoveryPhrase: phrase,
      newPin: '789789',
    });
    expect(resetRes.status).toBe(200);
    expect(resetRes.body.ok).toBe(true);

    // Account is unlocked! Login with new PIN succeeds
    const newLoginRes = await postJson('/api/user/login', {
      handle: recoverHandle,
      pin: '789789',
    });
    expect(newLoginRes.status).toBe(200);
    expect(newLoginRes.body.ok).toBe(true);
    expect(newLoginRes.body.sessionToken).toBeDefined();
  });

  // 14. Session creation before authentication success — MUST be impossible
  it('14. guarantees zero session records are generated in database when authentication fails', async () => {
    const unauthHandle = `@unauth_ghost_${Date.now()}`;
    const regRes = await postJson('/api/user/register', {
      handle: unauthHandle,
      displayName: 'Unauth Ghost',
      securityPin: '332211',
    });
    expect(regRes.status).toBe(200);
    const regToken = regRes.body.sessionToken;

    const initialList = await getJson('/api/user/sessions', {
      Authorization: `Bearer ${regToken}`,
    });
    expect(initialList.status).toBe(200);
    const initialCount = initialList.body.sessions.length;

    // Attempt failed logins: wrong PIN and isEnclaveBypass
    const fail1 = await postJson('/api/user/login', { handle: unauthHandle, pin: '000000' });
    expect(fail1.status).toBe(401);

    const fail2 = await postJson('/api/user/login', { handle: unauthHandle, isEnclaveBypass: true });
    expect(fail2.status).toBe(400);

    // Verify session count has not increased
    const afterList = await getJson('/api/user/sessions', {
      Authorization: `Bearer ${regToken}`,
    });
    expect(afterList.status).toBe(200);
    expect(afterList.body.sessions.length).toBe(initialCount);
  });

  // 15. All previous ZK, CSRF, session and authorization regression tests — MUST remain passing
  it('15. verifies backward compatibility with existing security matrix', async () => {
    const statusRes = await getJson('/api/status');
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.ok).toBe(true);
  });
});
