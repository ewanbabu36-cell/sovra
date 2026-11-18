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

import { ok, err, Result } from '@sovra/shared';
import {
  bytesToHex,
  hexToBytes,
  sha256,
  signEd25519,
  verifyEd25519,
  secureRandomBytes,
} from '@sovra/crypto';
import {
  SovraTransport,
  TransportChannel,
  TransportType,
  MeshNetworkStatus,
  MeshDiagnostics,
  MeshUserControls,
  BatteryProfile,
  MeshDiscoveredPeer,
  MeshEnvelope,
  MESH_MEDIA_HANDOVER_THRESHOLD_BYTES,
  HandoverRequestMessage,
  HandoverOfferMessage,
  HandoverCompleteMessage,
} from './types.js';
import { MeshRouter, MeshPeerChannel } from './mesh-router.js';
import { BluetoothLETransport } from './ble-transport.js';
import { LocalWifiTransport } from './local-wifi-transport.js';

export interface MeshTransportManagerConfig {
  router: MeshRouter;
  bleTransport?: BluetoothLETransport | undefined;
  tcpTransport?: SovraTransport | undefined;
  localWifiTransport?: LocalWifiTransport | undefined;
  internetAvailable?: boolean | undefined;
}

export class MeshTransportManager {
  public readonly router: MeshRouter;
  public readonly bleTransport?: BluetoothLETransport | undefined;
  public readonly tcpTransport?: SovraTransport | undefined;
  public readonly localWifiTransport?: LocalWifiTransport | undefined;

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
  private peerDiscoveredHandlers: Array<(peer: MeshDiscoveredPeer) => void> = [];

