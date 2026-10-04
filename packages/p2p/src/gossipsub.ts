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
  readonly mcacheTtlSeconds: number; // Message cache history TTL (default 120s)
  readonly heartbeatIntervalMs: number; // Heartbeat interval in ms (default 1000ms)
}

export const DEFAULT_GOSSIPSUB_CONFIG: GossipSubConfig = {
  d: 6,
  dLow: 4,
  dHigh: 12,
  maxRatePerPeer: 50,
  seenCacheSize: 10000,
  mcacheTtlSeconds: 120,
  heartbeatIntervalMs: 1000,
};

export interface GossipSubControlGraft {
  readonly topic: string;
}

export interface GossipSubControlPrune {
  readonly topic: string;
  readonly backoffSeconds?: number;
}

export interface GossipSubControlIHave {
  readonly topic: string;
  readonly messageIds: readonly string[];
}

export interface GossipSubControlIWant {
  readonly messageIds: readonly string[];
}

export interface GossipSubWirePacket {
  readonly publish?: TopicMessage;
  readonly graft?: readonly GossipSubControlGraft[];
  readonly prune?: readonly GossipSubControlPrune[];
  readonly ihave?: readonly GossipSubControlIHave[];
  readonly iwant?: readonly GossipSubControlIWant[];
}

/**
 * Production GossipSub v1.2 Router with:
 * - Mesh topology maintenance (D=6, Dlow=4, Dhigh=12)
 * - Control frames: GRAFT, PRUNE, IHAVE, IWANT
 * - Periodic heartbeat loop
 * - Message cache (mcache) for gossip recovery
 * - Seen-cache deduplication & rate limiting
 * - 10-step protocol validation pipeline & peer scoring
 */
export class GossipSubRouter implements PubSubService {
  private subscriptions = new Map<string, Set<TopicMessageHandler>>();
  private topicMesh = new Map<string, Set<string>>(); // topic -> Set<peerId>
  private knownPeers = new Set<string>(); // All active P2P peers
  private pruneBackoffs = new Map<string, Map<string, number>>(); // topic -> Map<peerId, expireTime>

