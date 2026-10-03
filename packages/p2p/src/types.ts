import { Result } from '@sovra/shared';

export type PeerConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface PeerIdentity {
  readonly peerId: string;
  readonly publicKeyHex: string;
}

export interface PeerInfo {
  readonly id: PeerIdentity;
  readonly addresses: readonly string[]; // multiaddrs e.g. /ip4/198.51.100.1/tcp/4001/p2p/Qm...
  readonly status: PeerConnectionStatus;
  readonly latencyMs?: number;
  readonly score: number;
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
}

export interface PubSubService {
  subscribe(topic: string, handler: TopicMessageHandler): Promise<Result<void>>;
  unsubscribe(topic: string): Promise<Result<void>>;
  publish(topic: string, data: Uint8Array): Promise<Result<{ messageId: string }>>;
  getSubscribedTopics(): readonly string[];
  setPeerScore(peerId: string, scoreDelta: number): void;
}

export interface PeerDiscoveryService {
  startDiscovery(): Promise<Result<void>>;
  stopDiscovery(): Promise<Result<void>>;
  getDiscoveredPeers(): readonly PeerInfo[];
  addBootstrapNodes(bootstrapMultiaddrs: readonly string[]): void;
}

export interface RelayService {
  isRelayAvailable(): boolean;
  getActiveRelays(): readonly string[];
  requestReservation(relayMultiaddr: string): Promise<Result<boolean>>;
}

export interface RequestResponseProtocol<TReq = Uint8Array, TRes = Uint8Array> {
  sendRequest(peerId: string, protocolId: string, request: TReq): Promise<Result<TRes>>;
  registerHandler(
    protocolId: string,
    handler: (peerId: string, request: TReq) => Promise<TRes>,
  ): void;
}

export interface P2PNode {
  readonly identity: PeerIdentity;
  readonly isRunning: boolean;
  start(): Promise<Result<void>>;
  stop(): Promise<Result<void>>;
  dial(peerMultiaddr: string): Promise<Result<PeerInfo>>;
  disconnect(peerId: string): Promise<Result<void>>;
  getConnectedPeers(): readonly PeerInfo[];
  readonly pubsub: PubSubService;
  readonly discovery: PeerDiscoveryService;
  readonly relay: RelayService;
  readonly reqResp: RequestResponseProtocol;
}
