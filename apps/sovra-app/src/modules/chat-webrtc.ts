/**
 * @file apps/sovra-app/src/modules/chat-webrtc.ts
 * Sovra Modular Client: WebRTC Audio/Video Calls & E2EE Direct Messaging
 *
 * Implements pure decentralized, direct browser-to-browser WebRTC signaling
 * using Noise XX encrypted GossipSub topics (/sovra/v1/signal/{targetDid})
 * without relying on centralized or local Node.js /api/call/* HTTP endpoints.
 */

import type { P2PSignalingChannel, DecryptedSignal, SignalPayload } from '@sovra/p2p';

export interface CallSession {
  callId: string;
  peerDid: string;
  peerName: string;
  isVideo: boolean;
  state: 'connecting' | 'connected' | 'ended';
}

function resolveWebRtcIceServers(): RTCIceServer[] {
  if (typeof window !== 'undefined') {
    const win = window as any;
    if (Array.isArray(win.SOVRA_ICE_SERVERS)) {
      return win.SOVRA_ICE_SERVERS;
    }
    try {
      const saved = window.localStorage?.getItem('sovra_ice_servers');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
      const customStun = window.localStorage?.getItem('sovra_custom_stun_v1');
      if (customStun) {
        const parsedStun = JSON.parse(customStun);
        if (Array.isArray(parsedStun) && parsedStun.length > 0) {
          const mapped = parsedStun
            .map((entry: unknown) => String(entry ?? '').trim())
            .filter(Boolean)
            .map((entry: string) => ({
              urls: /^(stun|stuns|turn|turns):/i.test(entry) ? entry : `stun:${entry}`,
            }));
          if (mapped.length > 0) return mapped;
        }
      }
      if (win.SOVRA_ALLOW_PUBLIC_STUN === true || window.localStorage?.getItem('sovra_allow_public_stun') === 'true') {
        return [{ urls: 'stun:stun.l.google.com:19302' }];
      }
    } catch {}
  }
  return [];
}

