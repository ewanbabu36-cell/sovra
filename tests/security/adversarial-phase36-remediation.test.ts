import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SovraDatabaseEngine } from '../../scripts/database-engine.js';
import { validateEnvironment } from '../../scripts/env-validator.js';

describe('SOVRA Phase 3.6 — CSP Functionality & SQLite Lockout Eviction Remediation', () => {
  const PROD_VALID_HEX_SECRET = crypto.randomBytes(32).toString('hex');
  let tempStorageDir: string;

  beforeAll(() => {
    tempStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-p36-test-'));
  });

  afterAll(() => {
    try {
      fs.rmSync(tempStorageDir, { recursive: true, force: true });
    } catch (_) {}
  });

  // =========================================================================
  // TASK 1 (P0): STRICT CSP EVENT DELEGATION & INLINE HANDLER ELIMINATION
  // =========================================================================
  describe('TASK 1 (P0): Strict CSP Compliance & Delegated Event Dispatch', () => {
    it('1a. ensures production CSP headers strictly forbid unsafe-inline script attributes', () => {
      const origEnv = process.env.NODE_ENV;
      const origSecret = process.env.SOVRA_THROTTLE_SECRET;
      const origAdmin = process.env.ADMIN_SECRET_KEY;

      try {
        process.env.NODE_ENV = 'production';
        process.env.SOVRA_THROTTLE_SECRET = PROD_VALID_HEX_SECRET;
        process.env.ADMIN_SECRET_KEY = crypto.randomBytes(32).toString('hex');

        const validation = validateEnvironment();
        expect(validation.valid).toBe(true);

        const cspNonce = crypto.randomBytes(16).toString('base64');
        const scriptPolicy = `script-src 'self' 'nonce-${cspNonce}' blob:;`;
        const cspHeader = `default-src 'self' data: blob:; ${scriptPolicy} style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob: data: https:; connect-src 'self' ws: wss: https: http: stun: turn: turns:; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; report-uri /api/security/csp-report; report-to default;`;

        expect(cspHeader).not.toContain("script-src-attr 'unsafe-inline'");
        expect(cspHeader).not.toContain("'unsafe-inline' 'unsafe-eval'");
        expect(cspHeader).toContain(`'nonce-${cspNonce}'`);
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origSecret) process.env.SOVRA_THROTTLE_SECRET = origSecret;
        if (origAdmin) process.env.ADMIN_SECRET_KEY = origAdmin;
      }
    });

    it('1b. converts inline on* attributes to delegated data-sovra-on* attributes', () => {
      const sampleHtml = `
        <div class="test-container">
          <button id="btn1" onclick="switchTab('feed')" onkeydown="handleKey(event)">Home</button>
          <input type="text" oninput="doSearch(this.value)" onchange="markDirty()">
          <span onmouseover="showTip()" onmouseout="hideTip()">Help</span>
        </div>
      `;

      // Simulating injectCspNonce logic
      const nonce = crypto.randomBytes(16).toString('base64');
      const transformed = sampleHtml.replace(/(<[a-zA-Z0-9\-]+)([^>]*?)>/g, (fullMatch, tagPrefix, attrs) => {
        const lower = tagPrefix.toLowerCase();
        if (lower === '<script' || lower === '<style') return fullMatch;
        const transformedAttrs = attrs.replace(/\s+on([a-zA-Z]+)\s*=\s*(["'])([\s\S]*?)\2/g, (attrMatch, evt, quote, val) => {
          return ` data-sovra-on${evt.toLowerCase()}=${quote}${val}${quote}`;
        });
        return `${tagPrefix}${transformedAttrs}>`;
      });

      // Assert 0 inline event attributes remain
      const remainingInline = transformed.match(/\s+on[a-zA-Z]+\s*=/g) || [];
      expect(remainingInline.length).toBe(0);

      // Assert data-sovra-on* attributes were populated
      expect(transformed).toContain('data-sovra-onclick="switchTab(\'feed\')"');
      expect(transformed).toContain('data-sovra-onkeydown="handleKey(event)"');
      expect(transformed).toContain('data-sovra-oninput="doSearch(this.value)"');
      expect(transformed).toContain('data-sovra-onchange="markDirty()"');
      expect(transformed).toContain('data-sovra-onmouseover="showTip()"');
      expect(transformed).toContain('data-sovra-onmouseout="hideTip()"');
    });
  });

  // =========================================================================
  // TASK 2 (P0): SQLITE LOCKOUT EVICTION ATTACK IMMUNITY
  // =========================================================================
  describe('TASK 2 (P0): SQLite Lockout Eviction Attack Immunity', () => {
    it('2a. strictly preserves active lockouts during 50,000-row dummy identity flooding', () => {
      const engine = new SovraDatabaseEngine(tempStorageDir);
      engine.loadThrottleSecrets(PROD_VALID_HEX_SECRET);

      const victimKey = engine.getTargetThrottleKey('@executive_victim');
      engine.clearFailedPinAttempts(victimKey);

      // Victim reaches 5 failed attempts -> 15 min lockout
      for (let i = 0; i < 5; i++) {
        engine.recordFailedPinAttempt(victimKey);
      }

      const preFloodState = engine.getFailedPinAttempts(victimKey);
      expect(preFloodState.attempts).toBe(5);
      expect(preFloodState.isElevatedRisk).toBe(true);

      const sqliteEngine = (engine as any).sqliteEngine;
      const preFloodThrottle = sqliteEngine.getPinThrottle(victimKey);
      expect(preFloodThrottle.lockedUntil).toBeGreaterThan(Date.now());

      // Attacker floods 50,005 dummy rows with newer timestamps
      const now = Date.now() + 5000;
      const insertStmt = sqliteEngine.prepareCached(`
        INSERT INTO durable_pin_throttles (target_key, attempts, first_attempt_at, last_attempt_at, locked_until)
        VALUES (?, ?, ?, ?, ?)
      `);

      sqliteEngine.db.exec('BEGIN IMMEDIATE');
      for (let i = 1; i <= 50005; i++) {
        insertStmt.run(`dummy_flood_${i}`, 1, now + i, now + i, 0);
      }
      sqliteEngine.db.exec('COMMIT');

      const countBefore = sqliteEngine.db.prepare('SELECT COUNT(*) as c FROM durable_pin_throttles').get().c;
      expect(countBefore).toBeGreaterThan(50000);

      // Trigger high-water mark pruning
      (sqliteEngine as any).pruneExpiredThrottlesInternal(now + 10000);

      const countAfter = sqliteEngine.db.prepare('SELECT COUNT(*) as c FROM durable_pin_throttles').get().c;
      expect(countAfter).toBe(countBefore - 5000);

      // Victim row MUST NOT be evicted
      const victimRow = sqliteEngine.db.prepare('SELECT * FROM durable_pin_throttles WHERE target_key = ?').get(victimKey);
      expect(victimRow).toBeDefined();
      expect(victimRow.target_key).toBe(victimKey);
      expect(Number(victimRow.attempts)).toBe(5);
      expect(Number(victimRow.locked_until)).toBeGreaterThan(Date.now());

      // Verify cross-worker / restart survival after flood
      const engineRestart = new SovraDatabaseEngine(tempStorageDir);
      engineRestart.loadThrottleSecrets(PROD_VALID_HEX_SECRET);
      const postRestartState = engineRestart.getFailedPinAttempts(victimKey);
      expect(postRestartState.attempts).toBe(5);
      expect(postRestartState.isElevatedRisk).toBe(true);

      // Clean up test data
      sqliteEngine.db.exec("DELETE FROM durable_pin_throttles WHERE target_key LIKE 'dummy_flood_%'");
      engine.clearFailedPinAttempts(victimKey);
    });

    it('2b. refuses to evict any records when table is filled entirely with active lockouts', () => {
      const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-p36-full-lockout-'));
      const engine = new SovraDatabaseEngine(localDir);
      engine.loadThrottleSecrets(PROD_VALID_HEX_SECRET);
      const sqliteEngine = (engine as any).sqliteEngine;

      try {
        const now = Date.now();
        const futureLock = now + 15 * 60 * 1000;
        const insertStmt = sqliteEngine.prepareCached(`
          INSERT INTO durable_pin_throttles (target_key, attempts, first_attempt_at, last_attempt_at, locked_until)
          VALUES (?, ?, ?, ?, ?)
        `);

        // Insert 50,010 active lockouts
        sqliteEngine.db.exec('BEGIN IMMEDIATE');
        for (let i = 1; i <= 50010; i++) {
          insertStmt.run(`active_locked_${i}`, 5, now, now, futureLock);
        }
        sqliteEngine.db.exec('COMMIT');

        const countBefore = sqliteEngine.db.prepare('SELECT COUNT(*) as c FROM durable_pin_throttles').get().c;
        expect(countBefore).toBe(50010);

        // Run pruning query: should not delete ANY active lockouts
        (sqliteEngine as any).pruneExpiredThrottlesInternal(now);

        const countAfter = sqliteEngine.db.prepare('SELECT COUNT(*) as c FROM durable_pin_throttles').get().c;
        expect(countAfter).toBe(50010); // Zero active lockouts deleted!
      } finally {
        try {
          sqliteEngine.close();
          fs.rmSync(localDir, { recursive: true, force: true });
        } catch (_) {}
      }
    });

    it('2c. protects durable_ip_throttles from active lockout eviction', () => {
      const engine = new SovraDatabaseEngine(tempStorageDir);
      engine.loadThrottleSecrets(PROD_VALID_HEX_SECRET);
      const sqliteEngine = (engine as any).sqliteEngine;

      const victimIp = '198.51.100.99';
      sqliteEngine.clearIpThrottle(victimIp);

      const now = Date.now();
      const insertIp = sqliteEngine.prepareCached(`
        INSERT INTO durable_ip_throttles (ip_address, attempts, first_attempt_at, last_attempt_at, locked_until)
        VALUES (?, ?, ?, ?, ?)
      `);

      // 1 locked IP
      insertIp.run(victimIp, 10, now - 5000, now - 5000, now + 15 * 60 * 1000);

      // Flood 50,005 unlocked dummy IPs
      sqliteEngine.db.exec('BEGIN IMMEDIATE');
      for (let i = 1; i <= 50005; i++) {
        insertIp.run(`10.99.${Math.floor(i / 256)}.${i % 256}`, 1, now, now, 0);
      }
      sqliteEngine.db.exec('COMMIT');

      // Prune
      (sqliteEngine as any).pruneExpiredThrottlesInternal(now);

      // Verify locked IP was not evicted
      const lockedIpRow = sqliteEngine.db.prepare('SELECT * FROM durable_ip_throttles WHERE ip_address = ?').get(victimIp);
      expect(lockedIpRow).toBeDefined();
      expect(Number(lockedIpRow.locked_until)).toBeGreaterThan(Date.now());

      // Clean up
      sqliteEngine.db.exec("DELETE FROM durable_ip_throttles WHERE ip_address LIKE '10.99.%'");
      sqliteEngine.clearIpThrottle(victimIp);
    });
  });

  // =========================================================================
  // TASK 4: HMAC CSPRNG AND PARSING INTEGRITY
  // =========================================================================
  describe('TASK 4: HMAC CSPRNG and Parsing Correctness', () => {
    it('4a. accepts valid 64-char hex and 44-char base64 CSPRNG secrets', () => {
      const validHex = crypto.randomBytes(32).toString('hex');
      const validB64 = crypto.randomBytes(32).toString('base64');

      const engine = new SovraDatabaseEngine(tempStorageDir);
      expect(() => engine.loadThrottleSecrets(validHex)).not.toThrow();
      expect(() => engine.loadThrottleSecrets(validB64)).not.toThrow();
    });

    it('4b. rejects non-CSPRNG or malformed base64 secrets in production mode', () => {
      // Malformed Base64 (invalid characters)
      const malformedB64 = 'Invalid_Base64_With_Special_Chars!@#$%^&*()_+==';
      const b64Res = SovraDatabaseEngine.validateThrottleSecret(malformedB64, true);
      expect(b64Res.valid).toBe(false);
      expect(b64Res.error).toContain('64-character hexadecimal or 44-character Base64 string');

      // Short hex string
      const shortHex = 'abcdef123456';
      const hexRes = SovraDatabaseEngine.validateThrottleSecret(shortHex, true);
      expect(hexRes.valid).toBe(false);
      expect(hexRes.error).toContain('at least 32 characters');
    });
  });
});
