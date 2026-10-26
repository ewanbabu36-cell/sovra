import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Strict 2-Theme Architecture (Normal & Black) & Clean Consumer Feed Suite', () => {
  const devServerPath = path.resolve(process.cwd(), 'scripts', 'dev-server.ts');
  const code = fs.readFileSync(devServerPath, 'utf-8');

  it('1. Verifies devAdvanceTelemetryHud is permanently suppressed and hidden from the consumer feed', () => {
    // Both HTML and CSS must enforce display: none !important
    expect(code).toContain('id="devAdvanceTelemetryHud"');
    expect(code).toMatch(/#devAdvanceTelemetryHud[\s\S]*?display:\s*none\s*!important/);
    expect(code).toContain('<div id="devAdvanceTelemetryHud" class="circuit-glass-card" style="display: none !important;');
  });

  it('2. Verifies ambientLanPeerPill is hidden from consumer feed so nearby device telemetry does not interrupt feed', () => {
    expect(code).toContain('id="ambientLanPeerPill"');
    expect(code).toMatch(/#ambientLanPeerPill[\s\S]*?display:\s*none\s*!important/);
    expect(code).toContain('<div id="ambientLanPeerPill" style="display: none !important;');
  });

  it('3. Verifies cyber corner brackets are permanently disabled from ruining social feed cards', () => {
    expect(code).toContain('body .card::before');
    expect(code).toContain('body .card::after');
    expect(code).toContain('display: none !important;');
  });

  it('4. Verifies default mode is set to simple and mode-advance is not active by default', () => {
    expect(code).toContain("<body class=\"nav-mode-auto theme-normal\" data-active-tab=\"feed\">");
    expect(code).toContain("let currentDevUiMode = 'simple';");
  });

  it('5. Verifies strictly two theme modes: normal (light) and black (dark)', () => {
    expect(code).toContain(':root, [data-theme="normal"], body.theme-normal');
    expect(code).toContain('[data-theme="black"], body.theme-black');
    expect(code).toContain('body.theme-normal .app-top-header');
    expect(code).toContain('body.theme-black .app-top-header');
    expect(code).toContain('body.theme-normal .insta-post-card');
    expect(code).toContain('body.theme-black .insta-post-card');
  });

  it('6. Verifies Header Theme Toggle Button is present and wired to toggleSovraTheme', () => {
    expect(code).toContain('id="headerThemeToggleBtn"');
    expect(code).toContain('id="headerThemeIcon"');
    expect(code).toContain('onclick="toggleSovraTheme(event)"');
  });

  it('7. Verifies Profile Screen contains 2-choice theme selectors for Normal and Black', () => {
    expect(code).toContain('id="btnThemeNormal"');
    expect(code).toContain('id="btnThemeBlack"');
    expect(code).toContain('id="currentThemeBadge"');
    expect(code).toContain("setSovraTheme('normal', true)");
    expect(code).toContain("setSovraTheme('black', true)");
  });

  it('8. Verifies Drawer menu has theme toggle option', () => {
    expect(code).toContain('onclick="toggleSovraTheme(); toggleDevMainMenu(false);"');
    expect(code).toContain('id="drawerThemeLabel"');
  });

  it('9. Verifies Client JavaScript functions are exposed on window object', () => {
    expect(code).toContain('window.setSovraTheme = setSovraTheme;');
    expect(code).toContain('window.toggleSovraTheme = toggleSovraTheme;');
    expect(code).toContain('window.applySovraTheme = applySovraTheme;');
  });
});
