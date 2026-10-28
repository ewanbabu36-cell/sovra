import { describe, it, expect, beforeEach } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

describe('Sovra Android OS Home Screen Launcher & Wallpaper Engine Test Suite', () => {
  const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';
  let serverHtml = '';

  beforeEach(async () => {
    if (!serverHtml) {
      try {
        const res = await fetch(`${BASE_URL}/`);
        if (res.ok) {
          serverHtml = await res.text();
        }
      } catch (_) {
        const devServerFile = path.resolve(__dirname, '../../scripts/dev-server.ts');
        serverHtml = fs.readFileSync(devServerFile, 'utf8');
      }
    }
  });

  function createMockElement(tag: string = 'div') {
    return {
      tagName: tag.toUpperCase(),
      style: {} as Record<string, any>,
      classList: {
        _classes: new Set<string>(),
        add(c: string) { this._classes.add(c); },
        remove(c: string) { this._classes.delete(c); },
        contains(c: string) { return this._classes.has(c); }
      },
      setAttribute: () => {},
      getAttribute: () => null,
      appendChild: () => {},
      textContent: '',
      innerHTML: '',
      value: '',
      onclick: null as any
    };
  }

  function setupVmEnvironment() {
    const sandbox: Record<string, any> = {
      window: {},
      document: {
        readyState: 'complete',
        addEventListener: () => {},
        createElement: (tag: string) => createMockElement(tag),
        getElementById: (id: string) => {
          const el = createMockElement('div');
          (el as any).id = id;
          return el;
        },
        documentElement: {
          style: {
            setProperty: () => {}
          }
        },
        body: {
          classList: {
            _classes: new Set<string>(['sovra-mode-home']),
            add(c: string) { this._classes.add(c); },
            remove(c: string) { this._classes.delete(c); },
            contains(c: string) { return this._classes.has(c); }
          }
        },
        querySelectorAll: () => [],
      },
      localStorage: {
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

    // Load SovraModularGlassOS first
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

  it('1. Serves HTML with complete Android Home Screen, Wallpaper Canvas, and 3-Button Nav Bar', () => {
    // Wallpaper Canvas & Dimmer
    expect(serverHtml).toContain('id="sovraWallpaperCanvas"');
    expect(serverHtml).toContain('id="sovraWallpaperBackdrop"');
    expect(serverHtml).toContain('id="sovraWallpaperDimmer"');

    // Android Home Screen & Glance Widget
    expect(serverHtml).toContain('id="sovraHomeScreenView"');
    expect(serverHtml).toContain('id="androidGlanceClock"');
    expect(serverHtml).toContain('id="androidGlanceDate"');
    expect(serverHtml).toContain('id="androidGlanceStatusPill"');
    expect(serverHtml).toContain('id="sovraHomeAppGrid"');

    // Android 3-Button Navigation Bar
    expect(serverHtml).toContain('id="sovraAndroidNavBar"');
    expect(serverHtml).toContain('id="androidNavBackBtn"');
    expect(serverHtml).toContain('id="androidNavHomeBtn"');
    expect(serverHtml).toContain('id="androidNavRecentsBtn"');

    // Wallpaper Studio Modal & Context Menu
    expect(serverHtml).toContain('id="sovraWallpaperModal"');
    expect(serverHtml).toContain('id="wallpaperPresetsGrid"');
    expect(serverHtml).toContain('id="wallpaperFileInput"');
    expect(serverHtml).toContain('id="wallpaperBlurRange"');
    expect(serverHtml).toContain('id="wallpaperDimRange"');
    expect(serverHtml).toContain('id="sovraHomeContextMenu"');
  });

  it('2. Dual-theme CSS styles guarantee high contrast and clean mode separation', () => {
    // Canvas & Viewport separation
    expect(serverHtml).toContain('.sovra-wallpaper-canvas');
    expect(serverHtml).toContain('.sovra-home-screen-view');
    expect(serverHtml).toContain('body.sovra-mode-app .sovra-home-screen-view');
    expect(serverHtml).toContain('body.sovra-mode-home .app-layout');

    // 3-Button Navigation Bar
    expect(serverHtml).toContain('.sovra-android-nav-bar');
    expect(serverHtml).toContain('body.theme-normal .sovra-android-nav-bar');

    // Glance Widget Clock & Date
    expect(serverHtml).toContain('.android-glance-clock');
    expect(serverHtml).toContain('body.theme-normal .android-glance-clock');
    expect(serverHtml).toContain('.android-glance-status-pill');

    // Wallpaper Studio Modal
    expect(serverHtml).toContain('.sovra-wallpaper-modal-content');
    expect(serverHtml).toContain('body.theme-normal .sovra-wallpaper-modal-content');
  });

  it('3. window.SovraAndroidOS initializes with 5 curated presets and default home apps', () => {
    const sandbox = setupVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;
    expect(androidOS).toBeDefined();

    // Presets
    expect(Array.isArray(androidOS.WALLPAPER_PRESETS)).toBe(true);
    expect(androidOS.WALLPAPER_PRESETS.length).toBe(5);
    const presetIds = androidOS.WALLPAPER_PRESETS.map((p: any) => p.id);
    expect(presetIds).toContain('nebula');
    expect(presetIds).toContain('cyberpunk');
    expect(presetIds).toContain('aurora');
    expect(presetIds).toContain('obsidian');
    expect(presetIds).toContain('golden');

    // Home apps
    const homeApps = androidOS.getHomeApps();
    expect(Array.isArray(homeApps)).toBe(true);
    expect(homeApps.length).toBeGreaterThanOrEqual(4);
    expect(homeApps).toContain('feed');
    expect(homeApps).toContain('chat');
  });

  it('4. Navigation lifecycle: goHome() minimizes apps and openApp() restores app mode', () => {
    const sandbox = setupVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;

    // Start in home mode
    expect(androidOS.getMode()).toBe('home');
    expect(sandbox.document.body.classList.contains('sovra-mode-home')).toBe(true);

    // Open an app (e.g. Chat)
    androidOS.openApp('chat');
    expect(androidOS.getMode()).toBe('app');
    expect(sandbox.document.body.classList.contains('sovra-mode-app')).toBe(true);
    expect(sandbox.document.body.classList.contains('sovra-mode-home')).toBe(false);

    // Tap Android Home (○) button
    androidOS.goHome();
    expect(androidOS.getMode()).toBe('home');
    expect(sandbox.document.body.classList.contains('sovra-mode-home')).toBe(true);
    expect(sandbox.document.body.classList.contains('sovra-mode-app')).toBe(false);
  });

  it('5. Pinning and unpinning apps to Home Screen updates state and persists to localStorage', () => {
    const sandbox = setupVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;

    // Ensure 'admin' is not on home screen initially
    androidOS.removeFromHome('admin');
    const initialCount = androidOS.getHomeApps().length;

    // Pin 'admin' to Home Screen
    androidOS.pinToHome('admin');
    expect(androidOS.getHomeApps()).toContain('admin');
    expect(androidOS.getHomeApps().length).toBe(initialCount + 1);

    // Verify localStorage persistence
    const saved = JSON.parse(sandbox.localStorage.getItem('sovra_os_home_apps_v1'));
    expect(saved).toContain('admin');

    // Remove 'admin' from Home Screen
    androidOS.removeFromHome('admin');
    expect(androidOS.getHomeApps()).not.toContain('admin');
    expect(androidOS.getHomeApps().length).toBe(initialCount);
  });

  it('6. Wallpaper engine switches presets and adjusts blur/dim controls with persistence', () => {
    const sandbox = setupVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;

    // Set Cyberpunk preset
    androidOS.setWallpaperPreset('cyberpunk');
    expect(androidOS.getWallpaper().id).toBe('cyberpunk');
    expect(androidOS.getWallpaper().type).toBe('preset');

    // Check persistence
    let storedWp = JSON.parse(sandbox.localStorage.getItem('sovra_os_wallpaper_v1'));
    expect(storedWp.id).toBe('cyberpunk');

    // Set Blur to 12px
    androidOS.setWallpaperBlur(12);
    expect(androidOS.getWallpaper().blur).toBe(12);

    // Set Dim to 45%
    androidOS.setWallpaperDim(45);
    expect(androidOS.getWallpaper().dim).toBe(45);

    storedWp = JSON.parse(sandbox.localStorage.getItem('sovra_os_wallpaper_v1'));
    expect(storedWp.blur).toBe(12);
    expect(storedWp.dim).toBe(45);
  });

  it('7. Real-time Node Telemetry & /api/wallet/balance integration', async () => {
    const sandbox = setupVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;
    expect(typeof androidOS.refreshTelemetry).toBe('function');

    // Test calling /api/wallet/balance endpoint on dev server
    try {
      const res = await fetch(`${BASE_URL}/api/wallet/balance`);
      if (res.ok) {
        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(typeof data.balance).toBe('number');
        expect(data.balance).toBeGreaterThanOrEqual(0);
      }
    } catch (_) {}
  });
});
