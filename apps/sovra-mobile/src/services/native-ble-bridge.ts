/**
 * @file apps/sovra-mobile/src/services/native-ble-bridge.ts
 * React Native Native-Module Bridge Adapter for Sovra BLE Mesh Radio.
 *
 * Implements:
 * 1. BlePlatformAdapter interface from @sovra/p2p linking native Kotlin & Objective-C++ modules.
 * 2. Real GATT MTU negotiation (requestMtu: 512).
 * 3. Bidirectional data frame stream between React Native JS and physical BLE radio.
 * 4. Graceful fallback to truthful OFFLINE state when native radio is absent.
 */

import {
  type BlePlatformAdapter,
  type BleDiscoveredDevice,
  type BleConnectionChannel,
  ActiveBleChannel,
  BleHardwareUnavailableError,
} from '@sovra/p2p';

// Safe cross-runtime getter supporting Capacitor/Android WebView (@JavascriptInterface window.SovraBleNative)
// and React Native TurboModule / NativeModules.SovraBleNative
function getNativeBleRuntime(): { module: any; isWebViewBridge: boolean } {
  try {
    if (typeof window !== 'undefined' && (window as any).SovraBleNative) {
      return { module: (window as any).SovraBleNative, isWebViewBridge: true };
    }
    const RN = (globalThis as any).ReactNative || (globalThis as any).reactNative;
    if (RN && RN.NativeModules && RN.NativeModules.SovraBleNative) {
      return { module: RN.NativeModules.SovraBleNative, isWebViewBridge: false };
    }
    if ((globalThis as any).NativeModules?.SovraBleNative) {
      return { module: (globalThis as any).NativeModules.SovraBleNative, isWebViewBridge: false };
    }
  } catch {}
  return { module: null, isWebViewBridge: false };
}

export class NativeMobileBleAdapter implements BlePlatformAdapter {
  public readonly platformName: 'android' | 'ios' | 'virtual';
  private nativeModule: any;
  private isWebViewBridge = false;
  private domCleanupFns: Array<() => void> = [];
  private domDiscoveryCleanup: (() => void) | null = null;
  private activeChannels = new Map<string, ActiveBleChannel>();
  private incomingConnectionHandlers: Array<(channel: BleConnectionChannel) => void> = [];
  private isScanning = false;
  private isAdvertising = false;
  private didToMacMap = new Map<string, string>();
  private macToDidMap = new Map<string, string>();
  private batteryLevel = 1.0;
  private isBatteryThrottled = false;

  public setBatteryLevel(level: number): { isThrottled: boolean; dutyCycle: { scanMs: number; idleMs: number } } {
    this.batteryLevel = Math.max(0, Math.min(1, level));
    this.isBatteryThrottled = this.batteryLevel < 0.20; // Auto-throttle under 20% battery
    if (this.isBatteryThrottled) {
      this.setScanDutyCycle('BACKGROUND_LOW_POWER');
      return { isThrottled: true, dutyCycle: { scanMs: 1000, idleMs: 9000 } };
    }
    return { isThrottled: false, dutyCycle: { scanMs: 3000, idleMs: 3000 } };
  }

  public getBatteryThrottleStatus(): { batteryLevel: number; isThrottled: boolean } {
    return { batteryLevel: this.batteryLevel, isThrottled: this.isBatteryThrottled };
  }

