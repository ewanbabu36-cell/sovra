import { Result } from '@sovra/shared';
import { DeviceDelegation } from '@sovra/identity';

export type PeerConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'degraded'
  | 'relayed'
  | 'closing'
  | 'failed';

export type ConnectionType = 'direct' | 'relayed' | 'unreachable';

export type NatStatus = 'direct' | 'cone_nat' | 'symmetric_nat' | 'relayed' | 'unreachable';

export interface PeerIdentity {
  readonly peerId: string; // e.g. "12D3KooW..."
  readonly publicKeyHex: string; // 32-byte Ed25519 public key in hex
}

export interface PeerIdentityBinding {
  readonly peerId: string;
  readonly deviceId: string;
  readonly devicePublicKeyHex: string;
  readonly masterDid: string;
  readonly delegation: DeviceDelegation;
  readonly timestamp: number;
  readonly signatureHex?: string;
}

export interface PeerInfo {
  readonly id: PeerIdentity;
  readonly addresses: readonly string[]; // multiaddrs e.g. /ip4/198.51.100.1/tcp/4001/p2p/12D3KooW...
  readonly status: PeerConnectionStatus;
  readonly latencyMs?: number;
  readonly score: number;
  readonly connectionType?: ConnectionType | undefined;
  readonly binding?: PeerIdentityBinding | undefined;
}

export enum StreamFlag {
  SYN = 1,
  DATA = 2,
  FIN = 4,
  RST = 8,
}

export interface StreamFrame {
  readonly streamId: number;
  readonly flag: StreamFlag;
  readonly payload: Uint8Array;
}

export interface MuxedStream {
  readonly streamId: number;
  readonly protocolId: string;
  readonly isOpen: boolean;
  send(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  reset(reason?: string): void;
  onData(handler: (data: Uint8Array) => void | Promise<void>): void;
  onClose(handler: () => void): void;
  onError(handler: (err: Error) => void): void;
}

export interface TopicMessage<T = Uint8Array> {
  readonly topic: string;
  readonly fromPeerId: string;
  readonly data: T;
  readonly sequenceNumber: bigint;
  readonly receivedAt: number;
}

export type TopicMessageHandler<T = Uint8Array> = (
  message: TopicMessage<T>,
) => void | Promise<void>;

export interface PeerScoringParameters {
  readonly topicWeight: number;
  readonly timeInMeshWeight: number;
  readonly firstMessageDeliveriesWeight: number;
  readonly invalidMessageDeliveriesWeight: number;
  readonly decayIntervalMs: number;
  readonly graylistThreshold: number;
  readonly blacklistThreshold: number;
}

export interface PubSubService {
  subscribe(topic: string, handler?: TopicMessageHandler): Promise<Result<void>>;
  unsubscribe(topic: string): Promise<Result<void>>;
  publish(topic: string, data: Uint8Array): Promise<Result<{ messageId: string }>>;
  getSubscribedTopics(): readonly string[];
  setPeerScore(peerId: string, scoreDelta: number): void;
  getPeerScore(peerId: string): number;
}

export type DiscoverySourceType = 'local' | 'dht' | 'static' | 'relay';

export interface DiscoveredPeer {
  readonly peerId: string;
  readonly addresses: readonly string[];
  readonly source: DiscoverySourceType;
  readonly timestamp: number;
}

export interface BootstrapConfig {
  readonly bootstrapNodes: readonly string[];
  readonly communityNodes?: readonly string[];
  readonly userConfiguredNodes?: readonly string[];
  readonly cachedKnownPeers?: readonly string[];
}

export interface PeerDiscoveryService {
  startDiscovery(): Promise<Result<void>>;
  stopDiscovery(): Promise<Result<void>>;
  getDiscoveredPeers(): readonly PeerInfo[];
  addBootstrapNodes(bootstrapMultiaddrs: readonly string[]): void;
}

export interface DHTRecord {
  readonly key: string;
  readonly value: Uint8Array;
  readonly authorPeerId: string;
  readonly sequenceNumber: bigint;
  readonly timestamp: number;
  readonly signature?: string;
}

export interface DHTService {
  findClosestPeers(key: string, count?: number): Promise<readonly PeerInfo[]>;
  putValue(key: string, value: Uint8Array): Promise<Result<void>>;
  getValue(key: string): Promise<Result<DHTRecord | undefined>>;
  provide(key: string): Promise<Result<void>>;
  findProviders(key: string, count?: number): Promise<readonly string[]>;
}

export interface RelayReservation {
  readonly relayMultiaddr: string;
  readonly relayPeerId: string;
  readonly expiresAt: number;
  readonly active: boolean;
}

export interface RelayService {
  isRelayAvailable(): boolean;
  getActiveRelays(): readonly string[];
  requestReservation(relayMultiaddr: string): Promise<Result<boolean>>;
  getReservations(): readonly RelayReservation[];
}

export interface NatTraversalService {
  readonly status: NatStatus;
  detectNat(): Promise<NatStatus>;
  getPublicMultiaddrs(): readonly string[];
}

export interface RequestResponseProtocol<TReq = Uint8Array, TRes = Uint8Array> {
  sendRequest(
    peerId: string,
    protocolId: string,
    request: TReq,
    options?: { timeoutMs?: number; signal?: AbortSignal; retries?: number },
  ): Promise<Result<TRes>>;
  registerHandler(
    protocolId: string,
    handler: (peerId: string, request: TReq) => Promise<TRes>,
  ): void;
}

export interface ResourceLimits {
  readonly maxConnections: number;
  readonly maxInboundConnections?: number | undefined;
  readonly maxOutboundConnections?: number | undefined;
  readonly maxStreamsPerConnection: number;
  readonly maxMessageSizeBytes: number;
  readonly maxPendingRequests: number;
  readonly maxSubscriptions: number;
  readonly rateLimitMsgsPerSec: number;
}

export interface NodeMetricsSnapshot {
  readonly peerCount: number;
  readonly connectionCount: number;
  readonly directConnections: number;
  readonly relayedConnections: number;
  readonly failedConnections: number;
  readonly discoveryEvents: number;
  readonly dhtOperations: number;
  readonly gossipSubMessagesPublished: number;
  readonly gossipSubMessagesReceived: number;
  readonly rejectedMessages: number;
  readonly peerScoreChanges: number;
  readonly bytesReceived: number;
  readonly bytesSent: number;
  readonly averageLatencyMs: number;
}

export interface NodeMetricsService {
  getSnapshot(): NodeMetricsSnapshot;
}

export interface EventValidationResult {
  readonly isValid: boolean;
  readonly error?: string;
  readonly errorCode?: string;
  readonly stepFailed?: number;
}

export interface P2PNode {
  readonly identity: PeerIdentity;
  readonly binding?: PeerIdentityBinding | undefined;
  readonly isRunning: boolean;
  readonly limits: ResourceLimits;
  start(): Promise<Result<void>>;
  stop(): Promise<Result<void>>;
  dial(peerMultiaddr: string): Promise<Result<PeerInfo>>;
  disconnect(peerId: string): Promise<Result<void>>;
  getConnectedPeers(): readonly PeerInfo[];
  readonly pubsub: PubSubService;
  readonly discovery: PeerDiscoveryService;
  readonly relay: RelayService;
  readonly reqResp: RequestResponseProtocol;
  readonly dht: DHTService;
  readonly nat: NatTraversalService;
  readonly metrics: NodeMetricsService;
}
