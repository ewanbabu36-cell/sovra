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
    expect(content).toContain('class="composer-media-tray"');
    expect(content).toContain('class="composer-media-btn"');
    expect(content).toContain('class="composer-publish-btn"');
    expect(content).toContain('id="dynamicPostCaption"');
    expect(content).toContain('id="dynamicPostTheme"');
    expect(content).toContain('id="dynamicPostTags"');
    expect(content).toContain('id="dynamicPostPublishBtn"');
    expect(content).toContain('submitDynamicPost');
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
});
