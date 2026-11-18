/**
 * @file packages/p2p/src/mesh/wifi-adapters.ts
 * Wi-Fi Direct Platform Adapters: Android, iOS Multipeer, and Virtual In-Memory Engine.
 *
 * Implements:
 * 1. WifiDirectPlatformAdapter interface for high-throughput (30-80 MB/s) media handovers.
 * 2. AndroidWifiDirectAdapter binding to native SovraWifiDirectModule (Port 5359).
 * 3. IosWifiDirectAdapter binding to native MultipeerConnectivity bridge.
 * 4. VirtualWifiDirectAdapter for deterministic, high-fidelity Vitest test suites.
 */

import { ok, err, Result } from '@sovra/shared';
import { bytesToHex, hexToBytes, sha256 } from '@sovra/crypto';
import { TransportChannel } from './types.js';

export interface WifiDirectGroupInfo {
  readonly ip: string;
  readonly port: number;
  readonly isGroupOwner: boolean;
}

export interface WifiDirectPlatformAdapter {
  readonly platformName: 'android' | 'ios' | 'virtual';
  startGroupOwner(port?: number): Promise<{ ip: string; port: number }>;
  connectToGroupOwner(ip: string, port: number): Promise<TransportChannel>;
  stopWifiDirect(): Promise<void>;
  onIncomingMedia(handler: (transferId: string, data: Uint8Array, sha256Hex: string) => void): () => void;
  sendMedia?(
    targetHost: string,
    port: number,
    transferId: string,
    payload: Uint8Array,
    onProgress?: (bytesTransferred: number, totalBytes: number) => void,
  ): Promise<{ success: boolean; sha256Hex?: string; error?: string }>;
  isAvailable?(): Promise<boolean>;
  getGroupInfo?(): Promise<WifiDirectGroupInfo | null>;
  onConnectionChanged?(handler: (isConnected: boolean, isGroupOwner: boolean, groupOwnerAddress: string | null) => void): () => void;
}

// ==========================================
// 1. ANDROID WI-FI DIRECT ADAPTER
// ==========================================

export class AndroidWifiDirectAdapter implements WifiDirectPlatformAdapter {
  public readonly platformName = 'android' as const;
  private nativeModule: any;
  private incomingMediaHandlers: Array<(transferId: string, data: Uint8Array, sha256Hex: string) => void> = [];
  private connectionChangeHandlers: Array<(isConnected: boolean, isGroupOwner: boolean, groupOwnerAddress: string | null) => void> = [];
  private currentGroupInfo: WifiDirectGroupInfo | null = null;

  constructor(customNativeModule?: any) {
    if (customNativeModule) {
      this.nativeModule = customNativeModule;
    } else {
      const g = globalThis as any;
      this.nativeModule =
        g.__SOVRA_WIFI_DIRECT_NATIVE__ ||
        g.NativeModules?.SovraWifiDirectModule ||
        null;
    }

    this.wireNativeEvents();
  }

  private wireNativeEvents(): void {
    if (!this.nativeModule) return;

    if (typeof this.nativeModule.onIncomingMediaReceived === 'function') {
      this.nativeModule.onIncomingMediaReceived = (
        transferId: string,
        _sender: string,
        dataBase64: string,
        sha256Hex: string,
      ) => {
        const binary = Uint8Array.from(atob(dataBase64), c => c.charCodeAt(0));
        for (const handler of this.incomingMediaHandlers) {
          try {
            handler(transferId, binary, sha256Hex);
          } catch {}
        }
      };
    }

    if (typeof this.nativeModule.onConnectionChanged === 'function') {
      this.nativeModule.onConnectionChanged = (
        isConnected: boolean,
        isGroupOwner: boolean,
        goAddress: string | null,
      ) => {
        if (isConnected && goAddress) {
          this.currentGroupInfo = {
            ip: goAddress,
            port: 5359,
            isGroupOwner,
          };
        } else {
          this.currentGroupInfo = null;
        }

        for (const handler of this.connectionChangeHandlers) {
          try {
            handler(isConnected, isGroupOwner, goAddress);
          } catch {}
        }
      };
    }
  }

