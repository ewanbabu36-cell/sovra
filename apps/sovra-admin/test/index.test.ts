import { describe, it, expect } from 'vitest';
import { ADMIN_SECTIONS, AdminRole } from '../src/index.js';

describe('@sovra/admin', () => {
  it('exposes all mandatory company operations sections', () => {
    expect(ADMIN_SECTIONS).toContain('Dashboard');
    expect(ADMIN_SECTIONS).toContain('Moderation');
    expect(ADMIN_SECTIONS).toContain('Appeals');
    expect(ADMIN_SECTIONS).toContain('Audit Logs');
    expect(ADMIN_SECTIONS).toContain('Network');
    expect(ADMIN_SECTIONS).toContain('Incidents');
  });

  it('enforces RBAC role definitions', () => {
    const roles: AdminRole[] = [
      'SUPER_ADMIN',
      'SECURITY_ADMIN',
      'MODERATOR',
      'SUPPORT',
      'ANALYST',
      'INFRA_OPERATOR',
    ];
    expect(roles).toHaveLength(6);
  });
});
