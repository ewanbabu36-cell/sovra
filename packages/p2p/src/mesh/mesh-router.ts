/**
 * @file packages/p2p/src/mesh/mesh-router.ts
 * Ad-Hoc Multi-Hop Mesh Router with Cryptographic Delivery Receipts and Loop Suppression.
 *
 * Implements:
 * 1. Store-and-Forward Envelope Routing across direct and multi-hop peers.
 * 2. Strict Loop Suppression via visited routes, reverse-path checks, and LRU deduplication.
 * 3. Cryptographic Authenticity verification (Ed25519) on all envelopes and delivery receipts.
 * 4. Transparent Relay of opaque E2EE payloads by intermediate nodes.
 * 5. Deterministic signed delivery receipts from final recipient back to origin.
 * 6. User Control guards (relay participation toggle, panic wipe).
 */

import {
  bytesToHex,
  hexToBytes,
  sha256,
  signEd25519,
  verifyEd25519,
  secureRandomBytes,
} from '@sovra/crypto';
import { decodeEd25519DidKey } from '@sovra/identity';
import {
  MeshEnvelope,
  MeshEnvelopeType,
  DeliveryReceipt,
  MeshUserControls,
} from './types.js';
import { DurableOutboxStore } from './outbox-store.js';

export interface MeshPeerChannel {
  readonly id: string;
  readonly peerAddress: string;
  remoteDid?: string | undefined;
  send(data: Uint8Array): Promise<any>;
}

export interface MeshRouterConfig {
  localDid: string;
  localPrivateKey: Uint8Array;
  outboxStore: DurableOutboxStore;
  userControls?: Partial<MeshUserControls> | undefined;
  defaultMaxHops?: number | undefined;
  defaultTtlMs?: number | undefined;
}

export class MeshRouter {
  public readonly localDid: string;
  private readonly localPrivateKey: Uint8Array;
  public readonly outboxStore: DurableOutboxStore;
  public userControls: MeshUserControls;
  private readonly defaultMaxHops: number;
  private readonly defaultTtlMs: number;

  // Active connected peer channels
  private peerChannels = new Map<string, MeshPeerChannel>();

  // Diagnostic counters
  private duplicatePacketsDropped = 0;
  private packetsRouted = 0;
  private totalBytesSent = 0;
  private totalBytesReceived = 0;

  // Listeners
  private messageHandlers: Array<(envelope: MeshEnvelope) => void> = [];
  private receiptHandlers: Array<(receipt: DeliveryReceipt) => void> = [];

  constructor(config: MeshRouterConfig) {
    this.localDid = config.localDid;
    this.localPrivateKey = config.localPrivateKey;
    this.outboxStore = config.outboxStore;
    this.defaultMaxHops = config.defaultMaxHops ?? 7;
    this.defaultTtlMs = config.defaultTtlMs ?? 172_800_000; // 48 hours

    this.userControls = {
      bluetoothMeshEnabled: config.userControls?.bluetoothMeshEnabled ?? true,
      discoverabilityEnabled: config.userControls?.discoverabilityEnabled ?? true,
      relayParticipationEnabled: config.userControls?.relayParticipationEnabled ?? true,
      batteryProfile: config.userControls?.batteryProfile ?? 'BALANCED',
      privateRoutingOnly: config.userControls?.privateRoutingOnly ?? false,
    };
  }

  // ==========================================
  // 1. ENVELOPE CREATION & SIGNING
  // ==========================================

  public createEnvelope(params: {
    targetDid: string;
    envelopeType: MeshEnvelopeType;
    payloadBytes: Uint8Array;
    priority?: number | undefined;
    maxHops?: number | undefined;
    ttlMs?: number | undefined;
  }): MeshEnvelope {
    const timestamp = Date.now();
    const nonce = bytesToHex(secureRandomBytes(16));
    const expiresAt = timestamp + (params.ttlMs ?? this.defaultTtlMs);
    const maxHops = params.maxHops ?? this.defaultMaxHops;
    const priority = params.priority ?? 1;

    const envelopeId = MeshRouter.calculateEnvelopeId(
      this.localDid,
      params.targetDid,
      params.envelopeType,
      params.payloadBytes,
      timestamp,
      nonce,
    );

    const sig = signEd25519(this.localPrivateKey, hexToBytes(envelopeId));

    return {
      envelopeId,
      envelopeType: params.envelopeType,
      originDid: this.localDid,
      targetDid: params.targetDid,
      hopCount: 0,
      maxHops,
      route: [this.localDid],
      timestamp,
      expiresAt,
      priority,
      payloadBytes: params.payloadBytes,
      signatureHex: bytesToHex(sig),
      nonce,
    };
  }

