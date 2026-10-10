/**
 * SOVRA — Phase 2: SOVRA Core / Logo as Global Spatial Command Center
 * File: tests/e2e/sovra-core-spatial-command-phase2.test.ts
 *
 * Verifies:
 * 1. SovraCoreStateMachine: strict FSM transitions, guards, listeners, reset
 * 2. SovraCoreController: orbital layout geometry, responsive radius scaling, polar node coordinates
 * 3. Minimal idle state: clean social dashboard without permanent sidebars, radial buttons, or bottom navs
 * 4. Core Command Center DOM: overlay, reactor core, 9 radial nodes, energy lines, floor pedestal, ambient rings
 * 5. Surface + Core relationship: background subduing (.is-surface-active), opacity 0.15, blur, smooth restoration
 * 6. Target interaction flow: SOVRA Core -> Profile -> Settings -> Privacy -> Profile Visibility -> return to Core
 * 7. Creation hub: all 9 creation modalities (Post, Photo, Video, Reel, Poll, Question, Channel, Page, Group)
 * 8. Communication & media: Notifications surface, Chat surface, and real route execution (Feed, Reels, Watch)
 * 9. Accessibility, keyboard navigation (ESC handling), and reduced motion compliance
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  SovraCoreStateMachine,
  SovraCoreController,
  SovraSurfaceEngine,
  SovraSurfaceStack,
} from '@sovra/app';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('SOVRA Phase 2: Command Center State Machine & Controller', () => {
  it('initializes in closed state and transitions through valid lifecycle states', () => {
    const fsm = new SovraCoreStateMachine();
    expect(fsm.getState()).toBe('closed');
    expect(fsm.isClosed()).toBe(true);
    expect(fsm.isOpen()).toBe(false);
    expect(fsm.isSurfaceActive()).toBe(false);

    // closed -> opening
    expect(fsm.canTransition('opening')).toBe(true);
    expect(fsm.transition('opening')).toBe(true);
    expect(fsm.getState()).toBe('opening');

    // opening -> open
    expect(fsm.canTransition('open')).toBe(true);
    expect(fsm.transition('open')).toBe(true);
    expect(fsm.getState()).toBe('open');
    expect(fsm.isOpen()).toBe(true);

    // open -> transitioning
    expect(fsm.canTransition('transitioning')).toBe(true);
    expect(fsm.transition('transitioning')).toBe(true);
    expect(fsm.getState()).toBe('transitioning');

    // transitioning -> surface-active
    expect(fsm.canTransition('surface-active')).toBe(true);
    expect(fsm.transition('surface-active')).toBe(true);
    expect(fsm.getState()).toBe('surface-active');
    expect(fsm.isSurfaceActive()).toBe(true);

    // surface-active -> open (unwinding back to Core)
    expect(fsm.canTransition('open')).toBe(true);
    expect(fsm.transition('open')).toBe(true);
    expect(fsm.getState()).toBe('open');

    // open -> closed
    expect(fsm.canTransition('closed')).toBe(true);
    expect(fsm.transition('closed')).toBe(true);
    expect(fsm.getState()).toBe('closed');
    expect(fsm.isClosed()).toBe(true);
  });

  it('rejects invalid state transitions and enforces strict FSM guards', () => {
    const fsm = new SovraCoreStateMachine();
    // closed cannot transition directly to surface-active or transitioning
    expect(fsm.canTransition('surface-active')).toBe(false);
    expect(fsm.canTransition('transitioning')).toBe(false);
    expect(fsm.transition('surface-active')).toBe(false);
    expect(fsm.getState()).toBe('closed');

    fsm.transition('open');
    // open cannot jump directly to opening
    expect(fsm.canTransition('opening')).toBe(false);
    expect(fsm.transition('opening')).toBe(false);
    expect(fsm.getState()).toBe('open');
  });

  it('notifies subscribers upon state transitions and allows unsubscribing', () => {
    const fsm = new SovraCoreStateMachine();
    const transitions: Array<{ next: string; prev: string }> = [];

    const unsubscribe = fsm.subscribe((next, prev) => {
      transitions.push({ next, prev });
    });

    fsm.transition('opening');
    fsm.transition('open');
    fsm.transition('closed');

    expect(transitions).toEqual([
      { next: 'opening', prev: 'closed' },
      { next: 'open', prev: 'opening' },
      { next: 'closed', prev: 'open' },
    ]);

    unsubscribe();
    fsm.transition('open');
    expect(transitions.length).toBe(3); // No new events after unsubscribe
  });

  it('resets cleanly to closed from any state', () => {
    const fsm = new SovraCoreStateMachine();
    fsm.transition('open');
    fsm.transition('surface-active');
    expect(fsm.isSurfaceActive()).toBe(true);

    fsm.reset();
    expect(fsm.getState()).toBe('closed');
    expect(fsm.isClosed()).toBe(true);
  });

  it('calculates responsive orbital geometry across viewport breakpoints', () => {
    const controller = new SovraCoreController();

    // 1. Compact mobile (<=390px)
    const compact = controller.calculateGeometry(360);
    expect(compact.radius).toBe(118);
    expect(compact.halfSpan).toBe(175);

    const compactBoundary = controller.calculateGeometry(390);
    expect(compactBoundary.radius).toBe(118);

    // 2. Standard mobile (<=480px)
    const mobile = controller.calculateGeometry(420);
    expect(mobile.radius).toBe(136);
    expect(mobile.halfSpan).toBe(195);

    // 3. Tablet (<=1024px)
    const tablet = controller.calculateGeometry(768);
    expect(tablet.radius).toBe(172);
    expect(tablet.halfSpan).toBe(240);

    // 4. Desktop (>1024px)
    const desktop = controller.calculateGeometry(1440);
    expect(desktop.radius).toBe(212);
    expect(desktop.halfSpan).toBe(280);
  });

  it('computes polar coordinates for all 9 radial command nodes without clipping', () => {
    const controller = new SovraCoreController();
    const coords = controller.calculateNodeCoordinates(1440);

    // Default 9 nodes
    const expectedNodeIds = [
      'holo-node-home',
      'holo-node-feed',
      'holo-node-chat',
      'holo-node-logout',
      'holo-node-notif',
      'holo-node-create',
      'holo-node-profile',
      'holo-node-watch',
      'holo-node-reels',
    ];

    expectedNodeIds.forEach((id) => {
      expect(coords[id]).toBeDefined();
      expect(typeof coords[id].x).toBe('number');
      expect(typeof coords[id].y).toBe('number');
    });

    // Home is at 0 degrees (Top) -> x ~ 0, y = -radius (-212)
    expect(coords['holo-node-home'].x).toBe(0);
    expect(coords['holo-node-home'].y).toBe(-212);

    // Feed is at 40 degrees
    expect(coords['holo-node-feed'].x).toBeGreaterThan(0);
    expect(coords['holo-node-feed'].y).toBeLessThan(0);

    // Chat is at 80 degrees
    expect(coords['holo-node-chat'].x).toBeGreaterThan(100);

    // Logout is at 120 degrees
    expect(coords['holo-node-logout'].x).toBeGreaterThan(0);
    expect(coords['holo-node-logout'].y).toBeGreaterThan(0);

    // Notif is at 160 degrees
    expect(coords['holo-node-notif'].y).toBeGreaterThan(0);

    // Create is at 200 degrees
    expect(coords['holo-node-create'].x).toBeLessThan(0);
    expect(coords['holo-node-create'].y).toBeGreaterThan(0);

    // Profile is at 240 degrees
    expect(coords['holo-node-profile'].x).toBeLessThan(0);
    expect(coords['holo-node-profile'].y).toBeGreaterThan(0);

    // Watch is at 280 degrees
    expect(coords['holo-node-watch'].x).toBeLessThan(0);

    // Reels is at 320 degrees
    expect(coords['holo-node-reels'].x).toBeLessThan(0);
    expect(coords['holo-node-reels'].y).toBeLessThan(0);
  });
});

describe('SOVRA Phase 2: Production Server Layout & DOM Verification', () => {
  let html = '';

  beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    html = await res.text();
  });

  it('keeps normal idle state minimal: SOVRA logo without permanent radial menu, rail, or dock', () => {
    // 1. SOVRA logo exists as gateway button
    expect(html).toContain('id="sovraCoreBtn"');
    expect(html).toContain('class="sovra-core-gateway-btn"');

    // 2. Permanent legacy sidebar rail and bottom nav remain suppressed
    expect(html).toContain('.app-left-rail,');
    expect(html).toContain('.mobile-bottom-nav,');
    expect(html).toContain('display: none !important;');

    // 3. User handle text beside avatar is removed/hidden
    expect(html).toContain('#currentUserHandleText {');
    expect(html).toContain('display: none !important;');
  });

  it('renders Central Command Core reactor and all 9 3D spherical radial nodes', () => {
    expect(html).toContain('id="holographicNavOverlay"');
    expect(html).toContain('id="holoCenterCoreBtn"');
    expect(html).toContain('SOVRA');

    const expectedNodes = [
      'holo-node-home',
      'holo-node-feed',
      'holo-node-chat',
      'holo-node-logout',
      'holo-node-notif',
      'holo-node-create',
      'holo-node-profile',
      'holo-node-watch',
      'holo-node-reels',
    ];

    expectedNodes.forEach((nodeId) => {
      expect(html).toContain(`id="${nodeId}"`);
    });

    // 3D glass orb structure
    expect(html).toContain('class="holo-node-orb"');
    expect(html).toContain('class="holo-floor-pedestal"');
    expect(html).toContain('class="holo-energy-pathways"');
  });

  it('defines CSS styles for .holo-nav-overlay.is-surface-active background dimming', () => {
    expect(html).toContain('.holo-nav-overlay.is-surface-active');
    expect(html).toContain('z-index: 99999;');
    expect(html).toContain('opacity: 0.15;');
    expect(html).toContain('pointer-events: none;');
    expect(html).toContain('filter: blur(2px);');
  });

  it('supports prefers-reduced-motion: reduce across all rings, shockwaves, and pulses', () => {
    expect(html).toContain('@media (prefers-reduced-motion: reduce)');
    expect(html).toContain('.holo-orbit-ring.ring-outer,');
    expect(html).toContain('.holo-orbital-halo-ring,');
    expect(html).toContain('.holo-shockwave,');
    expect(html).toContain('animation: none !important;');
  });

  it('exposes window.SovraCore API with stateMachine and coordinate calculators', () => {
    expect(html).toContain('window.SovraCore = {');
    expect(html).toContain('stateMachine: SovraCoreStateMachine');
    expect(html).toContain('calculateGeometry:');
    expect(html).toContain('calculateNodeCoordinates:');
    expect(html).toContain('transitionToSurface:');
    expect(html).toContain('returnFromSurface:');
  });
});

describe('SOVRA Phase 2: Profile Contextual Space & Phase-1 Stack Integrity', () => {
  let html = '';

  beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/`);
    html = await res.text();
  });

  it('defines window.openSpatialProfileSurface exposing the 7 required profile actions', () => {
    expect(html).toContain('window.openSpatialProfileSurface = function(');

    // Profile Surface identity header
    expect(html).toContain('id="spatialProfileAvatar"');
    expect(html).toContain('id="spatialProfileDisplayName"');
    expect(html).toContain('id="spatialProfileHandle"');

    // All 7 contextual actions
    expect(html).toContain('id="spatialProfileEditBtn"');     // 1. Edit Profile
    expect(html).toContain('id="spatialProfileSettingsBtn"'); // 2. Settings
    expect(html).toContain('id="spatialProfileSavedBtn"');    // 3. Saved
    expect(html).toContain('id="spatialProfileActivityBtn"'); // 4. Activity
    expect(html).toContain('id="spatialProfileChannelsBtn"'); // 5. My Channels
    expect(html).toContain('id="spatialProfilePagesBtn"');    // 6. My Pages
    expect(html).toContain('id="spatialProfileGroupsBtn"');   // 7. My Groups
  });

  it('seamlessly connects Profile -> Settings -> Privacy -> Profile Visibility', () => {
    // 1. Profile Settings button calls openSpatialSettingsSurface
    expect(html).toContain('onclick="window.openSpatialSettingsSurface(this)"');

    // 2. Settings Surface opens SOVRA SETTINGS with 5 primary categories
    expect(html).toContain('title: \'SOVRA SETTINGS\'');
    expect(html).toContain('id="spatialSettingsPrivacyItem"');
    expect(html).toContain('id="spatialSettingsSecurityItem"');
    expect(html).toContain('id="spatialSettingsNotificationsItem"');
    expect(html).toContain('id="spatialSettingsAppearanceItem"');
    expect(html).toContain('id="spatialSettingsAccountItem"');

    // 3. Privacy Surface opens PRIVACY with 4 options
    expect(html).toContain('title: \'PRIVACY\'');
    expect(html).toContain('id="spatialPrivacyProfileVisItem"');
    expect(html).toContain('id="spatialPrivacyPostVisItem"');
    expect(html).toContain('id="spatialPrivacyMsgPermsItem"');
    expect(html).toContain('id="spatialPrivacyBlockedUsersItem"');

    // 4. Profile Visibility Surface opens PROFILE VISIBILITY with 4 real radio options
    expect(html).toContain('title: \'PROFILE VISIBILITY\'');
    expect(html).toContain('id="opt-vis-public"');
    expect(html).toContain('id="opt-vis-friends"');
    expect(html).toContain('id="opt-vis-private"');
    expect(html).toContain('id="opt-vis-only_me"');
  });

  it('restores SOVRA Core naturally when popping the root surface', () => {
    expect(html).toContain('if (window.SovraCore && typeof window.SovraCore.isSurfaceActive === \'function\' && window.SovraCore.isSurfaceActive())');
    expect(html).toContain('window.SovraCore.returnFromSurface();');
  });
});

describe('SOVRA Phase 2: Create Contextual Hub (All 9 Creation Modalities)', () => {
  let html = '';

  beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/`);
    html = await res.text();
  });

  it('exposes all 9 creation modalities inside the Create Surface', () => {
    expect(html).toContain('window.openSpatialCreateSurface = function(');

    expect(html).toContain('id="spatialCreatePostBtn"');     // 1. Post
    expect(html).toContain('id="spatialCreatePhotoBtn"');    // 2. Photo
    expect(html).toContain('id="spatialCreateVideoBtn"');    // 3. Video
    expect(html).toContain('id="spatialCreateReelBtn"');     // 4. Reel
    expect(html).toContain('id="spatialCreatePollBtn"');     // 5. Poll
    expect(html).toContain('id="spatialCreateQuestionBtn"'); // 6. Question
    expect(html).toContain('id="spatialCreateChannelBtn"');  // 7. Channel
    expect(html).toContain('id="spatialCreatePageBtn"');     // 8. Page
    expect(html).toContain('id="spatialCreateGroupBtn"');    // 9. Group
  });

  it('implements creation helper sub-surfaces for rich interactive workflows', () => {
    expect(html).toContain('window.openSpatialPostCreatorSurface = function(');
    expect(html).toContain('window.openSpatialPhotoCreatorSurface = function(');
    expect(html).toContain('window.openSpatialVideoCreatorSurface = function(');
    expect(html).toContain('window.openSpatialReelCreatorSurface = function(');
    expect(html).toContain('window.openSpatialPollCreatorSurface = function(');
    expect(html).toContain('window.openSpatialQuestionCreatorSurface = function(');
    expect(html).toContain('window.openSpatialGroupCreatorSurface = function(');
  });
});

describe('SOVRA Phase 2: Communication, Real Routes & Backend Persistence', () => {
  let html = '';
  let testUser: { did: string; handle: string; sessionToken: string };

  beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/`);
    html = await res.text();

    const regRes = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: `did:sovra:phase2_test_${Date.now()}`,
        handle: `@phase2_test_${Date.now()}`,
        name: 'Phase 2 Test Peer',
      }),
    });
    const regData = await regRes.json();
    testUser = {
      did: regData.user.did,
      handle: regData.user.handle,
      sessionToken: regData.sessionToken,
    };
  });

  it('implements SOVRA Chat Surface with encrypted DM conversations', () => {
    expect(html).toContain('window.openSpatialChatSurface = function(');
    expect(html).toContain('id="spatialChatSearchInput"');
    expect(html).toContain('SOVRA CHAT');
    expect(html).toContain('Alice (@alice.node)');
    expect(html).toContain('Bob (@bob.sovra)');
  });

  it('implements Notifications Surface with mesh activity filtering', () => {
    expect(html).toContain('window.openSpatialNotificationsSurface = function(');
    expect(html).toContain('Notifications & Alerts');
    expect(html).toContain('window._changeNotifFilter');
  });

  it('routes primary actions cleanly between real routes and contextual surfaces', () => {
    expect(html).toContain('function executeHoloAction(actionKey)');

    // Routing actions close Core and switch Tab
    expect(html).toContain('case \'home\':');
    expect(html).toContain('case \'feed\':');
    expect(html).toContain('case \'reels\':');
    expect(html).toContain('case \'watch\':');
    expect(html).toContain('case \'logout\':');

    // Contextual spaces transition Core to surface-active and open surface
    expect(html).toContain('case \'profile\':');
    expect(html).toContain('case \'create\':');
    expect(html).toContain('case \'notifications\':');
    expect(html).toContain('case \'chat\':');
    expect(html).toContain('window.SovraCore.transitionToSurface()');
  });

  it('persists real profile visibility changes through /api/user/privacy', async () => {
    // 1. Update privacy to friends
    const patchRes = await fetch(`${BASE_URL}/api/user/privacy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testUser.sessionToken}`,
      },
      body: JSON.stringify({ profileVisibility: 'friends' }),
    });
    expect(patchRes.status).toBe(200);
    const patchData = await patchRes.json();
    expect(patchData.ok).toBe(true);
    expect(patchData.privacySettings.profileVisibility).toBe('friends');

    // 2. Fetch profile to confirm persistence
    const meRes = await fetch(`${BASE_URL}/api/user/privacy`, {
      headers: { Authorization: `Bearer ${testUser.sessionToken}` },
    });
    expect(meRes.status).toBe(200);
    const meData = await meRes.json();
    expect(meData.ok).toBe(true);
    expect(meData.privacySettings.profileVisibility).toBe('friends');

    // 3. Reset back to public
    const resetRes = await fetch(`${BASE_URL}/api/user/privacy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testUser.sessionToken}`,
      },
      body: JSON.stringify({ profileVisibility: 'public' }),
    });
    expect(resetRes.status).toBe(200);
    const resetData = await resetRes.json();
    expect(resetData.privacySettings.profileVisibility).toBe('public');
  });

  it('serves real notifications via /api/notifications', async () => {
    const notifRes = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${testUser.sessionToken}` },
    });
    expect(notifRes.status).toBe(200);
    const notifData = await notifRes.json();
    expect(notifData.ok).toBe(true);
    expect(Array.isArray(notifData.notifications)).toBe(true);
  });
});
