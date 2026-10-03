/**
 * Product B: Sovra Internal Operations Admin Panel RBAC
 * Privileged internal operations only. Never exposed to public consumer network.
 */

export type AdminRole =
  'SUPER_ADMIN' | 'SECURITY_ADMIN' | 'MODERATOR' | 'SUPPORT' | 'ANALYST' | 'INFRA_OPERATOR';

export interface AdminPermission {
  readonly action: string;
  readonly resource: string;
}

export interface AdminSession {
  readonly adminId: string;
  readonly role: AdminRole;
  readonly sessionExpiresAt: number;
  readonly mfaVerified: boolean;
  readonly ipAddress: string;
}

export const ADMIN_SECTIONS = [
  'Dashboard',
  'Users',
  'Creators',
  'Content',
  'Reports',
  'Moderation',
  'Appeals',
  'Communities',
  'Network',
  'Nodes',
  'Storage',
  'Relay Infrastructure',
  'Search / Index',
  'Security',
  'Analytics',
  'Policies',
  'Configuration',
  'Audit Logs',
  'Admin Accounts',
  'Incidents',
] as const;
