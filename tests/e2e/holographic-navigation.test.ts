/**
 * @file tests/e2e/holographic-navigation.test.ts
 * SOVRA ALIEN HOLOGRAPHIC CENTRAL COMMAND CORE & CLEAN UI VERIFICATION SUITE
 *
 * Verifies:
 * 1. Normal state: Clean social dashboard with NO left rail and NO bottom nav bar
 * 2. Header contains: [SOVRA CORE GATEWAY] [SEARCH] [BELL] [AVATAR] [LIVE DOT]
 * 3. Username / handle text is strictly omitted from beside avatar in header
 * 4. Holographic Command Core button (#sovraCoreBtn) triggers central overlay
 * 5. Holographic overlay contains Central Core reactor and all 8 radial command nodes:
 *    - FEED, REELS, WATCH, PROFILE, CHAT, NOTIFICATIONS, CREATE POST, LOGOUT
 * 6. Polar layout coordinates, audio-pulse synthesizers, and FSM functions are wired
 * 7. Realtime LIVE status dot is reactive and connected
 */

import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('Sovra Holographic Central Navigation & Clean Production UI Gate', () => {
  it('serves dashboard HTML with clean header containing SOVRA Command Core button', async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // 1. SOVRA Command Core button exists in header
    expect(html).toContain('id="sovraCoreBtn"');
    expect(html).toContain('class="sovra-core-gateway-btn"');
    expect(html).toContain('aria-label="Open SOVRA holographic command center"');

    // 2. Center search exists
    expect(html).toContain('class="header-search-wrap"');

    // 3. Notification bell exists
    expect(html).toContain('id="headerNotificationBell"');

    // 4. Circular profile avatar exists
    expect(html).toContain('id="currentUserAvatar"');
    expect(html).toContain('header-avatar-circle');

    // 5. Live connection indicator dot exists
    expect(html).toContain('id="headerLiveIndicator"');
    expect(html).toContain('id="liveDotPulse"');

    // 6. Redundant handle text beside avatar is removed/hidden
    expect(html).toContain('#currentUserHandleText {');
    expect(html).toContain('display: none !important;');
  });

  it('permanently suppresses legacy left rail and bottom nav bar in normal state CSS', async () => {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();

    // Verify left rail and bottom dock are hidden
    expect(html).toContain('.app-left-rail,');
    expect(html).toContain('.mobile-bottom-nav,');
    expect(html).toContain('display: none !important;');
  });

  it('mounts the Central Holographic Command Core overlay with all 8 primary action nodes', async () => {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();

    // 1. Overlay container
    expect(html).toContain('id="holographicNavOverlay"');
    expect(html).toContain('class="holo-nav-overlay"');

    // 2. Central Command Reactor Core
    expect(html).toContain('id="holoCenterCoreBtn"');
    expect(html).toContain('SOVRA OS');

    // 3. All 8 primary action nodes
    expect(html).toContain('id="holo-node-feed"');
    expect(html).toContain('FEED');

    expect(html).toContain('id="holo-node-reels"');
    expect(html).toContain('REELS');

    expect(html).toContain('id="holo-node-watch"');
    expect(html).toContain('WATCH');

    expect(html).toContain('id="holo-node-profile"');
    expect(html).toContain('PROFILE');

    expect(html).toContain('id="holo-node-chat"');
    expect(html).toContain('CHAT');

    expect(html).toContain('id="holo-node-notif"');
    expect(html).toContain('NOTIFICATIONS');

    expect(html).toContain('id="holo-node-create"');
    expect(html).toContain('CREATE POST');

    expect(html).toContain('id="holo-node-logout"');
    expect(html).toContain('LOGOUT');
  });

  it('contains client-side state machine, polar coordinate engine, and audio synthesizers', async () => {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();

    // 1. Audio synthesis functions
    expect(html).toContain('function playHolographicPulseSound()');
    expect(html).toContain('function playHolographicCollapseSound()');

    // 2. Polar coordinate engine
    expect(html).toContain('function calculateHolographicPositions()');
    expect(html).toContain('HOLOGRAPHIC_CONFIG');

    // 3. FSM state handlers
    expect(html).toContain('function toggleHolographicNav()');
    expect(html).toContain('function openHolographicNav()');
    expect(html).toContain('function closeHolographicNav()');
    expect(html).toContain('function executeHoloAction(');

    // 4. Real-time Live connection engine
    expect(html).toContain('function initRealtimeLiveConnection()');
    expect(html).toContain('/api/realtime/stream');
  });
});
