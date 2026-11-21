/**
 * 👑 SOVRA PROTOCOL - ZERO-DOWNTIME SECRET ROTATION MANAGER
 * File: services/api/src/monitoring/secret-rotation.ts
 *
 * Implements:
 * 1. Dual-secret rotation with configurable grace transition period
 * 2. In-flight request acceptance using primary or active secondary secret
 * 3. Retirement and revocation of decommissioned secrets
 * 4. SIEM audit event recording on rotation
 */

import crypto from 'node:crypto';
import { securityEventCollector } from './security-events.js';

export interface SecretVersion {
  version: number;
  secret: string;
  createdAt: number;
  expiresAt?: number | undefined;
  active: boolean;
}

export class SecretRotationManager {
  private versions: SecretVersion[] = [];
  private currentVersion = 1;
  private gracePeriodMs: number;

  constructor(initialSecret: string, gracePeriodMs = 3600_000) {
    this.gracePeriodMs = gracePeriodMs;
    this.versions.push({
      version: 1,
      secret: initialSecret,
      createdAt: Date.now(),
      active: true,
    });
  }

  /**
   * Generates a new cryptographically secure secret and stages it as active primary.
   * The previous secret remains valid for the duration of gracePeriodMs.
   */
  public rotateSecret(newSecret?: string): SecretVersion {
    const generated =
      newSecret || `sovra_sec_${Date.now()}_${crypto.randomBytes(32).toString('hex')}`;
    const previous = this.getActiveVersion();

    if (previous) {
      previous.expiresAt = Date.now() + this.gracePeriodMs;
    }

    this.currentVersion += 1;
    const newVersion: SecretVersion = {
      version: this.currentVersion,
      secret: generated,
      createdAt: Date.now(),
      active: true,
    };

    this.versions.push(newVersion);

    securityEventCollector.recordEvent(
      'INFO',
      'SECRET_ROTATION',
      'SERVICE_SECRET_ROTATED',
      {
        newVersion: newVersion.version,
        gracePeriodMs: this.gracePeriodMs,
        previousVersion: previous?.version,
      }
    );

    return newVersion;
  }

  /**
   * Retrieves the current active primary secret
   */
  public getCurrentSecret(): string {
    const v = this.getActiveVersion();
    return v ? v.secret : '';
  }

  /**
   * Validates whether a candidate token matches either the current primary secret
   * or a valid, non-expired secondary secret in its grace window.
   */
  public isValidSecret(candidate: string): boolean {
    const now = Date.now();
    for (const v of this.versions) {
      if (!v.active) continue;
      if (v.expiresAt && now > v.expiresAt) {
        v.active = false; // Mark retired
        continue;
      }
      if (candidate === v.secret) {
        return true;
      }
    }
    return false;
  }

  /**
   * Retrieves all currently valid secrets (active primary + valid secondary in grace period)
   */
  public getValidSecrets(): string[] {
    const now = Date.now();
    const valid: string[] = [];
    for (const v of this.versions) {
      if (!v.active) continue;
      if (v.expiresAt && now > v.expiresAt) {
        v.active = false;
        continue;
      }
      valid.push(v.secret);
    }
    return valid;
  }

  /**
   * Immediately revokes a retired or compromised secret version
   */
  public revokeVersion(versionNumber: number): boolean {
    const target = this.versions.find((v) => v.version === versionNumber);
    if (!target) return false;
    target.active = false;
    target.expiresAt = Date.now();

    securityEventCollector.recordEvent(
      'WARN',
      'SECRET_ROTATION',
      'SECRET_VERSION_REVOKED',
      { version: versionNumber }
    );
    return true;
  }

  public getActiveVersion(): SecretVersion | undefined {
    return this.versions.find((v) => v.version === this.currentVersion);
  }

  public getAuditHistory(): Array<Omit<SecretVersion, 'secret'>> {
    return this.versions.map(({ version, createdAt, expiresAt, active }) => ({
      version,
      createdAt,
      expiresAt,
      active,
    }));
  }
}
