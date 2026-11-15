/**
 * @file apps/sovra-app/src/modules/xr-spatial.ts
 * Sovra Modular Client: WebXR Spatial 3D Theater & Live Swarm Broadcast
 */

export function initXrSpatialModule(): void {
  if (typeof window === 'undefined') return;

  // 1. Live Stream Swarm Broadcast Engine
  (window as any).SovraLiveStreamEngine = {
    activeSessionId: null as string | null,
    isHost: false,
    pollTimer: null as any,
    lastEventTimestamp: 0,

    openModal: function(sessionId?: string, isHost: boolean = false): void {
      const modal = document.getElementById('sovraLiveStreamModal');
      if (modal) modal.style.display = 'flex';
      this.isHost = Boolean(isHost);
      const hostControls = document.getElementById('liveBroadcasterControls');
      if (hostControls) hostControls.style.display = this.isHost ? 'flex' : 'none';

      if (sessionId) {
        this.activeSessionId = sessionId;
        this.joinStream(sessionId);
      } else {
        this.startLiveBroadcast('Sovereign Node Broadcast', 'tech');
      }
    },

    closeModal: function(): void {
      const modal = document.getElementById('sovraLiveStreamModal');
      if (modal) modal.style.display = 'none';
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    },

    startLiveBroadcast: async function(title?: string, category?: string): Promise<void> {
      try {
        const res = await fetch('/api/live/stream/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title || 'Live Mesh Swarm Broadcast',
            category: category || 'tech',
          }),
        });
        const data = await res.json();
        if (data && data.ok && data.session) {
          this.activeSessionId = data.session.id;
          this.isHost = true;
          if ((window as any).showAccountToast) {
            (window as any).showAccountToast('🔴 You are now LIVE on the decentralized mesh!', 'success');
          }
        }
      } catch (_) {}
    },

    joinStream: async function(sessionId: string): Promise<void> {
      this.activeSessionId = sessionId;
      try {
        await fetch('/api/live/stream/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
      } catch (_) {}
    },

    endBroadcast: async function(): Promise<void> {
      if (!this.activeSessionId) return;
      try {
        await fetch('/api/live/stream/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: this.activeSessionId }),
        });
      } catch (_) {}
      this.closeModal();
    },
  };

  // 2. Global Aliases for Live Modals
  (window as any).openLiveStreamModal = function(sessionId?: string, isHost?: boolean): void {
    (window as any).SovraLiveStreamEngine.openModal(sessionId, isHost);
  };
  (window as any).closeLiveStreamModal = function(): void {
    (window as any).SovraLiveStreamEngine.closeModal();
  };
  (window as any).endLiveBroadcast = function(): void {
    (window as any).SovraLiveStreamEngine.endBroadcast();
  };

  // 3. Spatial Channels & Pages Surface Controls
  (window as any).openSpatialChannelsPagesSurface = function(originEl?: HTMLElement): void {
    const modal = document.getElementById('spatialChannelsModal');
    if (modal) modal.style.display = 'flex';
  };
  (window as any).closeSpatialChannelsPagesSurface = function(): void {
    const modal = document.getElementById('spatialChannelsModal');
    if (modal) modal.style.display = 'none';
  };
  (window as any).openChannelBrowseModal = function(): void {
    (window as any).openSpatialChannelsPagesSurface();
  };

  console.log('[Sovra] XR & Spatial module initialized.');
}