  public static calculateEnvelopeId(
    originDid: string,
    targetDid: string,
    envelopeType: string,
    payloadBytes: Uint8Array,
    timestamp: number,
    nonce: string,
  ): string {
    const headerStr = `${originDid}:${targetDid}:${envelopeType}:${timestamp}:${nonce}`;
    const headerBytes = new TextEncoder().encode(headerStr);
    const combined = new Uint8Array(headerBytes.length + payloadBytes.length);
    combined.set(headerBytes, 0);
    combined.set(payloadBytes, headerBytes.length);
    return bytesToHex(sha256(combined));
  }

  // ==========================================
  // 2. ENVELOPE VERIFICATION
  // ==========================================

  public static verifyEnvelope(envelope: MeshEnvelope): boolean {
    try {
      // 1. Recompute Envelope ID to guard against tampering
      const expectedId = MeshRouter.calculateEnvelopeId(
        envelope.originDid,
        envelope.targetDid,
        envelope.envelopeType,
        envelope.payloadBytes,
        envelope.timestamp,
        envelope.nonce ?? '',
      );

      if (expectedId !== envelope.envelopeId) {
        return false;
      }

      // 2. Verify origin signature
      const originPubkey = decodeEd25519DidKey(envelope.originDid);
      return verifyEd25519(
        originPubkey,
        hexToBytes(envelope.envelopeId),
        hexToBytes(envelope.signatureHex),
      );
    } catch {
      return false;
    }
  }

  // ==========================================
  // 3. INCOMING ENVELOPE INGESTION & STORE-AND-FORWARD
  // ==========================================

  public async ingestEnvelope(envelope: MeshEnvelope, fromPeerChannelId?: string): Promise<boolean> {
    this.totalBytesReceived += envelope.payloadBytes.length + 128;

    // 1. Duplicate & Loop Suppression
    if (this.outboxStore.isSeen(envelope.envelopeId)) {
      this.duplicatePacketsDropped++;
      return false;
    }

    // Loop Suppression: If this node is already in the route (and we are not the origin)
    if (envelope.route.includes(this.localDid) && envelope.originDid !== this.localDid) {
      this.duplicatePacketsDropped++;
      return false;
    }

    // 2. TTL Expiry Check
    if (envelope.expiresAt <= Date.now()) {
      return false;
    }

    // 2b. Hop Count Exceeded Check
    if (envelope.hopCount > envelope.maxHops) {
      return false;
    }
    if (envelope.hopCount >= envelope.maxHops && envelope.targetDid !== this.localDid && envelope.targetDid !== '*') {
      return false;
    }

    // 3. Cryptographic Authenticity Check
    if (!MeshRouter.verifyEnvelope(envelope)) {
      return false;
    }

    // Mark seen immediately
    this.outboxStore.markSeen(envelope.envelopeId);

    const isForMe = envelope.targetDid === this.localDid || envelope.targetDid === '*';

    // 4. Process Local Destination
    if (isForMe) {
      if (envelope.envelopeType === 'DELIVERY_RECEIPT') {
        this.processDeliveryReceipt(envelope);
      } else {
        this.outboxStore.storeInbox(envelope);
        this.notifyMessage(envelope);

        // If direct message (not broadcast and not a receipt itself), generate and send signed receipt
        if (envelope.targetDid === this.localDid) {
          await this.sendSignedDeliveryReceipt(envelope);
        }
      }
    }

    // 5. Store-and-Forward Relay (if broadcast or meant for someone else)
    const shouldRelay =
      (envelope.targetDid === '*' || envelope.targetDid !== this.localDid) &&
      this.userControls.relayParticipationEnabled &&
      envelope.hopCount < envelope.maxHops;

    if (shouldRelay) {
      // Create forwarded envelope copy: increment hopCount, append localDid to route
      const relayedEnvelope: MeshEnvelope = {
        ...envelope,
        hopCount: envelope.hopCount + 1,
        route: [...envelope.route, this.localDid],
      };

      this.outboxStore.enqueueRelay(relayedEnvelope);
      this.packetsRouted++;

      // Forward to eligible connected neighbors
      await this.forwardToEligiblePeers(relayedEnvelope, fromPeerChannelId);
    }

    return true;
  }

  // ==========================================
  // 4. DELIVERY RECEIPTS
  // ==========================================

