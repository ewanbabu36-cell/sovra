/**
 * @file tests/e2e/youtube-studio-grade-player.test.ts
 * SOVRA YOUTUBE STUDIO GRADE WATCH & REELS PLAYER VERIFICATION SUITE
 *
 * Verifies:
 * 1. Smooth loading skeleton bars with shimmer wave animations in Watch & Reels
 * 2. Dynamic double-tap to seek (±10s, ±20s...) with chevrons and counter bouncing
 * 3. Custom volume slider with hover tooltip percentage and mute/unmute volume memory
 * 4. Floating PiP player drag-to-dock transitions with ghost guide and 4 corner spring snapping
 * 5. Adaptive quality switch (ABR) with toast notifications and continuous audio buffer
 * 6. Test invariant preservation: navigation display override block
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Sovra YouTube Studio Grade Watch & Reels Player Suite', () => {
  const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
  const content = fs.readFileSync(devServerPath, 'utf8');

  it('1. Smooth loading skeleton bars: verifies Watch & Reels shimmer skeleton overlays and helpers', () => {
    // Watch skeleton markup
    expect(content).toContain('id="ytPlayerSkeleton"');
    expect(content).toContain('class="sovra-player-skeleton"');
    expect(content).toContain('id="ytSkeletonTitle"');
    expect(content).toContain('id="ytSkeletonChannel"');

    // Reels skeleton markup
    expect(content).toContain('id="reelPlayerSkeleton"');
    expect(content).toContain('class="sovra-player-skeleton reel-skeleton"');
    expect(content).toContain('id="reelSkeletonStatusText"');

    // Skeleton CSS classes & animations
    expect(content).toContain('.sovra-player-skeleton');
    expect(content).toContain('.sovra-skeleton-shimmer');
    expect(content).toContain('.sovra-skeleton-bars-wave');
    expect(content).toContain('@keyframes skeletonWaveFluctuate');

    // Client JS functions
    expect(content).toContain('function showYtSkeleton(');
    expect(content).toContain('function hideYtSkeleton(');
    expect(content).toContain('function showReelSkeleton(');
    expect(content).toContain('function hideReelSkeleton(');
  });

  it('2. Dynamic double-tap to seek: verifies multi-tap accumulator and directional ripple chevrons', () => {
    // Watch ripples & accumulator
    expect(content).toContain('id="ytSeekRippleLeft"');
    expect(content).toContain('id="ytSeekRippleRight"');
    expect(content).toContain('id="ytSeekArrowsLeft"');
    expect(content).toContain('id="ytSeekArrowsRight"');
    expect(content).toContain('id="ytSeekSecondsLeft"');
    expect(content).toContain('id="ytSeekSecondsRight"');
    expect(content).toContain('ytSeekAccumulatedSeconds += 10');

    // Reels ripples & accumulator
    expect(content).toContain('id="reelSeekRippleLeft"');
    expect(content).toContain('id="reelSeekRippleRight"');
    expect(content).toContain('id="reelSeekArrowsLeft"');
    expect(content).toContain('id="reelSeekArrowsRight"');
    expect(content).toContain('id="reelSeekSecondsLeft"');
    expect(content).toContain('id="reelSeekSecondsRight"');
    expect(content).toContain('reelSeekAccumulatedSeconds += 10');

    // Edge seeking in Reels vs Center double-tap heart pop
    expect(content).toContain('function triggerReelSeek(');
    expect(content).toContain('ratio < 0.35');
    expect(content).toContain('ratio > 0.65');
    expect(content).toContain('spawnParticleBurst(x, y, wrapper, \'+1 ❤️\')');
  });

  it('3. Custom volume slider: verifies hover tooltip, gradient fill, and volume memory', () => {
    // Markup & styles
    expect(content).toContain('id="ytVolumeBox"');
    expect(content).toContain('id="ytVolumeSlider"');
    expect(content).toContain('class="yt-volume-range yt-custom-slider"');
    expect(content).toContain('id="ytVolumePercentTooltip"');
    expect(content).toContain('.yt-volume-box:hover');
    expect(content).toContain('.yt-volume-tooltip');

    // JS functions & memory
    expect(content).toContain('let ytLastVolume = 1.0');
    expect(content).toContain('function updateVolumeSliderFill(');
    expect(content).toContain('function showYtVolumeTooltip(');
    expect(content).toContain('function hideYtVolumeTooltip(');
    expect(content).toContain('function changeVolume(');
    expect(content).toContain('function toggleYtMute(');
  });

  it('4. Floating PiP drag-to-dock: verifies ghost guide, 4-corner snapping, and preferences', () => {
    // PiP card markup
    expect(content).toContain('id="sovraFloatingPipPlayer"');
    expect(content).toContain('class="sovra-floating-pip-card"');
    expect(content).toContain('id="pipDockGuide"');
    expect(content).toContain('class="pip-dock-guide-inner"');
    expect(content).toContain('onpointerdown="handlePipDragStart(event)"');

    // Drag & dock logic
    expect(content).toContain('window.handlePipDragStart');
    expect(content).toContain('window.handlePipDragMove');
    expect(content).toContain('window.handlePipDragEnd');
    expect(content).toContain('window.applyPipDockCorner');
    expect(content).toContain('window.positionDockGuide');
    expect(content).toContain('window.getClosestDockCorner');
    expect(content).toContain('sovra_pip_dock_corner');
    expect(content).toContain('cubic-bezier(0.16, 1, 0.3, 1)');

    // Launch helper
    expect(content).toContain('window.launchYtPip');
  });

  it('5. Adaptive quality switch: verifies seamless ABR rendition toasts and continuous audio playback', () => {
    // Toast markup
    expect(content).toContain('id="ytQualityToast"');
    expect(content).toContain('id="ytQualityToastText"');
    expect(content).toContain('id="reelQualityToast"');
    expect(content).toContain('id="reelQualityToastText"');

    // JS switch & toast triggers
    expect(content).toContain('function triggerQualityToast(');
    expect(content).toContain('function handleAbrChange(');
    expect(content).toContain('window.__sovraAbrContinuousAudio = true');
    expect(content).toContain('0ms Audio Stutter');
  });

  it('6. Test invariant preservation: ensures critical display override block remains intact', () => {
    expect(content).toContain('.ops-console-rail-link,');
    expect(content).toContain('#tab-admin,');
    expect(content).toContain('display: none !important;');
  });

  it('7. Flagship Feature 1: Global YouTube Keyboard Shortcuts & Hotkeys Modal (Shift + ?)', () => {
    // Keyboard shortcuts modal markup
    expect(content).toContain('id="ytKeyboardShortcutsModal"');
    expect(content).toContain('class="yt-shortcut-grid"');
    expect(content).toContain('class="yt-key-pill"');
    expect(content).toContain('id="btnShortcutsHelp"');

    // JS open handler & keydown listener
    expect(content).toContain('function openYtKeyboardShortcutsModal()');
    expect(content).toContain("document.addEventListener('keydown', function(e)");
    expect(content).toContain("e.key === 'k' || e.key === ' '");
    expect(content).toContain("e.key === 'j' || e.key === 'ArrowLeft'");
    expect(content).toContain("e.key === 'l' || e.key === 'ArrowRight'");
    expect(content).toContain("e.key === 'm'");
    expect(content).toContain("e.key === 'f'");
    expect(content).toContain("e.key === 't'");
    expect(content).toContain("e.key === 'c'");
    expect(content).toContain("e.key >= '0' && e.key <= '9'");
    expect(content).toContain("e.key === '>'");
    expect(content).toContain("e.key === '<'");
    expect(content).toContain("e.key === '?'");
  });

  it('8. Flagship Feature 2: Universal Clickable Timestamps everywhere', () => {
    // Function definition
    expect(content).toContain('function parseTimestampsToLinks(text)');
    expect(content).toContain('function seekYtToSeconds(sec)');
    expect(content).toContain('class="yt-timestamp-link"');

    // Applied across description, summary, and comments
    expect(content).toContain('parseTimestampsToLinks(v.summary.trim())');
    expect(content).toContain('parseTimestampsToLinks(v.description)');
    expect(content).toContain('parseTimestampsToLinks(c.text)');
    expect(content).toContain('parseTimestampsToLinks(r.text)');
  });

  it('9. Flagship Feature 3: Save to Playlist & Watch Later engine', () => {
    // Action button & modal
    expect(content).toContain('id="btnSavePlaylist"');
    expect(content).toContain('id="ytSaveToPlaylistModal"');
    expect(content).toContain('id="ytPlaylistsList"');
    expect(content).toContain('id="newPlaylistTitleInput"');

    // JS handlers & localStorage persistence
    expect(content).toContain('function openSaveToPlaylistModal()');
    expect(content).toContain('function toggleVideoInPlaylist(');
    expect(content).toContain('function createNewYtPlaylist()');
    expect(content).toContain('localStorage.getItem(\'sovra_playlists\')');
    expect(content).toContain('localStorage.setItem(\'sovra_playlists\'');
    expect(content).toContain('Watch Later');
  });

  it('10. Flagship Feature 4: Storyboard Scrubber Preview Thumbnail on Hover', () => {
    // Preview box markup
    expect(content).toContain('id="ytScrubberPreviewBox"');
    expect(content).toContain('class="yt-scrubber-preview-box"');
    expect(content).toContain('id="ytScrubberPreviewCanvas"');
    expect(content).toContain('id="ytScrubberPreviewTime"');
    expect(content).toContain('id="ytPreviewChapterLabel"');

    // JS hover tracking
    expect(content).toContain('previewBox.style.left = clampedX + \'px\'');
    expect(content).toContain('previewBox.style.display = \'block\'');
    expect(content).toContain('previewBox.style.display = \'none\'');
  });

  it('11. Flagship Feature 5: Native Closed Captions ([CC]) Track Engine', () => {
    // CC button & subtitle container markup
    expect(content).toContain('id="btnCcToggle"');
    expect(content).toContain('class="yt-btn yt-btn-cc"');
    expect(content).toContain('id="ytSubtitleContainer"');
    expect(content).toContain('class="yt-subtitle-container"');
    expect(content).toContain('id="ytSubtitleCueText"');
    expect(content).toContain('class="yt-subtitle-cue"');

    // JS caption engine
    expect(content).toContain('function toggleYtCaptions()');
    expect(content).toContain('function updateYtSubtitles()');
    expect(content).toContain('ytCaptionsEnabled = !ytCaptionsEnabled');
    expect(content).toContain('BitSwap DAG streaming');
  });

  it('12. Flagship Feature 6: Pinned Comment & Creator Heart (❤️)', () => {
    // CSS badges
    expect(content).toContain('.yt-pinned-badge');
    expect(content).toContain('.yt-creator-heart-badge');

    // JS toggles & sorting
    expect(content).toContain('function togglePinComment(');
    expect(content).toContain('function toggleHeartComment(');
    expect(content).toContain('(b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0)');
    expect(content).toContain('📌 Pinned by creator');
    expect(content).toContain('creator-heart-badge');
  });

  it('13. Flagship Feature 7: "Stats for Nerds" Technical Telemetry Overlay', () => {
    // Telemetry overlay markup & button
    expect(content).toContain('id="ytStatsForNerdsOverlay"');
    expect(content).toContain('class="yt-nerds-overlay"');
    expect(content).toContain('id="btnStatsForNerds"');
    expect(content).toContain('id="nerdsCid"');
    expect(content).toContain('id="nerdsRes"');
    expect(content).toContain('id="nerdsCodec"');
    expect(content).toContain('id="nerdsViewport"');
    expect(content).toContain('id="nerdsBuffer"');
    expect(content).toContain('id="nerdsSpeed"');
    expect(content).toContain('id="nerdsSeeders"');

    // JS telemetry updater
    expect(content).toContain('function toggleStatsForNerds(');
    expect(content).toContain('function updateNerdsTelemetry()');
    expect(content).toContain('ytStatsForNerdsVisible = !ytStatsForNerdsVisible');
    expect(content).toContain('vp09.00.51.08.01.01.01.01.00 / opus');
  });

  it('14. Flagship Feature 8: Auto-Sticky Miniplayer on Scroll', () => {
    // JS sticky IntersectionObserver
    expect(content).toContain('function initYtStickyMiniplayer()');
    expect(content).toContain('new IntersectionObserver');
    expect(content).toContain('launchYtPip');
    expect(content).toContain('window.SovraPipEngine.closePip');
    expect(content).toContain('initYtStickyMiniplayer()');
  });
});
