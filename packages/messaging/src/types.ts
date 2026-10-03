import { Result } from '@sovra/shared';
import { KeyAgreementPublicKey, VerificationKey } from '@sovra/crypto';

export type MessageDeliveryState = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface SignedPreKey {
  readonly id: number;
  readonly publicKey: KeyAgreementPublicKey;
  readonly signature: Uint8Array;
}

export interface OneTimePreKey {
  readonly id: number;
  readonly publicKey: KeyAgreementPublicKey;
}

export interface PreKeyBundle {
  readonly identityDid: string;
  readonly identitySigningKey: VerificationKey;
  readonly signedPreKey: SignedPreKey;
  readonly oneTimePreKeys: readonly OneTimePreKey[];
}

export interface RatchetState {
  readonly rootKeyHex: string;
  readonly senderChainKeyHex: string;
  readonly receiverChainKeyHex: string;
  readonly senderMessageNumber: number;
  readonly receiverMessageNumber: number;
  readonly previousChainLength: number;
}

export interface MessagingSession {
  readonly sessionId: string;
  readonly localDid: string;
  readonly remoteDid: string;
  readonly remoteDeviceId: string;
  readonly ratchetState: RatchetState;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface EncryptedMessagePayload {
  readonly messageId: string;
  readonly sessionId: string;
  readonly senderDeviceId: string;
  readonly sequenceNumber: number;
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly mac: Uint8Array;
  readonly sentAt: number;
}

export interface MessageReceipt {
  readonly messageId: string;
  readonly recipientDid: string;
  readonly state: MessageDeliveryState;
  readonly timestamp: number;
  readonly signature: Uint8Array;
}

export interface E2EEMessagingService {
  publishPreKeyBundle(bundle: PreKeyBundle): Promise<Result<void>>;
  fetchPreKeyBundle(peerDid: string): Promise<Result<PreKeyBundle>>;
  initiateSession(peerDid: string, peerBundle: PreKeyBundle): Promise<Result<MessagingSession>>;
  encryptMessage(
    session: MessagingSession,
    plaintext: Uint8Array,
  ): Promise<Result<EncryptedMessagePayload>>;
  decryptMessage(
    session: MessagingSession,
    payload: EncryptedMessagePayload,
  ): Promise<Result<Uint8Array>>;
  sendReceipt(receipt: MessageReceipt): Promise<Result<void>>;
}