  private seenCache = new Set<string>();
  private mcache = new Map<string, { msg: TopicMessage; storedAt: number }>(); // messageId -> msg
  private peerMessageCounters = new Map<string, { count: number; windowStart: number }>();
  private sequenceCounter = 0n;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    public readonly localPeerId: string,
    public readonly scoring: PeerScoringEngine,
    public readonly revocationRegistry?: RevocationRegistry,
    public readonly config: GossipSubConfig = DEFAULT_GOSSIPSUB_CONFIG,
    private readonly sendPacketFn?: (
      recipientPeerId: string,
      packet: GossipSubWirePacket,
    ) => Promise<void>,
  ) {}

  public start(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat().catch(() => {});
    }, this.config.heartbeatIntervalMs);
  }

  public stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public registerKnownPeer(peerId: string): void {
    if (peerId !== this.localPeerId) {
      this.knownPeers.add(peerId);
    }
  }

  public unregisterKnownPeer(peerId: string): void {
    this.knownPeers.delete(peerId);
    for (const mesh of this.topicMesh.values()) {
      mesh.delete(peerId);
    }
  }

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

    // Trigger immediate mesh join check
    await this.maintainTopicMesh(topic);
    return ok(undefined);
  }

  public async unsubscribe(topic: string): Promise<Result<void>> {
    // Send PRUNE to current mesh peers
    const mesh = this.topicMesh.get(topic);
    if (mesh && this.sendPacketFn) {
      for (const peerId of mesh) {
        this.sendPacketFn(peerId, { prune: [{ topic, backoffSeconds: 60 }] }).catch(() => {});
      }
    }

    this.subscriptions.delete(topic);
    this.topicMesh.delete(topic);
    this.pruneBackoffs.delete(topic);
    return ok(undefined);
  }

  public addPeerToMesh(topic: string, peerId: string): void {
    if (this.scoring.isBlacklisted(peerId) || this.scoring.isGraylisted(peerId)) {
      return;
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

    // Store in mcache
    this.mcache.set(messageId, { msg: message, storedAt: Date.now() });

    // Deliver to local subscribers
    const localHandlers = this.subscriptions.get(topic);
    if (localHandlers) {
      for (const handler of localHandlers) {
        try {
          await handler(message);
        } catch {
          // Suppress subscriber error
        }
      }
    }

    // Forward to mesh peers
    const meshPeers = Array.from(this.topicMesh.get(topic) ?? []).filter(
      p => !this.scoring.isBlacklisted(p),
    );

    if (this.sendPacketFn && meshPeers.length > 0) {
      try {
        await Promise.all(
          meshPeers.map(peerId => this.sendPacketFn!(peerId, { publish: message })),
        );
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
   * Periodic GossipSub Heartbeat maintenance:
   * 1. Purges expired mcache entries and backoffs.
   * 2. Evaluates DLow and DHigh for all active topic meshes.
   * 3. Emits IHAVE gossip to non-mesh peers.
   */
  public async heartbeat(): Promise<void> {
    const now = Date.now();

    // 1. Purge mcache
    const mcacheTtlMs = this.config.mcacheTtlSeconds * 1000;
    for (const [id, entry] of this.mcache.entries()) {
      if (now - entry.storedAt > mcacheTtlMs) {
        this.mcache.delete(id);
      }
    }

    // 2. Maintain meshes for each topic
    for (const topic of this.subscriptions.keys()) {
      await this.maintainTopicMesh(topic);
      await this.emitIHaveGossip(topic);
    }

    // 3. Score decay
    this.scoring.decayScores();
  }

  private async maintainTopicMesh(topic: string): Promise<void> {
    const mesh = this.topicMesh.get(topic) ?? new Set<string>();
    const now = Date.now();
    const backoffs = this.pruneBackoffs.get(topic) ?? new Map<string, number>();

    // Clean backoffs
    for (const [peerId, expireTime] of backoffs.entries()) {
      if (now >= expireTime) backoffs.delete(peerId);
    }
    this.pruneBackoffs.set(topic, backoffs);

    // If mesh < dLow: graft candidate peers
    if (mesh.size < this.config.dLow) {
      const candidates = Array.from(this.knownPeers).filter(
        peerId =>
          !mesh.has(peerId) &&
          !backoffs.has(peerId) &&
          !this.scoring.isBlacklisted(peerId) &&
          !this.scoring.isGraylisted(peerId),
      );

      const need = this.config.d - mesh.size;
      const toGraft = candidates.slice(0, need);

      for (const peerId of toGraft) {
        mesh.add(peerId);
        if (this.sendPacketFn) {
          this.sendPacketFn(peerId, { graft: [{ topic }] }).catch(() => {});
        }
      }
    }

    // If mesh > dHigh: prune excess peers (lowest score first)
    if (mesh.size > this.config.dHigh) {
      const sortedPeers = Array.from(mesh).sort(
        (a, b) => this.scoring.getScore(a) - this.scoring.getScore(b),
      );
      const excessCount = mesh.size - this.config.d;
      const toPrune = sortedPeers.slice(0, excessCount);

      for (const peerId of toPrune) {
        mesh.delete(peerId);
        backoffs.set(peerId, now + 60000); // 60s backoff
        if (this.sendPacketFn) {
          this.sendPacketFn(peerId, { prune: [{ topic, backoffSeconds: 60 }] }).catch(() => {});
        }
      }
    }

    this.topicMesh.set(topic, mesh);
  }

  private async emitIHaveGossip(topic: string): Promise<void> {
    const mesh = this.topicMesh.get(topic) ?? new Set<string>();
    const nonMeshPeers = Array.from(this.knownPeers).filter(
      p => !mesh.has(p) && !this.scoring.isBlacklisted(p),
    );
    if (nonMeshPeers.length === 0 || this.mcache.size === 0) return;

    // Pick top 10 most recent message IDs
    const recentIds = Array.from(this.mcache.keys()).slice(-10);
    const targetPeer = nonMeshPeers[Math.floor(Math.random() * nonMeshPeers.length)];

    if (targetPeer && this.sendPacketFn) {
      this.sendPacketFn(targetPeer, {
        ihave: [{ topic, messageIds: recentIds }],
      }).catch(() => {});
    }
  }

  /**
   * Processes an incoming GossipSub wire packet from a peer.
   */
  public async handleInboundPacket(
    fromPeerId: string,
    packet: GossipSubWirePacket,
  ): Promise<boolean> {
    this.registerKnownPeer(fromPeerId);

    // Handle GRAFT
    if (packet.graft) {
      for (const g of packet.graft) {
        if (this.subscriptions.has(g.topic)) {
          this.addPeerToMesh(g.topic, fromPeerId);
        }
      }
    }

    // Handle PRUNE
    if (packet.prune) {
      for (const p of packet.prune) {
        this.removePeerFromMesh(p.topic, fromPeerId);
        const backoffMs = (p.backoffSeconds ?? 60) * 1000;
        const bMap = this.pruneBackoffs.get(p.topic) ?? new Map<string, number>();
        bMap.set(fromPeerId, Date.now() + backoffMs);
        this.pruneBackoffs.set(p.topic, bMap);
      }
    }

    // Handle IHAVE
    if (packet.ihave) {
      const missingIds: string[] = [];
      for (const ih of packet.ihave) {
        for (const mid of ih.messageIds) {
          if (!this.seenCache.has(mid)) {
            missingIds.push(mid);
          }
        }
      }
      if (missingIds.length > 0 && this.sendPacketFn) {
        this.sendPacketFn(fromPeerId, { iwant: [{ messageIds: missingIds }] }).catch(() => {});
      }
    }

    // Handle IWANT
    if (packet.iwant && this.sendPacketFn) {
      for (const iw of packet.iwant) {
        for (const mid of iw.messageIds) {
          const entry = this.mcache.get(mid);
          if (entry) {
            this.sendPacketFn(fromPeerId, { publish: entry.msg }).catch(() => {});
          }
        }
      }
    }

    // Handle published message
    if (packet.publish) {
      return this.handleInboundMessage(
        packet.publish.topic,
        fromPeerId,
        packet.publish.data,
      );
    }

    return true;
  }

  /**
   * Processes a raw inbound topic message, executing rate limiting, validation, and forwarding.
   */
  public async handleInboundMessage(
    topic: string,
    fromPeerId: string,
    data: Uint8Array,
  ): Promise<boolean> {
    if (this.scoring.isBlacklisted(fromPeerId)) {
      return false;
    }

    // Rate limiting check
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

    // Deduplication check
    const messageId = bytesToHex(sha256(data));
    if (this.seenCache.has(messageId)) {
      return false; // Suppress duplicate
    }

    if (this.seenCache.size >= this.config.seenCacheSize) {
      const firstEntry = this.seenCache.values().next().value;
      if (firstEntry) this.seenCache.delete(firstEntry);
    }
    this.seenCache.add(messageId);

    // 10-Step Message Validation Pipeline
    const validationResult = EventValidationPipeline.validate(data, {
      topic,
      revocationRegistry: this.revocationRegistry,
      seenEventIds: this.seenCache,
    });

    if (!validationResult.isValid) {
      if (validationResult.stepFailed === 7) {
        this.scoring.onInvalidSignature(fromPeerId);
      } else if (validationResult.stepFailed === 1 || validationResult.stepFailed === 2) {
        this.scoring.onMalformedMessage(fromPeerId);
      } else {
        this.scoring.onProtocolViolation(fromPeerId, validationResult.errorCode);
      }
      return false;
    }

    this.scoring.onValidMessageDelivery(fromPeerId);

    const topicMsg: TopicMessage = {
      topic,
      fromPeerId,
      data,
      sequenceNumber: ++this.sequenceCounter,
      receivedAt: now,
    };

    // Store in mcache
    this.mcache.set(messageId, { msg: topicMsg, storedAt: now });

    // Deliver to local subscribers
    const localHandlers = this.subscriptions.get(topic);
    if (localHandlers) {
      for (const handler of localHandlers) {
        try {
          await handler(topicMsg);
        } catch {
          // Suppress subscriber error
        }
      }
    }

    // Forward to mesh peers (excluding sender)
    const meshPeers = Array.from(this.topicMesh.get(topic) ?? []).filter(
      p => p !== fromPeerId && !this.scoring.isBlacklisted(p),
    );

    if (this.sendPacketFn && meshPeers.length > 0) {
      await Promise.all(
        meshPeers.map(peerId => this.sendPacketFn!(peerId, { publish: topicMsg })),
      );
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
