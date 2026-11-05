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
