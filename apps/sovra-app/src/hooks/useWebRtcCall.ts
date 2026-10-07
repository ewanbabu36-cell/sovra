/**
 * @file apps/sovra-app/src/hooks/useWebRtcCall.ts
 * Client Hook: WhatsApp-Style E2EE Live WebRTC Audio/Video Calling Controller.
 *
 * Implements:
 * 1. P2P Call signaling over decentralized Noise_XX / GossipSub.
 * 2. Real-time call timer & duration tracking.
 * 3. Audio mute, camera video toggle, and speakerphone toggling.
 * 4. Call quality metrics (RTT, packet loss, connection tier).
 */

import {
  WebRtcCallEngine,
  type CallMediaType,
  type CallSessionSnapshot,
  type CallQualityMetrics,
  type CallSignalingMessage,
  type CallEndReason,
} from '@sovra/messaging';

export interface UseWebRtcCallReturn {
  readonly session: CallSessionSnapshot | null;
  readonly isInCall: boolean;
  readonly isRinging: boolean;
  readonly metrics: CallQualityMetrics | null;
  startCall(peerDid: string, peerName: string, mediaType: CallMediaType): CallSignalingMessage;
  answerCall(): CallSignalingMessage | null;
  rejectCall(): CallSignalingMessage | null;
  endCall(reason?: CallEndReason): CallSignalingMessage | null;
  toggleAudio(): boolean;
  toggleVideo(): boolean;
  toggleSpeaker(): boolean;
}

export function createWebRtcCallSession(
  localDid: string,
  localPrivateKey: Uint8Array,
  localPublicKeyBytes: Uint8Array,
): UseWebRtcCallReturn {
  const engine = new WebRtcCallEngine(localDid, localPrivateKey, localPublicKeyBytes);

  return {
    get session() {
      return engine.session;
    },
    get isInCall() {
      return engine.session?.state === 'active';
    },
    get isRinging() {
      const state = engine.session?.state;
      return state === 'incoming_ringing' || state === 'outgoing_ringing';
    },
    get metrics() {
      return engine.metrics;
    },
    startCall(peerDid: string, peerName: string, mediaType: CallMediaType) {
      const { message } = engine.createCallOffer(peerDid, peerName, mediaType);
      return message;
    },
    answerCall() {
      const res = engine.acceptCall();
      return res.ok ? res.value : null;
    },
    rejectCall() {
      return engine.endCall('rejected');
    },
    endCall(reason: CallEndReason = 'normal') {
      return engine.endCall(reason);
    },
    toggleAudio() {
      return engine.toggleAudio();
    },
    toggleVideo() {
      return engine.toggleVideo();
    },
    toggleSpeaker() {
      return engine.toggleSpeaker();
    },
  };
}
