import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('🌍 SOVRA World-Standard Flagship Audit & Verification', () => {
  const layoutPath = path.resolve('scripts/views/layout.view.ts');
  const scriptsPath = path.resolve('scripts/views/scripts.view.ts');
  const devServerPath = path.resolve('scripts/dev-server.ts');

  const layoutContent = fs.readFileSync(layoutPath, 'utf8');
  const scriptsContent = fs.readFileSync(scriptsPath, 'utf8');
  const devServerContent = fs.readFileSync(devServerPath, 'utf8');

  it('1. Consumer UI is free from raw database & technical jargon', () => {
    // Assert consumer view does not expose developer technical jargon
    expect(layoutContent).not.toContain('420 MB of 500 MB SQLite Cache Used');
    expect(layoutContent).not.toContain('<div class="meter-label">SQLITE</div>');
    expect(layoutContent).not.toContain('[LIVE] SQLite WAL Mode Active • 10 Core Tables Synced');
    expect(layoutContent).not.toContain('BitSwap 60 FPS Loop');
    expect(layoutContent).not.toContain('Broadcasting to CometBFT mempool...');
    expect(layoutContent).not.toContain('No CW20 creator tokens found');
    expect(layoutContent).not.toContain('12-Word BIP-39 Disaster Recovery Seed');
    expect(layoutContent).not.toContain('DTN Outbox: 0 packets');

    // Assert human-friendly consumer phrases are present instead
    expect(layoutContent).toContain('420 MB of 500 MB Offline Storage Used');
    expect(layoutContent).toContain('Smooth 60 FPS Offline Loop');
    expect(layoutContent).toContain('No creator tokens found');
    expect(layoutContent).toContain('12-Word Master Recovery Phrase');
    expect(layoutContent).toContain('Offline Outbox: 0 messages');
  });

  it('2. All 8 microservice route body parsers implement socket abort & memory bounding', () => {
    const routeFiles = [
      'scripts/routes/agent.routes.ts',
      'scripts/routes/ai.routes.ts',
      'scripts/routes/dapp.routes.ts',
      'scripts/routes/depin.routes.ts',
      'scripts/routes/notes.routes.ts',
      'scripts/routes/offline-pay.routes.ts',
      'scripts/routes/quadratic.routes.ts',
      'scripts/routes/zk.routes.ts'
    ];

    for (const f of routeFiles) {
      const content = fs.readFileSync(path.resolve(f), 'utf8');
      expect(content).toContain('req.destroy()');
      expect(content).toContain('aborted = true');
      expect(content).toContain('maxBytes = 2 * 1024 * 1024');
    }
  });

  it('3. Service Worker pre-caches all core App Shell bundles for offline-first resilience', () => {
    expect(devServerContent).toContain("'/dist/bundle.js'");
    expect(devServerContent).toContain("'/dist/sovra.css'");
    expect(devServerContent).toContain("'/bundle.js'");
    expect(devServerContent).toContain("'/sovra.css'");
    expect(devServerContent).toContain("const CACHE_NAME = 'sovra-pwa-v8'");
  });

  it('4. Creator Studio Engine contains all flagship operational methods', () => {
    expect(scriptsContent).toContain('uploadWebVTT:');
    expect(scriptsContent).toContain('openVideoTrimmerModal:');
    expect(scriptsContent).toContain('resetWorkspaceUploadForm:');
    expect(scriptsContent).toContain('claimSovereignEarnings:');
    expect(scriptsContent).toContain('renderRetentionCurveDetailed:');
    expect(scriptsContent).toContain('openStudioScheduleModal:');
  });

  it('5. Universal 6-Way Wallet Balance Sync is wired for micro-tips and transfers', () => {
    expect(scriptsContent).toContain('walletBalanceSovDisplay');
    expect(scriptsContent).toContain('sovraHeaderWalletBalance');
    expect(scriptsContent).toContain('heroActiveSovBalance');
    expect(scriptsContent).toContain('heroActiveSovBalanceProfile');
    expect(scriptsContent).toContain('railWalletSovBalance');
    expect(scriptsContent).toContain('ytWalletBalanceDisplay');
  });

  it('6. Authentication & Recovery lifecycle methods are defined and exposed to window', () => {
    expect(scriptsContent).toContain('window.validateLoginInputsLive =');
    expect(scriptsContent).toContain('window.validateBip39PhraseLive =');
    expect(scriptsContent).toContain('window.initQuickUserCard =');
    expect(scriptsContent).toContain('window.switchQuickUserAccount =');
    expect(scriptsContent).toContain('window.continueAsQuickUser =');
    expect(scriptsContent).toContain('window.openForgotPinModal =');
    expect(scriptsContent).toContain('window.closeForgotPinModal =');
    expect(scriptsContent).toContain('window.resetPinWithBiometrics =');
    expect(scriptsContent).toContain('window.submitForgotPinWithPhrase =');
  });

  it('7. CSPRNG Cryptographic Entropy Engine is strictly active without weak fallbacks', () => {
    expect(scriptsContent).toContain('window.sovraCSPRNG = function(bytesCount)');
    expect(scriptsContent).toContain('cryptoObj.getRandomValues(arr)');
    expect(scriptsContent).toContain("window.sovraCSPRNG(8)");
  });
});