export function initChatWebRtcModule(): void {
  if (typeof window === 'undefined') return;

  (window as any).SovraChatEngine = {
    activeCall: null as CallSession | null,
    localStream: null as MediaStream | null,
    peerConnection: null as RTCPeerConnection | null,
    signalingChannel: null as P2PSignalingChannel | null,

    setSignalingChannel: function(channel: P2PSignalingChannel): void {
      this.signalingChannel = channel;
      channel.onSignal((signal: DecryptedSignal) => {
        this.handleIncomingSignal(signal);
      });
      console.log('[WebRTC] P2PSignalingChannel bound directly to GossipSub mesh.');
    },

    startCall: async function(peerDid: string, peerName: string, isVideo: boolean = false): Promise<void> {
      console.log(`[WebRTC] Initiating direct P2P ${isVideo ? 'video' : 'voice'} call to: ${peerName} (${peerDid})`);
      const callId = `call-${Date.now()}`;
      this.activeCall = {
        callId,
        peerDid,
        peerName,
        isVideo,
        state: 'connecting',
      };

      const modal = document.getElementById('webrtcCallModal');
      if (modal) {
        modal.style.display = 'flex';
        const title = document.getElementById('webrtcCallPeerName');
        if (title) title.textContent = peerName;
      }

      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: isVideo ? { facingMode: 'user' } : false,
          });
          const localVideo = document.getElementById('localCallVideo') as HTMLVideoElement;
          if (localVideo && isVideo) {
            localVideo.srcObject = this.localStream;
            localVideo.play().catch(() => {});
          }
        }
      } catch (err) {
        console.warn('[WebRTC] Media stream access notice:', err);
      }

      // 1. Initialize Direct WebRTC Peer Connection with Configured ICE Servers
      const pc = new RTCPeerConnection({
        iceServers: resolveWebRtcIceServers(),
      });
      this.peerConnection = pc;

      // 2. Attach Local Media Tracks
      if (this.localStream) {
        this.localStream.getTracks().forEach((track: MediaStreamTrack) => {
          pc.addTrack(track, this.localStream!);
        });
      }

      // 3. ICE Candidate Direct Dispatch over GossipSub
      pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate && this.signalingChannel && this.activeCall) {
          const targetPubKeyHex = (window as any)._peerX25519Keys?.[peerDid] || '00'.repeat(32);
          const candidatePayload: SignalPayload = {
            callId,
            type: 'candidate',
            candidate: event.candidate.toJSON(),
          };
          this.signalingChannel.sendSignal(peerDid, targetPubKeyHex, candidatePayload).catch((e: any) => {
            console.warn('[WebRTC] P2P ICE dispatch warning:', e);
          });
        }
      };

      // 4. Remote Track Ingestion
      pc.ontrack = (event: RTCTrackEvent) => {
        console.log('[WebRTC] Remote media track received:', event.track.kind);
        const remoteVideo = document.getElementById('remoteCallVideo') as HTMLVideoElement;
        if (remoteVideo && event.streams[0]) {
          remoteVideo.srcObject = event.streams[0];
          remoteVideo.play().catch(() => {});
        }
      };

      // 5. Generate SDP Offer & Send directly through Noise XX encrypted GossipSub channel
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        if (this.signalingChannel) {
          const targetPubKeyHex = (window as any)._peerX25519Keys?.[peerDid] || '00'.repeat(32);
          const offerPayload: SignalPayload = {
            callId,
            type: 'offer',
            callType: isVideo ? 'video' : 'voice',
            sdp: offer.sdp,
          };
          await this.signalingChannel.sendSignal(peerDid, targetPubKeyHex, offerPayload);
          console.log('[WebRTC] Direct P2P SDP Offer dispatched to GossipSub:', `/sovra/v1/signal/${peerDid}`);
        } else {
          console.log('[WebRTC] P2P signaling active locally (waiting for receiver connection).');
        }
      } catch (err) {
        console.error('[WebRTC] SDP Offer generation error:', err);
      }
    },

    handleIncomingSignal: async function(signal: DecryptedSignal): Promise<void> {
      const { payload, senderDid } = signal;
      console.log(`[WebRTC] Received direct P2P signal (${payload.type}) from ${senderDid}`);

      if (payload.type === 'offer') {
        this.activeCall = {
          callId: payload.callId,
          peerDid: senderDid,
          peerName: senderDid.slice(-8),
          isVideo: payload.callType === 'video',
          state: 'connecting',
        };

        const modal = document.getElementById('webrtcCallModal');
        if (modal) {
          modal.style.display = 'flex';
          const title = document.getElementById('webrtcCallPeerName');
          if (title) title.textContent = `Incoming: ${senderDid.slice(-8)}`;
        }

        const pc = new RTCPeerConnection({
          iceServers: resolveWebRtcIceServers(),
        });
        this.peerConnection = pc;

        if (this.localStream) {
          this.localStream.getTracks().forEach((track: MediaStreamTrack) => {
            pc.addTrack(track, this.localStream!);
          });
        }

        pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
          if (event.candidate && this.signalingChannel) {
            const targetPubKeyHex = (window as any)._peerX25519Keys?.[senderDid] || '00'.repeat(32);
            this.signalingChannel.sendSignal(senderDid, targetPubKeyHex, {
              callId: payload.callId,
              type: 'candidate',
              candidate: event.candidate.toJSON(),
            }).catch(() => {});
          }
        };

        pc.ontrack = (event: RTCTrackEvent) => {
          const remoteVideo = document.getElementById('remoteCallVideo') as HTMLVideoElement;
          if (remoteVideo && event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.play().catch(() => {});
          }
        };

        if (payload.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: payload.sdp }));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          if (this.signalingChannel) {
            const targetPubKeyHex = (window as any)._peerX25519Keys?.[senderDid] || '00'.repeat(32);
            await this.signalingChannel.sendSignal(senderDid, targetPubKeyHex, {
              callId: payload.callId,
              type: 'answer',
              sdp: answer.sdp,
            });
            console.log('[WebRTC] Direct P2P SDP Answer dispatched to GossipSub:', `/sovra/v1/signal/${senderDid}`);
          }
        }
      } else if (payload.type === 'answer') {
        if (this.peerConnection && payload.sdp) {
          await this.peerConnection.setRemoteDescription(
            new RTCSessionDescription({ type: 'answer', sdp: payload.sdp })
          );
          if (this.activeCall) this.activeCall.state = 'connected';
          console.log('[WebRTC] Direct P2P Call Session established!');
        }
      } else if (payload.type === 'candidate') {
        if (this.peerConnection && payload.candidate) {
          try {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch (e) {
            console.warn('[WebRTC] Direct ICE candidate error:', e);
          }
        }
      } else if (payload.type === 'end') {
        this.endCall();
      }
    },

    endCall: function(): void {
      console.log('[WebRTC] Terminating direct P2P call session.');
      if (this.activeCall && this.signalingChannel) {
        const targetPubKeyHex = (window as any)._peerX25519Keys?.[this.activeCall.peerDid] || '00'.repeat(32);
        this.signalingChannel.sendSignal(this.activeCall.peerDid, targetPubKeyHex, {
          callId: this.activeCall.callId,
          type: 'end',
        }).catch(() => {});
      }

      if (this.localStream) {
        this.localStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        this.localStream = null;
      }
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }
      this.activeCall = null;

      const modal = document.getElementById('webrtcCallModal');
      if (modal) modal.style.display = 'none';
      if ((window as any).showAccountToast) {
        (window as any).showAccountToast('Call ended.', 'info');
      }
    },

    toggleMic: function(): void {
      if (!this.localStream) return;
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const btn = document.getElementById('btnToggleCallMic');
        if (btn) btn.textContent = audioTrack.enabled ? '🎙️' : '🔇';
      }
    },

    toggleCamera: function(): void {
      if (!this.localStream) return;
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        const btn = document.getElementById('btnToggleCallCam');
        if (btn) btn.textContent = videoTrack.enabled ? '📹' : '🚫';
      }
    },
  };

  // Global helper aliases for HTML onclick handlers
  (window as any).startDirectCall = function(peerDid: string, peerName: string, isVideo: boolean = false): void {
    (window as any).SovraChatEngine.startCall(peerDid, peerName, isVideo);
  };
  (window as any).endDirectCall = function(): void {
    (window as any).SovraChatEngine.endCall();
  };
  (window as any).toggleCallMic = function(): void {
    (window as any).SovraChatEngine.toggleMic();
  };
  (window as any).toggleCallCam = function(): void {
    (window as any).SovraChatEngine.toggleCamera();
  };

  console.log('[Sovra] Chat & WebRTC pure P2P signaling module initialized.');
}
