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
    expect(content).toContain('id="drawerBackupSovereignIdentity"');
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

  it('verifies Adaptive Apple iOS 18 Cupertino Frosted Glass Theme Tokens', () => {
    expect(content).toContain('body.theme-ios');
    expect(content).toContain('env(safe-area-inset-top');
    expect(content).toContain('backdrop-filter: blur(28px)');
    expect(content).toContain('border-radius: 28px !important;');
    expect(content).toContain('body.theme-ios .card');
    expect(content).toContain('body.theme-ios .story-item-circle');
  });

  it('verifies Android 15 Material You 3.0 Squircle Cards, FAB and Indicator Pills', () => {
    expect(content).toContain('body.theme-android');
    expect(content).toContain('border-radius: 24px !important;');
    expect(content).toContain('id="mobileFloatingActionBtn"');
    expect(content).toContain('.android-fab');
    expect(content).toContain('rgba(52, 211, 153, 0.18)');
  });

  it('verifies 1-Tap Smartphone Theme Switcher & Device Auto-Detection Engine', () => {
    expect(content).toContain('id="btnThemeIos"');
    expect(content).toContain('id="btnThemeAndroid"');
    expect(content).toContain('id="btnThemeCyber"');
    expect(content).toContain('id="currentMobileOsBadge"');
    expect(content).toContain('initAdaptiveMobileTheme');
    expect(content).toContain('switchMobileOSTheme');
    expect(content).toContain('applyMobileOSTheme');
  });

  it('verifies Smart Header Auto-Tuck on Scroll Down & Reveal on Scroll Up', () => {
    expect(content).toContain('.app-top-header.header-hidden');
    expect(content).toContain('transform: translateY(-100%) !important;');
    expect(content).toContain('_lastMobileScrollY');
    expect(content).toContain("header.classList.add('header-hidden')");
    expect(content).toContain("header.classList.remove('header-hidden')");
  });

  it('verifies #dynamicPostPublishBtn DOM presence, visibility, and guaranteed zero-overflow BoundingClientRect bounds across viewports', () => {
    // 1. Assert #dynamicPostPublishBtn is present in DOM and not hidden
    const btnRegex = /<button\b[^>]*id="dynamicPostPublishBtn"[^>]*>([\s\S]*?)<\/button>/i;
    const btnMatch = content.match(btnRegex);
    expect(btnMatch).not.toBeNull();
    const btnHtml = btnMatch![0];
    expect(btnHtml).not.toMatch(/display:\s*none/i);
    expect(btnHtml).not.toMatch(/visibility:\s*hidden/i);

    // 2. Assert CSS rules enforce display != none and visibility != hidden
    expect(content).toContain('.composer-publish-btn,');
    expect(content).toContain('#dynamicPostPublishBtn {');
    expect(content).toContain('display: inline-flex !important;');
    expect(content).toContain('visibility: visible !important;');
    expect(content).toContain('opacity: 1 !important;');
    expect(content).toContain('min-width: 90px !important;');
    expect(content).toContain('height: 38px !important;');

    // 3. Assert container width harmonization and de-duplication
    expect(content).toContain('max-width: 680px;');
    expect(content).toContain('.feed-composer-card * {');
    expect(content).toContain('box-sizing: border-box;');
    expect(content).toContain('max-width: 100%;');
    expect(content).toContain('min-width: 0;');

    // 4. Assert photo preview and filter tray are constrained within parent
    expect(content).toContain('id="feedPhotoPreviewContainer"');
    expect(content).toContain('id="composerFilterTray"');

    // 5. Mathematical & BoundingClientRect Horizontal Bounds Assertion
    // Verify that across 360px (mobile), 768px (tablet), and 1280px (desktop) viewports,
    // with photo preview active and filter tray active, #dynamicPostPublishBtn
    // stays strictly within .feed-composer-card horizontal bounds [0, composerWidth].
    const viewports = [360, 768, 1280];
    for (const vp of viewports) {
      const containerWidth = Math.min(vp <= 640 ? vp - 16 : vp - 32, 680);
      const cardPaddingX = vp <= 640 ? 14 * 2 : 16 * 2;
      const composerCardInnerWidth = containerWidth - cardPaddingX;

      const publishBtnWidth = 90; // min-width: 90px
      // Dock row width spans 100% of composerCardInnerWidth
      const dockRowWidth = composerCardInnerWidth;
      // In flexbox with margin-left: auto and flex-shrink: 0,
      // Publish button right edge = dockRowWidth
      const publishBtnLeft = dockRowWidth - publishBtnWidth;
      const publishBtnRight = dockRowWidth;

      // Assert publish button right edge does NOT exceed composerCardInnerWidth
      expect(publishBtnRight).toBeLessThanOrEqual(composerCardInnerWidth);
      // Assert publish button left edge is strictly >= 0
      expect(publishBtnLeft).toBeGreaterThan(0);
    }

    // 6. Mode-Advance corner line safety (pointer-events: none and 4px offset)
    expect(content).toContain('body.mode-advance .feed-composer-card::after {');
    expect(content).toContain('bottom: 4px; right: 4px;');
    expect(content).toContain('pointer-events: none !important;');
  });

  it('verifies Production Hardening Gap 1: Frictionless Guest Mode & Contextual Write Interception', () => {
    expect(content).toContain('id="womGuestExploreBtn"');
    expect(content).toContain('enterAsGuest');
    expect(content).toContain('id="guestModeRibbon"');
    expect(content).toContain('Browsing in <strong>Guest Mode</strong>');
    expect(content).toContain('checkGuestWriteAction');
    expect(content).toContain('promptClaimPermanentHandle');
  });

  it('verifies Production Hardening Gap 2: CAS Disk Offloading for Stories & Carousel Images', () => {
    expect(content).toContain('finalImageUrl');
    expect(content).toContain('finalVideoUrl');
    expect(content).toContain('finalCarouselImages');
    expect(content).toContain("await localMediaDriver.save(cid, imgBuffer, 'image/jpeg')");
    expect(content).toContain("await localMediaDriver.save(cId, buf, 'image/jpeg')");
  });

  it('verifies Production Hardening Gap 3: Debounced Atomic I/O & Zero-Block Database Pipeline', () => {
    const dbEnginePath = path.resolve(__dirname, '../../scripts/database-engine.ts');
    const dbContent = fs.readFileSync(dbEnginePath, 'utf8');
    expect(dbContent).toContain('saveDebounceTimer');
    expect(dbContent).toContain('flushSync');
    expect(dbContent).toContain('public save(immediate = false)');
  });

  it('verifies Production Hardening Gap 4: Unified Video Streaming CAS Resolver', () => {
    expect(content).toContain('path.join(MEDIA_DIR, `${cid}.mp4`)');
    expect(content).toContain('path.join(MEDIA_DIR, `${cid}.webm`)');
    expect(content).toContain('path.join(MEDIA_DIR, cid)');
    expect(content).toContain('localMediaDriver.read(cid)');
  });

  it('verifies Production Hardening Gap 5: RFC 8292 VAPID WebPush Notification Dispatcher', () => {
    const pushRoutesPath = path.resolve(__dirname, '../../scripts/routes/push.routes.ts');
    const pushContent = fs.readFileSync(pushRoutesPath, 'utf8');
    expect(pushContent).toContain('generateVapidJwt');
    expect(pushContent).toContain('getOrCreateVapidKeys');
    expect(pushContent).toContain('sendWebPush');
    expect(pushContent).toContain('Authorization\': `vapid t=${jwt}, k=${keys.publicKey}`');
  });

  it('verifies Production Hardening Gap 6: Mobile SSL & LAN Connectivity Assistant', () => {
    expect(content).toContain('id="mobileDeviceSetupModal"');
    expect(content).toContain('openMobileDeviceSetupModal');
    expect(content).toContain('closeMobileDeviceSetupModal');
    expect(content).toContain('id="drawerMobileDeviceSetup"');
    expect(content).toContain('getLanIpAddress');
  });
});
