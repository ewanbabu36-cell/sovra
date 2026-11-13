import { describe, it, expect, beforeAll } from 'vitest';

describe('Sovra Super-Console Systems & Security Apex REST API Invariants', () => {
  const baseUrl = 'http://localhost:3001';
  const adminSecret = 'sovra-test-admin-secret-key-32-chars-ok!';

  let rootToken = '';
  let commanderToken = '';
  let moderatorToken = '';

  beforeAll(async () => {
    // 1. Establish Root Admin Session (SUPER_ADMIN)
    const rootLogin = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: 'did:sov:admin_root',
        role: 'SUPER_ADMIN',
        adminKey: adminSecret,
      }),
    });
    const rootData = await rootLogin.json();
    expect(rootData.ok).toBe(true);
    rootToken = rootData.sessionToken;
    expect(rootToken).toBeDefined();

    // 2. Establish Incident Commander Session (INCIDENT_COMMANDER)
    const cmdLogin = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: 'did:sov:admin_commander',
        role: 'INCIDENT_COMMANDER',
        adminKey: adminSecret,
      }),
    });
    const cmdData = await cmdLogin.json();
    expect(cmdData.ok).toBe(true);
    commanderToken = cmdData.sessionToken;
    expect(commanderToken).toBeDefined();

    // 3. Establish Content Moderator Session (CONTENT_MODERATOR)
    const modLogin = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: 'did:sov:admin_moderator',
        role: 'CONTENT_MODERATOR',
        adminKey: adminSecret,
      }),
    });
    const modData = await modLogin.json();
    expect(modData.ok).toBe(true);
    moderatorToken = modData.sessionToken;
    expect(moderatorToken).toBeDefined();
  });

  // =========================================================================
  // CONSTRAINT 4: RBAC Roles Management & Role Isolation
  // =========================================================================
  it('should reject unauthenticated request to /api/admin/rbac/roles with 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/api/admin/rbac/roles`);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/UNAUTHORIZED/i);
  });

  it('should list pre-seeded RBAC roles and permissions via GET /api/admin/rbac/roles for authorized admin', async () => {
    const res = await fetch(`${baseUrl}/api/admin/rbac/roles`, {
      headers: {
        Authorization: `Bearer ${rootToken}`,
      },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.roles)).toBe(true);

    const rootRole = data.roles.find((r: any) => r.adminDid === 'did:sov:admin_root');
    expect(rootRole).toBeDefined();
    expect(rootRole.role).toBe('SUPER_ADMIN');
    expect(rootRole.permissions).toContain('*');

    const commanderRole = data.roles.find((r: any) => r.adminDid === 'did:sov:admin_commander');
    expect(commanderRole).toBeDefined();
    expect(commanderRole.permissions).toContain('kill_switches:write');
  });

  it('should reject unauthenticated role assignment attempt with 401 Unauthorized', async () => {
    const assignRes = await fetch(`${baseUrl}/api/admin/rbac/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        adminDid: 'did:sov:unauth_test',
        role: 'NETWORK_OPERATOR',
        permissions: ['telemetry:read'],
      }),
    });
    expect(assignRes.status).toBe(401);
  });

  it('should assign a new RBAC role via POST /api/admin/rbac/assign for Super Admin', async () => {
    const customAdminDid = 'did:sov:test_ops_' + Date.now();
    const assignRes = await fetch(`${baseUrl}/api/admin/rbac/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rootToken}`,
      },
      body: JSON.stringify({
        adminDid: customAdminDid,
        role: 'NETWORK_OPERATOR',
        permissions: ['telemetry:read', 'wiretap:read'],
      }),
    });

    expect(assignRes.status).toBe(200);
    const assignData = await assignRes.json();
    expect(assignData.ok).toBe(true);

    // Verify it appears in roles list
    const rolesRes = await fetch(`${baseUrl}/api/admin/rbac/roles`, {
      headers: {
        Authorization: `Bearer ${rootToken}`,
      },
    });
    const rolesData = await rolesRes.json();
    const assigned = rolesData.roles.find((r: any) => r.adminDid === customAdminDid);
    expect(assigned).toBeDefined();
    expect(assigned.role).toBe('NETWORK_OPERATOR');
    expect(assigned.permissions).toEqual(['telemetry:read', 'wiretap:read']);
  });

  // =========================================================================
  // CONSTRAINT 4: Strict RBAC Permission Enforcement on Destructive Actions
  // =========================================================================
  it('should reject unauthorized role with 403 Forbidden on nuclear kill-switch trigger', async () => {
    // Content Moderator attempting to trigger nuclear kill switch (lacks kill_switches:write)
    const res = await fetch(`${baseUrl}/api/admin/nuclear/switch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${moderatorToken}`,
      },
      body: JSON.stringify({
        switchId: 'MEDIA_UPLOADS_FROZEN',
        active: true,
      }),
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/RBAC_PERMISSION_DENIED/i);
    expect(data.error).toMatch(/kill_switches:write/i);
  });

  it('should authorize Incident Commander on nuclear kill-switch and log tamper-evident audit record', async () => {
    // Incident Commander toggles switch (possesses kill_switches:write)
    const res = await fetch(`${baseUrl}/api/admin/nuclear/switch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${commanderToken}`,
      },
      body: JSON.stringify({
        switchId: 'WEBRTC_CALLING_FROZEN',
        active: false,
        reason: 'Authorized drill test',
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    // Verify cryptographic audit log contains this mutation
    const auditRes = await fetch(`${baseUrl}/api/admin/audit/ledger?limit=10`, {
      headers: {
        Authorization: `Bearer ${rootToken}`,
      },
    });
    const auditData = await auditRes.json();
    expect(auditData.ok).toBe(true);

    const entry = auditData.ledger.find((e: any) => e.targetResource === 'WEBRTC_CALLING_FROZEN');
    expect(entry).toBeDefined();
    expect(entry.adminDid).toBe('did:sov:admin_commander');
    expect(entry.actionType).toBe('KILL_SWITCH_MUTATED');
    expect(entry.currentHash).toBeDefined();
  });

  // =========================================================================
  // CONSTRAINT 4: Cryptographic Merkle Chain Integrity Verification
  // =========================================================================
  it('should verify cryptographic SHA-256 Merkle chain integrity via /api/admin/audit/verify-chain', async () => {
    const res = await fetch(`${baseUrl}/api/admin/audit/verify-chain`, {
      headers: {
        Authorization: `Bearer ${rootToken}`,
      },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.audit.isValid).toBe(true);
    expect(data.audit.totalEntries).toBeGreaterThanOrEqual(1);
    expect(data.audit.headHash).toMatch(/^[a-f0-9]{64}$/);
  });

  // =========================================================================
  // CONSTRAINT 3: Atomic 4-Column Double-Entry Ledger Transfer API
  // =========================================================================
  it('should reject unauthorized role on atomic double-entry balance mutation', async () => {
    const res = await fetch(`${baseUrl}/api/admin/ledger/atomic-transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${moderatorToken}`, // Lacks ledger:transfer
      },
      body: JSON.stringify({
        fromDid: 'did:sov:sender_unauth',
        toDid: 'did:sov:receiver_unauth',
        amountSov: 100.0,
      }),
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/RBAC_PERMISSION_DENIED/i);
    expect(data.error).toMatch(/ledger:transfer/i);
  });

  // =========================================================================
  // CONSTRAINT 2: Zero Thread Blocking Async Wash-Trading Scan API
  // =========================================================================
  it('should execute non-blocking time-budgeted async wash-trading cycle scan', async () => {
    const res = await fetch(`${baseUrl}/api/admin/revenue/wash-trading-async`, {
      headers: {
        Authorization: `Bearer ${rootToken}`,
      },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.cycles)).toBe(true);
  });
});
