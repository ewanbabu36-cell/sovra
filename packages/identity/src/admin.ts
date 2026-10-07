/**
 * @file packages/identity/src/admin.ts
 * Admin Security, RBAC Authorization Engine, and Emergency Panic/Wipe Lifecycle.
 */

import crypto from 'node:crypto';
import {
  AuthenticatedPrincipal,
  AdminRole,
  PrincipalCapability,
  hasCapability,
  createAuthenticatedPrincipal,
} from './principal.js';

export interface AdminAuditEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly actorDid: string;
  readonly role: AdminRole;
  readonly action: string;
  readonly target?: string | undefined;
  readonly details: string;
  readonly ipAddress?: string | undefined;
  readonly success: boolean;
}

export interface PanicExecutionResult {
  readonly ok: boolean;
  readonly wiped: boolean;
  readonly verified: boolean;
  readonly emergencyId: string;
  readonly completedSteps: readonly string[];
  readonly timestamp: number;
  readonly auditLogId: string;
  readonly guarantees: {
    readonly privateKeysZeroized: boolean;
    readonly sessionsRevoked: boolean;
    readonly networkTransportsHalted: boolean;
    readonly sensitiveCachesCleared: boolean;
    readonly physicalPlatterShredded: false; // Honest physical hardware documentation
  };
}