  public async isAvailable(): Promise<boolean> {
    if (!this.nativeModule) return false;
    if (typeof this.nativeModule.isAvailable === 'function') {
      return Boolean(await this.nativeModule.isAvailable());
    }
    return true;
  }

  public async startGroupOwner(port = 5359): Promise<{ ip: string; port: number }> {
    if (!this.nativeModule) {
      throw new Error('Android native Wi-Fi Direct module is not available');
    }

    return new Promise((resolve, reject) => {
      this.nativeModule.createGroup((success: boolean, errOrMsg?: string) => {
        if (!success) {
          return reject(new Error(errOrMsg || 'Failed to create Wi-Fi Direct group owner'));
        }

        const ip = this.currentGroupInfo?.ip || '192.168.49.1'; // Standard Android Wi-Fi Direct GO IP
        this.currentGroupInfo = { ip, port, isGroupOwner: true };
        resolve({ ip, port });
      });
    });
  }

  public async connectToGroupOwner(ip: string, port = 5359): Promise<TransportChannel> {
    const channelId = `wd-chan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    let isClosed = false;
    let onDataHandler: ((data: Uint8Array) => void) | null = null;
    let onCloseHandler: (() => void) | null = null;

    const channel: TransportChannel = {
      id: channelId,
      peerAddress: `${ip}:${port}`,
      transportType: 'wifi_direct',
      mtu: 65535,
      send: async (data: Uint8Array) => {
        if (isClosed) return err(new Error('Channel closed'));
        const transferId = `tf_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
        const res = await this.sendMedia(ip, port, transferId, data);
        if (res.success) {
          return ok(undefined);
        }
        return err(new Error(res.error || 'Wi-Fi Direct send failed'));
      },
      close: async () => {
        if (!isClosed) {
          isClosed = true;
          if (onCloseHandler) onCloseHandler();
        }
      },
      onData: (h) => {
        onDataHandler = h;
        return () => {
          onDataHandler = null;
        };
      },
      onClose: (h) => {
        onCloseHandler = h;
        return () => {
          onCloseHandler = null;
        };
      },
      onError: () => () => {},
    };

    return channel;
  }

  public async stopWifiDirect(): Promise<void> {
    if (!this.nativeModule) return;

    return new Promise((resolve) => {
      this.nativeModule.removeGroup?.((_success: boolean) => {
        this.currentGroupInfo = null;
        resolve();
      });
    });
  }

  public onIncomingMedia(
    handler: (transferId: string, data: Uint8Array, sha256Hex: string) => void,
  ): () => void {
    this.incomingMediaHandlers.push(handler);
    return () => {
      this.incomingMediaHandlers = this.incomingMediaHandlers.filter(h => h !== handler);
    };
  }

  public onConnectionChanged(
    handler: (isConnected: boolean, isGroupOwner: boolean, groupOwnerAddress: string | null) => void,
  ): () => void {
    this.connectionChangeHandlers.push(handler);
    return () => {
      this.connectionChangeHandlers = this.connectionChangeHandlers.filter(h => h !== handler);
    };
  }

  public async sendMedia(
    targetHost: string,
    port: number,
    transferId: string,
    payload: Uint8Array,
    _onProgress?: (bytesTransferred: number, totalBytes: number) => void,
  ): Promise<{ success: boolean; sha256Hex?: string; error?: string }> {
    if (!this.nativeModule) {
      return { success: false, error: 'Android native Wi-Fi Direct module unavailable' };
    }

    const base64 = btoa(String.fromCharCode.apply(null, Array.from(payload)));

    return new Promise((resolve) => {
      this.nativeModule.sendMediaPayload(
        targetHost,
        port,
        transferId,
        base64,
        (success: boolean, shaOrErr?: string) => {
          if (success) {
            resolve({ success: true, sha256Hex: shaOrErr });
          } else {
            resolve({ success: false, error: shaOrErr });
          }
        },
      );
    });
  }

  public async getGroupInfo(): Promise<WifiDirectGroupInfo | null> {
    return this.currentGroupInfo;
  }
}

