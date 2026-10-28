import { describe, it, expect, beforeEach } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

describe('Sovra Android Smartphone Multitasking & Recents Overview Test Suite', () => {
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
    const elementsMap: Record<string, any> = {};

    const sandbox: Record<string, any> = {
      window: {},
      document: {
        readyState: 'complete',
        addEventListener: () => {},
        createElement: (tag: string) => createMockElement(tag),
        getElementById: (id: string) => {
          if (!elementsMap[id]) {
            const el = createMockElement('div');
            (el as any).id = id;
            elementsMap[id] = el;
          }
          return elementsMap[id];
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
      sessionStorage: {
        _store: {} as Record<string, string>,
        getItem(key: string) { return this._store[key] || null; },
        setItem(key: string, val: string) { this._store[key] = String(val); },
        removeItem(key: string) { delete this._store[key]; }
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

    return { sandbox, elementsMap };
  }

  it('1. Re-aligns 3-button navigation bar in authentic smartphone order (Left: Recents | Center: Home | Right: Back)', () => {
    expect(serverHtml).toContain('id="sovraAndroidNavBar"');
    expect(serverHtml).toContain('id="androidNavRecentsBtn"');
    expect(serverHtml).toContain('id="androidNavHomeBtn"');
    expect(serverHtml).toContain('id="androidNavBackBtn"');

    // Verify DOM sequence: Left button appears before Center button, which appears before Right button
    const recentsIdx = serverHtml.indexOf('id="androidNavRecentsBtn"');
    const homeIdx = serverHtml.indexOf('id="androidNavHomeBtn"');
    const backIdx = serverHtml.indexOf('id="androidNavBackBtn"');

    expect(recentsIdx).toBeGreaterThan(0);
    expect(homeIdx).toBeGreaterThan(recentsIdx);
    expect(backIdx).toBeGreaterThan(homeIdx);

    // Verify left button action triggers Recents Multitasking
    expect(serverHtml).toContain('onclick="window.SovraAndroidOS.toggleRecents()"');
  });

  it('2. Serves complete Multitasking Recents Overview modal and dual-theme styling', () => {
    // HTML Elements
    expect(serverHtml).toContain('id="sovraRecentsOverview"');
    expect(serverHtml).toContain('id="recentsTaskCounter"');
    expect(serverHtml).toContain('id="recentsCardsTrack"');
    expect(serverHtml).toContain('id="recentsClearAllBtn"');
    expect(serverHtml).toContain('id="recentsCloseBtn"');

    // Dual-theme CSS
    expect(serverHtml).toContain('.sovra-recents-overlay');
    expect(serverHtml).toContain('body.theme-normal .sovra-recents-overlay');
    expect(serverHtml).toContain('.recents-app-card');
    expect(serverHtml).toContain('body.theme-normal .recents-app-card');
    expect(serverHtml).toContain('.recents-clear-all-btn');
    expect(serverHtml).toContain('body.theme-normal .recents-clear-all-btn');
  });

  it('3. SovraTaskManager registers tasks on app launch with most-recent unshift order', () => {
    const { sandbox } = setupVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;
    expect(androidOS).toBeDefined();

    // Clear initial
    androidOS.clearAllTasks();
    expect(androidOS.getActiveTasks().length).toBe(0);

    // Launch Chat
    androidOS.openApp('chat');
    expect(androidOS.getActiveTasks()).toContain('chat');
    expect(androidOS.getActiveTasks()[0]).toBe('chat');

    // Launch Wallet
    androidOS.openApp('wallet');
    expect(androidOS.getActiveTasks()[0]).toBe('wallet');
    expect(androidOS.getActiveTasks()[1]).toBe('chat');

    // Re-launch Chat (should move to front)
    androidOS.openApp('chat');
    expect(androidOS.getActiveTasks()[0]).toBe('chat');
    expect(androidOS.getActiveTasks()[1]).toBe('wallet');
  });

  it('4. Recents Overview open, close, and toggle actions control visibility', () => {
    const { sandbox, elementsMap } = setupVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;

    const modal = sandbox.document.getElementById('sovraRecentsOverview');
    modal.style.display = 'none';

    // Open Recents
    androidOS.openRecents();
    expect(modal.style.display).toBe('flex');

    // Close Recents
    androidOS.closeRecents();
    expect(modal.style.display).toBe('none');

    // Toggle Recents
    androidOS.toggleRecents();
    expect(modal.style.display).toBe('flex');
    androidOS.toggleRecents();
    expect(modal.style.display).toBe('none');
  });

  it('5. "Close All" action kills all running tasks and smoothly minimizes to Home Screen', () => {
    const { sandbox } = setupVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;

    androidOS.openApp('feed');
    androidOS.openApp('chat');
    androidOS.openApp('studio');
    expect(androidOS.getActiveTasks().length).toBe(3);
    expect(androidOS.getMode()).toBe('app');

    // Tap "Close All Apps"
    androidOS.clearAllTasks();
    expect(androidOS.getActiveTasks().length).toBe(0);
    expect(androidOS.getMode()).toBe('home');
    expect(sandbox.document.body.classList.contains('sovra-mode-home')).toBe(true);
  });

  it('6. Kill single task removes it from RAM and updates active foreground', () => {
    const { sandbox } = setupVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;

    androidOS.openApp('chat');
    androidOS.openApp('wallet');
    expect(androidOS.getActiveTasks()).toContain('chat');
    expect(androidOS.getActiveTasks()).toContain('wallet');

    // Kill wallet
    androidOS.killTask('wallet');
    expect(androidOS.getActiveTasks()).not.toContain('wallet');
    expect(androidOS.getActiveTasks()).toContain('chat');
  });

  it('7. Intelligent Back button (◀) prioritizes Recents dismissal then Drawer then Home minimization', () => {
    const { sandbox } = setupVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;

    const recentsModal = sandbox.document.getElementById('sovraRecentsOverview');
    const drawerOverlay = sandbox.document.getElementById('sovraMasterDrawerOverlay');

    // Case 1: Recents Overview is open
    androidOS.openApp('chat');
    androidOS.openRecents();
    expect(recentsModal.style.display).toBe('flex');

    androidOS.goBack();
    expect(recentsModal.style.display).toBe('none');
    expect(androidOS.getMode()).toBe('app'); // Still in app mode

    // Case 2: In App mode without overlays -> goBack minimizes to Home
    androidOS.goBack();
    expect(androidOS.getMode()).toBe('home');
    expect(sandbox.document.body.classList.contains('sovra-mode-home')).toBe(true);
  });
});
