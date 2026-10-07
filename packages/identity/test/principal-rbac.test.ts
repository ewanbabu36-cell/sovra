import { describe, it, expect } from 'vitest';
import {
  createAuthenticatedPrincipal,
  getRoleCapabilities,
  hasCapability,
  type AdminRole,
} from '../src/principal.js';

describe('AuthenticatedPrincipal & RBAC Policy Suite (@sovra/identity)', () => {
  it('creates verified AuthenticatedPrincipal with role and capabilities', () => {
    const principal = createAuthenticatedPrincipal({
      did: 'did:sovra:user_alice123',
      deviceId: 'alice_iphone_secure_enclave',
      sessionId: 'stk_valid_session_token_xyz',
      role: 'USER',
    });

    expect(principal.did).toBe('did:sovra:user_alice123');
    expect(principal.deviceId).toBe('alice_iphone_secure_enclave');
    expect(principal.sessionId).toBe('stk_valid_session_token_xyz');
    expect(principal.role).toBe('USER');
    expect(principal.capabilities).toContain('social:write');
    expect(principal.capabilities).toContain('chat:send');
    expect(principal.capabilities).not.toContain('admin:panic');
    expect(principal.capabilities).not.toContain('admin:super');
  });

  it('enforces role capability matrix strictly', () => {
    const roles: AdminRole[] = [
      'SUPER_ADMIN',
      'SECURITY_ADMIN',
      'MODERATOR',
      'SUPPORT',
      'ANALYST',
      'INFRA_OPERATOR',
      'USER',
    ];

    roles.forEach(role => {
      const caps = getRoleCapabilities(role);
      expect(Array.isArray(caps)).toBe(true);
      expect(caps.length).toBeGreaterThan(0);
    });

    const superAdmin = createAuthenticatedPrincipal({
      did: 'did:sovra:admin_root',
      sessionId: 'adm_token_1',
      role: 'SUPER_ADMIN',
    });
    expect(hasCapability(superAdmin, 'admin:super')).toBe(true);
    expect(hasCapability(superAdmin, 'admin:panic')).toBe(true);
    expect(hasCapability(superAdmin, 'admin:metrics')).toBe(true);

    const moderator = createAuthenticatedPrincipal({
      did: 'did:sovra:mod_bob',
      sessionId: 'adm_token_2',
      role: 'MODERATOR',
    });
    expect(hasCapability(moderator, 'admin:moderate')).toBe(true);
    expect(hasCapability(moderator, 'admin:panic')).toBe(false);
    expect(hasCapability(moderator, 'admin:super')).toBe(false);

    const analyst = createAuthenticatedPrincipal({
      did: 'did:sovra:analyst_carol',
      sessionId: 'adm_token_3',
      role: 'ANALYST',
    });
    expect(hasCapability(analyst, 'admin:metrics')).toBe(true);
    expect(hasCapability(analyst, 'admin:moderate')).toBe(false);
    expect(hasCapability(analyst, 'admin:panic')).toBe(false);
  });
});
