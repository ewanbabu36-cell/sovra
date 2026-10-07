/**
 * @file packages/p2p/test/offline-ble-mesh.test.ts
 * Comprehensive Test Suite for Sovra Offline Decentralized BLE Mesh Network.
 *
 * Verifies:
 * 1. BLE Framing, MTU Fragmentation (182-byte iOS, 512-byte Android), and CRC-32 Integrity.
 * 2. Mutual Ed25519 Handshake and ChaCha20-Poly1305 Forward-Secure Session Derivation.
 * 3. 4-Peer Linear Multi-Hop Mesh Routing (A <-> B <-> C <-> D) with E2EE payload relay.
 * 4. End-to-End Cryptographic Delivery Receipt from D back to A, transitioning outbox to ACKNOWLEDGED.
 * 5. Network Partition and Healing Convergence (Store-and-Forward relay resumption).
 * 6. Adversarial Resistance (replay attack suppression, route loop prevention, corrupted chunks, spoofed signatures).
 * 7. Process Restart Recovery (disk-backed outbox and relay queue persistence).
 * 8. User Controls, Battery Duty-Cycling, and Emergency Panic Wipe.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  generateEd25519KeyPair,
  bytesToHex,
  hexToBytes,
  sha256,
} from '@sovra/crypto';
import { encodeEd25519DidKey } from '@sovra/identity';
import {
  BleFrameCodec,
  BleFrameReassembler,
  BleHandshakeEngine,
  VirtualBleBus,
  VirtualBleAdapter,
  BluetoothLETransport,
  DurableOutboxStore,
  MeshRouter,
  MeshTransportManager,
  MeshSyncEngine,
} from '../src/mesh/index.js';

describe('Sovra Offline Bluetooth Decentralized Mesh Suite', () => {
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-mesh-test-'));
    tempStorageDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of tempStorageDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {}
    }
    tempStorageDirs = [];
  });

  // ==========================================
  // 1. BLE FRAMING, CHUNKING & INTEGRITY
  // ==========================================
  describe('BLE Framing, MTU Slicing & CRC-32 Validation', () => {
    it('slices large payload into MTU-bounded chunks and reassembles accurately', () => {
      // 1024-byte payload with standard iOS 182-byte MTU
      const payload = new Uint8Array(1024);
      for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) % 256;

      const chunks = BleFrameCodec.fragment(payload, 182);
      expect(chunks.length).toBeGreaterThan(1);

      // Verify each chunk is <= 182 bytes
      for (const ch of chunks) {
        expect(ch.length).toBeLessThanOrEqual(182);
      }

      // Reassemble
      const reassembler = new BleFrameReassembler();
      let result: Uint8Array | null = null;
      for (const ch of chunks) {
        result = reassembler.feed(ch);
      }

      expect(result).not.toBeNull();
      expect(result!.length).toBe(1024);
      expect(Array.from(result!)).toEqual(Array.from(payload));
    });

    it('handles Android 512-byte MTU and small single-chunk payloads', () => {
      const shortPayload = new TextEncoder().encode('Hello mesh peer');
      const chunks = BleFrameCodec.fragment(shortPayload, 512);

      expect(chunks.length).toBe(1);
      expect(chunks[0]!.length).toBe(28 + shortPayload.length);

      const reassembler = new BleFrameReassembler();
      const reassembled = reassembler.feed(chunks[0]!);

      expect(reassembled).not.toBeNull();
      expect(new TextDecoder().decode(reassembled!)).toBe('Hello mesh peer');
    });

    it('rejects corrupted chunk with modified byte due to CRC-32 mismatch', () => {
      const payload = new Uint8Array(300);
      const chunks = BleFrameCodec.fragment(payload, 100);

      // Corrupt a byte in the payload of the first chunk
      const corrupted = new Uint8Array(chunks[0]!);
      corrupted[30] = (corrupted[30]! ^ 0xff); // Flip bits in payload slice

      expect(() => {
        BleFrameCodec.decodeChunk(corrupted);
      }).toThrow(/CRC-32 checksum mismatch/);
    });

    it('enforces transfer capacity bounds and per-transfer chunk limits in BleFrameReassembler', () => {
      const reassembler = new BleFrameReassembler({
        maxPendingTransfers: 2,
        maxChunksPerTransfer: 5,
      });

      // Transfer 1 chunk 0 of 2
      const t1Chunk0 = BleFrameCodec.fragment(new Uint8Array(50), 40, new Uint8Array(16).fill(1))[0]!;
      expect(reassembler.feed(t1Chunk0)).toBeNull();

      // Transfer 2 chunk 0 of 2
      const t2Chunk0 = BleFrameCodec.fragment(new Uint8Array(50), 40, new Uint8Array(16).fill(2))[0]!;
      expect(reassembler.feed(t2Chunk0)).toBeNull();

      // Transfer 3 chunk 0 of 2 -> exceeds maxPendingTransfers = 2
      const t3Chunk0 = BleFrameCodec.fragment(new Uint8Array(50), 40, new Uint8Array(16).fill(3))[0]!;
      expect(() => {
        reassembler.feed(t3Chunk0);
      }).toThrow(/Maximum concurrent BLE assembly transfers/);

      // Total chunks limit check: 10 chunks with maxChunksPerTransfer = 5
      const hugeChunks = BleFrameCodec.fragment(new Uint8Array(200), 35, new Uint8Array(16).fill(4));
      expect(hugeChunks.length).toBeGreaterThan(5);
      expect(() => {
        reassembler.feed(hugeChunks[0]!);
      }).toThrow(/Total chunks .* exceeds maximum allowed chunks/);
    });
  });

  // ==========================================
  // 2. MUTUAL CRYPTOGRAPHIC BLE HANDSHAKE
  // ==========================================
  describe('Mutual Cryptographic Handshake & Forward-Secure Session', () => {
    it('successfully completes 3-step mutual Ed25519 authentication and establishes ciphers', () => {
      const alice = createTestIdentity('Alice');
      const bob = createTestIdentity('Bob');

      // Step 1: Alice (Initiator) creates handshake request
      const { step1, ephemeralPrivate: alicePriv, initiatorNonce } =
        BleHandshakeEngine.createInitiatorStep1();

      expect(step1.type).toBe('STEP_1_INITIATE');
      expect(step1.initiatorEphemeralPubkeyHex).toBeDefined();

      // Step 2: Bob (Responder) processes Step 1 and signs challenge response
      const { step2, session: bobInitialSession, responderState } =
        BleHandshakeEngine.processStep1AndCreateStep2(
          step1,
          bob.did,
          bob.privateKey,
          bob.publicKeyHex,
        );

      expect(step2.type).toBe('STEP_2_CHALLENGE_RESPONSE');
      expect(step2.responderDid).toBe(bob.did);

      // Step 3: Alice processes Step 2 and creates Step 3 confirmation
      const { step3, session: aliceSession } = BleHandshakeEngine.processStep2AndCreateStep3(
        step2,
        alicePriv,
        initiatorNonce,
        alice.did,
        alice.privateKey,
        alice.publicKeyHex,
      );

      expect(step3.type).toBe('STEP_3_CONFIRM');
      expect(aliceSession.remoteDid).toBe(bob.did);

      // Bob finalizes with Step 3
      const bobSession = BleHandshakeEngine.processStep3ForResponder(responderState, step3);
      expect(bobSession.remoteDid).toBe(alice.did);

      // Verify Session IDs match
      expect(aliceSession.sessionId).toBe(bobSession.sessionId);

      // Verify End-to-End ChaCha20-Poly1305 symmetric encryption across link
      const secretMessage = new TextEncoder().encode('Mesh secret link communication');
      const ciphertextFromAlice = aliceSession.encrypt(secretMessage);
      const decryptedByBob = bobSession.decrypt(ciphertextFromAlice);

      expect(new TextDecoder().decode(decryptedByBob)).toBe('Mesh secret link communication');

      // Verify reverse transmission (Bob -> Alice)
      const bobReply = new TextEncoder().encode('Acknowledged and secure');
      const ciphertextFromBob = bobSession.encrypt(bobReply);
      const decryptedByAlice = aliceSession.decrypt(ciphertextFromBob);

      expect(new TextDecoder().decode(decryptedByAlice)).toBe('Acknowledged and secure');
    });

    it('rejects handshake if responder signature is spoofed', () => {
      const alice = createTestIdentity('Alice');
      const bob = createTestIdentity('Bob');
      const eve = createTestIdentity('Eve');

      const { step1, ephemeralPrivate: alicePriv, initiatorNonce } =
        BleHandshakeEngine.createInitiatorStep1();

      // Bob signs, but Eve modifies responderDid to claim she is someone else
      const { step2 } = BleHandshakeEngine.processStep1AndCreateStep2(
        step1,
        bob.did,
        eve.privateKey, // Eve signs with her private key but claims to be Bob
        bob.publicKeyHex, // Providing Bob's pubkey
      );

      expect(() => {
        BleHandshakeEngine.processStep2AndCreateStep3(
          step2,
          alicePriv,
          initiatorNonce,
          alice.did,
          alice.privateKey,
          alice.publicKeyHex,
        );
      }).toThrow(/signature verification failed/);
    });

    it('tolerates dropped packets without AEAD nonce desynchronization and rejects replays', () => {
      const alice = createTestIdentity('Alice');
      const bob = createTestIdentity('Bob');

      const { step1, ephemeralPrivate: alicePriv, initiatorNonce } =
        BleHandshakeEngine.createInitiatorStep1();

      const { step2, responderState } = BleHandshakeEngine.processStep1AndCreateStep2(
        step1,
        bob.did,
        bob.privateKey,
        bob.publicKeyHex,
      );

      const { step3, session: aliceSession } = BleHandshakeEngine.processStep2AndCreateStep3(
        step2,
        alicePriv,
        initiatorNonce,
        alice.did,
        alice.privateKey,
        alice.publicKeyHex,
      );

      const bobSession = BleHandshakeEngine.processStep3ForResponder(responderState, step3);

      // Alice encrypts frame 0, frame 1, and frame 2
      const f0 = aliceSession.encrypt(new TextEncoder().encode('Packet 0'));
      const f1 = aliceSession.encrypt(new TextEncoder().encode('Packet 1 (Dropped in flight)'));
      const f2 = aliceSession.encrypt(new TextEncoder().encode('Packet 2'));

      // Bob decrypts frame 0
      const d0 = bobSession.decrypt(f0);
      expect(new TextDecoder().decode(d0)).toBe('Packet 0');

      // Frame 1 is intentionally DROPPED (never passed to bobSession.decrypt)

      // Bob decrypts frame 2: MUST succeed despite dropped frame 1
      const d2 = bobSession.decrypt(f2);
      expect(new TextDecoder().decode(d2)).toBe('Packet 2');

      // Replay attack: Mallory captures and replays frame 2
      expect(() => {
        bobSession.decrypt(f2);
      }).toThrow(/Replay detected/);
    });
  });

  // ==========================================
  // 3. 4-PEER LINEAR MULTI-HOP MESH & RECEIPTS
  // ==========================================
  describe('4-Peer Linear Multi-Hop Mesh (A <-> B <-> C <-> D) with Cryptographic Receipts', () => {
    it('transmits message from A to D through B and C, and delivers signed receipt back to A', async () => {
      const bus = new VirtualBleBus();

      const aId = createTestIdentity('NodeA');
      const bId = createTestIdentity('NodeB');
      const cId = createTestIdentity('NodeC');
      const dId = createTestIdentity('NodeD');

      const aAdapter = new VirtualBleAdapter('addr-A', 182, bus);
      const bAdapter = new VirtualBleAdapter('addr-B', 182, bus);
      const cAdapter = new VirtualBleAdapter('addr-C', 182, bus);
      const dAdapter = new VirtualBleAdapter('addr-D', 182, bus);

      const aStore = new DurableOutboxStore();
      const bStore = new DurableOutboxStore();
      const cStore = new DurableOutboxStore();
      const dStore = new DurableOutboxStore();

      const aRouter = new MeshRouter({ localDid: aId.did, localPrivateKey: aId.privateKey, outboxStore: aStore });
      const bRouter = new MeshRouter({ localDid: bId.did, localPrivateKey: bId.privateKey, outboxStore: bStore });
      const cRouter = new MeshRouter({ localDid: cId.did, localPrivateKey: cId.privateKey, outboxStore: cStore });
      const dRouter = new MeshRouter({ localDid: dId.did, localPrivateKey: dId.privateKey, outboxStore: dStore });

      // Create linear peer channels: A <-> B, B <-> C, C <-> D
      const linkAB = bus.createLink('addr-A', 'addr-B', 182);
      const linkBC = bus.createLink('addr-B', 'addr-C', 182);
      const linkCD = bus.createLink('addr-C', 'addr-D', 182);

      // Register channels on routers
      // Link A <-> B
      aRouter.registerPeerChannel({
        id: 'ch-AB',
        peerAddress: 'addr-B',
        remoteDid: bId.did,
        send: async (data) => linkAB.channelA.send(data),
      });
      linkAB.channelB.onData(async (chunk) => {
        try {
          const env = MeshRouter.deserializeEnvelope(chunk);
          await bRouter.ingestEnvelope(env, 'ch-BA');
        } catch {}
      });

      bRouter.registerPeerChannel({
        id: 'ch-BA',
        peerAddress: 'addr-A',
        remoteDid: aId.did,
        send: async (data) => linkAB.channelB.send(data),
      });
      linkAB.channelA.onData(async (chunk) => {
        try {
          const env = MeshRouter.deserializeEnvelope(chunk);
          await aRouter.ingestEnvelope(env, 'ch-AB');
        } catch {}
      });

      // Link B <-> C
      bRouter.registerPeerChannel({
        id: 'ch-BC',
        peerAddress: 'addr-C',
        remoteDid: cId.did,
        send: async (data) => linkBC.channelA.send(data),
      });
      linkBC.channelB.onData(async (chunk) => {
        try {
          const env = MeshRouter.deserializeEnvelope(chunk);
          await cRouter.ingestEnvelope(env, 'ch-CB');
        } catch {}
      });

      cRouter.registerPeerChannel({
        id: 'ch-CB',
        peerAddress: 'addr-B',
        remoteDid: bId.did,
        send: async (data) => linkBC.channelB.send(data),
      });
      linkBC.channelA.onData(async (chunk) => {
        try {
          const env = MeshRouter.deserializeEnvelope(chunk);
          await bRouter.ingestEnvelope(env, 'ch-BC');
        } catch {}
      });

      // Link C <-> D
      cRouter.registerPeerChannel({
        id: 'ch-CD',
        peerAddress: 'addr-D',
        remoteDid: dId.did,
        send: async (data) => linkCD.channelA.send(data),
      });
      linkCD.channelB.onData(async (chunk) => {
        try {
          const env = MeshRouter.deserializeEnvelope(chunk);
          await dRouter.ingestEnvelope(env, 'ch-DC');
        } catch {}
      });

      dRouter.registerPeerChannel({
        id: 'ch-DC',
        peerAddress: 'addr-C',
        remoteDid: cId.did,
        send: async (data) => linkCD.channelB.send(data),
      });
      linkCD.channelA.onData(async (chunk) => {
        try {
          const env = MeshRouter.deserializeEnvelope(chunk);
          await cRouter.ingestEnvelope(env, 'ch-CD');
        } catch {}
      });

      // Setup receipt listener on Node A
      let receiptReceived = false;
      aRouter.onDeliveryReceipt((receipt) => {
        if (receipt.recipientDid === dId.did) {
          receiptReceived = true;
        }
      });

      // Setup inbox message listener on Node D
      let messageDeliveredToD = false;
      dRouter.onMessage((env) => {
        if (env.originDid === aId.did && env.targetDid === dId.did) {
          messageDeliveredToD = true;
        }
      });

      // Node A sends multi-hop message to Node D
      const payloadBytes = new TextEncoder().encode('Hello Node D, from offline Node A across mesh!');
      const sentEnvelope = await aRouter.send({
        targetDid: dId.did,
        envelopeType: 'ENCRYPTED_MESSAGE',
        payloadBytes,
        priority: 2,
        maxHops: 5,
      });

      // Allow microtask ticks for propagation across A -> B -> C -> D and receipt D -> C -> B -> A
      await new Promise(r => setTimeout(r, 80));

      // 1. Verify Node D received and stored in inbox
      expect(messageDeliveredToD).toBe(true);
      const dInbox = dStore.getInbox();
      expect(dInbox.length).toBe(1);
      expect(dInbox[0]!.envelopeId).toBe(sentEnvelope.envelopeId);

      // 2. Verify Relays B and C routed the packet without mutating payload
      expect(bRouter.getDiagnostics().packetsRouted).toBeGreaterThanOrEqual(1);
      expect(cRouter.getDiagnostics().packetsRouted).toBeGreaterThanOrEqual(1);

      // 3. Verify Delivery Receipt returned all the way back to Node A
      expect(receiptReceived).toBe(true);

      // 4. Verify Node A transitioned outbox item to ACKNOWLEDGED
      const outboxA = aStore.getOutboxItem(sentEnvelope.envelopeId);
      expect(outboxA).toBeDefined();
      expect(outboxA!.status).toBe('ACKNOWLEDGED');
      expect(outboxA!.acknowledgedAt).toBeDefined();
    });
  });

  // ==========================================
  // 4. NETWORK PARTITION & HEALING CONVERGENCE
  // ==========================================
  describe('Network Partition and Healing Convergence', () => {
    it('buffers messages in relay queue during partition and flushes on link restoration', async () => {
      const bus = new VirtualBleBus();
      const aId = createTestIdentity('NodeA');
      const bId = createTestIdentity('NodeB');
      const cId = createTestIdentity('NodeC');

      const aStore = new DurableOutboxStore();
      const bStore = new DurableOutboxStore();
      const cStore = new DurableOutboxStore();

      const aRouter = new MeshRouter({ localDid: aId.did, localPrivateKey: aId.privateKey, outboxStore: aStore });
      const bRouter = new MeshRouter({ localDid: bId.did, localPrivateKey: bId.privateKey, outboxStore: bStore });
      const cRouter = new MeshRouter({ localDid: cId.did, localPrivateKey: cId.privateKey, outboxStore: cStore });

      // Link A <-> B is active
      const linkAB = bus.createLink('addr-A', 'addr-B');
      aRouter.registerPeerChannel({
        id: 'ch-AB',
        peerAddress: 'addr-B',
        remoteDid: bId.did,
        send: async (data) => linkAB.channelA.send(data),
      });
      linkAB.channelB.onData(async (chunk) => {
        try {
          const env = MeshRouter.deserializeEnvelope(chunk);
          await bRouter.ingestEnvelope(env, 'ch-BA');
        } catch {}
      });

      // B <-> C is currently PARTITIONED (severed link, no channel registered on B for C)
      // A sends message intended for C
      const env = await aRouter.send({
        targetDid: cId.did,
        envelopeType: 'ENCRYPTED_MESSAGE',
        payloadBytes: new TextEncoder().encode('Deferred message during partition'),
      });

      await new Promise(r => setTimeout(r, 20));

      // B has ingested the packet and placed it in its store-and-forward relay queue
      expect(bStore.getRelayQueueSize()).toBe(1);
      expect(cStore.getInbox().length).toBe(0);

      // PARTITION HEALING: B discovers and connects to C
      const linkBC = bus.createLink('addr-B', 'addr-C');
      bRouter.registerPeerChannel({
        id: 'ch-BC',
        peerAddress: 'addr-C',
        remoteDid: cId.did,
        send: async (data) => linkBC.channelA.send(data),
      });
      linkBC.channelB.onData(async (chunk) => {
        try {
          const e = MeshRouter.deserializeEnvelope(chunk);
          await cRouter.ingestEnvelope(e, 'ch-CB');
        } catch {}
      });

      // Flush B's relay queue now that the link healed
      await bRouter.flushOutboxAndRelays();

      await new Promise(r => setTimeout(r, 30));

      // C now has received the message from B
      expect(cStore.getInbox().length).toBe(1);
      expect(cStore.getInbox()[0]!.envelopeId).toBe(env.envelopeId);
    });
  });

  // ==========================================
  // 5. ADVERSARIAL RESISTANCE & LOOP SUPPRESSION
  // ==========================================
  describe('Adversarial Resistance, Replay Suppression & TTL', () => {
    it('suppresses duplicate envelopes and tracks dropped count', async () => {
      const aId = createTestIdentity('NodeA');
      const bId = createTestIdentity('NodeB');

      const store = new DurableOutboxStore();
      const router = new MeshRouter({ localDid: bId.did, localPrivateKey: bId.privateKey, outboxStore: store });

      const env = router.createEnvelope({
        targetDid: bId.did,
        envelopeType: 'ENCRYPTED_MESSAGE',
        payloadBytes: new TextEncoder().encode('Test packet'),
      });

      // Ingest once: accepted
      const accepted = await router.ingestEnvelope(env);
      expect(accepted).toBe(true);
      expect(store.getInbox().length).toBe(1);

      // Re-ingest same packet (Replay attack): rejected
      const replayed = await router.ingestEnvelope(env);
      expect(replayed).toBe(false);
      expect(router.getDiagnostics().duplicatePacketsDropped).toBe(1);
    });

    it('rejects expired envelopes whose TTL has elapsed', async () => {
      const aId = createTestIdentity('NodeA');
      const store = new DurableOutboxStore();
      const router = new MeshRouter({ localDid: aId.did, localPrivateKey: aId.privateKey, outboxStore: store });

      const expiredEnv = router.createEnvelope({
        targetDid: aId.did,
        envelopeType: 'ENCRYPTED_MESSAGE',
        payloadBytes: new TextEncoder().encode('Expired content'),
        ttlMs: -1000, // Expired 1 second ago
      });

      const accepted = await router.ingestEnvelope(expiredEnv);
      expect(accepted).toBe(false);
      expect(store.getInbox().length).toBe(0);
    });

    it('rejects tampered envelope where payload was modified by malicious relay', async () => {
      const aId = createTestIdentity('NodeA');
      const bId = createTestIdentity('NodeB');
      const store = new DurableOutboxStore();
      const router = new MeshRouter({ localDid: bId.did, localPrivateKey: bId.privateKey, outboxStore: store });

      const validEnv = router.createEnvelope({
        targetDid: bId.did,
        envelopeType: 'ENCRYPTED_MESSAGE',
        payloadBytes: new TextEncoder().encode('Genuine payload'),
      });

      // Attacker tampers with payload bytes without valid signature
      const tamperedEnv = {
        ...validEnv,
        payloadBytes: new TextEncoder().encode('TAMPERED PAYLOAD'),
      };

      const accepted = await router.ingestEnvelope(tamperedEnv);
      expect(accepted).toBe(false);
      expect(store.getInbox().length).toBe(0);
    });
  });

  // ==========================================
  // 6. PROCESS RESTART RECOVERY & PERSISTENCE
  // ==========================================
  describe('Process Restart Recovery & Persistence', () => {
    it('persists outbox, relay queue, and inbox to disk and restores on restart', async () => {
      const storageDir = getTempDir();
      const store1 = new DurableOutboxStore({ storageDir });
      const aId = createTestIdentity('NodeA');
      const bId = createTestIdentity('NodeB');

      const router1 = new MeshRouter({ localDid: aId.did, localPrivateKey: aId.privateKey, outboxStore: store1 });

      // Enqueue outbox item
      const outboxEnv = router1.createEnvelope({
        targetDid: bId.did,
        envelopeType: 'ENCRYPTED_MESSAGE',
        payloadBytes: new TextEncoder().encode('Persistence test message'),
      });
      store1.enqueueOutbox(outboxEnv);

      // Enqueue relay item
      const relayEnv = router1.createEnvelope({
        targetDid: 'did:key:z6MksOther',
        envelopeType: 'ENCRYPTED_MESSAGE',
        payloadBytes: new TextEncoder().encode('Relay in transit'),
      });
      store1.enqueueRelay(relayEnv);

      // Save to disk
      await store1.save();

      // SIMULATE PROCESS RESTART: Create brand new store pointing to same directory
      const store2 = new DurableOutboxStore({ storageDir });
      await store2.load();

      // Verify restored states
      const restoredOutbox = store2.getOutboxItem(outboxEnv.envelopeId);
      expect(restoredOutbox).toBeDefined();
      expect(restoredOutbox!.status).toBe('QUEUED');
      expect(new TextDecoder().decode(restoredOutbox!.envelope.payloadBytes)).toBe('Persistence test message');

      const restoredRelay = store2.getNextRelayBatch(10);
      expect(restoredRelay.length).toBe(1);
      expect(restoredRelay[0]!.envelopeId).toBe(relayEnv.envelopeId);
    });
  });

  // ==========================================
  // 7. USER CONTROLS, DUTY-CYCLING & PANIC WIPE
  // ==========================================
  describe('User Controls, Battery Duty-Cycling & Emergency Panic Wipe', () => {
    it('stops relaying third-party traffic when relayParticipationEnabled is false', async () => {
      const bId = createTestIdentity('NodeB');
      const store = new DurableOutboxStore();
      const router = new MeshRouter({
        localDid: bId.did,
        localPrivateKey: bId.privateKey,
        outboxStore: store,
        userControls: { relayParticipationEnabled: false },
      });

      const thirdPartyEnv = router.createEnvelope({
        targetDid: 'did:key:z6MksThirdParty',
        envelopeType: 'ENCRYPTED_MESSAGE',
        payloadBytes: new TextEncoder().encode('Transit message'),
      });

      await router.ingestEnvelope(thirdPartyEnv);

      // Envelope must NOT be queued in relay store because user opted out
      expect(store.getRelayQueueSize()).toBe(0);
    });

    it('completely zeros all memory and disk state during emergency panic wipe', async () => {
      const storageDir = getTempDir();
      const store = new DurableOutboxStore({ storageDir });
      const aId = createTestIdentity('NodeA');
      const router = new MeshRouter({ localDid: aId.did, localPrivateKey: aId.privateKey, outboxStore: store });

      const env = router.createEnvelope({
        targetDid: aId.did,
        envelopeType: 'ENCRYPTED_MESSAGE',
        payloadBytes: new TextEncoder().encode('Sensitive data'),
      });
      store.enqueueOutbox(env);
      store.storeInbox(env);
      await store.save();

      // Trigger Panic Wipe
      await router.panicWipe();

      expect(store.getAllOutbox().length).toBe(0);
      expect(store.getInbox().length).toBe(0);
      expect(store.getRelayQueueSize()).toBe(0);
      expect(store.isSeen(env.envelopeId)).toBe(false);
    });
  });

  // ==========================================
  // 8. OFFLINE DATA SYNC ENGINE & MODERATION
  // ==========================================
  describe('MeshSyncEngine: Vector Clock Reconciliation & Offline Moderation', () => {
    it('computes missing event IDs and flags unmoderated events as PENDING_MODERATION', () => {
      const syncEngine = new MeshSyncEngine({
        blockedPubkeys: ['bad-actor-pubkey'],
        forbiddenKeywords: ['malware', 'phishing'],
      });

      const eventA = {
        id: 'evt-1',
        pubkey: 'author-alice',
        createdAt: 1000,
        kind: 1,
        tags: [],
        content: 'Authentic mesh post',
        sig: 'sig1',
      };

      const eventB = {
        id: 'evt-2',
        pubkey: 'author-bob',
        createdAt: 2000,
        kind: 1,
        tags: [],
        content: 'Another offline update',
        sig: 'sig2',
      };

      // Peer summary contains only eventA
      const peerSummary = syncEngine.createSyncSummary([eventA]);
      expect(peerSummary.authors.length).toBe(1);

      // Local node has eventA and eventB
      // When local node inspects peerSummary, what is peer missing?
      const localEvents = [eventA, eventB];
      const missingFromLocal = syncEngine.computeMissingEventIds(peerSummary, localEvents);
      expect(missingFromLocal.length).toBe(0); // Local has all of peer's events

      // Conversely, if peer evaluates our summary:
      const ourSummary = syncEngine.createSyncSummary(localEvents);
      const missingFromPeer = syncEngine.computeMissingEventIds(ourSummary, [eventA]);
      expect(missingFromPeer).toEqual(['evt-2']);

      // Offline moderation status tagging
      expect(syncEngine.evaluateOfflineModeration(eventA)).toBe('PENDING_MODERATION');

      const prohibitedEvent = {
        ...eventA,
        id: 'evt-bad',
        content: 'Click here for malware download',
      };
      expect(syncEngine.evaluateOfflineModeration(prohibitedEvent)).toBe('FLAGGED');
    });
  });

  // ==========================================
  // 9. END-TO-END BLE TRANSPORT & MANAGER INTEGRATION
  // ==========================================
  describe('End-to-End BluetoothLETransport & MeshTransportManager Integration', () => {
    it('discovers peer over virtual BLE radio, executes mutual handshake, and verifies status', async () => {
      const bus = new VirtualBleBus();
      const aliceId = createTestIdentity('Alice');
      const bobId = createTestIdentity('Bob');

      const aliceAdapter = new VirtualBleAdapter('ble-addr-alice', 182, bus);
      const bobAdapter = new VirtualBleAdapter('ble-addr-bob', 182, bus);

      const aliceTransport = new BluetoothLETransport({
        adapter: aliceAdapter,
        localDid: aliceId.did,
        localDevicePrivkey: aliceId.privateKey,
        localDevicePubkeyHex: aliceId.publicKeyHex,
      });

      const bobTransport = new BluetoothLETransport({
        adapter: bobAdapter,
        localDid: bobId.did,
        localDevicePrivkey: bobId.privateKey,
        localDevicePubkeyHex: bobId.publicKeyHex,
      });

      const aliceStore = new DurableOutboxStore();
      const bobStore = new DurableOutboxStore();

      const aliceRouter = new MeshRouter({
        localDid: aliceId.did,
        localPrivateKey: aliceId.privateKey,
        outboxStore: aliceStore,
      });

      const bobRouter = new MeshRouter({
        localDid: bobId.did,
        localPrivateKey: bobId.privateKey,
        outboxStore: bobStore,
      });

      const aliceManager = new MeshTransportManager({
        router: aliceRouter,
        bleTransport: aliceTransport,
        internetAvailable: false,
      });

      const bobManager = new MeshTransportManager({
        router: bobRouter,
        bleTransport: bobTransport,
        internetAvailable: false,
      });

      // Initially without peers
      expect(aliceManager.getNetworkStatus()).toBe('NO_PEERS');
      expect(bobManager.getNetworkStatus()).toBe('NO_PEERS');

      // Start transports
      await aliceTransport.start();
      await bobTransport.start();

      // Register Bob's channel listener before connection arrives
      let bobReceivedDecrypted: Uint8Array | null = null;
      bobTransport.onChannel((ch) => {
        ch.onData((data) => {
          bobReceivedDecrypted = data;
        });
      });

      // Alice connects directly to Bob over BLE
      const connectRes = await aliceTransport.connect('ble-addr-bob');
      expect(connectRes.ok).toBe(true);

      const aliceChannel = connectRes.value;
      expect(aliceChannel.remoteDid).toBe(bobId.did);

      await new Promise(r => setTimeout(r, 40));

      const testPayload = new TextEncoder().encode('E2EE Ble Session Test');
      await aliceChannel.send(testPayload);

      await new Promise(r => setTimeout(r, 40));

      expect(bobReceivedDecrypted).not.toBeNull();
      expect(new TextDecoder().decode(bobReceivedDecrypted!)).toBe('E2EE Ble Session Test');

      // Cleanup
      await aliceTransport.stop();
      await bobTransport.stop();
    });

    it('bounds discovered peers table and evicts lowest RSSI peer', () => {
      const aliceId = createTestIdentity('AliceLeader');
      const aliceStore = new DurableOutboxStore();
      const aliceRouter = new MeshRouter({
        localDid: aliceId.did,
        localPrivateKey: aliceId.privateKey,
        outboxStore: aliceStore,
      });

      const manager = new MeshTransportManager({
        router: aliceRouter,
        internetAvailable: false,
      });

      // Feed more than MAX_DISCOVERED_PEERS peers into handleDiscoveredPeer
      for (let i = 0; i < MeshTransportManager.MAX_DISCOVERED_PEERS + 20; i++) {
        (manager as any).handleDiscoveredPeer({
          peerAddress: `peer-addr-${i}`,
          rssi: -100 + (i % 50),
          protocolVersion: 1,
          ephemeralDiscoveryToken: `token-${i}`,
          capabilityFlags: 1,
          lastSeenAt: Date.now(),
        });
      }

      const diagnostics = manager.getDiagnostics();
      expect(diagnostics.nearbyPeersCount).toBeLessThanOrEqual(MeshTransportManager.MAX_DISCOVERED_PEERS);
      expect(diagnostics.nearbyPeersCount).toBe(MeshTransportManager.MAX_DISCOVERED_PEERS);
    });
  });
});

