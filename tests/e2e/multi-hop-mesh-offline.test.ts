/**
 * @file tests/e2e/multi-hop-mesh-offline.test.ts
 * Genuine Multi-Hop Offline Mesh Store-and-Forward Verification Test.
 *
 * Verifies end-to-end:
 * 1. Topology: Alice <---> Bob (Relay) <---> Charlie (Final Destination).
 *    Alice and Charlie have NO direct connection.
 * 2. Cryptographic Integrity: Ed25519 signed envelopes routed across hops without tampering.
 * 3. Store-and-Forward Relay: Intermediate node relays opaque payload, increments hop count, and updates route.
 * 4. Cryptographic Delivery Receipts: Charlie generates signed delivery receipt routed back through Bob to Alice.
 * 5. Loop Suppression: Envelopes with already-visited nodes in route or seen IDs are dropped.
 * 6. Hop Count & TTL Expiration: Packets exceeding max hops or TTL are rejected.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MeshRouter,
  DurableOutboxStore,
  type MeshPeerChannel,
  type MeshEnvelope,
  type DeliveryReceipt,
} from '../../packages/p2p/dist/index.js';
import {
  generateEd25519KeyPair,
  bytesToHex,
  hexToBytes,
  verifyEd25519,
} from '../../packages/crypto/dist/index.js';
import { encodeEd25519DidKey, decodeEd25519DidKey } from '../../packages/identity/dist/index.js';

class MockMeshChannel implements MeshPeerChannel {
  public remoteDid?: string;
  private peerChannel?: MockMeshChannel;

  constructor(public readonly id: string, public readonly peerAddress: string) {}

  public connectTo(peer: MockMeshChannel): void {
    this.peerChannel = peer;
    peer.peerChannel = this;
  }

  public onReceive?: (data: Uint8Array) => Promise<void>;

  public async send(data: Uint8Array): Promise<any> {
    if (this.peerChannel && this.peerChannel.onReceive) {
      return this.peerChannel.onReceive(data);
    }
  }
}

describe('Genuine Multi-Hop Mesh Store-and-Forward Pipeline', () => {
  let aliceRouter: MeshRouter;
  let bobRouter: MeshRouter;
  let charlieRouter: MeshRouter;

  let aliceDid: string;
  let bobDid: string;
  let charlieDid: string;

  let aliceChannelToBob: MockMeshChannel;
  let bobChannelToAlice: MockMeshChannel;
  let bobChannelToCharlie: MockMeshChannel;
  let charlieChannelToBob: MockMeshChannel;

  beforeEach(() => {
    // 1. Generate cryptographic keys for 3 independent nodes
    const aliceKeys = generateEd25519KeyPair();
    aliceDid = encodeEd25519DidKey(aliceKeys.publicKey);
    aliceRouter = new MeshRouter({
      localDid: aliceDid,
      localPrivateKey: aliceKeys.privateKey,
      outboxStore: new DurableOutboxStore({ maxRelayQueueSize: 100, maxInboxSize: 100 }),
      defaultMaxHops: 5,
    });

    const bobKeys = generateEd25519KeyPair();
    bobDid = encodeEd25519DidKey(bobKeys.publicKey);
    bobRouter = new MeshRouter({
      localDid: bobDid,
      localPrivateKey: bobKeys.privateKey,
      outboxStore: new DurableOutboxStore({ maxRelayQueueSize: 100, maxInboxSize: 100 }),
      defaultMaxHops: 5,
    });

    const charlieKeys = generateEd25519KeyPair();
    charlieDid = encodeEd25519DidKey(charlieKeys.publicKey);
    charlieRouter = new MeshRouter({
      localDid: charlieDid,
      localPrivateKey: charlieKeys.privateKey,
      outboxStore: new DurableOutboxStore({ maxRelayQueueSize: 100, maxInboxSize: 100 }),
      defaultMaxHops: 5,
    });

    // 2. Establish Topology: Alice <-> Bob and Bob <-> Charlie (NO Alice <-> Charlie link)
    aliceChannelToBob = new MockMeshChannel('alice-to-bob', 'ble:bob-mac');
    bobChannelToAlice = new MockMeshChannel('bob-to-alice', 'ble:alice-mac');
    aliceChannelToBob.connectTo(bobChannelToAlice);

    aliceChannelToBob.remoteDid = bobDid;
    bobChannelToAlice.remoteDid = aliceDid;

    bobChannelToCharlie = new MockMeshChannel('bob-to-charlie', 'ble:charlie-mac');
    charlieChannelToBob = new MockMeshChannel('charlie-to-bob', 'ble:bob-mac');
    bobChannelToCharlie.connectTo(charlieChannelToBob);

    bobChannelToCharlie.remoteDid = charlieDid;
    charlieChannelToBob.remoteDid = bobDid;

    // Register peer channels with routers
    aliceRouter.registerPeerChannel(aliceChannelToBob);
    bobRouter.registerPeerChannel(bobChannelToAlice);
    bobRouter.registerPeerChannel(bobChannelToCharlie);
    charlieRouter.registerPeerChannel(charlieChannelToBob);

    // Bind packet transport deserialization handlers
    aliceChannelToBob.onReceive = async (data: Uint8Array) => {
      const envelope = MeshRouter.deserializeEnvelope(data);
      await aliceRouter.ingestEnvelope(envelope, aliceChannelToBob.id);
    };
    bobChannelToAlice.onReceive = async (data: Uint8Array) => {
      const envelope = MeshRouter.deserializeEnvelope(data);
      await bobRouter.ingestEnvelope(envelope, bobChannelToAlice.id);
    };
    bobChannelToCharlie.onReceive = async (data: Uint8Array) => {
      const envelope = MeshRouter.deserializeEnvelope(data);
      await bobRouter.ingestEnvelope(envelope, bobChannelToCharlie.id);
    };
    charlieChannelToBob.onReceive = async (data: Uint8Array) => {
      const envelope = MeshRouter.deserializeEnvelope(data);
      await charlieRouter.ingestEnvelope(envelope, charlieChannelToBob.id);
    };
  });

  it('successfully relays an encrypted message across Alice -> Bob -> Charlie without direct Alice-Charlie link', async () => {
    const receivedMessagesAtCharlie: MeshEnvelope[] = [];
    charlieRouter.onMessage((envelope) => {
      receivedMessagesAtCharlie.push(envelope);
    });

    const secretPayload = new TextEncoder().encode(JSON.stringify({
      text: 'Hello Charlie from Alice through offline Bob relay!',
      secretFlag: 42,
    }));

    // Alice sends an envelope targeted strictly to Charlie
    const sentEnvelope = await aliceRouter.send({
      targetDid: charlieDid,
      envelopeType: 'ENCRYPTED_MESSAGE',
      payloadBytes: secretPayload,
    });

    expect(sentEnvelope.originDid).toBe(aliceDid);
    expect(sentEnvelope.targetDid).toBe(charlieDid);
    expect(sentEnvelope.hopCount).toBe(0);
    expect(sentEnvelope.route).toEqual([aliceDid]);

    // Charlie must have received the relayed envelope
    expect(receivedMessagesAtCharlie.length).toBe(1);
    const delivered = receivedMessagesAtCharlie[0];
    expect(delivered.originDid).toBe(aliceDid);
    expect(delivered.targetDid).toBe(charlieDid);
    expect(delivered.hopCount).toBe(1); // Relayed through Bob: hopCount incremented to 1
    expect(delivered.route).toContain(bobDid); // Bob is recorded in route

    // Verify payload was completely uncorrupted
    const decoded = JSON.parse(new TextDecoder().decode(delivered.payloadBytes));
    expect(decoded.text).toBe('Hello Charlie from Alice through offline Bob relay!');
    expect(decoded.secretFlag).toBe(42);

    // Verify cryptographic signature of the original author Alice is valid
    expect(MeshRouter.verifyEnvelope(delivered)).toBe(true);
  });

  it('routes signed cryptographic delivery receipt back from Charlie -> Bob -> Alice', async () => {
    const receiptsReceivedAtAlice: DeliveryReceipt[] = [];
    aliceRouter.onDeliveryReceipt((receipt) => {
      receiptsReceivedAtAlice.push(receipt);
    });

    const messagePayload = new TextEncoder().encode('Receipt test message');
    const sentEnvelope = await aliceRouter.send({
      targetDid: charlieDid,
      envelopeType: 'ENCRYPTED_MESSAGE',
      payloadBytes: messagePayload,
    });

    // Alice must receive a cryptographically verified delivery receipt from Charlie
    expect(receiptsReceivedAtAlice.length).toBe(1);
    const receipt = receiptsReceivedAtAlice[0];

    expect(receipt.targetEnvelopeId).toBe(sentEnvelope.envelopeId);
    expect(receipt.recipientDid).toBe(charlieDid);

    // Cryptographically verify Charlie's signature on the receipt
    const charliePubkey = decodeEd25519DidKey(charlieDid);
    const isReceiptValid = verifyEd25519(
      charliePubkey,
      hexToBytes(receipt.targetEnvelopeId),
      hexToBytes(receipt.signatureHex),
    );
    expect(isReceiptValid).toBe(true);
  });

  it('strictly suppresses routing loops when an envelope returns to an already-visited peer', async () => {
    const payload = new TextEncoder().encode('Loop test');
    const envelope = aliceRouter.createEnvelope({
      targetDid: charlieDid,
      envelopeType: 'ENCRYPTED_MESSAGE',
      payloadBytes: payload,
    });

    // Bob ingests from Alice
    const firstIngest = await bobRouter.ingestEnvelope(envelope, bobChannelToAlice.id);
    expect(firstIngest).toBe(true);

    // Second ingest of same envelope at Bob must be suppressed as duplicate
    const duplicateIngest = await bobRouter.ingestEnvelope(envelope, bobChannelToAlice.id);
    expect(duplicateIngest).toBe(false);

    // An envelope whose route already contains Bob must also be rejected by Bob
    const loopingEnvelope: MeshEnvelope = {
      ...envelope,
      envelopeId: 'different-fake-id-to-bypass-lru',
      route: [aliceDid, bobDid, 'some-node-did'],
    };
    const loopIngest = await bobRouter.ingestEnvelope(loopingEnvelope, bobChannelToCharlie.id);
    expect(loopIngest).toBe(false);
  });

  it('enforces maximum hop limits and drops packets that exceed maxHops', async () => {
    const payload = new TextEncoder().encode('Hop count exceeded test');
    const envelope = aliceRouter.createEnvelope({
      targetDid: charlieDid,
      envelopeType: 'ENCRYPTED_MESSAGE',
      payloadBytes: payload,
      maxHops: 2,
    });

    // Simulate envelope that has already traversed 3 hops (exceeds maxHops of 2)
    const exhaustedEnvelope: MeshEnvelope = {
      ...envelope,
      hopCount: 3,
      maxHops: 2,
    };

    const ingested = await bobRouter.ingestEnvelope(exhaustedEnvelope, bobChannelToAlice.id);
    expect(ingested).toBe(false);
  });

  it('enforces TTL expiration and rejects expired envelopes', async () => {
    const payload = new TextEncoder().encode('Expired test');
    const envelope = aliceRouter.createEnvelope({
      targetDid: charlieDid,
      envelopeType: 'ENCRYPTED_MESSAGE',
      payloadBytes: payload,
      ttlMs: 10,
    });

    // Fast forward or create an envelope with expired timestamp
    const expiredEnvelope: MeshEnvelope = {
      ...envelope,
      expiresAt: Date.now() - 5000,
    };

    const ingested = await bobRouter.ingestEnvelope(expiredEnvelope, bobChannelToAlice.id);
    expect(ingested).toBe(false);
  });
});
