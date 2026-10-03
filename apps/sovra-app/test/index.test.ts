import { describe, it, expect } from 'vitest';
import { SOVRA_APP_ROUTES, SovraClient } from '../src/index.js';

describe('@sovra/app', () => {
  it('exposes Creator Studio inside the same application without separate accounts', () => {
    const studioRoute = SOVRA_APP_ROUTES.find(r => r.path === '/studio');
    expect(studioRoute).toBeDefined();
    expect(studioRoute?.requiresCreatorMode).toBe(true);

    const client = new SovraClient();
    expect(client.getState().isCreatorModeActive).toBe(false);

    const toggleResult = client.toggleCreatorMode(true);
    expect(toggleResult.ok).toBe(true);
    expect(client.getState().isCreatorModeActive).toBe(true);
  });

  it('contains default device-side screen-time wellbeing configurations', () => {
    const client = new SovraClient();
    const limits = client.getState().screenTimeLimits;
    expect(limits.dailyAppLimitMinutes).toBe(60);
    expect(limits.feedLimitMinutes).toBe(30);
    expect(limits.quietHoursEnabled).toBe(true);
  });
});