  constructor() {
    const rt = getNativeBleRuntime();
    this.nativeModule = rt.module;
    this.isWebViewBridge = rt.isWebViewBridge;
    const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
    this.platformName = isAndroid ? 'android' : 'ios';
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    if (!this.nativeModule) return;

    const handleIncomingData = (event: { gattId?: string; data?: string }) => {
      if (!event?.gattId || !event?.data) return;
      const channel = this.activeChannels.get(event.gattId);
      if (channel) {
        channel.injectIncomingBytes?.(this.base64ToBytes(event.data));
      }
    };

    const handleDisconnect = (event: { gattId?: string }) => {
      if (!event?.gattId) return;
      const channel = this.activeChannels.get(event.gattId);
      if (channel) {
        channel.close();
        this.activeChannels.delete(event.gattId);
      }
    };

    if (this.isWebViewBridge && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const dataListener = (ev: any) => handleIncomingData(ev?.detail);
      const discListener = (ev: any) => handleDisconnect(ev?.detail);
      window.addEventListener('onIncomingDataReceived', dataListener);
      window.addEventListener('onPeerDisconnected', discListener);
      this.domCleanupFns.push(
        () => window.removeEventListener('onIncomingDataReceived', dataListener),
        () => window.removeEventListener('onPeerDisconnected', discListener),
      );
      return;
    }

    try {
      const RN = (globalThis as any).ReactNative || (globalThis as any).reactNative;
      const EventEmitter = RN?.NativeEventEmitter || (globalThis as any).NativeEventEmitter;
      if (EventEmitter) {
        const emitter = new EventEmitter(this.nativeModule);
        emitter.addListener('onIncomingDataReceived', handleIncomingData);
        emitter.addListener('onPeerDisconnected', handleDisconnect);
      }
    } catch (e) {
      console.warn('[NativeBleBridge] Could not attach NativeEventEmitter:', e);
    }
  }

  public async isAvailable(): Promise<boolean> {
    if (!this.nativeModule) return false;
    try {
      return await this.nativeModule.isAvailable();
    } catch {
      return false;
    }
  }

  public async isBluetoothEnabled(): Promise<boolean> {
    if (!this.nativeModule) return false;
    try {
      return await this.nativeModule.isBluetoothEnabled();
    } catch {
      return false;
    }
  }

  public registerPeerIdentity(did: string, address: string): void {
    if (did && address) {
      this.didToMacMap.set(did, address);
      this.macToDidMap.set(address, did);
      if (this.nativeModule && typeof this.nativeModule.registerPeerIdentity === 'function') {
        try {
          this.nativeModule.registerPeerIdentity(did, address);
        } catch {}
      }
    }
  }

  public resolveAddressForDid(peerDidOrAddress: string): string {
    return this.didToMacMap.get(peerDidOrAddress) || peerDidOrAddress;
  }

  public resolveDidForAddress(address: string): string | undefined {
    return this.macToDidMap.get(address);
  }

  public async isIgnoringBatteryOptimizations(): Promise<boolean> {
    if (!this.nativeModule || typeof this.nativeModule.isIgnoringBatteryOptimizations !== 'function') {
      return true; // Non-Android or older runtime
    }
    try {
      return Boolean(await this.nativeModule.isIgnoringBatteryOptimizations());
    } catch {
      return true;
    }
  }

  public async requestIgnoreBatteryOptimizations(): Promise<void> {
    if (this.nativeModule && typeof this.nativeModule.requestIgnoreBatteryOptimizations === 'function') {
      try {
        await this.nativeModule.requestIgnoreBatteryOptimizations();
      } catch (e) {
        console.warn('[NativeBleBridge] requestIgnoreBatteryOptimizations failed:', e);
      }
    }
  }

  public async startAdvertising(serviceUuid: string, advertisementData: Uint8Array): Promise<boolean> {
    if (!this.nativeModule) {
      return false;
    }
    const base64Data = this.bytesToBase64(advertisementData);
    try {
      const res = await this.nativeModule.startAdvertising(serviceUuid, base64Data);
      this.isAdvertising = Boolean(res);
      return this.isAdvertising;
    } catch (e: any) {
      console.warn('[NativeBleBridge] startAdvertising rejected by radio:', e?.message);
      return false;
    }
  }

  public async stopAdvertising(): Promise<void> {
    if (!this.nativeModule) return;
    try {
      await this.nativeModule.stopAdvertising();
      this.isAdvertising = false;
    } catch {}
  }

