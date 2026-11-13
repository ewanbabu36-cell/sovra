/**
 * @file packages/identity/src/governance/admin-identity.ts
 * SOVRA Administrator Identity Registry & Pseudonymous Control Engine.
 *
 * Enforces:
 * 1. Independent cryptographic DID authentication for every admin.
 * 2. Support for pseudonymous administrator handles.
 * 3. Short session TTLs & brute-force lockout safeguards.
 * 4. Action attribution verification via Ed25519 signatures.
 */

import crypto from 'node:crypto';
import {
  verifyEd25519,
  hexToBytes,
  bytesToHex,
} from '@sovra/crypto';
import { ValidationError } from '@sovra/shared';
import { AdminRole } from '../principal.js';

export interface AdminIdentityRecord {
  readonly adminDid: string;
  readonly pseudonym: string;
  readonly publicKeyHex: string;
  readonly role: AdminRole;
  readonly registeredAt: number;
  readonly active: boolean;
}

export interface AdminSession {
  readonly sessionToken: string;
  readonly adminDid: string;
  readonly role: AdminRole;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export class AdminIdentityRegistry {
  private readonly admins = new Map<string, AdminIdentityRecord>();
  private readonly sessions = new Map<string, AdminSession>();
  private readonly failedAttempts = new Map<string, { count: number; lockedUntil: number }>();

  public static readonly MAX_FAILED_ATTEMPTS = 5;
  public static readonly LOCKOUT_DURATION_SECONDS = 900; // 15 minutes
  public static readonly DEFAULT_SESSION_TTL_SECONDS = 3600; // 1 hour

  /**
   * Registers a new administrator under a pseudonymous handle and public key.
   */
  public registerAdmin(params: {
    pseudonym: string;
    publicKeyBytes: Uint8Array;
    role: AdminRole;
    registeredAt?: number;
  }): AdminIdentityRecord {
    if (params.publicKeyBytes.length !== 32) {
      throw new ValidationError('Admin public key must be exactly 32 bytes (Ed25519)');
    }

    const publicKeyHex = bytesToHex(params.publicKeyBytes);
    const adminDid = `did:sovra:admin:${publicKeyHex.slice(0, 16)}`;

    if (this.admins.has(adminDid)) {
      throw new ValidationError(`Admin ${adminDid} is already registered`);
    }

    const record: AdminIdentityRecord = {
      adminDid,
      pseudonym: params.pseudonym.trim(),
      publicKeyHex,
      role: params.role,
      registeredAt: params.registeredAt ?? Math.floor(Date.now() / 1000),
      active: true,
    };

    this.admins.set(adminDid, record);
    return record;
  }

  public getAdmin(adminDid: string): AdminIdentityRecord | undefined {
    return this.admins.get(adminDid);
  }

  /**
   * Creates an ephemeral, short-lived session token with brute-force lockout protection.
   */
  public createSession(
    adminDid: string,
    signatureHex: string,
    challenge: string,
    ttlSeconds = AdminIdentityRegistry.DEFAULT_SESSION_TTL_SECONDS,
  ): { ok: true; session: AdminSession } | { ok: false; error: string } {
    const now = Math.floor(Date.now() / 1000);
    const attempt = this.failedAttempts.get(adminDid);

    if (attempt && attempt.lockedUntil > now) {
      const wait = attempt.lockedUntil - now;
      return {
        ok: false,
        error: `Account temporarily locked due to repeated authentication failures. Wait ${wait}s.`,
      };
    }

    const admin = this.admins.get(adminDid);
    if (!admin || !admin.active) {
      return { ok: false, error: 'Administrator not found or deactivated' };
    }

    // Verify challenge signature
    const challengeBytes = Buffer.from(challenge, 'utf8');
    const pubKeyBytes = hexToBytes(admin.publicKeyHex);
    const sigBytes = hexToBytes(signatureHex);

    const valid = verifyEd25519(pubKeyBytes, challengeBytes, sigBytes);
    if (!valid) {
      const failures = (attempt?.count ?? 0) + 1;
      const lockedUntil =
        failures >= AdminIdentityRegistry.MAX_FAILED_ATTEMPTS
          ? now + AdminIdentityRegistry.LOCKOUT_DURATION_SECONDS
          : 0;

      this.failedAttempts.set(adminDid, { count: failures, lockedUntil });
      return {
        ok: false,
        error: lockedUntil > 0
          ? 'Too many failed attempts. Administrative account temporarily locked.'
          : 'Invalid signature for administrative challenge',
      };
    }

    // Success: clear failures
    this.failedAttempts.delete(adminDid);

    const sessionToken = `adm_sess_${crypto.randomBytes(24).toString('hex')}`;
    const session: AdminSession = {
      sessionToken,
      adminDid,
      role: admin.role,
      issuedAt: now,
      expiresAt: now + ttlSeconds,
    };

    this.sessions.set(sessionToken, session);
    return { ok: true, session };
  }

  /**
   * Verifies an administrative action signature against the admin's registered DID.
   */
  public verifyAction(
    adminDid: string,
    actionPayloadBytes: Uint8Array,
    signatureHex: string,
  ): boolean {
    const admin = this.admins.get(adminDid);
    if (!admin || !admin.active) return false;

    const pubKeyBytes = hexToBytes(admin.publicKeyHex);
    const sigBytes = hexToBytes(signatureHex);
    return verifyEd25519(pubKeyBytes, actionPayloadBytes, sigBytes);
  }

  /**
   * Deactivates an administrator.
   */
  public deactivateAdmin(adminDid: string): void {
    const admin = this.admins.get(adminDid);
    if (admin) {
      this.admins.set(adminDid, { ...admin, active: false });
    }
  }
}
