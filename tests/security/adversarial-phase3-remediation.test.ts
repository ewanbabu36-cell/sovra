import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { validateBip39Mnemonic, BIP39_ENGLISH_WORDLIST } from '@sovra/crypto';
import { SovraDatabaseEngine } from '../../scripts/database-engine.ts';

describe('PHASE 3: Final Security Hardening & Zero-Trust Adversarial Suite (AUTH-01, PRIV-01, SESS-02)', () => {
  let serverProcess: ChildProcess;
  const testPort = 3208;
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
    process.env.SOVRA_THROTTLE_SECRET = 'test-throttle-secret-key-32-chars-long-entropy-ok!';
    const env: Record<string, string | undefined> = {
      ...process.env,
      PORT: String(testPort),
      SOVRA_DISABLE_HTTPS: 'true',
      SOVRA_THROTTLE_SECRET: 'test-throttle-secret-key-32-chars-long-entropy-ok!',
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
  // SECTION 1: AUTH-01 — Multi-Shot Account Enumeration Elimination
  // =========================================================================
  describe('AUTH-01: Multi-Shot Account Enumeration Elimination & Indistinguishable Response Dynamics', () => {
    const existingHandle = `@p3_user_${Date.now()}`;
    const nonExistentHandle = `@p3_ghost_${Date.now()}`;
    const correctPin = '654321';
    let userDid = '';

    beforeAll(async () => {
      const regRes = await postJson('/api/user/register', {
        handle: existingHandle,
        name: 'Phase 3 Test User',
        securityPin: correctPin,
      });
      expect(regRes.status).toBe(200);
      expect(regRes.body.ok).toBe(true);
      userDid = regRes.body.user.did;
    });

    it('1. verifies identical multi-shot 401->429 transition curve across distributed IPs', async () => {
      const existingResponses: Array<{ status: number; error: string; len: number }> = [];
      const nonExistentResponses: Array<{ status: number; error: string; len: number }> = [];

      // 20 requests against existing handle from 20 distinct IPs
      for (let i = 1; i <= 20; i++) {
        const ip = `192.168.10.${i}`;
        const res = await postJson('/api/user/login', {
          handle: existingHandle,
          pin: '000000', // incorrect PIN
        }, { 'x-forwarded-for': ip });
        const bodyStr = JSON.stringify(res.body);
        existingResponses.push({ status: res.status, error: res.body.error, len: bodyStr.length });
      }

      // 20 requests against non-existent handle from 20 distinct IPs
      for (let i = 1; i <= 20; i++) {
        const ip = `192.168.20.${i}`;
        const res = await postJson('/api/user/login', {
          handle: nonExistentHandle,
          pin: '000000', // incorrect PIN
        }, { 'x-forwarded-for': ip });
        const bodyStr = JSON.stringify(res.body);
        nonExistentResponses.push({ status: res.status, error: res.body.error, len: bodyStr.length });
      }

      // Assert identical status transition curve
      for (let i = 0; i < 20; i++) {
        const exist = existingResponses[i]!;
        const nonExist = nonExistentResponses[i]!;

        // Exact status equality
        expect(exist.status).toBe(nonExist.status);

        // Exact error message equality
        expect(exist.error).toBe(nonExist.error);

        // Exact response length equality
        expect(exist.len).toBe(nonExist.len);

        // First 4 attempts: 401
        if (i < 4) {
          expect(exist.status).toBe(401);
          expect(exist.error).toBe('Invalid credentials');
        } else {
          // 5th attempt onwards: 429
          expect(exist.status).toBe(429);
          expect(exist.error).toContain('Account authentication rate-limited');
        }
      }
    });

    it('2. preserves DOS-01: legitimate user can immediately authenticate with correct PIN during attack', async () => {
      // Attempt login with CORRECT PIN while account is throttled
      const legitimateLogin = await postJson('/api/user/login', {
        handle: existingHandle,
        pin: correctPin,
      }, { 'x-forwarded-for': '10.0.0.99' });

      expect(legitimateLogin.status).toBe(200);
      expect(legitimateLogin.body.ok).toBe(true);
      expect(legitimateLogin.body.user.did).toBe(userDid);

      // Verify cookie is issued
      const cookie = legitimateLogin.headers['set-cookie']?.[0];
      expect(cookie).toContain('sovra_session_token=');
      expect(cookie).toContain('HttpOnly');
    });

    it('3. protects single IP against credential stuffing across multiple targets', async () => {
      const attackingIp = '172.16.50.1';

      // Send 10 failed attempts from same IP across 10 random targets
      let lastStatus = 0;
      let lastError = '';
      for (let i = 1; i <= 11; i++) {
        const res = await postJson('/api/user/login', {
          handle: `@stuffing_target_${i}`,
          pin: '000000',
        }, { 'x-forwarded-for': attackingIp });
        lastStatus = res.status;
        lastError = res.body.error;
      }

      expect(lastStatus).toBe(429);
      expect(lastError).toContain('Too many failed authentication attempts from this IP address');
    });

    it('3a. handles burst of concurrent failed requests and atomically reaches 429 rate-limit threshold', async () => {
      const concurrentTarget = `@burst_target_${Date.now()}`;
      // Send 10 concurrent failed requests from 10 distinct IPs
      const promises = Array.from({ length: 10 }, (_, i) => {
        return postJson('/api/user/login', {
          handle: concurrentTarget,
          pin: '000000',
        }, { 'x-forwarded-for': `192.168.99.${i + 1}` });
      });

      const results = await Promise.all(promises);
      const statuses = results.map(r => r.status);
      const errors = results.map(r => r.body.error);

      // Confirm all returned either 401 or 429
      for (const st of statuses) {
        expect([401, 429]).toContain(st);
      }
      // At least 5 requests must be rate-limited (429)
      const throttledCount = statuses.filter(s => s === 429).length;
      expect(throttledCount).toBeGreaterThanOrEqual(5);

      // Subsequent request is definitely throttled (429)
      const followUp = await postJson('/api/user/login', {
        handle: concurrentTarget,
        pin: '000000',
      }, { 'x-forwarded-for': '192.168.99.200' });
      expect(followUp.status).toBe(429);
      expect(followUp.body.error).toContain('Account authentication rate-limited');
    });

    it('3b. verifies genuine HMAC-SHA256 derivation and secret dependency', () => {
      const db = new SovraDatabaseEngine();
      const secretA = 'secret-a-cryptographically-random-key-32chars!';
      const secretB = 'secret-b-cryptographically-random-key-32chars!';

      const keyA1 = db.getTargetThrottleKey('@alice', secretA);
      const keyA2 = db.getTargetThrottleKey('alice', secretA);
      const keyA3 = db.getTargetThrottleKey('  @Alice  ', secretA);
      const keyB = db.getTargetThrottleKey('@alice', secretB);

      // 1. Consistency across casing, whitespace, and leading @
      expect(keyA1).toBe(keyA2);
      expect(keyA1).toBe(keyA3);

      // 2. Secret dependency: different secrets MUST yield completely different HMAC throttle keys
      expect(keyA1).not.toBe(keyB);

      // 3. Mathematical HMAC-SHA256 equivalence check
      const manualHmac = 'target_th_' + crypto.createHmac('sha256', secretA).update('sovra_target_throttle_v1:@alice').digest('hex').slice(0, 32);
      expect(keyA1).toBe(manualHmac);
    });

    it('3c. validates throttle secret strength and strictly rejects missing/insecure secrets (no silent fallback)', () => {
      const db = new SovraDatabaseEngine();

      // 1. Missing secret
      expect(SovraDatabaseEngine.validateThrottleSecret(undefined).valid).toBe(false);
      expect(SovraDatabaseEngine.validateThrottleSecret('').valid).toBe(false);

      // 2. Too short (<32 chars)
      expect(SovraDatabaseEngine.validateThrottleSecret('short_secret_under_32').valid).toBe(false);

      // 3. Insecure default constants
      expect(SovraDatabaseEngine.validateThrottleSecret('sovra_target_throttle_salt_v3:').valid).toBe(false);
      expect(SovraDatabaseEngine.validateThrottleSecret('password').valid).toBe(false);
      expect(SovraDatabaseEngine.validateThrottleSecret('12345678901234567890123456789012').valid).toBe(false);

      // 4. Valid secret
      expect(SovraDatabaseEngine.validateThrottleSecret('a_valid_cryptographic_secret_with_32_characters!').valid).toBe(true);

      // 5. Engine refusal to fall back to a public constant
      const unconfiguredDb = new SovraDatabaseEngine();
      delete process.env.SOVRA_THROTTLE_SECRET;
      delete process.env.SOVRA_THROTTLE_SECRET_ROTATION;
      unconfiguredDb.loadThrottleSecrets();
      expect(() => unconfiguredDb.getTargetThrottleKey('@target')).toThrow(/Refusing to fall back to a public constant/);

      // Restore secret for remaining tests
      process.env.SOVRA_THROTTLE_SECRET = 'test-throttle-secret-key-32-chars-long-entropy-ok!';
    });

    it('3d. verifies safe secret rotation: persists active throttle state and clears both keys on success', () => {
      const db = new SovraDatabaseEngine();
      const secretV1 = 'throttle-secret-version-1-initial-32-chars-ok!';
      const secretV2 = 'throttle-secret-version-2-rotated-32-chars-ok!';

      db.loadThrottleSecrets(secretV1);
      const targetUser = `@rot_target_${Date.now()}`;

      // Simulate 4 failed attempts under Secret V1
      const keyV1 = db.getTargetThrottleKey(targetUser);
      for (let i = 0; i < 4; i++) {
        db.recordFailedPinAttempt(keyV1);
      }
      expect(db.getFailedPinAttempts(keyV1).attempts).toBe(4);

      // Rotate to Secret V2
      db.rotateThrottleSecret(secretV2);
      expect(db.getPrimaryThrottleSecret()).toBe(secretV2);
      expect(db.getRotatedThrottleSecrets()).toContain(secretV1);

      const keyV2 = db.getTargetThrottleKey(targetUser);
      expect(keyV2).not.toBe(keyV1);

      // Register test account with hashed PIN
      const user = db.createUser({
        did: `did:sovra:user_rot_${Date.now()}`,
        handle: targetUser,
        displayName: 'Rotation Target',
        securityPinHash: db.hashSecurityPin('888888'),
      });

      // 5th attempt under rotated secret V2 should inherit V1 failures and trigger throttle (429)
      const fifthAttempt = db.loginUser(targetUser, 'Mobile Node', '192.168.1.50', 'TestAgent', { pin: '000000' });
      expect(fifthAttempt.ok).toBe(false);
      expect(fifthAttempt.isLocked).toBe(true); // Throttled! Attacker cannot bypass by secret rotation

      // Legitimate user enters correct PIN: must authenticate and clear BOTH V1 and V2 throttle keys
      const legitimateLogin = db.loginUser(targetUser, 'Mobile Node', '192.168.1.99', 'TestAgent', { pin: '888888' });
      expect(legitimateLogin.ok).toBe(true);

      // Verify both V1 and V2 throttle records are cleared
      expect(db.getFailedPinAttempts(keyV1).attempts).toBe(0);
      expect(db.getFailedPinAttempts(keyV2).attempts).toBe(0);
    });

    it('3e. confirms zero public SHA256-based throttle identifiers remain in source files', () => {
      const dbEngineContent = fs.readFileSync(path.resolve(__dirname, '../../scripts/database-engine.ts'), 'utf8');

      // Check that the legacy public salt is completely eliminated
      expect(dbEngineContent).not.toContain('sovra_target_throttle_salt_v3');
      expect(dbEngineContent).not.toContain('sovra_target_throttle_salt');
      expect(dbEngineContent).toContain("crypto.createHmac('sha256'");
    });
  });

  // =========================================================================
  // SECTION 2: PRIV-01 — Recovery Phrase Standardization & Backward Compatibility
  // =========================================================================
  describe('PRIV-01: Standard BIP-39 Entropy, Checksum Validation & Scrypt Verifier', () => {
    it('4. generates 128-bit BIP-39 mnemonic with valid checksum on registration', async () => {
      const regRes = await postJson('/api/user/register', {
        handle: `@bip39_reg_${Date.now()}`,
        name: 'BIP39 Registrant',
        securityPin: '123456',
      });
      expect(regRes.status).toBe(200);
      expect(regRes.body.ok).toBe(true);

      const phrase = regRes.body.recoveryPhrase;
      expect(typeof phrase).toBe('string');

      const words = phrase.split(' ');
      expect(words.length).toBe(12);

      // Verify every word is from the official 2048-word dictionary
      for (const w of words) {
        expect(BIP39_ENGLISH_WORDLIST).toContain(w);
      }

      // Verify standard BIP-39 SHA-256 checksum
      expect(validateBip39Mnemonic(phrase)).toBe(true);
    });

    it('5. strictly validates BIP-39 checksum and rejects corrupted phrases', () => {
      // Official BIP-39 test vector (valid)
      const validVector = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      expect(validateBip39Mnemonic(validVector)).toBe(true);

      // Corrupted 12th word (bad checksum)
      const badChecksum = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
      expect(validateBip39Mnemonic(badChecksum)).toBe(false);

      // Word substitution (invalidates checksum)
      const subWord = 'zoo abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      expect(validateBip39Mnemonic(subWord)).toBe(false);

      // Word reordering (invalidates checksum)
      const reordered = 'about abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
      expect(validateBip39Mnemonic(reordered)).toBe(false);
    });

    it('6. verifies salted scrypt verifier parameters and no plaintext in active storage', () => {
      const db = new SovraDatabaseEngine();
      const testPhrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

      const { hash, salt } = db.hashRecoveryPhrase(testPhrase);
      expect(hash.length).toBe(64); // 32 bytes hex = 64 hex chars
      expect(salt.length).toBe(32); // 16 bytes hex = 32 hex chars

      // Verify constant-time match
      expect(db.verifyRecoveryPhrase(testPhrase, hash, salt)).toBe(true);

      // Verify wrong phrase rejection
      expect(db.verifyRecoveryPhrase('wrong phrase test for verification failure on bad mnemonic input here now', hash, salt)).toBe(false);
    });

    it('7. maintains 100% backward compatibility for legacy phrases via scrypt verifier', () => {
      const db = new SovraDatabaseEngine();
      // A legacy 196-word phrase that might not be a standard BIP39 checksum
      const legacyPhrase = 'matrix nexus pulse orbit enclave cipher abandon ability able about above absent';
      const { hash, salt } = db.hashRecoveryPhrase(legacyPhrase);

      // Create a legacy user with scrypt verifier
      const user = db.createUser({
        did: 'did:sovra:legacy_compat_user',
        handle: '@legacy_compat_user',
        displayName: 'Legacy User',
        securityPin: '111111',
      });
      user.recoveryPhraseHash = hash;
      user.recoveryPhraseSalt = salt;
      delete user.recoveryPhrase;

      // Reset PIN using the legacy phrase
      const resetResult = db.resetSecurityPinWithRecoveryPhrase('@legacy_compat_user', legacyPhrase, '222222');
      expect(resetResult.ok).toBe(true);

      // Verify new PIN works
      expect(db.verifySecurityPin('222222', user.securityPinHash!)).toBe(true);
      expect(db.verifySecurityPin('111111', user.securityPinHash!)).toBe(false);
    });

    it('8. disclaims Zero-Knowledge terminology in recovery policy', async () => {
      const getRes = await getJson('/api/user/recovery-phrase');
      expect(getRes.status).toBe(403);
      expect(getRes.body.error).toContain('Passphrase Security Policy');
      expect(getRes.body.error).not.toContain('Zero-Knowledge');
    });
  });

  // =========================================================================
  // SECTION 3: SESS-02 — Elimination of Dead Query-String Token Code
  // =========================================================================
  describe('SESS-02: Elimination of Query-String Tokens & Cookie-First Enforcement', () => {
    it('9. confirms 0 occurrences of sessionToken= or token= URL construction in client codebase', () => {
      const devServerContent = fs.readFileSync(path.resolve(__dirname, '../../scripts/dev-server.ts'), 'utf8');

      // Check for dead patterns in client-side script tags
      expect(devServerContent).not.toMatch(/sessionToken=\s*'\s*\+/);
      expect(devServerContent).not.toMatch(/sessionToken=\s*"\s*\+/);
      expect(devServerContent).not.toMatch(/\?sessionToken=/);
      expect(devServerContent).not.toMatch(/\&sessionToken=/);
      expect(devServerContent).not.toMatch(/EventSource\([^)]*\?token=/);
    });

    it('10. confirms 0 occurrences of sessionToken= or token= in generated client bundle', () => {
      const bundlePath = path.resolve(__dirname, '../../apps/sovra-app/dist/bundle.js');
      if (fs.existsSync(bundlePath)) {
        const bundle = fs.readFileSync(bundlePath, 'utf8');
        expect(bundle).not.toContain('sessionToken=');
        expect(bundle).not.toMatch(/\?token=/);
        expect(bundle).not.toMatch(/\&token=/);
      }
    });

    it('11. verifies URL query parameters are strictly rejected for authentication', async () => {
      const reg = await postJson('/api/user/register', {
        handle: `@query_token_reject_${Date.now()}`,
        name: 'Query Reject User',
        securityPin: '123456',
      });
      const token = reg.body.sessionToken;
      expect(token).toBeTruthy();

      // Passing token via query parameter MUST be rejected
      const meQuery1 = await getJson(`/api/user/me?sessionToken=${token}`);
      expect(meQuery1.status).toBe(401);

      const meQuery2 = await getJson(`/api/user/me?token=${token}`);
      expect(meQuery2.status).toBe(401);

      // Passing token via Bearer header MUST succeed
      const meBearer = await getJson('/api/user/me', {
        Authorization: `Bearer ${token}`,
      });
      expect(meBearer.status).toBe(200);
      expect(meBearer.body.ok).toBe(true);

      // Passing token via HttpOnly cookie MUST succeed
      const meCookie = await getJson('/api/user/me', {
        Cookie: `sovra_session_token=${token}`,
      });
      expect(meCookie.status).toBe(200);
      expect(meCookie.body.ok).toBe(true);
    });

    it('12. verifies security response headers prevent token leakage (Referrer-Policy & nosniff)', async () => {
      const loginRes = await postJson('/api/user/login', {
        handle: '@nonexistent_target_header_check',
        pin: '123456',
      });
      expect(loginRes.headers['referrer-policy']).toBe('no-referrer');
      expect(loginRes.headers['x-content-type-options']).toBe('nosniff');
    });
  });
});
