import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('Explore Surface Button Visibility & UX Parity', { timeout: 25000 }, () => {
  it('ensures explore tile overlay and action buttons have persistent visibility (no hover-gating)', () => {
    const cssContent = fs.readFileSync(path.join(rootDir, 'apps/sovra-app/src/styles/sovra.css'), 'utf-8');
    const distCss = fs.readFileSync(path.join(rootDir, 'apps/sovra-app/dist/sovra.css'), 'utf-8');

    // 1. Overlay is always visible with opacity: 1 !important
    expect(cssContent).toContain('.explore-tile-overlay');
    expect(cssContent).toMatch(/opacity:\s*1\s*!important/);

    // 2. Action pills defined for like and comment buttons
    expect(cssContent).toContain('.explore-tile-actions');
    expect(cssContent).toContain('.explore-action-pill');
    expect(cssContent).toContain('.explore-action-pill:hover');
    expect(cssContent).toContain('.explore-action-pill.like-btn.liked');

    // 3. Persistent video / reel play indicator
    expect(cssContent).toContain('.explore-play-indicator');
    expect(cssContent).toContain('.explore-tile-badge');

    // 4. Dist CSS bundle also contains these styles
    expect(distCss).toContain('.explore-tile-overlay');
    expect(distCss).toContain('.explore-action-pill');
    expect(distCss).toContain('.explore-play-indicator');
  });

  it('ensures search category pills and community filter pills are permanently styled with high contrast', () => {
    const cssContent = fs.readFileSync(path.join(rootDir, 'apps/sovra-app/src/styles/sovra.css'), 'utf-8');

    // 1. Search category tabs & pills
    expect(cssContent).toContain('.search-category-tabs');
    expect(cssContent).toContain('.search-cat-pill');
    expect(cssContent).toContain('.search-cat-pill:hover');
    expect(cssContent).toContain('.search-cat-pill.active');

    // 2. Community tabs
    expect(cssContent).toContain('.community-pill-btn');
    expect(cssContent).toContain('.community-pill-btn:hover');
    expect(cssContent).toContain('.community-pill-btn.active');

    // 3. Hub card action buttons
    expect(cssContent).toContain('.hub-card-action-btn');
    expect(cssContent).toContain('.hub-card-action-btn:hover');
  });

  it('ensures explore mosaic grid generates interactive buttons and play indicators in scripts.view.ts', () => {
    const scriptsContent = fs.readFileSync(path.join(rootDir, 'scripts/views/scripts.view.ts'), 'utf-8');

    // 1. Emits button elements with explore-action-pill
    expect(scriptsContent).toContain('class="explore-action-pill like-btn"');
    expect(scriptsContent).toContain('class="explore-action-pill comment-btn"');
    expect(scriptsContent).toContain('class="explore-play-indicator"');

    // 2. Wires window.likeExplorePost and window.openExploreComments
    expect(scriptsContent).toContain('window.likeExplorePost');
    expect(scriptsContent).toContain('window.openExploreComments');
    expect(scriptsContent).toContain("fetch('/api/reels/like'");
  });

  it('ensures super app hub cards have prominent hub-card-action-btn elements in layout.view.ts', () => {
    const layoutContent = fs.readFileSync(path.join(rootDir, 'scripts/views/layout.view.ts'), 'utf-8');

    // Check hub cards
    expect(layoutContent).toContain('id="hubAppBleRadar"');
    expect(layoutContent).toContain('id="hubAppLiveSwarm"');
    expect(layoutContent).toContain('id="hubAppStudioPro"');
    expect(layoutContent).toContain('id="hubAppChannelsPages"');
    expect(layoutContent).toContain('id="hubAppWellbeing"');
    expect(layoutContent).toContain('id="hubAppWallet"');
    expect(layoutContent).toContain('id="hubAppBiometrics"');

    // Check class="hub-card-action-btn" count (should appear on the cards)
    const matches = layoutContent.match(/class="hub-card-action-btn"/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(6);
  });

  it('serves dashboard HTML with all search category pills and explore mosaic elements', async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // 1. Explore / Search view container
    expect(html).toContain('id="search-view"');
    expect(html).toContain('id="exploreCategoryTabs"');
    expect(html).toContain('id="exploreMosaicGrid"');

    // 2. Category pills present in DOM
    expect(html).toContain('class="search-cat-pill active"');
    expect(html).toContain('filterExploreCategory(\'all\', this)');
    expect(html).toContain('filterExploreCategory(\'reels\', this)');
    expect(html).toContain('filterExploreCategory(\'tech\', this)');

    // 3. Hub view present in DOM
    expect(html).toContain('id="hub-view"');
    expect(html).toContain('hub-card-action-btn');

    // 4. Client scripts contain likeExplorePost and openExploreComments
    expect(html).toContain('likeExplorePost');
    expect(html).toContain('openExploreComments');
  });

  it('verifies /api/explore/grid endpoint returns valid visual media items', async () => {
    const res = await fetch(`${BASE_URL}/api/explore/grid?category=all&limit=12`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBeGreaterThan(0);
    const firstItem = data.items[0];
    expect(firstItem).toHaveProperty('id');
    expect(firstItem).toHaveProperty('type');
  });
});
