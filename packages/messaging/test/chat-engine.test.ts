import { describe, it, expect } from 'vitest';
import {
  DoubleRatchetChatEngine,
  computeSafetyNumbers,
  GossipAckVerifier,
  TreeKemGroupEngine,
} from '../src/chat-engine.js';

describe('DoubleRatchetChatEngine', () => {
  const aliceDid = 'did:sovra:alice123';
  const bobDid = 'did:sovra:bob456';

  it('initializes ratchet session with root and symmetric chain keys', () => {
    const engine = new DoubleRatchetChatEngine(aliceDid);
    const session = engine.getOrCreateRatchetSession(bobDid);

    expect(session.rootKeyHex).toBeDefined();
    expect(session.senderChainKeyHex).toBeDefined();
    expect(session.receiverChainKeyHex).toBeDefined();
    expect(session.senderMessageNumber).toBe(0);
  });

  it('advances symmetric ratchet chain with each dispatched message', () => {
    const engine = new DoubleRatchetChatEngine(aliceDid);
    const step1 = engine.advanceSenderRatchet(bobDid);
    const step2 = engine.advanceSenderRatchet(bobDid);

    expect(step1.nextSequence).toBe(1);
    expect(step2.nextSequence).toBe(2);
    expect(step1.messageKeyHex).not.toBe(step2.messageKeyHex);
  });

  it('sends text message with initial state "sent" (single grey check)', () => {
    const engine = new DoubleRatchetChatEngine(aliceDid);
    const msg = engine.sendTextMessage(bobDid, 'Hello Bob! Sovereign E2EE chat.');

    expect(msg.senderDid).toBe(aliceDid);
    expect(msg.recipientDid).toBe(bobDid);
    expect(msg.state).toBe('sent');
    expect(msg.isAudio).toBe(false);
    expect(msg.sentAt).toBeDefined();

    const history = engine.getMessages(bobDid);
    expect(history.length).toBe(1);
    expect(history[0]?.id).toBe(msg.id);
  });

  it('supports voice note message with audio duration and waveform amplitude bars', () => {
    const engine = new DoubleRatchetChatEngine(aliceDid);
    const waveform = [10, 45, 90, 75, 30, 85, 60, 40, 100, 20];
    const voiceMsg = engine.sendVoiceNote(bobDid, 5.4, waveform);

    expect(voiceMsg.isAudio).toBe(true);
    expect(voiceMsg.audioMetadata?.durationSec).toBe(5.4);
    expect(voiceMsg.audioMetadata?.waveformBars).toEqual(waveform);
    expect(voiceMsg.state).toBe('sent');
  });

  it('updates delivery receipt monotonically from sent -> delivered -> read', () => {
    const engine = new DoubleRatchetChatEngine(aliceDid);
    const msg = engine.sendTextMessage(bobDid, 'Verifying tick lifecycle');

    expect(msg.state).toBe('sent');

    // Peer device received message -> delivered (double grey tick)
    const delRes = engine.updateDeliveryReceipt(bobDid, msg.id, 'delivered');
    expect(delRes).toBe(true);
    expect(msg.state).toBe('delivered');
    expect(msg.deliveredAt).toBeDefined();

    // Peer opened chat screen -> read (double blue tick)
    const readRes = engine.updateDeliveryReceipt(bobDid, msg.id, 'read');
    expect(readRes).toBe(true);
    expect(msg.state).toBe('read');
    expect(msg.readAt).toBeDefined();

    // Cannot regress back to 'sent'
    const invalidRegress = engine.updateDeliveryReceipt(bobDid, msg.id, 'sent');
    expect(invalidRegress).toBe(false);
    expect(msg.state).toBe('read');
  });

  it('marks all incoming unread messages as read', () => {
    const engine = new DoubleRatchetChatEngine(aliceDid);
    engine.receiveIncomingMessage(bobDid, 'Hey Alice!', 'Bob');
    engine.receiveIncomingMessage(bobDid, 'Are you there?', 'Bob');

    const msgs = engine.getMessages(bobDid);
    expect(msgs.length).toBe(2);
    expect(msgs[0]?.state).toBe('delivered');
    expect(msgs[1]?.state).toBe('delivered');

    const markedCount = engine.markConversationAsRead(bobDid);
    expect(markedCount).toBe(2);
    expect(msgs[0]?.state).toBe('read');
    expect(msgs[1]?.state).toBe('read');
  });

  it('supports disappearing messages with expiration timers and automated purge', () => {
    const engine = new DoubleRatchetChatEngine(aliceDid);
    // Enable 5 second disappearing timer
    engine.setDisappearingTimer(bobDid, 5);
    expect(engine.getDisappearingTimer(bobDid)).toBe(5);

    const msg = engine.sendTextMessage(bobDid, 'Top secret ephemeral message');
    expect(msg.disappearingDurationSec).toBe(5);
    expect(msg.expiresAt).toBeDefined();
    expect(msg.expiresAt!).toBeGreaterThan(Date.now());

    // Before expiry: message not purged
    const purgedEarly = engine.purgeExpiredMessages(bobDid, Date.now());
    expect(purgedEarly.length).toBe(0);
    expect(msg.isDisappeared).toBeFalsy();

    // After simulated 6 seconds: message is purged
    const futureTime = Date.now() + 6000;
    const purgedLate = engine.purgeExpiredMessages(bobDid, futureTime);
    expect(purgedLate).toContain(msg.id);
    expect(msg.isDisappeared).toBe(true);
    expect(msg.text).toBe('💨 This message has disappeared');

    // Disable timer
    engine.setDisappearingTimer(bobDid, 0);
    expect(engine.getDisappearingTimer(bobDid)).toBe(0);
    const regularMsg = engine.sendTextMessage(bobDid, 'Permanent message');
    expect(regularMsg.disappearingDurationSec).toBeUndefined();
  });

  it('computes 60-digit safety numbers formatted in 12 blocks of 5 digits', () => {
    const engine = new DoubleRatchetChatEngine(aliceDid);
    const numbers = engine.getSafetyNumbers(bobDid);

    expect(numbers.formattedNumbers).toBeDefined();
    const blocks = numbers.formattedNumbers.split(' ');
    expect(blocks.length).toBe(12);
    for (const b of blocks) {
      expect(b.length).toBe(5);
      expect(/^\d{5}$/.test(b)).toBe(true);
    }

    // Both parties compute identical safety numbers irrespective of who called
    const engineBob = new DoubleRatchetChatEngine(bobDid);
    const sessionAlice = engine.getOrCreateRatchetSession(bobDid);
    // Shared root key
    const numbersBob = computeSafetyNumbers(bobDid, aliceDid, sessionAlice.rootKeyHex);
    expect(numbersBob.formattedNumbers).toBe(numbers.formattedNumbers);
    expect(numbersBob.qrPayload).toBe(numbers.qrPayload);
  });

  it('handles emoji reactions on messages', () => {
    const engine = new DoubleRatchetChatEngine(aliceDid);
    const msg = engine.sendTextMessage(bobDid, 'Check this new P2P spec');

    // Bob reacts with ❤️
    const added = engine.addReaction(bobDid, msg.id, '❤️', bobDid);
    expect(added).toBe(true);
    expect(msg.reactions?.length).toBe(1);
    expect(msg.reactions?.[0]?.emoji).toBe('❤️');

    // Bob changes reaction to 👍
    engine.addReaction(bobDid, msg.id, '👍', bobDid);
    expect(msg.reactions?.length).toBe(1);
    expect(msg.reactions?.[0]?.emoji).toBe('👍');

    // Bob removes reaction
    const removed = engine.removeReaction(bobDid, msg.id, bobDid);
    expect(removed).toBe(true);
    expect(msg.reactions?.length).toBe(0);
  });

  it('GossipAckVerifier verifies signed Delivery and Read ACKs over P2P mesh', () => {
    const msgId = 'msg-verif-123';
    const ack = GossipAckVerifier.createSignedAck(msgId, aliceDid, bobDid, 'delivered');

    expect(ack.payload.messageId).toBe(msgId);
    expect(ack.payload.ackType).toBe('delivered');
    expect(GossipAckVerifier.verifyAck(ack)).toBe(true);

    // Tampered ACK fails verification
    const tampered = {
      ...ack,
      payload: { ...ack.payload, ackType: 'read' as const },
    };
    expect(GossipAckVerifier.verifyAck(tampered)).toBe(false);
  });

  it('TreeKemGroupEngine implements MLS binary ratchet tree for group chats with O(log N) forward secrecy', () => {
    const groupEngine = new TreeKemGroupEngine('group:sovra:architects', aliceDid);
    const initialEpoch = groupEngine.getEpochState();

    expect(initialEpoch.epochNumber).toBe(1);
    expect(initialEpoch.membersCount).toBe(1);

    // Add Bob to group
    const epoch2 = groupEngine.addMember(bobDid);
    expect(epoch2.epochNumber).toBe(2);
    expect(epoch2.membersCount).toBe(2);
    expect(epoch2.epochSecretHex).not.toBe(initialEpoch.epochSecretHex);

    // Add Carol to group
    const carolDid = 'did:sovra:carol789';
    const epoch3 = groupEngine.addMember(carolDid);
    expect(epoch3.epochNumber).toBe(3);
    expect(epoch3.membersCount).toBe(3);

    // Remove Bob from group (post-compromise eviction)
    const epoch4 = groupEngine.removeMember(bobDid);
    expect(epoch4.epochNumber).toBe(4);
    expect(epoch4.membersCount).toBe(2);
    expect(groupEngine.memberDids).not.toContain(bobDid);
  });
});

