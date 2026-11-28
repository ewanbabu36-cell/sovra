/**
 * @file apps/sovra-mobile/src/services/native-wifi-direct-bridge.ts
 * Dual-runtime bridge for Android Wi-Fi Direct P2P (WebView window.SovraWifiDirectNative + React Native NativeModules).
 */

export interface WifiDirectPeerInfo {
  address: string;
  name: string;
  primaryType?: string;
  status?: number;
}

function getWifiDirectModule(): any {
  try {
    if (typeof window !== 'undefined' && (window as any).SovraWifiDirectNative) {
      return (window as any).SovraWifiDirectNative;
    }
    const RN = (globalThis as any).ReactNative || (globalThis as any).reactNative;
    if (RN?.NativeModules?.SovraWifiDirectNative) {
      return RN.NativeModules.SovraWifiDirectNative;
    }
    if ((globalThis as any).NativeModules?.SovraWifiDirectNative) {
      return (globalThis as any).NativeModules.SovraWifiDirectNative;
    }
  } catch {}
  return null;
}

export class NativeWifiDirectBridge {
  private readonly mod: any;

  constructor() {
    this.mod = getWifiDirectModule();
  }

  public isAvailable(): boolean {
    if (!this.mod || typeof this.mod.isAvailable !== 'function') return false;
    try {
      return Boolean(this.mod.isAvailable());
    } catch {
      return false;
    }
  }

  public hasPermissions(): boolean {
    if (!this.mod || typeof this.mod.hasPermissions !== 'function') return false;
    try {
      return Boolean(this.mod.hasPermissions());
    } catch {
      return false;
    }
  }

  public discoverPeers(): boolean {
    if (!this.mod || typeof this.mod.discoverPeers !== 'function') return false;
    try {
      return Boolean(this.mod.discoverPeers());
    } catch {
      return false;
    }
  }

  public connectPeer(deviceAddress: string): boolean {
    if (!this.mod || typeof this.mod.connectPeer !== 'function') return false;
    try {
      return Boolean(this.mod.connectPeer(deviceAddress));
    } catch {
      return false;
    }
  }

  public sendMediaPayload(targetHost: string, port: number, transferId: string, base64Data: string): boolean {
    if (!this.mod || typeof this.mod.sendMediaPayload !== 'function') return false;
    try {
      return Boolean(this.mod.sendMediaPayload(targetHost, port, transferId, base64Data));
    } catch {
      return false;
    }
  }

  public onPeerDiscovered(cb: (peer: WifiDirectPeerInfo) => void): () => void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return () => {};
    }
    const handler = (ev: any) => {
      if (ev?.detail?.address) cb(ev.detail as WifiDirectPeerInfo);
    };
    window.addEventListener('onWifiP2pDeviceDiscovered', handler);
    return () => window.removeEventListener('onWifiP2pDeviceDiscovered', handler);
  }
}

export const nativeWifiDirectBridge = new NativeWifiDirectBridge();
