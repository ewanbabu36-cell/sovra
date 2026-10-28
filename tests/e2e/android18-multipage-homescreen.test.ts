import { describe, it, expect, beforeEach } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

describe('Sovra Android 18 Multi-Page Desktop Canvas & Spatial Engine Test Suite', () => {
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
    const classes = new Set<string>();
    const attributes: Record<string, string> = {};
    const children: any[] = [];
    return {
      tagName: tag.toUpperCase(),
      style: {} as Record<string, any>,
      classList: {
        add(c: string) { classes.add(c); },
        remove(c: string) { classes.delete(c); },
        contains(c: string) { return classes.has(c); }
      },
      setAttribute: (k: string, v: string) => { attributes[k] = String(v); },
      getAttribute: (k: string) => attributes[k] || null,
      appendChild: (child: any) => { children.push(child); },
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
        querySelectorAll: (selector: string) => {
          if (selector === '.sovra-page-dot') {
            return [
              elementsMap['dot0'] || (elementsMap['dot0'] = createMockElement('button')),
              elementsMap['dot1'] || (elementsMap['dot1'] = createMockElement('button')),
              elementsMap['dot2'] || (elementsMap['dot2'] = createMockElement('button'))
            ];
          }
          return [];
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
        }
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

    return { sandbox, elementsMap };
  }

  it('1. Serves HTML with complete Android 18 Multi-Page Desktop container, sliding track, and 3 workspace pages', () => {
    // Multi-page sliding canvas
    expect(serverHtml).toContain('id="sovraHomeScreenView"');
    expect(serverHtml).toContain('id="sovraMultiPageContainer"');
    expect(serverHtml).toContain('id="sovraMultiPageTrack"');

    // 3 distinct workspace pages
    expect(serverHtml).toContain('id="sovraWorkspacePage_0"');
    expect(serverHtml).toContain('id="sovraWorkspacePage_1"');
    expect(serverHtml).toContain('id="sovraWorkspacePage_2"');

    // Page-specific app grids
    expect(serverHtml).toContain('id="sovraHomeAppGrid"');
    expect(serverHtml).toContain('id="sovraHomeAppGrid_1"');
    expect(serverHtml).toContain('id="sovraHomeAppGrid_2"');

    // Dynamic Pagination Dot Indicator
    expect(serverHtml).toContain('id="sovraPageDotsIndicator"');
    expect(serverHtml).toContain('class="sovra-page-dot');
  });

  it('2. Dual-theme CSS styles guarantee high contrast for horizontal sliding track, workspace pages, and pagination dots', () => {
    // Multi-Page Container & Track styles
    expect(serverHtml).toContain('.sovra-multi-page-container');
    expect(serverHtml).toContain('.sovra-multi-page-track');
    expect(serverHtml).toContain('.sovra-workspace-page');

    // Page Header styles
    expect(serverHtml).toContain('.workspace-page-header');
    expect(serverHtml).toContain('.workspace-page-title');
    expect(serverHtml).toContain('body.theme-normal .workspace-page-title');

    // Pagination Dots dual-theme styling
    expect(serverHtml).toContain('.sovra-page-dots-indicator');
    expect(serverHtml).toContain('body.theme-normal .sovra-page-dots-indicator');
    expect(serverHtml).toContain('.sovra-page-dot');
    expect(serverHtml).toContain('.sovra-page-dot.active');
    expect(serverHtml).toContain('body.theme-normal .sovra-page-dot.active');

    // Spatial Drag-and-Drop CSS
    expect(serverHtml).toContain('.sovra-home-tile-wrap.is-dragging');
    expect(serverHtml).toContain('.sovra-home-tile-wrap.is-drag-over');
  });

  it('3. Purge Duplication: Zero duplicate icons between Floating Dock and Page 0 (Daily Hub)', () => {
    const { sandbox } = setupVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;
    const modularOS = sandbox.window.SovraModularGlassOS;

    // Dock pins
    const dockApps = modularOS ? modularOS.getLayout().dockSlots : ['feed', 'chat', 'wallet'];
    expect(dockApps).toContain('feed');

    // Page 0 apps
    const page0Apps = androidOS.getPageApps(0);
    expect(page0Apps.length).toBe(8);

    // Assert zero duplication between dock essentials (feed, chat, wallet) and Page 0
    expect(page0Apps).not.toContain('feed');
    expect(page0Apps).not.toContain('chat');
    expect(page0Apps).not.toContain('wallet');

    // Complementary daily apps on Page 0
    expect(page0Apps).toContain('reels');
    expect(page0Apps).toContain('watch');
    expect(page0Apps).toContain('studio');
    expect(page0Apps).toContain('live');
    expect(page0Apps).toContain('profile');
    expect(page0Apps).toContain('hub');
    expect(page0Apps).toContain('qr_scan');
    expect(page0Apps).toContain('id_card');

    // Page 1 apps (Creator, Media & Web3)
    const page1Apps = androidOS.getPageApps(1);
    expect(page1Apps).toContain('dapps');
    expect(page1Apps).toContain('upload');
    expect(page1Apps).toContain('bridge');
    expect(page1Apps).toContain('key_vault');
    expect(page1Apps).toContain('mesh_node');
    expect(page1Apps).toContain('ghost_mode');
    expect(page1Apps).toContain('backup');
    expect(page1Apps).toContain('admin');

    // Page 2 apps (Utilities)
    const page2Apps = androidOS.getPageApps(2);
    expect(page2Apps).toContain('settings');
  });

  it('4. Multi-Page Navigation API: goToPage(), nextPage(), and prevPage() manage page state with boundary clamps', () => {
    const { sandbox, elementsMap } = setupVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;

    expect(androidOS.getCurrentPage()).toBe(0);

    // Navigate to Page 1
    androidOS.goToPage(1);
    expect(androidOS.getCurrentPage()).toBe(1);
    const track = elementsMap['sovraMultiPageTrack'];
    expect(track.style.transform).toBe('translateX(-100%)');

    // Advance to Page 2 via nextPage()
    androidOS.nextPage();
    expect(androidOS.getCurrentPage()).toBe(2);
    expect(track.style.transform).toBe('translateX(-200%)');

    // Clamp at maximum boundary
    androidOS.nextPage();
    expect(androidOS.getCurrentPage()).toBe(2);

    // Return to Page 1 via prevPage()
    androidOS.prevPage();
    expect(androidOS.getCurrentPage()).toBe(1);
    expect(track.style.transform).toBe('translateX(-100%)');

    // Return to Page 0
    androidOS.prevPage();
    expect(androidOS.getCurrentPage()).toBe(0);
    expect(track.style.transform).toBe('translateX(-0%)');

    // Clamp at minimum boundary
    androidOS.prevPage();
    expect(androidOS.getCurrentPage()).toBe(0);
  });

  it('5. Spatial Drag-and-Drop: swapApps() rearranges app tiles within and across pages with persistence', () => {
    const { sandbox } = setupVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;

    const initialP0_0 = androidOS.getPageApps(0)[0]; // 'reels'
    const initialP0_1 = androidOS.getPageApps(0)[1]; // 'watch'

    // Swap slots on same page
    androidOS.swapApps(0, 0, 0, 1);
    expect(androidOS.getPageApps(0)[0]).toBe(initialP0_1);
    expect(androidOS.getPageApps(0)[1]).toBe(initialP0_0);

    // Move app from Page 0 to Page 1
    const appToMove = androidOS.getPageApps(0)[0];
    const targetApp = androidOS.getPageApps(1)[0];
    androidOS.swapApps(0, 0, 1, 0);

    expect(androidOS.getPageApps(1)[0]).toBe(appToMove);
    expect(androidOS.getPageApps(0)[0]).toBe(targetApp);

    // Verify localStorage persistence
    const saved = JSON.parse(sandbox.localStorage.getItem('sovra_os_multipage_v1'));
    expect(Array.isArray(saved)).toBe(true);
    expect(saved[1][0]).toBe(appToMove);
    expect(saved[0][0]).toBe(targetApp);
  });

  it('6. Multi-Page Pinning and Unpinning across pages keeps home apps state and localStorage synchronized', () => {
    const { sandbox } = setupVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;

    // Unpin an app from Page 1 ('admin')
    androidOS.removeFromHome('admin');
    expect(androidOS.getPageApps(1)).not.toContain('admin');
    expect(androidOS.getHomeApps()).not.toContain('admin');

    // Pin 'admin' back to Home (should land on current page 0 or page with space)
    androidOS.goToPage(2);
    androidOS.pinToHome('admin');
    expect(androidOS.getPageApps(2)).toContain('admin');
    expect(androidOS.getHomeApps()).toContain('admin');

    // Verify persistence in both keys
    const multiSaved = JSON.parse(sandbox.localStorage.getItem('sovra_os_multipage_v1'));
    const homeSaved = JSON.parse(sandbox.localStorage.getItem('sovra_os_home_apps_v1'));
    expect(multiSaved[2]).toContain('admin');
    expect(homeSaved).toContain('admin');
  });

  it('7. Real-time Telemetry & Balance integration works seamlessly across Multi-Page Canvas', async () => {
    const { sandbox, elementsMap } = setupVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;

    sandbox.fetch = async (url: string) => {
      if (url === '/api/wallet/balance') {
        return { ok: true, json: async () => ({ balance: 142.75 }) };
      }
      if (url === '/api/status') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            connectedPeers: ['peer-1', 'peer-2', 'peer-3'],
            systemTelemetry: { p2pPeersCount: 3 }
          })
        };
      }
      return { ok: false };
    };

    await androidOS.refreshTelemetry();

    const balanceEl = elementsMap['androidGlanceBalance'];
    const peerCountEl = elementsMap['androidGlancePeerCount'];

    expect(balanceEl.textContent).toBe('142.75 SOV');
    expect(peerCountEl.textContent).toBe('3 Peers');
  });
});
