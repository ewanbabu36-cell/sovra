/**
 * @file packages/p2p/src/mesh/outbox-store.ts
 * Durable Store-and-Forward Outbox, Relay Queue, and Inbox for Offline Mesh.
 *
 * Implements:
 * 1. Persistent Outbox with truthful state lifecycle:
 *    QUEUED -> SENDING -> RELAYED -> DELIVERED -> ACKNOWLEDGED / FAILED / EXPIRED.
 * 2. Store-and-Forward Relay Queue with strict TTL, priority queues, and bounds.
 * 3. Durable Inbox with deduplication and replay protection.
 * 4. Local disk persistence surviving application or device restarts.
 * 5. Emergency Panic Wipe for secure local data destruction.
 */

import * as fs from 'fs';
import * as path from 'path';
import { bytesToHex, hexToBytes } from '@sovra/crypto';
import {
  MeshEnvelope,
  OutboxItem,
  DeliveryState,
} from './types.js';

export interface SerializedOutboxItem {
  envelope: {
    envelopeId: string;
    envelopeType: string;
    originDid: string;
    targetDid: string;
    hopCount: number;
    maxHops: number;
    route: string[];
    timestamp: number;
    expiresAt: number;
    priority: number;
    payloadBytesHex: string;
    signatureHex: string;
    nonce?: string | undefined;
  };
  status: DeliveryState;
  createdAt: number;
  lastAttemptAt?: number | undefined;
  retryCount: number;
  relayedByPeers: string[];
  acknowledgedAt?: number | undefined;
  failureReason?: string | undefined;
}

export interface DurableMeshStoreConfig {
  storageDir?: string | undefined;
  maxRelayQueueSize?: number | undefined;
  maxInboxSize?: number | undefined;
  maxSeenCacheSize?: number | undefined;
}

export class DurableOutboxStore {
  private readonly storageDir?: string | undefined;
  private readonly maxRelayQueueSize: number;
  private readonly maxInboxSize: number;
  private readonly maxSeenCacheSize: number;

  // Local outbox: envelopes originated by this device
  private outbox = new Map<string, OutboxItem>();

  // Relay queue: envelopes transitively held for other nodes
  private relayQueue = new Map<string, MeshEnvelope>();

  // Inbox: envelopes received for local node or broadcast
  private inbox = new Map<string, MeshEnvelope>();

  // Seen envelopes cache (for replay suppression and duplicate drops)
  private seenEnvelopeIds = new Set<string>();
  private seenQueue: string[] = [];

  constructor(config: DurableMeshStoreConfig = {}) {
    this.storageDir = config.storageDir;
    this.maxRelayQueueSize = config.maxRelayQueueSize ?? 1000;
    this.maxInboxSize = config.maxInboxSize ?? 2000;
    this.maxSeenCacheSize = config.maxSeenCacheSize ?? 10000;
  }

  // ==========================================
  // 1. OUTBOX MANAGEMENT (Local Origins)
  // ==========================================

  public enqueueOutbox(envelope: MeshEnvelope): OutboxItem {
    const now = Date.now();
    if (envelope.expiresAt <= now) {
      const expiredItem: OutboxItem = {
        envelope,
        status: 'EXPIRED',
        createdAt: now,
        retryCount: 0,
        relayedByPeers: [],
        failureReason: 'Envelope already expired at creation',
      };
      this.outbox.set(envelope.envelopeId, expiredItem);
      this.markSeen(envelope.envelopeId);
      return expiredItem;
    }

    const item: OutboxItem = {
      envelope,
      status: 'QUEUED',
      createdAt: now,
      retryCount: 0,
      relayedByPeers: [],
    };

    this.outbox.set(envelope.envelopeId, item);
    this.markSeen(envelope.envelopeId);
    return item;
  }

  public getPendingOutbox(maxCount = 50): OutboxItem[] {
    const now = Date.now();
    const pending: OutboxItem[] = [];

    for (const item of this.outbox.values()) {
      if (item.envelope.expiresAt <= now) {
        if (item.status !== 'EXPIRED' && item.status !== 'ACKNOWLEDGED') {
          this.outbox.set(item.envelope.envelopeId, {
            ...item,
            status: 'EXPIRED',
            failureReason: 'Envelope TTL expired while pending delivery',
          });
        }
        continue;
      }

      const isPending = [
        'LOCAL',
        'QUEUED',
        'DISCOVERING',
        'CONNECTING',
        'TRANSFERRING',
        'SENDING',
        'STORED_BY_PEER',
        'FORWARDED',
        'RELAYED',
      ].includes(item.status);

      if (isPending) {
        pending.push(item);
        if (pending.length >= maxCount) break;
      }
    }

    // Sort by priority descending (emergency first), then createdAt ascending (FIFO)
    return pending.sort((a, b) => {
      if (b.envelope.priority !== a.envelope.priority) {
        return b.envelope.priority - a.envelope.priority;
      }
      return a.createdAt - b.createdAt;
    });
  }

