/**
 * @file packages/identity/src/guardian-liveness.ts
 * Pillar 6: Inactivity-Scaled Dynamic Timelock & Guardian Liveness Heartbeats.
 *
 * Real-world problem:
 * 1. Dormant guardian extinction: Friends lose devices over years, rendering accounts unrecoverable.
 * 2. Attackers bribe guardians of dormant/unconscious creators and execute 48h takeovers while creator is offline.
 *
 * Solution:
 * 1. 60-day zero-knowledge guardian heartbeat ping. Dormant guardians (>90 days inactive) lose voting weight.
 * 2. Inactivity-scaled recovery timelock:
 *    Delta_T = T_base + min(T_max_extension, (T_now - T_last_active) * 0.25)
 *    Active creators retain fast 48h recovery; dormant accounts receive up to 16 days of safety buffer.
 */

export interface GuardianHeartbeatRecord {
  readonly guardianDid: string;
  readonly lastHeartbeatTimestamp: number;
  readonly isResponsive: boolean;
  readonly devicePlatform?: string | undefined;
}

export interface QuorumLivenessReport {
  readonly totalGuardians: number;
  readonly activeGuardians: number;
  readonly dormantGuardians: number;
  readonly requiredThreshold: number;
  readonly canSatisfyThreshold: boolean;
  readonly recommendations: readonly string[];
}

export class GuardianHealthPingManager {
  private readonly guardians = new Map<string, GuardianHeartbeatRecord>();
  public static readonly HEARTBEAT_INTERVAL_MS = 60 * 24 * 3600 * 1000; // 60 days
  public static readonly DORMANT_THRESHOLD_MS = 90 * 24 * 3600 * 1000; // 90 days

  public static readonly BASE_TIMELOCK_SEC = 48 * 3600; // 48 hours
  public static readonly MAX_EXTENSION_SEC = 14 * 24 * 3600; // 14 days
  public static readonly INACTIVITY_SCALING_FACTOR = 0.25;

  public static readonly ACTIVE_GRACE_PERIOD_SEC = 24 * 3600; // 24 hours daily active threshold

  /**
   * Calculates adaptive recovery timelock in seconds:
   * Timelock = Base (48h) + min(14d, InactivityDuration * 0.25)
   * Users active within the last 24 hours receive 0 extension (standard 48h).
   */
  public static calculateAdaptiveRecoveryTimelock(
    lastActiveTimestampMs: number,
    currentTimestampMs = Date.now(),
  ): { timelockSeconds: number; extensionSeconds: number; explanation: string } {
    const elapsedMs = Math.max(0, currentTimestampMs - lastActiveTimestampMs);
    const elapsedSec = elapsedMs / 1000;

    const rawExtension =
      elapsedSec <= this.ACTIVE_GRACE_PERIOD_SEC
        ? 0
        : elapsedSec * this.INACTIVITY_SCALING_FACTOR;
    const clampedExtension = Math.min(this.MAX_EXTENSION_SEC, Math.round(rawExtension));
    const totalTimelockSec = this.BASE_TIMELOCK_SEC + clampedExtension;

    const explanation =
      clampedExtension > 0
        ? `Account inactive for ${Math.round(elapsedSec / 86400)} days. Timelock extended by ${Math.round(clampedExtension / 3600)}h to prevent dormant account hijacking.`
        : 'Active user: Standard 48h emergency recovery appeal window applied.';

    return {
      timelockSeconds: totalTimelockSec,
      extensionSeconds: clampedExtension,
      explanation,
    };
  }

  public recordHeartbeat(guardianDid: string, timestamp = Date.now()): void {
    this.guardians.set(guardianDid, {
      guardianDid,
      lastHeartbeatTimestamp: timestamp,
      isResponsive: true,
    });
  }

  public evaluateLiveness(
    guardianDids: readonly string[],
    threshold: number,
    currentTimestampMs = Date.now(),
  ): QuorumLivenessReport {
    let active = 0;
    let dormant = 0;
    const recommendations: string[] = [];

    for (const did of guardianDids) {
      const record = this.guardians.get(did);
      const lastSeen = record ? record.lastHeartbeatTimestamp : 0;
      const age = currentTimestampMs - lastSeen;

      if (record && age <= GuardianHealthPingManager.DORMANT_THRESHOLD_MS) {
        active++;
      } else {
        dormant++;
        recommendations.push(
          `Guardian ${did.slice(0, 16)}... is unresponsive (${Math.round(age / (86400 * 1000))}d inactive). Prompt user to re-shard.`,
        );
      }
    }

    const canSatisfy = active >= threshold;
    if (!canSatisfy) {
      recommendations.unshift('CRITICAL: Active guardians below recovery threshold! Immediate re-sharding required.');
    }

    return {
      totalGuardians: guardianDids.length,
      activeGuardians: active,
      dormantGuardians: dormant,
      requiredThreshold: threshold,
      canSatisfyThreshold: canSatisfy,
      recommendations,
    };
  }
}
