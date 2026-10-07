import { describe, it, expect } from 'vitest';
import { AdminSecurityEngine } from '../src/admin.js';
import { createAuthenticatedPrincipal } from '../src/principal.js';

describe('Admin Security & Emergency Panic Lifecycle Suite (@sovra/identity)', () => {
  const masterSecret = 'test-master-admin-key-sovra-99';

  it('authenticates admin and creates short-lived session', () => {
    const engine = new AdminSecurityEngine(masterSecret);

    // Invalid secret
    const failRes = engine.createAdminSession({
      did: 'did:sovra:admin_1',
      role: 'SUPER_ADMIN',
      adminKey: 'wrong-secret',
    });
    expect(failRes.ok).toBe(false);

    // Valid secret
    const successRes = engine.createAdminSession({
      did: 'did:sovra:admin_1',
      role: 'SUPER_ADMIN',
      adminKey: masterSecret,
    });
    expect(successRes.ok).toBe(true);
    if (!successRes.ok) return;

    expect(successRes.sessionToken.startsWith('adm_')).toBe(true);
    expect(successRes.principal.role).toBe('SUPER_ADMIN');

    // Resolve active session
    const resolved = engine.resolveAdminSession(successRes.sessionToken);
    expect(resolved).not.toBeNull();
    expect(resolved?.did).toBe('did:sovra:admin_1');
  });

  it('authorizes capabilities by role and rejects anonymous or deficient roles', () => {
    const engine = new AdminSecurityEngine(masterSecret);

    // Anonymous check
    const anonCheck = engine.authorize(null, 'admin:metrics', 'GET_METRICS');
    expect(anonCheck.authorized).toBe(false);
    expect(anonCheck.statusCode).toBe(401);

    // Normal user attempting admin action
    const userPrincipal = createAuthenticatedPrincipal({
      did: 'did:sovra:normal_user',
      sessionId: 'stk_user_1',
      role: 'USER',
    });
    const userCheck = engine.authorize(userPrincipal, 'admin:metrics', 'GET_METRICS');
    expect(userCheck.authorized).toBe(false);
    expect(userCheck.statusCode).toBe(403);

    // Moderator attempting admin:panic (forbidden)
    const modPrincipal = createAuthenticatedPrincipal({
      did: 'did:sovra:mod_1',
      sessionId: 'adm_mod_1',
      role: 'MODERATOR',
    });
    const modPanicCheck = engine.authorize(modPrincipal, 'admin:panic', 'EXEC_PANIC');
    expect(modPanicCheck.authorized).toBe(false);
    expect(modPanicCheck.statusCode).toBe(403);

    // Super Admin attempting admin:panic (allowed)
    const superPrincipal = createAuthenticatedPrincipal({
      did: 'did:sovra:super_1',
      sessionId: 'adm_super_1',
      role: 'SUPER_ADMIN',
    });
    const superPanicCheck = engine.authorize(superPrincipal, 'admin:panic', 'EXEC_PANIC');
    expect(superPanicCheck.authorized).toBe(true);
    expect(superPanicCheck.statusCode).toBe(200);
  });

  it('executes genuine Emergency Panic/Wipe lifecycle and zeroizes key material', async () => {
    const engine = new AdminSecurityEngine(masterSecret);
    const superPrincipal = createAuthenticatedPrincipal({
      did: 'did:sovra:sec_admin',
      sessionId: 'adm_sec_1',
      role: 'SECURITY_ADMIN',
    });

    const privateKeyBuffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    let networkStopped = false;
    let sessionsRevoked = false;
    let stateDestroyed = false;

    const panicResult = await engine.executeEmergencyPanic({
      principal: superPrincipal,
      keyBuffersToZeroize: [privateKeyBuffer],
      onStopNetwork: () => { networkStopped = true; },
      onRevokeSessions: () => { sessionsRevoked = true; },
      onDestroySensitiveState: () => { stateDestroyed = true; },
    });

    expect(panicResult.ok).toBe(true);
    expect(panicResult.wiped).toBe(true);
    expect(panicResult.verified).toBe(true);
    expect(networkStopped).toBe(true);
    expect(sessionsRevoked).toBe(true);
    expect(stateDestroyed).toBe(true);

    // Verify key material in RAM was completely zeroized
    expect(privateKeyBuffer.every(byte => byte === 0)).toBe(true);

    // Verify system is in emergency shutdown state
    expect(engine.isEmergency()).toBe(true);

    // Verify new admin sessions are blocked after panic
    const newSessionRes = engine.createAdminSession({
      did: 'did:sovra:admin_2',
      role: 'SUPER_ADMIN',
      adminKey: masterSecret,
    });
    expect(newSessionRes.ok).toBe(false);
    expect(newSessionRes.error).toContain('EMERGENCY_SHUTDOWN');
  });
});