  public updateStatus(
    envelopeId: string,
    status: DeliveryState,
    details?: { peerDid?: string; failureReason?: string; timestamp?: number },
  ): void {
    const item = this.outbox.get(envelopeId);
    if (!item || item.status === 'ACKNOWLEDGED' || item.status === 'EXPIRED') return;

    let relayedByPeers = item.relayedByPeers;
    if (details?.peerDid) {
      const peers = new Set(item.relayedByPeers);
      peers.add(details.peerDid);
      relayedByPeers = Array.from(peers);
    }

    this.outbox.set(envelopeId, {
      ...item,
      status,
      relayedByPeers,
      lastAttemptAt: details?.timestamp ?? Date.now(),
      failureReason: details?.failureReason ?? item.failureReason,
    });
  }

  public markLocal(envelopeId: string): void {
    this.updateStatus(envelopeId, 'LOCAL');
  }

  public markDiscovering(envelopeId: string): void {
    this.updateStatus(envelopeId, 'DISCOVERING');
  }

  public markConnecting(envelopeId: string): void {
    this.updateStatus(envelopeId, 'CONNECTING');
  }

  public markTransferring(envelopeId: string): void {
    const item = this.outbox.get(envelopeId);
    if (!item || item.status === 'ACKNOWLEDGED' || item.status === 'EXPIRED') return;

    this.outbox.set(envelopeId, {
      ...item,
      status: 'TRANSFERRING',
      lastAttemptAt: Date.now(),
      retryCount: item.retryCount + 1,
    });
  }

  public markStoredByPeer(envelopeId: string, peerDid: string): void {
    this.updateStatus(envelopeId, 'STORED_BY_PEER', { peerDid });
  }

  public markForwarded(envelopeId: string, peerDid: string): void {
    this.updateStatus(envelopeId, 'FORWARDED', { peerDid });
  }

  public markSynced(envelopeId: string): void {
    this.updateStatus(envelopeId, 'SYNCED');
  }

  public markConfirmed(envelopeId: string): void {
    this.updateStatus(envelopeId, 'CONFIRMED');
  }

  public markSending(envelopeId: string): void {
    const item = this.outbox.get(envelopeId);
    if (!item || item.status === 'ACKNOWLEDGED' || item.status === 'EXPIRED') return;

    this.outbox.set(envelopeId, {
      ...item,
      status: 'SENDING',
      lastAttemptAt: Date.now(),
      retryCount: item.retryCount + 1,
    });
  }

  public markRelayed(envelopeId: string, peerDid: string): void {
    const item = this.outbox.get(envelopeId);
    if (!item || item.status === 'ACKNOWLEDGED' || item.status === 'EXPIRED') return;

    const peers = new Set(item.relayedByPeers);
    peers.add(peerDid);

    this.outbox.set(envelopeId, {
      ...item,
      status: 'RELAYED',
      relayedByPeers: Array.from(peers),
    });
  }

  public markDelivered(envelopeId: string): void {
    const item = this.outbox.get(envelopeId);
    if (!item || item.status === 'ACKNOWLEDGED' || item.status === 'EXPIRED') return;

    this.outbox.set(envelopeId, {
      ...item,
      status: 'DELIVERED',
    });
  }

  public markAcknowledged(envelopeId: string, ackTimestamp = Date.now()): boolean {
    const item = this.outbox.get(envelopeId);
    if (!item) return false;

    this.outbox.set(envelopeId, {
      ...item,
      status: 'ACKNOWLEDGED',
      acknowledgedAt: ackTimestamp,
    });
    return true;
  }

  public markFailed(envelopeId: string, reason: string): void {
    const item = this.outbox.get(envelopeId);
    if (!item || item.status === 'ACKNOWLEDGED') return;

    this.outbox.set(envelopeId, {
      ...item,
      status: 'FAILED',
      failureReason: reason,
    });
  }

