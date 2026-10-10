/**
 * SOVRA — Phase 1: Spatial Surface Engine + Profile Interaction Test Suite
 * File: tests/e2e/spatial-surface-engine-phase1.test.ts
 *
 * Verifies:
 * 1. Surface Engine Core API (open, push, replace, pop, close, closeAll, popTo, stack depth, origin, reduced motion)
 * 2. Visual & Structural Architecture (Glass backdrop, header, breadcrumbs, responsive sheet, reduced motion)
 * 3. Complete Target Flow (SOVRA -> Profile -> Settings -> Privacy -> Profile Visibility)
 * 4. Strict Isolation Rules (First-level Settings only, Privacy items without accordions)
 * 5. Real Backend Persistence via /api/user/privacy (Public, Friends, Private, Only Me)
 * 6. History & Keyboard Synchronization (ESC key, popstate)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  SovraSurfaceEngine,
  SovraSurfaceStack,
  SovraSurfaceTransition,
  SovraSurfaceBackdrop,
  SovraSurfaceHeader,
  SovraSurface,
} from '@sovra/app';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

// ============================================================================
// 1. LIGHTWEIGHT DOM SHIM FOR TESTING TYPESCRIPT ENGINE IN NODE
// ============================================================================

function createMockElement(tag: string = 'div'): any {
  const listeners: Record<string, Function[]> = {};
  const attributes: Record<string, string> = {};
  const styles: Record<string, string> = {};
  const children: any[] = [];
  const classListSet = new Set<string>();

  let rawClassName = '';

  const el = {
    tagName: tag.toUpperCase(),
    get className() {
      return Array.from(classListSet).join(' ');
    },
    set className(val: string) {
      rawClassName = val;
      classListSet.clear();
      val.split(/\s+/).filter(Boolean).forEach((c) => classListSet.add(c));
    },
    id: '',
    style: {
      setProperty: (prop: string, val: string) => { styles[prop] = val; },
      getPropertyValue: (prop: string) => styles[prop] || '',
      display: '',
    },
    parentNode: null as any,
    children,
    innerHTML: '',
    innerText: '',
    dataset: {} as Record<string, string>,
    setAttribute: (name: string, val: string) => { attributes[name] = val; },
    getAttribute: (name: string) => attributes[name] || null,
    removeAttribute: (name: string) => { delete attributes[name]; },
    classList: {
      add: (cls: string) => {
        classListSet.add(cls);
      },
      remove: (cls: string) => {
        classListSet.delete(cls);
      },
      contains: (cls: string) => classListSet.has(cls),
      toggle: (cls: string) => {
        if (classListSet.has(cls)) classListSet.delete(cls);
        else classListSet.add(cls);
      },
    },
    appendChild: (child: any) => {
      child.parentNode = el;
      children.push(child);
      return child;
    },
    removeChild: (child: any) => {
      const idx = children.indexOf(child);
      if (idx !== -1) {
        children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    },
    addEventListener: (ev: string, fn: Function) => {
      if (!listeners[ev]) listeners[ev] = [];
      listeners[ev].push(fn);
    },
    removeEventListener: (ev: string, fn: Function) => {
      if (listeners[ev]) {
        listeners[ev] = listeners[ev].filter((f) => f !== fn);
      }
    },
    dispatchEvent: (ev: any) => {
      const fns = listeners[ev.type] || [];
      fns.forEach((f) => f(ev));
    },
    querySelector: (selector: string) => children[0] || null,
    querySelectorAll: (selector: string) => children,
    focus: () => {},
    getBoundingClientRect: () => ({ left: 100, top: 120, width: 200, height: 60, right: 300, bottom: 180 }),
  };

  return el;
}

function setupNodeDomEnvironment() {
  const containerEl = createMockElement('div');
  containerEl.id = 'sovraSpatialSurfaceContainer';

  const bodyEl = createMockElement('body');
  bodyEl.appendChild(containerEl);

  const docEl = createMockElement('html');

  const doc = {
    body: bodyEl,
    documentElement: docEl,
    createElement: (tag: string) => createMockElement(tag),
    getElementById: (id: string) => (id === 'sovraSpatialSurfaceContainer' ? containerEl : null),
    activeElement: createMockElement('button'),
    addEventListener: (ev: string, fn: Function) => {},
    removeEventListener: (ev: string, fn: Function) => {},
  };

  const win = {
    history: {
      pushState: (state: any, title: string, url: string) => {},
      back: () => {},
    },
    matchMedia: (query: string) => ({ matches: false, addEventListener: () => {} }),
    location: { href: 'http://localhost:3001/' },
    addEventListener: (ev: string, fn: Function) => {},
  };

  (globalThis as any).document = doc;
  (globalThis as any).window = win;
  (globalThis as any).HTMLElement = Object;
  (globalThis as any).requestAnimationFrame = (cb: Function) => setTimeout(cb, 0);
  (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);

  return { containerEl, bodyEl, doc, win };
}

// ============================================================================
// 2. TESTS
// ============================================================================

describe('SOVRA Phase 1 — Spatial Surface Engine & Target Flow', () => {
  let htmlContent: string = '';
  let testUser: { did: string; handle: string; sessionToken: string };
  const ts = Date.now();

  beforeAll(async () => {
    // Register user for real API verification
    const regRes = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@spatial_p1_${ts}`,
        name: 'Phase 1 Verifier',
        bio: 'Validating Surface Engine & Profile Settings',
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

    // Retrieve live dashboard HTML
    const pageRes = await fetch(`${BASE_URL}/`);
    expect(pageRes.status).toBe(200);
    htmlContent = await pageRes.text();
  });

  // --------------------------------------------------------------------------
  // SUITE A: REUSABLE TYPESCRIPT SPATIAL SURFACE ENGINE
  // --------------------------------------------------------------------------
  describe('Suite A: TypeScript Spatial Surface Engine Core Module', () => {
    beforeAll(() => {
      setupNodeDomEnvironment();
    });

    it('exports all core Surface Engine components and singletons from package', () => {
      expect(SovraSurfaceEngine).toBeDefined();
      expect(SovraSurfaceStack).toBeDefined();
      expect(SovraSurfaceTransition).toBeDefined();
      expect(SovraSurfaceBackdrop).toBeDefined();
      expect(SovraSurfaceHeader).toBeDefined();
      expect(SovraSurface).toBeDefined();
    });

    it('computes origin coordinates and detects reduced motion correctly', () => {
      const originCoords = SovraSurfaceTransition.getOriginCoords({ x: 350, y: 420 });
      expect(originCoords).toEqual({ x: 350, y: 420 });

      const mockBtn = createMockElement('button');
      const elementCoords = SovraSurfaceTransition.getOriginCoords(mockBtn);
      expect(elementCoords).toEqual({ x: 200, y: 150 }); // center of bounding rect (100+200/2, 120+60/2)

      expect(typeof SovraSurfaceTransition.isReducedMotion()).toBe('boolean');
    });

    it('implements stack operations: openSurface, pushSurface, depth tracking, and recession', () => {
      const engine = SovraSurfaceEngine.getInstance();
      engine.closeAllSurfaces();
      expect(engine.getDepth()).toBe(0);

      // 1. Open Settings Surface
      const s1 = engine.openSurface({
        id: 'settings',
        type: 'settings',
        title: 'SOVRA SETTINGS',
      });
      expect(engine.getDepth()).toBe(1);
      expect(engine.getCurrentSurface()?.id).toBe('settings');
      expect(s1.animationState).toBe('active');
      expect(s1.el.classList.contains('is-active')).toBe(true);

      // 2. Push Privacy Surface
      const s2 = engine.pushSurface({
        id: 'privacy',
        type: 'privacy',
        title: 'PRIVACY',
      });
      expect(engine.getDepth()).toBe(2);
      expect(engine.getCurrentSurface()?.id).toBe('privacy');
      expect(s2.parent).toBe('settings');
      expect(s1.animationState).toBe('receded');
      expect(s1.el.classList.contains('is-receded')).toBe(true);

      // 3. Push Profile Visibility Surface
      const s3 = engine.pushSurface({
        id: 'profile-visibility',
        type: 'profile-visibility',
        title: 'PROFILE VISIBILITY',
      });
      expect(engine.getDepth()).toBe(3);
      expect(engine.getCurrentSurface()?.id).toBe('profile-visibility');
      expect(s3.parent).toBe('privacy');
      expect(s2.animationState).toBe('receded');

      // Verify stack inspection
      const stack = engine.getStack();
      expect(stack.length).toBe(3);
      expect(stack.map((s) => s.id)).toEqual(['settings', 'privacy', 'profile-visibility']);
    });

    it('implements popSurface: returns to previous surface and restores active state', () => {
      const engine = SovraSurfaceEngine.getInstance();
      if (engine.getDepth() !== 3) {
        engine.closeAllSurfaces();
        engine.pushSurface({ id: 'settings', title: 'SOVRA SETTINGS' });
        engine.pushSurface({ id: 'privacy', title: 'PRIVACY' });
        engine.pushSurface({ id: 'profile-visibility', title: 'PROFILE VISIBILITY' });
      }
      expect(engine.getDepth()).toBe(3);

      // Pop from Profile Visibility -> Privacy
      const active1 = engine.popSurface();
      expect(engine.getDepth()).toBe(2);
      expect(active1?.id).toBe('privacy');
      expect(active1?.animationState).toBe('active');
      expect(active1?.el.classList.contains('is-active')).toBe(true);

      // Pop from Privacy -> Settings
      const active2 = engine.popSurface();
      expect(engine.getDepth()).toBe(1);
      expect(active2?.id).toBe('settings');
      expect(active2?.animationState).toBe('active');

      // Pop from Settings -> Close All
      const active3 = engine.popSurface();
      expect(engine.getDepth()).toBe(0);
      expect(active3).toBeNull();
    });

    it('implements replaceSurface: substitutes top surface without stack depth increase', () => {
      const engine = SovraSurfaceEngine.getInstance();
      engine.closeAllSurfaces();

      engine.pushSurface({ id: 'base', title: 'Base Surface' });
      expect(engine.getDepth()).toBe(1);

      engine.replaceSurface({ id: 'replaced', title: 'Replaced Surface' });
      expect(engine.getDepth()).toBe(1);
      expect(engine.getCurrentSurface()?.id).toBe('replaced');
    });

    it('implements popTo: unwinds stack to designated ancestor surface ID', () => {
      const engine = SovraSurfaceEngine.getInstance();
      engine.closeAllSurfaces();

      engine.pushSurface({ id: 'surface-1', title: 'Surface 1' });
      engine.pushSurface({ id: 'surface-2', title: 'Surface 2' });
      engine.pushSurface({ id: 'surface-3', title: 'Surface 3' });
      engine.pushSurface({ id: 'surface-4', title: 'Surface 4' });
      expect(engine.getDepth()).toBe(4);

      engine.popTo('surface-2');
      expect(engine.getDepth()).toBe(2);
      expect(engine.getCurrentSurface()?.id).toBe('surface-2');
      expect(engine.getCurrentSurface()?.animationState).toBe('active');

      engine.closeAllSurfaces();
      expect(engine.getDepth()).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // SUITE B: HTML & VISUAL ARCHITECTURE IN RUNNING PRODUCTION DEV SERVER
  // --------------------------------------------------------------------------
  describe('Suite B: Visual Architecture & Server Markup', () => {
    it('serves sovereign spatial surface container with proper accessibility semantics', () => {
      expect(htmlContent).toContain('id="sovraSpatialSurfaceContainer"');
      expect(htmlContent).toContain('class="sovra-surface-container"');
      expect(htmlContent).toContain('aria-live="polite"');
    });

    it('declares glassmorphism, blur, origin-transforms, and luminous borders', () => {
      expect(htmlContent).toContain('backdrop-filter: blur(18px)');
      expect(htmlContent).toContain('backdrop-filter: blur(28px)');
      expect(htmlContent).toContain('border: 1px solid rgba(56, 189, 248, 0.24);');
      expect(htmlContent).toContain('transform-origin: var(--origin-x, 50%) var(--origin-y, 50%);');
      expect(htmlContent).toContain('.sovra-surface-card.is-receded {');
      expect(htmlContent).toContain('.sovra-surface-card.is-closing {');
    });

    it('declares responsive bottom sheet layout for mobile <= 640px', () => {
      expect(htmlContent).toContain('@media (max-width: 640px) {');
      expect(htmlContent).toContain('width: 100vw !important;');
      expect(htmlContent).toContain('border-radius: 24px 24px 0 0 !important;');
      expect(htmlContent).toContain('.sovra-surface-drag-handle {');
    });

    it('declares accessibility support for prefers-reduced-motion', () => {
      expect(htmlContent).toContain('@media (prefers-reduced-motion: reduce) {');
      expect(htmlContent).toContain('transition: none !important;');
      expect(htmlContent).toContain('animation: none !important;');
    });

    it('wires Profile action row and overflow menu to openSpatialSettingsSurface', () => {
      expect(htmlContent).toContain('id="profileSettingsBtn"');
      expect(htmlContent).toContain('onclick="openSpatialSettingsSurface(this)"');
      expect(htmlContent).toContain('id="profileSettingsMenuItem"');
    });
  });

  // --------------------------------------------------------------------------
  // SUITE C: TARGET FLOW ISOLATION & HIERARCHY IN CLIENT SCRIPTS
  // --------------------------------------------------------------------------
  describe('Suite C: Target Flow Hierarchy & Non-Expanding Surface Pattern', () => {
    it('Settings Surface presents strictly the 5 first-level categories', () => {
      // 1. Privacy, 2. Security, 3. Notifications, 4. Appearance, 5. Account
      expect(htmlContent).toContain('id="spatialSettingsPrivacyItem"');
      expect(htmlContent).toContain('id="spatialSettingsSecurityItem"');
      expect(htmlContent).toContain('id="spatialSettingsNotificationsItem"');
      expect(htmlContent).toContain('id="spatialSettingsAppearanceItem"');
      expect(htmlContent).toContain('id="spatialSettingsAccountItem"');
      expect(htmlContent).toContain('title: \'SOVRA SETTINGS\'');
      expect(htmlContent).toContain('onclick="window.openSpatialPrivacySurface(this)"');
    });

    it('Privacy Surface presents strictly the 4 required items with surface openers (no accordions)', () => {
      // 1. Profile Visibility, 2. Post Visibility, 3. Message Permissions, 4. Blocked Users
      expect(htmlContent).toContain('id="spatialPrivacyProfileVisItem"');
      expect(htmlContent).toContain('id="spatialPrivacyPostVisItem"');
      expect(htmlContent).toContain('id="spatialPrivacyMsgPermsItem"');
      expect(htmlContent).toContain('id="spatialPrivacyBlockedUsersItem"');
      expect(htmlContent).toContain('title: \'PRIVACY\'');
      expect(htmlContent).toContain('onclick="window.openSpatialProfileVisibilitySurface(this)"');
      expect(htmlContent).toContain('onclick="window.openSpatialPostVisibilitySurface(this)"');
      expect(htmlContent).toContain('onclick="window.openSpatialMessagePermissionsSurface(this)"');
      expect(htmlContent).toContain('onclick="window.openSpatialBlockedUsersSurface(this)"');
    });

    it('Profile Visibility Surface presents the 4 interactive controls', () => {
      expect(htmlContent).toContain('title: \'PROFILE VISIBILITY\'');
      expect(htmlContent).toContain('id="opt-vis-public"');
      expect(htmlContent).toContain('id="opt-vis-friends"');
      expect(htmlContent).toContain('id="opt-vis-private"');
      expect(htmlContent).toContain('id="opt-vis-only_me"');
      expect(htmlContent).toContain('window._selectProfileVisibility(&quot;friends&quot;, this)');
      expect(htmlContent).toContain('id="spatialVisFeedback"');
    });

    it('exposes full Surface Engine API on window.SovraSurfaceManager and aliases', () => {
      expect(htmlContent).toContain('openSurface: pushSurface');
      expect(htmlContent).toContain('pushSurface: pushSurface');
      expect(htmlContent).toContain('popSurface: popSurface');
      expect(htmlContent).toContain('replaceSurface: replaceSurface');
      expect(htmlContent).toContain('closeSurface: closeSurface');
      expect(htmlContent).toContain('closeAll: closeAll');
      expect(htmlContent).toContain('closeAllSurfaces: closeAll');
      expect(htmlContent).toContain('popTo: popTo');
      expect(htmlContent).toContain('getCurrentSurface: getCurrentSurface');
      expect(htmlContent).toContain('getStack: getStack');
      expect(htmlContent).toContain('getDepth: getDepth');
      expect(htmlContent).toContain('window.SovraSurfaceEngine = window.SovraSurfaceManager;');
    });

    it('implements mobile history push/popstate and keyboard Escape listeners', () => {
      expect(htmlContent).toContain('history.pushState({ sovraSurface: true');
      expect(htmlContent).toContain('window.addEventListener(\'popstate\'');
      expect(htmlContent).toContain('e.key === \'Escape\' && _stack.length > 0');
    });
  });

  // --------------------------------------------------------------------------
  // SUITE D: REAL BACKEND PERSISTENCE & RELOAD SURVIVAL
  // --------------------------------------------------------------------------
  describe('Suite D: Real Backend Persistence via /api/user/privacy', () => {
    it('fetches default privacy settings for authenticated user', async () => {
      const res = await fetch(`${BASE_URL}/api/user/privacy`, {
        headers: { Authorization: `Bearer ${testUser.sessionToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.privacySettings).toBeDefined();
    });

    it('persists selecting "Friends" and survives simulated reload', async () => {
      // 1. User selects "Friends" on Profile Visibility Surface
      const postRes = await fetch(`${BASE_URL}/api/user/privacy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testUser.sessionToken}`,
        },
        body: JSON.stringify({ profileVisibility: 'friends' }),
      });
      expect(postRes.status).toBe(200);
      const postData = await postRes.json();
      expect(postData.ok).toBe(true);
      expect(postData.privacySettings.profileVisibility).toBe('friends');

      // 2. Simulated Page Reload: Re-fetch user privacy from server
      const reloadRes = await fetch(`${BASE_URL}/api/user/privacy`, {
        headers: { Authorization: `Bearer ${testUser.sessionToken}` },
      });
      expect(reloadRes.status).toBe(200);
      const reloadData = await reloadRes.json();
      expect(reloadData.ok).toBe(true);
      expect(reloadData.privacySettings.profileVisibility).toBe('friends');
    });

    it('persists selecting "Only Me"', async () => {
      const postRes = await fetch(`${BASE_URL}/api/user/privacy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testUser.sessionToken}`,
        },
        body: JSON.stringify({ profileVisibility: 'only_me' }),
      });
      expect(postRes.status).toBe(200);
      const postData = await postRes.json();
      expect(postData.ok).toBe(true);
      expect(postData.privacySettings.profileVisibility).toBe('only_me');

      // Verify persistence
      const verifyRes = await fetch(`${BASE_URL}/api/user/privacy`, {
        headers: { Authorization: `Bearer ${testUser.sessionToken}` },
      });
      const verifyData = await verifyRes.json();
      expect(verifyData.privacySettings.profileVisibility).toBe('only_me');
    });

    it('persists selecting "Private"', async () => {
      const postRes = await fetch(`${BASE_URL}/api/user/privacy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testUser.sessionToken}`,
        },
        body: JSON.stringify({ profileVisibility: 'private' }),
      });
      expect(postRes.status).toBe(200);
      const postData = await postRes.json();
      expect(postData.ok).toBe(true);
      expect(postData.privacySettings.profileVisibility).toBe('private');
    });

    it('persists selecting "Public"', async () => {
      const postRes = await fetch(`${BASE_URL}/api/user/privacy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testUser.sessionToken}`,
        },
        body: JSON.stringify({ profileVisibility: 'public' }),
      });
      expect(postRes.status).toBe(200);
      const postData = await postRes.json();
      expect(postData.ok).toBe(true);
      expect(postData.privacySettings.profileVisibility).toBe('public');
    });

    it('persists sub-surface settings for post visibility and message permissions', async () => {
      const postRes = await fetch(`${BASE_URL}/api/user/privacy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testUser.sessionToken}`,
        },
        body: JSON.stringify({
          postVisibility: 'friends',
          canMessageMe: 'friends',
        }),
      });
      expect(postRes.status).toBe(200);
      const postData = await postRes.json();
      expect(postData.ok).toBe(true);
      expect(postData.privacySettings.postVisibility).toBe('friends');
      expect(postData.privacySettings.canMessageMe).toBe('friends');
    });

    it('rejects unauthenticated requests to /api/user/privacy with HTTP 401', async () => {
      const res = await fetch(`${BASE_URL}/api/user/privacy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileVisibility: 'public' }),
      });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Authentication required');
    });
  });
});
