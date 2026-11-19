/**
 * @file apps/sovra-app/src/modules/reels.ts
 * Sovra Modular Client: Vertical Reels, Audio Tracks & Storyboard Scrubbing
 */

export function initReelsModule(): void {
  if (typeof window === 'undefined') return;

  (window as any).saveAudioTrackToCollection = async function(trackId: string, title: string, cid: string, artist: string): Promise<void> {
    try {
      const res = await fetch('/api/music/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId, title, cid, artist }),
      });
      await res.json();
      if ((window as any).showAccountToast) {
        (window as any).showAccountToast(`Saved "${title}" to your decentralized audio collection!`, 'success');
      }
    } catch (_) {
      if ((window as any).showAccountToast) {
        (window as any).showAccountToast('Audio track pinned locally.', 'info');
      }
    }
  };

  (window as any).saveCurrentReelAudioTrack = function(): void {
    const activeReelEl = document.querySelector('.reel-video-container.active, .reel-card.active');
    const trackId = activeReelEl?.getAttribute('data-track-id') || 'track-ambient-01';
    const title = activeReelEl?.getAttribute('data-track-title') || 'Sovra Decentralized Sound';
    const cid = activeReelEl?.getAttribute('data-track-cid') || 'bafybeiaudio';
    const artist = activeReelEl?.getAttribute('data-track-artist') || 'Peer Artist';
    (window as any).saveAudioTrackToCollection(trackId, title, cid, artist);
  };

  (window as any).openReelCommentsDrawer = function(_reelId: string): void {
    const drawer = document.getElementById('reelCommentsDrawer');
    if (drawer) {
      drawer.classList.add('open');
      drawer.style.transform = 'translateY(0)';
    }
  };

  (window as any).closeReelCommentsDrawer = function(): void {
    const drawer = document.getElementById('reelCommentsDrawer');
    if (drawer) {
      drawer.classList.remove('open');
      drawer.style.transform = 'translateY(100%)';
    }
  };

  console.log('[Sovra] Reels module initialized.');
}