  public getOutboxItem(envelopeId: string): OutboxItem | undefined {
    return this.outbox.get(envelopeId);
  }

  public getAllOutbox(): readonly OutboxItem[] {
    return Array.from(this.outbox.values());
  }

  // ==========================================
  // 2. RELAY QUEUE (Store-and-Forward Transit)
  // ==========================================

  public enqueueRelay(envelope: MeshEnvelope): boolean {
    const now = Date.now();

    // 1. Expiry check
    if (envelope.expiresAt <= now) {
      return false;
    }

    // 2. Hop limit check
    if (envelope.hopCount >= envelope.maxHops) {
      return false;
    }

    // 3. Deduplication check
    if (this.relayQueue.has(envelope.envelopeId)) {
      return false;
    }

    // 4. Capacity bounds & LRU eviction if full
    if (this.relayQueue.size >= this.maxRelayQueueSize) {
      // Evict lowest priority / earliest expiring item
      let evictId: string | null = null;
      let lowestPriority = Infinity;
      let earliestExpiry = Infinity;

      for (const [id, env] of this.relayQueue.entries()) {
        if (env.priority < lowestPriority || (env.priority === lowestPriority && env.expiresAt < earliestExpiry)) {
          lowestPriority = env.priority;
          earliestExpiry = env.expiresAt;
          evictId = id;
        }
      }

      if (evictId && lowestPriority <= envelope.priority) {
        this.relayQueue.delete(evictId);
      } else if (evictId && lowestPriority > envelope.priority) {
        // New envelope has lower priority than anything in queue, reject
        return false;
      }
    }

    this.relayQueue.set(envelope.envelopeId, envelope);
    this.markSeen(envelope.envelopeId);
    return true;
  }

