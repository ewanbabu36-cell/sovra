import { Result, ok, err } from '@sovra/shared';
import { SovraDeviceKey, RevocationRegistry } from '@sovra/identity';
import {
  P2PNode,
  PeerIdentity,
  PeerIdentityBinding,
  PeerInfo,
  ResourceLimits,
  BootstrapConfig,
} from './types.js';
import { PeerConnectionError } from './errors.js';
import { derivePeerId } from './identity.js';
import { PeerScoringEngine } from './scoring.js';
import { GossipSubRouter } from './gossipsub.js';
import { PeerDiscoveryManager } from './discovery.js';
import { CircuitRelayClient } from './relay.js';
import { RequestResponseManager } from './reqresp.js';
import { KademliaDHT } from './dht.js';
import { NatManager } from './nat.js';
import { NodeMetricsCollector } from './metrics.js';
import { ConnectionManager, DEFAULT_RESOURCE_LIMITS } from './connection.js';

export interface SovraP2PNodeConfig {
  readonly deviceKey: SovraDeviceKey;
  readonly binding?: PeerIdentityBinding;
  readonly revocationRegistry?: RevocationRegistry;
  readonly limits?: Partial<ResourceLimits>;
  readonly bootstrapConfig?: Partial<BootstrapConfig>;
  readonly listenAddresses?: readonly string[];
  readonly relayAddresses?: readonly string[];
}

export class SovraP2PNode implements P2PNode {
  public readonly identity: PeerIdentity;
  public readonly binding?: PeerIdentityBinding | undefined;
  public readonly limits: ResourceLimits;
  private _isRunning = false;

  public readonly scoring: PeerScoringEngine;
  public readonly pubsub: GossipSubRouter;
  public readonly discovery: PeerDiscoveryManager;
  public readonly relay: CircuitRelayClient;
  public readonly reqResp: RequestResponseManager;
  public readonly dht: KademliaDHT;
  public readonly nat: NatManager;
  public readonly metrics: NodeMetricsCollector;
  public readonly connManager: ConnectionManager;

  constructor(public readonly config: SovraP2PNodeConfig) {
    const peerId = derivePeerId(config.deviceKey.publicKeyBytes);
    this.identity = {
      peerId,
      publicKeyHex: config.deviceKey.publicKeyHex,
    };
    this.binding = config.binding;

    this.limits = {
      ...DEFAULT_RESOURCE_LIMITS,
      ...config.limits,
    };

    this.scoring = new PeerScoringEngine();
    this.metrics = new NodeMetricsCollector();

    this.pubsub = new GossipSubRouter(peerId, this.scoring, config.revocationRegistry);

    const initialBootstraps = [
      ...(config.bootstrapConfig?.bootstrapNodes ?? []),
      ...(config.bootstrapConfig?.communityNodes ?? []),
      ...(config.bootstrapConfig?.userConfiguredNodes ?? []),
    ];
    this.discovery = new PeerDiscoveryManager(initialBootstraps);

    this.relay = new CircuitRelayClient(config.relayAddresses ?? []);
    this.reqResp = new RequestResponseManager();
    this.dht = new KademliaDHT(peerId, config.bootstrapConfig);
    this.nat = new NatManager(config.listenAddresses ?? []);

    this.connManager = new ConnectionManager(this.limits);
  }

  public get isRunning(): boolean {
    return this._isRunning;
  }

  public async start(): Promise<Result<void>> {
    if (this._isRunning) return ok(undefined);
    this._isRunning = true;

    await this.discovery.startDiscovery();
    await this.nat.detectNat();

    // Register initial relays
    if (this.relay.getActiveRelays().length > 0) {
      for (const relayAddr of this.relay.getActiveRelays()) {
        await this.relay.requestReservation(relayAddr);
      }
    }

    return ok(undefined);
  }

  public async stop(): Promise<Result<void>> {
    if (!this._isRunning) return ok(undefined);
    this._isRunning = false;

    await this.discovery.stopDiscovery();
    this.connManager.closeAll();

    return ok(undefined);
  }

  public async dial(peerMultiaddr: string): Promise<Result<PeerInfo>> {
    if (!this._isRunning) {
      return err(new PeerConnectionError('Cannot dial peer: P2PNode is not running'));
    }

    const connectResult = await this.connManager.connect(peerMultiaddr);
    if (!connectResult.ok) {
      this.metrics.recordFailedConnection();
      return err(connectResult.error);
    }

    const activeConn = connectResult.value;
    const parts = peerMultiaddr.split('/p2p/');
    const peerId = parts[1] ?? activeConn.peerId;

    const peerInfo: PeerInfo = {
      id: {
        peerId,
        publicKeyHex: '',
      },
      addresses: [peerMultiaddr],
      status: activeConn.status,
      score: this.scoring.getScore(peerId),
      connectionType: activeConn.status === 'relayed' ? 'relayed' : 'direct',
    };

    this.connManager.registerPeerInfo(peerInfo);
    this.dht.addPeer(peerInfo);

    const connectedPeers = this.getConnectedPeers();
    let directCount = 0;
    let relayedCount = 0;
    for (const p of connectedPeers) {
      if (p.connectionType === 'relayed') relayedCount++;
      else directCount++;
    }

    this.metrics.updatePeerAndConnectionCounts(
      connectedPeers.length,
      this.connManager.activeCount,
      directCount,
      relayedCount,
    );

    return ok(peerInfo);
  }

  public async disconnect(peerId: string): Promise<Result<void>> {
    this.connManager.disconnect(peerId);
    this.dht.removePeer(peerId);

    const connectedPeers = this.getConnectedPeers();
    let directCount = 0;
    let relayedCount = 0;
    for (const p of connectedPeers) {
      if (p.connectionType === 'relayed') relayedCount++;
      else directCount++;
    }

    this.metrics.updatePeerAndConnectionCounts(
      connectedPeers.length,
      this.connManager.activeCount,
      directCount,
      relayedCount,
    );

    return ok(undefined);
  }

  public getConnectedPeers(): readonly PeerInfo[] {
    return this.connManager.getConnectedPeers();
  }
}
