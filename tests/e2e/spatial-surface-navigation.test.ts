import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('SOVRA Spatial Holographic Interaction System E2E Suite', () => {
  const ts = Date.now();
  let testUser: { did: string; handle: string; sessionToken: string };
  let htmlContent: string = '';

  beforeAll(async () => {
    // 1. Fetch dashboard HTML
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    htmlContent = await res.text();

    // 2. Register a test sovereign user
    const regRes = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@spatial_tester_${ts}`,
        name: 'Spatial Architect',
        bio: 'Validating futuristic OS holographic surfaces',
      }),
    });
    expect(regRes.status).toBe(200);
    const regData = await regRes.json();
    expect(regData.ok).toBe(true);
    testUser = {
      did: regData.user.did,
      handle: regData.user.handle,
      sessionToken: regData.sessionToken,
    };
  });

  describe('Phase 1: Architecture & Container Markup', () => {
    it('serves sovereign spatial surface container with accessibility attributes', () => {
      expect(htmlContent).toContain('id="sovraSpatialSurfaceContainer"');
      expect(htmlContent).toContain('class="sovra-surface-container"');
      expect(htmlContent).toContain('aria-live="polite"');
    });

    it('contains complete spatial CSS physics, backdrop, and depth recession rules', () => {
      expect(htmlContent).toContain('.sovra-surface-container {');
      expect(htmlContent).toContain('.sovra-surface-backdrop {');
      expect(htmlContent).toContain('.sovra-surface-card {');
      expect(htmlContent).toContain('.sovra-surface-card.is-active {');
      expect(htmlContent).toContain('.sovra-surface-card.is-receded {');
      expect(htmlContent).toContain('.sovra-surface-card.is-closing {');
      expect(htmlContent).toContain('.sovra-surface-header {');
      expect(htmlContent).toContain('.sovra-surface-back-btn {');
      expect(htmlContent).toContain('.sovra-surface-breadcrumbs {');
      expect(htmlContent).toContain('.sovra-surface-crumb {');
      expect(htmlContent).toContain('.spatial-option-card {');
      expect(htmlContent).toContain('.spatial-action-grid {');
      expect(htmlContent).toContain('.spatial-chat-reaction-dock {');
    });

    it('implements responsive mobile bottom sheet transformations and prefers-reduced-motion', () => {
      expect(htmlContent).toContain('@media (max-width: 640px) {');
      expect(htmlContent).toContain('border-radius: 24px 24px 0 0');
      expect(htmlContent).toContain('@media (prefers-reduced-motion: reduce) {');
      expect(htmlContent).toContain('transition: none !important');
    });
  });

  describe('Phase 2: SovraSurfaceManager Engine & Stack API', () => {
    it('initializes window.SovraSurfaceManager with full lifecycle methods', () => {
      expect(htmlContent).toContain('window.SovraSurfaceManager = (function() {');
      expect(htmlContent).toContain('pushSurface: pushSurface');
      expect(htmlContent).toContain('popSurface: popSurface');
      expect(htmlContent).toContain('popTo: popTo');
      expect(htmlContent).toContain('replaceSurface: replaceSurface');
      expect(htmlContent).toContain('closeAll: closeAll');
      expect(htmlContent).toContain('getCurrentSurface: getCurrentSurface');
      expect(htmlContent).toContain('getStack: getStack');
      expect(htmlContent).toContain('getDepth: getDepth');
    });

    it('implements Escape key dismissal and focus trapping', () => {
      expect(htmlContent).toContain("if (e.key === 'Escape' && _stack.length > 0)");
      expect(htmlContent).toContain('cardEl.setAttribute(\'role\', \'dialog\');');
      expect(htmlContent).toContain('cardEl.setAttribute(\'aria-modal\', \'true\');');
    });
  });

  describe('Phase 3: Core Target Flows Integration in Markup', () => {
    it('wires Profile Settings button and overflow menu to openSpatialSettingsSurface', () => {
      expect(htmlContent).toContain('id="profileSettingsBtn"');
      expect(htmlContent).toContain('onclick="openSpatialSettingsSurface(this)"');
      expect(htmlContent).toContain('id="profileSettingsMenuItem"');
      expect(htmlContent).toContain('onclick="openSpatialSettingsSurface(this); hideProfileOverflowMenu();"');
    });

    it('wires Chat message bubbles to openSpatialChatMessageActionSurface', () => {
      expect(htmlContent).toContain('onclick="openSpatialChatMessageActionSurface(&quot;\' + m.id + \'&quot;, this, event)"');
    });

    it('wires Bottom navigation Create button to openSpatialCreateSurface', () => {
      expect(htmlContent).toContain('function triggerBottomCreateAction(originEl) {');
      expect(htmlContent).toContain('window.openSpatialCreateSurface(originEl || document.querySelector(\'.bottom-nav-create\'));');
    });

    it('wires Header notification bell to openSpatialNotificationsSurface', () => {
      expect(htmlContent).toContain('function toggleNotificationCenter(originEl) {');
      expect(htmlContent).toContain('window.openSpatialNotificationsSurface(originEl || document.getElementById(\'headerNotificationBell\'));');
    });

    it('retains Holo Core Central Gateway and dispatches notifications and create to spatial surfaces', () => {
      expect(htmlContent).toContain('id="holographicNavOverlay"');
      expect(htmlContent).toContain('id="sovraCoreBtn"');
      expect(htmlContent).toContain('function executeHoloAction(actionKey) {');
      expect(htmlContent).toContain('case \'notifications\':');
      expect(htmlContent).toContain('case \'create\':');
    });

    it('provides entity management surfaces for Channels and Pages', () => {
      expect(htmlContent).toContain('window.openSpatialChannelManageSurface = function(');
      expect(htmlContent).toContain('window.openSpatialPageManageSurface = function(');
      expect(htmlContent).toContain('window.openSpatialGroupManageSurface = function(');
      expect(htmlContent).toContain('openSpatialChannelManageSurface(this.dataset.channelId, this)');
      expect(htmlContent).toContain('openSpatialPageManageSurface(this.dataset.pageId, this)');
    });
  });

  describe('Phase 4: Real State Mutation (Profile -> Settings -> Privacy -> Visibility Flow)', () => {
    it('reads initial user privacy settings from backend', async () => {
      const res = await fetch(`${BASE_URL}/api/user/privacy`, {
        headers: { Authorization: `Bearer ${testUser.sessionToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.privacySettings).toBeDefined();
    });

    it('mutates Profile Visibility to followers via real POST /api/user/privacy', async () => {
      const res = await fetch(`${BASE_URL}/api/user/privacy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testUser.sessionToken}`,
        },
        body: JSON.stringify({
          profileVisibility: 'followers',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.privacySettings.profileVisibility).toBe('followers');

      // Verify persistence via GET
      const verifyRes = await fetch(`${BASE_URL}/api/user/privacy`, {
        headers: { Authorization: `Bearer ${testUser.sessionToken}` },
      });
      const verifyData = await verifyRes.json();
      expect(verifyData.privacySettings.profileVisibility).toBe('followers');
    });

    it('mutates Profile Visibility to private and updates online presence', async () => {
      const res = await fetch(`${BASE_URL}/api/user/privacy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testUser.sessionToken}`,
        },
        body: JSON.stringify({
          profileVisibility: 'private',
          showOnlineStatus: false,
          canMessageMe: 'followers',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.privacySettings.profileVisibility).toBe('private');
      expect(data.privacySettings.showOnlineStatus).toBe(false);
      expect(data.privacySettings.canMessageMe).toBe('followers');

      // Verify persistence via GET
      const verifyRes = await fetch(`${BASE_URL}/api/user/privacy`, {
        headers: { Authorization: `Bearer ${testUser.sessionToken}` },
      });
      const verifyData = await verifyRes.json();
      expect(verifyData.privacySettings.profileVisibility).toBe('private');
      expect(verifyData.privacySettings.showOnlineStatus).toBe(false);
      expect(verifyData.privacySettings.canMessageMe).toBe('followers');
    });
  });
});
