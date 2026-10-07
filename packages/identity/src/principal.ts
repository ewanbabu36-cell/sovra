/**
 * @file packages/identity/src/principal.ts
 * Canonical Authenticated Principal Model & Role-Based Access Control (RBAC).
 */

export type PrincipalCapability =
  | 'social:read'
  | 'social:write'
  | 'social:delete'
  | 'knowledge:read'
  | 'knowledge:write'
  | 'chat:send'
  | 'chat:read'
  | 'financial:transfer'
  | 'admin:metrics'
  | 'admin:moderate'
  | 'admin:security'
  | 'admin:panic'
  | 'admin:super';

export type AdminRole =
  | 'SUPER_ADMIN'
  | 'SECURITY_ADMIN'
  | 'MODERATOR'
  | 'SUPPORT'
  | 'ANALYST'
  | 'INFRA_OPERATOR'
  | 'USER';

export interface AuthenticatedPrincipal {
  readonly did: string;
  readonly deviceId: string;
  readonly sessionId: string;
  readonly role: AdminRole;
  readonly capabilities: readonly PrincipalCapability[];
  readonly authenticationMethod: 'BEARER_TOKEN' | 'ED25519_SIGNATURE' | 'PASSKEY';
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/**
 * Resolves canonical capabilities for a given role according to Sovra Security Policy.
 */
export function getRoleCapabilities(role: AdminRole): readonly PrincipalCapability[] {
  switch (role) {
    case 'SUPER_ADMIN':
      return [
        'social:read',
        'social:write',
        'social:delete',
        'knowledge:read',
        'knowledge:write',
        'chat:send',
        'chat:read',
        'financial:transfer',
        'admin:metrics',
        'admin:moderate',
        'admin:security',
        'admin:panic',
        'admin:super',
      ];
    case 'SECURITY_ADMIN':
      return [
        'social:read',
        'knowledge:read',
        'admin:metrics',
        'admin:security',
        'admin:panic',
      ];
    case 'MODERATOR':
      return [
        'social:read',
        'social:delete',
        'knowledge:read',
        'admin:metrics',
        'admin:moderate',
      ];
    case 'INFRA_OPERATOR':
      return [
        'admin:metrics',
        'admin:security',
      ];
    case 'ANALYST':
      return [
        'admin:metrics',
      ];
    case 'SUPPORT':
      return [
        'social:read',
        'admin:metrics',
      ];
    case 'USER':
    default:
      return [
        'social:read',
        'social:write',
        'social:delete',
        'knowledge:read',
        'knowledge:write',
        'chat:send',
        'chat:read',
        'financial:transfer',
      ];
  }
}

/**
 * Validates whether the authenticated principal possesses the required capability.
 */
export function hasCapability(
  principal: AuthenticatedPrincipal,
  capability: PrincipalCapability,
): boolean {
  if (principal.role === 'SUPER_ADMIN') {
    return true;
  }
  return principal.capabilities.includes(capability);
}

/**
 * Constructs a verified AuthenticatedPrincipal instance.
 */
export function createAuthenticatedPrincipal(params: {
  did: string;
  deviceId?: string;
  sessionId: string;
  role?: AdminRole;
  authenticationMethod?: 'BEARER_TOKEN' | 'ED25519_SIGNATURE' | 'PASSKEY';
  ttlSeconds?: number;
}): AuthenticatedPrincipal {
  const now = Math.floor(Date.now() / 1000);
  const ttl = params.ttlSeconds ?? (24 * 3600); // 24 hours default session
  const role: AdminRole = params.role ?? 'USER';

  return {
    did: params.did,
    deviceId: params.deviceId || 'primary_device',
    sessionId: params.sessionId,
    role,
    capabilities: getRoleCapabilities(role),
    authenticationMethod: params.authenticationMethod ?? 'BEARER_TOKEN',
    issuedAt: now,
    expiresAt: now + ttl,
  };
}
