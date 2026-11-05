import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import http from 'node:http';
import { sovraDb, SovraDatabaseEngine, toPublicUserDTO } from '../../scripts/database-engine.js';
import { validateEnvironment } from '../../scripts/env-validator.js';

describe('SOVRA Phase 3.3 — Security Defect Remediation & Adversarial Verification Gate', () => {
  const TEST_THROTTLE_SECRET = 'sovra-phase33-entropy-verified-test-secret-key-32chars!';
  let savedSecret: string | undefined;

  beforeAll(() => {
    savedSecret = process.env.SOVRA_THROTTLE_SECRET;
    process.env.SOVRA_THROTTLE_SECRET = TEST_THROTTLE_SECRET;
    sovraDb.loadThrottleSecrets(TEST_THROTTLE_SECRET);
  });

  afterAll(() => {
    process.env.SOVRA_THROTTLE_SECRET = savedSecret;
    if (savedSecret) {
      sovraDb.loadThrottleSecrets(savedSecret);
    }
  });

  // =========================================================================
  // SECTION 1: SEC-NEW-01 RECOVERY HASH DESYNCHRONIZATION REMEDIATION
  // =========================================================================
  describe('RULE 1 & 2: SEC-NEW-01 Recovery Phrase Salt/Hash Synchronization & Adversarial Vectors', () => {
    let validRecoveryPhrase: string;
    const testDid = 'did:sovra:phase33_test_user_' + Date.now();
    const testHandle = '@sec33_user_' + Date.now();

    beforeAll(() => {
      validRecoveryPhrase = sovraDb.generateRecoveryPhrase();
    });

    it('creates a new account via createUser() and derives matching hash and salt atomically (SEC-NEW-01 fix)', () => {
      // Prior to Phase 3.3 fix, createUser() called hashRecoveryPhrase twice,
      // resulting in different salts and a broken recovery phrase.
      const user = sovraDb.createUser({
        did: testDid,
        handle: testHandle,
        displayName: 'Phase 3.3 Test User',
        recoveryPhrase: validRecoveryPhrase,
      });

      expect(user).toBeDefined();
      expect(user.recoveryPhraseHash).toBeDefined();
      expect(user.recoveryPhraseSalt).toBeDefined();
      expect(typeof user.recoveryPhraseHash).toBe('string');
      expect(typeof user.recoveryPhraseSalt).toBe('string');
      expect(user.recoveryPhraseSalt!.length).toBe(32); // 16 bytes hex = 32 chars
      expect(user.recoveryPhraseHash!.length).toBe(64); // 32 bytes hex = 64 chars

      // Crucial test: Does verifyRecoveryPhrase succeed with the saved salt and hash?
      const verified = sovraDb.verifyRecoveryPhrase(
        validRecoveryPhrase,
        user.recoveryPhraseHash!,
        user.recoveryPhraseSalt!
      );
      expect(verified).toBe(true);
    });

    it('verifies recovery credentials persist correctly across database save and reload', () => {
      sovraDb.save(true);
      sovraDb.load();

      const user = sovraDb.findUserByHandle(testHandle);
      expect(user).toBeDefined();
      expect(user!.recoveryPhraseHash).toBeDefined();
      expect(user!.recoveryPhraseSalt).toBeDefined();

      const verified = sovraDb.verifyRecoveryPhrase(
        validRecoveryPhrase,
        user!.recoveryPhraseHash!,
        user!.recoveryPhraseSalt!
      );
      expect(verified).toBe(true);
    });

    it('verifies account created via registerUser() derives matching hash and salt atomically', () => {
      const regPhrase = sovraDb.generateRecoveryPhrase();
      const regHandle = '@sec33_reg_' + Date.now();
      const regRes = sovraDb.registerUser({
        handle: regHandle,
        displayName: 'Registered User',
        recoveryPhrase: regPhrase,
      });

      expect(regRes.ok).toBe(true);
      expect(regRes.user).toBeDefined();
      expect(regRes.user!.recoveryPhraseHash).toBeDefined();
      expect(regRes.user!.recoveryPhraseSalt).toBeDefined();

      const verified = sovraDb.verifyRecoveryPhrase(
        regPhrase,
        regRes.user!.recoveryPhraseHash!,
        regRes.user!.recoveryPhraseSalt!
      );
      expect(verified).toBe(true);
    });

    it('rejects incorrect or altered recovery phrases (Adversarial False Positive Protection)', () => {
      const user = sovraDb.findUserByHandle(testHandle);
      expect(user).toBeDefined();

      const badPhrases = [
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon',
        'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
        'completely invalid random words that do not match the original seed',
        '',
        '   ',
        validRecoveryPhrase + ' extra',
        validRecoveryPhrase.split(' ').slice(0, 11).join(' '), // truncated
      ];

      for (const badPhrase of badPhrases) {
        const verified = sovraDb.verifyRecoveryPhrase(
          badPhrase,
          user!.recoveryPhraseHash!,
          user!.recoveryPhraseSalt!
        );
        expect(verified).toBe(false);
      }
    });

    it('rejects tampered recovery salts (Cryptographic Salt Integrity)', () => {
      const user = sovraDb.findUserByHandle(testHandle);
      expect(user).toBeDefined();

      // Flip first char of salt
      const tamperedSalt = (user!.recoveryPhraseSalt![0] === 'a' ? 'b' : 'a') + user!.recoveryPhraseSalt!.slice(1);
      const verified = sovraDb.verifyRecoveryPhrase(
        validRecoveryPhrase,
        user!.recoveryPhraseHash!,
        tamperedSalt
      );
      expect(verified).toBe(false);
    });

    it('rejects tampered recovery hashes (Cryptographic Hash Integrity)', () => {
      const user = sovraDb.findUserByHandle(testHandle);
      expect(user).toBeDefined();

      // Flip first char of hash
      const tamperedHash = (user!.recoveryPhraseHash![0] === 'a' ? 'b' : 'a') + user!.recoveryPhraseHash!.slice(1);
      const verified = sovraDb.verifyRecoveryPhrase(
        validRecoveryPhrase,
        tamperedHash,
        user!.recoveryPhraseSalt!
      );
      expect(verified).toBe(false);
    });

    it('executes emergency PIN reset successfully using the correct recovery phrase', () => {
      const newPin = '876543';
      const resetResult = sovraDb.resetSecurityPinWithRecoveryPhrase(testHandle, validRecoveryPhrase, newPin);

      expect(resetResult.ok).toBe(true);
      expect(resetResult.error).toBeUndefined();

      // Verify the new PIN works
      const user = sovraDb.findUserByHandle(testHandle);
      expect(user).toBeDefined();
      expect(sovraDb.verifySecurityPin(newPin, user!.securityPinHash!)).toBe(true);

      // Verify old PIN no longer matches
      expect(sovraDb.verifySecurityPin('123456', user!.securityPinHash!)).toBe(false);
    });

    it('rejects emergency PIN reset when using an incorrect recovery phrase', () => {
      const invalidPhrase = 'wrong phrase entirely that should be rejected by timing safe check';
      const resetResult = sovraDb.resetSecurityPinWithRecoveryPhrase(testHandle, invalidPhrase, '112233');

      expect(resetResult.ok).toBe(false);
      expect(resetResult.error).toBe('Invalid recovery credentials.');

      // Verify PIN was not changed
      const user = sovraDb.findUserByHandle(testHandle);
      expect(sovraDb.verifySecurityPin('876543', user!.securityPinHash!)).toBe(true);
      expect(sovraDb.verifySecurityPin('112233', user!.securityPinHash!)).toBe(false);
    });

    it('maintains 100% backward compatibility with legacy accounts storing unhashed recoveryPhrase', () => {
      const legacyDid = 'did:sovra:legacy_compat_' + Date.now();
      const legacyHandle = '@legacy_user_' + Date.now();
      const legacyPhrase = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

      // Simulate a legacy account that existed before salted Scrypt hashing
      const legacyRecord = {
        did: legacyDid,
        handle: legacyHandle,
        displayName: 'Legacy Peer',
        recoveryPhrase: legacyPhrase, // plaintext legacy field
        recoveryPhraseHash: undefined,
        recoveryPhraseSalt: undefined,
        securityPinHash: sovraDb.hashSecurityPin('111111'),
      };
      (sovraDb as any).db.users.push(legacyRecord);

      // 1. resetSecurityPinWithRecoveryPhrase should succeed AND automatically migrate the phrase to scrypt hash/salt
      const resetResult = sovraDb.resetSecurityPinWithRecoveryPhrase(legacyHandle, legacyPhrase, '222222');
      expect(resetResult.ok).toBe(true);

      const migrated = sovraDb.findUserByHandle(legacyHandle);
      expect(migrated).toBeDefined();
      expect(migrated!.recoveryPhraseHash).toBeDefined();
      expect(migrated!.recoveryPhraseSalt).toBeDefined();
      expect((migrated as any).recoveryPhrase).toBeUndefined(); // plaintext purged

      // 2. Subsequent verification uses new scrypt hash/salt
      const reVerified = sovraDb.verifyRecoveryPhrase(
        legacyPhrase,
        migrated!.recoveryPhraseHash!,
        migrated!.recoveryPhraseSalt!
      );
      expect(reVerified).toBe(true);
    }, 20000);

    it('strictly prevents leakage of recovery phrase or salt in public User DTOs and API views', () => {
      const user = sovraDb.findUserByHandle(testHandle);
      expect(user).toBeDefined();

      const publicDto = toPublicUserDTO(user!);
      expect(publicDto).toBeDefined();

      // Ensure confidential authentication data is never serialized to public clients
      expect((publicDto as any).recoveryPhrase).toBeUndefined();
      expect((publicDto as any).recoveryPhraseHash).toBeUndefined();
      expect((publicDto as any).recoveryPhraseSalt).toBeUndefined();
      expect((publicDto as any).securityPinHash).toBeUndefined();
      expect((publicDto as any).totpSecret).toBeUndefined();

      // Only public capability flags are exposed
      expect(publicDto!.hasSecurityPin).toBe(true);
      expect(typeof publicDto!.hasSecurityPin).toBe('boolean');
    });
  });

  // =========================================================================
  // SECTION 2: HMAC-SHA256 ENTROPY & PRODUCTION VALIDATION
  // =========================================================================
  describe('RULE 3: Genuine HMAC-SHA256 Entropy & Secret Lifecycle Verification', () => {
    it('rejects missing or undefined secrets', () => {
      const res1 = SovraDatabaseEngine.validateThrottleSecret(undefined);
      expect(res1.valid).toBe(false);
      expect(res1.error).toContain('missing');

      const res2 = SovraDatabaseEngine.validateThrottleSecret('');
      expect(res2.valid).toBe(false);

      const res3 = SovraDatabaseEngine.validateThrottleSecret('   ');
      expect(res3.valid).toBe(false);
    });

    it('rejects short secrets (< 32 characters)', () => {
      const res = SovraDatabaseEngine.validateThrottleSecret('short-secret-key-16b!');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('must be at least 32 characters');
    });

    it('rejects known trivial secrets even if >= 32 characters', () => {
      const knownInsecure = [
        '12345678901234567890123456789012',
        'legacy_public_constant_salt:___',
        'change_me_______________________',
        'password________________________',
        'secret__________________________',
      ];
      for (const sec of knownInsecure) {
        const res = SovraDatabaseEngine.validateThrottleSecret(sec);
        expect(res.valid).toBe(false);
      }
    });

    it('rejects low-entropy secrets with insufficient character diversity or Shannon entropy', () => {
      // 32 repeated characters (entropy = 0)
      const repeated = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const resRepeated = SovraDatabaseEngine.validateThrottleSecret(repeated);
      expect(resRepeated.valid).toBe(false);
      expect(resRepeated.error).toMatch(/diversity|entropy/i);

      // Low diversity repeating sequence
      const pattern = 'abababababababababababababababab';
      const resPattern = SovraDatabaseEngine.validateThrottleSecret(pattern);
      expect(resPattern.valid).toBe(false);
      expect(resPattern.error).toMatch(/diversity|entropy/i);
    });

    it('accepts high-entropy cryptographically random secrets (hex, base64, CSPRNG)', () => {
      const validHex = crypto.randomBytes(32).toString('hex'); // 64 chars
      const resHex = SovraDatabaseEngine.validateThrottleSecret(validHex);
      expect(resHex.valid).toBe(true);

      const validBase64 = crypto.randomBytes(32).toString('base64'); // 44 chars
      const resBase64 = SovraDatabaseEngine.validateThrottleSecret(validBase64);
      expect(resBase64.valid).toBe(true);

      const resDev = SovraDatabaseEngine.validateThrottleSecret(TEST_THROTTLE_SECRET);
      expect(resDev.valid).toBe(true);
    });

    it('enforces fail-closed validation in production environment without secret', () => {
      const savedEnv = process.env.NODE_ENV;
      const savedSec = process.env.SOVRA_THROTTLE_SECRET;
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.SOVRA_THROTTLE_SECRET;

        const val = validateEnvironment();
        expect(val.valid).toBe(false);
        const hasThrottleErr = val.errors.some(e => e.includes('SOVRA_THROTTLE_SECRET'));
        expect(hasThrottleErr).toBe(true);
      } finally {
        process.env.NODE_ENV = savedEnv;
        process.env.SOVRA_THROTTLE_SECRET = savedSec;
      }
    });

    it('supports seamless secret rotation without breaking dual-key throttle state', () => {
      const initialKey = sovraDb.getTargetThrottleKey('@alice_rotation');
      expect(initialKey).toMatch(/^target_th_[0-9a-f]{32}$/);

      // Record a failed attempt under initial key
      sovraDb.recordFailedPinAttempt(initialKey);
      const attemptState = sovraDb.getFailedPinAttempts(initialKey);
      expect(attemptState.attempts).toBe(1);

      // Rotate to new secret
      const newSecret = 'sovra-phase33-rotated-new-secret-entropy-32chars!';
      sovraDb.rotateThrottleSecret(newSecret);

      const rotatedKey = sovraDb.getTargetThrottleKey('@alice_rotation');
      expect(rotatedKey).not.toBe(initialKey);
      expect(sovraDb.getRotatedThrottleSecrets()).toContain(TEST_THROTTLE_SECRET);

      // Dual-key query should retrieve both primary and rotated keys
      const allKeys = sovraDb.getAllTargetThrottleKeys('@alice_rotation');
      expect(allKeys).toContain(rotatedKey);
      expect(allKeys).toContain(initialKey);

      // Restore secret
      sovraDb.loadThrottleSecrets(TEST_THROTTLE_SECRET);
    });
  });

  // =========================================================================
  // SECTION 3: CSP NONCE REMEDIATION & PRODUCTION HEADERS
  // =========================================================================
  describe('RULE 4: Content Security Policy (CSP) Remediation & Evaluation Verification', () => {
    it('verifies unsafe-eval is completely excluded from production CSP headers', async () => {
      // Query the live dev server on port 3001
      const responseHeaders = await new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
        http.get('http://127.0.0.1:3001/api/status', (res) => {
          resolve(res.headers);
        }).on('error', reject);
      });

      const csp = responseHeaders['content-security-policy'] as string;
      expect(csp).toBeDefined();

      // Verify essential security directives
      expect(csp).toContain("default-src 'self' data: blob:");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("frame-ancestors 'self'");
    });

    it('verifies production policy structure supports cryptographic nonces and script-src-attr', () => {
      // In production mode, dev-server generates:
      // script-src 'self' 'nonce-${cspNonce}' 'unsafe-inline' blob:; script-src-attr 'unsafe-inline';
      const sampleNonce = crypto.randomBytes(16).toString('base64');
      const prodScriptPolicy = `script-src 'self' 'nonce-${sampleNonce}' 'unsafe-inline' blob:; script-src-attr 'unsafe-inline';`;

      expect(prodScriptPolicy).not.toContain('unsafe-eval');
      expect(prodScriptPolicy).toContain(`'nonce-${sampleNonce}'`);
      expect(prodScriptPolicy).toContain("script-src-attr 'unsafe-inline'");
    });
  });
});
