/**
 * @file apps/sovra-mobile/src/services/mobile-mesh-coordinator.ts
 * Sovra Mobile Runtime Mesh Coordinator.
 *
 * Implements:
 * 1. Binds NativeMobileBleAdapter -> BluetoothLETransport -> MeshRouter -> MeshTransportManager.
 * 2. Connects DurableOutboxStore and localDb to the active mobile runtime.
 * 3. Ingests incoming envelopes and dispatches to local chat threads and feed caches.
 * 4. Exposes truthful runtime diagnostics to UI (zero mock data).
 * 5. Handles offline-to-online transitions with automatic outbox flushing.
 */

import {
  MeshRouter,
  BluetoothLETransport,
  MeshTransportManager,
  DurableOutboxStore,
  type MeshNetworkStatus,
  type MeshDiagnostics,
  type MeshUserControls,
  type MeshDiscoveredPeer,
} from '@sovra/p2p';
import { bytesToHex } from '@sovra/crypto';
import { NativeMobileBleAdapter } from './native-ble-bridge.js';
import { localDb, type CachedMessage, type CachedPost } from './local-database.js';
import { secureKeyStore } from './secure-keystore.js';

export interface MobileMeshRuntimeState {
  status: MeshNetworkStatus;
  diagnostics: MeshDiagnostics;
  controls: MeshUserControls;
}

export class MobileMeshCoordinator {
  private static instance: MobileMeshCoordinator | null = null;

  public readonly localDid: string;
  private readonly localPrivateKey: Uint8Array;
  public readonly router: MeshRouter;
  public readonly bleTransport: BluetoothLETransport;
  public readonly transportManager: MeshTransportManager;
  public readonly outboxStore: DurableOutboxStore;

  private isStarted = false;
  private listeners: Array<(state: MobileMeshRuntimeState) => void> = [];
  private peerListeners: Array<(peers: MeshDiscoveredPeer[]) => void> = [];
  private messageListeners: Array<(message: CachedMessage) => void> = [];

