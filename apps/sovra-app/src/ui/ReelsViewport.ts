/**
 * @file apps/sovra-app/src/ui/ReelsViewport.ts
 * UI Layer Contract: Fullscreen Vertical Snap Carousel (Reels Engine).
 *
 * Implements:
 * 1. CSS scroll-snap-type: y mandatory parameters.
 * 2. 60fps spring gesture animation physics configs.
 * 3. Double-tap heart burst styling.
 * 4. Vinyl sound disc & visualizer contracts.
 */

export interface ReelsViewportProps {
  readonly reelId: string;
  readonly creatorHandle: string;
  readonly caption: string;
  readonly audioTrack: string;
  readonly likesCount: number;
  readonly commentsCount: number;
  readonly isPreWarmed: boolean;
  readonly decodeLatencyMs: number;
  readonly backgroundGradient?: string | undefined;
}

export interface ReelsGestureConfig {
  readonly snapType: 'y mandatory';
  readonly springDamping: number;
  readonly springStiffness: number;
  readonly doubleTapThresholdMs: number;
}

export const DEFAULT_REELS_GESTURE_CONFIG: ReelsGestureConfig = {
  snapType: 'y mandatory',
  springDamping: 28,
  springStiffness: 300,
  doubleTapThresholdMs: 300,
};

export function renderReelsViewportHtml(props: ReelsViewportProps): string {
  return `
    <div class="reels-phone" style="scroll-snap-type: y mandatory;">
      <div class="reels-header-pill">
        <div class="p2p-badge-pill">
          <span>⚡</span>
          <span>${props.isPreWarmed ? `Pre-Warmed (${props.decodeLatencyMs}ms decode)` : 'Streaming'}</span>
        </div>
      </div>
      <div class="reels-canvas-wrapper" style="background: ${props.backgroundGradient ?? '#000'};">
        <div class="reel-visualizer">
          <span style="font-size: 3.2rem;">🎬</span>
        </div>
      </div>
      <div class="reels-right-actions">
        <div class="reel-action-btn">🤍 <span>${props.likesCount}</span></div>
        <div class="reel-action-btn">💬 <span>${props.commentsCount}</span></div>
        <div class="music-disc">🎵</div>
      </div>
      <div class="reels-bottom-overlay">
        <div class="reels-handle">@${props.creatorHandle}</div>
        <div class="reels-caption">${props.caption}</div>
        <div class="reels-audio-track">🎵 ${props.audioTrack}</div>
      </div>
    </div>
  `;
}
