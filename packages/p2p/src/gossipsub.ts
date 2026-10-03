import { Result, ok, err as resultErr } from '@sovra/shared';
import { sha256, bytesToHex } from '@sovra/crypto';
import { RevocationRegistry } from '@sovra/identity';
import { PubSubService, TopicMessage, TopicMessageHandler } from './types.js';
import { PubSubPublishError } from './errors.js';
import { PeerScoringEngine } from './scoring.js';
import { EventValidationPipeline } from './validation.js';

export interface GossipSubConfig {
  readonly d: number; // Target mesh degree (default 6)
  readonly dLow: number; // Lower mesh bound (default 4)
  readonly dHigh: number; // Upper mesh bound (default 12)
  readonly maxRatePerPeer: number; // Max messages per second per peer (default 50)
  readonly seenCacheSize: number; // Max deduplication cache entries (default 10000)
}

export const DEFAULT_GOSSIPSUB_CONFIG: GossipSubConfig = {
  d: 6,
  dLow: 4,
  dHigh: 12,
  maxRatePerPeer: 50,
  seenCacheSize: 10000,
};

export class GossipSubRouter implements PubSubService {
  private subscriptions = new Map<string, Set<TopicMessageHandler>>();
  private topicMesh = new Map<string, Set<string>>(); // topic -> Set<peerId>
  private seenCache = new Set<string>();
  private peerMessageCounters = new Map<string, { count: number; windowStart: number }>();
  private sequenceCounter = 0n;

  constructor(
    public readonly localPeerId: string,
    public readonly scoring: PeerScoringEngine,
    public readonly revocationRegistry?: RevocationRegistry,
    public readonly config: GossipSubConfig = DEFAULT_GOSSIPSUB_CONFIG,
    private readonly meshBroadcastFn?: (
      topic: string,
      data: Uint8Array,
      meshPeers: string[],
    ) => Promise<void>,
  ) {}

  public getSubscribedTopics(): readonly string[] {
    return Array.from(this.subscriptions.keys());
  }

  public getMeshPeers(topic: string): readonly string[] {
    return Array.from(this.topicMesh.get(topic) ?? []);
  }

  public async subscribe(topic: string, handler: TopicMessageHandler): Promise<Result<void>> {
    const handlers = this.subscriptions.get(topic) ?? new Set();
    handlers.add(handler);
    this.subscriptions.set(topic, handlers);

    if (!this.topicMesh.has(topic)) {
      this.topicMesh.set(topic, new Set());
    }

    return ok(undefined);
  }

  public async unsubscribe(topic: string): Promise<Result<void>> {
    this.subscriptions.delete(topic);
    this.topicMesh.delete(topic);
    return ok(undefined);
  }

  public addPeerToMesh(topic: string, peerId: string): void {
    if (this.scoring.isBlacklisted(peerId) || this.scoring.isGraylisted(peerId)) {
      return; // Do not graft low-scoring peers into mesh
    }
    const mesh = this.topicMesh.get(topic) ?? new Set();
    if (mesh.size < this.config.dHigh) {
      mesh.add(peerId);
      this.topicMesh.set(topic, mesh);
    }
  }

  public removePeerFromMesh(topic: string, peerId: string): void {
    this.topicMesh.get(topic)?.delete(peerId);
  }

  public async publish(topic: string, data: Uint8Array): Promise<Result<{ messageId: string }>> {
    const messageId = bytesToHex(sha256(data));
    this.seenCache.add(messageId);

    const message: TopicMessage = {
      topic,
      fromPeerId: this.localPeerId,
      data,
      sequenceNumber: ++this.sequenceCounter,
      receivedAt: Date.now(),
    };

    // Deliver to local subscribers
    const localHandlers = this.subscriptions.get(topic);
    if (localHandlers) {
      for (const handler of localHandlers) {
        try {
          await handler(message);
        } catch {
          // Ignore subscriber error
        }
      }
    }

    // Forward to active mesh peers
    const meshPeers = Array.from(this.topicMesh.get(topic) ?? []).filter(
      p => !this.scoring.isBlacklisted(p),
    );

    if (this.meshBroadcastFn && meshPeers.length > 0) {
      try {
        await this.meshBroadcastFn(topic, data, meshPeers);
      } catch (broadcastError) {
        return resultErr(
          new PubSubPublishError(
            `Failed to broadcast GossipSub message to mesh peers: ${broadcastError instanceof Error ? broadcastError.message : String(broadcastError)}`,
          ),
        );
      }
    }

    return ok({ messageId });
  }

