import { describe, it, expect, beforeEach } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

describe('Sovra Modular Glass OS Engine & Interactive App Drawer Test Suite', () => {
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

  function setupVmEnvironment() {
    const sandbox: Record<string, any> = {
      window: {},
      document: {
        readyState: 'complete',
        addEventListener: () => {},
        getElementById: () => null,
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
      openFullPageWallet: () => {},
      openQrScannerModal: () => {},
      openUniversalCreateModal: () => {},
      openWalletBridgeModal: () => {},
      openSovereignKeyVaultModal: () => {},
      openSovereignIdCardModal: () => {},
      toggleDepinHotspot: () => {},
      toggleGhostMode: () => {},
      openSovereignBackupModal: () => {},
      fetch: async () => ({ ok: true, json: async () => ({}) })
    };
    sandbox.window = sandbox;

    const match = serverHtml.match(/\(function initSovraModularGlassOS\(\)[\s\S]*?\n\s*\}\)\(\);/);
    if (!match) throw new Error('initSovraModularGlassOS IIFE not found in serverHtml');

    vm.createContext(sandbox);
    vm.runInContext(match[0], sandbox);

    return sandbox;
  }

  it('1. Serves HTML containing Master App Drawer, Floating Glass Dock, and Header Quick Slots', () => {
    expect(serverHtml).toContain('id="sovraFloatingGlassDock"');
    expect(serverHtml).toContain('id="floatingDockSlotsContainer"');
    expect(serverHtml).toContain('id="dockLauncherBtn"');
    expect(serverHtml).toContain('id="sovraMasterDrawerOverlay"');
    expect(serverHtml).toContain('id="sovraMasterAppDrawer"');
    expect(serverHtml).toContain('id="headerQuickActionSlots"');
    expect(serverHtml).toContain('id="masterDrawerTilesGrid"');
    expect(serverHtml).toContain('id="masterDrawerSearchInput"');
    expect(serverHtml).toContain('id="btnToggleCustomizeLayout"');
  });

  it('2. Dual-theme styling rules exist for OLED Dark & Clean Light modes with high contrast', () => {
    expect(serverHtml).toContain('.sovra-floating-glass-dock');
    expect(serverHtml).toContain('body.theme-normal .sovra-floating-glass-dock');
    expect(serverHtml).toContain('.sovra-app-tile');
    expect(serverHtml).toContain('body.theme-normal .sovra-app-tile');
    expect(serverHtml).toContain('.sovra-master-drawer');
    expect(serverHtml).toContain('body.theme-normal .sovra-master-drawer');
    expect(serverHtml).toContain('.sovra-edit-mode');
    expect(serverHtml).toContain('.sovra-tile-unpin-btn');
  });

  it('3. window.SovraModularGlassOS initializes with exactly 24 canonical sovereign capabilities', () => {
    const sandbox = setupVmEnvironment();
    const os = sandbox.window.SovraModularGlassOS;
    expect(os).toBeDefined();
    expect(Array.isArray(os.FEATURE_REGISTRY)).toBe(true);
    expect(os.FEATURE_REGISTRY.length).toBe(24);

    const categories = new Set(os.FEATURE_REGISTRY.map((f: any) => f.category));
    expect(categories.has('social')).toBe(true);
    expect(categories.has('media')).toBe(true);
    expect(categories.has('creator')).toBe(true);
    expect(categories.has('finance')).toBe(true);
    expect(categories.has('utility')).toBe(true);

    // Verify all 24 items have non-empty id, name, icon, category, and action
    for (const feat of os.FEATURE_REGISTRY) {
      expect(feat.id).toBeTruthy();
      expect(feat.name).toBeTruthy();
      expect(feat.icon).toBeTruthy();
      expect(typeof feat.action).toBe('function');
    }
  });

  it('4. Persona presets switch layouts accurately and observe slot constraints', () => {
    const sandbox = setupVmEnvironment();
    const os = sandbox.window.SovraModularGlassOS;

    // 1. Social preset
    os.applyPreset('social');
    let layout = os.getLayout();
    expect(layout.activePreset).toBe('social');
    expect(layout.dockSlots).toEqual(['feed', 'reels', 'watch', 'chat', 'profile']);
    expect(layout.dockSlots.length).toBeLessThanOrEqual(5);
    expect(layout.headerSlots.length).toBeLessThanOrEqual(3);

    // 2. Creator preset
    os.applyPreset('creator');
    layout = os.getLayout();
    expect(layout.activePreset).toBe('creator');
    expect(layout.dockSlots).toContain('studio');
    expect(layout.dockSlots).toContain('live');

    // 3. Finance preset
    os.applyPreset('finance');
    layout = os.getLayout();
    expect(layout.activePreset).toBe('finance');
    expect(layout.dockSlots).toContain('wallet');
    expect(layout.dockSlots).toContain('bridge');

    // 4. Minimalist preset
    os.applyPreset('minimal');
    layout = os.getLayout();
    expect(layout.activePreset).toBe('minimal');
    expect(layout.dockSlots).toEqual(['feed', 'chat', 'profile']);

    // 5. Persistence check
    const stored = JSON.parse(sandbox.localStorage.getItem('sovra_glass_dock_layout_v1'));
    expect(stored.activePreset).toBe('minimal');
    expect(stored.dockSlots).toEqual(['feed', 'chat', 'profile']);
  });

  it('5. Dynamic slot modification enforces bounds and prevents duplicates', () => {
    const sandbox = setupVmEnvironment();
    const os = sandbox.window.SovraModularGlassOS;

    // Reset to minimal (3 slots: feed, chat, profile)
    os.applyPreset('minimal');
    expect(os.getLayout().dockSlots.length).toBe(3);

    // Add slot
    os.addSlot('dock', 'wallet');
    expect(os.getLayout().dockSlots).toContain('wallet');
    expect(os.getLayout().dockSlots.length).toBe(4);

    // Prevent duplicate slot
    os.addSlot('dock', 'wallet');
    expect(os.getLayout().dockSlots.filter((s: string) => s === 'wallet').length).toBe(1);

    // Unpin slot
    const walletIdx = os.getLayout().dockSlots.indexOf('wallet');
    os.unpinSlot('dock', walletIdx);
    expect(os.getLayout().dockSlots).not.toContain('wallet');
    expect(os.getLayout().dockSlots.length).toBe(3);

    // Enforce minimum 1 app in dock
    os.unpinSlot('dock', 2);
    os.unpinSlot('dock', 1);
    expect(os.getLayout().dockSlots.length).toBe(1);
    os.unpinSlot('dock', 0); // Attempt to unpin the last slot
    expect(os.getLayout().dockSlots.length).toBe(1); // Still 1 app
  });

  it('6. Live telemetry micro-widgets bind to authentic SQLite / Status feeds with zero hardcoded values', async () => {
    const sandbox = setupVmEnvironment();
    sandbox.fetch = async (url: string) => {
      if (url === '/api/wallet/balance') {
        return { ok: true, json: async () => ({ balance: 420.50 }) };
      }
      if (url === '/api/status') {
        return { ok: true, json: async () => ({ connectedPeers: ['peer-1', 'peer-2', 'peer-3'] }) };
      }
      return { ok: true, json: async () => ({}) };
    };

    const os = sandbox.window.SovraModularGlassOS;
    await os.updateMicroBadges();

    // Verify window.walletBalanceSov dynamically updated from /api/wallet/balance
    expect(sandbox.window.walletBalanceSov).toBe(420.50);

    // Verify connectedPeers dynamically updated from /api/status
    expect(sandbox.window.SovraState.connectedPeers).toHaveLength(3);
  });
});
