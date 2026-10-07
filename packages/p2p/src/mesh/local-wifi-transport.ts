/**
 * @file packages/p2p/src/mesh/local-wifi-transport.ts
 * Local Wi-Fi / LAN Transport Implementation for Sovra Offline Mesh.
 *
 * Implements:
 * 1. SovraTransport interface for Local Wi-Fi (LAN / Wi-Fi Direct) communications.
 * 2. High-throughput framing (64KB MTU) without BLE radio duty-cycling constraints.
 * 3. Local subnet beacon discovery (multicast / mDNS simulation).
 * 4. Deterministic multi-peer virtual LAN bus for tests and offline local nodes.
 */

import { ok, err, Result } from '@sovra/shared';
import {
  SovraTransport,
  TransportChannel,
  TransportType,
  TransportStatus,
  TransportCapabilities,
  MeshDiscoveredPeer,
  DiscoveryAdvertisement,
} from './types.js';

export class LocalWifiBus {
  private static instance: LocalWifiBus | null = null;
  public static getInstance(): LocalWifiBus {
    if (!this.instance) {
      this.instance = new LocalWifiBus();
    }
    return this.instance;
  }

  public static reset(): void {
    this.instance = null;
  }

  private transports = new Map<string, LocalWifiTransport>();
  private activeAdvertisements = new Map<string, DiscoveryAdvertisement>();

  public register(address: string, transport: LocalWifiTransport): void {
    this.transports.set(address, transport);
  }

  public unregister(address: string): void {
    this.transports.delete(address);
    this.activeAdvertisements.delete(address);
  }

