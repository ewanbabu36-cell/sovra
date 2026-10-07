/**
 * @file packages/p2p/src/mesh/coordinator.ts
 * Multi-Transport Coordinator & Mesh Transport Manager.
 *
 * Implements:
 * 1. Automatic Hybrid / Online / Offline Network Mode coordination.
 * 2. Unification of Bluetooth LE and Internet/TCP transports under a single router.
 * 3. Dynamic status calculation (ONLINE, OFFLINE, BLUETOOTH_MESH, NO_PEERS, etc.).
 * 4. Battery duty-cycling and adaptive backoff based on power profiles.
 * 5. Truthful diagnostics reporting (nearby peers, outbox queue, byte counters).
 */

import {
  SovraTransport,
  TransportChannel,
  TransportType,
  MeshNetworkStatus,
  MeshDiagnostics,
  MeshUserControls,
  BatteryProfile,
  MeshDiscoveredPeer,
} from './types.js';
import { MeshRouter, MeshPeerChannel } from './mesh-router.js';
import { BluetoothLETransport } from './ble-transport.js';

export interface MeshTransportManagerConfig {
  router: MeshRouter;
  bleTransport?: BluetoothLETransport | undefined;
  tcpTransport?: SovraTransport | undefined;
  internetAvailable?: boolean | undefined;
}

export class MeshTransportManager {
  public readonly router: MeshRouter;
  public readonly bleTransport?: BluetoothLETransport | undefined;
  public readonly tcpTransport?: SovraTransport | undefined;

  public static readonly MAX_DISCOVERED_PEERS = 256;
  public static readonly MAX_CONCURRENT_BLE_CONNECTIONS = 7;
  public static readonly CONNECT_COOLDOWN_MS = 10000;

  private isInternetAvailable: boolean;
  private nearbyDiscoveredPeers = new Map<string, MeshDiscoveredPeer>();
  private activeChannels = new Map<string, TransportChannel>();
  private pendingConnections = new Set<string>();
  private lastConnectAttempts = new Map<string, number>();
  private lastSyncTimestamp = 0;
  private dutyCycleTimer: any = null;
  private isDutyCycleScanning = true;

  private statusChangeHandlers: Array<(status: MeshNetworkStatus) => void> = [];

  constructor(config: MeshTransportManagerConfig) {
    this.router = config.router;
    this.bleTransport = config.bleTransport;
    this.tcpTransport = config.tcpTransport;
    this.isInternetAvailable = config.internetAvailable ?? false;

    // Attach transport channel listeners
    if (this.bleTransport) {
      this.bleTransport.onChannel(channel => {
        this.attachChannelToRouter(channel);
      });
    }

    if (this.tcpTransport) {
      this.tcpTransport.onChannel(channel => {
        this.attachChannelToRouter(channel);
      });
    }
  }

  // ==========================================
  // LIFECYCLE
  // ==========================================

  public async start(): Promise<void> {
    if (this.router.userControls.bluetoothMeshEnabled && this.bleTransport) {
      await this.bleTransport.start();

      if (this.router.userControls.discoverabilityEnabled) {
        // Start advertising rotating discovery token
        const token = Math.random().toString(16).slice(2, 10);
        await this.bleTransport.advertise({
          serviceUuid: '00005356-0000-1000-8000-00805f9b34fb',
          protocolVersion: 1,
          ephemeralDiscoveryToken: token,
          capabilityFlags: 0x01,
        });
      }

      // Start discovery
      await this.bleTransport.discover(peer => {
        this.handleDiscoveredPeer(peer);
      });

      this.startDutyCycling();
    }

    if (this.isInternetAvailable && this.tcpTransport) {
      await this.tcpTransport.start();
    }

    this.notifyStatusChange();
  }

