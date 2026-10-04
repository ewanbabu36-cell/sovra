/**
 * @file packages/messaging/test/webrtc-call.test.ts
 * Unit Test Suite for WhatsApp-Style WebRTC Live Audio/Video Calling Mesh.
 */

import { describe, it, expect } from 'vitest';
import { generateEd25519KeyPair } from '@sovra/crypto';
import { SovraIdentityKey } from '@sovra/identity';
import {
  WebRtcCallEngine,
  type CallSignalingMessage,
} from '../src/webrtc-call.js';

describe('WebRTC Live Audio/Video Calling Engine Suite (@sovra/messaging)', () => {
  const aliceKp = generateEd25519KeyPair();
  const aliceIdentity = new SovraIdentityKey(aliceKp.privateKey);

  const bobKp = generateEd25519KeyPair();
  const bobIdentity = new SovraIdentityKey(bobKp.privateKey);

  it('completes a full 1-on-1 WebRTC video call handshake (Offer -> Ringing -> Answer -> Active)', () => {
    const aliceEngine = new WebRtcCallEngine(
      aliceIdentity.did,
      aliceKp.privateKey,
      aliceKp.publicKey,
    );
    const bobEngine = new WebRtcCallEngine(
      bobIdentity.did,
      bobKp.privateKey,
      bobKp.publicKey,
    );

    // 1. Alice creates outgoing video call offer
    const { message: offerMsg, session: aliceInitSession } = aliceEngine.createCallOffer(
      bobIdentity.did,
      'Bob (5G Telecom)',
      'video',
    );
    expect(offerMsg.type).toBe('CALL_OFFER');
    expect(offerMsg.mediaType).toBe('video');
    expect(offerMsg.signatureHex).toBeDefined();
    expect(aliceInitSession.state).toBe('outgoing_ringing');

    // 2. Bob receives incoming offer and verifies Alice's signature
    const bobIncomingRes = bobEngine.handleIncomingOffer(
      offerMsg,
      aliceKp.publicKey,
      'Alice (P2P Architect)',
    );
    expect(bobIncomingRes.ok).toBe(true);
    if (!bobIncomingRes.ok) return;
    expect(bobIncomingRes.value.state).toBe('incoming_ringing');
    expect(bobIncomingRes.value.isIncoming).toBe(true);

    // 3. Bob accepts the call, generating signed answer
    const answerRes = bobEngine.acceptCall();
    expect(answerRes.ok).toBe(true);
    if (!answerRes.ok) return;
    const answerMsg = answerRes.value;
    expect(answerMsg.type).toBe('CALL_ANSWER');
    expect(bobEngine.session?.state).toBe('active');

    // 4. Alice receives answer and verifies Bob's signature
    const aliceActiveRes = aliceEngine.handleCallAnswer(answerMsg, bobKp.publicKey);
    expect(aliceActiveRes.ok).toBe(true);
    if (!aliceActiveRes.ok) return;
    expect(aliceActiveRes.value.state).toBe('active');
    expect(aliceEngine.session?.state).toBe('active');

    // Both parties are now in active 1-on-1 encrypted video call!
  });

  it('verifies Trickle ICE Candidate exchange over P2P mesh', () => {
    const aliceEngine = new WebRtcCallEngine(
      aliceIdentity.did,
      aliceKp.privateKey,
      aliceKp.publicKey,
    );
    const bobEngine = new WebRtcCallEngine(
      bobIdentity.did,
      bobKp.privateKey,
      bobKp.publicKey,
    );

    aliceEngine.createCallOffer(bobIdentity.did, 'Bob', 'audio');

    // Alice emits ICE candidate
    const candidateMsg = aliceEngine.emitIceCandidate({
      candidate: 'candidate:1 1 UDP 2130706431 127.0.0.1 54321 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    });
    expect(candidateMsg.type).toBe('CALL_ICE_CANDIDATE');

    // Bob receives and validates candidate
    const receiveRes = bobEngine.receiveIceCandidate(candidateMsg, aliceKp.publicKey);
    expect(receiveRes.ok).toBe(true);
    expect(bobEngine.getReceivedIceCandidates()).toHaveLength(1);
    expect(bobEngine.getReceivedIceCandidates()[0]?.candidate).toContain('typ host');
  });

  it('rejects forged call offer signatures (anti-tampering defense)', () => {
    const aliceEngine = new WebRtcCallEngine(
      aliceIdentity.did,
      aliceKp.privateKey,
      aliceKp.publicKey,
    );
    const bobEngine = new WebRtcCallEngine(
      bobIdentity.did,
      bobKp.privateKey,
      bobKp.publicKey,
    );

    const { message: offerMsg } = aliceEngine.createCallOffer(bobIdentity.did, 'Bob', 'audio');

    // Attacker tampers with the callee DID in transit
    const tamperedMsg: CallSignalingMessage = {
      ...offerMsg,
      calleeDid: 'did:key:z6MksAttackerMaliciousDid',
    };

    const result = bobEngine.handleIncomingOffer(tamperedMsg, aliceKp.publicKey, 'Alice');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Invalid call offer signature');
    }
  });

  it('manages in-call controls (mute mic, disable camera, speaker, end call)', () => {
    const engine = new WebRtcCallEngine(
      aliceIdentity.did,
      aliceKp.privateKey,
      aliceKp.publicKey,
    );
    engine.createCallOffer(bobIdentity.did, 'Bob', 'video');

    expect(engine.session?.isAudioMuted).toBe(false);
    expect(engine.toggleAudio()).toBe(true);
    expect(engine.session?.isAudioMuted).toBe(true);
    expect(engine.toggleAudio()).toBe(false);

    expect(engine.session?.isVideoMuted).toBe(false);
    expect(engine.toggleVideo()).toBe(true);
    expect(engine.session?.isVideoMuted).toBe(true);

    const hangupMsg = engine.endCall('normal');
    expect(hangupMsg).not.toBeNull();
    expect(hangupMsg?.type).toBe('CALL_HANGUP');
    expect(engine.session?.state).toBe('ended');
  });
});