  public getNextRelayBatch(limit = 20): MeshEnvelope[] {
    const now = Date.now();
    const valid: MeshEnvelope[] = [];

    for (const [id, envelope] of this.relayQueue.entries()) {
      if (envelope.expiresAt <= now) {
        this.relayQueue.delete(id);
        continue;
      }
      valid.push(envelope);
      if (valid.length >= limit) break;
    }

    return valid.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.timestamp - b.timestamp;
    });
  }

  public removeRelay(envelopeId: string): void {
    this.relayQueue.delete(envelopeId);
  }

  public getRelayQueueSize(): number {
    return this.relayQueue.size;
  }

  // ==========================================
  // 3. INBOX MANAGEMENT (Received for local node)
  // ==========================================

  public storeInbox(envelope: MeshEnvelope): boolean {
    const now = Date.now();

    if (envelope.expiresAt <= now) {
      return false;
    }

    if (this.inbox.has(envelope.envelopeId)) {
      return false;
    }

    if (this.inbox.size >= this.maxInboxSize) {
      // Evict oldest inbox item
      const oldestKey = this.inbox.keys().next().value;
      if (oldestKey) {
        this.inbox.delete(oldestKey);
      }
    }

    this.inbox.set(envelope.envelopeId, envelope);
    this.markSeen(envelope.envelopeId);
    return true;
  }

  public getInbox(): readonly MeshEnvelope[] {
    return Array.from(this.inbox.values());
  }

  public getInboxEnvelope(envelopeId: string): MeshEnvelope | undefined {
    return this.inbox.get(envelopeId);
  }

  // ==========================================
  // 4. DUPLICATE & REPLAY SUPPRESSION
  // ==========================================

  public isSeen(envelopeId: string): boolean {
    return this.seenEnvelopeIds.has(envelopeId);
  }

  public markSeen(envelopeId: string): void {
    if (this.seenEnvelopeIds.has(envelopeId)) return;

    this.seenEnvelopeIds.add(envelopeId);
    this.seenQueue.push(envelopeId);

    if (this.seenQueue.length > this.maxSeenCacheSize) {
      const evicted = this.seenQueue.shift();
      if (evicted) {
        this.seenEnvelopeIds.delete(evicted);
      }
    }
  }

  // ==========================================
  // 5. MAINTENANCE & PRUNING
  // ==========================================

  public pruneExpired(now = Date.now()): { prunedOutbox: number; prunedRelay: number; prunedInbox: number } {
    let prunedOutbox = 0;
    let prunedRelay = 0;
    let prunedInbox = 0;

    for (const [id, item] of this.outbox.entries()) {
      if (item.envelope.expiresAt <= now && item.status !== 'ACKNOWLEDGED') {
        this.outbox.set(id, {
          ...item,
          status: 'EXPIRED',
          failureReason: 'TTL expired during periodic pruning',
        });
        prunedOutbox++;
      }
    }

    for (const [id, envelope] of this.relayQueue.entries()) {
      if (envelope.expiresAt <= now) {
        this.relayQueue.delete(id);
        prunedRelay++;
      }
    }

    for (const [id, envelope] of this.inbox.entries()) {
      if (envelope.expiresAt <= now) {
        this.inbox.delete(id);
        prunedInbox++;
      }
    }

    return { prunedOutbox, prunedRelay, prunedInbox };
  }

  // ==========================================
  // 6. EMERGENCY PANIC WIPE
  // ==========================================

  public async panicWipe(): Promise<void> {
    this.outbox.clear();
    this.relayQueue.clear();
    this.inbox.clear();
    this.seenEnvelopeIds.clear();
    this.seenQueue = [];

    if (this.storageDir) {
      try {
        const outboxFile = path.join(this.storageDir, 'mesh_outbox.json');
        const relayFile = path.join(this.storageDir, 'mesh_relay.json');
        const inboxFile = path.join(this.storageDir, 'mesh_inbox.json');

        if (fs.existsSync(outboxFile)) await fs.promises.unlink(outboxFile);
        if (fs.existsSync(relayFile)) await fs.promises.unlink(relayFile);
        if (fs.existsSync(inboxFile)) await fs.promises.unlink(inboxFile);
      } catch (err) {
        // Secure wipe continues even if file system unlinks fail
      }
    }
  }

  // ==========================================
  // 7. DURABLE DISK PERSISTENCE
  // ==========================================

  public async save(): Promise<void> {
    if (!this.storageDir) return;

    await fs.promises.mkdir(this.storageDir, { recursive: true });

    // 1. Serialize Outbox
    const serializedOutbox: SerializedOutboxItem[] = Array.from(this.outbox.values()).map(item => ({
      envelope: {
        envelopeId: item.envelope.envelopeId,
        envelopeType: item.envelope.envelopeType,
        originDid: item.envelope.originDid,
        targetDid: item.envelope.targetDid,
        hopCount: item.envelope.hopCount,
        maxHops: item.envelope.maxHops,
        route: Array.from(item.envelope.route),
        timestamp: item.envelope.timestamp,
        expiresAt: item.envelope.expiresAt,
        priority: item.envelope.priority,
        payloadBytesHex: bytesToHex(item.envelope.payloadBytes),
        signatureHex: item.envelope.signatureHex,
        ...(item.envelope.nonce ? { nonce: item.envelope.nonce } : {}),
      },
      status: item.status,
      createdAt: item.createdAt,
      ...(item.lastAttemptAt ? { lastAttemptAt: item.lastAttemptAt } : {}),
      retryCount: item.retryCount,
      relayedByPeers: Array.from(item.relayedByPeers),
      ...(item.acknowledgedAt ? { acknowledgedAt: item.acknowledgedAt } : {}),
      ...(item.failureReason ? { failureReason: item.failureReason } : {}),
    }));

    // 2. Serialize Relay Queue
    const serializedRelay = Array.from(this.relayQueue.values()).map(env => ({
      envelopeId: env.envelopeId,
      envelopeType: env.envelopeType,
      originDid: env.originDid,
      targetDid: env.targetDid,
      hopCount: env.hopCount,
      maxHops: env.maxHops,
      route: Array.from(env.route),
      timestamp: env.timestamp,
      expiresAt: env.expiresAt,
      priority: env.priority,
      payloadBytesHex: bytesToHex(env.payloadBytes),
      signatureHex: env.signatureHex,
      ...(env.nonce ? { nonce: env.nonce } : {}),
    }));

    // 3. Serialize Inbox
    const serializedInbox = Array.from(this.inbox.values()).map(env => ({
      envelopeId: env.envelopeId,
      envelopeType: env.envelopeType,
      originDid: env.originDid,
      targetDid: env.targetDid,
      hopCount: env.hopCount,
      maxHops: env.maxHops,
      route: Array.from(env.route),
      timestamp: env.timestamp,
      expiresAt: env.expiresAt,
      priority: env.priority,
      payloadBytesHex: bytesToHex(env.payloadBytes),
      signatureHex: env.signatureHex,
      ...(env.nonce ? { nonce: env.nonce } : {}),
    }));

    const outboxFile = path.join(this.storageDir, 'mesh_outbox.json');
    const relayFile = path.join(this.storageDir, 'mesh_relay.json');
    const inboxFile = path.join(this.storageDir, 'mesh_inbox.json');

    const atomicWrite = async (filePath: string, content: string) => {
      const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      await fs.promises.writeFile(tmpPath, content, 'utf-8');
      await fs.promises.rename(tmpPath, filePath);
    };

    await atomicWrite(outboxFile, JSON.stringify(serializedOutbox, null, 2));
    await atomicWrite(relayFile, JSON.stringify(serializedRelay, null, 2));
    await atomicWrite(inboxFile, JSON.stringify(serializedInbox, null, 2));
  }

  public async load(): Promise<void> {
    if (!this.storageDir) return;

    const outboxFile = path.join(this.storageDir, 'mesh_outbox.json');
    const relayFile = path.join(this.storageDir, 'mesh_relay.json');
    const inboxFile = path.join(this.storageDir, 'mesh_inbox.json');

    // 1. Load Outbox
    if (fs.existsSync(outboxFile)) {
      try {
        const raw = await fs.promises.readFile(outboxFile, 'utf-8');
        const items: SerializedOutboxItem[] = JSON.parse(raw);
        for (const item of items) {
          const envelope: MeshEnvelope = {
            envelopeId: item.envelope.envelopeId,
            envelopeType: item.envelope.envelopeType as any,
            originDid: item.envelope.originDid,
            targetDid: item.envelope.targetDid,
            hopCount: item.envelope.hopCount,
            maxHops: item.envelope.maxHops,
            route: item.envelope.route,
            timestamp: item.envelope.timestamp,
            expiresAt: item.envelope.expiresAt,
            priority: item.envelope.priority,
            payloadBytes: hexToBytes(item.envelope.payloadBytesHex),
            signatureHex: item.envelope.signatureHex,
            ...(item.envelope.nonce ? { nonce: item.envelope.nonce } : {}),
          };

          this.outbox.set(envelope.envelopeId, {
            envelope,
            status: item.status,
            createdAt: item.createdAt,
            lastAttemptAt: item.lastAttemptAt,
            retryCount: item.retryCount,
            relayedByPeers: item.relayedByPeers,
            acknowledgedAt: item.acknowledgedAt,
            failureReason: item.failureReason,
          });
          this.markSeen(envelope.envelopeId);
        }
      } catch (err) {
        // Recovery continues if outbox is corrupted
      }
    }

    // 2. Load Relay Queue
    if (fs.existsSync(relayFile)) {
      try {
        const raw = await fs.promises.readFile(relayFile, 'utf-8');
        const items: Array<SerializedOutboxItem['envelope']> = JSON.parse(raw);
        for (const item of items) {
          const envelope: MeshEnvelope = {
            envelopeId: item.envelopeId,
            envelopeType: item.envelopeType as any,
            originDid: item.originDid,
            targetDid: item.targetDid,
            hopCount: item.hopCount,
            maxHops: item.maxHops,
            route: item.route,
            timestamp: item.timestamp,
            expiresAt: item.expiresAt,
            priority: item.priority,
            payloadBytes: hexToBytes(item.payloadBytesHex),
            signatureHex: item.signatureHex,
            ...(item.nonce ? { nonce: item.nonce } : {}),
          };
          this.relayQueue.set(envelope.envelopeId, envelope);
          this.markSeen(envelope.envelopeId);
        }
      } catch (err) {
        // Recovery continues
      }
    }

    // 3. Load Inbox
    if (fs.existsSync(inboxFile)) {
      try {
        const raw = await fs.promises.readFile(inboxFile, 'utf-8');
        const items: Array<SerializedOutboxItem['envelope']> = JSON.parse(raw);
        for (const item of items) {
          const envelope: MeshEnvelope = {
            envelopeId: item.envelopeId,
            envelopeType: item.envelopeType as any,
            originDid: item.originDid,
            targetDid: item.targetDid,
            hopCount: item.hopCount,
            maxHops: item.maxHops,
            route: item.route,
            timestamp: item.timestamp,
            expiresAt: item.expiresAt,
            priority: item.priority,
            payloadBytes: hexToBytes(item.payloadBytesHex),
            signatureHex: item.signatureHex,
            ...(item.nonce ? { nonce: item.nonce } : {}),
          };
          this.inbox.set(envelope.envelopeId, envelope);
          this.markSeen(envelope.envelopeId);
        }
      } catch (err) {
        // Recovery continues
      }
    }
  }
}
