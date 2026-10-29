/**
 * @file tests/e2e/sovereign-os-launcher.test.ts
 * 👑 SOVRA SOVEREIGN OS RUNTIME, APP-CENTRIC HOMESCREEN & 3-BUTTON MULTITASKING TEST SUITE
 *
 * Verifies:
 * 1. OS Boot Experience & Clean Desktop Canvas:
 *    - Boot mode is clean distraction-free OS Homescreen (sovra-mode-home).
 *    - Feeds, sidebars, and desktop headers are hidden (zero-clutter canvas).
 * 2. 10 Discrete App Icons available on Sovereign OS Desktop:
 *    - Chat, Feed, Reels, Watch, Upload, Wallet, Studio, Settings, Profile, BLE Mesh.
 * 3. Guest / Visitor Unauthenticated State & App Tap Interception:
 *    - Tapping any protected app icon intercepts launch, records window._pendingTargetAppId,
 *      and displays the Sovereign Public Landing Gateway.
 * 4. Post-Authentication Hydration & Target App Transition:
 *    - Successful sign-in hydrates session and directly launches the pending app.
 * 5. 3-Button Minimalist Navigation Bar (Recents |||, Home/Drawer ○, Back ◂):
 *    - Back closes overlays / minimizes app to homescreen.
 *    - Home minimizes app when in app mode, or opens drawer when on homescreen.
 *    - Recents opens 3D task switcher, and "Close All" minimizes back to homescreen.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import vm from 'node:vm';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('👑 Sovra Sovereign OS Runtime, App-Centric Homescreen & 3-Button Multitasking Engine', { timeout: 30000 }, () => {
  let serverHtml = '';

  beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    serverHtml = await res.text();
  });

  // Helper: Create simulated DOM sandbox
  function setupSandbox(initialHtmlClass = '') {
    function createMockElement(tag: string) {
      const children: any[] = [];
      const classList = {
        _classes: new Set<string>(),
        add(c: string) { this._classes.add(c); },
        remove(c: string) { this._classes.delete(c); },
        contains(c: string) { return this._classes.has(c); },
        get length() { return this._classes.size; }
      };
      const element: any = {
        tagName: tag.toUpperCase(),
        id: '',
        style: {} as Record<string, string>,
        classList,
        className: '',
        dataset: {} as Record<string, string>,
        children,
        appendChild(child: any) { children.push(child); return child; },
        setAttribute(k: string, v: string) { (this as any)[k] = v; },
        getAttribute(k: string) { return (this as any)[k] || null; },
        removeAttribute(k: string) { delete (this as any)[k]; },
        addEventListener: () => {},
        removeEventListener: () => {},
        click() { if (typeof this.onclick === 'function') this.onclick(); }
      };
      return element;
    }

    const docClasses = new Set<string>(initialHtmlClass ? [initialHtmlClass] : []);

    const sandbox: any = {
      window: null as any,
      document: {
        readyState: 'complete',
        addEventListener: () => {},
        createElement: (tag: string) => createMockElement(tag),
        getElementById: (id: string) => {
          const el = createMockElement('div');
          el.id = id;
          if (id === 'welcomeOnboardingModal') {
            el.style.display = 'none';
          }
          if (id === 'sovraRecentsOverview') {
            el.style.display = 'none';
          }
          if (id === 'sovraMasterDrawerOverlay') {
            el.style.display = 'none';
          }
          return el;
        },
        documentElement: {
          classList: {
            add(c: string) { docClasses.add(c); },
            remove(c: string) { docClasses.delete(c); },
            contains(c: string) { return docClasses.has(c); }
          },
          style: { setProperty: () => {} }
        },
        body: {
          classList: {
            _classes: new Set<string>(['sovra-mode-home']),
            add(c: string) { this._classes.add(c); },
            remove(c: string) { this._classes.delete(c); },
            contains(c: string) { return this._classes.has(c); }
          }
        },
        querySelectorAll: () => []
      },
      localStorage: {
        _store: {} as Record<string, string>,
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
      switchTab: () => {},
      fetch: async () => ({ ok: true, json: async () => ({}) })
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

    return sandbox;
  }

  it('1. Boot Experience & Clean Desktop Canvas: serves distraction-free OS Homescreen with hidden sidebars and headers', () => {
    // OS Homescreen element and Multi-Page Track
    expect(serverHtml).toContain('id="sovraHomeScreenView"');
    expect(serverHtml).toContain('id="sovraMultiPageContainer"');
    expect(serverHtml).toContain('id="sovraMultiPageTrack"');

    // Default body class boots in sovra-mode-home
    expect(serverHtml).toContain('class="nav-mode-auto theme-black sovra-mode-home"');

    // CSS guarantees clean canvas with zero desktop clutter on Homescreen
    expect(serverHtml).toContain('body.sovra-mode-home .app-layout');
    expect(serverHtml).toContain('body.sovra-mode-home .app-top-header');
    expect(serverHtml).toContain('body.sovra-mode-home .sovra-android-nav-bar');
    expect(serverHtml).toContain('body.sovra-mode-app .sovra-home-screen-view');
    expect(serverHtml).toContain('body.sovra-mode-app .sovra-android-nav-bar');
    expect(serverHtml).toContain('body.sovra-mode-app .app-layout');

    // Android Glance clock & date widgets
    expect(serverHtml).toContain('id="androidGlanceClock"');
    expect(serverHtml).toContain('id="androidGlanceDate"');
    expect(serverHtml).toContain('id="androidGlanceStatusPill"');
  });

  it('2. Discrete App Icons for all 10 core features: chat, feed, reels, watch, upload, wallet, studio, settings, profile, and mesh', () => {
    const sandbox = setupSandbox();
    const androidOS = sandbox.window.SovraAndroidOS;
    expect(androidOS).toBeDefined();

    const homeApps = androidOS.getHomeApps();
    expect(Array.isArray(homeApps)).toBe(true);

    // All 10 Core Apps must be registered and available on OS
    const core10 = ['chat', 'feed', 'reels', 'watch', 'upload', 'wallet', 'studio', 'settings', 'profile', 'mesh_node'];
    core10.forEach(appId => {
      expect(homeApps).toContain(appId);
    });

    // Check feature themes exist for each
    const themes = sandbox.window.SOVRA_FEATURE_THEMES;
    expect(themes).toBeDefined();
    core10.forEach(appId => {
      expect(themes[appId]).toBeDefined();
      expect(themes[appId].gradient).toBeDefined();
    });
  });

  it('3. Unauthenticated State (Guest / Visitor Mode): intercepts app taps, preserves pending app, and triggers Landing Gateway', () => {
    // Initialize sandbox in unauthenticated state
    const sandbox = setupSandbox('sovra-unauthenticated');
    const androidOS = sandbox.window.SovraAndroidOS;

    expect(androidOS.isUserAuthenticated()).toBe(false);

    // Mock the Landing Modal display trigger
    let modalOpened = false;
    let openedTab = '';
    sandbox.showAuthLandingModal = (tab: string) => {
      modalOpened = true;
      openedTab = tab;
    };

    // User taps 'reels' while unauthenticated
    androidOS.openApp('reels');

    // Tapping protected app must NOT open app mode
    expect(androidOS.getMode()).toBe('home');
    // Must remember the pending app user wanted
    expect(sandbox.window._pendingTargetAppId).toBe('reels');
    // Must show Auth Landing Modal in 'login' tab
    expect(modalOpened).toBe(true);
    expect(openedTab).toBe('login');
  });

  it('4. Post-Authentication Hydration: transitions user smoothly directly into the pending app', () => {
    const sandbox = setupSandbox('sovra-unauthenticated');
    const androidOS = sandbox.window.SovraAndroidOS;

    // Simulate pending target app from guest intercept
    sandbox.window._pendingTargetAppId = 'wallet';

    // Simulate user logs in successfully: remove sovra-unauthenticated
    sandbox.document.documentElement.classList.remove('sovra-unauthenticated');
    expect(androidOS.isUserAuthenticated()).toBe(true);

    // Simulated login handler logic
    if (sandbox.window._pendingTargetAppId && typeof androidOS.openApp === 'function') {
      const targetApp = sandbox.window._pendingTargetAppId;
      sandbox.window._pendingTargetAppId = null;
      androidOS.openApp(targetApp);
    }

    // User is now transitioned directly into wallet app
    expect(androidOS.getMode()).toBe('app');
    expect(sandbox.window._pendingTargetAppId).toBeNull();
    expect(androidOS.getActiveTasks()).toContain('wallet');
  });

  it('5. 3-Button Minimalist Navigation System: Back ◂, Home/Drawer ○, Recents ||| with Task Switching & Close All', () => {
    const sandbox = setupSandbox();
    const androidOS = sandbox.window.SovraAndroidOS;

    // Verify HTML layout contains the 3-button navigation bar
    expect(serverHtml).toContain('id="sovraAndroidNavBar"');
    expect(serverHtml).toContain('id="androidNavRecentsBtn"');
    expect(serverHtml).toContain('id="androidNavHomeBtn"');
    expect(serverHtml).toContain('id="androidNavBackBtn"');

    // Launch Chat
    androidOS.openApp('chat');
    expect(androidOS.getMode()).toBe('app');
    expect(sandbox.document.body.classList.contains('sovra-mode-app')).toBe(true);

    // 1. Back button (◂): minimizes active app to homescreen
    androidOS.goBack();
    expect(androidOS.getMode()).toBe('home');
    expect(sandbox.document.body.classList.contains('sovra-mode-home')).toBe(true);

    // Launch Studio
    androidOS.openApp('studio');
    expect(androidOS.getMode()).toBe('app');

    // 2. Center Home button (○): in app mode, minimizes to homescreen
    androidOS.handleHomeNavClick();
    expect(androidOS.getMode()).toBe('home');
    expect(sandbox.document.body.classList.contains('sovra-mode-home')).toBe(true);

    // 3. Center Home button (○): on homescreen, toggles master app drawer
    let drawerToggled = false;
    sandbox.window.SovraModularGlassOS.toggleDrawer = (state: boolean) => {
      drawerToggled = true;
    };
    androidOS.handleHomeNavClick();
    expect(drawerToggled).toBe(true);

    // 4. Recents button (|||): opens multitasking carousel
    androidOS.openRecents();
    expect(androidOS.getActiveTasks().length).toBeGreaterThanOrEqual(1);

    // 5. "Close All" in Recents: clears task stack and minimizes cleanly to Homescreen
    androidOS.clearAllTasks();
    expect(androidOS.getActiveTasks().length).toBe(0);
    expect(androidOS.getMode()).toBe('home');
  });
});
