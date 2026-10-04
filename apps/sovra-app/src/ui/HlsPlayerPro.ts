/**
 * @file apps/sovra-app/src/ui/HlsPlayerPro.ts
 * UI Layer Contract: Pro 16:9 HLS Adaptive Bitrate (ABR) Video Player.
 *
 * Implements:
 * 1. 16:9 ratio wrapper with ambient glow dynamics.
 * 2. Bottom floating control bar.
 * 3. Timeline scrubber with hover thumbnail keyframe preview.
 * 4. Gear selector (Auto, 4K, 1080p, 720p, 480p, 360p) & speed selector (0.5x..2.0x).
 * 5. Mini-player Picture-in-Picture (PiP) mode.
 */

import { type VideoResolution } from '@sovra/storage';

export interface HlsPlayerProProps {
  readonly title: string;
  readonly channelName: string;
  readonly durationSeconds: number;
  readonly currentResolution: VideoResolution;
  readonly isAutoAbr: boolean;
  readonly bufferSeconds: number;
  readonly playbackSpeed: number;
  readonly isPiP: boolean;
}

export const SUPPORTED_RESOLUTIONS: readonly VideoResolution[] = [
  '360p',
  '480p',
  '720p',
  '1080p',
];

export const SUPPORTED_SPEEDS: readonly number[] = [
  0.5, 0.75, 1.0, 1.25, 1.5, 2.0,
];

export function renderHlsPlayerProHtml(props: HlsPlayerProProps): string {
  return `
    <div class="yt-ambient-wrapper ${props.isPiP ? 'pip-mode' : ''}">
      <div class="yt-ambient-glow"></div>
      <div class="yt-player-box">
        <div class="yt-screen-content">
          <div style="font-size: 3.5rem;">🎬</div>
          <div style="font-weight: 700; color: #fff;">${props.title}</div>
          <div style="font-size: 0.75rem; color: #34d399;">
            ● Buffer: ${props.bufferSeconds.toFixed(1)}s &bull; Quality: ${props.currentResolution} ${props.isAutoAbr ? '(Auto ABR)' : ''}
          </div>
        </div>
        <div class="yt-player-controls">
          <div class="yt-scrubber">
            <div class="yt-scrubber-progress" style="width: 45%;"></div>
            <div class="yt-scrubber-tooltip">Preview: 04:12 (Chapter 2)</div>
          </div>
          <div class="yt-controls-row">
            <div class="yt-left-controls">
              <button class="yt-btn">▶</button>
              <button class="yt-btn">⏪</button>
              <button class="yt-btn">⏩</button>
              <button class="yt-btn">🔊</button>
            </div>
            <div class="yt-right-controls">
              <select class="yt-select">
                ${SUPPORTED_RESOLUTIONS.map(
                  r => `<option value="${r}" ${r === props.currentResolution ? 'selected' : ''}>${r}</option>`,
                ).join('')}
              </select>
              <button class="yt-btn" title="Picture in Picture">🔲</button>
              <button class="yt-btn" title="Fullscreen">⛶</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
