import { NodeMetricsService, NodeMetricsSnapshot } from './types.js';

export class NodeMetricsCollector implements NodeMetricsService {
  private peerCount = 0;
  private connectionCount = 0;
  private directConnections = 0;
  private relayedConnections = 0;
  private failedConnections = 0;
  private discoveryEvents = 0;
  private dhtOperations = 0;
  private gossipSubMessagesPublished = 0;
  private gossipSubMessagesReceived = 0;
  private rejectedMessages = 0;
  private peerScoreChanges = 0;
  private bytesReceived = 0;
  private bytesSent = 0;
  private totalLatencySamples = 0;
  private latencySumMs = 0;

  public updatePeerAndConnectionCounts(
    peers: number,
    connections: number,
    direct: number,
    relayed: number,
  ): void {
    this.peerCount = peers;
    this.connectionCount = connections;
    this.directConnections = direct;
    this.relayedConnections = relayed;
  }

  public recordFailedConnection(): void {
    this.failedConnections++;
  }

  public recordDiscoveryEvent(): void {
    this.discoveryEvents++;
  }

  public recordDHTOperation(): void {
    this.dhtOperations++;
  }

  public recordGossipSubPublished(byteLength: number): void {
    this.gossipSubMessagesPublished++;
    this.bytesSent += byteLength;
  }

  public recordGossipSubReceived(byteLength: number): void {
    this.gossipSubMessagesReceived++;
    this.bytesReceived += byteLength;
  }

  public recordRejectedMessage(): void {
    this.rejectedMessages++;
  }

  public recordPeerScoreChange(): void {
    this.peerScoreChanges++;
  }

  public recordLatencySample(latencyMs: number): void {
    this.totalLatencySamples++;
    this.latencySumMs += latencyMs;
  }

  public recordBytesTransferred(inbound: number, outbound: number): void {
    this.bytesReceived += inbound;
    this.bytesSent += outbound;
  }

  public getSnapshot(): NodeMetricsSnapshot {
    return {
      peerCount: this.peerCount,
      connectionCount: this.connectionCount,
      directConnections: this.directConnections,
      relayedConnections: this.relayedConnections,
      failedConnections: this.failedConnections,
      discoveryEvents: this.discoveryEvents,
      dhtOperations: this.dhtOperations,
      gossipSubMessagesPublished: this.gossipSubMessagesPublished,
      gossipSubMessagesReceived: this.gossipSubMessagesReceived,
      rejectedMessages: this.rejectedMessages,
      peerScoreChanges: this.peerScoreChanges,
      bytesReceived: this.bytesReceived,
      bytesSent: this.bytesSent,
      averageLatencyMs:
        this.totalLatencySamples > 0
          ? Math.round((this.latencySumMs / this.totalLatencySamples) * 100) / 100
          : 0,
    };
  }
}
