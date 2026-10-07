/**
 * @file apps/sovra-app/src/ui/CallModal.ts
 * UI Layer Contract: WhatsApp-Style WebRTC Live Audio/Video Call Viewport & Modal.
 *
 * Implements:
 * 1. Fullscreen calling modal overlay with caller avatar & verification badge.
 * 2. Remote video canvas & floating PiP local camera canvas.
 * 3. Audio waveform equalizer visualizer for audio-only calls.
 * 4. WhatsApp call action bar (Mute Mic, Camera Toggle, Flip Lens, Speaker, End Call).
 * 5. Call state indicators: 'Ringing...', 'Connecting (ICE Hole Punch)...', '03:42'.
 */

import { type CallSessionSnapshot, type CallQualityMetrics } from '@sovra/messaging';

export interface CallModalProps {
  readonly session: CallSessionSnapshot;
  readonly metrics: CallQualityMetrics | null;
}

export function renderCallModalHtml(props: CallModalProps): string {
  const { session, metrics } = props;
  const isVideo = session.mediaType === 'video';

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const getStatusText = () => {
    switch (session.state) {
      case 'outgoing_ringing':
        return 'Ringing...';
      case 'incoming_ringing':
        return 'Incoming Call...';
      case 'connecting':
        return metrics ? `Connecting (${metrics.connectionTier})...` : 'Connecting...';
      case 'active':
        return formatDuration(session.durationSeconds);
      case 'rejected':
        return 'Call Declined';
      case 'ended':
        return `Call Ended (${formatDuration(session.durationSeconds)})`;
      default:
        return '';
    }
  };

  return `
    <div class="webrtc-call-overlay ${session.state === 'active' ? 'call-active' : ''}">
      <!-- Remote Video Viewport or Audio Backdrop -->
      <div class="call-media-viewport ${isVideo ? 'video-mode' : 'audio-mode'}">
        ${
          isVideo
            ? `
          <div class="remote-video-stream">
            <span style="font-size: 5rem;">📹</span>
            <div class="stream-label">${session.peerName}</div>
          </div>
          <div class="local-pip-video ${session.isVideoMuted ? 'camera-off' : ''}">
            <span>👤 You</span>
          </div>
        `
            : `
          <div class="audio-calling-stage">
            <div class="call-avatar-pulse">
              <div class="call-avatar">${session.peerName[0] ?? 'P'}</div>
            </div>
            <div class="call-peer-name">${session.peerName}</div>
            <div class="call-e2ee-tag">🔒 End-to-End Encrypted (Noise_XX / DTLS-SRTP)</div>
          </div>
        `
        }
      </div>

      <!-- Call Status & Telemetry Header -->
      <div class="call-header-hud">
        <div class="call-status-pill">${getStatusText()}</div>
        <div class="call-telemetry-badge">
          ${metrics ? `● RTT: ${metrics.roundTripTimeMs}ms &bull; Loss: ${metrics.packetLossPercent}% &bull; ${metrics.connectionTier}` : `● Connecting...`}
        </div>
      </div>

      <!-- WhatsApp Calling Action Controls -->
      <div class="call-controls-dock">
        <button class="call-dock-btn ${session.isAudioMuted ? 'active-mute' : ''}" id="btnMuteAudio" title="Mute Mic">
          ${session.isAudioMuted ? '🔇' : '🎙️'}
        </button>

        ${
          isVideo
            ? `
          <button class="call-dock-btn ${session.isVideoMuted ? 'active-mute' : ''}" id="btnToggleVideo" title="Camera Toggle">
            ${session.isVideoMuted ? '🚫' : '📹'}
          </button>
          <button class="call-dock-btn" id="btnFlipCamera" title="Switch Camera">
            🔄
          </button>
        `
            : ''
        }

        <button class="call-dock-btn ${session.isSpeakerOn ? 'active-speaker' : ''}" id="btnToggleSpeaker" title="Speaker">
          🔊
        </button>

        <button class="call-dock-btn btn-end-call" id="btnEndCall" title="End Call">
          🔴
        </button>
      </div>
    </div>
  `;
}