// ==========================================
// 2. IOS MULTIPEER CONNECTIVITY ADAPTER
// ==========================================

export class IosWifiDirectAdapter implements WifiDirectPlatformAdapter {
  public readonly platformName = 'ios' as const;
  private nativeModule: any;
  private incomingMediaHandlers: Array<(transferId: string, data: Uint8Array, sha256Hex: string) => void> = [];

  constructor(customNativeModule?: any) {
    if (customNativeModule) {
      this.nativeModule = customNativeModule;
    } else {
      const g = globalThis as any;
      this.nativeModule =
        g.__SOVRA_MULTIPEER_NATIVE__ ||
        g.NativeModules?.SovraMultipeerBridge ||
        null;
    }

    if (this.nativeModule && typeof this.nativeModule.onStreamReceived === 'function') {
      this.nativeModule.onStreamReceived = (transferId: string, base64: string, shaHex: string) => {
        const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        for (const h of this.incomingMediaHandlers) {
          try {
            h(transferId, binary, shaHex);
          } catch {}
        }
      };
    }
  }

  public async isAvailable(): Promise<boolean> {
    return Boolean(this.nativeModule);
  }

  public async startGroupOwner(port = 5359): Promise<{ ip: string; port: number }> {
    if (this.nativeModule?.startAdvertising) {
      await this.nativeModule.startAdvertising();
    }
    return { ip: '127.0.0.1', port };
  }

  public async connectToGroupOwner(ip: string, port = 5359): Promise<TransportChannel> {
    if (this.nativeModule?.startBrowsing) {
      await this.nativeModule.startBrowsing();
    }

    return {
      id: `ios-multipeer-${Date.now()}`,
      peerAddress: `${ip}:${port}`,
      transportType: 'wifi_direct',
      mtu: 65535,
      send: async (data: Uint8Array) => {
        const tid = `ios_tf_${Date.now()}`;
        const res = await this.sendMedia(ip, port, tid, data);
        return res.success ? ok(undefined) : err(new Error(res.error));
      },
      close: async () => {
        await this.stopWifiDirect();
      },
      onData: () => () => {},
      onClose: () => () => {},
      onError: () => () => {},
    };
  }

  public async stopWifiDirect(): Promise<void> {
    if (this.nativeModule?.disconnect) {
      await this.nativeModule.disconnect();
    }
  }

  public onIncomingMedia(
    handler: (transferId: string, data: Uint8Array, sha256Hex: string) => void,
  ): () => void {
    this.incomingMediaHandlers.push(handler);
    return () => {
      this.incomingMediaHandlers = this.incomingMediaHandlers.filter(h => h !== handler);
    };
  }

  public async sendMedia(
    _targetHost: string,
    _port: number,
    transferId: string,
    payload: Uint8Array,
    _onProgress?: (bytesTransferred: number, totalBytes: number) => void,
  ): Promise<{ success: boolean; sha256Hex?: string; error?: string }> {
    if (!this.nativeModule) {
      return { success: false, error: 'iOS MultipeerConnectivity bridge unavailable' };
    }
    const digest = bytesToHex(sha256(payload));
    const base64 = btoa(String.fromCharCode.apply(null, Array.from(payload)));

    return new Promise((resolve) => {
      this.nativeModule.sendStream(transferId, base64, (success: boolean, err?: string) => {
        resolve({ success, sha256Hex: digest, error: err });
      });
    });
  }
}

// ==========================================
// 3. VIRTUAL WI-FI DIRECT BUS & ADAPTER (TEST ENGINE)
// ==========================================

export class VirtualWifiDirectBus {
  private static instance: VirtualWifiDirectBus | null = null;
  public static getInstance(): VirtualWifiDirectBus {
    if (!this.instance) {
      this.instance = new VirtualWifiDirectBus();
    }
    return this.instance;
  }

