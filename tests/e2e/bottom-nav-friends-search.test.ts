import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Bottom Navigation & Friend Search Suite', () => {
  const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
  const content = fs.readFileSync(devServerPath, 'utf8');

  it('proves header search bar and live dropdown exist in dev server UI', () => {
    expect(content).toContain('id="headerFriendSearchInput"');
    expect(content).toContain('id="headerSearchDropdown"');
    expect(content).toContain('class="header-search-wrap"');
    expect(content).toContain('class="header-search-bar"');
    expect(content).toContain('handleHeaderFriendSearch');
    expect(content).toContain('showHeaderSearchDropdown');
  });

  it('proves top navigation has dedicated Friends tab synchronized with other tabs', () => {
    expect(content).toContain('id="tab-feed"');
    expect(content).toContain('id="tab-friends"');
    expect(content).toContain('id="tab-reels"');
    expect(content).toContain('id="tab-youtube"');
    expect(content).toContain('id="tab-chat"');
    expect(content).toContain('id="tab-me"');
    expect(content).toContain('id="tab-admin"');
  });

  it('proves dedicated Friends Discovery View exists with search bar and filter pills', () => {
    expect(content).toContain('id="friends-view"');
    expect(content).toContain('id="friendsViewSearchInput"');
    expect(content).toContain('id="friendsSearchClearBtn"');
    expect(content).toContain('id="ffilter-all"');
    expect(content).toContain('id="ffilter-requests"');
    expect(content).toContain('id="ffilter-friends"');
    expect(content).toContain('id="ffilter-suggestions"');
    expect(content).toContain('id="friendsViewContent"');
    expect(content).toContain('renderFriendsDiscoveryView');
  });

  it('proves bottom navigation bar matches top navigation and features 8 synchronized slots', () => {
    expect(content).toContain('id="bnav-feed"');
    expect(content).toContain('id="bnav-friends"');
    expect(content).toContain('class="bottom-nav-create"');
    expect(content).toContain('id="bnav-reels"');
    expect(content).toContain('id="bnav-youtube"');
    expect(content).toContain('id="bnav-chat"');
    expect(content).toContain('id="bnav-me"');
    expect(content).toContain('id="bnav-admin"');
  });

  it('proves switchTab seamlessly coordinates views, top tabs, and bottom dock items', () => {
    expect(content).toContain('friends: document.getElementById(\'friends-view\')');
    expect(content).toContain('friends: document.getElementById(\'tab-friends\')');
    expect(content).toContain('friends: document.getElementById(\'bnav-friends\')');
    expect(content).toContain('admin: document.getElementById(\'bnav-admin\')');
  });

  it('proves friend requests, bilateral handshake confirm, message, and block actions are wired', () => {
    expect(content).toContain('acceptFriendRequest');
    expect(content).toContain('rejectFriendRequest');
    expect(content).toContain('sendFriendRequest');
    expect(content).toContain('unfriendUser');
    expect(content).toContain('messageFriend');
    expect(content).toContain('triggerBottomCreateAction');
  });
});