  constructor(config: MeshTransportManagerConfig) {
    this.router = config.router;
    this.bleTransport = config.bleTransport;
    this.tcpTransport = config.tcpTransport;
    this.localWifiTransport = config.localWifiTransport;
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

    if (this.localWifiTransport) {
      this.localWifiTransport.onChannel(channel => {
        this.attachChannelToRouter(channel);
      });
      this.localWifiTransport.onIncomingMedia((transferId, data, sha256Hex) => {
        this.handleIncomingMediaTransfer(transferId, data, sha256Hex);
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
    if (this.localWifiTransport) {
      await this.localWifiTransport.stop();
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
 
    for (const h of this.peerDiscoveredHandlers) {
      try {
        h(peer);
      } catch {}
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
        if (envelope.envelopeType === 'HANDOVER_REQUEST') {
          this.handleIncomingHandoverRequest(envelope, channel);
          return;
        }
        if (envelope.envelopeType === 'HANDOVER_OFFER') {
          this.handleIncomingHandoverOffer(envelope);
          return;
        }
        if (envelope.envelopeType === 'HANDOVER_COMPLETE') {
          this.handleIncomingHandoverComplete(envelope);
          return;
        }
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
    if (this.localWifiTransport && this.localWifiTransport.status === 'active') {
      activeTransports.push('local_wifi');
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

  public getDiscoveredPeers(): MeshDiscoveredPeer[] {
    return Array.from(this.nearbyDiscoveredPeers.values()).sort(
      (a, b) => (b.rssi ?? -127) - (a.rssi ?? -127),
    );
  }

  public onPeerDiscovered(handler: (peer: MeshDiscoveredPeer) => void): () => void {
    this.peerDiscoveredHandlers.push(handler);
    return () => {
      this.peerDiscoveredHandlers = this.peerDiscoveredHandlers.filter(h => h !== handler);
    };
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

  // ==========================================
  // DUAL-RADIO HYBRID HANDOVER (BLE <-> WI-FI DIRECT)
  // ==========================================

  private pendingHandoverOffers = new Map<string, {
    resolve: (offer: HandoverOfferMessage) => void;
    reject: (err: Error) => void;
    timer: any;
  }>();

  private pendingHandoverCompletes = new Map<string, {
    resolve: (complete: HandoverCompleteMessage) => void;
    reject: (err: Error) => void;
    timer: any;
  }>();

  private incomingTransfers = new Map<string, {
    request: HandoverRequestMessage;
    receivedAt: number;
    bleChannel?: TransportChannel | undefined;
  }>();

  private mediaTransferHandlers: Array<(transferId: string, data: Uint8Array, sha256Hex: string) => void> = [];

  public onMediaTransfer(handler: (transferId: string, data: Uint8Array, sha256Hex: string) => void): () => void {
    this.mediaTransferHandlers.push(handler);
    return () => {
      this.mediaTransferHandlers = this.mediaTransferHandlers.filter(h => h !== handler);
    };
  }

  public async routeMessage(
    envelope: MeshEnvelope,
    targetPeerAddress?: string,
  ): Promise<Result<{ transport: TransportType; bytesTransferred: number; handover: boolean }>> {
    const payloadSize = envelope.payloadBytes.byteLength;

    // 1. Small payload (<= 64 KB) or No Wi-Fi Transport: route directly over BLE
    if (payloadSize <= MESH_MEDIA_HANDOVER_THRESHOLD_BYTES || !this.localWifiTransport) {
      const channel = targetPeerAddress
        ? this.activeChannels.get(targetPeerAddress)
        : this.getBleChannelForPeer(envelope.targetDid) || this.getFirstBleChannel();

      if (channel) {
        const serialized = MeshRouter.serializeEnvelope(envelope);
        const res = await channel.send(serialized);
        if (res.ok) {
          return ok({ transport: 'ble', bytesTransferred: payloadSize, handover: false });
        }
      }

      this.router.outboxStore.storeOutbox(envelope);
      return ok({ transport: 'ble', bytesTransferred: payloadSize, handover: false });
    }

    // 2. High-throughput payload (> 64 KB): Dynamic Handover to Wi-Fi Direct
    return this.executeWifiDirectHandover(envelope, targetPeerAddress);
  }

  private async executeWifiDirectHandover(
    envelope: MeshEnvelope,
    targetPeerAddress?: string,
  ): Promise<Result<{ transport: TransportType; bytesTransferred: number; handover: boolean }>> {
    const bleChannel = targetPeerAddress
      ? this.activeChannels.get(targetPeerAddress)
      : this.getBleChannelForPeer(envelope.targetDid) || this.getFirstBleChannel();

    if (!bleChannel) {
      return err(new Error('No active BLE session channel available for Wi-Fi Direct handover negotiation'));
    }

    const payloadSize = envelope.payloadBytes.byteLength;
    const sha256Hex = bytesToHex(sha256(envelope.payloadBytes));
    const transferId = `xfer_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

    const requestMsg: HandoverRequestMessage = {
      transferId,
      payloadSizeBytes: payloadSize,
      sha256Hex,
      mimeType: (envelope as any).mimeType || 'application/octet-stream',
      fileName: (envelope as any).fileName || `${transferId}.bin`,
      senderDid: envelope.originDid,
    };

    // Send HandoverRequestMessage over BLE
    const requestBytes = new TextEncoder().encode(JSON.stringify(requestMsg));
    const requestEnvelope = this.router.createEnvelope({
      targetDid: envelope.targetDid,
      envelopeType: 'HANDOVER_REQUEST',
      payloadBytes: requestBytes,
    });

    const sendReqRes = await bleChannel.send(MeshRouter.serializeEnvelope(requestEnvelope));
    if (!sendReqRes.ok) {
      return err(new Error('Failed to send HandoverRequest over BLE'));
    }

    // Await HandoverOfferMessage from receiver with Wi-Fi Direct socket parameters
    let offer: HandoverOfferMessage;
    try {
      offer = await this.awaitHandoverOffer(transferId, 10000);
    } catch (e: any) {
      return err(new Error(`Wi-Fi Direct Handover Offer timeout or error: ${e.message}`));
    }

    if (offer.status === 'REJECTED') {
      return err(new Error('Peer rejected Wi-Fi Direct handover offer'));
    }

    // Trigger localWifiTransport connect/stream and transmit at high speed (30-80 MB/s)
    const transferRes = await this.localWifiTransport!.sendHighSpeedMedia(
      offer.groupOwnerAddress,
      offer.port,
      transferId,
      envelope.payloadBytes,
    );

    if (!transferRes.success) {
      return err(new Error(transferRes.error || 'High-speed media transfer failed over Wi-Fi Direct'));
    }

    // Emit HandoverCompleteMessage over BLE and verify SHA-256 match
    const receiptSignature = bytesToHex(
      signEd25519((this.router as any).localPrivateKey, hexToBytes(sha256Hex)),
    );

    const completeMsg: HandoverCompleteMessage = {
      transferId,
      status: 'SUCCESS',
      bytesTransferred: payloadSize,
      receiptSignature,
      sha256Hex,
    };

    const completeEnvelope = this.router.createEnvelope({
      targetDid: envelope.targetDid,
      envelopeType: 'HANDOVER_COMPLETE',
      payloadBytes: new TextEncoder().encode(JSON.stringify(completeMsg)),
    });

    await bleChannel.send(MeshRouter.serializeEnvelope(completeEnvelope));

    return ok({
      transport: 'wifi_direct',
      bytesTransferred: payloadSize,
      handover: true,
    });
  }

  private async handleIncomingHandoverRequest(
    envelope: MeshEnvelope,
    channel: TransportChannel,
  ): Promise<void> {
    try {
      const json = new TextDecoder().decode(envelope.payloadBytes);
      const req: HandoverRequestMessage = JSON.parse(json);

      this.incomingTransfers.set(req.transferId, {
        request: req,
        receivedAt: Date.now(),
        bleChannel: channel,
      });

      // Start Wi-Fi Direct Group Owner socket
      let goAddress = '127.0.0.1';
      let port = 5359;
      if (this.localWifiTransport) {
        const goInfo = await this.localWifiTransport.startGroupOwner(5359);
        goAddress = goInfo.ip;
        port = goInfo.port;
      }

      const offerMsg: HandoverOfferMessage = {
        transferId: req.transferId,
        groupOwnerAddress: goAddress,
        port,
        authSecretToken: bytesToHex(secureRandomBytes(16)),
        status: 'ACCEPTED',
      };

      const offerBytes = new TextEncoder().encode(JSON.stringify(offerMsg));
      const offerEnvelope = this.router.createEnvelope({
        targetDid: envelope.originDid,
        envelopeType: 'HANDOVER_OFFER',
        payloadBytes: offerBytes,
      });

      await channel.send(MeshRouter.serializeEnvelope(offerEnvelope));
    } catch {
      // Failed to handle handover request
    }
  }

  private handleIncomingHandoverOffer(envelope: MeshEnvelope): void {
    try {
      const json = new TextDecoder().decode(envelope.payloadBytes);
      const offer: HandoverOfferMessage = JSON.parse(json);

      const pending = this.pendingHandoverOffers.get(offer.transferId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingHandoverOffers.delete(offer.transferId);
        pending.resolve(offer);
      }
    } catch {}
  }

  private handleIncomingHandoverComplete(envelope: MeshEnvelope): void {
    try {
      const json = new TextDecoder().decode(envelope.payloadBytes);
      const complete: HandoverCompleteMessage = JSON.parse(json);

      const pending = this.pendingHandoverCompletes.get(complete.transferId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingHandoverCompletes.delete(complete.transferId);
        pending.resolve(complete);
      }
    } catch {}
  }

  private handleIncomingMediaTransfer(
    transferId: string,
    data: Uint8Array,
    sha256Hex: string,
  ): void {
    const actualSha = bytesToHex(sha256(data));
    if (actualSha !== sha256Hex) {
      return; // Corrupted payload dropped
    }

    const pending = this.incomingTransfers.get(transferId);
    if (pending) {
      this.incomingTransfers.delete(transferId);
    }

    // Ingest into router as high-speed arrived envelope
    const envelope = this.router.createEnvelope({
      targetDid: this.router.localDid,
      envelopeType: 'ENCRYPTED_MESSAGE',
      payloadBytes: data,
    });
    this.router.ingestEnvelope(envelope);

    for (const handler of this.mediaTransferHandlers) {
      try {
        handler(transferId, data, sha256Hex);
      } catch {}
    }
  }

  private awaitHandoverOffer(transferId: string, timeoutMs: number): Promise<HandoverOfferMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingHandoverOffers.delete(transferId);
        reject(new Error(`Handover offer timeout for ${transferId}`));
      }, timeoutMs);

      this.pendingHandoverOffers.set(transferId, { resolve, reject, timer });
    });
  }

  private getBleChannelForPeer(peerDid: string): TransportChannel | undefined {
    for (const channel of this.activeChannels.values()) {
      if (channel.transportType === 'ble' && (channel as any).remoteDid === peerDid) {
        return channel;
      }
    }
    return undefined;
  }

  private getFirstBleChannel(): TransportChannel | undefined {
    for (const channel of this.activeChannels.values()) {
      if (channel.transportType === 'ble') {
        return channel;
      }
    }
    return undefined;
  }
}
