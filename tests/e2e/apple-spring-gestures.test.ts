/**
 * @file tests/e2e/apple-spring-gestures.test.ts
 * SOVRA APPLE-GRADE SPRING INTERACTION & DOUBLE-TAP GESTURE VERIFICATION SUITE
 *
 * Verifies:
 * 1. Apple-grade fluid spring curve cubic-bezier(0.16, 1, 0.3, 1) across modals, drawers, and controls
 * 2. YouTube P2P watch player double-tap ±10s seek detection and directional ripples
 * 3. Strict preservation of the critical navigation display override rule block
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Sovra Apple-Grade Spring Curve & Gesture Verification Suite', () => {
  const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
  const content = fs.readFileSync(devServerPath, 'utf8');

  it('verifies Apple-grade cubic-bezier(0.16, 1, 0.3, 1) physics curve is configured across core components', () => {
    // Mode switch button
    expect(content).toContain('transition: all 0.24s cubic-bezier(0.16, 1, 0.3, 1);');

    // WhatsApp modal card entrance animation
    expect(content).toContain('.wa-modal-card');
    expect(content).toContain('animation: waModalSpring 0.35s cubic-bezier(0.16, 1, 0.3, 1);');
    expect(content).toContain('@keyframes waModalSpring');

    // YouTube channel & membership modal card
    expect(content).toContain('.yt-modal-card');
    expect(content).toContain('animation: ytModalSpring 0.35s cubic-bezier(0.16, 1, 0.3, 1);');
    expect(content).toContain('@keyframes ytModalSpring');

    // Ephemeral story modal card
    expect(content).toContain('.story-card-modal');
    expect(content).toContain('animation: storyModalSpring 0.38s cubic-bezier(0.16, 1, 0.3, 1);');
    expect(content).toContain('@keyframes storyModalSpring');

    // Nav drawer and mobile sheet
    expect(content).toContain('cubic-bezier(0.16, 1, 0.3, 1)');
  });

  it('verifies YouTube P2P player contains directional seek ripple markup and styles', () => {
    // Ripple elements
    expect(content).toContain('id="ytSeekRippleLeft"');
    expect(content).toContain('id="ytSeekRippleRight"');
    expect(content).toContain('class="yt-seek-ripple yt-seek-ripple-left"');
    expect(content).toContain('class="yt-seek-ripple yt-seek-ripple-right"');
    expect(content).toContain('class="yt-seek-ripple-circle"');
    expect(content).toContain('class="yt-seek-arrows"');
    expect(content).toContain('class="yt-seek-seconds"');

    // CSS rules
    expect(content).toContain('.yt-seek-ripple {');
    expect(content).toContain('.yt-seek-ripple-left {');
    expect(content).toContain('.yt-seek-ripple-right {');
    expect(content).toContain('.yt-seek-ripple.active');
    expect(content).toContain('@keyframes ytSeekBounce');
  });

  it('verifies client JS handles double-tap seek with relative positioning and ripple triggers', () => {
    expect(content).toContain('function triggerYtSeekRipple(direction)');
    expect(content).toContain('function handleYtPlayerBoxClick(event)');
    expect(content).toContain('seekRelative(-10)');
    expect(content).toContain('seekRelative(10)');
    expect(content).toContain('triggerYtSeekRipple(\'left\')');
    expect(content).toContain('triggerYtSeekRipple(\'right\')');
  });

  it('strictly preserves the critical legacy navigation and badge override block verbatim', () => {
    const criticalBlock = `.ops-console-rail-link,
    #tab-admin,
    #bnav-admin,
    #bnav-friends,
    .node-status-pill,
    #bitchatModeBar,
    #bitchatRadarContainer,
    .tcp-port-badge,
    .app-left-rail,
    .mobile-bottom-nav,
    #currentUserHandleText {
      display: none !important;
    }`;

    // Normalize whitespace for reliable assertion
    const normalize = (str: string) => str.replace(/\s+/g, ' ').trim();
    expect(normalize(content)).toContain(normalize(criticalBlock));
  });
});