  public async stop(): Promise<void> {
    this.stopDutyCycling();

    if (this.bleTransport) {
      await this.bleTransport.stop();
    }
    if (this.tcpTransport) {
      await this.tcpTransport.stop();
    }

    this.activeChannels.clear();
    this.nearbyDiscoveredPeers.clear();
    this.pendingConnections.clear();
    this.lastConnectAttempts.clear();
    this.notifyStatusChange();
  }

  // ==========================================
  // PEER DISCOVERY & CHANNEL WIRING
  // ==========================================

  private handleDiscoveredPeer(peer: MeshDiscoveredPeer): void {
    // Bound discovered peers table
    if (
      this.nearbyDiscoveredPeers.size >= MeshTransportManager.MAX_DISCOVERED_PEERS &&
      !this.nearbyDiscoveredPeers.has(peer.peerAddress)
    ) {
      // Evict peer with lowest RSSI
      let lowestKey: string | null = null;
      let lowestRssi = Infinity;
      for (const [key, p] of this.nearbyDiscoveredPeers.entries()) {
        const peerRssi = p.rssi ?? -127;
        if (peerRssi < lowestRssi) {
          lowestRssi = peerRssi;
          lowestKey = key;
        }
      }
      if (lowestKey) {
        this.nearbyDiscoveredPeers.delete(lowestKey);
      }
    }

    this.nearbyDiscoveredPeers.set(peer.peerAddress, peer);

    // Opportunistic Auto-Connect if not already connected or connecting
    const activeBleCount = Array.from(this.activeChannels.values()).filter(
      c => c.transportType === 'ble',
    ).length;

    const now = Date.now();
    const lastAttempt = this.lastConnectAttempts.get(peer.peerAddress) ?? 0;
    const isCooledDown = now - lastAttempt >= MeshTransportManager.CONNECT_COOLDOWN_MS;

    if (
      this.router.userControls.bluetoothMeshEnabled &&
      this.bleTransport &&
      !this.activeChannels.has(peer.peerAddress) &&
      !this.pendingConnections.has(peer.peerAddress) &&
      activeBleCount + this.pendingConnections.size < MeshTransportManager.MAX_CONCURRENT_BLE_CONNECTIONS &&
      isCooledDown
    ) {
      this.pendingConnections.add(peer.peerAddress);
      this.lastConnectAttempts.set(peer.peerAddress, now);

      this.bleTransport.connect(peer.peerAddress).then(result => {
        if (result.ok) {
          this.attachChannelToRouter(result.value);
        }
      }).catch(() => {}).finally(() => {
        this.pendingConnections.delete(peer.peerAddress);
      });
    }

    this.notifyStatusChange();
  }

  private attachChannelToRouter(channel: TransportChannel): void {
    this.activeChannels.set(channel.peerAddress, channel);

    const peerChannel: MeshPeerChannel = {
      id: channel.id,
      peerAddress: channel.peerAddress,
      remoteDid: (channel as any).remoteDid,
      send: async (data: Uint8Array) => {
        const res = await channel.send(data);
        return res.ok;
      },
    };

    this.router.registerPeerChannel(peerChannel);

    channel.onData(data => {
      try {
        const envelope = MeshRouter.deserializeEnvelope(data);
        this.router.ingestEnvelope(envelope, channel.id);
        this.lastSyncTimestamp = Date.now();
      } catch {
        // Corrupted packet dropped
      }
    });

    channel.onClose(() => {
      this.activeChannels.delete(channel.peerAddress);
      this.router.unregisterPeerChannel(channel.id);
      this.notifyStatusChange();
    });

    this.notifyStatusChange();
  }

  // ==========================================
  // STATUS CALCULATION
  // ==========================================

  public getNetworkStatus(): MeshNetworkStatus {
    const connectedBlePeers = Array.from(this.activeChannels.values()).filter(
      c => c.transportType === 'ble',
    ).length;

    if (this.isInternetAvailable) {
      return 'ONLINE';
    }

    if (!this.router.userControls.bluetoothMeshEnabled) {
      return 'OFFLINE';
    }

    if (connectedBlePeers > 0) {
      return 'BLUETOOTH_MESH';
    }

    if (this.nearbyDiscoveredPeers.size > 0) {
      return 'CONNECTING';
    }

    return 'NO_PEERS';
  }