  private async sendSignedDeliveryReceipt(targetEnvelope: MeshEnvelope): Promise<void> {
    const deliveredAt = Date.now();
    const receiptSignature = signEd25519(this.localPrivateKey, hexToBytes(targetEnvelope.envelopeId));

    const receipt: DeliveryReceipt = {
      targetEnvelopeId: targetEnvelope.envelopeId,
      recipientDid: this.localDid,
      deliveredAt,
      signatureHex: bytesToHex(receiptSignature),
    };

    const receiptPayload = new TextEncoder().encode(JSON.stringify(receipt));

    const receiptEnvelope = this.createEnvelope({
      targetDid: targetEnvelope.originDid,
      envelopeType: 'DELIVERY_RECEIPT',
      payloadBytes: receiptPayload,
      priority: 2, // High priority
      ttlMs: 86_400_000, // 24 hours
    });

    this.outboxStore.enqueueOutbox(receiptEnvelope);
    await this.forwardToEligiblePeers(receiptEnvelope);
  }

  private processDeliveryReceipt(receiptEnvelope: MeshEnvelope): void {
    try {
      const receipt: DeliveryReceipt = JSON.parse(new TextDecoder().decode(receiptEnvelope.payloadBytes));

      // Cryptographically verify receipt signature against recipient DID
      const recipientPubkey = decodeEd25519DidKey(receipt.recipientDid);
      const isValid = verifyEd25519(
        recipientPubkey,
        hexToBytes(receipt.targetEnvelopeId),
        hexToBytes(receipt.signatureHex),
      );

      if (isValid) {
        // CRITICAL SECURITY ENFORCEMENT:
        // Receipt recipientDid must match the outbox item's envelope targetDid.
        // An attacker (Mallory) cannot forge receipts for messages sent to Bob!
        const outboxItem = this.outboxStore.getOutboxItem(receipt.targetEnvelopeId);
        if (!outboxItem) return;

        if (receipt.recipientDid !== outboxItem.envelope.targetDid) {
          return;
        }

        this.outboxStore.markAcknowledged(receipt.targetEnvelopeId, receipt.deliveredAt);
        this.notifyReceipt(receipt);
      }
    } catch {
      // Invalid receipt JSON or signature dropped
    }
  }

  // ==========================================
  // 5. PEER FORWARDING & LOOP PREVENTION
  // ==========================================

  private async forwardToEligiblePeers(
    envelope: MeshEnvelope,
    excludeChannelId?: string,
  ): Promise<number> {
    let forwardedCount = 0;

    for (const [channelId, peer] of this.peerChannels.entries()) {
      if (channelId === excludeChannelId) continue;

      // Loop Suppression: Never send to peer if they already appear in the route
      if (peer.remoteDid && envelope.route.includes(peer.remoteDid)) {
        continue;
      }

      // Direct Destination Optimization: if target is this connected peer, deliver directly!
      if (envelope.targetDid !== '*' && peer.remoteDid && envelope.targetDid !== peer.remoteDid) {
        // If not broadcast, and we know this peer is NOT the target, we can still relay
        // unless privateRoutingOnly is enabled
        if (this.userControls.privateRoutingOnly) {
          continue;
        }
      }

      try {
        const serialized = MeshRouter.serializeEnvelope(envelope);
        const success = await peer.send(serialized);
        if (success !== false) {
          forwardedCount++;
          this.totalBytesSent += serialized.length;
          if (peer.remoteDid) {
            this.outboxStore.markRelayed(envelope.envelopeId, peer.remoteDid);
          }
        }
      } catch {
        // Channel transmission error handled gracefully
      }
    }

    return forwardedCount;
  }

  // ==========================================
  // 6. OUTGOING SEND API & QUEUE FLUSHING
  // ==========================================

  public async send(params: {
    targetDid: string;
    envelopeType: MeshEnvelopeType;
    payloadBytes: Uint8Array;
    priority?: number | undefined;
    maxHops?: number | undefined;
    ttlMs?: number | undefined;
  }): Promise<MeshEnvelope> {
    const envelope = this.createEnvelope(params);
    this.outboxStore.enqueueOutbox(envelope);

    this.outboxStore.markSending(envelope.envelopeId);
    const forwardedCount = await this.forwardToEligiblePeers(envelope);

    if (forwardedCount > 0) {
      // If directly sent to destination peer
      const isDirectTargetConnected = Array.from(this.peerChannels.values()).some(
        p => p.remoteDid === envelope.targetDid,
      );
      if (isDirectTargetConnected) {
        this.outboxStore.markDelivered(envelope.envelopeId);
      }
    }

    return envelope;
  }

  public async sendEnvelope(params: {
    targetDid: string;
    envelopeType: MeshEnvelopeType;
    payloadBytes: Uint8Array;
    priority?: number | undefined;
    maxHops?: number | undefined;
    ttlMs?: number | undefined;
  }): Promise<MeshEnvelope> {
    return this.send(params);
  }