  public broadcastAdvertisement(senderAddress: string, payload: DiscoveryAdvertisement): void {
    this.activeAdvertisements.set(senderAddress, payload);

    for (const [addr, transport] of this.transports.entries()) {
      if (addr !== senderAddress && transport.isDiscoveringActive) {
        transport.notifyPeerDiscovered({
          peerAddress: senderAddress,
          transportType: 'local_wifi',
          protocolVersion: payload.protocolVersion,
          capabilityFlags: payload.capabilityFlags,
          ephemeralToken: payload.ephemeralDiscoveryToken,
          discoveredAt: Date.now(),
          rssi: -35,
          distanceMeters: 2,
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
  ): { channelA: TransportChannel; channelB: TransportChannel } {
    let aOnData: ((data: Uint8Array) => void) | null = null;
    let bOnData: ((data: Uint8Array) => void) | null = null;
    let aOnClose: (() => void) | null = null;
    let bOnClose: (() => void) | null = null;

    const channelA: TransportChannel = {
      id: `wifi-chan-${addrA}->${addrB}-${Math.random().toString(16).slice(2, 8)}`,
      peerAddress: addrB,
      transportType: 'local_wifi',
      mtu: 65535,
      send: async (data: Uint8Array) => {
        if (bOnData) {
          queueMicrotask(() => bOnData!(new Uint8Array(data)));
          return ok(undefined);
        }
        return err(new Error('Channel disconnected'));
      },
      close: async () => {
        if (bOnClose) bOnClose();
        if (aOnClose) aOnClose();
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
      onError: () => () => {},
    };

    const channelB: TransportChannel = {
      id: `wifi-chan-${addrB}->${addrA}-${Math.random().toString(16).slice(2, 8)}`,
      peerAddress: addrA,
      transportType: 'local_wifi',
      mtu: 65535,
      send: async (data: Uint8Array) => {
        if (aOnData) {
          queueMicrotask(() => aOnData!(new Uint8Array(data)));
          return ok(undefined);
        }
        return err(new Error('Channel disconnected'));
      },
      close: async () => {
        if (aOnClose) aOnClose();
        if (bOnClose) bOnClose();
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
      onError: () => () => {},
    };

    return { channelA, channelB };
  }
}

export interface LocalWifiTransportConfig {
  localAddress: string;
  bus?: LocalWifiBus;
  id?: string;
}

export class LocalWifiTransport implements SovraTransport {
  public readonly id: string;
  public readonly type: TransportType = 'local_wifi';
  public readonly localAddress: string;
  public status: TransportStatus = 'inactive';

  public readonly capabilities: TransportCapabilities = {
    mtuBytes: 65535,
    maxBandwidthBps: 54_000_000,
    supportsBroadcast: true,
    supportsBackgroundExecution: true,
    isBatterySensitive: false,
    requiresPermissions: [
      'android.permission.ACCESS_WIFI_STATE',
      'android.permission.CHANGE_WIFI_MULTICAST_STATE',
      'android.permission.INTERNET',
    ],
  };

  private bus: LocalWifiBus;
  private isDiscovering = false;
  private discoveryHandler: ((peer: MeshDiscoveredPeer) => void) | null = null;
  private channelHandlers: Array<(channel: TransportChannel) => void> = [];
  private connectedChannels = new Map<string, TransportChannel>();

  constructor(config: LocalWifiTransportConfig) {
    this.localAddress = config.localAddress;
    this.id = config.id ?? `wifi-${config.localAddress}`;
    this.bus = config.bus ?? LocalWifiBus.getInstance();
    this.bus.register(this.localAddress, this);
  }

  public get isDiscoveringActive(): boolean {
    return this.isDiscovering;
  }

  public async start(): Promise<Result<void>> {
    this.status = 'active';
    return ok(undefined);
  }

  public async stop(): Promise<void> {
    this.status = 'inactive';
    this.isDiscovering = false;
    this.discoveryHandler = null;
    this.bus.stopAdvertisement(this.localAddress);
    for (const channel of this.connectedChannels.values()) {
      await channel.close();
    }
    this.connectedChannels.clear();
    this.bus.unregister(this.localAddress);
  }

  public async advertise(payload: DiscoveryAdvertisement): Promise<Result<void>> {
    this.status = 'advertising';
    this.bus.broadcastAdvertisement(this.localAddress, payload);
    return ok(undefined);
  }

  public async discover(handler: (discovered: MeshDiscoveredPeer) => void): Promise<Result<void>> {
    this.isDiscovering = true;
    this.discoveryHandler = handler;
    this.status = 'scanning';
    return ok(undefined);
  }

  public notifyPeerDiscovered(peer: MeshDiscoveredPeer): void {
    if (this.discoveryHandler) {
      this.discoveryHandler(peer);
    }
  }

  public async connect(peerAddress: string): Promise<Result<TransportChannel>> {
    const existing = this.connectedChannels.get(peerAddress);
    if (existing) {
      return ok(existing);
    }

    const { channelA, channelB } = this.bus.createLink(this.localAddress, peerAddress);
    this.connectedChannels.set(peerAddress, channelA);

    channelA.onClose(() => {
      this.connectedChannels.delete(peerAddress);
    });

    const target = (this.bus as any).transports?.get(peerAddress);
    if (target) {
      target.notifyIncomingChannel(channelB);
    }

    return ok(channelA);
  }

  public notifyIncomingChannel(channel: TransportChannel): void {
    this.connectedChannels.set(channel.peerAddress, channel);
    channel.onClose(() => {
      this.connectedChannels.delete(channel.peerAddress);
    });

    for (const h of this.channelHandlers) {
      try {
        h(channel);
      } catch {}
    }
  }

  public async disconnect(peerAddress: string): Promise<void> {
    const channel = this.connectedChannels.get(peerAddress);
    if (channel) {
      await channel.close();
      this.connectedChannels.delete(peerAddress);
    }
  }

  public getConnectedPeers(): readonly string[] {
    return Array.from(this.connectedChannels.keys());
  }

  public onChannel(handler: (channel: TransportChannel) => void): () => void {
    this.channelHandlers.push(handler);
    return () => {
      this.channelHandlers = this.channelHandlers.filter(h => h !== handler);
    };
  }
}
