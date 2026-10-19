import { describe, it, expect } from 'vitest';
import http from 'node:http';
import vm from 'node:vm';

describe('Client Script Integrity & UI Freeze Prevention Gate', () => {
  it('serves valid HTML with zero syntax errors in all embedded script blocks', async () => {
    const html = await new Promise<string>((resolve, reject) => {
      http.get('http://127.0.0.1:3001', (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });

    expect(html).toBeTruthy();
    expect(html.length).toBeGreaterThan(1000);

    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    let scriptCount = 0;
    const errors: string[] = [];

    while ((match = scriptRegex.exec(html)) !== null) {
      scriptCount++;
      const code = match[1];
      if (!code.trim()) continue;

      try {
        new vm.Script(code, { filename: `served_script_${scriptCount}.js` });
      } catch (err: any) {
        errors.push(`Script #${scriptCount} has SyntaxError: ${err.message}`);
      }
    }

    expect(scriptCount).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  }, 30000);

  it('guarantees all modal overlays default to hidden to prevent backdrop clicks blocking the screen', async () => {
    const html = await new Promise<string>((resolve, reject) => {
      http.get('http://127.0.0.1:3001', (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });

    // Check critical modal overlays
    const requiredModals = [
      'safetyReportModal',
      'juryBallotModal',
      'postOptionsModal',
      'repostModal',
      'omniSearchModal',
      'safetyCenterModal',
      'sovereignOnboardingWizard',
      'globalCommandPaletteModal',
      'spatialCallOverlay',
      'spatialCallPipFloating',
      'sovereignKeyVaultModal',
      'deviceLinkModal'
    ];

    for (const modalId of requiredModals) {
      const regex = new RegExp(`id="${modalId}"[^>]*style="[^"]*display:\\s*none`, 'i');
      expect(regex.test(html)).toBe(true);
    }
  }, 30000);

  it('guarantees admin controls are isolated and hidden from consumer view by default', async () => {
    const html = await new Promise<string>((resolve, reject) => {
      http.get('http://127.0.0.1:3001', (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });

    // 1. Ops Console tab on left rail nav must be hidden by default
    expect(html).toMatch(/id="tab-admin"[^>]*style="[^"]*display:\s*none/i);

    // 2. Operator Section in Drawer must be hidden by default
    expect(html).toMatch(/id="drawerAdminSection"[^>]*style="[^"]*display:\s*none/i);

    // 3. Consumer Profile header items exist
    expect(html).toContain('id="drawerProfileName"');
    expect(html).toContain('id="drawerProfileHandle"');

    // 4. Privacy & Safety Center modal trigger exists for normal citizens
    expect(html).toContain('openSafetyCenterModal()');
    expect(html).toContain('Privacy &amp; Safety Center');

    // 5. Operator Diagnostic Hub buttons & cards must be hidden by default
    expect(html).toMatch(/id="hubBtnP2pDiagnostics"[^>]*style="[^"]*display:\s*none/i);
    expect(html).toMatch(/id="hubBtnMeshTelemetry"[^>]*style="[^"]*display:\s*none/i);
    expect(html).toMatch(/id="nodeDiagnosticsCard"[^>]*style="[^"]*display:\s*none/i);
    expect(html).toMatch(/id="meshTelemetryCard"[^>]*style="[^"]*display:\s*none/i);

    // 6. Consumer Hub buttons exist
    expect(html).toContain('id="hubBtnIdentity"');
    expect(html).toContain('id="hubBtnCreator"');
    expect(html).toContain('id="hubBtnSafety"');
    expect(html).toContain('id="hubBtnDisplay"');

    // 7. Right Rail footer Ops link is hidden by default
    expect(html).toMatch(/id="rightRailOpsLink"[^>]*style="[^"]*display:\s*none/i);
  }, 30000);

  it('guarantees Consumer Mode hides raw decentralized telemetry and surfaces sleek Node Operator HUD on demand', async () => {
    const html = await new Promise<string>((resolve, reject) => {
      http.get('http://127.0.0.1:3001', (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });

    // 1. Strict CSS rules hiding raw CIDs, Noise keys, libp2p logs, and operator telemetry in Consumer Mode
    expect(html).toContain('body:not(.node-operator-mode) .dev-cid-badge');
    expect(html).toContain('body:not(.node-operator-mode) .ipfs-cid-tag');
    expect(html).toContain('body:not(.node-operator-mode) #ytCidDisplay');
    expect(html).toContain('body:not(.node-operator-mode) #reelCidDisplay');
    expect(html).toContain('body:not(.node-operator-mode) .node-operator-telemetry');
    expect(html).toContain('body:not(.node-operator-mode) .dev-key-badge');
    expect(html).toContain('body:not(.node-operator-mode) .noise-key-tag');
    expect(html).toContain('body:not(.node-operator-mode) .libp2p-log-tag');

    // 2. Glassmorphic Node Operator HUD markup present
    expect(html).toContain('id="devOperatorHud"');
    expect(html).toContain('id="devHudBitSwapSection"');
    expect(html).toContain('id="devHudMeshSection"');
    expect(html).toContain('id="devHudSqliteSection"');
    expect(html).toContain('id="devHudInspectorSection"');

    // 3. Telemetry metrics & interactive actions present in HUD
    expect(html).toContain('id="devHudBitswapInSpeed"');
    expect(html).toContain('id="devHudBitswapOutSpeed"');
    expect(html).toContain('id="devHudMeshPeerCount"');
    expect(html).toContain('id="devHudTopologyList"');
    expect(html).toContain('id="devHudWalSize"');
    expect(html).toContain('id="devHudWalPages"');
    expect(html).toContain('btnTriggerWalCheckpoint');
    expect(html).toContain('triggerWalCheckpointAction()');
    expect(html).toContain('vacuumSqliteDbAction()');
    expect(html).toContain('refreshDevHudTelemetry()');

    // 4. Client engine script contains toggling, polling & keyboard shortcuts
    expect(html).toContain('window.toggleNodeOperatorMode');
    expect(html).toContain('window.updateDevHudTelemetry');
    expect(html).toContain('window.triggerWalCheckpointAction');
    expect(html).toContain('Ctrl+Shift+D');
  }, 30000);

  it('verifies Node Operator backend endpoints deliver live BitSwap, mesh topology & WAL checkpoint triggers', async () => {
    // 1. GET /api/operator/telemetry
    const telemetryData = await new Promise<any>((resolve, reject) => {
      http.get('http://127.0.0.1:3001/api/operator/telemetry', (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });

    expect(telemetryData.ok).toBe(true);
    expect(telemetryData.bitswap).toBeDefined();
    expect(telemetryData.bitswap.inboundSpeedBps).toBeGreaterThan(0);
    expect(telemetryData.topology).toBeDefined();
    expect(Array.isArray(telemetryData.topology.peers)).toBe(true);
    expect(telemetryData.topology.peers.length).toBeGreaterThan(0);
    expect(telemetryData.sqliteWal).toBeDefined();
    expect(telemetryData.sqliteWal.checkpointMode).toBe('PASSIVE');

    // 2. POST /api/operator/checkpoint
    const checkpointData = await new Promise<any>((resolve, reject) => {
      const req = http.request(
        'http://127.0.0.1:3001/api/operator/checkpoint',
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res) => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
      req.end();
    });

    expect(checkpointData.ok).toBe(true);
    expect(checkpointData.message).toContain('SQLite WAL checkpoint completed');
  }, 30000);

  it('verifies Zero-Friction UX Engine, Auto-Advance guidance, and Draft Persistence in served client', async () => {
    const html = await new Promise<string>((resolve, reject) => {
      http.get('http://127.0.0.1:3001', (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });

    // 1. Floating Return Pill element & styles
    expect(html).toContain('id="sovraFloatingReturnPill"');
    expect(html).toContain('.sovra-floating-return-pill');
    expect(html).toContain('returnToFrozenMediaTab');

    // 2. Attention-guiding pulse & helper cue CSS
    expect(html).toContain('.frictionless-missing-pulse');
    expect(html).toContain('.frictionless-helper-cue');
    expect(html).toContain('.frictionless-draft-badge');

    // 3. SovraZeroFrictionEngine core API presence
    expect(html).toContain('window.SovraZeroFrictionEngine');
    expect(html).toContain('saveDraft:');
    expect(html).toContain('getDraft:');
    expect(html).toContain('clearDraft:');
    expect(html).toContain('guideToMissingField:');
    expect(html).toContain('startChatWithUser:');
    expect(html).toContain('seamlessTipUser:');

    // 4. Integrated workflows have zero-friction hooks
    // Creator studio auto-routes missing file and title
    expect(html).toContain('studioWsDropzone');
    expect(html).toContain('studioWsInputTitle');
    // Feed composer auto-routes missing text
    expect(html).toContain('dynamicPostCaption');
    // Reels modal auto-routes missing vertical video or caption
    expect(html).toContain('reelUploadDropzonePrompt');
  }, 30000);

  it('verifies Consumer WhatsApp-Grade Active Chat Header Parity, Clean Overflow Dropdown, and Legacy ID Compatibility', async () => {
    const html = await new Promise<string>((resolve, reject) => {
      http.get('http://127.0.0.1:3001', (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });

    // 1. Prominent contact identity (avatar, bold name, clean status)
    expect(html).toContain('id="activePeerAvatar"');
    expect(html).toContain('id="activePeerName"');
    expect(html).toContain('id="activePeerStatus"');
    expect(html).toContain('Public Mesh Chat');

    // 2. Minimalist WhatsApp top action buttons
    expect(html).toContain('id="headerVideoCallBtn"');
    expect(html).toContain('id="headerAudioCallBtn"');
    expect(html).toContain('id="headerChatSearchBtn"');
    expect(html).toContain('id="chatHeaderMenuBtn"');

    // 3. WhatsApp 3-dots overflow dropdown menu with secondary actions
    expect(html).toContain('id="chatHeaderDropdownMenu"');
    expect(html).toContain('Search in chat');
    expect(html).toContain('Disappearing messages');
    expect(html).toContain('id="menuConfidentialLabel"');
    expect(html).toContain('Privacy Relays');
    expect(html).toContain('Encryption details');

    // 4. Backward compatibility: technical buttons preserved in DOM with display: none
    expect(html).toMatch(/id="headerDisappearingBtn"[^>]*style="[^"]*display:\s*none/i);
    expect(html).toMatch(/id="chatConfidentialShieldBtn"[^>]*style="[^"]*display:\s*none/i);
    expect(html).toMatch(/id="privacyRelayToggleBtn"[^>]*style="[^"]*display:\s*none/i);
    expect(html).toMatch(/id="bitchatHeaderRoute"[^>]*style="[^"]*display:\s*none/i);

    // 5. Clean WhatsApp consumer input bar placeholder (not technical jargon)
    expect(html).toContain('placeholder="Type a message..."');

    // 6. Client helper routines for dropdown and in-chat search
    expect(html).toContain('window.toggleChatHeaderMenu = toggleChatHeaderMenu');
    expect(html).toContain('window.closeChatHeaderMenu = closeChatHeaderMenu');
    expect(html).toContain('window.toggleInChatSearch = toggleInChatSearch');
    expect(html).toContain('window.closeInChatSearch = closeInChatSearch');
    expect(html).toContain('window.handleInChatSearch = handleInChatSearch');
  }, 30000);

  it('verifies Industry-Standard Top Heads-Up Notification Banner Engine, Anti-Flood Batching, and Screen-Center Freeze Prevention', async () => {
    const html = await new Promise<string>((resolve, reject) => {
      http.get('http://127.0.0.1:3001', (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });

    // 1. Top Heads-Up Banner container & card styles present
    expect(html).toContain('.sovra-inapp-banner-container');
    expect(html).toContain('.sovra-inapp-banner');
    expect(html).toContain('.sovra-banner-avatar-wrap');
    expect(html).toContain('.sovra-banner-title');
    expect(html).toContain('.sovra-banner-btn-action');
    expect(html).toContain('.sovra-banner-btn-close');

    // 2. Bottom Toast is safely anchored above bottom tab bar, never in screen center
    expect(html).toContain('bottom: max(78px, calc(env(safe-area-inset-bottom) + 68px));');
    expect(html).not.toContain('bottom: 28px;\n      left: 50%;');

    // 3. Client banner routines & window globals present
    expect(html).toContain('window.showInAppNotification = showInAppNotification');
    expect(html).toContain('window.showToast = showAccountToast');
    expect(html).toContain('var _recentInAppNotifMap = new Map()');

    // 4. Strict concurrency limit (max 2 cards with card depth stack)
    expect(html).toContain('existingCards.length >= 2');
    expect(html).toContain('existingCards[0].classList.add("stacked-behind")');

    // 5. Anti-flood batching in fetchNotifications
    expect(html).toContain('unreadNewList.length > 2');
    expect(html).toContain('showInAppNotification({');
  }, 30000);

  it('verifies Facebook Standard Notification Bell and Snug Edge-Anchored Badge UX', async () => {
    const html = await new Promise<string>((resolve, reject) => {
      http.get('http://127.0.0.1:3001', (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });

    // 1. Frameless Icon Buttons: Transparent background, no dark solid enclosing circle (#3a3b3c)
    expect(html).toContain('background: transparent !important; /* Completely free - NO solid inside circle or box */');
    expect(html).toContain('.header-action-icon-btn .header-icon-wrap');
    expect(html).toContain('.header-action-icon-btn .header-bell-icon');

    // 2. Facebook Standard Badge Placement: Edge-anchored to top-right shoulder of icon
    expect(html).toContain('background: #e41e3f !important; /* Facebook Red */');
    expect(html).toContain('border: 2px solid #0b141a !important; /* Facebook cutout border matching header background */');
    expect(html).toContain('top: -5px !important;');
    expect(html).toContain('right: -8px !important;');

    // 3. Essential DOM IDs and SVGs
    expect(html).toContain('id="headerNotificationBell"');
    expect(html).toContain('id="headerNotificationBadge"');
    expect(html).toContain('id="headerChatBtn"');
    expect(html).toContain('id="headerChatBadge"');

    // 4. Bell icon SVG path (Facebook standard filled bell)
    expect(html).toContain('d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"');

    // 5. Unread count cap formatting at 99+
    expect(html).toContain("data.unreadCount > 99 ? '99+' : String(data.unreadCount)");
  }, 30000);
});


