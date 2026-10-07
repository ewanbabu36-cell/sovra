import { describe, it, expect, beforeEach } from 'vitest';
import { AdminSecurityEngine } from '../src/admin.js';

describe('Admin Credentials & Fail-Closed Production Security (@sovra/identity)', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSecret = process.env.ADMIN_SECRET_KEY;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.ADMIN_SECRET_KEY;
  });

  describe('Production Fail-Closed Enforcement', () => {
    it('throws error in production if no admin key is provided', () => {
      expect(() => {
        new AdminSecurityEngine(undefined, { isProduction: true });
      }).toThrow(/ADMIN_SECRET_KEY is required in production environment/);
    });

    it('throws error in production if default/prototype master key is provided', () => {
      expect(() => {
        new AdminSecurityEngine('sovra-operations-master-key', { isProduction: true });
      }).toThrow(/Production ADMIN_SECRET_KEY must be a cryptographically strong secret/);
    });

    it('throws error in production if key is less than 32 characters', () => {
      expect(() => {
        new AdminSecurityEngine('too-short-secret-key-12345', { isProduction: true });
      }).toThrow(/at least 32 characters/);
    });

    it('initializes successfully in production with 32+ character high-entropy key', () => {
      const strongKey = 'f8a7c2b4d9e013579246801357924680abcdef0123456789abcdef01234567';
      const engine = new AdminSecurityEngine(strongKey, { isProduction: true });
      expect(engine).toBeInstanceOf(AdminSecurityEngine);
    });
  });

  describe('Brute-Force Protection & Lockout', () => {
    const validKey = 'production-grade-super-secret-key-at-least-32-chars-long';

    it('locks out after 5 consecutive failed attempts', () => {
      const engine = new AdminSecurityEngine(validKey, {
        maxFailedAttempts: 5,
        lockoutDurationSeconds: 60,
      });

      const did = 'did:sovra:attacker_1';

      // 4 failures should still say 'Invalid administrative credential'
      for (let i = 0; i < 4; i++) {
        const res = engine.createAdminSession({
          did,
          role: 'SUPER_ADMIN',
          adminKey: 'wrong-guess',
        });
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error).toBe('Invalid administrative credential');
        }
      }

      // 5th failure triggers lockout
      const fifthRes = engine.createAdminSession({
        did,
        role: 'SUPER_ADMIN',
        adminKey: 'wrong-guess',
      });
      expect(fifthRes.ok).toBe(false);
      if (!fifthRes.ok) {
        expect(fifthRes.error).toContain('Too many failed administrative attempts');
      }

      // Subsequent attempt even with correct password is locked out
      const lockedRes = engine.createAdminSession({
        did,
        role: 'SUPER_ADMIN',
        adminKey: validKey,
      });
      expect(lockedRes.ok).toBe(false);
      if (!lockedRes.ok) {
        expect(lockedRes.error).toContain('temporarily locked');
      }
    });

    it('resets failed count on successful authentication', () => {
      const engine = new AdminSecurityEngine(validKey, { maxFailedAttempts: 3 });
      const did = 'did:sovra:admin_user';

      // 2 failed attempts
      engine.createAdminSession({ did, role: 'SUPER_ADMIN', adminKey: 'bad' });
      engine.createAdminSession({ did, role: 'SUPER_ADMIN', adminKey: 'bad' });

      // Successful attempt
      const success = engine.createAdminSession({ did, role: 'SUPER_ADMIN', adminKey: validKey });
      expect(success.ok).toBe(true);

      // Subsequent fail starts counter from 1 again, not triggering lockout
      const failAgain = engine.createAdminSession({ did, role: 'SUPER_ADMIN', adminKey: 'bad' });
      expect(failAgain.ok).toBe(false);
      if (!failAgain.ok) {
        expect(failAgain.error).toBe('Invalid administrative credential');
      }
    });
  });

  describe('Key Rotation & Session Revocation', () => {
    const key1 = 'first-valid-secret-key-32-chars-long-abc';
    const key2 = 'second-valid-secret-key-32-chars-long-xyz';

    it('revokes specific session token', () => {
      const engine = new AdminSecurityEngine(key1);
      const res = engine.createAdminSession({
        did: 'did:sovra:admin_bob',
        role: 'SUPER_ADMIN',
        adminKey: key1,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(engine.getActiveSessionCount()).toBe(1);
      const revoked = engine.revokeSession(res.sessionToken);
      expect(revoked).toBe(true);
      expect(engine.getActiveSessionCount()).toBe(0);

      // Resolving revoked session returns null
      expect(engine.resolveAdminSession(res.sessionToken)).toBeNull();
    });

    it('rotates master key and invalidates all active sessions', () => {
      const engine = new AdminSecurityEngine(key1);
      const res1 = engine.createAdminSession({ did: 'did:sovra:adm_1', role: 'SUPER_ADMIN', adminKey: key1 });
      const res2 = engine.createAdminSession({ did: 'did:sovra:adm_2', role: 'MODERATOR', adminKey: key1 });
      expect(res1.ok && res2.ok).toBe(true);
      expect(engine.getActiveSessionCount()).toBe(2);

      // Rotate to new secret
      engine.rotateMasterKey(key2);
      expect(engine.getActiveSessionCount()).toBe(0);

      // Old key fails
      const oldLogin = engine.createAdminSession({ did: 'did:sovra:adm_1', role: 'SUPER_ADMIN', adminKey: key1 });
      expect(oldLogin.ok).toBe(false);

      // New key succeeds
      const newLogin = engine.createAdminSession({ did: 'did:sovra:adm_1', role: 'SUPER_ADMIN', adminKey: key2 });
      expect(newLogin.ok).toBe(true);
    });
  });
});