  public setInternetConnectivity(isAvailable: boolean): void {
    this.isInternetAvailable = isAvailable;
    this.notifyStatusChange();
  }

  // ==========================================
  // BATTERY PROFILES & DUTY CYCLING
  // ==========================================

  public setBatteryProfile(profile: BatteryProfile): void {
    this.router.userControls.batteryProfile = profile;
    this.stopDutyCycling();
    this.startDutyCycling();
  }

  private startDutyCycling(): void {
    const profile = this.router.userControls.batteryProfile;
    if (profile === 'PERFORMANCE') {
      // Continuous operation, no sleep interval
      return;
    }

    // BALANCED: 30s active, 30s idle
    // POWERSAVER: 10s active, 50s idle
    const activeMs = profile === 'BALANCED' ? 30_000 : 10_000;
    const idleMs = profile === 'BALANCED' ? 30_000 : 50_000;

    const cycle = () => {
      this.isDutyCycleScanning = !this.isDutyCycleScanning;
      if (this.bleTransport) {
        if (this.isDutyCycleScanning) {
          this.bleTransport.discover(peer => this.handleDiscoveredPeer(peer)).catch(() => {});
        } else {
          // Pause scanning to conserve radio battery
          (this.bleTransport as any).adapter?.stopScanning?.().catch(() => {});
        }
      }

      const nextDelay = this.isDutyCycleScanning ? activeMs : idleMs;
      this.dutyCycleTimer = setTimeout(cycle, nextDelay);
    };

    this.dutyCycleTimer = setTimeout(cycle, activeMs);
  }

  private stopDutyCycling(): void {
    if (this.dutyCycleTimer) {
      clearTimeout(this.dutyCycleTimer);
      this.dutyCycleTimer = null;
    }
  }

  // ==========================================
  // DIAGNOSTICS & USER CONTROLS
  // ==========================================

  public getDiagnostics(): MeshDiagnostics {
    const routerDiag = this.router.getDiagnostics();
    const activeTransports: TransportType[] = [];

    if (this.bleTransport && this.bleTransport.status === 'active') {
      activeTransports.push('ble');
    }
    if (this.tcpTransport && this.tcpTransport.status === 'active') {
      activeTransports.push('tcp');
    }

    return {
      nearbyPeersCount: this.nearbyDiscoveredPeers.size,
      authenticatedPeersCount: this.router.getConnectedPeerCount(),
      activeTransports,
      outboxPendingCount: routerDiag.outboxPendingCount,
      relayQueueCount: routerDiag.relayQueueCount,
      totalBytesSent: routerDiag.totalBytesSent,
      totalBytesReceived: routerDiag.totalBytesReceived,
      packetsRouted: routerDiag.packetsRouted,
      duplicatePacketsDropped: routerDiag.duplicatePacketsDropped,
      lastSyncTimestamp: this.lastSyncTimestamp,
      currentNetworkStatus: this.getNetworkStatus(),
    };
  }

  public updateUserControls(controls: Partial<MeshUserControls>): void {
    this.router.userControls = {
      ...this.router.userControls,
      ...controls,
    };
    if (controls.batteryProfile) {
      this.setBatteryProfile(controls.batteryProfile);
    }
    this.notifyStatusChange();
  }

  public onStatusChange(handler: (status: MeshNetworkStatus) => void): () => void {
    this.statusChangeHandlers.push(handler);
    return () => {
      this.statusChangeHandlers = this.statusChangeHandlers.filter(h => h !== handler);
    };
  }

  private notifyStatusChange(): void {
    const currentStatus = this.getNetworkStatus();
    for (const h of this.statusChangeHandlers) {
      try {
        h(currentStatus);
      } catch {}
    }
  }
}
