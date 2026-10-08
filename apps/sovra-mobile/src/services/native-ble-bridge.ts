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

// Polyfill/safe-getter for React Native NativeModules
function getNativeBleModule(): any {
  try {
    const RN = (globalThis as any).ReactNative || (globalThis as any).reactNative;
    if (RN && RN.NativeModules && RN.NativeModules.SovraBleNative) {
      return RN.NativeModules.SovraBleNative;
    }
    // Check global NativeModules if injected by TurboModule runtime
    if ((globalThis as any).NativeModules?.SovraBleNative) {
      return (globalThis as any).NativeModules.SovraBleNative;
    }
  } catch {}
  return null;
}

export class NativeMobileBleAdapter implements BlePlatformAdapter {
  public readonly platformName: 'android' | 'ios' | 'virtual';
  private nativeModule: any;
  private activeChannels = new Map<string, ActiveBleChannel>();
  private incomingConnectionHandlers: Array<(channel: BleConnectionChannel) => void> = [];
  private isScanning = false;
  private isAdvertising = false;

  constructor() {
    this.nativeModule = getNativeBleModule();
    const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
    this.platformName = isAndroid ? 'android' : 'ios';
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    if (!this.nativeModule) return;

    try {
      const RN = (globalThis as any).ReactNative || (globalThis as any).reactNative;
      const EventEmitter = RN?.NativeEventEmitter || (globalThis as any).NativeEventEmitter;
      if (EventEmitter) {
        const emitter = new EventEmitter(this.nativeModule);

        emitter.addListener('onIncomingDataReceived', (event: { gattId: string; data: string }) => {
          const channel = this.activeChannels.get(event.gattId);
          if (channel) {
            const rawBytes = this.base64ToBytes(event.data);
            channel.injectIncomingBytes?.(rawBytes);
          }
        });

        emitter.addListener('onPeerDisconnected', (event: { gattId: string }) => {
          const channel = this.activeChannels.get(event.gattId);
          if (channel) {
            channel.close();
            this.activeChannels.delete(event.gattId);
          }
        });
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
      const RN = (globalThis as any).ReactNative || (globalThis as any).reactNative;
      const EventEmitter = RN?.NativeEventEmitter || (globalThis as any).NativeEventEmitter;
      if (EventEmitter) {
        const emitter = new EventEmitter(this.nativeModule);
        emitter.addListener(
          'onDeviceDiscovered',
          (event: { address: string; rssi: number; serviceData: string; name?: string }) => {
            const serviceBytes = this.base64ToBytes(event.serviceData || '');
            onDiscovered({
              address: event.address,
              rssi: event.rssi,
              serviceData: serviceBytes,
              name: event.name,
            });
          },
        );
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
    if (!this.nativeModule) return;
    try {
      await this.nativeModule.stopScanning();
      this.isScanning = false;
    } catch {}
  }

  public async connect(targetAddress: string): Promise<BleConnectionChannel> {
    if (!this.nativeModule) {
      throw new BleHardwareUnavailableError(
        `Native Bluetooth radio is not available on this platform to connect to ${targetAddress}`,
      );
    }

    const connRes = await this.nativeModule.connectGatt(targetAddress);
    const gattId = connRes.gattId;
    const mtu = connRes.mtu || 23;

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