  public async flushOutboxAndRelays(): Promise<{ sentOutbox: number; sentRelays: number }> {
    let sentOutbox = 0;
    let sentRelays = 0;

    // 1. Flush pending outbox
    const pendingOutbox = this.outboxStore.getPendingOutbox(30);
    for (const item of pendingOutbox) {
      this.outboxStore.markSending(item.envelope.envelopeId);
      const forwarded = await this.forwardToEligiblePeers(item.envelope);
      if (forwarded > 0) {
        sentOutbox++;
      }
    }

    // 2. Flush relay queue
    if (this.userControls.relayParticipationEnabled) {
      const pendingRelays = this.outboxStore.getNextRelayBatch(20);
      for (const envelope of pendingRelays) {
        const forwarded = await this.forwardToEligiblePeers(envelope);
        if (forwarded > 0) {
          sentRelays++;
        }
      }
    }

    return { sentOutbox, sentRelays };
  }

  // ==========================================
  // 7. PEER CHANNEL MANAGEMENT
  // ==========================================

  public registerPeerChannel(channel: MeshPeerChannel): void {
    this.peerChannels.set(channel.id, channel);
    // When a new peer connects, trigger queue flush to exchange pending messages
    queueMicrotask(() => {
      this.flushOutboxAndRelays().catch(() => {});
    });
  }

  public unregisterPeerChannel(channelId: string): void {
    this.peerChannels.delete(channelId);
  }

  public setPeerRemoteDid(channelId: string, remoteDid: string): void {
    const ch = this.peerChannels.get(channelId);
    if (ch) {
      ch.remoteDid = remoteDid;
    }
  }

  public getConnectedPeerDids(): string[] {
    const dids: string[] = [];
    for (const ch of this.peerChannels.values()) {
      if (ch.remoteDid) dids.push(ch.remoteDid);
    }
    return dids;
  }

  public getConnectedPeerCount(): number {
    return this.peerChannels.size;
  }

  // ==========================================
  // 8. SERIALIZATION
  // ==========================================

  public static serializeEnvelope(envelope: MeshEnvelope): Uint8Array {
    const jsonStr = JSON.stringify({
      id: envelope.envelopeId,
      t: envelope.envelopeType,
      o: envelope.originDid,
      d: envelope.targetDid,
      h: envelope.hopCount,
      m: envelope.maxHops,
      r: envelope.route,
      ts: envelope.timestamp,
      ex: envelope.expiresAt,
      p: envelope.priority,
      b: bytesToHex(envelope.payloadBytes),
      s: envelope.signatureHex,
      n: envelope.nonce,
    });
    return new TextEncoder().encode(jsonStr);
  }

  public static deserializeEnvelope(bytes: Uint8Array): MeshEnvelope {
    const jsonStr = new TextDecoder().decode(bytes);
    const obj = JSON.parse(jsonStr);

    return {
      envelopeId: obj.id,
      envelopeType: obj.t,
      originDid: obj.o,
      targetDid: obj.d,
      hopCount: obj.h,
      maxHops: obj.m,
      route: obj.r,
      timestamp: obj.ts,
      expiresAt: obj.ex,
      priority: obj.p,
      payloadBytes: hexToBytes(obj.b),
      signatureHex: obj.s,
      nonce: obj.n,
    };
  }

  // ==========================================
  // 9. EVENT EMITTERS & PANIC WIPE
  // ==========================================

  public onMessage(handler: (envelope: MeshEnvelope) => void): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
    };
  }

  private notifyMessage(envelope: MeshEnvelope): void {
    for (const h of this.messageHandlers) {
      try {
        h(envelope);
      } catch {}
    }
  }

  public onDeliveryReceipt(handler: (receipt: DeliveryReceipt) => void): () => void {
    this.receiptHandlers.push(handler);
    return () => {
      this.receiptHandlers = this.receiptHandlers.filter(h => h !== handler);
    };
  }

  private notifyReceipt(receipt: DeliveryReceipt): void {
    for (const h of this.receiptHandlers) {
      try {
        h(receipt);
      } catch {}
    }
  }

  public getDiagnostics() {
    return {
      connectedPeersCount: this.peerChannels.size,
      duplicatePacketsDropped: this.duplicatePacketsDropped,
      packetsRouted: this.packetsRouted,
      totalBytesSent: this.totalBytesSent,
      totalBytesReceived: this.totalBytesReceived,
      outboxPendingCount: this.outboxStore.getPendingOutbox().length,
      relayQueueCount: this.outboxStore.getRelayQueueSize(),
    };
  }

  public async panicWipe(): Promise<void> {
    this.peerChannels.clear();
    await this.outboxStore.panicWipe();
  }
}
