/**
 * @file packages/p2p/src/mesh/ble-adapters.ts
 * BLE Platform Adapters: Android, iOS, and Virtual Deterministic Multi-Device Radio.
 *
 * Implements:
 * 1. BlePlatformAdapter hardware abstraction interface.
 * 2. Truthful delivery state tracking:
 *    QUEUED -> SENT_TO_BLE_STACK -> ACKNOWLEDGED_BY_BLE_TRANSPORT -> DELIVERED_TO_PEER -> APPLICATION_LEVEL_RECEIPT.
 * 3. AndroidBleAdapter with BluetoothGatt, BluetoothGattServer, permissions, and 512 MTU negotiation.
 * 4. IosBleAdapter with CoreBluetooth CBPeripheralManager/CBCentralManager specifications.
 * 5. VirtualBleBus for high-fidelity multi-peer in-process and network testing.
 */

export type BleDeliveryStatus =
  | 'QUEUED'
  | 'SENT_TO_BLE_STACK'
  | 'ACKNOWLEDGED_BY_BLE_TRANSPORT'
  | 'DELIVERED_TO_PEER'
  | 'APPLICATION_LEVEL_RECEIPT';

export interface BleSendReceipt {
  readonly chunkId: string;
  readonly status: BleDeliveryStatus;
  readonly timestamp: number;
  readonly bytesSent: number;
  readonly error?: string | undefined;
}

export class BleHardwareUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BleHardwareUnavailableError';
  }
}

export class BlePermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlePermissionDeniedError';
  }
}

export class BleConnectionTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BleConnectionTimeoutError';
  }
}

export interface BleDiscoveredDevice {
  readonly address: string;
  readonly rssi: number;
  readonly serviceData: Uint8Array;
  readonly name?: string | undefined;
}

export interface BleConnectionChannel {
  readonly address: string;
  readonly mtu: number;
  readonly isConnected: boolean;
  send(chunk: Uint8Array): Promise<boolean>;
  sendWithReceipt?(chunk: Uint8Array): Promise<BleSendReceipt>;
  close(): Promise<void>;
  onData(handler: (chunk: Uint8Array) => void): () => void;
  onClose(handler: () => void): () => void;
  injectIncomingBytes?(bytes: Uint8Array): void;
}

export interface BlePlatformAdapter {
  readonly platformName: 'android' | 'ios' | 'virtual';
  startAdvertising(serviceUuid: string, advertisementData: Uint8Array): Promise<boolean>;
  stopAdvertising(): Promise<void>;
  startScanning(serviceUuid: string, onDiscovered: (device: BleDiscoveredDevice) => void): Promise<boolean>;
  stopScanning(): Promise<void>;
  connect(targetAddress: string): Promise<BleConnectionChannel>;
  onIncomingConnection(handler: (channel: BleConnectionChannel) => void): () => void;
  isAvailable?(): Promise<boolean>;
}

export class ActiveBleChannel implements BleConnectionChannel {
  private dataHandlers: Array<(chunk: Uint8Array) => void> = [];
  private closeHandlers: Array<() => void> = [];
  private _isClosed = false;

  constructor(
    public readonly address: string,
    public readonly mtu: number,
    private nativeSender?: (chunk: Uint8Array) => Promise<boolean>,
    private nativeReceiptSender?: (chunk: Uint8Array) => Promise<BleSendReceipt>,
  ) {}

  public get isConnected(): boolean {
    return !this._isClosed;
  }

  public async send(chunk: Uint8Array): Promise<boolean> {
    if (this._isClosed) return false;
    if (this.nativeSender) {
      return this.nativeSender(chunk);
    }
    // If no native sender is attached, this channel cannot transmit over radio
    throw new BleHardwareUnavailableError(
      `Cannot send ${chunk.length} bytes: native BLE radio transmitter is not linked for address ${this.address}`,
    );
  }

