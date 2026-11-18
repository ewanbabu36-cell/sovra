/**
 * @file packages/p2p/test/signaling.test.ts
 * End-to-End Cryptographic Tests for Decentralized P2P WebRTC Signaling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateEd25519KeyPair,
  signEd25519,
  generateX25519KeyPair,
  bytesToHex,
  encodeBase58Btc,
} from '@sovra/crypto';
import { P2PSignalingChannel, SignalPayload, DecryptedSignal } from '../src/signaling.js';

// Helper to construct canonical did:key:z6Mku... from ed25519 public key
function makeEd25519Did(pubKey: Uint8Array): string {
  const multicodec = new Uint8Array(34);
  multicodec[0] = 0xed;
  multicodec[1] = 0x01;
  multicodec.set(pubKey, 2);
  return `did:key:z${encodeBase58Btc(multicodec)}`;
}

// Mock SovraP2PNode with in-memory PubSub
class MockP2PNode {
  public readonly subscriptions = new Map<string, Set<(msg: { topic: string; data: Uint8Array }) => void>>();
  public lastPublishedData?: Uint8Array;

  public pubsub = {
    subscribe: async (topic: string, handler?: (msg: { topic: string; data: Uint8Array }) => void) => {
      if (!this.subscriptions.has(topic)) {
        this.subscriptions.set(topic, new Set());
      }
      if (handler) {
        this.subscriptions.get(topic)!.add(handler);
      }
      return { ok: true, value: undefined };
    },
    unsubscribe: async (topic: string) => {
      this.subscriptions.delete(topic);
      return { ok: true, value: undefined };
    },
    publish: async (topic: string, data: Uint8Array) => {
      this.lastPublishedData = data;
      const handlers = this.subscriptions.get(topic);
      if (handlers) {
        for (const handler of handlers) {
          handler({ topic, data });
        }
      }
      return { ok: true, value: undefined };
    },
  };
}

describe('Decentralized P2P WebRTC Signaling over Libp2p GossipSub', () => {
  let mockNode: MockP2PNode;
  let aliceEd: ReturnType<typeof generateEd25519KeyPair>;
  let aliceX: ReturnType<typeof generateX25519KeyPair>;
  let aliceDid: string;
  let aliceChannel: P2PSignalingChannel;

  let bobEd: ReturnType<typeof generateEd25519KeyPair>;
  let bobX: ReturnType<typeof generateX25519KeyPair>;
  let bobDid: string;
  let bobChannel: P2PSignalingChannel;

  beforeEach(async () => {
    mockNode = new MockP2PNode();

    aliceEd = generateEd25519KeyPair();
    aliceX = generateX25519KeyPair();
    aliceDid = makeEd25519Did(aliceEd.publicKey);

    bobEd = generateEd25519KeyPair();
    bobX = generateX25519KeyPair();
    bobDid = makeEd25519Did(bobEd.publicKey);

    aliceChannel = new P2PSignalingChannel(mockNode as any, {
      myDid: aliceDid,
      signEd25519Fn: (msg) => signEd25519(aliceEd.privateKey, msg),
      myX25519PrivateKey: aliceX.privateKey,
    });

    bobChannel = new P2PSignalingChannel(mockNode as any, {
      myDid: bobDid,
      signEd25519Fn: (msg) => signEd25519(bobEd.privateKey, msg),
      myX25519PrivateKey: bobX.privateKey,
    });

    await aliceChannel.start();
    await bobChannel.start();
  });

  it('subscribes both peers to their respective decentralized DID signal topics', () => {
    expect(aliceChannel.isSubscribed).toBe(true);
    expect(bobChannel.isSubscribed).toBe(true);
    expect(mockNode.subscriptions.has(`/sovra/v1/signal/${aliceDid}`)).toBe(true);
    expect(mockNode.subscriptions.has(`/sovra/v1/signal/${bobDid}`)).toBe(true);
  });

  it('successfully transmits end-to-end encrypted SDP offer and answer', async () => {
    const receivedSignals: DecryptedSignal[] = [];
    bobChannel.onSignal((sig) => receivedSignals.push(sig));

    const testSdp = 'v=0\r\no=alice 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 5004 UDP/TLS/RTP/SAVPF 111\r\n';
    const bobXHex = bytesToHex(bobX.publicKey);

    // Alice sends SDP offer
    const sendRes = await aliceChannel.sendOffer(
      bobDid,
      bobXHex,
      'call_mesh_99',
      testSdp,
      'voice',
      { callerName: 'Alice' },
    );

    expect(sendRes.ok).toBe(true);
    expect(receivedSignals.length).toBe(1);

    const received = receivedSignals[0]!;
    expect(received.senderDid).toBe(aliceDid);
    expect(received.recipientDid).toBe(bobDid);
    expect(received.payload.type).toBe('offer');
    expect(received.payload.callId).toBe('call_mesh_99');
    expect(received.payload.callType).toBe('voice');
    expect(received.payload.sdp).toBe(testSdp);
    expect(received.payload.metadata?.callerName).toBe('Alice');

    // Bob responds with SDP Answer
    const aliceReceived: DecryptedSignal[] = [];
    aliceChannel.onSignal((sig) => aliceReceived.push(sig));

    const answerSdp = 'v=0\r\no=bob 67890 2 IN IP4 127.0.0.1\r\ns=-\r\n';
    const aliceXHex = bytesToHex(aliceX.publicKey);

    const answerRes = await bobChannel.sendAnswer(
      aliceDid,
      aliceXHex,
      'call_mesh_99',
      answerSdp,
    );

    expect(answerRes.ok).toBe(true);
    expect(aliceReceived.length).toBe(1);
    expect(aliceReceived[0]!.payload.type).toBe('answer');
    expect(aliceReceived[0]!.payload.sdp).toBe(answerSdp);
  });

  it('successfully routes and decrypts ICE candidate trickling over GossipSub', async () => {
    const receivedCandidates: DecryptedSignal[] = [];
    bobChannel.onSignal((sig) => {
      if (sig.payload.type === 'candidate') {
        receivedCandidates.push(sig);
      }
    });

    const candidateData = {
      candidate: 'candidate:1 1 UDP 2130706431 192.168.1.50 54321 typ host',
      sdpMid: 'audio',
      sdpMLineIndex: 0,
    };

    const sendRes = await aliceChannel.sendCandidate(
      bobDid,
      bytesToHex(bobX.publicKey),
      'call_mesh_100',
      candidateData,
    );

    expect(sendRes.ok).toBe(true);
    expect(receivedCandidates.length).toBe(1);
    expect(receivedCandidates[0]!.payload.candidate).toEqual(candidateData);
  });

  it('strictly rejects forged sender signature or tampered ciphertext', async () => {
    // Eve generates keypair and tries to forge a message from Alice to Bob
    const eveEd = generateEd25519KeyPair();
    const forgedCommitment = new Uint8Array(32);
    const forgedSig = signEd25519(eveEd.privateKey, forgedCommitment);

    const maliciousEnvelope = {
      version: 1,
      senderDid: aliceDid, // Claims to be Alice!
      recipientDid: bobDid,
      callId: 'forged_call',
      type: 'offer',
      timestamp: Date.now(),
      nonceHex: bytesToHex(new Uint8Array(12)),
      ephemeralPubKeyHex: bytesToHex(new Uint8Array(32)),
      ciphertextHex: bytesToHex(new Uint8Array(48)),
      signatureHex: bytesToHex(forgedSig),
    };

    const rawBytes = new TextEncoder().encode(JSON.stringify(maliciousEnvelope));
    const result = bobChannel.handleIncomingRawMessage(rawBytes);

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('Cryptographic signature verification failed');
  });

  it('strictly blocks replay attacks with duplicate nonces', async () => {
    let callCount = 0;
    bobChannel.onSignal(() => callCount++);

    await aliceChannel.sendOffer(
      bobDid,
      bytesToHex(bobX.publicKey),
      'call_replay_1',
      'sdp_test_body',
      'video',
    );
    expect(callCount).toBe(1);

    // Grab the exact raw bytes that were published to the topic
    expect(mockNode.lastPublishedData).toBeDefined();
    const rawPublished = mockNode.lastPublishedData!;

    // Replay the exact same packet to Bob a second time
    const replayResult = bobChannel.handleIncomingRawMessage(rawPublished);

    expect(replayResult.ok).toBe(false);
    expect(replayResult.error?.message).toContain('Replay attack detected: duplicate signal nonce');
    // Call count should NOT have incremented
    expect(callCount).toBe(1);
  });

  it('supports mid-call seamless audio/video mode switching', async () => {
    const receivedSignals: DecryptedSignal[] = [];
    bobChannel.onSignal((sig) => receivedSignals.push(sig));

    await aliceChannel.sendSwitchMode(
      bobDid,
      bytesToHex(bobX.publicKey),
      'call_mode_switch_1',
      'video',
    );

    expect(receivedSignals.length).toBe(1);
    expect(receivedSignals[0]!.payload.type).toBe('switch-mode');
    expect(receivedSignals[0]!.payload.mode).toBe('video');
  });
});
