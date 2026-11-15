/**
 * @file apps/sovra-app/src/modules/index.ts
 * Master Export & Initialization for Sovra Modular Client Architecture
 */

import { initFeedModule } from './feed.js';
import { initChatWebRtcModule } from './chat-webrtc.js';
import { initWalletCryptoModule } from './wallet-crypto.js';
import { initReelsModule } from './reels.js';
import { initP2pMeshModule } from './p2p-mesh.js';
import { initXrSpatialModule } from './xr-spatial.js';

export * from './feed.js';
export * from './chat-webrtc.js';
export * from './wallet-crypto.js';
export * from './reels.js';
export * from './p2p-mesh.js';
export * from './xr-spatial.js';

export function initializeAllSovraModules(): void {
  if (typeof window === 'undefined') return;

  // Hydrate Initial State from DOM Script Tag if present
  try {
    const stateEl = document.getElementById('sovra-hydrated-state');
    if (stateEl && stateEl.textContent) {
      (window as any).__SOVRA_HYDRATED_STATE__ = JSON.parse(stateEl.textContent);
      if ((window as any).__SOVRA_HYDRATED_STATE__.hostSession) {
        (window as any).SOVRA_HOST_SESSION = (window as any).__SOVRA_HYDRATED_STATE__.hostSession;
      }
      console.log('[Sovra] Hydrated initial state successfully.');
    }
  } catch (err) {
    console.warn('[Sovra] State hydration notice:', err);
  }

  initFeedModule();
  initChatWebRtcModule();
  initWalletCryptoModule();
  initReelsModule();
  initP2pMeshModule();
  initXrSpatialModule();

  console.log('[Sovra] All 6 modern client modules initialized.');
}