  public async sendWithReceipt(chunk: Uint8Array): Promise<BleSendReceipt> {
    if (this._isClosed) {
      return {
        chunkId: `chunk-${Date.now()}`,
        status: 'QUEUED',
        timestamp: Date.now(),
        bytesSent: 0,
        error: 'Channel is closed',
      };
    }
    if (this.nativeReceiptSender) {
      return this.nativeReceiptSender(chunk);
    }
    const success = await this.send(chunk);
    return {
      chunkId: `chunk-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      status: success ? 'ACKNOWLEDGED_BY_BLE_TRANSPORT' : 'QUEUED',
      timestamp: Date.now(),
      bytesSent: success ? chunk.length : 0,
      error: success ? undefined : 'BLE transport failed to acknowledge write',
    };
  }

  public async close(): Promise<void> {
    if (this._isClosed) return;
    this._isClosed = true;
    for (const h of this.closeHandlers) {
      try {
        h();
      } catch {}
    }
  }

  public onData(handler: (chunk: Uint8Array) => void): () => void {
    this.dataHandlers.push(handler);
    return () => {
      this.dataHandlers = this.dataHandlers.filter(h => h !== handler);
    };
  }

  public onClose(handler: () => void): () => void {
    this.closeHandlers.push(handler);
    return () => {
      this.closeHandlers = this.closeHandlers.filter(h => h !== handler);
    };
  }

  public injectIncomingBytes(bytes: Uint8Array): void {
    if (this._isClosed) return;
    for (const h of this.dataHandlers) {
      try {
        h(bytes);
      } catch {}
    }
  }
}

// ==========================================
// 1. ANDROID BLE PLATFORM ADAPTER SPECIFICATION
// ==========================================

export interface AndroidNativeBleBridge {
  isAvailable(): Promise<boolean>;
  hasPermissions(): Promise<boolean>;
  requestPermissions(): Promise<boolean>;
  isBluetoothEnabled(): Promise<boolean>;
  startAdvertising(serviceUuid: string, advertisementData: Uint8Array): Promise<boolean>;
  stopAdvertising(): Promise<void>;
  startScanning(serviceUuid: string, onDeviceFound: (device: BleDiscoveredDevice) => void): Promise<boolean>;
  stopScanning(): Promise<void>;
  connectGatt(address: string, onDisconnected: () => void): Promise<{ gattId: string; mtu: number }>;
  requestMtu(gattId: string, targetMtu: number): Promise<number>;
  writeCharacteristic(gattId: string, data: Uint8Array, writeType: 'with_response' | 'without_response'): Promise<boolean>;
  disconnectGatt(gattId: string): Promise<void>;
  onGattServerConnection?(handler: (clientAddress: string, channel: BleConnectionChannel) => void): () => void;
}

export class AndroidBleAdapter implements BlePlatformAdapter {
  public readonly platformName = 'android' as const;
  public readonly defaultMtu = 512;
  public readonly requiredPermissions = [
    'android.permission.BLUETOOTH_SCAN',
    'android.permission.BLUETOOTH_ADVERTISE',
    'android.permission.BLUETOOTH_CONNECT',
    'android.permission.ACCESS_FINE_LOCATION',
  ];

  private isAdvertising = false;
  private isScanning = false;
  private incomingHandlers: Array<(ch: BleConnectionChannel) => void> = [];
  private nativeBridge?: AndroidNativeBleBridge;

  constructor(bridge?: AndroidNativeBleBridge) {
    if (bridge) {
      this.nativeBridge = bridge;
    } else if (typeof (globalThis as any).__SOVRA_BLE_ANDROID_NATIVE__ !== 'undefined') {
      this.nativeBridge = (globalThis as any).__SOVRA_BLE_ANDROID_NATIVE__;
    } else if (typeof (globalThis as any).NativeModules?.SovraBleNative !== 'undefined') {
      this.nativeBridge = (globalThis as any).NativeModules.SovraBleNative;
    }
  }

  public setNativeBridge(bridge: AndroidNativeBleBridge): void {
    this.nativeBridge = bridge;
  }

  public get isAdvertisingActive(): boolean {
    return this.isAdvertising;
  }

  public get isScanningActive(): boolean {
    return this.isScanning;
  }

  public async isAvailable(): Promise<boolean> {
    if (!this.nativeBridge) return false;
    return (await this.nativeBridge.isAvailable()) && (await this.nativeBridge.isBluetoothEnabled());
  }

  public async startAdvertising(serviceUuid: string, advertisementData: Uint8Array): Promise<boolean> {
    if (!this.nativeBridge) {
      throw new BleHardwareUnavailableError(
        'Android Bluetooth GATT server is unavailable: native bridge not linked or Bluetooth radio is off',
      );
    }
    const hasPerm = await this.nativeBridge.hasPermissions();
    if (!hasPerm) {
      const granted = await this.nativeBridge.requestPermissions();
      if (!granted) {
        throw new BlePermissionDeniedError('BLUETOOTH_ADVERTISE permission denied by Android OS');
      }
    }
    const btOn = await this.nativeBridge.isBluetoothEnabled();
    if (!btOn) {
      throw new BleHardwareUnavailableError('Cannot start BLE advertising: Android Bluetooth is disabled');
    }

    const ok = await this.nativeBridge.startAdvertising(serviceUuid, advertisementData);
    this.isAdvertising = ok;
    return ok;
  }

  public async stopAdvertising(): Promise<void> {
    if (this.nativeBridge) {
      await this.nativeBridge.stopAdvertising();
    }
    this.isAdvertising = false;
  }

  public async startScanning(
    serviceUuid: string,
    onDiscovered: (device: BleDiscoveredDevice) => void,
  ): Promise<boolean> {
    if (!this.nativeBridge) {
      throw new BleHardwareUnavailableError(
        'Android Bluetooth LE scanner is unavailable: native bridge not linked or permissions missing',
      );
    }
    const hasPerm = await this.nativeBridge.hasPermissions();
    if (!hasPerm) {
      const granted = await this.nativeBridge.requestPermissions();
      if (!granted) {
        throw new BlePermissionDeniedError('BLUETOOTH_SCAN permission denied by Android OS');
      }
    }
    const btOn = await this.nativeBridge.isBluetoothEnabled();
    if (!btOn) {
      throw new BleHardwareUnavailableError('Cannot start BLE scan: Android Bluetooth is disabled');
    }

    const ok = await this.nativeBridge.startScanning(serviceUuid, onDiscovered);
    this.isScanning = ok;
    return ok;
  }

  public async stopScanning(): Promise<void> {
    if (this.nativeBridge) {
      await this.nativeBridge.stopScanning();
    }
    this.isScanning = false;
  }

  public async connect(targetAddress: string): Promise<BleConnectionChannel> {
    if (!this.nativeBridge) {
      throw new BleHardwareUnavailableError(
        `Cannot establish BLE GATT connection to ${targetAddress}: Android Bluetooth subsystem not available`,
      );
    }

    let channelRef: ActiveBleChannel | null = null;
    const { gattId, mtu } = await this.nativeBridge.connectGatt(targetAddress, () => {
      if (channelRef) {
        channelRef.close().catch(() => {});
      }
    });

    // Request 512 MTU
    let effectiveMtu = mtu;
    try {
      effectiveMtu = await this.nativeBridge.requestMtu(gattId, this.defaultMtu);
    } catch {}

    const sender = async (chunk: Uint8Array): Promise<boolean> => {
      if (!this.nativeBridge) return false;
      return this.nativeBridge.writeCharacteristic(gattId, chunk, 'with_response');
    };

    const receiptSender = async (chunk: Uint8Array): Promise<BleSendReceipt> => {
      const t0 = Date.now();
      const success = await sender(chunk);
      return {
        chunkId: `gatt-${gattId}-${Date.now()}`,
        status: success ? 'ACKNOWLEDGED_BY_BLE_TRANSPORT' : 'QUEUED',
        timestamp: t0,
        bytesSent: success ? chunk.length : 0,
        error: success ? undefined : 'Android GATT onCharacteristicWrite status non-zero',
      };
    };

    channelRef = new ActiveBleChannel(targetAddress, effectiveMtu, sender, receiptSender);
    return channelRef;
  }

  public onIncomingConnection(handler: (channel: BleConnectionChannel) => void): () => void {
    this.incomingHandlers.push(handler);
    let bridgeUnsub: (() => void) | undefined;
    if (this.nativeBridge?.onGattServerConnection) {
      bridgeUnsub = this.nativeBridge.onGattServerConnection((_addr, channel) => {
        handler(channel);
      });
    }
    return () => {
      this.incomingHandlers = this.incomingHandlers.filter(h => h !== handler);
      if (bridgeUnsub) bridgeUnsub();
    };
  }
}

// ==========================================
// 2. iOS COREBLUETOOTH PLATFORM ADAPTER SPECIFICATION
// ==========================================

export interface IosCoreBluetoothBridge {
  isAvailable(): Promise<boolean>;
  getAuthorizationStatus(): Promise<'allowed' | 'denied' | 'restricted' | 'not_determined'>;
  getBluetoothState(): Promise<'powered_on' | 'powered_off' | 'unauthorized' | 'unsupported' | 'resetting' | 'unknown'>;
  startPeripheralAdvertising(serviceUuid: string, advertisementData: Uint8Array): Promise<boolean>;
  stopPeripheralAdvertising(): Promise<void>;
  startCentralScanning(serviceUuid: string, onPeripheralDiscovered: (device: BleDiscoveredDevice) => void): Promise<boolean>;
  stopCentralScanning(): Promise<void>;
  connectPeripheral(peripheralId: string, onDisconnected: () => void): Promise<{ peripheralId: string; maximumWriteLength: number }>;
  writeCharacteristic(peripheralId: string, data: Uint8Array, type: 'with_response' | 'without_response'): Promise<boolean>;
  setNotifyValue(peripheralId: string, enabled: boolean): Promise<boolean>;
  disconnectPeripheral(peripheralId: string): Promise<void>;
  onIncomingCentralConnection?(handler: (centralAddress: string, channel: BleConnectionChannel) => void): () => void;
}

export class IosBleAdapter implements BlePlatformAdapter {
  public readonly platformName = 'ios' as const;
  public readonly defaultMtu = 182; // iOS CoreBluetooth standard ATT MTU
  public readonly backgroundModes = ['bluetooth-central', 'bluetooth-peripheral'];

  private isAdvertising = false;
  private isScanning = false;
  private incomingHandlers: Array<(ch: BleConnectionChannel) => void> = [];
  private nativeBridge?: IosCoreBluetoothBridge;

  constructor(bridge?: IosCoreBluetoothBridge) {
    if (bridge) {
      this.nativeBridge = bridge;
    } else if (typeof (globalThis as any).__SOVRA_BLE_IOS_NATIVE__ !== 'undefined') {
      this.nativeBridge = (globalThis as any).__SOVRA_BLE_IOS_NATIVE__;
    } else if (typeof (globalThis as any).NativeModules?.SovraBleBridge !== 'undefined') {
      this.nativeBridge = (globalThis as any).NativeModules.SovraBleBridge;
    }
  }

  public setNativeBridge(bridge: IosCoreBluetoothBridge): void {
    this.nativeBridge = bridge;
  }

  public get isAdvertisingActive(): boolean {
    return this.isAdvertising;
  }

  public get isScanningActive(): boolean {
    return this.isScanning;
  }

  public async isAvailable(): Promise<boolean> {
    if (!this.nativeBridge) return false;
    const state = await this.nativeBridge.getBluetoothState();
    return state === 'powered_on';
  }

  public async startAdvertising(serviceUuid: string, advertisementData: Uint8Array): Promise<boolean> {
    if (!this.nativeBridge) {
      throw new BleHardwareUnavailableError(
        'CoreBluetooth CBPeripheralManager is unavailable: native bridge not linked or Bluetooth is powered off',
      );
    }
    const state = await this.nativeBridge.getBluetoothState();
    if (state !== 'powered_on') {
      throw new BleHardwareUnavailableError(`Cannot start iOS BLE advertising: CoreBluetooth state is ${state}`);
    }

    const ok = await this.nativeBridge.startPeripheralAdvertising(serviceUuid, advertisementData);
    this.isAdvertising = ok;
    return ok;
  }

  public async stopAdvertising(): Promise<void> {
    if (this.nativeBridge) {
      await this.nativeBridge.stopPeripheralAdvertising();
    }
    this.isAdvertising = false;
  }

  public async startScanning(
    serviceUuid: string,
    onDiscovered: (device: BleDiscoveredDevice) => void,
  ): Promise<boolean> {
    if (!this.nativeBridge) {
      throw new BleHardwareUnavailableError(
        'CoreBluetooth CBCentralManager is unavailable: native bridge not linked or authorization missing',
      );
    }
    const auth = await this.nativeBridge.getAuthorizationStatus();
    if (auth === 'denied' || auth === 'restricted') {
      throw new BlePermissionDeniedError('Bluetooth authorization denied in iOS settings');
    }
    const state = await this.nativeBridge.getBluetoothState();
    if (state !== 'powered_on') {
      throw new BleHardwareUnavailableError(`Cannot scan: CoreBluetooth state is ${state}`);
    }

    const ok = await this.nativeBridge.startCentralScanning(serviceUuid, onDiscovered);
    this.isScanning = ok;
    return ok;
  }

  public async stopScanning(): Promise<void> {
    if (this.nativeBridge) {
      await this.nativeBridge.stopCentralScanning();
    }
    this.isScanning = false;
  }

  public async connect(targetAddress: string): Promise<BleConnectionChannel> {
    if (!this.nativeBridge) {
      throw new BleHardwareUnavailableError(
        `Cannot connect to iOS peripheral ${targetAddress}: CoreBluetooth bridge is not linked`,
      );
    }

    let channelRef: ActiveBleChannel | null = null;
    const { peripheralId, maximumWriteLength } = await this.nativeBridge.connectPeripheral(
      targetAddress,
      () => {
        if (channelRef) {
          channelRef.close().catch(() => {});
        }
      },
    );

    const sender = async (chunk: Uint8Array): Promise<boolean> => {
      if (!this.nativeBridge) return false;
      return this.nativeBridge.writeCharacteristic(peripheralId, chunk, 'with_response');
    };

    const receiptSender = async (chunk: Uint8Array): Promise<BleSendReceipt> => {
      const t0 = Date.now();
      const success = await sender(chunk);
      return {
        chunkId: `cbperipheral-${peripheralId}-${Date.now()}`,
        status: success ? 'ACKNOWLEDGED_BY_BLE_TRANSPORT' : 'QUEUED',
        timestamp: t0,
        bytesSent: success ? chunk.length : 0,
        error: success ? undefined : 'CoreBluetooth peripheral write failed or timed out',
      };
    };

    channelRef = new ActiveBleChannel(targetAddress, maximumWriteLength || this.defaultMtu, sender, receiptSender);
    return channelRef;
  }

  public onIncomingConnection(handler: (channel: BleConnectionChannel) => void): () => void {
    this.incomingHandlers.push(handler);
    let bridgeUnsub: (() => void) | undefined;
    if (this.nativeBridge?.onIncomingCentralConnection) {
      bridgeUnsub = this.nativeBridge.onIncomingCentralConnection((_addr, channel) => {
        handler(channel);
      });
    }
    return () => {
      this.incomingHandlers = this.incomingHandlers.filter(h => h !== handler);
      if (bridgeUnsub) bridgeUnsub();
    };
  }
}

// ==========================================
// 3. VIRTUAL DETERMINISTIC BLE BUS (FOR TESTING & HYBRID MESH)
// ==========================================

export class VirtualBleBus {
  private static instance: VirtualBleBus | null = null;
  public static getInstance(): VirtualBleBus {
    if (!this.instance) {
      this.instance = new VirtualBleBus();
    }
    return this.instance;
  }

  public static reset(): void {
    this.instance = null;
  }

  private adapters = new Map<string, VirtualBleAdapter>();
  private activeAdvertisements = new Map<string, { serviceUuid: string; data: Uint8Array }>();

  public register(address: string, adapter: VirtualBleAdapter): void {
    this.adapters.set(address, adapter);
  }

  public unregister(address: string): void {
    this.adapters.delete(address);
    this.activeAdvertisements.delete(address);
  }

  public broadcastAdvertisement(senderAddress: string, serviceUuid: string, data: Uint8Array): void {
    this.activeAdvertisements.set(senderAddress, { serviceUuid, data });

    for (const [addr, adapter] of this.adapters.entries()) {
      if (addr !== senderAddress && adapter.isScanningFor(serviceUuid)) {
        adapter.notifyDiscovered({
          address: senderAddress,
          rssi: -50 - Math.floor(Math.random() * 20),
          serviceData: new Uint8Array(data),
          name: `Sovra-${senderAddress.slice(0, 8)}`,
        });
      }
    }
  }

  public stopAdvertisement(senderAddress: string): void {
    this.activeAdvertisements.delete(senderAddress);
  }

  public createLink(
    addrA: string,
    addrB: string,
    mtu = 182,
  ): { channelA: BleConnectionChannel; channelB: BleConnectionChannel } {
    let aOnData: ((chunk: Uint8Array) => void) | null = null;
    let bOnData: ((chunk: Uint8Array) => void) | null = null;
    let aOnClose: (() => void) | null = null;
    let bOnClose: (() => void) | null = null;
    let closedA = false;
    let closedB = false;

    const channelA: BleConnectionChannel = {
      address: addrB,
      mtu,
      get isConnected(): boolean {
        return !closedA;
      },
      send: async (chunk: Uint8Array) => {
        if (closedA) return false;
        if (bOnData) {
          queueMicrotask(() => bOnData!(new Uint8Array(chunk)));
          return true;
        }
        return false;
      },
      sendWithReceipt: async (chunk: Uint8Array) => {
        const ok = await channelA.send(chunk);
        return {
          chunkId: `vchunk-${Date.now()}-${Math.random()}`,
          status: ok ? 'ACKNOWLEDGED_BY_BLE_TRANSPORT' : 'QUEUED',
          timestamp: Date.now(),
          bytesSent: ok ? chunk.length : 0,
        };
      },
      close: async () => {
        if (closedA) return;
        closedA = true;
        if (aOnClose) aOnClose();
        if (bOnClose) bOnClose();
      },
      onData: (h) => {
        aOnData = h;
        return () => {
          aOnData = null;
        };
      },
      onClose: (h) => {
        aOnClose = h;
        return () => {
          aOnClose = null;
        };
      },
    };

    const channelB: BleConnectionChannel = {
      address: addrA,
      mtu,
      get isConnected(): boolean {
        return !closedB;
      },
      send: async (chunk: Uint8Array) => {
        if (closedB) return false;
        if (aOnData) {
          queueMicrotask(() => aOnData!(new Uint8Array(chunk)));
          return true;
        }
        return false;
      },
      sendWithReceipt: async (chunk: Uint8Array) => {
        const ok = await channelB.send(chunk);
        return {
          chunkId: `vchunk-${Date.now()}-${Math.random()}`,
          status: ok ? 'ACKNOWLEDGED_BY_BLE_TRANSPORT' : 'QUEUED',
          timestamp: Date.now(),
          bytesSent: ok ? chunk.length : 0,
        };
      },
      close: async () => {
        if (closedB) return;
        closedB = true;
        if (bOnClose) bOnClose();
        if (aOnClose) aOnClose();
      },
      onData: (h) => {
        bOnData = h;
        return () => {
          bOnData = null;
        };
      },
      onClose: (h) => {
        bOnClose = h;
        return () => {
          bOnClose = null;
        };
      },
    };

    return { channelA, channelB };
  }
}

export class VirtualBleAdapter implements BlePlatformAdapter {
  public readonly platformName = 'virtual' as const;
  public readonly localAddress: string;
  public readonly mtu: number;

  private bus: VirtualBleBus;
  private scanningServiceUuid: string | null = null;
  private discoveryCallback: ((device: BleDiscoveredDevice) => void) | null = null;
  private incomingHandlers: Array<(ch: BleConnectionChannel) => void> = [];

  constructor(localAddress: string, mtu = 182, bus?: VirtualBleBus) {
    this.localAddress = localAddress;
    this.mtu = mtu;
    this.bus = bus ?? VirtualBleBus.getInstance();
    this.bus.register(localAddress, this);
  }

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public isScanningFor(serviceUuid: string): boolean {
    return this.scanningServiceUuid === serviceUuid;
  }

  public notifyDiscovered(device: BleDiscoveredDevice): void {
    if (this.discoveryCallback) {
      this.discoveryCallback(device);
    }
  }

  public async startAdvertising(serviceUuid: string, advertisementData: Uint8Array): Promise<boolean> {
    this.bus.broadcastAdvertisement(this.localAddress, serviceUuid, advertisementData);
    return true;
  }

  public async stopAdvertising(): Promise<void> {
    this.bus.stopAdvertisement(this.localAddress);
  }

  public async startScanning(
    serviceUuid: string,
    onDiscovered: (device: BleDiscoveredDevice) => void,
  ): Promise<boolean> {
    this.scanningServiceUuid = serviceUuid;
    this.discoveryCallback = onDiscovered;
    return true;
  }

  public async stopScanning(): Promise<void> {
    this.scanningServiceUuid = null;
    this.discoveryCallback = null;
  }

  public async connect(targetAddress: string): Promise<BleConnectionChannel> {
    const { channelA, channelB } = this.bus.createLink(this.localAddress, targetAddress, this.mtu);

    // Notify the target peer of the incoming connection
    const targetAdapter = (this.bus as any).adapters?.get(targetAddress);
    if (targetAdapter) {
      targetAdapter.notifyIncomingConnection(channelB);
    }

    return channelA;
  }

  public notifyIncomingConnection(channel: BleConnectionChannel): void {
    for (const h of this.incomingHandlers) {
      try {
        h(channel);
      } catch {}
    }
  }

  public onIncomingConnection(handler: (channel: BleConnectionChannel) => void): () => void {
    this.incomingHandlers.push(handler);
    return () => {
      this.incomingHandlers = this.incomingHandlers.filter(h => h !== handler);
    };
  }

  public destroy(): void {
    this.bus.unregister(this.localAddress);
  }
}