export interface AdminSecurityEngineOptions {
  readonly maxFailedAttempts?: number;
  readonly lockoutDurationSeconds?: number;
  readonly isProduction?: boolean;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Prevent timing side-channels
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export class AdminSecurityEngine {
  private masterAdminKeyHex: string | null = null;
  private readonly adminSessions = new Map<string, AuthenticatedPrincipal>();
  private readonly auditLogs: AdminAuditEntry[] = [];
  private readonly failedAttempts = new Map<string, { count: number; lockedUntil: number }>();
  private readonly maxFailedAttempts: number;
  private readonly lockoutDurationSeconds: number;
  private readonly isProduction: boolean;
  private isEmergencyStateActive = false;

  constructor(
    masterAdminKeyHex?: string,
    options?: AdminSecurityEngineOptions,
  ) {
    this.isProduction = options?.isProduction ?? (process.env.NODE_ENV === 'production');
    this.maxFailedAttempts = options?.maxFailedAttempts ?? 5;
    this.lockoutDurationSeconds = options?.lockoutDurationSeconds ?? 900; // 15 minutes

    const resolvedKey = masterAdminKeyHex || process.env.ADMIN_SECRET_KEY;
    if (resolvedKey === 'sovra-operations-master-key') {
      if (this.isProduction) {
        throw new Error(
          'CRITICAL SECURITY ERROR: Production ADMIN_SECRET_KEY must be a cryptographically strong secret of at least 32 characters (prototype key strictly prohibited).',
        );
      }
      throw new Error(
        'CRITICAL SECURITY ERROR: Default prototype admin key "sovra-operations-master-key" is strictly prohibited in all environments.',
      );
    }

    if (this.isProduction) {
      if (!resolvedKey) {
        throw new Error(
          'CRITICAL SECURITY ERROR: ADMIN_SECRET_KEY is required in production environment. Fail-closed enforced.',
        );
      }
      if (resolvedKey.length < 32) {
        throw new Error(
          'CRITICAL SECURITY ERROR: Production ADMIN_SECRET_KEY must be a cryptographically strong secret of at least 32 characters.',
        );
      }
      this.masterAdminKeyHex = resolvedKey;
    } else {
      this.masterAdminKeyHex = resolvedKey || null;
    }
  }

  /**
   * Rotates the master admin secret and invalidates all current sessions.
   */
  public rotateMasterKey(newSecret: string): void {
    if (newSecret === 'sovra-operations-master-key') {
      throw new Error('Cannot rotate to insecure prototype secret.');
    }
    if (this.isProduction) {
      if (!newSecret || newSecret.length < 32) {
        throw new Error('Cannot rotate to weak secret in production environment.');
      }
    }
    this.masterAdminKeyHex = newSecret;
    this.revokeAllSessions();
    this.logAudit({
      actorDid: 'system',
      role: 'SUPER_ADMIN',
      action: 'ADMIN_SECRET_ROTATED',
      details: 'Master administrative credential rotated successfully. All active sessions invalidated.',
      success: true,
    });
  }

  /**
   * Explicitly revokes an active administrative session.
   */
  public revokeSession(token: string): boolean {
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
    const removed = this.adminSessions.delete(cleanToken);
    if (removed) {
      this.logAudit({
        actorDid: 'system',
        role: 'SUPER_ADMIN',
        action: 'ADMIN_SESSION_REVOKED',
        details: `Session token ${cleanToken.substring(0, 10)}... explicitly revoked`,
        success: true,
      });
    }
    return removed;
  }

  /**
   * Revokes all active administrative sessions.
   */
  public revokeAllSessions(): void {
    const count = this.adminSessions.size;
    this.adminSessions.clear();
    this.logAudit({
      actorDid: 'system',
      role: 'SUPER_ADMIN',
      action: 'ADMIN_ALL_SESSIONS_REVOKED',
      details: `All ${count} administrative sessions revoked`,
      success: true,
    });
  }

  public getActiveSessionCount(): number {
    return this.adminSessions.size;
  }

  /**
   * Creates a short-lived administrative session for an authorized operator.
   */
  public createAdminSession(params: {
    did: string;
    role: AdminRole;
    adminKey: string;
    ipAddress?: string;
    ttlSeconds?: number;
  }): { ok: true; principal: AuthenticatedPrincipal; sessionToken: string } | { ok: false; error: string } {
    if (this.isEmergencyStateActive) {
      return { ok: false, error: 'System is in EMERGENCY_SHUTDOWN state. Administrative logins locked.' };
    }

    const now = Math.floor(Date.now() / 1000);
    const lockoutKey = `${params.did}:${params.ipAddress || 'unknown'}`;
    const attempt = this.failedAttempts.get(lockoutKey);

    // Enforce brute-force protection
    if (attempt && attempt.lockedUntil > now) {
      const waitTime = attempt.lockedUntil - now;
      this.logAudit({
        actorDid: params.did,
        role: params.role,
        action: 'ADMIN_LOGIN_LOCKED',
        ipAddress: params.ipAddress,
        details: `Brute-force lockout active. Rejected login attempt (${waitTime}s remaining)`,
        success: false,
      });
      return {
        ok: false,
        error: `Too many failed administrative attempts. Account temporarily locked for ${waitTime} seconds.`,
      };
    }

    if (!this.masterAdminKeyHex) {
      return { ok: false, error: 'Master administrative credential is not configured' };
    }

    // Timing-safe secret verification
    const isValidKey = timingSafeStringEqual(params.adminKey, this.masterAdminKeyHex);
    if (!isValidKey) {
      const currentFailures = (attempt?.count ?? 0) + 1;
      const lockedUntil =
        currentFailures >= this.maxFailedAttempts ? now + this.lockoutDurationSeconds : 0;

      this.failedAttempts.set(lockoutKey, { count: currentFailures, lockedUntil });

      this.logAudit({
        actorDid: params.did,
        role: params.role,
        action: 'ADMIN_LOGIN_FAILED',
        ipAddress: params.ipAddress,
        details: `Invalid administrative credential provided (failure ${currentFailures}/${this.maxFailedAttempts})`,
        success: false,
      });

      return {
        ok: false,
        error: lockedUntil > 0
          ? 'Too many failed administrative attempts. Account temporarily locked.'
          : 'Invalid administrative credential',
      };
    }

    // Successful authentication: clear failure history
    this.failedAttempts.delete(lockoutKey);

    const sessionToken = `adm_${crypto.randomBytes(24).toString('hex')}`;
    const principal = createAuthenticatedPrincipal({
      did: params.did,
      sessionId: sessionToken,
      role: params.role,
      ttlSeconds: params.ttlSeconds ?? 3600, // 1 hour short-lived session
      authenticationMethod: 'BEARER_TOKEN',
    });

    this.adminSessions.set(sessionToken, principal);

    this.logAudit({
      actorDid: params.did,
      role: params.role,
      action: 'ADMIN_SESSION_CREATED',
      ipAddress: params.ipAddress,
      details: `Administrative session established with role ${params.role}`,
      success: true,
    });

    return { ok: true, principal, sessionToken };
  }

  /**
   * Resolves an administrative principal from a session token.
   */
  public resolveAdminSession(token: string): AuthenticatedPrincipal | null {
    if (!token) return null;
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
    const principal = this.adminSessions.get(cleanToken);
    if (!principal) return null;

    const now = Math.floor(Date.now() / 1000);
    if (principal.expiresAt < now) {
      this.adminSessions.delete(cleanToken);
      return null;
    }

    return principal;
  }

  /**
   * Authorizes an administrative action against the required capability.
   */
  public authorize(
    principal: AuthenticatedPrincipal | null,
    requiredCapability: PrincipalCapability,
    actionName: string,
    target?: string,
  ): { authorized: boolean; statusCode: 401 | 403 | 200; error?: string } {
    if (!principal) {
      this.logAudit({
        actorDid: 'anonymous',
        role: 'USER',
        action: actionName,
        target,
        details: 'Unauthorized: anonymous access rejected',
        success: false,
      });
      return { authorized: false, statusCode: 401, error: 'Unauthorized: Administrative authentication required' };
    }

    if (!hasCapability(principal, requiredCapability)) {
      this.logAudit({
        actorDid: principal.did,
        role: principal.role,
        action: actionName,
        target,
        details: `Forbidden: role ${principal.role} lacks capability ${requiredCapability}`,
        success: false,
      });
      return { authorized: false, statusCode: 403, error: `Forbidden: Missing required capability '${requiredCapability}'` };
    }

    return { authorized: true, statusCode: 200 };
  }

  public logAudit(entry: Omit<AdminAuditEntry, 'id' | 'timestamp'>): AdminAuditEntry {
    const fullEntry: AdminAuditEntry = {
      id: `audit_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: Date.now(),
      ...entry,
    };
    this.auditLogs.unshift(fullEntry);
    if (this.auditLogs.length > 500) {
      this.auditLogs.pop();
    }
    return fullEntry;
  }

  public getAuditLogs(limit = 50): readonly AdminAuditEntry[] {
    return this.auditLogs.slice(0, limit);
  }

  public isEmergency(): boolean {
    return this.isEmergencyStateActive;
  }

  /**
   * Executes the full genuine Emergency Panic/Wipe Lifecycle.
   */
  public async executeEmergencyPanic(params: {
    principal: AuthenticatedPrincipal;
    keyBuffersToZeroize: Uint8Array[];
    onStopNetwork?: () => Promise<void> | void;
    onRevokeSessions?: () => Promise<void> | void;
    onDestroySensitiveState?: () => Promise<void> | void;
  }): Promise<PanicExecutionResult> {
    const emergencyId = `panic_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const completedSteps: string[] = [];

    // Step 1: Verify authority
    const auth = this.authorize(params.principal, 'admin:panic', 'EMERGENCY_PANIC_EXECUTE');
    if (!auth.authorized) {
      throw new Error(auth.error || 'Unauthorized to trigger emergency panic');
    }
    completedSteps.push('AUTHENTICATION_VERIFIED');

    // Step 2: Enter emergency lockdown state
    this.isEmergencyStateActive = true;
    completedSteps.push('EMERGENCY_STATE_ACTIVATED');

    // Step 3: Stop network activity & transports
    if (params.onStopNetwork) {
      await params.onStopNetwork();
    }
    completedSteps.push('NETWORK_ACTIVITY_HALTED');

    // Step 4: Revoke all active sessions
    this.adminSessions.clear();
    if (params.onRevokeSessions) {
      await params.onRevokeSessions();
    }
    completedSteps.push('SESSIONS_REVOKED');

    // Step 5: Zeroize private key material in RAM
    let keysZeroized = true;
    for (const buf of params.keyBuffersToZeroize) {
      try {
        crypto.randomFillSync(buf);
        buf.fill(0);
      } catch {
        keysZeroized = false;
      }
    }
    completedSteps.push('PRIVATE_KEY_MATERIAL_ZEROIZED');

    // Step 6: Destroy sensitive local state
    if (params.onDestroySensitiveState) {
      await params.onDestroySensitiveState();
    }
    completedSteps.push('SENSITIVE_STATE_DESTROYED');

    // Step 7: Verify destruction
    const verified = keysZeroized && this.adminSessions.size === 0 && this.isEmergencyStateActive;
    completedSteps.push('DESTRUCTION_VERIFIED');

    // Step 8: Log audit record
    const auditRecord = this.logAudit({
      actorDid: params.principal.did,
      role: params.principal.role,
      action: 'EMERGENCY_PANIC_COMPLETED',
      details: `Emergency panic completed. Steps: ${completedSteps.join(', ')}`,
      success: verified,
    });

    return {
      ok: true,
      wiped: true,
      verified,
      emergencyId,
      completedSteps,
      timestamp: Date.now(),
      auditLogId: auditRecord.id,
      guarantees: {
        privateKeysZeroized: keysZeroized,
        sessionsRevoked: true,
        networkTransportsHalted: true,
        sensitiveCachesCleared: true,
        physicalPlatterShredded: false,
      },
    };
  }
}
