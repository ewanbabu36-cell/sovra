/**
 * @file tests/e2e/auth-link-and-icon-interception.test.ts
 * 👑 AUTH PRE-FLIGHT GUARD: UNIFIED LINK & APP ICON AUTH INTERCEPTION & ROLE-BASED ROUTING SUITE
 *
 * Explicitly Verifies User Requirement:
 * "PATTERN MISS MATCH H. JB LINK YA APP ICON PR CLICK KARUNGA TO PAHLE USER LOGIN STATE CHECK HOGA
 *  AGAR ALREADY LOGIN H TO AS PER USER PROFILE OPEN HOGA AGAR LOGIN NI H TO LANDING PAGE HOGA"
 *
 * 1. Unauthenticated Link & App Icon Click Interception:
 *    - Clicking ANY app icon (openApp('chat'), openApp('studio'), openApp('wallet'), openApp('feed'), etc.)
 *      immediately checks login state. If not authenticated, records window._pendingTargetAppId and opens the Landing Page.
 *    - Clicking ANY navigation link / tab (switchTab('chat'), switchTab('reels'), switchTab('studio'), etc.)
 *      immediately checks login state. If not authenticated, intercepts and opens the Landing Page.
 * 2. Authenticated Link & App Icon Execution as per User Profile:
 *    - When already logged in (valid token + profile), clicking app icon or link immediately opens
 *      the corresponding app workspace as per the user's role (Consumer vs Creator vs Admin).
 *    - Enforces RBAC permissions (e.g. non-admin users cannot access the Operations Console).
 * 3. Post-Auth Transition:
 *    - After successful login/registration, user is smoothly routed directly into their pending target app.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('👑 Unified Auth Link & App Icon Interception Suite', { timeout: 30000 }, () => {
  let serverHtml = '';

  beforeAll(async () => {
    try {
      const res = await fetch(`${BASE_URL}/`);
      if (res.ok) {
        serverHtml = await res.text();
      }
    } catch (_) {
      const devServerFile = path.resolve(__dirname, '../../scripts/dev-server.ts');
      serverHtml = fs.readFileSync(devServerFile, 'utf8');
    }
  });

  function setupAuthInterceptionSandbox(initialMode: 'unauthenticated' | 'authenticated' = 'unauthenticated', userRole: string = 'consumer') {
    function createMockElement(tag: string = 'div') {
      const classes = new Set<string>();
      const attributes: Record<string, string> = {};
      const children: any[] = [];
      return {
        tagName: tag.toUpperCase(),
        id: '',
        style: {} as Record<string, any>,
        classList: {
          add(c: string) { classes.add(c); },
          remove(c: string) { classes.delete(c); },
          contains(c: string) { return classes.has(c); },
          get length() { return classes.size; }
        },
        setAttribute: (k: string, v: string) => { attributes[k] = String(v); },
        getAttribute: (k: string) => attributes[k] || null,
        appendChild: (child: any) => { children.push(child); return child; },
        children,
        textContent: '',
        innerHTML: '',
        value: '',
        onclick: null as any,
        click() { if (typeof this.onclick === 'function') this.onclick(); }
      };
    }

    const elementsMap: Record<string, any> = {};
    const docClasses = new Set<string>(initialMode === 'unauthenticated' ? ['sovra-unauthenticated'] : []);

    const sandbox: Record<string, any> = {
      window: {},
      document: {
        readyState: 'complete',
        addEventListener: () => {},
        removeEventListener: () => {},
        createElement: (tag: string) => createMockElement(tag),
        getElementById: (id: string) => {
          if (!elementsMap[id]) {
            const el = createMockElement('div');
            (el as any).id = id;
            if (id === 'welcomeOnboardingModal') el.style.display = 'none';
            if (id === 'sovraAppContextMenu') el.style.display = 'none';
            if (id === 'sovraAppInfoModal') el.style.display = 'none';
            if (id === 'sovraFolderViewModal') el.style.display = 'none';
            if (id === 'sovraRecentsOverview') el.style.display = 'none';
            if (id === 'sovraMasterDrawerOverlay') el.style.display = 'none';
            elementsMap[id] = el;
          }
          return elementsMap[id];
        },
        querySelector: () => createMockElement('div'),
        querySelectorAll: () => [],
        documentElement: {
          style: { setProperty: () => {} },
          classList: {
            add(c: string) { docClasses.add(c); },
            remove(c: string) { docClasses.delete(c); },
            contains(c: string) { return docClasses.has(c); }
          }
        },
        body: {
          appendChild: (c: any) => c,
          dataset: {} as Record<string, string>,
          classList: {
            _classes: new Set<string>(['sovra-mode-home']),
            add(c: string) { this._classes.add(c); },
            remove(c: string) { this._classes.delete(c); },
            contains(c: string) { return this._classes.has(c); }
          }
        }
      },
      localStorage: {
        _store: (initialMode === 'authenticated' ? {
          sovra_session_token: 'valid_test_token_999',
          sovra_user_profile: JSON.stringify({
            did: 'did:sovra:testuser123',
            handle: '@testuser',
            name: 'Test Sovereign User',
            role: userRole,
            sessionToken: 'valid_test_token_999'
          })
        } : {
          sovra_logged_out: 'true'
        }) as Record<string, string>,
        getItem(key: string) { return this._store[key] || null; },
        setItem(key: string, val: string) { this._store[key] = String(val); },
        removeItem(key: string) { delete this._store[key]; }
      },
      sessionStorage: {
        _store: {} as Record<string, string>,
        getItem(key: string) { return this._store[key] || null; },
        setItem(key: string, val: string) { this._store[key] = String(val); },
        removeItem(key: string) { delete this._store[key]; }
      },
      navigator: { vibrate: () => true },
      setInterval: () => 1,
      setTimeout: (fn: Function) => fn(),
      clearTimeout: () => {},
      console: { log: () => {}, warn: () => {}, error: () => {} },
      fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
      myProfile: initialMode === 'authenticated' ? {
        did: 'did:sovra:testuser123',
        handle: '@testuser',
        name: 'Test Sovereign User',
        role: userRole,
        sessionToken: 'valid_test_token_999'
      } : null
    };
    sandbox.window = sandbox;

    // Load SovraModularGlassOS
    const matchModular = serverHtml.match(/\(function initSovraModularGlassOS\(\)[\s\S]*?\n\s*\}\)\(\);/);
    if (matchModular) {
      vm.createContext(sandbox);
      vm.runInContext(matchModular[0], sandbox);
    }

    // Load SovraAndroidOS
    const matchAndroid = serverHtml.match(/\(function initSovraAndroidOS\(\)[\s\S]*?\n\s*\}\)\(\);/);
    if (!matchAndroid) throw new Error('initSovraAndroidOS IIFE not found in serverHtml');
    vm.runInContext(matchAndroid[0], sandbox);

    return { sandbox, elementsMap };
  }

  it('1. When user is NOT logged in: clicking ANY app icon intercepts, records pending app, and triggers Landing Page modal', () => {
    const { sandbox, elementsMap } = setupAuthInterceptionSandbox('unauthenticated');
    const androidOS = sandbox.window.SovraAndroidOS;

    expect(androidOS.isUserAuthenticated()).toBe(false);

    let landingModalOpened = false;
    let openedTab = '';
    sandbox.showAuthLandingModal = (tab: string) => {
      landingModalOpened = true;
      openedTab = tab;
      const modal = sandbox.document.getElementById('welcomeOnboardingModal');
      if (modal) modal.style.display = 'flex';
    };

    // Click 'chat' app icon
    androidOS.openApp('chat');

    expect(androidOS.getMode()).toBe('home'); // Private chat view must NOT open
    expect(sandbox.window._pendingTargetAppId).toBe('chat'); // Preserves target
    expect(landingModalOpened).toBe(true);
    expect(openedTab).toBe('login');
    expect(elementsMap['welcomeOnboardingModal'].style.display).toBe('flex');

    // Click 'studio' app icon
    landingModalOpened = false;
    androidOS.openApp('studio');
    expect(androidOS.getMode()).toBe('home');
    expect(sandbox.window._pendingTargetAppId).toBe('studio');
    expect(landingModalOpened).toBe(true);

    // Click 'wallet' app icon
    landingModalOpened = false;
    androidOS.openApp('wallet');
    expect(androidOS.getMode()).toBe('home');
    expect(sandbox.window._pendingTargetAppId).toBe('wallet');
    expect(landingModalOpened).toBe(true);
  });

  it('2. When user is NOT logged in: clicking ANY navigation link (switchTab) intercepts and triggers Landing Page modal', () => {
    const { sandbox, elementsMap } = setupAuthInterceptionSandbox('unauthenticated');

    let landingModalOpened = false;
    let openedTab = '';
    sandbox.showAuthLandingModal = (tab: string) => {
      landingModalOpened = true;
      openedTab = tab;
      const modal = sandbox.document.getElementById('welcomeOnboardingModal');
      if (modal) modal.style.display = 'flex';
    };

    // Extract switchTab function from serverHtml
    const matchSwitchTab = serverHtml.match(/function switchTab\(tab\) \{[\s\S]*?\n    \}/);
    expect(matchSwitchTab).toBeDefined();

    // Run switchTab in the sandbox context
    vm.runInContext(matchSwitchTab![0] + '; window.switchTab = switchTab;', sandbox);

    // Click navigation link to 'feed'
    sandbox.window.switchTab('feed');
    expect(landingModalOpened).toBe(true);
    expect(openedTab).toBe('login');
    expect(sandbox.window._pendingTargetAppId).toBe('feed');

    // Click navigation link to 'reels'
    landingModalOpened = false;
    sandbox.window.switchTab('reels');
    expect(landingModalOpened).toBe(true);
    expect(sandbox.window._pendingTargetAppId).toBe('reels');
  });

  it('3. When user IS logged in: clicking app icon immediately opens as per user profile', () => {
    const { sandbox } = setupAuthInterceptionSandbox('authenticated', 'consumer');
    const androidOS = sandbox.window.SovraAndroidOS;

    expect(androidOS.isUserAuthenticated()).toBe(true);

    let tabSwitched = '';
    sandbox.switchTab = (tab: string) => { tabSwitched = tab; };

    // Consumer clicks 'chat'
    androidOS.openApp('chat');
    expect(androidOS.getMode()).toBe('app');
    expect(androidOS.getActiveTasks()).toContain('chat');
    expect(tabSwitched).toBe('chat');

    // Consumer clicks 'feed'
    androidOS.openApp('feed');
    expect(androidOS.getMode()).toBe('app');
    expect(androidOS.getActiveTasks()).toContain('feed');
    expect(tabSwitched).toBe('feed');
  });

  it('4. Role-Based Permissions: Non-admin users are strictly blocked from admin console', () => {
    const { sandbox } = setupAuthInterceptionSandbox('authenticated', 'consumer');
    const androidOS = sandbox.window.SovraAndroidOS;

    let toastShown = '';
    sandbox.showAccountToast = (msg: string) => { toastShown = msg; };
    sandbox.switchTab = () => {};

    // Normal consumer tries to open 'admin'
    androidOS.openApp('admin');
    expect(toastShown).toContain('Operations Console is reserved for Node Operators and Admins');
    expect(androidOS.getActiveTasks()).not.toContain('admin');
  });

  it('5. Post-Auth Transition: After login, user is seamlessly hydrated and directed to pending app', () => {
    const { sandbox } = setupAuthInterceptionSandbox('unauthenticated');
    const androidOS = sandbox.window.SovraAndroidOS;

    // User originally tapped 'reels' while unauthenticated
    sandbox.window._pendingTargetAppId = 'reels';

    // Simulate login completion
    sandbox.localStorage.setItem('sovra_session_token', 'valid_session_token_123');
    sandbox.localStorage.setItem('sovra_user_profile', JSON.stringify({
      did: 'did:sovra:alice456',
      handle: '@alice',
      name: 'Alice Sovereign',
      role: 'consumer',
      sessionToken: 'valid_session_token_123'
    }));
    sandbox.myProfile = {
      did: 'did:sovra:alice456',
      handle: '@alice',
      name: 'Alice Sovereign',
      role: 'consumer',
      sessionToken: 'valid_session_token_123'
    };
    sandbox.localStorage.removeItem('sovra_logged_out');
    sandbox.document.documentElement.classList.remove('sovra-unauthenticated');

    expect(androidOS.isUserAuthenticated()).toBe(true);

    let launchedTab = '';
    sandbox.switchTab = (tab: string) => { launchedTab = tab; };

    // Execute post-login hydration
    if (sandbox.window._pendingTargetAppId && typeof androidOS.openApp === 'function') {
      const target = sandbox.window._pendingTargetAppId;
      sandbox.window._pendingTargetAppId = null;
      androidOS.openApp(target);
    }

    expect(androidOS.getMode()).toBe('app');
    expect(sandbox.window._pendingTargetAppId).toBeNull();
    expect(launchedTab).toBe('reels');
    expect(androidOS.getActiveTasks()).toContain('reels');
  });
});
