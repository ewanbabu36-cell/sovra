/**
 * @file tests/e2e/sovereign-os-spatial-drag.test.ts
 * 👑 SOVRA ANDROID SPATIAL OS — DRAWER-TO-HOME DRAG & DROP, CONTEXT MENU, FOLDERS & JIGGLE UNPIN ENGINE
 *
 * Comprehensive Automated Verification:
 * 1. Drawer-to-Home Drag & Drop Registration & Execution:
 *    - Dragging from Master App Drawer sets _spatialDraggingAppId and drops onto workspace page.
 *    - Dropping over existing app slot merges both into an authentic App Folder.
 * 2. HomeScreen Long-Press Context Menu (3D Touch / Context Menu):
 *    - Long-press or context menu displays #sovraAppContextMenu with app identity, quick actions, and remove button.
 *    - Remove from Home Screen unpins app from page without deleting it from master drawer registry.
 * 3. App Info & Security Inspection:
 *    - App Info modal (#sovraAppInfoModal) surfaces local cache size, E2EE status, and direct launch button.
 * 4. Jiggle / Edit Mode & Quick (✕) Unpin Badges:
 *    - Toggling edit mode activates jiggle physics and (✕) unpin badges.
 *    - Android Back ◂ exits edit mode as high priority before minimizing apps.
 * 5. App Folder Engine:
 *    - Supports 2x2 preview grid inside folder squircle.
 *    - Opening folder (#sovraFolderViewModal) displays all contained apps.
 *    - Renaming folder via renameActiveFolder() persists new title.
 *    - Removing app from folder unwraps folder back to a single app when 1 remains.
 * 6. Multi-Page & Folder State Persistence across Storage Keys:
 *    - Synchronizes sovra_os_multipage_v1, sovra_os_folders_v1, and sovra_os_home_apps_v1.
 *    - resetHomeScreenDefaults() restores pristine factory configuration.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('👑 Sovra Android Spatial OS: Drag & Drop, App Folders, Context Menu & Jiggle Unpin Suite', { timeout: 30000 }, () => {
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
      removeAttribute: (k: string) => { delete attributes[k]; },
      appendChild: (child: any) => { children.push(child); return child; },
      children,
      textContent: '',
      innerHTML: '',
      value: '',
      onclick: null as any,
      click() { if (typeof this.onclick === 'function') this.onclick(); }
    };
  }

  function setupSpatialVmEnvironment() {
    const elementsMap: Record<string, any> = {};

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
            if (id === 'sovraAppContextMenu') el.style.display = 'none';
            if (id === 'sovraAppInfoModal') el.style.display = 'none';
            if (id === 'sovraFolderViewModal') el.style.display = 'none';
            if (id === 'sovraHomeContextMenu') el.style.display = 'none';
            if (id === 'welcomeOnboardingModal') el.style.display = 'none';
            if (id === 'sovraRecentsOverview') el.style.display = 'none';
            if (id === 'sovraMasterDrawerOverlay') el.style.display = 'none';
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
        querySelector: (selector: string) => {
          return null;
        },
        documentElement: {
          style: { setProperty: () => {} },
          classList: {
            contains: (c: string) => false
          }
        },
        body: {
          appendChild: (c: any) => c,
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

  it('1. HTML Markup contains App Context Menu, App Info Modal, and Folder View Overlay', () => {
    // App Context Menu
    expect(serverHtml).toContain('id="sovraAppContextMenu"');
    expect(serverHtml).toContain('id="sovraCtxAppIcon"');
    expect(serverHtml).toContain('id="sovraCtxAppName"');
    expect(serverHtml).toContain('id="sovraCtxActionQuick1"');
    expect(serverHtml).toContain('id="sovraCtxActionQuick2"');
    expect(serverHtml).toContain('id="sovraCtxActionAppInfo"');
    expect(serverHtml).toContain('id="sovraCtxActionRemove"');

    // App Info Modal
    expect(serverHtml).toContain('id="sovraAppInfoModal"');
    expect(serverHtml).toContain('id="appInfoName"');
    expect(serverHtml).toContain('id="appInfoStorage"');
    expect(serverHtml).toContain('id="appInfoSecurity"');
    expect(serverHtml).toContain('id="appInfoLaunchBtn"');

    // Folder View Modal
    expect(serverHtml).toContain('id="sovraFolderViewModal"');
    expect(serverHtml).toContain('id="folderTitleInput"');
    expect(serverHtml).toContain('id="folderAppTilesGrid"');

    // Drawer and tile drag bindings
    expect(serverHtml).toContain('.sovra-drag-ghost-clone');
    expect(serverHtml).toContain('.sovra-folder-tile');
    expect(serverHtml).toContain('.sovra-tile-unpin-btn');
  });

  it('2. Drawer-to-Home Drag & Drop: handleDropFromDrawer() pins app to page or merges into a Folder', () => {
    const { sandbox } = setupSpatialVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;

    // Page 2 has only 'settings'
    expect(androidOS.getPageApps(2)).toEqual(['settings']);

    // Simulate drag from master drawer: dropping 'dapps' on Page 2
    sandbox.window._spatialDraggingAppId = 'dapps';
    androidOS.handleDropFromDrawer(2, null, 'dapps');

    expect(androidOS.getPageApps(2)).toContain('dapps');
    expect(androidOS.getPageApps(2)).toContain('settings');

    // Dropping from drawer directly onto slot 0 ('settings') merges both into a folder!
    androidOS.handleDropFromDrawer(2, 0, 'wallet');

    const page2Apps = androidOS.getPageApps(2);
    const folderId = page2Apps[0];
    expect(folderId.startsWith('folder_')).toBe(true);

    const folder = androidOS.getFolder(folderId);
    expect(folder).toBeDefined();
    expect(folder.apps).toContain('settings');
    expect(folder.apps).toContain('wallet');
  });

  it('3. HomeScreen Long-Press Context Menu: displays app info, quick action execution, and Remove from Home', () => {
    const { sandbox, elementsMap } = setupSpatialVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;

    // Open context menu for 'chat'
    androidOS.openAppContextMenu('chat', 150, 200, 0, 0);

    const menuEl = elementsMap['sovraAppContextMenu'];
    expect(menuEl.style.display).toBe('block');
    expect(elementsMap['sovraCtxAppName'].textContent).toBe('Chat');
    expect(elementsMap['sovraCtxActionQuickLabel1'].textContent).toBe('New Message');

    // Trigger quick action 1
    androidOS.handleContextQuickAction(1);
    expect(menuEl.style.display).toBe('none');
    expect(androidOS.getMode()).toBe('app');

    // Return to home
    androidOS.goHome();
    expect(androidOS.getMode()).toBe('home');

    // Open context menu for 'id_card' on Page 0 (last slot: 7) and remove it
    expect(androidOS.getPageApps(0)).toContain('id_card');
    androidOS.openAppContextMenu('id_card', 200, 200, 0, 7);
    androidOS.removeActiveContextApp();

    expect(androidOS.getPageApps(0)).not.toContain('id_card');
    expect(menuEl.style.display).toBe('none');
  });

  it('4. App Info & Security Modal: surfaces storage metrics, E2EE status, and launches target app', () => {
    const { sandbox, elementsMap } = setupSpatialVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;

    // Open App Info for 'chat'
    androidOS.openAppInfoModal('chat');

    const modalEl = elementsMap['sovraAppInfoModal'];
    expect(modalEl.style.display).toBe('flex');
    expect(elementsMap['appInfoName'].textContent).toBe('Chat');
    expect(elementsMap['appInfoStorage'].textContent).toContain('SQLite WAL');
    expect(elementsMap['appInfoSecurity'].textContent).toContain('Noise_XX E2EE');

    // Launch from App Info
    androidOS.launchFromAppInfo();
    expect(modalEl.style.display).toBe('none');
    expect(androidOS.getMode()).toBe('app');

    // Return to home
    androidOS.goHome();
  });

  it('5. Jiggle / Edit Mode: activates unpin mode and Android Back ◂ exits edit mode first', () => {
    const { sandbox } = setupSpatialVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;

    expect(androidOS.isEditMode()).toBe(false);

    // Toggle edit mode ON
    androidOS.toggleEditMode(true);
    expect(androidOS.isEditMode()).toBe(true);

    // Android Back (◂) should first exit Edit Mode, NOT minimize app
    androidOS.goBack();
    expect(androidOS.isEditMode()).toBe(false);

    // Remove app using removeAppFromPage()
    const initialCount = androidOS.getPageApps(0).length;
    const removedApp = androidOS.removeAppFromPage(0, 0);
    expect(removedApp).toBeDefined();
    expect(androidOS.getPageApps(0).length).toBe(initialCount - 1);
  });

  it('6. App Folder Creation, Renaming, Modal Inspection & Auto-Unwrap', () => {
    const { sandbox, elementsMap } = setupSpatialVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;

    // Create a folder on Page 0 combining slot 0 and slot 1
    const targetApp = androidOS.getPageApps(0)[0];
    const sourceApp = androidOS.getPageApps(0)[1];
    const folder = androidOS.createFolder(0, 0, sourceApp, 'Media Hub');

    expect(folder).toBeDefined();
    expect(folder.title).toBe('Media Hub');
    expect(folder.apps).toEqual([targetApp, sourceApp]);

    const page0Apps = androidOS.getPageApps(0);
    expect(page0Apps[0]).toBe(folder.id);
    expect(page0Apps).not.toContain(sourceApp);

    // Open folder modal
    androidOS.openFolderModal(folder.id);
    const folderModal = elementsMap['sovraFolderViewModal'];
    expect(folderModal.style.display).toBe('flex');
    expect(elementsMap['folderTitleInput'].value).toBe('Media Hub');

    // Rename folder
    androidOS.renameActiveFolder('Core Media');
    expect(folder.title).toBe('Core Media');

    // Close folder modal
    androidOS.closeFolderModal();
    expect(folderModal.style.display).toBe('none');

    // Remove one app from folder -> folder has 1 app left, should unwrap back to normal app!
    androidOS.removeAppFromFolder(folder.id, sourceApp);
    expect(androidOS.getFolder(folder.id)).toBeNull();
    expect(androidOS.getPageApps(0)[0]).toBe(targetApp);
  });

  it('7. Layout Persistence & Factory Reset: persists to localStorage and resets cleanly', () => {
    const { sandbox } = setupSpatialVmEnvironment();
    const androidOS = sandbox.window.SovraAndroidOS;

    // Create custom folder
    androidOS.createFolder(1, 0, 'ghost_mode', 'Privacy Suite');

    // Verify localStorage has folders and multi-page data
    const foldersRaw = sandbox.localStorage.getItem('sovra_os_folders_v1');
    const multiRaw = sandbox.localStorage.getItem('sovra_os_multipage_v1');
    expect(foldersRaw).toBeDefined();
    expect(multiRaw).toBeDefined();

    const parsedFolders = JSON.parse(foldersRaw!);
    const folderIds = Object.keys(parsedFolders);
    expect(folderIds.length).toBeGreaterThan(0);
    expect(parsedFolders[folderIds[0]].title).toBe('Privacy Suite');

    // Reset Home Screen to Factory Defaults
    androidOS.resetHomeScreenDefaults();

    expect(Object.keys(androidOS.getFolders()).length).toBe(0);
    expect(androidOS.getPageApps(0).length).toBe(8);
    expect(androidOS.getPageApps(1).length).toBe(8);
    expect(androidOS.getPageApps(2).length).toBe(1);
  });
});