  /**
   * Processes an incoming message received from a remote peer over GossipSub.
   * Enforces rate limiting, 10-step message validation, deduplication, and peer scoring.
   */
  public async handleInboundMessage(
    topic: string,
    fromPeerId: string,
    data: Uint8Array,
  ): Promise<boolean> {
    // 1. Blacklist check
    if (this.scoring.isBlacklisted(fromPeerId)) {
      return false;
    }

    // 2. Rate limiting check
    const now = Date.now();
    const rateData = this.peerMessageCounters.get(fromPeerId) ?? { count: 0, windowStart: now };
    if (now - rateData.windowStart > 1000) {
      rateData.count = 1;
      rateData.windowStart = now;
    } else {
      rateData.count++;
      if (rateData.count > this.config.maxRatePerPeer) {
        this.scoring.onRateLimitExceeded(fromPeerId);
        return false;
      }
    }
    this.peerMessageCounters.set(fromPeerId, rateData);

    // 3. Deduplication check
    const messageId = bytesToHex(sha256(data));
    if (this.seenCache.has(messageId)) {
      return false; // Already seen, suppress duplicate
    }

    // Maintain bounded size for seenCache
    if (this.seenCache.size >= this.config.seenCacheSize) {
      const firstEntry = this.seenCache.values().next().value;
      if (firstEntry) this.seenCache.delete(firstEntry);
    }
    this.seenCache.add(messageId);

    // 4. 10-Step Message Validation Pipeline
    const validationResult = EventValidationPipeline.validate(data, {
      topic,
      revocationRegistry: this.revocationRegistry,
      seenEventIds: this.seenCache,
    });

    if (!validationResult.isValid) {
      // Penalize sender according to failure reason
      if (validationResult.stepFailed === 7) {
        this.scoring.onInvalidSignature(fromPeerId);
      } else if (validationResult.stepFailed === 1 || validationResult.stepFailed === 2) {
        this.scoring.onMalformedMessage(fromPeerId);
      } else {
        this.scoring.onProtocolViolation(fromPeerId, validationResult.errorCode);
      }
      return false;
    }

    // 5. Reward valid message delivery
    this.scoring.onValidMessageDelivery(fromPeerId);

    // 6. Deliver to local subscribers
    const localHandlers = this.subscriptions.get(topic);
    if (localHandlers) {
      const topicMsg: TopicMessage = {
        topic,
        fromPeerId,
        data,
        sequenceNumber: ++this.sequenceCounter,
        receivedAt: now,
      };
      for (const handler of localHandlers) {
        try {
          await handler(topicMsg);
        } catch {
          // Ignore subscriber error
        }
      }
    }

    // 7. Forward to other mesh peers (excluding sender)
    const meshPeers = Array.from(this.topicMesh.get(topic) ?? []).filter(
      p => p !== fromPeerId && !this.scoring.isBlacklisted(p),
    );

    if (this.meshBroadcastFn && meshPeers.length > 0) {
      await this.meshBroadcastFn(topic, data, meshPeers);
    }

    return true;
  }

  public setPeerScore(peerId: string, scoreDelta: number): void {
    this.scoring.recordScoreDelta(peerId, scoreDelta, 'manual_adjustment');
  }

  public getPeerScore(peerId: string): number {
    return this.scoring.getScore(peerId);
  }
}
