/**
 * @file apps/sovra-app/src/hooks/useE2EEMessenger.ts
 * Client Hook: Signal-Grade E2EE Messenger with 3-Phase Delivery Ticks & Voice Notes.
 *
 * Implements:
 * 1. Double Ratchet (X3DH) forward secrecy session.
 * 2. Real-time delivery ticks (Single ✓, Double ✓✓, Blue ✓✓) via GossipAckVerifier.
 * 3. Voice notes recording with normalized waveform visualizer amplitude bars.
 * 4. Disappearing messages timer (24h, 7d, off) with cryptographic memory purge.
 * 5. Signal-grade 60-digit safety numbers.
 */

import {
  DoubleRatchetChatEngine,
  GossipAckVerifier,
  type ChatMessage,
  type VoiceNoteMetadata,
  type SafetyNumbers,
} from '@sovra/messaging';

export interface UseE2EEMessengerReturn {
  readonly localDid: string;
  readonly peerDid: string;
  readonly messages: readonly ChatMessage[];
  readonly safetyNumbers: SafetyNumbers;
  readonly disappearingTimerSec: number;
  sendText(text: string): ChatMessage;
  sendVoice(durationSec: number, waveformBars: number[]): ChatMessage;
  receiveIncoming(text: string, senderName: string, isAudio?: boolean, audioMetadata?: VoiceNoteMetadata): ChatMessage;
  markDelivered(messageId: string): boolean;
  markRead(messageId: string): boolean;
  setDisappearingTimer(durationSec: number): void;
  purgeExpired(): string[];
}

export function createE2EEMessengerSession(
  localDid: string,
  peerDid: string,
): UseE2EEMessengerReturn {
  const engine = new DoubleRatchetChatEngine(localDid);

  return {
    get localDid() {
      return localDid;
    },
    get peerDid() {
      return peerDid;
    },
    get messages() {
      return engine.getMessages(peerDid);
    },
    get safetyNumbers() {
      return engine.getSafetyNumbers(peerDid);
    },
    get disappearingTimerSec() {
      return engine.getDisappearingTimer(peerDid);
    },
    sendText(text: string) {
      return engine.sendTextMessage(peerDid, text);
    },
    sendVoice(durationSec: number, waveformBars: number[]) {
      return engine.sendVoiceNote(peerDid, durationSec, waveformBars);
    },
    receiveIncoming(text: string, senderName: string, isAudio = false, audioMetadata?: VoiceNoteMetadata) {
      return engine.receiveIncomingMessage(peerDid, text, senderName, isAudio, audioMetadata);
    },
    markDelivered(messageId: string) {
      const ack = GossipAckVerifier.createSignedAck(messageId, peerDid, localDid, 'delivered');
      if (GossipAckVerifier.verifyAck(ack)) {
        return engine.updateDeliveryReceipt(peerDid, messageId, 'delivered');
      }
      return false;
    },
    markRead(messageId: string) {
      const ack = GossipAckVerifier.createSignedAck(messageId, peerDid, localDid, 'read');
      if (GossipAckVerifier.verifyAck(ack)) {
        return engine.updateDeliveryReceipt(peerDid, messageId, 'read');
      }
      return false;
    },
    setDisappearingTimer(durationSec: number) {
      engine.setDisappearingTimer(peerDid, durationSec);
    },
    purgeExpired() {
      return engine.purgeExpiredMessages(peerDid);
    },
  };
}
