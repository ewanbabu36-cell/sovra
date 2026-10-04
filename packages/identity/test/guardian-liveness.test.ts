import { describe, it, expect } from 'vitest';
import { GuardianHealthPingManager } from '../src/index.js';

describe('Pillar 6: Inactivity-Scaled Dynamic Timelock & Guardian Liveness', () => {
  it('applies standard 48h timelock for active daily users', () => {
    const now = Date.now();
    const lastActive = now - 3600 * 1000; // 1 hour ago
    const result = GuardianHealthPingManager.calculateAdaptiveRecoveryTimelock(lastActive, now);

    expect(result.timelockSeconds).toBe(48 * 3600);
    expect(result.extensionSeconds).toBe(0);
    expect(result.explanation).toContain('Active user');
  });

  it('extends timelock proportionally for inactive accounts to prevent dormant hijacking', () => {
    const now = Date.now();
    // Inactive for 20 days: 20 * 86400 * 0.25 = 5 days extension
    const twentyDaysMs = 20 * 24 * 3600 * 1000;
    const result = GuardianHealthPingManager.calculateAdaptiveRecoveryTimelock(now - twentyDaysMs, now);

    const expectedExtension = 5 * 24 * 3600;
    expect(result.extensionSeconds).toBe(expectedExtension);
    expect(result.timelockSeconds).toBe(48 * 3600 + expectedExtension);
    expect(result.explanation).toContain('Timelock extended');
  });

  it('caps maximum extension to 14 days for long-dormant accounts', () => {
    const now = Date.now();
    // Inactive for 180 days: 180 * 0.25 = 45 days -> capped at 14 days
    const halfYearMs = 180 * 24 * 3600 * 1000;
    const result = GuardianHealthPingManager.calculateAdaptiveRecoveryTimelock(now - halfYearMs, now);

    const maxExtension = 14 * 24 * 3600;
    expect(result.extensionSeconds).toBe(maxExtension);
    expect(result.timelockSeconds).toBe(48 * 3600 + maxExtension); // 16 days total
  });

  it('tracks guardian heartbeats and alerts when quorum drops below threshold', () => {
    const manager = new GuardianHealthPingManager();
    const now = Date.now();

    // Guardian 1: responsive (pinged 5 days ago)
    manager.recordHeartbeat('did:sovra:guardian_1', now - 5 * 24 * 3600 * 1000);
    // Guardian 2: responsive (pinged 10 days ago)
    manager.recordHeartbeat('did:sovra:guardian_2', now - 10 * 24 * 3600 * 1000);
    // Guardian 3: dormant (pinged 120 days ago, >90d threshold)
    manager.recordHeartbeat('did:sovra:guardian_3', now - 120 * 24 * 3600 * 1000);

    const report = manager.evaluateLiveness(
      ['did:sovra:guardian_1', 'did:sovra:guardian_2', 'did:sovra:guardian_3'],
      2, // 2-of-3 threshold
      now,
    );

    expect(report.activeGuardians).toBe(2);
    expect(report.dormantGuardians).toBe(1);
    expect(report.canSatisfyThreshold).toBe(true);

    // If threshold required 3 active guardians:
    const criticalReport = manager.evaluateLiveness(
      ['did:sovra:guardian_1', 'did:sovra:guardian_2', 'did:sovra:guardian_3'],
      3,
      now,
    );
    expect(criticalReport.canSatisfyThreshold).toBe(false);
    expect(criticalReport.recommendations[0]).toContain('CRITICAL');
  });
});
