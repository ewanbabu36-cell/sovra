/**
 * @file packages/p2p/src/mesh/types.ts
 * Core Type Definitions for Sovra Offline Decentralized Mesh Network.
 *
 * Defines:
 * 1. Pluggable Transport Abstraction (BLE, TCP, Wi-Fi Direct, WebRTC).
 * 2. Mesh Envelope Model with Store-and-Forward Routing metadata.
 * 3. Delivery Progression & Cryptographic Acknowledgments.
 * 4. Multi-Transport Coordination & Network Modes (Online, Offline, Hybrid).
 */

import { Result } from '@sovra/shared';

export type TransportType =
  | 'ble'
  | 'local_wifi'
  | 'wifi_direct'
  | 'internet_p2p'
  | 'webrtc'
  | 'relay'
  | 'tcp';

export type PeerTrustState =
  | 'UNKNOWN'
  | 'DISCOVERED'
  | 'AUTHENTICATED'
  | 'TRUSTED'
  | 'BLOCKED'
  | 'REVOKED';

export type TransportStatus =
  | 'inactive'
  | 'advertising'
  | 'scanning'
  | 'active'
  | 'degraded'
  | 'error';

export interface TransportCapabilities {
  readonly mtuBytes: number;
  readonly maxBandwidthBps: number;
  readonly supportsBroadcast: boolean;
  readonly supportsBackgroundExecution: boolean;
  readonly isBatterySensitive: boolean;
  readonly requiresPermissions: readonly string[];
}

export interface MeshDiscoveredPeer {
  readonly peerAddress: string; // MAC address, peripheral UUID, or IP:port
  readonly transportType: TransportType;
  readonly rssi?: number | undefined; // Received signal strength indicator in dBm
  readonly distanceMeters?: number | undefined;
  readonly ephemeralToken?: string | undefined;
  readonly protocolVersion: number;
  readonly capabilityFlags: number;
  readonly discoveredAt: number;
  readonly trustState?: PeerTrustState | undefined;
}

export interface DiscoveryAdvertisement {
  readonly serviceUuid: string;
  readonly protocolVersion: number;
  readonly ephemeralDiscoveryToken: string; // 8-byte rotating nonce
  readonly capabilityFlags: number;
}

export interface TransportChannel {
  readonly id: string;
  readonly peerAddress: string;
  readonly transportType: TransportType;
  readonly mtu: number;
  send(data: Uint8Array): Promise<Result<void>>;
  close(): Promise<void>;
  onData(handler: (data: Uint8Array) => void): () => void;
  onClose(handler: () => void): () => void;
  onError(handler: (err: Error) => void): () => void;
}

export interface SovraTransport {
  readonly id: string;
  readonly type: TransportType;
  readonly status: TransportStatus;
  readonly capabilities: TransportCapabilities;
  start(): Promise<Result<void>>;
  stop(): Promise<void>;
  advertise(payload: DiscoveryAdvertisement): Promise<Result<void>>;
  discover(handler: (discovered: MeshDiscoveredPeer) => void): Promise<Result<void>>;
  connect(peerAddress: string): Promise<Result<TransportChannel>>;
  disconnect(peerAddress: string): Promise<void>;
  getConnectedPeers(): readonly string[];
  onChannel(handler: (channel: TransportChannel) => void): () => void;
}

// ==========================================
// MESH ENVELOPE & STORE-AND-FORWARD MODEL
// ==========================================

export type MeshEnvelopeType =
  | 'ENCRYPTED_MESSAGE'
  | 'SIGNED_EVENT'
  | 'SYNC_SUMMARY'
  | 'SYNC_REQUEST'
  | 'SYNC_RESPONSE'
  | 'DELIVERY_RECEIPT'
  | 'MEDIA_CHUNK_REQUEST'
  | 'MEDIA_CHUNK_RESPONSE';

export interface MeshEnvelope {
  readonly envelopeId: string; // SHA-256 hash of (originDid + payloadBytes + timestamp + nonce)
  readonly envelopeType: MeshEnvelopeType;
  readonly originDid: string;
  readonly targetDid: string; // Specific recipient DID or '*' for broadcast
  readonly hopCount: number;
  readonly maxHops: number; // TTL (default: 7)
  readonly route: readonly string[]; // Node DIDs traversed
  readonly timestamp: number;
  readonly expiresAt: number;
  readonly priority: number; // 0 = bulk, 1 = normal, 2 = high, 3 = emergency
  readonly payloadBytes: Uint8Array;
  readonly signatureHex: string; // Ed25519 signature of envelopeId by originDid
  readonly nonce?: string | undefined;
}

export type DeliveryState =
  | 'LOCAL'
  | 'QUEUED'
  | 'DISCOVERING'
  | 'CONNECTING'
  | 'TRANSFERRING'
  | 'SENDING'
  | 'STORED_BY_PEER'
  | 'FORWARDED'
  | 'RELAYED'
  | 'SYNCED'
  | 'CONFIRMED'
  | 'DELIVERED'
  | 'ACKNOWLEDGED'
  | 'FAILED'
  | 'EXPIRED';

export interface OutboxItem {
  readonly envelope: MeshEnvelope;
  readonly status: DeliveryState;
  readonly createdAt: number;
  readonly lastAttemptAt?: number | undefined;
  readonly retryCount: number;
  readonly relayedByPeers: readonly string[];
  readonly acknowledgedAt?: number | undefined;
  readonly failureReason?: string | undefined;
}

export interface DeliveryReceipt {
  readonly targetEnvelopeId: string;
  readonly recipientDid: string;
  readonly deliveredAt: number;
  readonly signatureHex: string; // Signed by recipient's private key
}

// ==========================================
// NETWORK MODES & COORDINATION
// ==========================================

export type MeshNetworkMode = 'ONLINE' | 'OFFLINE' | 'HYBRID';

export type MeshNetworkStatus =
  | 'ONLINE'
  | 'OFFLINE'
  | 'BLUETOOTH_MESH'
  | 'CONNECTING'
  | 'SYNCING'
  | 'PARTIALLY_CONNECTED'
  | 'NO_PEERS';

export type BatteryProfile = 'PERFORMANCE' | 'BALANCED' | 'POWERSAVER';

export interface MeshUserControls {
  bluetoothMeshEnabled: boolean;
  discoverabilityEnabled: boolean;
  relayParticipationEnabled: boolean;
  batteryProfile: BatteryProfile;
  privateRoutingOnly: boolean;
}

export interface MeshDiagnostics {
  readonly nearbyPeersCount: number;
  readonly authenticatedPeersCount: number;
  readonly activeTransports: readonly TransportType[];
  readonly outboxPendingCount: number;
  readonly relayQueueCount: number;
  readonly totalBytesSent: number;
  readonly totalBytesReceived: number;
  readonly packetsRouted: number;
  readonly duplicatePacketsDropped: number;
  readonly lastSyncTimestamp: number;
  readonly currentNetworkStatus: MeshNetworkStatus;
}
