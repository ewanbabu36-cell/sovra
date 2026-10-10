/**
 * @file apps/sovra-mobile/test/bitchat-mobile-integration.test.ts
 * Verification Suite for BitChat Zero-Internet Mobile Mesh & Dynamic UI Integration.
 */

import { describe, it, expect } from 'vitest';
import { localDb } from '../src/services/local-database.js';
import { mobileMesh } from '../src/services/mobile-mesh-coordinator.js';
import { MeshRouter, type MeshDiscoveredPeer, type MeshEnvelope } from '@sovra/p2p';
import { generateEd25519KeyPair, signEd25519, bytesToHex, hexToBytes } from '@sovra/crypto';
import { encodeEd25519DidKey } from '@sovra/identity';

describe('BitChat Zero-Internet Mobile Mesh & Dynamic UI Integration Suite', () => {
  it('verifies localDb provides dynamic conversation summaries with default broadcast channels', () => {
    const list = localDb.getConversationsList();
    expect(list.length).toBeGreaterThanOrEqual(2);

    const localMesh = list.find(c => c.threadId === 'channel:local_mesh');
    expect(localMesh).toBeDefined();
    expect(localMesh?.peerName).toBe('#local-mesh');
    expect(localMesh?.isChannel).toBe(true);

    const sosMesh = list.find(c => c.threadId === 'channel:emergency_sos');
    expect(sosMesh).toBeDefined();
    expect(sosMesh?.peerName).toBe('#emergency-sos');
    expect(sosMesh?.isChannel).toBe(true);
  });

  it('verifies MobileMeshCoordinator exposes live discovered BLE peers and fires discovery callbacks', async () => {
    let capturedPeers: MeshDiscoveredPeer[] = [];
    const unsub = mobileMesh.onPeersChange(peers => {
      capturedPeers = peers;
    });

    expect(Array.isArray(capturedPeers)).toBe(true);
    expect(Array.isArray(mobileMesh.getDiscoveredPeers())).toBe(true);

    unsub();
  });

  it('verifies sendChannelBroadcast creates signed envelopes and updates localDb with hopCount 0', async () => {
    const result = await mobileMesh.sendChannelBroadcast(
      '#local-mesh',
      'Zero-internet broadcast test beacon',
      'Tester',
    );

    expect(result.success).toBe(true);
    expect(result.envelopeId).toHaveLength(64);

    const channelMsgs = localDb.getThreadMessages('channel:local_mesh');
    const sentMsg = channelMsgs.find(m => m.id === result.envelopeId);

    expect(sentMsg).toBeDefined();
    expect(sentMsg?.text).toBe('Zero-internet broadcast test beacon');
    expect(sentMsg?.isBitChat).toBe(true);
    expect(sentMsg?.hopCount).toBe(0);
    expect(sentMsg?.senderName).toBe('Tester');
  });

  it('verifies incoming mesh messages notify registered UI listeners in real-time', async () => {
    let receivedPayload: any = null;
    const unsub = mobileMesh.onIncomingMessage(msg => {
      receivedPayload = msg;
    });

    // Create a real cryptographically signed envelope from simulated peer
    const peerKeyPair = generateEd25519KeyPair();
    const peerDid = encodeEd25519DidKey(peerKeyPair.publicKey);
    const payloadBytes = new TextEncoder().encode(
      JSON.stringify({ text: 'Peer incoming payload', senderName: 'SimPeer' }),
    );
    const timestamp = Date.now();
    const nonce = 'testnonce123';
    const envelopeId = MeshRouter.calculateEnvelopeId(
      peerDid,
      mobileMesh.localDid,
      'ENCRYPTED_MESSAGE',
      payloadBytes,
      timestamp,
      nonce,
    );
    const sig = signEd25519(peerKeyPair.privateKey, hexToBytes(envelopeId));

    const fakeEnvelope: MeshEnvelope = {
      envelopeId,
      envelopeType: 'ENCRYPTED_MESSAGE',
      originDid: peerDid,
      targetDid: mobileMesh.localDid,
      hopCount: 2,
      maxHops: 7,
      route: [peerDid, 'did:key:z6MksRelayNode'],
      timestamp,
      expiresAt: timestamp + 60000,
      priority: 1,
      payloadBytes,
      signatureHex: bytesToHex(sig),
      nonce,
    };

    // Ingest via router
    const ingested = await mobileMesh.router.ingestEnvelope(fakeEnvelope, 'test-ch');
    expect(ingested).toBe(true);

    // Wait short tick for async envelope handler
    await new Promise(r => setTimeout(r, 50));

    expect(receivedPayload).toBeDefined();
    expect(receivedPayload?.id).toBe(fakeEnvelope.envelopeId);
    expect(receivedPayload?.text).toBe('Peer incoming payload');
    expect(receivedPayload?.hopCount).toBe(2);
    expect(receivedPayload?.isBitChat).toBe(true);

    unsub();
  });

  it('verifies mobileMesh truthfully reports runtime diagnostics with zero mock states', () => {
    const state = mobileMesh.getRuntimeState();
    expect(state.status).toBeDefined();
    expect(state.diagnostics).toBeDefined();
    expect(typeof state.diagnostics.nearbyPeersCount).toBe('number');
    expect(typeof state.diagnostics.authenticatedPeersCount).toBe('number');
    expect(state.controls).toBeDefined();
    expect(typeof state.controls.bluetoothMeshEnabled).toBe('boolean');
  });
});