  public async startScanning(
    serviceUuid: string,
    onDiscovered: (device: BleDiscoveredDevice) => void,
  ): Promise<boolean> {
    if (!this.nativeModule) {
      return false;
    }
    try {
      const dispatchDiscovered = (event: { address: string; rssi: number; txPower?: number; serviceData?: string; name?: string }) => {
        if (!event?.address) return;
        const serviceBytes = this.base64ToBytes(event.serviceData || '');
        onDiscovered({
          address: event.address,
          rssi: event.rssi,
          txPower: event.txPower,
          serviceData: serviceBytes,
          name: event.name,
        });
      };

      if (this.isWebViewBridge && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        if (this.domDiscoveryCleanup) this.domDiscoveryCleanup();
        const listener = (ev: any) => dispatchDiscovered(ev?.detail);
        window.addEventListener('onDeviceDiscovered', listener);
        this.domDiscoveryCleanup = () => window.removeEventListener('onDeviceDiscovered', listener);
      } else {
        const RN = (globalThis as any).ReactNative || (globalThis as any).reactNative;
        const EventEmitter = RN?.NativeEventEmitter || (globalThis as any).NativeEventEmitter;
        if (EventEmitter) {
          const emitter = new EventEmitter(this.nativeModule);
          emitter.addListener('onDeviceDiscovered', dispatchDiscovered);
        }
      }

      const res = await this.nativeModule.startScanning(serviceUuid);
      this.isScanning = Boolean(res);
      return this.isScanning;
    } catch (e: any) {
      console.warn('[NativeBleBridge] startScanning rejected by radio:', e?.message);
      return false;
    }
  }

  public async stopScanning(): Promise<void> {
    if (this.domDiscoveryCleanup) {
      this.domDiscoveryCleanup();
      this.domDiscoveryCleanup = null;
    }
    if (!this.nativeModule) return;
    try {
      await this.nativeModule.stopScanning();
      this.isScanning = false;
    } catch {}
  }

  public async setScanDutyCycle(mode: 'ACTIVE' | 'BACKGROUND_LOW_POWER' | string): Promise<boolean> {
    if (!this.nativeModule || typeof this.nativeModule.setScanDutyCycle !== 'function') {
      return false;
    }
    try {
      await this.nativeModule.setScanDutyCycle(mode);
      return true;
    } catch {
      return false;
    }
  }

  public async connect(targetAddress: string): Promise<BleConnectionChannel> {
    if (!this.nativeModule) {
      throw new BleHardwareUnavailableError(
        `Native Bluetooth radio is not available on this platform to connect to ${targetAddress}`,
      );
    }

    const resolvedAddress = this.resolveAddressForDid(targetAddress);
    let gattId = '';
    let mtu = 23;

    if (this.isWebViewBridge && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const connRes = await new Promise<{ gattId: string; mtu: number }>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`BLE GATT connection to ${resolvedAddress} timed out`));
        }, 6000);
        const onOk = (ev: any) => {
          const d = ev?.detail;
          if (d?.address === resolvedAddress && d?.gattId) {
            cleanup();
            resolve({ gattId: String(d.gattId), mtu: Number(d.mtu || 512) });
          }
        };
        const onErr = (ev: any) => {
          const d = ev?.detail;
          if (!d?.address || d.address === resolvedAddress) {
            cleanup();
            reject(new Error(String(d?.error || `GATT connect failed for ${resolvedAddress}`)));
          }
        };
        const cleanup = () => {
          clearTimeout(timer);
          window.removeEventListener('onGattConnected', onOk);
          window.removeEventListener('onGattError', onErr);
        };
        window.addEventListener('onGattConnected', onOk);
        window.addEventListener('onGattError', onErr);
        const started = Boolean(this.nativeModule.connectGatt(resolvedAddress));
        if (!started) {
          cleanup();
          reject(new Error(`GATT connect rejected for ${resolvedAddress}`));
        }
      });
      gattId = connRes.gattId;
      mtu = connRes.mtu;
    } else {
      const connRes = await this.nativeModule.connectGatt(resolvedAddress);
      gattId = connRes.gattId;
      mtu = connRes.mtu || 23;
    }

    const channel = new ActiveBleChannel(
      targetAddress,
      mtu,
      async (chunk: Uint8Array) => {
        const b64 = this.bytesToBase64(chunk);
        await this.nativeModule.writeCharacteristic(gattId, b64);
        return true;
      },
    );

    this.activeChannels.set(gattId, channel);
    return channel;
  }

  public onIncomingConnection(handler: (channel: BleConnectionChannel) => void): () => void {
    this.incomingConnectionHandlers.push(handler);
    return () => {
      this.incomingConnectionHandlers = this.incomingConnectionHandlers.filter(h => h !== handler);
    };
  }

  // --- Utility base64 helpers ---
  private bytesToBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i] ?? 0);
    }
    return btoa(binary);
  }

  private base64ToBytes(b64: string): Uint8Array {
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(b64, 'base64'));
    }
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
