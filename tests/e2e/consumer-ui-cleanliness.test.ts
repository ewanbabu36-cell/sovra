import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sovraDb } from '../../scripts/database-engine.ts';

describe('Consumer Social UI Cleanliness & Admin Segregation Suite', () => {
  const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
  const content = fs.readFileSync(devServerPath, 'utf8');

  it('proves developer ops links and raw TCP port badges are hidden in consumer CSS', () => {
    // Hidden via global CSS rules to keep pure consumer experience
    expect(content).toContain('.ops-console-rail-link');
    expect(content).toContain('#tab-admin');
    expect(content).toContain('#bnav-admin');
    expect(content).toContain('.tcp-port-badge');
    expect(content).toContain('display: none !important');
  });

  it('proves post composer is clean with consumer topic channels and no DAG Pin button', () => {
    expect(content).toContain('id="dynamicPostTheme"');
    expect(content).toContain('Public Feed');
    expect(content).toContain('Friends Circle');
    expect(content).toContain('Creator Exclusive');
    expect(content).not.toContain('Pin Merkle DAG Block');
  });

  it('proves right discovery rail features Sovereign Security card and no raw Node Diagnostics', () => {
    expect(content).toContain('Sovereign Security');
    expect(content).toContain('Zero corporate tracking or ad algorithms');
    expect(content).toContain('id="railPeerCount"');
    expect(content).toContain('id="railDagStatus"');
    expect(content).toContain('id="railBlocksCount"');
    expect(content).toContain('id="railUptime"');
    // Ensure Node Diagnostics header is not rendered to end users in the right rail
    expect(content).not.toContain('<div class="card-title">Node Diagnostics</div>');
  });

  it('proves stories tray automatically consolidates multiple segments per creator persona', () => {
    const stories = sovraDb.getAllStories();
    expect(Array.isArray(stories)).toBe(true);

    // Verify there are no duplicate creator handles in active stories
    const handles = stories.map(s => s.creatorHandle.toLowerCase());
    const uniqueHandles = new Set(handles);
    expect(handles.length).toBe(uniqueHandles.size);
  }, 15000);

  it('proves profile dropdown and sidebar feature prominent Log Out button with icon', () => {
    // 1. Profile dropdown menu item
    expect(content).toContain('id="profileLogoutBtn"');
    expect(content).toContain('openLogoutModal()');
    expect(content).toContain('<span>Log Out</span>');

    // 2. Sidebar user card quick logout button
    expect(content).toContain('id="railLogoutQuickBtn"');
    expect(content).toContain('class="rail-logout-quick-btn"');

    // 3. Dedicated confirmation modal
    expect(content).toContain('id="logoutConfirmModal"');
    expect(content).toContain('id="confirmLogoutSubmitBtn"');
    expect(content).toContain('executeUserLogout()');
    expect(content).toContain('/api/user/logout');

    // 4. Complete session & profile credential purge
    expect(content).toContain("localStorage.setItem('sovra_logged_out', 'true')");
    expect(content).toContain("localStorage.removeItem('sovra_user_profile')");
    expect(content).toContain("localStorage.removeItem('sovra_session_token')");

    // 5. Explicitly logged out protection against auto-seed trap
    expect(content).toContain("const isExplicitlyLoggedOut = localStorage.getItem('sovra_logged_out') === 'true'");
    expect(content).toContain("currentUserHandle = '@guest'");
  });
});
