/**
 * @file packages/identity/src/governance/succession.ts
 * SOVRA Succession Management & Autonomous Continuity Engine.
 *
 * Enforces:
 * 1. Founder liveness heartbeat tracking (configurable timelock, default 180 days).
 * 2. Inactivity scaling extension buffers.
 * 3. Voluntary retirement and succession handover.
 * 4. Automated transition to Community Stewardship without blockchain downtime.
 */

import {
  verifyEd25519,
  hexToBytes,
} from '@sovra/crypto';
import { ValidationError } from '@sovra/shared';

export type SuccessionState =
  | 'ACTIVE_FOUNDER'
  | 'INACTIVITY_GRACE'
  | 'SUCCESSION_TRIGGERED'
  | 'COMMUNITY_STEWARDSHIP';

export interface SuccessionRecord {
  readonly founderDid: string;
  readonly lastHeartbeatTimestamp: number;
  readonly inactivityTimeoutSeconds: number;
  readonly successorCouncilDIDs: readonly string[];
  readonly state: SuccessionState;
  readonly successionTriggeredAt?: number | undefined;
  readonly handoverStatement?: string | undefined;
}

export class SuccessionManagementEngine {
  private record: SuccessionRecord | null = null;
  public static readonly DEFAULT_INACTIVITY_TIMEOUT_SECONDS = 180 * 86400; // 180 days

  /**
   * Initializes succession management for a registered founder and successor council.
   */
  public initializeSuccession(params: {
    founderDid: string;
    successorCouncilDIDs: string[];
    inactivityTimeoutSeconds?: number;
    initialTimestamp?: number;
  }): SuccessionRecord {
    if (params.successorCouncilDIDs.length < 3) {
      throw new ValidationError('Successor council must contain at least 3 independent members');
    }

    const now = params.initialTimestamp ?? Math.floor(Date.now() / 1000);
    this.record = {
      founderDid: params.founderDid,
      lastHeartbeatTimestamp: now,
      inactivityTimeoutSeconds:
        params.inactivityTimeoutSeconds ?? SuccessionManagementEngine.DEFAULT_INACTIVITY_TIMEOUT_SECONDS,
      successorCouncilDIDs: Object.freeze([...params.successorCouncilDIDs]),
      state: 'ACTIVE_FOUNDER',
    };

    return this.record!;
  }

  public getRecord(): SuccessionRecord {
    if (!this.record) {
      throw new ValidationError('Succession management is not initialized');
    }
    return this.record!;
  }

  /**
   * Records a cryptographically signed founder liveness heartbeat ping.
   */
  public recordHeartbeat(params: {
    founderDid: string;
    founderPublicKeyBytes: Uint8Array;
    signatureHex: string;
    timestamp?: number;
  }): SuccessionRecord {
    const rec = this.getRecord();
    if (params.founderDid !== rec.founderDid) {
      throw new ValidationError('Heartbeat DID does not match registered founder DID');
    }

    if (rec.state === 'COMMUNITY_STEWARDSHIP') {
      throw new ValidationError('Cannot update heartbeat: Community stewardship has already been established');
    }

    const now = params.timestamp ?? Math.floor(Date.now() / 1000);
    const payload = `SOVRA_FOUNDER_HEARTBEAT:${params.founderDid}:${now}`;
    const payloadBytes = Buffer.from(payload, 'utf8');
    const sigBytes = hexToBytes(params.signatureHex);

    if (!verifyEd25519(params.founderPublicKeyBytes, payloadBytes, sigBytes)) {
      throw new ValidationError('Invalid signature on founder liveness heartbeat');
    }

    this.record = {
      ...rec,
      lastHeartbeatTimestamp: now,
      state: 'ACTIVE_FOUNDER',
    };

    return this.record!;
  }

  /**
   * Checks liveness and evaluates if inactivity timelock has elapsed.
   */
  public evaluateLiveness(currentTime = Math.floor(Date.now() / 1000)): SuccessionRecord {
    const rec = this.getRecord();
    if (rec.state === 'COMMUNITY_STEWARDSHIP') {
      return rec;
    }

    const elapsed = currentTime - rec.lastHeartbeatTimestamp;
    if (elapsed > rec.inactivityTimeoutSeconds) {
      // Inactivity timeout exceeded: Trigger autonomous succession
      this.record = {
        ...rec,
        state: 'COMMUNITY_STEWARDSHIP',
        successionTriggeredAt: currentTime,
        handoverStatement: `Autonomous succession triggered due to founder inactivity (${Math.round(elapsed / 86400)} days elapsed). Community Stewardship active.`,
      };
    } else if (elapsed > rec.inactivityTimeoutSeconds * 0.75) {
      // In grace period (>75% timeout)
      this.record = {
        ...rec,
        state: 'INACTIVITY_GRACE',
      };
    }

    return this.record!;
  }

  /**
   * Executes voluntary founder handover / retirement.
   */
  public executeVoluntaryHandover(params: {
    founderDid: string;
    founderPublicKeyBytes: Uint8Array;
    statement: string;
    signatureHex: string;
    timestamp?: number;
  }): SuccessionRecord {
    const rec = this.getRecord();
    if (params.founderDid !== rec.founderDid) {
      throw new ValidationError('Handover DID does not match registered founder DID');
    }

    const now = params.timestamp ?? Math.floor(Date.now() / 1000);
    const payload = `SOVRA_VOLUNTARY_HANDOVER:${params.founderDid}:${params.statement}:${now}`;
    const payloadBytes = Buffer.from(payload, 'utf8');
    const sigBytes = hexToBytes(params.signatureHex);

    if (!verifyEd25519(params.founderPublicKeyBytes, payloadBytes, sigBytes)) {
      throw new ValidationError('Invalid signature on voluntary founder handover');
    }

    this.record = {
      ...rec,
      state: 'COMMUNITY_STEWARDSHIP',
      successionTriggeredAt: now,
      handoverStatement: params.statement,
    };

    return this.record!;
  }

  public isCommunityStewardshipActive(): boolean {
    return this.record?.state === 'COMMUNITY_STEWARDSHIP';
  }
}
