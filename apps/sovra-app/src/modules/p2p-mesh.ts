/**
 * @file apps/sovra-app/src/modules/p2p-mesh.ts
 * Sovra Modular Client: P2P Mesh, Libp2p Telemetry & Hyperlocal BLE Swarm Radar
 */

export function initP2pMeshModule(): void {
  if (typeof window === 'undefined') return;

  (window as any).SovraBleEngine = {
    isScanning: false,
    peers: [] as any[],

    async scanNearbyMesh(): Promise<void> {
      console.log('[BLE] Starting Hyperlocal BLE mesh scan...');
      this.isScanning = true;
      if (typeof navigator !== 'undefined' && (navigator as any).bluetooth) {
        try {
          const device = await (navigator as any).bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: ['battery_service'],
          });
          console.log('[BLE] Found hardware peer device:', device.name);
        } catch (e) {
          console.log('[BLE] Web Bluetooth discovery fallback:', e);
        }
      }
    },

    stopScan(): void {
      this.isScanning = false;
      console.log('[BLE] Stopped BLE scanning.');
    },
  };

  (window as any).openBitchatRadar = function(): void {
    const modal = document.getElementById('bitchatRadarModal');
    if (modal) modal.style.display = 'flex';
    (window as any).SovraBleEngine.scanNearbyMesh();
  };

  (window as any).closeBitchatRadar = function(): void {
    const modal = document.getElementById('bitchatRadarModal');
    if (modal) modal.style.display = 'none';
    (window as any).SovraBleEngine.stopScan();
  };

  (window as any).registerPeerOnLan = async function(customProfile?: any): Promise<void> {
    try {
      await fetch('/api/lan/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customProfile || {}),
      });
    } catch (_) {}
  };

  console.log('[Sovra] P2P & Mesh module initialized.');
}
