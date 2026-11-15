/**
 * @file apps/sovra-app/src/modules/chat-webrtc.ts
 * Sovra Modular Client: WebRTC Audio/Video Calls & E2EE Direct Messaging
 */

export interface CallSession {
  callId: string;
  peerDid: string;
  peerName: string;
  isVideo: boolean;
  state: 'connecting' | 'connected' | 'ended';
}

export function initChatWebRtcModule(): void {
  if (typeof window === 'undefined') return;

  (window as any).SovraChatEngine = {
    activeCall: null as CallSession | null,
    localStream: null as MediaStream | null,
    peerConnection: null as RTCPeerConnection | null,

    startCall: async function(peerDid: string, peerName: string, isVideo: boolean = false): Promise<void> {
      console.log(`[WebRTC] Initiating ${isVideo ? 'video' : 'voice'} call to: ${peerName} (${peerDid})`);
      this.activeCall = {
        callId: `call-${Date.now()}`,
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
    },

    endCall: function(): void {
      console.log('[WebRTC] Terminating call session.');
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

  console.log('[Sovra] Chat & WebRTC module initialized.');
}
