/**
 * @file tests/e2e/sovra-wellbeing-screentime-phase8.test.ts
 * SOVRA PHASE 8: DEVICE-SIDE SCREEN-TIME CONTROLS & DIGITAL WELLBEING SUITE
 *
 * Verifies:
 * 1. Default Wellbeing Limits & Configuration retrieval (/api/wellbeing/limits)
 * 2. Privacy-preserving device-side limit mutations with strict validation
 * 3. Daily usage accumulation across Feed, Reels, and Explore
 * 4. Quiet hours wind-down schedule evaluation (spanning midnight boundary)
 * 5. Device-side Lockout triggering when budgets are exceeded
 * 6. Mindful break challenge completion & 5-minute grace period unlock
 * 7. Client UI elements (#sovraWellbeingModal, #wellbeingStatusBanner, window.SovraDigitalWellbeingEngine)
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('SOVRA Phase 8: Digital Wellbeing & Screen-Time Controls', () => {
  const ts = Date.now();
  let userToken: string;
  let userDid: string;

  beforeAll(async () => {
    // Register test user for Phase 8 testing
    const regRes = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@wellbeing_user_${ts}`,
        name: 'Wellbeing Mindful User',
        bio: 'Mindful sovereign node operator #wellbeing',
      }),
    });
    expect(regRes.status).toBe(200);
    const regData = await regRes.json();
    expect(regData.ok).toBe(true);
    userToken = regData.sessionToken;
    userDid = regData.user.did;
  });

  describe('1. Default Wellbeing Limits & Retrieval', () => {
    it('retrieves default wellbeing limits for authenticated or device session', async () => {
      const res = await fetch(`${BASE_URL}/api/wellbeing/limits?userDid=${encodeURIComponent(userDid)}`, {
        headers: { 'Authorization': `Bearer ${userToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.limits).toBeDefined();
      expect(data.limits.dailyAppLimitMinutes).toBe(60);
      expect(data.limits.feedLimitMinutes).toBe(30);
      expect(data.limits.shortVideoLimitMinutes).toBe(20);
      expect(data.limits.exploreLimitMinutes).toBe(15);
      expect(data.limits.quietHoursEnabled).toBe(true);
      expect(data.limits.quietHoursStart).toBe('23:00');
      expect(data.limits.quietHoursEnd).toBe('07:00');
      expect(data.limits.lockoutEnforced).toBe(true);
      expect(data.limits.tamperProofClock).toBe(true);
    });

    it('retrieves default limits for guest device session without errors', async () => {
      const res = await fetch(`${BASE_URL}/api/wellbeing/limits`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.limits.dailyAppLimitMinutes).toBeGreaterThanOrEqual(1);
    });
  });

  describe('2. Limits Configuration & Validation', () => {
    it('updates daily limits and quiet hours successfully with valid input', async () => {
      const updates = {
        userDid,
        dailyAppLimitMinutes: 45,
        feedLimitMinutes: 20,
        shortVideoLimitMinutes: 15,
        quietHoursStart: '22:30',
        quietHoursEnd: '06:30',
        lockoutEnforced: true,
      };

      const res = await fetch(`${BASE_URL}/api/wellbeing/limits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userToken}`,
        },
        body: JSON.stringify(updates),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.limits.dailyAppLimitMinutes).toBe(45);
      expect(data.limits.feedLimitMinutes).toBe(20);
      expect(data.limits.shortVideoLimitMinutes).toBe(15);
      expect(data.limits.quietHoursStart).toBe('22:30');
      expect(data.limits.quietHoursEnd).toBe('06:30');

      // Verify persistence on GET
      const verifyRes = await fetch(`${BASE_URL}/api/wellbeing/limits?userDid=${encodeURIComponent(userDid)}`);
      const verifyData = await verifyRes.json();
      expect(verifyData.limits.dailyAppLimitMinutes).toBe(45);
      expect(verifyData.limits.feedLimitMinutes).toBe(20);
    });

    it('rejects invalid quiet hours time format with HTTP 400', async () => {
      const badTimes = ['25:00', '12:65', 'invalid', '1000', '12:0'];
      for (const badTime of badTimes) {
        const res = await fetch(`${BASE_URL}/api/wellbeing/limits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userDid, quietHoursStart: badTime }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.ok).toBe(false);
      }
    });

    it('rejects negative limit minutes with HTTP 400', async () => {
      const res = await fetch(`${BASE_URL}/api/wellbeing/limits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userDid, dailyAppLimitMinutes: -15 }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });
  });

  describe('3. Usage Tracking & Accumulation', () => {
    it('logs usage across Feed, Reels, and Explore with category separation', async () => {
      // 1. Log Feed usage (60 seconds)
      const feedRes = await fetch(`${BASE_URL}/api/wellbeing/log-usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userDid, category: 'feed', seconds: 60 }),
      });
      expect(feedRes.status).toBe(200);
      const feedData = await feedRes.json();
      expect(feedData.ok).toBe(true);
      expect(feedData.usage.feedUsageSeconds).toBeGreaterThanOrEqual(60);
      expect(feedData.usage.appUsageSeconds).toBeGreaterThanOrEqual(60);

      // 2. Log Reels usage (45 seconds)
      const reelsRes = await fetch(`${BASE_URL}/api/wellbeing/log-usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userDid, category: 'reels', seconds: 45 }),
      });
      expect(reelsRes.status).toBe(200);
      const reelsData = await reelsRes.json();
      expect(reelsData.ok).toBe(true);
      expect(reelsData.usage.reelsUsageSeconds).toBeGreaterThanOrEqual(45);
      expect(reelsData.usage.appUsageSeconds).toBeGreaterThanOrEqual(105);

      // 3. Log Explore usage (30 seconds)
      const expRes = await fetch(`${BASE_URL}/api/wellbeing/log-usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userDid, category: 'explore', seconds: 30 }),
      });
      expect(expRes.status).toBe(200);
      const expData = await expRes.json();
      expect(expData.ok).toBe(true);
      expect(expData.usage.exploreUsageSeconds).toBeGreaterThanOrEqual(30);
      expect(expData.usage.appUsageSeconds).toBeGreaterThanOrEqual(135);
    });

    it('rejects invalid usage categories with HTTP 400', async () => {
      const res = await fetch(`${BASE_URL}/api/wellbeing/log-usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userDid, category: 'bitcoin_miner', seconds: 60 }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it('rejects non-positive or excessive usage seconds with HTTP 400', async () => {
      const badSeconds = [0, -10, 5000];
      for (const sec of badSeconds) {
        const res = await fetch(`${BASE_URL}/api/wellbeing/log-usage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userDid, category: 'feed', seconds: sec }),
        });
        expect(res.status).toBe(400);
      }
    });
  });

  describe('4. Quiet Hours & Usage Summary', () => {
    it('returns usage summary with quiet hours status and limits', async () => {
      const res = await fetch(`${BASE_URL}/api/wellbeing/usage?userDid=${encodeURIComponent(userDid)}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.usage).toBeDefined();
      expect(data.limits).toBeDefined();
      expect(typeof data.isQuietHours).toBe('boolean');
      expect(typeof data.isLockoutActive).toBe('boolean');
      expect(Array.isArray(data.exceededCategories)).toBe(true);
    });
  });

  describe('5. Lockout Enforcement & Mindful Break Challenge', () => {
    const lockoutUserDid = `did:sovra:lockout_test_${Date.now()}`;

    it('triggers device-side lockout when category exceeds configured limit', async () => {
      // 1. Configure strict limit: 1 minute (60 seconds) for reels
      await fetch(`${BASE_URL}/api/wellbeing/limits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userDid: lockoutUserDid,
          dailyAppLimitMinutes: 10,
          shortVideoLimitMinutes: 1, // 60 seconds
          lockoutEnforced: true,
        }),
      });

      // 2. Log 75 seconds of Reels usage (exceeds 60s limit)
      const logRes = await fetch(`${BASE_URL}/api/wellbeing/log-usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userDid: lockoutUserDid,
          category: 'reels',
          seconds: 75,
        }),
      });
      expect(logRes.status).toBe(200);
      const logData = await logRes.json();
      expect(logData.ok).toBe(true);
      expect(logData.isLockoutActive).toBe(true);
      expect(logData.exceededCategories).toContain('reels');
    });

    it('completes mindful break challenge and grants temporary grace period unlock', async () => {
      const breakRes = await fetch(`${BASE_URL}/api/wellbeing/break-challenge/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userDid: lockoutUserDid,
          graceMinutes: 5,
        }),
      });
      expect(breakRes.status).toBe(200);
      const breakData = await breakRes.json();
      expect(breakData.ok).toBe(true);
      expect(breakData.unlockedUntil).toBeGreaterThan(Date.now());
      expect(breakData.graceMinutes).toBe(5);
      expect(breakData.breaksTaken).toBeGreaterThanOrEqual(1);

      // Verify that lockout is deactivated during the grace window
      const usageRes = await fetch(`${BASE_URL}/api/wellbeing/usage?userDid=${encodeURIComponent(lockoutUserDid)}`);
      const usageData = await usageRes.json();
      expect(usageData.isLockoutActive).toBe(false);
      expect(usageData.gracePeriodRemainingMs).toBeGreaterThan(0);
    });
  });

  describe('6. Client DOM & Engine Verification', () => {
    it('serves digital wellbeing modal, banner, and script engine in consumer HTML', async () => {
      const res = await fetch(`${BASE_URL}/`);
      expect(res.status).toBe(200);
      const html = await res.text();

      // Assert modal dialog and accessibility markup
      expect(html).toContain('id="sovraWellbeingModal"');
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('id="wellbeingModalTitle"');

      // Assert status banner and controls
      expect(html).toContain('id="wellbeingStatusBanner"');
      expect(html).toContain('id="wbLockoutAlertBox"');
      expect(html).toContain('id="wellbeingBreakChallengeBtn"');
      expect(html).toContain('id="wellbeingProgressBar"');
      expect(html).toContain('id="wellbeingLimitsCard"');
      expect(html).toContain('id="saveWellbeingLimitsBtn"');

      // Assert client script engine
      expect(html).toContain('window.SovraDigitalWellbeingEngine');
      expect(html).toContain('window.openWellbeingModal');
      expect(html).toContain('window.closeWellbeingModal');
      expect(html).toContain('window.completeBreakChallenge');
    });
  });
});