  public static reset(): void {
    this.instance = null;
  }

  private groupOwners = new Map<string, { adapter: VirtualWifiDirectAdapter; port: number }>();
  private allAdapters = new Map<string, VirtualWifiDirectAdapter>();

  public register(address: string, adapter: VirtualWifiDirectAdapter): void {
    this.allAdapters.set(address, adapter);
  }

  public unregister(address: string): void {
    this.allAdapters.delete(address);
    this.groupOwners.delete(address);
  }

  public startGroup(address: string, adapter: VirtualWifiDirectAdapter, port: number): void {
    this.groupOwners.set(address, { adapter, port });
  }

  public stopGroup(address: string): void {
    this.groupOwners.delete(address);
  }

  public getGroupOwner(address: string): { adapter: VirtualWifiDirectAdapter; port: number } | undefined {
    return this.groupOwners.get(address);
  }

  public getAdapter(address: string): VirtualWifiDirectAdapter | undefined {
    return this.allAdapters.get(address);
  }
}

export interface VirtualWifiDirectAdapterConfig {
  localAddress: string;
  simulatedIp?: string;
  autoTeardownTimeoutMs?: number;
}

export class VirtualWifiDirectAdapter implements WifiDirectPlatformAdapter {
  public readonly platformName = 'virtual' as const;
  public readonly localAddress: string;
  public readonly simulatedIp: string;
  private autoTeardownTimeoutMs: number;

  private isGroupOwner = false;
  private currentPort = 5359;
  private bus: VirtualWifiDirectBus;
  private incomingMediaHandlers: Array<(transferId: string, data: Uint8Array, sha256Hex: string) => void> = [];
  private connectionChangeHandlers: Array<(isConnected: boolean, isGroupOwner: boolean, groupOwnerAddress: string | null) => void> = [];
  private teardownTimer: any = null;
  public teardownCount = 0;
  public transferCount = 0;
  public totalBytesTransferred = 0;

  constructor(config: VirtualWifiDirectAdapterConfig) {
    this.localAddress = config.localAddress;
    this.simulatedIp = config.simulatedIp || '192.168.49.1';
    this.autoTeardownTimeoutMs = config.autoTeardownTimeoutMs ?? 3000;
    this.bus = VirtualWifiDirectBus.getInstance();
    this.bus.register(this.localAddress, this);
  }

  public async startGroupOwner(port = 5359): Promise<{ ip: string; port: number }> {
    this.isGroupOwner = true;
    this.currentPort = port;
    this.clearTeardownTimer();
    this.bus.startGroup(this.localAddress, this, port);

    for (const h of this.connectionChangeHandlers) {
      try {
        h(true, true, this.simulatedIp);
      } catch {}
    }

    return { ip: this.simulatedIp, port };
  }

