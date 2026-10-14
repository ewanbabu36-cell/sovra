/**
 * @file tests/e2e/consumer-superapp-studio-hub.test.ts
 * SOVRA CONSUMER SUPER APP, CREATOR STUDIO PRO & HUB SUITE
 *
 * Verifies:
 * 1. Core 5-Pillar Navigation (Feed | Chats | Watch | Hub | Studio) across Rail, Bottom Dock & Drawer
 * 2. Dedicated Super App Hub (#hub-view) integrating the 6 Core Sovereign Apps/Services
 * 3. Dedicated Smart Creator Studio Pro Workspace (#studio-view) with 4 Subtabs (Analytics, Ingest, Content, Schedule)
 * 4. Interactive SVG Charts, Canvas Frame Extractor, Chapters Editor, Monetization Matrix & Transcode Monitor
 * 5. Floating Picture-in-Picture (PiP) Mini-Player (#sovraFloatingPipPlayer)
 * 6. Contextual 3rd Rail Cards (#railSovWalletCard, #railBleRadarCard, #railLiveStreamsCard, #railDeveloperTelemetryCard)
 * 7. Developer & Operator Mode Toggle (#toggleNodeOperatorMode) Isolating Technical Telemetry
 * 8. Backend Studio Endpoints (/api/studio/analytics, /api/studio/content, /api/studio/schedule)
 * 9. Client Script Engines (SovraCreatorStudioEngine, SovraPipEngine, toggleNodeOperatorMode)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { sovraDb } from '../../scripts/database-engine.ts';

describe('SOVRA Consumer Super App, Creator Studio Pro & Hub Architecture', () => {
  const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
  const serverContent = fs.readFileSync(devServerPath, 'utf8');

  it('1. Core 5-Pillar Navigation: establishes unified 5-pillar navigation across Rail, Dock and Drawer', () => {
    // 1.1 Desktop Rail Navigation contains the 5 pillars
    expect(serverContent).toContain('id="tab-feed"');
    expect(serverContent).toContain('id="tab-chat"');
    expect(serverContent).toContain('id="tab-youtube"');
    expect(serverContent).toContain('id="tab-hub"');
    expect(serverContent).toContain('id="tab-studio"');

    // 1.2 Preserves backwards-compatible tabs for testing and deep links
    expect(serverContent).toContain('id="tab-friends"');
    expect(serverContent).toContain('id="tab-reels"');
    expect(serverContent).toContain('id="tab-me"');
    expect(serverContent).toContain('id="tab-admin"');

    // 1.3 Mobile Dock Navigation contains the 5 primary pillars
    expect(serverContent).toContain('id="bnav-feed"');
    expect(serverContent).toContain('id="bnav-chat"');
    expect(serverContent).toContain('id="bnav-youtube"');
    expect(serverContent).toContain('id="bnav-hub"');
    expect(serverContent).toContain('id="bnav-studio"');

    // 1.4 Preserves backwards-compatible bottom nav elements
    expect(serverContent).toContain('id="bnav-reels"');
    expect(serverContent).toContain('class="bottom-nav-create"');
    expect(serverContent).toContain('id="bnav-me"');

    // 1.5 Main Menu Drawer contains Hub and Studio actions
    expect(serverContent).toContain("switchTab('hub')");
    expect(serverContent).toContain("switchTab('studio')");
    expect(serverContent).toContain('Super App Hub');
    expect(serverContent).toContain('Smart Creator Studio');
  });

  it('2. Super App Hub (#hub-view): hosts standalone view integrating all 6 sovereign services', () => {
    // 2.1 View element exists
    expect(serverContent).toContain('id="hub-view"');
    expect(serverContent).toContain('Unified Sovereign Services Hub');

    // 2.2 6 Core Super App Cards
    expect(serverContent).toContain('id="hubAppBleRadar"');
    expect(serverContent).toContain('Offline BLE Mesh Radar');

    expect(serverContent).toContain('id="hubAppLiveSwarm"');
    expect(serverContent).toContain('Live Swarm Broadcast');

    expect(serverContent).toContain('id="hubAppStudioPro"');
    expect(serverContent).toContain('Smart Creator Studio Pro');

    expect(serverContent).toContain('id="hubAppWellbeing"');
    expect(serverContent).toContain('Digital Wellbeing &amp; Limits');

    expect(serverContent).toContain('id="hubAppWallet"');
    expect(serverContent).toContain('Sovereign SOV Wallet');

    expect(serverContent).toContain('id="hubAppBiometrics"');
    expect(serverContent).toContain('Hardware Biometrics Enclave');
  });

  it('3. Creator Studio Pro (#studio-view): provides dedicated full workspace replacing modal fatigue', () => {
    // 3.1 Dedicated workspace container exists
    expect(serverContent).toContain('id="studio-view"');
    expect(serverContent).toContain('Autonomous 4K multi-bitrate HLS pipelines');

    // 3.2 4 Subtab navigation buttons
    expect(serverContent).toContain('id="studioSubtabAnalytics"');
    expect(serverContent).toContain('id="studioSubtabIngest"');
    expect(serverContent).toContain('id="studioSubtabContent"');
    expect(serverContent).toContain('id="studioSubtabSchedule"');

    // 3.3 4 Subtab view sections
    expect(serverContent).toContain('id="studioSectionAnalytics"');
    expect(serverContent).toContain('id="studioSectionIngest"');
    expect(serverContent).toContain('id="studioSectionContent"');
    expect(serverContent).toContain('id="studioSectionSchedule"');
  });

  it('4. Studio Subtab 1 (Analytics): includes 4 KPI cards, 95/5 revenue split, and interactive SVG charts', () => {
    // 4.1 4 KPI Cards
    expect(serverContent).toContain('id="studioWsTotalViews"');
    expect(serverContent).toContain('id="studioWsEarnedSov"');
    expect(serverContent).toContain('id="studioWsWatchTime"');
    expect(serverContent).toContain('id="studioWsScheduledCount"');

    // 4.2 95/5 Economic Split Card
    expect(serverContent).toContain('Sovereign 95/5 Revenue Split Active:');
    expect(serverContent).toContain('You keep <strong>95%</strong>');

    // 4.3 Interactive SVG Charts
    expect(serverContent).toContain('id="studioSvgViewVelocity"');
    expect(serverContent).toContain('id="studioSvgRevenue"');
    expect(serverContent).toContain('id="studioSvgRetention"');
  });

  it('5. Studio Subtab 2 (Ingest & Transcode): provides canvas frame extractor, chapters, gating matrix, and transcode monitor', () => {
    // 5.1 Dropzone and video/canvas elements
    expect(serverContent).toContain('id="studioWsDropzone"');
    expect(serverContent).toContain('id="studioWsFileInput"');
    expect(serverContent).toContain('id="studioWsVideoElement"');
    expect(serverContent).toContain('id="studioWsCanvasElement"');

    // 5.2 Smart Thumbnail candidates & custom thumbnail
    expect(serverContent).toContain('id="studioWsThumbCandidates"');
    expect(serverContent).toContain('id="studioWsCustomThumbInput"');
    expect(serverContent).toContain('id="studioWsSelectedThumbBadge"');

    // 5.3 Metadata inputs
    expect(serverContent).toContain('id="studioWsInputTitle"');
    expect(serverContent).toContain('id="studioWsCategory"');
    expect(serverContent).toContain('id="studioWsInputTags"');

    // 5.4 Markdown description and live preview
    expect(serverContent).toContain('id="studioWsInputDesc"');
    expect(serverContent).toContain('id="studioWsDescPreview"');
    expect(serverContent).toContain('id="studioWsToggleDescPreviewBtn"');

    // 5.5 Chapters editor
    expect(serverContent).toContain('id="studioWsChapterTime"');
    expect(serverContent).toContain('id="studioWsChapterTitle"');
    expect(serverContent).toContain('id="studioWsChaptersList"');

    // 5.6 Monetization gating matrix
    expect(serverContent).toContain('id="studioGateFree"');
    expect(serverContent).toContain('id="studioGateSupporter"');
    expect(serverContent).toContain('id="studioGatePreview"');
    expect(serverContent).toContain('id="studioWsGatingPriceRow"');
    expect(serverContent).toContain('id="studioWsGatingPrice"');
    expect(serverContent).toContain('id="studioWsPreviewSeconds"');

    // 5.7 Transcode monitor & progress bar
    expect(serverContent).toContain('id="studioWsTranscodeMonitor"');
    expect(serverContent).toContain('id="studioWsTranscodeStatusText"');
    expect(serverContent).toContain('id="studioWsTranscodePct"');
    expect(serverContent).toContain('id="studioWsTranscodeProgressBar"');
  });

  it('6. Studio Subtabs 3 & 4 (Content & Schedule): provides video manager table and scheduled release queue', () => {
    // 6.1 Content Library
    expect(serverContent).toContain('id="studioWsContentSearch"');
    expect(serverContent).toContain('id="studioContentTable"');
    expect(serverContent).toContain('id="studioContentTableBody"');

    // 6.2 Scheduled queue
    expect(serverContent).toContain('id="studioWsScheduledQueueList"');
  });

  it('7. Floating Picture-in-Picture Mini-Player: mounts persistent PiP player with full controls', () => {
    // 7.1 Container
    expect(serverContent).toContain('id="sovraFloatingPipPlayer"');

    // 7.2 Video element
    expect(serverContent).toContain('id="sovraPipVideoElement"');

    // 7.3 Controls & Metadata
    expect(serverContent).toContain('id="sovraPipTitle"');
    expect(serverContent).toContain('id="sovraPipCreator"');
    expect(serverContent).toContain('id="sovraPipRestoreBtn"');
    expect(serverContent).toContain('id="sovraPipCloseBtn"');
    expect(serverContent).toContain('id="sovraPipPlayBtn"');
    expect(serverContent).toContain('id="sovraPipStatusBadge"');
  });

  it('8. Contextual 3rd Rail Widgets: hosts SOV Wallet, BLE Radar, Live Streams, and Node Operator Telemetry', () => {
    // 8.1 SOV Wallet card with 95/5 split
    expect(serverContent).toContain('id="railSovWalletCard"');
    expect(serverContent).toContain('id="railWalletSovBalance"');
    expect(serverContent).toContain('95/5 Split');

    // 8.2 Offline BLE Mesh Radar card
    expect(serverContent).toContain('id="railBleRadarCard"');
    expect(serverContent).toContain('BLE Mesh Radar');

    // 8.3 Live Streams card
    expect(serverContent).toContain('id="railLiveStreamsCard"');
    expect(serverContent).toContain('P2P Live Streams');

    // 8.4 Developer & Operator Telemetry card
    expect(serverContent).toContain('id="railDeveloperTelemetryCard"');
    expect(serverContent).toContain('class="card node-operator-telemetry"');
    expect(serverContent).toContain('display: none;');
  });

  it('9. Developer & Operator Mode Isolation: cleanly segregates technical telemetry from consumer UI', () => {
    // 9.1 Checkbox in Settings Surface
    expect(serverContent).toContain('id="toggleNodeOperatorMode"');
    expect(serverContent).toContain('id="spatialSettingsNodeOpBadge"');

    // 9.2 Drawer action item
    expect(serverContent).toContain('toggleNodeOperatorMode()');

    // 9.3 Client engine methods
    expect(serverContent).toContain('window.toggleNodeOperatorMode =');
    expect(serverContent).toContain('window.isNodeOperatorModeActive =');
    expect(serverContent).toContain("localStorage.setItem('sovra_node_op_mode'");
  });

  it('10. Client Engine Wiring: implements SovraCreatorStudioEngine, SovraPipEngine and switchTab handlers', () => {
    // 10.1 SovraCreatorStudioEngine methods
    expect(serverContent).toContain('window.SovraCreatorStudioEngine =');
    expect(serverContent).toContain('switchStudioTab:');
    expect(serverContent).toContain('loadAnalytics:');
    expect(serverContent).toContain('renderSvgCharts:');
    expect(serverContent).toContain('handleVideoFileSelected:');
    expect(serverContent).toContain('toggleDescPreview:');
    expect(serverContent).toContain('addChapter:');
    expect(serverContent).toContain('submitWorkspaceUpload:');
    expect(serverContent).toContain('loadContentLibrary:');
    expect(serverContent).toContain('filterContentLibrary:');

    // 10.2 SovraPipEngine methods
    expect(serverContent).toContain('window.SovraPipEngine =');
    expect(serverContent).toContain('openPip:');
    expect(serverContent).toContain('closePip:');
    expect(serverContent).toContain('restoreFullPlayer:');
    expect(serverContent).toContain('togglePlay:');

    // 10.3 switchTab supports hub and studio
    expect(serverContent).toContain("hub: document.getElementById('hub-view')");
    expect(serverContent).toContain("studio: document.getElementById('studio-view')");
    expect(serverContent).toContain("tab === 'studio'");
    expect(serverContent).toContain("SovraCreatorStudioEngine.init()");
  });

  it('11. Database Analytics & Content: proves database engine yields realistic 95/5 creator metrics', () => {
    const creatorDid = 'did:sovra:creator_test_seed';
    const analytics = sovraDb.getCreatorStudioAnalytics(creatorDid);

    expect(analytics).toBeDefined();
    expect(analytics.summary).toBeDefined();
    expect(typeof analytics.summary.totalViews).toBe('number');
    expect(typeof analytics.summary.creatorSplitSov).toBe('number');
    expect(typeof analytics.summary.seederSplitSov).toBe('number');

    // Verify 95/5 ratio integrity
    const totalEarned = analytics.summary.totalEarnedSov || 0;
    if (totalEarned > 0) {
      const creatorShare = analytics.summary.creatorSplitSov / totalEarned;
      expect(creatorShare).toBeCloseTo(0.95, 2);
    }

    // Verify trends and retention curve arrays
    expect(Array.isArray(analytics.viewsTrend)).toBe(true);
    expect(Array.isArray(analytics.retentionCurve)).toBe(true);
    expect(analytics.retentionCurve.length).toBeGreaterThan(0);
  });
});
