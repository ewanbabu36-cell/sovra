import { describe, it, expect } from 'vitest';
import { SovraClient } from '@sovra/app';

describe('Failure Resilience & Admin Panel Independence', () => {
  it('operates consumer client when administrative services are completely offline or unreachable', () => {
    // Instantiate consumer application without any Admin API endpoints configured
    const client = new SovraClient();
    expect(client).toBeDefined();

    // Verify creator mode toggles client-side without reaching an admin endpoint
    const res = client.toggleCreatorMode(true);
    expect(res.ok).toBe(true);
    expect(client.getState().isCreatorModeActive).toBe(true);

    // Verify device screen-time limits are evaluated locally
    const limits = client.getState().screenTimeLimits;
    expect(limits.dailyAppLimitMinutes).toBeGreaterThan(0);
  });
});