  private constructor() {
    // 1. Resolve or generate persistent local Ed25519 identity for mesh routing
    const storedIdentity = this.resolveStoredIdentity();
    this.localDid = storedIdentity.did;
    this.localPrivateKey = storedIdentity.privateKey;

    // 2. Initialize Durable Outbox Store
    this.outboxStore = new DurableOutboxStore({
      maxRelayQueueSize: 500,
      maxInboxSize: 1000,
    });

    // 3. Initialize Mesh Router with cryptographic signature verification
    this.router = new MeshRouter({
      localDid: this.localDid,
      localPrivateKey: this.localPrivateKey,
      outboxStore: this.outboxStore,
      defaultMaxHops: 7,
    });

    // 4. Initialize Native BLE Transport Adapter
    const nativeAdapter = new NativeMobileBleAdapter();
    this.bleTransport = new BluetoothLETransport({
      localDid: this.localDid,
      localDevicePrivkey: this.localPrivateKey,
      localDevicePubkeyHex: bytesToHex(storedIdentity.publicKey),
      adapter: nativeAdapter,
      serviceUuid: '00005356-0000-1000-8000-00805f9b34fb',
    });

    // 5. Initialize Multi-Transport Coordinator
    this.transportManager = new MeshTransportManager({
      router: this.router,
      bleTransport: this.bleTransport,
      internetAvailable: typeof navigator !== 'undefined' ? navigator.onLine : false,
    });

    // 6. Listen for incoming delivered envelopes to update local database
    this.setupIncomingEnvelopeHandlers();

    // 7. Track network connectivity changes
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkChange(true));
      window.addEventListener('offline', () => this.handleNetworkChange(false));
    }
  }

  public static getInstance(): MobileMeshCoordinator {
    if (!MobileMeshCoordinator.instance) {
      MobileMeshCoordinator.instance = new MobileMeshCoordinator();
    }
    return MobileMeshCoordinator.instance;
  }

  private resolveStoredIdentity(): { did: string; privateKey: Uint8Array; publicKey: Uint8Array } {
    return secureKeyStore.getOrGenerateMeshIdentity();
  }

  private setupIncomingEnvelopeHandlers(): void {
    this.router.onMessage(async envelope => {
      try {
        const payloadText = new TextDecoder().decode(envelope.payloadBytes);
        const data = JSON.parse(payloadText);

        if (envelope.envelopeType === 'ENCRYPTED_MESSAGE') {
          const cachedMsg: CachedMessage = {
            id: envelope.envelopeId,
            threadId: envelope.originDid,
            senderDid: envelope.originDid,
            recipientDid: envelope.targetDid,
            senderName: data.senderName || envelope.originDid.substring(0, 12),
            text: data.text || '',
            timestamp: envelope.timestamp,
            status: 'delivered',
            isBitChat: true,
            hopCount: envelope.hopCount,
            syncStatus: 'SYNCED',
          };
          await localDb.saveMessage(cachedMsg);
          for (const ml of this.messageListeners) {
            try {
              ml(cachedMsg);
            } catch {}
          }
        } else if (envelope.envelopeType === 'SIGNED_EVENT') {
          if (data.channel) {
            const cleanId = data.channel.replace('#', '').replace(/-/g, '_').replace(/^channel:/, '');
            const channelId = `channel:${cleanId}`;
            const cachedMsg: CachedMessage = {
              id: envelope.envelopeId,
              threadId: channelId,
              senderDid: envelope.originDid,
              recipientDid: channelId,
              senderName: data.senderName || envelope.originDid.substring(0, 12),
              text: data.text || data.caption || '',
              timestamp: envelope.timestamp,
              status: 'delivered',
              isBitChat: true,
              hopCount: envelope.hopCount,
              syncStatus: 'SYNCED',
            };
            await localDb.saveMessage(cachedMsg);
            for (const ml of this.messageListeners) {
              try {
                ml(cachedMsg);
              } catch {}
            }
          } else {
            const cachedPost: CachedPost = {
              id: envelope.envelopeId,
              authorDid: envelope.originDid,
              authorName: data.authorName || envelope.originDid.substring(0, 12),
              authorHandle: data.authorHandle || '@peer',
              caption: data.caption || '',
              mediaCid: data.mediaCid,
              timestamp: envelope.timestamp,
              likesCount: 0,
              likedByDids: [],
              isLiked: false,
              commentsCount: 0,
              syncStatus: 'SYNCED',
            };
            await localDb.savePost(cachedPost);
          }
        }
      } catch (err) {
        console.warn('[MobileMeshCoordinator] Error processing incoming envelope payload:', err);
      }
    });

    this.transportManager.onPeerDiscovered(() => {
      const peers = this.getDiscoveredPeers();
      for (const pl of this.peerListeners) {
        try {
          pl(peers);
        } catch {}
      }
      this.notifyListeners();
    });

    this.transportManager.onStatusChange(() => {
      this.notifyListeners();
    });
  }

  public async start(): Promise<void> {
    if (this.isStarted) return;
    this.isStarted = true;
    try {
      await this.transportManager.start();
    } catch (err) {
      console.warn('[MobileMeshCoordinator] Transport manager start warning:', err);
    }
  }

  public async stop(): Promise<void> {
    if (!this.isStarted) return;
    this.isStarted = false;
    await this.transportManager.stop();
  }

  private handleNetworkChange(isOnline: boolean): void {
    this.transportManager.setInternetConnectivity(isOnline);
    this.notifyListeners();
  }

  // ==========================================
  // SEND SOCIAL OPERATIONS OVER MESH
  // ==========================================

  public async sendChatMessage(
    targetDid: string,
    text: string,
    senderName: string,
  ): Promise<{ success: boolean; envelopeId: string }> {
    const payloadBytes = new TextEncoder().encode(JSON.stringify({ text, senderName }));
    const envelope = await this.router.sendEnvelope({
      envelopeType: 'ENCRYPTED_MESSAGE',
      targetDid,
      payloadBytes,
      priority: 1,
    });

    // Also persist into local database immediately
    await localDb.saveMessage({
      id: envelope.envelopeId,
      threadId: targetDid,
      senderDid: this.localDid,
      recipientDid: targetDid,
      senderName,
      text,
      timestamp: Date.now(),
      status: 'pending',
      isBitChat: true,
      hopCount: 0,
      syncStatus: 'PENDING',
    });

    return { success: true, envelopeId: envelope.envelopeId };
  }

  public async broadcastPost(
    caption: string,
    authorName: string,
    authorHandle: string,
    mediaCid?: string,
  ): Promise<{ success: boolean; envelopeId: string }> {
    const payloadBytes = new TextEncoder().encode(
      JSON.stringify({ caption, authorName, authorHandle, mediaCid }),
    );
    const envelope = await this.router.sendEnvelope({
      envelopeType: 'SIGNED_EVENT',
      targetDid: '*', // Broadcast to entire mesh swarm
      payloadBytes,
      priority: 2,
    });

    await localDb.savePost({
      id: envelope.envelopeId,
      authorDid: this.localDid,
      authorName,
      authorHandle,
      caption,
      ...(mediaCid ? { mediaCid } : {}),
      timestamp: Date.now(),
      likesCount: 0,
      likedByDids: [],
      isLiked: false,
      commentsCount: 0,
      syncStatus: 'PENDING',
    });

    return { success: true, envelopeId: envelope.envelopeId };
  }

  // ==========================================
  // TRUTHFUL STATE & TELEMETRY
  // ==========================================

  public getRuntimeState(): MobileMeshRuntimeState {
    const diag = this.transportManager.getDiagnostics();
    const status = this.transportManager.getNetworkStatus();
    const controls = this.router.userControls;
    return { status, diagnostics: diag, controls };
  }

  public async updateControls(controls: Partial<MeshUserControls>): Promise<MobileMeshRuntimeState> {
    this.transportManager.updateUserControls(controls);
    this.notifyListeners();
    return this.getRuntimeState();
  }

  public onStateChange(listener: (state: MobileMeshRuntimeState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  public async sendChannelBroadcast(
    channelId: string,
    text: string,
    senderName: string,
  ): Promise<{ success: boolean; envelopeId: string }> {
    const cleanId = channelId.replace('#', '').replace(/-/g, '_').replace(/^channel:/, '');
    const formattedChannel = `channel:${cleanId}`;
    const payloadBytes = new TextEncoder().encode(
      JSON.stringify({ channel: formattedChannel, text, senderName }),
    );
    const envelope = await this.router.sendEnvelope({
      envelopeType: 'SIGNED_EVENT',
      targetDid: '*', // Broadcast to entire mesh swarm
      payloadBytes,
      priority: channelId.includes('sos') || channelId.includes('emergency') ? 3 : 1,
    });

    await localDb.saveMessage({
      id: envelope.envelopeId,
      threadId: formattedChannel,
      senderDid: this.localDid,
      recipientDid: formattedChannel,
      senderName,
      text,
      timestamp: Date.now(),
      status: 'sent',
      isBitChat: true,
      hopCount: 0,
      syncStatus: 'PENDING',
    });

    return { success: true, envelopeId: envelope.envelopeId };
  }

  public getDiscoveredPeers(): MeshDiscoveredPeer[] {
    return this.transportManager.getDiscoveredPeers();
  }

  public onPeersChange(handler: (peers: MeshDiscoveredPeer[]) => void): () => void {
    this.peerListeners.push(handler);
    handler(this.getDiscoveredPeers());
    return () => {
      this.peerListeners = this.peerListeners.filter(h => h !== handler);
    };
  }

  public onIncomingMessage(handler: (message: CachedMessage) => void): () => void {
    this.messageListeners.push(handler);
    return () => {
      this.messageListeners = this.messageListeners.filter(h => h !== handler);
    };
  }

  private notifyListeners(): void {
    const state = this.getRuntimeState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {}
    }
  }
}

export const mobileMesh = MobileMeshCoordinator.getInstance();
// Automatically start BLE transport in background on app load
mobileMesh.start().catch(() => {});
