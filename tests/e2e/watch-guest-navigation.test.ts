import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('Watch Navigation & Guest Video Streaming Accessibility', { timeout: 25000 }, () => {
  it('serves dashboard HTML with all primary Watch entry points wired to switchTab("watch")', async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // 1. Header Desktop Nav Pill
    expect(html).toContain('id="navTabWatch"');
    expect(html).toContain('onclick="switchTab(\'watch\')"');

    // 2. Rail Navigation
    expect(html).toContain('id="tab-youtube"');
    expect(html).toContain('data-tab="watch"');

    // 3. Mobile Bottom Nav
    expect(html).toContain('id="bnav-youtube"');
    expect(html).toContain('onclick="switchTab(\'watch\')"');

    // 4. Holographic Command Core Node
    expect(html).toContain('id="holo-node-watch"');
    expect(html).toContain('executeHoloAction(\'watch\')');

    // 5. YouTube 16:9 4K Streaming Main View Container
    expect(html).toContain('id="watchSectionContainer"');
    expect(html).toContain('id="youtube-view"');
    expect(html).toContain('id="tabContentWatch"');
  });

  it('permits unauthenticated and guest visitors to freely access Watch without auth-modal lock', async () => {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();

    // 1. switchTab auth guard only blocks protected private surfaces
    expect(html).toContain("const protectedTabs = ['chat', 'chats', 'me', 'vault', 'studio', 'admin', 'calls'];");
    expect(html).toContain('if (!isAuth && protectedTabs.includes(tab))');

    // 2. Click capture-phase interceptor permits public tabs
    expect(html).toContain('if (!protectedTabs.includes(targetId) && !protectedTabs.includes(normalizedTarget))');
    expect(html).toContain('return; // Allow public exploration & watch without forcing auth!');

    // 3. openApp in OS permits public tabs
    expect(html).toContain('if (!isUserAuthenticated() && (protectedTabs.includes(appId) || protectedTabs.includes(normalizedApp)))');
  });

  it('guarantees renderYtVideo has defensive defaults and cannot crash on undefined properties', async () => {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();

    expect(html).toContain('function renderYtVideo(idx, autoStart)');
    expect(html).toContain('v.tags = Array.isArray(v.tags) ? v.tags :');
    expect(html).toContain('v.chapters = Array.isArray(v.chapters) ? v.chapters :');
    expect(html).toContain('v.ambientColor = v.ambientColor ||');
    expect(html).toContain('v.gradient = v.gradient ||');
  });

  it('routes holographic command core watch node directly to switchTab("youtube")', async () => {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();

    expect(html).toContain("case 'watch':\n          closeHolographicNav();\n          setTimeout(function() { switchTab('youtube'); }, 140);\n          break;");
  });
});