  public async connectToGroupOwner(ip: string, port = 5359): Promise<TransportChannel> {
    const channelId = `vwd-${this.localAddress}->${ip}:${port}`;
    let isClosed = false;
    let onDataHandler: ((data: Uint8Array) => void) | null = null;
    let onCloseHandler: (() => void) | null = null;

    const channel: TransportChannel = {
      id: channelId,
      peerAddress: `${ip}:${port}`,
      transportType: 'wifi_direct',
      mtu: 65535,
      send: async (data: Uint8Array) => {
        if (isClosed) return err(new Error('Channel closed'));
        const transferId = `vtf_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
        const res = await this.sendMedia(ip, port, transferId, data);
        return res.success ? ok(undefined) : err(new Error(res.error));
      },
      close: async () => {
        if (!isClosed) {
          isClosed = true;
          if (onCloseHandler) onCloseHandler();
        }
      },
      onData: (h) => {
        onDataHandler = h;
        return () => {
          onDataHandler = null;
        };
      },
      onClose: (h) => {
        onCloseHandler = h;
        return () => {
          onCloseHandler = null;
        };
      },
      onError: () => () => {},
    };

    return channel;
  }

  public async stopWifiDirect(): Promise<void> {
    this.clearTeardownTimer();
    this.isGroupOwner = false;
    this.bus.stopGroup(this.localAddress);
    this.teardownCount++;

    for (const h of this.connectionChangeHandlers) {
      try {
        h(false, false, null);
      } catch {}
    }
  }

  public onIncomingMedia(
    handler: (transferId: string, data: Uint8Array, sha256Hex: string) => void,
  ): () => void {
    this.incomingMediaHandlers.push(handler);
    return () => {
      this.incomingMediaHandlers = this.incomingMediaHandlers.filter(h => h !== handler);
    };
  }

  public onConnectionChanged(
    handler: (isConnected: boolean, isGroupOwner: boolean, groupOwnerAddress: string | null) => void,
  ): () => void {
    this.connectionChangeHandlers.push(handler);
    return () => {
      this.connectionChangeHandlers = this.connectionChangeHandlers.filter(h => h !== handler);
    };
  }

  public async sendMedia(
    targetHost: string,
    _port: number,
    transferId: string,
    payload: Uint8Array,
    onProgress?: (bytesTransferred: number, totalBytes: number) => void,
  ): Promise<{ success: boolean; sha256Hex?: string; error?: string }> {
    // Locate recipient adapter on virtual bus
    let targetAdapter: VirtualWifiDirectAdapter | undefined;

    // Search by address or simulatedIp
    for (const adapter of (this.bus as any).allAdapters.values()) {
      if (
        adapter.localAddress === targetHost ||
        adapter.simulatedIp === targetHost ||
        targetHost === '127.0.0.1' ||
        targetHost === 'localhost'
      ) {
        if (adapter !== this) {
          targetAdapter = adapter;
          break;
        }
      }
    }

    if (!targetAdapter) {
      // Fallback: pick any other registered adapter on the bus
      for (const adapter of (this.bus as any).allAdapters.values()) {
        if (adapter !== this) {
          targetAdapter = adapter;
          break;
        }
      }
    }

    if (!targetAdapter) {
      return { success: false, error: `No virtual Wi-Fi Direct peer found at ${targetHost}` };
    }

    // Simulate transfer chunks & calculate true SHA-256
    const chunkSize = 65536; // 64 KB chunks
    const totalBytes = payload.byteLength;
    let bytesSent = 0;

    while (bytesSent < totalBytes) {
      const step = Math.min(chunkSize, totalBytes - bytesSent);
      bytesSent += step;
      if (onProgress) {
        onProgress(bytesSent, totalBytes);
      }
    }

    const shaHex = bytesToHex(sha256(payload));
    this.transferCount++;
    this.totalBytesTransferred += totalBytes;

    // Deliver to recipient
    targetAdapter.receiveIncomingMedia(transferId, new Uint8Array(payload), shaHex);

    // Schedule auto-teardown on group owner to conserve battery
    this.scheduleAutoTeardown();
    targetAdapter.scheduleAutoTeardown();

    return {
      success: true,
      sha256Hex: shaHex,
    };
  }

  public receiveIncomingMedia(transferId: string, data: Uint8Array, sha256Hex: string): void {
    for (const h of this.incomingMediaHandlers) {
      try {
        h(transferId, data, sha256Hex);
      } catch {}
    }
  }

  public scheduleAutoTeardown(): void {
    this.clearTeardownTimer();
    this.teardownTimer = setTimeout(() => {
      this.stopWifiDirect().catch(() => {});
    }, this.autoTeardownTimeoutMs);
  }

  private clearTeardownTimer(): void {
    if (this.teardownTimer) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
  }

  public async getGroupInfo(): Promise<WifiDirectGroupInfo | null> {
    if (!this.isGroupOwner) return null;
    return {
      ip: this.simulatedIp,
      port: this.currentPort,
      isGroupOwner: true,
    };
  }
}
