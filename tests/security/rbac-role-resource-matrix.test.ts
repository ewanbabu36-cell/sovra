/**
 * @file tests/security/rbac-role-resource-matrix.test.ts
 * SOVRA COMPREHENSIVE RBAC ROLE/RESOURCE MATRIX TEST SUITE
 *
 * Verifies the 7-role authorization model against all administrative and consumer
 * capabilities, enforcing the principle of least privilege, audit logging,
 * and privilege-escalation prevention.
 */

import { describe, it, expect } from 'vitest';
import {
  AdminSecurityEngine,
} from '../../packages/identity/src/admin.ts';
import {
  getRoleCapabilities,
  hasCapability,
  createAuthenticatedPrincipal,
  AdminRole,
  PrincipalCapability,
} from '../../packages/identity/src/principal.ts';

const BASE_URL = 'http://localhost:3001';
const TEST_ADMIN_KEY = 'sovra-test-admin-secret-key-32-chars-ok!';

describe('Sovra Full RBAC Role/Resource Security Matrix', () => {
  const allRoles: AdminRole[] = [
    'SUPER_ADMIN',
    'SECURITY_ADMIN',
    'MODERATOR',
    'INFRA_OPERATOR',
    'ANALYST',
    'SUPPORT',
    'USER',
  ];

  const allCapabilities: PrincipalCapability[] = [
    'admin:super',
    'admin:panic',
    'admin:security',
    'admin:moderate',
    'admin:metrics',
    'social:read',
    'social:write',
    'social:delete',
    'chat:send',
    'chat:read',
    'financial:transfer',
    'knowledge:read',
    'knowledge:write',
  ];

  describe('Formal Capability Matrix Verification', () => {
    it('SUPER_ADMIN possesses all system capabilities', () => {
      const principal = createAuthenticatedPrincipal({
        did: 'did:sovra:superadmin',
        sessionId: 'sess_super',
        role: 'SUPER_ADMIN',
      });
      for (const cap of allCapabilities) {
        expect(hasCapability(principal, cap)).toBe(true);
      }
    });

    it('SECURITY_ADMIN has security, panic, and metrics capabilities but lacks moderate and super', () => {
      const principal = createAuthenticatedPrincipal({
        did: 'did:sovra:secadmin',
        sessionId: 'sess_sec',
        role: 'SECURITY_ADMIN',
      });
      expect(hasCapability(principal, 'admin:security')).toBe(true);
      expect(hasCapability(principal, 'admin:panic')).toBe(true);
      expect(hasCapability(principal, 'admin:metrics')).toBe(true);
      expect(hasCapability(principal, 'admin:moderate')).toBe(false);
      expect(hasCapability(principal, 'admin:super')).toBe(false);
    });

    it('MODERATOR has content moderation and delete capabilities but lacks security and panic', () => {
      const principal = createAuthenticatedPrincipal({
        did: 'did:sovra:mod',
        sessionId: 'sess_mod',
        role: 'MODERATOR',
      });
      expect(hasCapability(principal, 'admin:moderate')).toBe(true);
      expect(hasCapability(principal, 'social:delete')).toBe(true);
      expect(hasCapability(principal, 'admin:security')).toBe(false);
      expect(hasCapability(principal, 'admin:panic')).toBe(false);
      expect(hasCapability(principal, 'admin:super')).toBe(false);
    });

    it('INFRA_OPERATOR has metrics and security capabilities but lacks moderation or panic', () => {
      const principal = createAuthenticatedPrincipal({
        did: 'did:sovra:infra',
        sessionId: 'sess_infra',
        role: 'INFRA_OPERATOR',
      });
      expect(hasCapability(principal, 'admin:metrics')).toBe(true);
      expect(hasCapability(principal, 'admin:security')).toBe(true);
      expect(hasCapability(principal, 'admin:panic')).toBe(false);
      expect(hasCapability(principal, 'admin:moderate')).toBe(false);
    });

    it('ANALYST has strictly read-only metrics access and zero administrative control', () => {
      const principal = createAuthenticatedPrincipal({
        did: 'did:sovra:analyst',
        sessionId: 'sess_ana',
        role: 'ANALYST',
      });
      expect(hasCapability(principal, 'admin:metrics')).toBe(true);
      expect(hasCapability(principal, 'admin:security')).toBe(false);
      expect(hasCapability(principal, 'admin:panic')).toBe(false);
      expect(hasCapability(principal, 'admin:moderate')).toBe(false);
      expect(hasCapability(principal, 'admin:super')).toBe(false);
      expect(hasCapability(principal, 'social:delete')).toBe(false);
    });

    it('SUPPORT has social:read and admin:metrics but cannot delete or alter configuration', () => {
      const principal = createAuthenticatedPrincipal({
        did: 'did:sovra:support',
        sessionId: 'sess_sup',
        role: 'SUPPORT',
      });
      expect(hasCapability(principal, 'social:read')).toBe(true);
      expect(hasCapability(principal, 'admin:metrics')).toBe(true);
      expect(hasCapability(principal, 'social:delete')).toBe(false);
      expect(hasCapability(principal, 'admin:security')).toBe(false);
      expect(hasCapability(principal, 'admin:panic')).toBe(false);
    });

    it('USER has full consumer capabilities but zero administrative privileges', () => {
      const principal = createAuthenticatedPrincipal({
        did: 'did:sovra:user',
        sessionId: 'sess_user',
        role: 'USER',
      });
      expect(hasCapability(principal, 'social:read')).toBe(true);
      expect(hasCapability(principal, 'social:write')).toBe(true);
      expect(hasCapability(principal, 'chat:send')).toBe(true);
      expect(hasCapability(principal, 'financial:transfer')).toBe(true);
      expect(hasCapability(principal, 'admin:metrics')).toBe(false);
      expect(hasCapability(principal, 'admin:moderate')).toBe(false);
      expect(hasCapability(principal, 'admin:security')).toBe(false);
      expect(hasCapability(principal, 'admin:panic')).toBe(false);
      expect(hasCapability(principal, 'admin:super')).toBe(false);
    });
  });

  describe('Admin Security Engine & Adversarial Protection', () => {
    it('enforces brute-force lockout after maximum failed attempts', () => {
      const engine = new AdminSecurityEngine(TEST_ADMIN_KEY, {
        maxFailedAttempts: 3,
        lockoutDurationSeconds: 60,
        isProduction: false,
      });

      // Attempt 1: fail
      const r1 = engine.createAdminSession({
        did: 'did:sovra:attacker',
        role: 'SUPER_ADMIN',
        adminKey: 'wrong_key_1',
      });
      expect(r1.ok).toBe(false);

      // Attempt 2: fail
      const r2 = engine.createAdminSession({
        did: 'did:sovra:attacker',
        role: 'SUPER_ADMIN',
        adminKey: 'wrong_key_2',
      });
      expect(r2.ok).toBe(false);

      // Attempt 3: fail and lock
      const r3 = engine.createAdminSession({
        did: 'did:sovra:attacker',
        role: 'SUPER_ADMIN',
        adminKey: 'wrong_key_3',
      });
      expect(r3.ok).toBe(false);
      if (!r3.ok) {
        expect(r3.error).toContain('locked');
      }

      // Attempt 4: even with correct key, rejected due to active lockout
      const r4 = engine.createAdminSession({
        did: 'did:sovra:attacker',
        role: 'SUPER_ADMIN',
        adminKey: TEST_ADMIN_KEY,
      });
      expect(r4.ok).toBe(false);
      if (!r4.ok) {
        expect(r4.error).toContain('locked');
      }
    });

    it('rejects prototype master key in all environments', () => {
      expect(() => {
        new AdminSecurityEngine('sovra-operations-master-key', { isProduction: false });
      }).toThrow(/prohibited/i);
    });

    it('records immutable audit logs for all security operations', () => {
      const engine = new AdminSecurityEngine(TEST_ADMIN_KEY, { isProduction: false });

      const login = engine.createAdminSession({
        did: 'did:sovra:mod_auditor',
        role: 'MODERATOR',
        adminKey: TEST_ADMIN_KEY,
      });
      expect(login.ok).toBe(true);

      const logs = engine.getAuditLogs();
      expect(logs.length).toBeGreaterThan(0);
      const last = logs[logs.length - 1];
      expect(last.actorDid).toBe('did:sovra:mod_auditor');
      expect(last.role).toBe('MODERATOR');
      expect(last.action).toBe('ADMIN_SESSION_CREATED');
      expect(last.success).toBe(true);
    });

    it('rotates master key and immediately invalidates all active sessions', () => {
      const engine = new AdminSecurityEngine(TEST_ADMIN_KEY, { isProduction: false });

      const login = engine.createAdminSession({
        did: 'did:sovra:operator',
        role: 'SUPER_ADMIN',
        adminKey: TEST_ADMIN_KEY,
      });
      expect(login.ok).toBe(true);
      if (!login.ok) return;

      const token = login.sessionToken;
      expect(engine.resolveAdminSession(token)).not.toBeNull();

      // Rotate master key
      const newKey = 'a-new-rotated-admin-secret-key-that-is-secure-32chars';
      engine.rotateMasterKey(newKey);

      // Previous session must be completely revoked
      expect(engine.resolveAdminSession(token)).toBeNull();

      // Old key fails
      const oldLogin = engine.createAdminSession({
        did: 'did:sovra:operator',
        role: 'SUPER_ADMIN',
        adminKey: TEST_ADMIN_KEY,
      });
      expect(oldLogin.ok).toBe(false);

      // New key succeeds
      const newLogin = engine.createAdminSession({
        did: 'did:sovra:operator',
        role: 'SUPER_ADMIN',
        adminKey: newKey,
      });
      expect(newLogin.ok).toBe(true);
    });
  });

  describe('Live Dev Server RBAC HTTP Enforcement', () => {
    let userToken: string;
    let analystToken: string;
    let moderatorToken: string;
    let superAdminToken: string;

    it('creates test sessions across different roles against the live server', async () => {
      // 1. Regular User registration
      const regRes = await fetch(`${BASE_URL}/api/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: `@rbac_user_${Date.now()}`,
          name: 'RBAC Consumer',
        }),
      });
      expect(regRes.status).toBe(200);
      const regData = await regRes.json();
      userToken = regData.sessionToken;

      // 2. Analyst admin session
      const anaRes = await fetch(`${BASE_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          did: 'did:sovra:analyst_live',
          role: 'ANALYST',
          adminKey: TEST_ADMIN_KEY,
        }),
      });
      expect(anaRes.status).toBe(200);
      const anaData = await anaRes.json();
      analystToken = anaData.sessionToken;

      // 3. Moderator admin session
      const modRes = await fetch(`${BASE_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          did: 'did:sovra:mod_live',
          role: 'MODERATOR',
          adminKey: TEST_ADMIN_KEY,
        }),
      });
      expect(modRes.status).toBe(200);
      const modData = await modRes.json();
      moderatorToken = modData.sessionToken;

      // 4. Super Admin session
      const supRes = await fetch(`${BASE_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          did: 'did:sovra:super_live',
          role: 'SUPER_ADMIN',
          adminKey: TEST_ADMIN_KEY,
        }),
      });
      expect(supRes.status).toBe(200);
      const supData = await supRes.json();
      superAdminToken = supData.sessionToken;
    });

    it('rejects regular USER attempting to access /api/admin/metrics with 403 Forbidden', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/metrics`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      expect(res.status).toBe(403);
    });

    it('permits ANALYST accessing /api/admin/metrics with 200 OK', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/metrics`, {
        headers: { Authorization: `Bearer ${analystToken}` },
      });
      expect(res.status).toBe(200);
    });

    it('rejects ANALYST attempting to execute emergency panic wipe with 403 Forbidden', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/panic`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${analystToken}`,
        },
        body: JSON.stringify({ confirmation: 'EMERGENCY_PANIC_CONFIRMED' }),
      });
      expect(res.status).toBe(403);
    });

    it('rejects MODERATOR attempting to execute emergency panic wipe with 403 Forbidden', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/panic`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({ confirmation: 'EMERGENCY_PANIC_CONFIRMED' }),
      });
      expect(res.status).toBe(403);
    });

    it('permits SUPER_ADMIN accessing /api/admin/metrics with 200 OK', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/metrics`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      expect(res.status).toBe(200);
    });

    it('rejects anonymous request to /api/admin/metrics with 401 Unauthorized', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/metrics`);
      expect(res.status).toBe(401);
    });
  });
});
