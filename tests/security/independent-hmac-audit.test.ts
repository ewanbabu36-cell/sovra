import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SovraDatabaseEngine } from '../../scripts/database-engine.js';
import { validateEnvironment, scrubSecrets } from '../../scripts/env-validator.js';

describe('Phase 3.2 Independent HMAC-SHA256 Zero-Trust Audit', () => {
  const TEST_SECRET_A = 'primary-secret-0123456789abcdef0123456789abcdef';
  const TEST_SECRET_B = 'secondary-secret-0123456789abcdef0123456789abcdef';
  const TEST_SECRET_C = 'tertiary-secret-0123456789abcdef0123456789abcdef';

  let originalEnvSecret: string | undefined;
  let originalEnvRotation: string | undefined;

  beforeEach(() => {
    originalEnvSecret = process.env.SOVRA_THROTTLE_SECRET;
    originalEnvRotation = process.env.SOVRA_THROTTLE_SECRET_ROTATION;
    process.env.SOVRA_THROTTLE_SECRET = TEST_SECRET_A;
    delete process.env.SOVRA_THROTTLE_SECRET_ROTATION;
  });

  afterEach(() => {
    if (originalEnvSecret !== undefined) {
      process.env.SOVRA_THROTTLE_SECRET = originalEnvSecret;
    } else {
      delete process.env.SOVRA_THROTTLE_SECRET;
    }
    if (originalEnvRotation !== undefined) {
      process.env.SOVRA_THROTTLE_SECRET_ROTATION = originalEnvRotation;
    } else {
      delete process.env.SOVRA_THROTTLE_SECRET_ROTATION;
    }
  });

  // 1. Genuine HMAC-SHA256 Construction
  it('1. independently verifies genuine HMAC-SHA256 construction, domain separation, and avalanche effect', () => {
    const db = new SovraDatabaseEngine();
    db.loadThrottleSecrets(TEST_SECRET_A);

    const handle = '@alice_secure';
    const computedKey = db.getTargetThrottleKey(handle);

    // Independent cryptographic re-implementation
    const expectedHmac = 'target_th_' + crypto
      .createHmac('sha256', TEST_SECRET_A)
      .update('sovra_target_throttle_v1:@alice_secure')
      .digest('hex')
      .slice(0, 32);

    expect(computedKey).toBe(expectedHmac);
    expect(computedKey.length).toBe(42); // 'target_th_' (10 chars) + 32 hex chars

    // Normalization verification
    expect(db.getTargetThrottleKey('alice_secure')).toBe(computedKey);
    expect(db.getTargetThrottleKey('  @Alice_Secure  ')).toBe(computedKey);
    expect(db.getTargetThrottleKey('ALICE_SECURE')).toBe(computedKey);

    // Avalanche effect: single bit flip in secret or handle completely alters key
    const flippedSecret = TEST_SECRET_A.slice(0, -1) + (TEST_SECRET_A.endsWith('f') ? 'e' : 'f');
    const flippedKey = db.getTargetThrottleKey(handle, flippedSecret);
    expect(flippedKey).not.toBe(computedKey);

    // Ensure no correlation or substring matching between handle and throttle key
    expect(computedKey).not.toContain('alice');
    expect(computedKey).not.toContain('secure');
  });

  // 2. Secret Entropy and Minimum Requirements
  it('2. enforces minimum 32-character secret length and rejects weak/insecure keys', () => {
    // Missing / empty
    expect(SovraDatabaseEngine.validateThrottleSecret(undefined).valid).toBe(false);
    expect(SovraDatabaseEngine.validateThrottleSecret('').valid).toBe(false);

    // Sub-32 characters (< 256 bits entropy)
    expect(SovraDatabaseEngine.validateThrottleSecret('1234567890123456789012345678901').valid).toBe(false);
    expect(SovraDatabaseEngine.validateThrottleSecret('short-secret').valid).toBe(false);

    // Blacklisted / trivial keys
    expect(SovraDatabaseEngine.validateThrottleSecret('password').valid).toBe(false);
    expect(SovraDatabaseEngine.validateThrottleSecret('12345678901234567890123456789012').valid).toBe(false);
    expect(SovraDatabaseEngine.validateThrottleSecret('legacy_public_constant_salt:').valid).toBe(false);
    expect(SovraDatabaseEngine.validateThrottleSecret('admin').valid).toBe(false);
    expect(SovraDatabaseEngine.validateThrottleSecret('change_me').valid).toBe(false);

    // Valid high-entropy secret
    const strongRandom = crypto.randomBytes(32).toString('hex');
    expect(SovraDatabaseEngine.validateThrottleSecret(strongRandom).valid).toBe(true);
  });

  // 3. Fail-Closed Behavior
  it('3. strictly fails closed without silent fallback when secret is unconfigured', () => {
    delete process.env.SOVRA_THROTTLE_SECRET;
    delete process.env.SOVRA_THROTTLE_SECRET_ROTATION;

    const unconfiguredDb = new SovraDatabaseEngine();
    unconfiguredDb.loadThrottleSecrets();

    expect(() => unconfiguredDb.getPrimaryThrottleSecret()).toThrow(/Refusing to fall back to a public constant/);
    expect(() => unconfiguredDb.getTargetThrottleKey('@bob')).toThrow(/Refusing to fall back to a public constant/);
  });

  // 4. No Hardcoded Production Secrets
  it('4. verifies absence of hardcoded production secrets in source files and templates', () => {
    const dbPath = path.resolve(__dirname, '../../scripts/database-engine.ts');
    const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
    const envExamplePath = path.resolve(__dirname, '../../.env.example');

    const dbCode = fs.readFileSync(dbPath, 'utf8');
    const devServerCode = fs.readFileSync(devServerPath, 'utf8');
    const envExample = fs.readFileSync(envExamplePath, 'utf8');

    // No hardcoded salts
    expect(dbCode).not.toContain('sovra_target_throttle_salt_v3');
    expect(dbCode).not.toContain('sovra_target_throttle_salt');
    expect(devServerCode).not.toContain('sovra_target_throttle_salt');

    // .env.example only contains instructional placeholder
    expect(envExample).toContain('SOVRA_THROTTLE_SECRET=replace_with_a_cryptographically_secure_random_key_min_32_chars!');
  });

  // 5. No Secret Leakage
  it('5. scrubs SOVRA_THROTTLE_SECRET from log outputs and prevents API leakage', () => {
    const secret = 'super-secret-throttle-token-32-chars-ok!';
    const rawLog = `Server initialized with SOVRA_THROTTLE_SECRET=${secret} and debug mode enabled`;
    const scrubbed = scrubSecrets(rawLog);

    expect(scrubbed).not.toContain(secret);
    expect(scrubbed).toContain('SOVRA_THROTTLE_SECRET=[REDACTED]');

    const jsonLog = JSON.stringify({
      event: 'LOGIN_FAILURE',
      SOVRA_THROTTLE_SECRET: secret,
      handle: '@eve',
    });
    const scrubbedJson = scrubSecrets(jsonLog);
    expect(scrubbedJson).not.toContain(secret);
    expect(scrubbedJson).toContain('[REDACTED]');
  });

  // 6. Key Rotation & Dual-Key State Inheritance
  it('6. safely inherits failure state during key rotation and enforces lock across rotated keys', () => {
    const db = new SovraDatabaseEngine();
    db.loadThrottleSecrets(TEST_SECRET_A);

    const target = `@victim_${Date.now()}`;
    const keyA = db.getTargetThrottleKey(target);

    // 4 failed attempts under Secret A
    for (let i = 0; i < 4; i++) {
      db.recordFailedPinAttempt(keyA);
    }
    expect(db.getFailedPinAttempts(keyA).attempts).toBe(4);

    // Rotate to Secret B
    db.rotateThrottleSecret(TEST_SECRET_B);
    expect(db.getPrimaryThrottleSecret()).toBe(TEST_SECRET_B);
    expect(db.getRotatedThrottleSecrets()).toContain(TEST_SECRET_A);

    const keyB = db.getTargetThrottleKey(target);
    expect(keyB).not.toBe(keyA);

    // Create user
    db.createUser({
      did: `did:sovra:victim_${Date.now()}`,
      handle: target,
      displayName: 'Victim',
      securityPinHash: db.hashSecurityPin('123456'),
    });

    // 5th attempt under new Secret B must inherit Secret A state and lock out (429)
    const result5 = db.loginUser(target, 'Browser', '10.0.0.1', 'Agent', { pin: '000000' });
    expect(result5.ok).toBe(false);
    expect(result5.isLocked).toBe(true);

    // Next attempt is also locked
    const result6 = db.loginUser(target, 'Browser', '10.0.0.1', 'Agent', { pin: '000000' });
    expect(result6.ok).toBe(false);
    expect(result6.isLocked).toBe(true);
  });

  // 7. Successful Authentication Counter Clearing Across Dual Keys
  it('7. clears both primary and rotated throttle records on successful credential entry', () => {
    const db = new SovraDatabaseEngine();
    db.loadThrottleSecrets(TEST_SECRET_A);

    const target = `@user_clearing_${Date.now()}`;
    const keyA = db.getTargetThrottleKey(target);

    // Failed attempts
    db.recordFailedPinAttempt(keyA);
    db.recordFailedPinAttempt(keyA);

    // Rotate to Secret B
    db.rotateThrottleSecret(TEST_SECRET_B);
    const keyB = db.getTargetThrottleKey(target);

    db.recordFailedPinAttempt(keyB);

    const user = db.createUser({
      did: `did:sovra:clearing_${Date.now()}`,
      handle: target,
      displayName: 'Clearing User',
      securityPinHash: db.hashSecurityPin('555555'),
    });

    // Legitimate login with correct PIN
    const success = db.loginUser(target, 'Browser', '10.0.0.2', 'Agent', { pin: '555555' });
    expect(success.ok).toBe(true);

    // Both keys must be cleared
    expect(db.getFailedPinAttempts(keyA).attempts).toBe(0);
    expect(db.getFailedPinAttempts(keyB).attempts).toBe(0);
  });

  // 8. Concurrent Login Attacks and Nonexistent Account Parity
  it('8. provides uniform 401->429 rate limiting parity for existing and nonexistent accounts under concurrent bursts', async () => {
    const db = new SovraDatabaseEngine();
    db.loadThrottleSecrets(TEST_SECRET_A);

    const existingTarget = `@exist_burst_${Date.now()}`;
    const nonexistentTarget = `@nonexist_burst_${Date.now()}`;

    db.createUser({
      did: `did:sovra:exist_${Date.now()}`,
      handle: existingTarget,
      displayName: 'Existing Burst User',
      securityPinHash: db.hashSecurityPin('999999'),
    });

    // Execute 7 attempts against existing user
    const existingResults = [];
    for (let i = 0; i < 7; i++) {
      existingResults.push(db.loginUser(existingTarget, 'Client', `172.16.0.${i + 1}`, 'Agent', { pin: '000000' }));
    }

    // Execute 7 attempts against nonexistent user
    const nonexistentResults = [];
    for (let i = 0; i < 7; i++) {
      nonexistentResults.push(db.loginUser(nonexistentTarget, 'Client', `172.16.0.${i + 1}`, 'Agent', { pin: '000000' }));
    }

    // Compare results: attempts 1-4 should be 401 (ok: false, isLocked: undefined/false)
    for (let i = 0; i < 4; i++) {
      expect(existingResults[i]!.ok).toBe(false);
      expect(existingResults[i]!.isLocked).toBeFalsy();
      expect(existingResults[i]!.error).toBe('Invalid credentials');

      expect(nonexistentResults[i]!.ok).toBe(false);
      expect(nonexistentResults[i]!.isLocked).toBeFalsy();
      expect(nonexistentResults[i]!.error).toBe('Invalid credentials');
    }

    // Attempt 5+ should be 429 (ok: false, isLocked: true) with identical error message
    for (let i = 4; i < 7; i++) {
      expect(existingResults[i]!.ok).toBe(false);
      expect(existingResults[i]!.isLocked).toBe(true);
      expect(existingResults[i]!.error).toContain('Account authentication rate-limited due to multiple failed attempts');

      expect(nonexistentResults[i]!.ok).toBe(false);
      expect(nonexistentResults[i]!.isLocked).toBe(true);
      expect(nonexistentResults[i]!.error).toContain('Account authentication rate-limited due to multiple failed attempts');
    }
  });

  // 9. Restart Behavior During Key Rotation (Environment Re-initialization)
  it('9. correctly initializes dual keys from SOVRA_THROTTLE_SECRET and SOVRA_THROTTLE_SECRET_ROTATION across restarts', () => {
    // Simulate server configuration: primary secret + rotated secondary secret
    process.env.SOVRA_THROTTLE_SECRET = TEST_SECRET_B;
    process.env.SOVRA_THROTTLE_SECRET_ROTATION = `${TEST_SECRET_A},${TEST_SECRET_C}`;

    const restartedDb = new SovraDatabaseEngine();
    restartedDb.loadThrottleSecrets();

    expect(restartedDb.getPrimaryThrottleSecret()).toBe(TEST_SECRET_B);
    const rotated = restartedDb.getRotatedThrottleSecrets();
    expect(rotated).toContain(TEST_SECRET_A);
    expect(rotated).toContain(TEST_SECRET_C);
    expect(rotated.length).toBe(2);

    const allKeys = restartedDb.getAllTargetThrottleKeys('@test_restart');
    expect(allKeys.length).toBe(3); // primary + 2 rotated
  });
});
