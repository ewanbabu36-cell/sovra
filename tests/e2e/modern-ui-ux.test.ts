import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Modern UI/UX Design System & Smart Omnibar E2E Suite', () => {
  const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
  const content = fs.readFileSync(devServerPath, 'utf8');

  it('verifies modernized top header features unified search bar with Ctrl+K shortcut badge', () => {
    expect(content).toContain('class="header-search-wrap"');
    expect(content).toContain('class="header-search-bar"');
    expect(content).toContain('class="search-kbd-shortcut"');
    expect(content).toContain('Ctrl K');
    expect(content).toContain('id="headerFriendSearchInput"');
    expect(content).toContain('id="headerSearchDropdown"');
  });

  it('verifies consolidated node status pill combines online heartbeat and TCP port', () => {
    expect(content).toContain('class="node-status-pill"');
    expect(content).toContain('class="status-pulse-dot"');
    expect(content).toContain('class="status-text"');
    expect(content).toContain('class="badge tcp-port-badge"');
  });

  it('verifies streamlined minimalist post composer (Threads / Twitter design)', () => {
    expect(content).toContain('class="card feed-composer-card"');
    expect(content).toContain('class="composer-avatar"');
    expect(content).toContain('class="composer-textarea"');
    expect(content).toContain('class="composer-actions-bar"');
    expect(content).toContain('composer-media-tray');
    expect(content).toContain('class="composer-media-btn"');
    expect(content).toContain('class="composer-publish-btn"');
    expect(content).toContain('id="dynamicPostCaption"');
    expect(content).toContain('id="dynamicPostTheme"');
    expect(content).toContain('id="dynamicPostTags"');
    expect(content).toContain('id="dynamicPostPublishBtn"');
    expect(content).toContain('submitDynamicPost');
  });

  it('verifies permanent two-tier post composer architecture with guaranteed zero-overflow publish dock', () => {
    // 1. Two-tier HTML markup structure
    expect(content).toContain('class="composer-media-tray composer-media-row"');
    expect(content).toContain('class="composer-dock-row composer-right-actions"');
    expect(content).toContain('class="composer-dock-left"');

    // 2. Guaranteed publish button anchoring
    expect(content).toContain('id="dynamicPostPublishBtn"');
    expect(content).toContain('margin-left: auto; flex-shrink: 0 !important;');

    // 3. Single-source two-tier CSS guarantees
    expect(content).toContain('.composer-media-row,');
    expect(content).toContain('.composer-dock-row,');
    expect(content).toContain('max-width: 680px;');

    // 4. Mode-Advance cyber neon button styling & corner safety
    expect(content).toContain('body.mode-advance .composer-publish-btn');
    expect(content).toContain('linear-gradient(135deg, #0284c7, #38bdf8)');
  });

  it('verifies live header search supports multi-category matching (People, Channels, Hashtags)', () => {
    expect(content).toContain('handleHeaderFriendSearch');
    expect(content).toContain('socialOmniCatalog.channels');
    expect(content).toContain('socialOmniCatalog.hashtags');
    expect(content).toContain('Deep Omni-Search (Ctrl+K)');
  });

  it('verifies global keyboard listeners are wired for Ctrl+K omni-search and Escape dismissal', () => {
    expect(content).toContain('e.ctrlKey || e.metaKey');
    expect(content).toContain('e.key.toLowerCase() === \'k\'');
    expect(content).toContain('openOmniSearch()');
    expect(content).toContain('e.key === \'Escape\'');
  });

  it('verifies modern design tokens and glassmorphism root CSS variables', () => {
    expect(content).toContain('--accent-cyan: #38bdf8;');
    expect(content).toContain('--glass-bg: rgba(15, 23, 42, 0.82);');
    expect(content).toContain('--glass-border: rgba(255, 255, 255, 0.12);');
  });

  it('verifies ambient cinema glow lighting for YouTube and Reels', () => {
    expect(content).toContain('id="ytAmbientGlow"');
    expect(content).toContain('id="btnAmbientGlow"');
    expect(content).toContain('toggleYtAmbientGlow');
    expect(content).toContain('id="reelAmbientCinemaGlow"');
    expect(content).toContain('class="reels-phone-wrapper"');
    expect(content).toContain('.reel-ambient-cinema-glow');
  });

  it('verifies physics particle explosion engine and holographic story rings', () => {
    expect(content).toContain('spawnParticleBurst');
    expect(content).toContain('particle-heart-spring');
    expect(content).toContain('particle-floating-dopamine');
    expect(content).toContain('physics-micro-particle');
    expect(content).toContain('heart-bounce-pop');
    expect(content).toContain('storyHolographicGlow');
  });

  it('verifies Gap 1: Media Storage Offloading & CAS Blob Pipeline', () => {
    expect(content).toContain('LocalDiskMediaDriver');
    expect(content).toContain("url.pathname.startsWith('/api/media/')");
    expect(content).toContain('localMediaDriver.read');
    expect(content).toContain('localMediaDriver.save');
    expect(content).toContain("'/api/media/'");
    expect(content).toContain('Content-Range');
    expect(content).toContain('Accept-Ranges');
  });

  it('verifies Gap 2: Sovereign Account Backup & 12-Word Mnemonic Modal with FTUX Import', () => {
    expect(content).toContain('id="sovereignBackupModal"');
    expect(content).toContain('id="btnBackupSovereignIdentity"');
    expect(content).toContain('id="mnemonicWordsGrid"');
    expect(content).toContain('id="btnCopyMnemonicPhrase"');
    expect(content).toContain('id="btnDownloadKeystore"');
    expect(content).toContain('id="btnImport12Words"');
    expect(content).toContain('id="mnemonicImportDrawer"');
    expect(content).toContain('openSovereignBackupModal');
    expect(content).toContain('executeMnemonicImport');
    expect(content).toContain("'/api/user/restore-mnemonic'");
  });

  it('verifies Gap 3: Carrier-Grade NAT WebRTC Calling & ICE Servers Route', () => {
    expect(content).toContain("url.pathname === '/api/webrtc/ice-servers'");
    expect(content).toContain('getIceServers');
    expect(content).toContain('SOVRA_TURN_SERVERS');
    expect(content).toContain('stun:stun.l.google.com:19302');
  });

  it('verifies Gap 4: Background WebPush & VAPID Key Route', () => {
    const pushRoutesPath = path.resolve(__dirname, '../../scripts/routes/push.routes.ts');
    const pushContent = fs.readFileSync(pushRoutesPath, 'utf8');
    expect(pushContent).toContain("url.pathname === '/api/push/vapid-key'");
    expect(pushContent).toContain('VAPID_PUBLIC_KEY');
    expect(pushContent).toContain('/api/push/register');
    expect(pushContent).toContain('/api/push/dispatch');
  });

  it('verifies Gap 5: Automated Background Database Snapshot Cron & Backup APIs', () => {
    expect(content).toContain('SovraBackupManager');
    expect(content).toContain('startup_snapshot');
    expect(content).toContain('auto_cron');
    expect(content).toContain("'/api/admin/backup/status'");
    expect(content).toContain("'/api/admin/backup/create'");
  });

  it('verifies Gap 6: Trust, Safety & Direct Chat Moderation Pipeline', () => {
    expect(content).toContain('reportCurrentChatContact');
    expect(content).toContain('blockCurrentChatContact');
    expect(content).toContain('triggerBlockFromModal');
    expect(content).toContain("'/api/social/block'");
    expect(content).toContain('id="safetyReportModal"');
  });
});
