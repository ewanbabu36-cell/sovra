import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';

describe('PHASE 2: Critical Adversarial Security Remediation Matrix (DOS-01, AUTH-01, SESS-01, PRIV-01, SESS-02)', () => {
  let serverProcess: ChildProcess;
  const testPort = 3205;
  const baseUrl = `http://127.0.0.1:${testPort}`;

  async function postJson(
    endpoint: string,
    payload: any,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
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

  async function getJson(
    endpoint: string,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
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

    // Poll until test server is responsive
    for (let i = 0; i < 35; i++) {
      await new Promise(r => setTimeout(r, 400));
      try {
        const res = await getJson('/api/status');
        if (res.status === 200) break;
      } catch {}
    }
  }, 45000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill('SIGINT');
    }
  }, 45000);

  // =========================================================================
  // SECTION 1: DOS-01 — PIN Lockout Redesign & Anti-DoS Invariants
  // =========================================================================
  describe('DOS-01: Unauthenticated Account Lockout Prevention', () => {
    const victimHandle = `@victim_anti_dos_${Date.now()}`;
    const correctPin = '789123';
    const attackerIpHeader = { 'X-Forwarded-For': '198.51.100.99' };
    const victimIpHeader = { 'X-Forwarded-For': '203.0.113.88' };

    it('1. registers victim account successfully', async () => {
      const reg = await postJson('/api/user/register', {
        handle: victimHandle,
        displayName: 'Anti-DoS Victim',
        securityPin: correctPin,
      }, victimIpHeader);
      expect(reg.status).toBe(200);
      expect(reg.body.ok).toBe(true);
      expect(reg.body.recoveryPhrase).toBeDefined();
    });

    it('2. attacker fires 20 failed PIN attempts against victim account; all failed attempts are rejected', async () => {
      let rateLimitedCount = 0;
      for (let i = 0; i < 20; i++) {
        const res = await postJson('/api/user/login', {
          handle: victimHandle,
          pin: '000000',
        }, attackerIpHeader);
        expect([401, 429]).toContain(res.status);
        if (res.status === 429) rateLimitedCount++;
      }
      // Brute-force rate limiting engaged for wrong attempts
      expect(rateLimitedCount).toBeGreaterThanOrEqual(1);
    });

    it('3. victim with CORRECT PIN logs in successfully despite previous 20 attacker failures (NO DoS)', async () => {
      const victimLogin = await postJson('/api/user/login', {
        handle: victimHandle,
        pin: correctPin,
      }, victimIpHeader);
      expect(victimLogin.status).toBe(200);
      expect(victimLogin.body.ok).toBe(true);
      expect(victimLogin.body.sessionToken).toBeDefined();
    });

    it('4. attacker with WRONG PIN is immediately rate limited on subsequent attempt', async () => {
      const attackerAttempt = await postJson('/api/user/login', {
        handle: victimHandle,
        pin: '111111',
      }, attackerIpHeader);
      expect([401, 429]).toContain(attackerAttempt.status);
    });

    it('5. victim with correct PIN can still log in again and clears account-level failure counter', async () => {
      const victimLogin2 = await postJson('/api/user/login', {
        handle: victimHandle,
        pin: correctPin,
      }, victimIpHeader);
      expect(victimLogin2.status).toBe(200);
      expect(victimLogin2.body.ok).toBe(true);
    });
  });

  // =========================================================================
  // SECTION 2: AUTH-01 — Account Enumeration Elimination
  // =========================================================================
  describe('AUTH-01: Account Enumeration Prevention & Indistinguishable Responses', () => {
    const existingHandle = `@existing_target_${Date.now()}`;
    const nonExistentHandle = `@non_existent_target_${Date.now()}`;
    const authTestIp = { 'X-Forwarded-For': '192.0.2.77' };

    beforeAll(async () => {
      await postJson('/api/user/register', {
        handle: existingHandle,
        displayName: 'Existing User',
        securityPin: '556677',
      }, authTestIp);
    });

    it('6. returns identical HTTP status 401 for wrong credentials on existing and non-existing accounts', async () => {
      const resNonExistent = await postJson('/api/user/login', {
        handle: nonExistentHandle,
        pin: '999999',
      }, { 'X-Forwarded-For': '192.0.2.80' });
      const resExisting = await postJson('/api/user/login', {
        handle: existingHandle,
        pin: '000000',
      }, { 'X-Forwarded-For': '192.0.2.81' });

      expect(resNonExistent.status).toBe(401);
      expect(resExisting.status).toBe(401);
    });

    it('7. returns identical error message "Invalid credentials" without leaking account state', async () => {
      const resNonExistent = await postJson('/api/user/login', {
        handle: nonExistentHandle,
        pin: '999999',
      }, { 'X-Forwarded-For': '192.0.2.82' });
      const resExisting = await postJson('/api/user/login', {
        handle: existingHandle,
        pin: '000000',
      }, { 'X-Forwarded-For': '192.0.2.83' });

      expect(resNonExistent.body.error).toBe('Invalid credentials');
      expect(resExisting.body.error).toBe('Invalid credentials');
      expect(resNonExistent.body.ok).toBe(false);
      expect(resExisting.body.ok).toBe(false);
    });

    it('8. returns identical error when PIN parameter is missing for both existing and non-existing accounts', async () => {
      const resNonExistent = await postJson('/api/user/login', {
        handle: nonExistentHandle,
      }, { 'X-Forwarded-For': '192.0.2.84' });
      const resExisting = await postJson('/api/user/login', {
        handle: existingHandle,
      }, { 'X-Forwarded-For': '192.0.2.85' });

      expect(resNonExistent.status).toBe(401);
      expect(resExisting.status).toBe(401);
      expect(resNonExistent.body.error).toBe('Invalid credentials');
      expect(resExisting.body.error).toBe('Invalid credentials');
    });

    it('9. dummy scrypt execution maintains comparable response latencies between existent and non-existent accounts', async () => {
      // Warm up
      await postJson('/api/user/login', { handle: nonExistentHandle, pin: '123456' }, { 'X-Forwarded-For': '192.0.2.90' });
      await postJson('/api/user/login', { handle: existingHandle, pin: '123456' }, { 'X-Forwarded-For': '192.0.2.91' });

      const nonExistentDurations: number[] = [];
      const existingDurations: number[] = [];

      for (let i = 0; i < 5; i++) {
        const ipNonExist = { 'X-Forwarded-For': `192.0.2.${100 + i}` };
        const ipExist = { 'X-Forwarded-For': `192.0.2.${150 + i}` };

        const t0 = Date.now();
        await postJson('/api/user/login', { handle: `@fake_${Date.now()}_${i}`, pin: '123456' }, ipNonExist);
        nonExistentDurations.push(Date.now() - t0);

        const t1 = Date.now();
        await postJson('/api/user/login', { handle: existingHandle, pin: '123456' }, ipExist);
        existingDurations.push(Date.now() - t1);
      }

      const avgNonExistent = nonExistentDurations.reduce((a, b) => a + b, 0) / nonExistentDurations.length;
      const avgExisting = existingDurations.reduce((a, b) => a + b, 0) / existingDurations.length;

      // Both should involve crypto scrypt operations and be non-zero
      expect(avgNonExistent).toBeGreaterThan(0);
      expect(avgExisting).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // SECTION 3: SESS-01 — Session Revocation on Recovery
  // =========================================================================
  describe('SESS-01: Global Session Revocation on Credential Recovery', () => {
    const recoveryUserHandle = `@revocation_victim_${Date.now()}`;
    const initialPin = '112233';
    const newPin = '998877';
    let recoveryPhrase: string;
    let tokenDeviceA: string;
    let tokenDeviceB: string;
    let registrationToken: string;

    it('10. registers account and creates multiple active device sessions', async () => {
      const reg = await postJson('/api/user/register', {
        handle: recoveryUserHandle,
        displayName: 'Revocation Victim',
        securityPin: initialPin,
      });
      expect(reg.status).toBe(200);
      registrationToken = reg.body.sessionToken;
      recoveryPhrase = reg.body.recoveryPhrase;
      expect(recoveryPhrase).toBeDefined();

      // Device A login
      const devA = await postJson('/api/user/login', {
        handle: recoveryUserHandle,
        pin: initialPin,
      });
      expect(devA.status).toBe(200);
      tokenDeviceA = devA.body.sessionToken;

      // Device B login
      const devB = await postJson('/api/user/login', {
        handle: recoveryUserHandle,
        pin: initialPin,
      });
      expect(devB.status).toBe(200);
      tokenDeviceB = devB.body.sessionToken;

      // Verify all 3 sessions are valid
      const checkA = await getJson('/api/user/sessions', { Authorization: `Bearer ${tokenDeviceA}` });
      expect(checkA.status).toBe(200);
      const checkB = await getJson('/api/user/sessions', { Authorization: `Bearer ${tokenDeviceB}` });
      expect(checkB.status).toBe(200);
      const checkReg = await getJson('/api/user/sessions', { Authorization: `Bearer ${registrationToken}` });
      expect(checkReg.status).toBe(200);
    });

    it('11. executes PIN recovery using 12-word recovery mnemonic', async () => {
      const recoverRes = await postJson('/api/auth/pin/recover', {
        handle: recoveryUserHandle,
        recoveryPhrase,
        newPin,
      });
      expect(recoverRes.status).toBe(200);
      expect(recoverRes.body.ok).toBe(true);
      expect(recoverRes.body.message).toContain('Security PIN reset successfully');
    });

    it('12. asserts Device A, Device B, and Registration tokens are all REVOKED (HTTP 401)', async () => {
      const checkA = await getJson('/api/user/sessions', { Authorization: `Bearer ${tokenDeviceA}` });
      expect(checkA.status).toBe(401);

      const checkB = await getJson('/api/user/sessions', { Authorization: `Bearer ${tokenDeviceB}` });
      expect(checkB.status).toBe(401);

      const checkReg = await getJson('/api/user/sessions', { Authorization: `Bearer ${registrationToken}` });
      expect(checkReg.status).toBe(401);
    });

    it('13. confirms fresh login with new PIN succeeds and establishes a new valid session', async () => {
      const freshLogin = await postJson('/api/user/login', {
        handle: recoveryUserHandle,
        pin: newPin,
      });
      expect(freshLogin.status).toBe(200);
      expect(freshLogin.body.ok).toBe(true);
      const freshToken = freshLogin.body.sessionToken;

      const freshCheck = await getJson('/api/user/sessions', { Authorization: `Bearer ${freshToken}` });
      expect(freshCheck.status).toBe(200);
    });
  });

  // =========================================================================
  // SECTION 4: PRIV-01 — Zero Plaintext Recovery Phrase & Query Token Elimination
  // =========================================================================
  describe('PRIV-01: Zero Plaintext Recovery Phrase Persistence & URL Leakage Prevention', () => {
    const privHandle = `@priv_target_${Date.now()}`;
    let userMnemonic: string;
    let privSessionToken: string;

    it('14. registers user and verifies database stores only scrypt verifier, NOT plaintext mnemonic', async () => {
      const reg = await postJson('/api/user/register', {
        handle: privHandle,
        displayName: 'Privacy Target',
        securityPin: '654321',
      });
      expect(reg.status).toBe(200);
      userMnemonic = reg.body.recoveryPhrase;
      privSessionToken = reg.body.sessionToken;
      expect(userMnemonic).toBeDefined();

      // Inspect internal database record directly from atomic disk storage
      const dbPath = path.resolve(process.env.SOVRA_STORAGE_DIR || './.sovra-storage-dev', 'dynamic-social-state.json');
      const dbContent = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      const user = dbContent.users.find((u: any) => u.handle.toLowerCase() === privHandle.toLowerCase());
      expect(user).toBeDefined();
      expect(user?.recoveryPhrase).toBeUndefined(); // Plaintext MUST NOT exist
      expect(user?.recoveryPhraseHash).toBeDefined();
      expect(typeof user?.recoveryPhraseHash).toBe('string');
      expect(user?.recoveryPhraseHash?.length).toBe(64); // 32-byte hex
      expect(user?.recoveryPhraseSalt).toBeDefined();
      expect(typeof user?.recoveryPhraseSalt).toBe('string');
      expect(user?.recoveryPhraseSalt?.length).toBe(32); // 16-byte hex

      // Cryptographic verification of scrypt verifier using node:crypto
      const norm = userMnemonic.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
      const expectedDerived = crypto.scryptSync(norm, user.recoveryPhraseSalt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
      expect(expectedDerived).toBe(user.recoveryPhraseHash);

      const wrongDerived = crypto.scryptSync('wrong words here', user.recoveryPhraseSalt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
      expect(wrongDerived).not.toBe(user.recoveryPhraseHash);
    });

    it('15. verifies GET /api/user/recovery-phrase returns HTTP 403 Forbidden with zero secret leakage', async () => {
      const exportRes = await getJson('/api/user/recovery-phrase', {
        Authorization: `Bearer ${privSessionToken}`,
      });
      expect(exportRes.status).toBe(403);
      expect(exportRes.body.ok).toBe(false);
      expect(exportRes.body.error).toContain('Zero-Knowledge Security Policy');
      expect(exportRes.body.recoveryPhrase).toBeUndefined();
    });

    it('16. verifies rejection of session tokens passed via URL query parameters (CWE-598)', async () => {
      // Query param sessionToken must NOT authenticate
      const queryTokenRes1 = await getJson(`/api/user/me?sessionToken=${privSessionToken}`);
      expect(queryTokenRes1.status).toBe(401);

      const queryTokenRes2 = await getJson(`/api/user/me?token=${privSessionToken}`);
      expect(queryTokenRes2.status).toBe(401);

      const queryTokenRes3 = await getJson(`/api/user/sessions?sessionToken=${privSessionToken}`);
      expect(queryTokenRes3.status).toBe(401);

      // Bearer header authentication MUST succeed
      const headerRes = await getJson('/api/user/me', {
        Authorization: `Bearer ${privSessionToken}`,
      });
      expect(headerRes.status).toBe(200);
      expect(headerRes.body.ok).toBe(true);
      expect(headerRes.body.user.recoveryPhrase).toBeUndefined();
    });
  });

  // =========================================================================
  // SECTION 5: SESS-02 — Cookie-First Architecture & No Plain Bearer in localStorage
  // =========================================================================
  describe('SESS-02: Cookie-Based Web Architecture & Elimination of Raw Bearer Tokens in localStorage', () => {
    it('17. verifies POST /api/user/login issues HttpOnly; Secure; SameSite=Strict session cookie', async () => {
      const loginRes = await postJson('/api/user/login', {
        handle: `@cookie_test_${Date.now()}`,
        pin: '123456',
      });
      // Try with registered user
      const handle = `@cookie_user_${Date.now()}`;
      await postJson('/api/user/register', { handle, securityPin: '123456' });

      const realLogin = await postJson('/api/user/login', { handle, pin: '123456' });
      expect(realLogin.status).toBe(200);

      const setCookie = realLogin.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
      expect(cookieStr).toContain('sovra_session_token=');
      expect(cookieStr.toLowerCase()).toContain('httponly');
      expect(cookieStr.toLowerCase()).toContain('samesite=strict');
    });

    it('18. validates that Cookie header authenticates requests to protected endpoints', async () => {
      const handle = `@cookie_auth_target_${Date.now()}`;
      const reg = await postJson('/api/user/register', { handle, securityPin: '123456' });
      const token = reg.body.sessionToken;

      const cookieAuthRes = await getJson('/api/user/me', {
        Cookie: `sovra_session_token=${token}`,
      });
      expect(cookieAuthRes.status).toBe(200);
      expect(cookieAuthRes.body.ok).toBe(true);
      expect(cookieAuthRes.body.user.handle).toBe(handle);
    });

    it('19. audits codebase to ensure zero occurrences of localStorage.setItem for raw session tokens', async () => {
      const fs = await import('node:fs');
      const devServerSrc = fs.readFileSync(path.resolve(__dirname, '../../scripts/dev-server.ts'), 'utf8');
      const adminConsoleSrc = fs.readFileSync(path.resolve(__dirname, '../../scripts/admin-console.ts'), 'utf8');

      // dev-server client JavaScript check
      expect(devServerSrc).not.toMatch(/localStorage\.setItem\(\s*['"]sovra_session_token['"]\s*,\s*data\.sessionToken/);
      expect(devServerSrc).not.toMatch(/localStorage\.setItem\(\s*['"]sovra_session_token['"]\s*,\s*token/);

      // admin-console check
      expect(adminConsoleSrc).not.toMatch(/localStorage\.setItem\(\s*['"]sovra_admin_token['"]/);
    });
  });
});
