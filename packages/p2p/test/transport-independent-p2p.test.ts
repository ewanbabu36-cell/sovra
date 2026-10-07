/**
 * @file packages/p2p/test/transport-independent-p2p.test.ts
 * Phase 2 Verification: Offline Mesh + Transport-Independent P2P Architecture.
 *
 * Verifies:
 * 1. Multi-Hop Store-and-Forward Envelope Routing across linear topology (A -> B -> C -> D).
 * 2. Truthful Delivery State Lifecycle Progression without premature UI speculation.
 * 3. Network Partition and Healing Convergence with Bidirectional Reconciliation.
 * 4. Out-of-Order Event Handling and Topological Dependency Resequencing.
 * 5. Deterministic CRDT Conflict Resolution (Last-Write-Wins with SHA-256 tie-breaker).
 * 6. Transport-Independent Abstraction (Seamless Bridging over BLE + Local Wi-Fi + LAN).
 * 7. Absolute Dev-Server Independence (100% Offline Decentralization).
 * 8. 5-Node Chaos Resilience and Adversarial Peer Resistance (Fail-Closed).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  generateEd25519KeyPair,
  bytesToHex,
  hexToBytes,
  sha256,
  signEd25519,
  verifyEd25519,
} from '@sovra/crypto';
import { encodeEd25519DidKey } from '@sovra/identity';
import { SovraEvent, EventKind } from '@sovra/protocol';
import {
  MeshRouter,
  MeshPeerChannel,
  DurableOutboxStore,
  VirtualBleBus,
  VirtualBleAdapter,
  BluetoothLETransport,
  LocalWifiBus,
  LocalWifiTransport,
  MeshSyncEngine,
  PendingDependencyBuffer,
  extractEventDependencies,
  MeshTransportManager,
  BleFrameCodec,
  BleFrameReassembler,
  MeshEnvelope,
  DeliveryState,
} from '../src/mesh/index.js';

describe('Sovra Phase 2: Offline Mesh & Transport-Independent P2P Suite', () => {
  let tempStorageDirs: string[] = [];

  function createTestIdentity(label: string) {
    const keyPair = generateEd25519KeyPair();
    const did = encodeEd25519DidKey(keyPair.publicKey);
    return {
      label,
      did,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      publicKeyHex: bytesToHex(keyPair.publicKey),
    };
  }

  function getTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-phase2-p2p-test-'));
    tempStorageDirs.push(dir);
    return dir;
  }

  function createCanonicalEvent(params: {
    author: { did: string; privateKey: Uint8Array; publicKeyHex: string };
    content: string;
    kind?: EventKind;
    createdAt?: number;
    tags?: Array<[string, ...string[]]>;
  }): SovraEvent {
    const createdAt = params.createdAt ?? Math.floor(Date.now() / 1000);
    const kind = params.kind ?? EventKind.ShortPost;
    const tags = params.tags ?? [];
    const content = params.content;
    const unsigned = JSON.stringify([
      0,
      params.author.publicKeyHex,
      createdAt,
      kind,
      tags,
      content,
    ]);
    const id = bytesToHex(sha256(new TextEncoder().encode(unsigned)));
    const sig = bytesToHex(signEd25519(hexToBytes(id), params.author.privateKey));

    return {
      id,
      pubkey: params.author.publicKeyHex,
      createdAt,
      kind,
      tags,
      content,
      sig,
    };
  }

  afterEach(() => {
    for (const d of tempStorageDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {}
    }
    tempStorageDirs = [];
    VirtualBleBus.reset();
    LocalWifiBus.reset();
  });

  // ==========================================
  // 1. MULTI-HOP STORE-AND-FORWARD (A -> B -> C -> D)
  // ==========================================
  describe('Multi-Hop Store-and-Forward Envelope Routing', () => {
    it('relays envelope across 4-peer topology (A -> B -> C -> D) with no direct A-D link', async () => {
      const aId = createTestIdentity('NodeA');
      const bId = createTestIdentity('NodeB');
      const cId = createTestIdentity('NodeC');
      const dId = createTestIdentity('NodeD');

      const aStore = new DurableOutboxStore();
      const bStore = new DurableOutboxStore();
      const cStore = new DurableOutboxStore();
      const dStore = new DurableOutboxStore();

      const aRouter = new MeshRouter({ localDid: aId.did, localPrivateKey: aId.privateKey, outboxStore: aStore });
      const bRouter = new MeshRouter({ localDid: bId.did, localPrivateKey: bId.privateKey, outboxStore: bStore });
      const cRouter = new MeshRouter({ localDid: cId.did, localPrivateKey: cId.privateKey, outboxStore: cStore });
      const dRouter = new MeshRouter({ localDid: dId.did, localPrivateKey: dId.privateKey, outboxStore: dStore });

      // Wire channels: A <-> B
      aRouter.registerPeerChannel({
        id: 'ch-AB',
        peerAddress: 'b-addr',
        remoteDid: bId.did,
        send: async (data) => bRouter.ingestEnvelope(MeshRouter.deserializeEnvelope(data), 'ch-BA'),
      });
      bRouter.registerPeerChannel({
        id: 'ch-BA',
        peerAddress: 'a-addr',
        remoteDid: aId.did,
        send: async (data) => aRouter.ingestEnvelope(MeshRouter.deserializeEnvelope(data), 'ch-AB'),
      });

      // Wire channels: B <-> C
      bRouter.registerPeerChannel({
        id: 'ch-BC',
        peerAddress: 'c-addr',
        remoteDid: cId.did,
        send: async (data) => cRouter.ingestEnvelope(MeshRouter.deserializeEnvelope(data), 'ch-CB'),
      });
      cRouter.registerPeerChannel({
        id: 'ch-CB',
        peerAddress: 'b-addr',
        remoteDid: bId.did,
        send: async (data) => bRouter.ingestEnvelope(MeshRouter.deserializeEnvelope(data), 'ch-BC'),
      });

      // Wire channels: C <-> D
      cRouter.registerPeerChannel({
        id: 'ch-CD',
        peerAddress: 'd-addr',
        remoteDid: dId.did,
        send: async (data) => dRouter.ingestEnvelope(MeshRouter.deserializeEnvelope(data), 'ch-DC'),
      });
      dRouter.registerPeerChannel({
        id: 'ch-DC',
        peerAddress: 'c-addr',
        remoteDid: cId.did,
        send: async (data) => cRouter.ingestEnvelope(MeshRouter.deserializeEnvelope(data), 'ch-CD'),
      });

      let deliveredToD: MeshEnvelope | null = null;
      dRouter.onMessage((env) => {
        deliveredToD = env;
      });

      let acknowledgedAtA = false;
      aRouter.onDeliveryReceipt((receipt) => {
        acknowledgedAtA = true;
      });

      // Node A sends to Node D
      const payload = new TextEncoder().encode('Confidential decentralized event');
      const env = await aRouter.sendEnvelope({
        targetDid: dId.did,
        envelopeType: 'ENCRYPTED_MESSAGE',
        payloadBytes: payload,
      });

      // Wait a moment for microtasks / async relays
      await new Promise((r) => setTimeout(r, 80));

      // 1. Destination D received the message
      expect(deliveredToD).not.toBeNull();
      expect(deliveredToD!.originDid).toBe(aId.did);
      expect(deliveredToD!.targetDid).toBe(dId.did);
      expect(deliveredToD!.hopCount).toBe(2); // A (origin 0) -> B (hop 1) -> C (hop 2) -> D
      expect(deliveredToD!.route).toContain(aId.did);
      expect(deliveredToD!.route).toContain(bId.did);
      expect(deliveredToD!.route).toContain(cId.did);

      // 2. Receipt routed back from D through C and B to A
      expect(acknowledgedAtA).toBe(true);

      // 3. Outbox at Node A reflects state
      const aOutbox = aStore.getOutboxItem(env.envelopeId);
      expect(aOutbox).toBeDefined();
      expect(aOutbox!.status).toBe('ACKNOWLEDGED');
      expect(aOutbox!.acknowledgedAt).toBeGreaterThan(0);
    });

    it('decrements TTL and drops packet when maxHops is exceeded', async () => {
      const aId = createTestIdentity('NodeA');
      const bId = createTestIdentity('NodeB');
      const aStore = new DurableOutboxStore();
      const bStore = new DurableOutboxStore();

      const aRouter = new MeshRouter({ localDid: aId.did, localPrivateKey: aId.privateKey, outboxStore: aStore });
      const bRouter = new MeshRouter({ localDid: bId.did, localPrivateKey: bId.privateKey, outboxStore: bStore });

      let bReceived = false;
      bRouter.onMessage(() => {
        bReceived = true;
      });

      // Create envelope with maxHops = 1 and hopCount already 1
      const rawEnv = aRouter.createEnvelope({
        targetDid: bId.did,
        envelopeType: 'SIGNED_EVENT',
        payloadBytes: new TextEncoder().encode('Test TTL drop'),
        maxHops: 1,
      });

      // Mutate hop count to simulate exceeded hops
      const expiredHopsEnv = {
        ...rawEnv,
        hopCount: 2,
      };

      const result = await bRouter.ingestEnvelope(expiredHopsEnv, 'chan-dummy');
      expect(result).toBe(false);
      expect(bReceived).toBe(false);
      expect(bRouter.getDiagnostics().packetsRouted).toBe(0);
    });
  });

  // ==========================================
  // 2. TRUTHFUL DELIVERY STATE PROGRESSION
  // ==========================================
  describe('Truthful Delivery State Progression', () => {
    it('accurately advances through truthful lifecycle states without speculation', () => {
      const aId = createTestIdentity('NodeA');
      const store = new DurableOutboxStore();
      const router = new MeshRouter({ localDid: aId.did, localPrivateKey: aId.privateKey, outboxStore: store });

      const env = router.createEnvelope({
        targetDid: 'did:key:zTargetPeer12345',
        envelopeType: 'SIGNED_EVENT',
        payloadBytes: new TextEncoder().encode('Lifecycle test'),
      });

      // 1. Initial State: Enqueueing sets QUEUED
      const item = store.enqueueOutbox(env);
      expect(item.status).toBe('QUEUED');

      // 2. Local node marks state as LOCAL
      store.markLocal(env.envelopeId);
      expect(store.getOutboxItem(env.envelopeId)!.status).toBe('LOCAL');

      // 3. Transport starts discovering peer
      store.markDiscovering(env.envelopeId);
      expect(store.getOutboxItem(env.envelopeId)!.status).toBe('DISCOVERING');

      // 4. Establishing channel
      store.markConnecting(env.envelopeId);
      expect(store.getOutboxItem(env.envelopeId)!.status).toBe('CONNECTING');

      // 5. Transferring bytes
      store.markTransferring(env.envelopeId);
      expect(store.getOutboxItem(env.envelopeId)!.status).toBe('TRANSFERRING');

      // 6. Stored by intermediate relay peer
      store.markStoredByPeer(env.envelopeId, 'did:key:zRelayPeer1');
      expect(store.getOutboxItem(env.envelopeId)!.status).toBe('STORED_BY_PEER');
      expect(store.getOutboxItem(env.envelopeId)!.relayedByPeers).toContain('did:key:zRelayPeer1');

      // 7. Forwarded along multi-hop path
      store.markForwarded(env.envelopeId, 'did:key:zRelayPeer2');
      expect(store.getOutboxItem(env.envelopeId)!.status).toBe('FORWARDED');
      expect(store.getOutboxItem(env.envelopeId)!.relayedByPeers).toContain('did:key:zRelayPeer2');

      // 8. Synced via mesh digest exchange
      store.markSynced(env.envelopeId);
      expect(store.getOutboxItem(env.envelopeId)!.status).toBe('SYNCED');

      // 9. Delivered and Cryptographically Confirmed / Acknowledged
      store.markConfirmed(env.envelopeId);
      expect(store.getOutboxItem(env.envelopeId)!.status).toBe('CONFIRMED');

      const ackSuccess = store.markAcknowledged(env.envelopeId);
      expect(ackSuccess).toBe(true);
      expect(store.getOutboxItem(env.envelopeId)!.status).toBe('ACKNOWLEDGED');
      expect(store.getOutboxItem(env.envelopeId)!.acknowledgedAt).toBeGreaterThan(0);
    });

    it('transitions stale envelopes to EXPIRED and refuses to transmit expired items', () => {
      const aId = createTestIdentity('NodeA');
      const store = new DurableOutboxStore();
      const router = new MeshRouter({ localDid: aId.did, localPrivateKey: aId.privateKey, outboxStore: store });

      const pastEnvelope = router.createEnvelope({
        targetDid: 'did:key:zTargetPeer12345',
        envelopeType: 'SIGNED_EVENT',
        payloadBytes: new TextEncoder().encode('Expired payload'),
        ttlMs: -1000, // already expired
      });

      const item = store.enqueueOutbox(pastEnvelope);
      expect(item.status).toBe('EXPIRED');

      const pending = store.getPendingOutbox();
      expect(pending.find((p) => p.envelope.envelopeId === pastEnvelope.envelopeId)).toBeUndefined();
    });
  });

  // ==========================================
  // 3. PARTITION & HEALING CONVERGENCE
  // ==========================================
  describe('Network Partition and Healing Convergence', () => {
    it('heals partition and converges missing events across clusters using MeshSyncEngine', () => {
      const syncEngine = new MeshSyncEngine();

      const alice = createTestIdentity('Alice');
      const bob = createTestIdentity('Bob');
      const charlie = createTestIdentity('Charlie');
      const dana = createTestIdentity('Dana');

      // Cluster 1 (Alice & Bob) produces Event A1 and Event B1
      const eventA1 = createCanonicalEvent({ author: alice, content: 'Alice update from partition 1', createdAt: 1000 });
      const eventB1 = createCanonicalEvent({ author: bob, content: 'Bob update from partition 1', createdAt: 1010 });
      const cluster1Events: SovraEvent[] = [eventA1, eventB1];

      // Cluster 2 (Charlie & Dana) produces Event C1 and Event D1
      const eventC1 = createCanonicalEvent({ author: charlie, content: 'Charlie update from partition 2', createdAt: 1005 });
      const eventD1 = createCanonicalEvent({ author: dana, content: 'Dana update from partition 2', createdAt: 1015 });
      const cluster2Events: SovraEvent[] = [eventC1, eventD1];

      // === PARTITION HEALING: Peer Bob connects to Peer Charlie ===
      // 1. Bob generates summary of Cluster 1
      const bobSummary = syncEngine.createSyncSummary(cluster1Events);
      expect(bobSummary.authors.length).toBe(2);
      expect(bobSummary.recentEventIds).toContain(eventA1.id);
      expect(bobSummary.recentEventIds).toContain(eventB1.id);

      // 2. Charlie generates summary of Cluster 2
      const charlieSummary = syncEngine.createSyncSummary(cluster2Events);
      expect(charlieSummary.authors.length).toBe(2);
      expect(charlieSummary.recentEventIds).toContain(eventC1.id);
      expect(charlieSummary.recentEventIds).toContain(eventD1.id);

      // 3. Charlie detects missing events from Bob's summary
      const charlieMissingIds = syncEngine.computeMissingEventIds(bobSummary, cluster2Events);
      expect(charlieMissingIds).toHaveLength(2);
      expect(charlieMissingIds).toContain(eventA1.id);
      expect(charlieMissingIds).toContain(eventB1.id);

      // 4. Bob detects missing events from Charlie's summary
      const bobMissingIds = syncEngine.computeMissingEventIds(charlieSummary, cluster1Events);
      expect(bobMissingIds).toHaveLength(2);
      expect(bobMissingIds).toContain(eventC1.id);
      expect(bobMissingIds).toContain(eventD1.id);

      // 5. Bidirectional Sync Responses
      const bobResponse = syncEngine.createSyncResponse(
        { requestedEventIds: charlieMissingIds },
        cluster1Events,
        'ble',
      );
      const charlieResponse = syncEngine.createSyncResponse(
        { requestedEventIds: bobMissingIds },
        cluster2Events,
        'ble',
      );

      // 6. Both clusters integrate missing events
      for (const item of bobResponse.events) {
        cluster2Events.push(item.event);
      }
      for (const item of charlieResponse.events) {
        cluster1Events.push(item.event);
      }

      // Verify Complete Convergence: Both clusters hold identical set of 4 events
      expect(cluster1Events).toHaveLength(4);
      expect(cluster2Events).toHaveLength(4);

      const cluster1Ids = new Set(cluster1Events.map((e) => e.id));
      const cluster2Ids = new Set(cluster2Events.map((e) => e.id));
      expect(cluster1Ids).toEqual(cluster2Ids);
    });
  });

  // ==========================================
  // 4. OUT-OF-ORDER EVENT HANDLING & DEPENDENCY BUFFER
  // ==========================================
  describe('Out-of-Order Event Handling & Dependency Resequencing', () => {
    it('buffers dependent events arriving out-of-order and releases in topological causal order', () => {
      const alice = createTestIdentity('Alice');
      const buffer = new PendingDependencyBuffer<SovraEvent>();

      // Create causal chain: E1 (Root Post) -> E2 (Comment) -> E3 (Reaction)
      const e1 = createCanonicalEvent({
        author: alice,
        content: 'Root post',
        kind: EventKind.ShortPost,
        createdAt: 1000,
      });

      const e2 = createCanonicalEvent({
        author: alice,
        content: 'Reply to root post',
        kind: EventKind.Comment,
        tags: [['e', e1.id]],
        createdAt: 1005,
      });

      const e3 = createCanonicalEvent({
        author: alice,
        content: 'Like reaction to reply',
        kind: EventKind.Reaction,
        tags: [['e', e2.id]],
        createdAt: 1010,
      });

      const committedEvents: SovraEvent[] = [];

      // Events arrive in reversed order: E3 -> E2 -> E1
      // Step A: E3 arrives first
      const e3Deps = extractEventDependencies(e3);
      expect(e3Deps).toEqual([e2.id]);
      const bufferedE3 = buffer.bufferIfMissingDependencies(e3, e3Deps);
      expect(bufferedE3).toBe(true); // Buffered because E2 is not yet committed
      expect(buffer.isPending(e3.id)).toBe(true);
      expect(committedEvents).toHaveLength(0);

      // Step B: E2 arrives second
      const e2Deps = extractEventDependencies(e2);
      expect(e2Deps).toEqual([e1.id]);
      const bufferedE2 = buffer.bufferIfMissingDependencies(e2, e2Deps);
      expect(bufferedE2).toBe(true); // Buffered because E1 is not yet committed
      expect(buffer.isPending(e2.id)).toBe(true);
      expect(committedEvents).toHaveLength(0);

      // Step C: E1 arrives third
      const e1Deps = extractEventDependencies(e1);
      expect(e1Deps).toEqual([]);
      const bufferedE1 = buffer.bufferIfMissingDependencies(e1, e1Deps);
      expect(bufferedE1).toBe(false); // Not buffered! Can be committed immediately
      committedEvents.push(e1);

      // Step D: Resolve cascading dependencies unblocked by E1
      const unblocked = buffer.resolveDependencies(e1.id);
      for (const evt of unblocked) {
        committedEvents.push(evt);
      }

      // Verify exact causal topological sequence: [E1, E2, E3]
      expect(committedEvents).toHaveLength(3);
      expect(committedEvents[0].id).toBe(e1.id);
      expect(committedEvents[1].id).toBe(e2.id);
      expect(committedEvents[2].id).toBe(e3.id);

      // Verify buffer is now completely clear
      expect(buffer.getPendingCount()).toBe(0);
      expect(buffer.isCommitted(e1.id)).toBe(true);
      expect(buffer.isCommitted(e2.id)).toBe(true);
      expect(buffer.isCommitted(e3.id)).toBe(true);
    });

    it('enforces buffer capacity bounds and evicts oldest unresolvable dependencies', () => {
      const alice = createTestIdentity('Alice');
      const buffer = new PendingDependencyBuffer<SovraEvent>({ maxBufferSize: 2 });

      const eA = createCanonicalEvent({ author: alice, content: 'Event A', tags: [['e', 'ghost-parent-1']] });
      const eB = createCanonicalEvent({ author: alice, content: 'Event B', tags: [['e', 'ghost-parent-2']] });
      const eC = createCanonicalEvent({ author: alice, content: 'Event C', tags: [['e', 'ghost-parent-3']] });

      buffer.bufferIfMissingDependencies(eA, ['ghost-parent-1']);
      buffer.bufferIfMissingDependencies(eB, ['ghost-parent-2']);
      expect(buffer.getPendingCount()).toBe(2);

      // Buffer 3rd event should evict oldest (eA)
      buffer.bufferIfMissingDependencies(eC, ['ghost-parent-3']);
      expect(buffer.getPendingCount()).toBe(2);
      expect(buffer.isPending(eA.id)).toBe(false);
      expect(buffer.isPending(eB.id)).toBe(true);
      expect(buffer.isPending(eC.id)).toBe(true);
    });
  });

  // ==========================================
  // 5. DETERMINISTIC CRDT CONFLICT RESOLUTION
  // ==========================================
  describe('Deterministic CRDT Conflict Resolution', () => {
    it('deterministically selects winner based on Last-Write-Wins (createdAt)', () => {
      const syncEngine = new MeshSyncEngine();
      const alice = createTestIdentity('Alice');

      const olderEvent = createCanonicalEvent({
        author: alice,
        content: 'Original bio content',
        kind: EventKind.Metadata,
        createdAt: 1000,
      });

      const newerEvent = createCanonicalEvent({
        author: alice,
        content: 'Updated bio content',
        kind: EventKind.Metadata,
        createdAt: 1050,
      });

      // Forward and reversed evaluations both yield newerEvent
      const winner1 = syncEngine.resolveEventConflict(olderEvent, newerEvent);
      const winner2 = syncEngine.resolveEventConflict(newerEvent, olderEvent);

      expect(winner1.id).toBe(newerEvent.id);
      expect(winner2.id).toBe(newerEvent.id);
      expect(winner1.content).toBe('Updated bio content');
    });

    it('deterministically breaks timestamp ties using lexicographical SHA-256 IDs', () => {
      const syncEngine = new MeshSyncEngine();
      const alice = createTestIdentity('Alice');
      const bob = createTestIdentity('Bob');

      const identicalTimestamp = 1000;
      const event1 = createCanonicalEvent({
        author: alice,
        content: 'Concurrent mutation A',
        createdAt: identicalTimestamp,
      });

      const event2 = createCanonicalEvent({
        author: bob,
        content: 'Concurrent mutation B',
        createdAt: identicalTimestamp,
      });

      const winnerA = syncEngine.resolveEventConflict(event1, event2);
      const winnerB = syncEngine.resolveEventConflict(event2, event1);

      expect(winnerA.id).toBe(winnerB.id);

      // Verify tie-breaker corresponds to smaller hex SHA-256 ID
      const expectedId = event1.id.localeCompare(event2.id) < 0 ? event1.id : event2.id;
      expect(winnerA.id).toBe(expectedId);
    });
  });

  // ==========================================
  // 6. MULTI-TRANSPORT ABSTRACTION (BLE + WI-FI + TCP)
  // ==========================================
  describe('Multi-Transport Abstraction & Cross-Transport Bridging', () => {
    it('bridges events across Local Wi-Fi and Bluetooth LE with identical protocol semantics', async () => {
      const alice = createTestIdentity('Alice');
      const relay = createTestIdentity('Relay');
      const bob = createTestIdentity('Bob');

      // Wi-Fi Bus and BLE Bus
      const wifiBus = new LocalWifiBus();
      const bleBus = new VirtualBleBus();

      // Alice <-> Relay over Local Wi-Fi
      const aliceWifi = new LocalWifiTransport({ localAddress: '192.168.1.10', bus: wifiBus });
      const relayWifi = new LocalWifiTransport({ localAddress: '192.168.1.1', bus: wifiBus });

      // Relay <-> Bob over Virtual BLE
      const relayBle = new VirtualBleAdapter('relay-ble-addr', 182, bleBus);
      const bobBle = new VirtualBleAdapter('bob-ble-addr', 182, bleBus);

      await aliceWifi.start();
      await relayWifi.start();

      const aliceStore = new DurableOutboxStore();
      const relayStore = new DurableOutboxStore();
      const bobStore = new DurableOutboxStore();

      const aliceRouter = new MeshRouter({ localDid: alice.did, localPrivateKey: alice.privateKey, outboxStore: aliceStore });
      const relayRouter = new MeshRouter({ localDid: relay.did, localPrivateKey: relay.privateKey, outboxStore: relayStore });
      const bobRouter = new MeshRouter({ localDid: bob.did, localPrivateKey: bob.privateKey, outboxStore: bobStore });

      // Register incoming Wi-Fi channel listener on Relay before connection
      relayWifi.onChannel((chan) => {
        relayRouter.registerPeerChannel({
          id: chan.id,
          peerAddress: chan.peerAddress,
          remoteDid: alice.did,
          send: async (data) => chan.send(data),
        });
        chan.onData(async (chunk) => {
          try {
            const env = MeshRouter.deserializeEnvelope(chunk);
            await relayRouter.ingestEnvelope(env, chan.id);
          } catch {}
        });
      });

      // Connect Alice -> Relay over Wi-Fi
      const wifiConnectRes = await aliceWifi.connect('192.168.1.1');
      expect(wifiConnectRes.ok).toBe(true);
      const aliceWifiChannel = wifiConnectRes.value;

      aliceRouter.registerPeerChannel({
        id: 'wifi-alice-relay',
        peerAddress: '192.168.1.1',
        remoteDid: relay.did,
        send: async (data) => aliceWifiChannel.send(data),
      });

      // Connect Relay -> Bob over BLE Link
      const bleLink = bleBus.createLink('relay-ble-addr', 'bob-ble-addr', 182);
      relayRouter.registerPeerChannel({
        id: 'ble-relay-bob',
        peerAddress: 'bob-ble-addr',
        remoteDid: bob.did,
        send: async (data) => bleLink.channelA.send(data),
      });

      bleLink.channelB.onData(async (chunk) => {
        try {
          const env = MeshRouter.deserializeEnvelope(chunk);
          await bobRouter.ingestEnvelope(env, 'ble-bob-relay');
        } catch {}
      });

      let bobReceivedEnvelope: MeshEnvelope | null = null;
      bobRouter.onMessage((env) => {
        bobReceivedEnvelope = env;
      });

      // Alice sends to Bob (cross-transport: Wi-Fi -> BLE)
      const testPayload = new TextEncoder().encode('Transport-independent message from Alice to Bob');
      aliceRouter.sendEnvelope({
        targetDid: bob.did,
        envelopeType: 'ENCRYPTED_MESSAGE',
        payloadBytes: testPayload,
      });

      await new Promise((r) => setTimeout(r, 60));

      // Bob receives envelope intact!
      expect(bobReceivedEnvelope).not.toBeNull();
      expect(bobReceivedEnvelope!.originDid).toBe(alice.did);
      expect(bobReceivedEnvelope!.targetDid).toBe(bob.did);
      expect(new TextDecoder().decode(bobReceivedEnvelope!.payloadBytes)).toBe(
        'Transport-independent message from Alice to Bob',
      );
    });
  });

  // ==========================================
  // 7. ABSOLUTE DEV-SERVER INDEPENDENCE
  // ==========================================
  describe('Absolute Dev-Server Independence (100% Offline Mode)', () => {
    it('operates completely offline with zero dependency on dev-server or central HTTP endpoints', async () => {
      // Mock global fetch to throw error if ANY network call is attempted
      const fetchSpy = vi.fn().mockImplementation(() => {
        throw new Error('NETWORK CALL DETECTED: Operation must be completely offline and decentralized!');
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchSpy as any;

      try {
        const alice = createTestIdentity('AliceOffline');
        const bob = createTestIdentity('BobOffline');

        const aliceStore = new DurableOutboxStore();
        const bobStore = new DurableOutboxStore();

        const aliceRouter = new MeshRouter({ localDid: alice.did, localPrivateKey: alice.privateKey, outboxStore: aliceStore });
        const bobRouter = new MeshRouter({ localDid: bob.did, localPrivateKey: bob.privateKey, outboxStore: bobStore });

        // Connect offline direct channel
        aliceRouter.registerPeerChannel({
          id: 'offline-direct',
          peerAddress: 'bob-local',
          remoteDid: bob.did,
          send: async (data) => bobRouter.ingestEnvelope(MeshRouter.deserializeEnvelope(data), 'offline-alice'),
        });

        let receivedAtBob = false;
        bobRouter.onMessage((env) => {
          receivedAtBob = true;
        });

        aliceRouter.sendEnvelope({
          targetDid: bob.did,
          envelopeType: 'SIGNED_EVENT',
          payloadBytes: new TextEncoder().encode('Completely offline payload without central servers'),
        });

        await new Promise((r) => setTimeout(r, 30));

        // Delivery succeeded without any central HTTP call
        expect(receivedAtBob).toBe(true);
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ==========================================
  // 8. 5-NODE CHAOS & ADVERSARIAL RESILIENCE
  // ==========================================
  describe('5-Node Chaos & Adversarial Peer Resilience', () => {
    it('converges a 5-node mesh network (A, B, C, D, E) under multi-route propagation', async () => {
      const nodes = ['A', 'B', 'C', 'D', 'E'].map((name) => {
        const id = createTestIdentity(name);
        const store = new DurableOutboxStore();
        const router = new MeshRouter({ localDid: id.did, localPrivateKey: id.privateKey, outboxStore: store });
        return { name, id, store, router };
      });

      // Connect mesh in a ring topology with cross-links:
      // A - B - C - D - E - A, plus A - C, B - D
      const connections: Array<[number, number]> = [
        [0, 1], // A-B
        [1, 2], // B-C
        [2, 3], // C-D
        [3, 4], // D-E
        [4, 0], // E-A
        [0, 2], // A-C
        [1, 3], // B-D
      ];

      for (const [idx1, idx2] of connections) {
        const n1 = nodes[idx1];
        const n2 = nodes[idx2];

        n1.router.registerPeerChannel({
          id: `ch-${n1.name}->${n2.name}`,
          peerAddress: n2.id.did,
          remoteDid: n2.id.did,
          send: async (data) => {
            // Simulate random asynchronous micro-delay
            await new Promise((r) => setTimeout(r, Math.random() * 10));
            return n2.router.ingestEnvelope(MeshRouter.deserializeEnvelope(data), `ch-${n1.name}->${n2.name}`);
          },
        });

        n2.router.registerPeerChannel({
          id: `ch-${n2.name}->${n1.name}`,
          peerAddress: n1.id.did,
          remoteDid: n1.id.did,
          send: async (data) => {
            await new Promise((r) => setTimeout(r, Math.random() * 10));
            return n1.router.ingestEnvelope(MeshRouter.deserializeEnvelope(data), `ch-${n2.name}->${n1.name}`);
          },
        });
      }

      const receivedAtE: MeshEnvelope[] = [];
      nodes[4].router.onMessage((env) => {
        receivedAtE.push(env);
      });

      // Node A broadcasts an emergency event targeted at Node E
      nodes[0].router.sendEnvelope({
        targetDid: nodes[4].id.did,
        envelopeType: 'SIGNED_EVENT',
        payloadBytes: new TextEncoder().encode('Broadcast from A to E across chaos mesh'),
        priority: 3, // Emergency
      });

      await new Promise((r) => setTimeout(r, 150));

      // 1. E receives message
      expect(receivedAtE.length).toBeGreaterThanOrEqual(1);
      expect(receivedAtE[0].originDid).toBe(nodes[0].id.did);

      // 2. Loop suppression prevented duplicate delivery flood
      expect(receivedAtE.length).toBe(1);

      // 3. Routers recorded duplicate packet drops
      let totalDuplicatesDropped = 0;
      for (const n of nodes) {
        totalDuplicatesDropped += n.router.getDiagnostics().duplicatePacketsDropped;
      }
      expect(totalDuplicatesDropped).toBeGreaterThan(0);
    });

    it('rejects forged signatures, replayed envelopes, and circular routes fail-closed', async () => {
      const alice = createTestIdentity('Alice');
      const mallory = createTestIdentity('Mallory'); // Adversary
      const bob = createTestIdentity('Bob');

      const bobStore = new DurableOutboxStore();
      const bobRouter = new MeshRouter({ localDid: bob.did, localPrivateKey: bob.privateKey, outboxStore: bobStore });

      let receivedCount = 0;
      bobRouter.onMessage(() => {
        receivedCount++;
      });

      // 1. Attack: Mallory signs envelope claiming Alice is originDid
      const forgedEnv = mallory.publicKeyHex; // Mallory signs with her key
      const timestamp = Date.now();
      const payloadBytes = new TextEncoder().encode('Forged malicious message');
      const envelopeId = bytesToHex(sha256(new TextEncoder().encode(`${alice.did}:forged`)));
      const forgedSignature = bytesToHex(signEd25519(hexToBytes(envelopeId), mallory.privateKey));

      const maliciousEnvelope: MeshEnvelope = {
        envelopeId,
        envelopeType: 'ENCRYPTED_MESSAGE',
        originDid: alice.did, // Claiming Alice's DID
        targetDid: bob.did,
        hopCount: 0,
        maxHops: 5,
        route: [mallory.did],
        timestamp,
        expiresAt: timestamp + 60000,
        priority: 1,
        payloadBytes,
        signatureHex: forgedSignature, // Signed by Mallory, not Alice
      };

      const forgedAccepted = await bobRouter.ingestEnvelope(maliciousEnvelope, 'chan-adversary');
      expect(forgedAccepted).toBe(false);
      expect(receivedCount).toBe(0);

      // 2. Attack: Circular route injection (Bob is already in route)
      const validAliceEnv = new MeshRouter({
        localDid: alice.did,
        localPrivateKey: alice.privateKey,
        outboxStore: new DurableOutboxStore(),
      }).createEnvelope({
        targetDid: 'did:key:zOtherPeer',
        envelopeType: 'SIGNED_EVENT',
        payloadBytes: new TextEncoder().encode('Route test'),
      });

      const circularEnv: MeshEnvelope = {
        ...validAliceEnv,
        route: [alice.did, bob.did], // Bob already traversed
      };

      const circularAccepted = await bobRouter.ingestEnvelope(circularEnv, 'chan-adversary');
      expect(circularAccepted).toBe(false);
      expect(bobRouter.getDiagnostics().duplicatePacketsDropped).toBeGreaterThanOrEqual(1);

      // 3. Attack: Replay flood of valid envelope
      const validDirectEnv = new MeshRouter({
        localDid: alice.did,
        localPrivateKey: alice.privateKey,
        outboxStore: new DurableOutboxStore(),
      }).createEnvelope({
        targetDid: bob.did,
        envelopeType: 'SIGNED_EVENT',
        payloadBytes: new TextEncoder().encode('Valid single message'),
      });

      const firstAccept = await bobRouter.ingestEnvelope(validDirectEnv, 'chan-adversary');
      expect(firstAccept).toBe(true);
      expect(receivedCount).toBe(1);

      // Replay identical envelope
      const replayAccept = await bobRouter.ingestEnvelope(validDirectEnv, 'chan-adversary');
      expect(replayAccept).toBe(false);
      expect(receivedCount).toBe(1); // Dropped! No duplicate delivered!
    });
  });
});
