import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as vm from 'vm';

describe('SOVRA Super App — Ecosystem Modules & Adaptive Architecture Verification', () => {
  const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
  const devServerCode = fs.readFileSync(devServerPath, 'utf-8');

  it('declares all 12 specialized Super App module views in HTML structure', () => {
    // 1. SOVRA Home
    expect(devServerCode).toContain('id="feed-view"');
    // 2. PIDDI Short-Video
    expect(devServerCode).toContain('id="reels-view"');
    // 3. SOVRA Video
    expect(devServerCode).toContain('id="youtube-view"');
    // 4. SOVRA Chat
    expect(devServerCode).toContain('id="chat-view"');
    // 5. SOVRA Calls
    expect(devServerCode).toContain('id="calls-view"');
    expect(devServerCode).toContain('class="sovra-calls-stage"');
    expect(devServerCode).toContain('class="calls-control-dock"');
    expect(devServerCode).toContain('id="callMicBtn"');
    expect(devServerCode).toContain('id="callCamBtn"');
    expect(devServerCode).toContain('id="callSpeakerBtn"');
    expect(devServerCode).toContain('id="callShareBtn"');
    expect(devServerCode).toContain('id="callEndBtn"');
    // 6. SOVRA Live
    expect(devServerCode).toContain('id="live-view"');
    expect(devServerCode).toContain('class="sovra-live-container"');
    expect(devServerCode).toContain('class="live-chat-panel"');
    expect(devServerCode).toContain('id="liveChatInput"');
    expect(devServerCode).toContain('id="liveFloatingHeartsLayer"');
    expect(devServerCode).toContain('id="btnLiveFollowHost"');
    // 7. SOVRA Communities
    expect(devServerCode).toContain('id="communities-view"');
    expect(devServerCode).toContain('class="sovra-communities-container"');
    expect(devServerCode).toContain('id="commTabExplore"');
    expect(devServerCode).toContain('id="commTabJoined"');
    expect(devServerCode).toContain('id="communitiesGrid"');
    // 8. SOVRA Profiles
    expect(devServerCode).toContain('id="profile-view"');
    // 9. SOVRA Search
    expect(devServerCode).toContain('id="search-view"');
    expect(devServerCode).toContain('id="unifiedSearchPageInput"');
    expect(devServerCode).toContain('id="searchResultsContainer"');
    expect(devServerCode).toContain('id="recentSearchesSection"');
    // 10. SOVRA Notifications
    expect(devServerCode).toContain('id="notifications-view"');
    expect(devServerCode).toContain('class="sovra-notifications-container"');
    expect(devServerCode).toContain('id="notificationsFeedList"');
    // 11. SOVRA Creator Studio
    expect(devServerCode).toContain('id="studio-view"');
    // 12. SOVRA Settings
    expect(devServerCode).toContain('id="settings-view"');
    expect(devServerCode).toContain('class="sovra-settings-container"');
    expect(devServerCode).toContain('id="settingsSection_profile"');
    expect(devServerCode).toContain('id="settingsSection_privacy"');
    expect(devServerCode).toContain('id="settingsSection_security"');
  });

  it('includes core ecosystem pills in top header quick navigation', () => {
    expect(devServerCode).toContain('id="hnav-feed"');
    expect(devServerCode).toContain('id="hnav-reels"');
    expect(devServerCode).toContain('id="hnav-youtube"');
    expect(devServerCode).toContain('id="hnav-chat"');
    expect(devServerCode).toContain('id="hnav-calls"');
    expect(devServerCode).toContain('id="hnav-live"');
    expect(devServerCode).toContain('id="hnav-communities"');
    expect(devServerCode).toContain('id="hnav-hub"');
    expect(devServerCode).toContain('id="hnav-me"');
  });

  it('includes left rail navigation items, badges, and quick action shortcuts', () => {
    expect(devServerCode).toContain('id="tab-feed"');
    expect(devServerCode).toContain('id="tab-reels"');
    expect(devServerCode).toContain('id="tab-youtube"');
    expect(devServerCode).toContain('id="tab-live"');
    expect(devServerCode).toContain('id="tab-chat"');
    expect(devServerCode).toContain('id="tab-calls"');
    expect(devServerCode).toContain('id="tab-notifications"');
    expect(devServerCode).toContain('id="tab-communities"');
    expect(devServerCode).toContain('id="tab-me"');
    expect(devServerCode).toContain('id="tab-friends"');
    expect(devServerCode).toContain('id="tab-studio"');
    expect(devServerCode).toContain('id="tab-hub"');
    expect(devServerCode).toContain('id="tab-settings"');

    // Quick action shortcuts
    expect(devServerCode).toContain('class="rail-actions-group"');
    expect(devServerCode).toContain('data-action="create-post"');
    expect(devServerCode).toContain('startCallQuickAction()');
  });

  it('adapts context in switchTab with wide view maxWidth and module engines', () => {
    // switchTab registers all new views and tabs
    expect(devServerCode).toContain("calls: document.getElementById('calls-view')");
    expect(devServerCode).toContain("live: document.getElementById('live-view')");
    expect(devServerCode).toContain("communities: document.getElementById('communities-view')");
    expect(devServerCode).toContain("search: document.getElementById('search-view')");
    expect(devServerCode).toContain("notifications: document.getElementById('notifications-view')");
    expect(devServerCode).toContain("settings: document.getElementById('settings-view')");

    // Dynamic layout max-width adaptation
    expect(devServerCode).toContain("const isWideModule = ['youtube', 'chat', 'admin', 'studio', 'hub', 'calls', 'live', 'communities', 'search', 'notifications', 'settings'].includes(tab);");

    // Module engine function declarations
    expect(devServerCode).toContain('function startCallQuickAction(');
    expect(devServerCode).toContain('function toggleCallAudio()');
    expect(devServerCode).toContain('function toggleCallVideo()');
    expect(devServerCode).toContain('function toggleCallSpeaker()');
    expect(devServerCode).toContain('function toggleCallScreenShare()');
    expect(devServerCode).toContain('function terminateActiveCall()');
    expect(devServerCode).toContain('function sendLiveComment(');
    expect(devServerCode).toContain('function sendLiveHeartReaction()');
    expect(devServerCode).toContain('function openLiveGiftModal(');
    expect(devServerCode).toContain('function toggleLiveHostFollow()');
    expect(devServerCode).toContain('function switchCommunitiesSubtab(');
    expect(devServerCode).toContain('function toggleJoinCommunity(');
    expect(devServerCode).toContain('function handleUnifiedSearch(');
    expect(devServerCode).toContain('function filterNotificationsByType(');
    expect(devServerCode).toContain('function switchSettingsSection(');
  });

  it('serves valid HTML with zero syntax errors in all embedded script blocks over HTTP', async () => {
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
});
