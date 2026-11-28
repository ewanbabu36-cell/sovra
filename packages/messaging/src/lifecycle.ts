import { bytesToHex, hexToBytes, sha256, signEd25519, verifyEd25519 } from '@sovra/crypto';
import { Result, err, ok } from '@sovra/shared';

export type SovraMsgLifecycleState =
  | 'CREATED'
  | 'ENCRYPTED'
  | 'PUBLISHED'
  | 'DELIVERED'
  | 'ACKNOWLEDGED'
  | 'READ'
  | 'FAILED'
  | 'EXPIRED';

export interface EncryptedAttachmentRef {
  readonly attachmentCid: string;
  readonly nonceHex: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
}

export interface TrackedMessageEnvelope {
  readonly messageId: string;
  readonly senderIdentityId: string;
  readonly recipientIdentityId: string;
  state: SovraMsgLifecycleState;
  readonly createdAt: number;
  expiresAt?: number | undefined;
  encryptedAt?: number | undefined;
  publishedAt?: number | undefined;
  relayAcceptedAt?: number | undefined; // Explicit distinction from recipient delivery
  deliveredAt?: number | undefined;
  acknowledgedAt?: number | undefined;
  acknowledgementSignatureHex?: string | undefined;
  readAt?: number | undefined;
  attachments: readonly EncryptedAttachmentRef[];
}

const VALID_TRANSITIONS: Record<SovraMsgLifecycleState, ReadonlySet<SovraMsgLifecycleState>> = {
  CREATED: new Set(['ENCRYPTED', 'FAILED', 'EXPIRED']),
  ENCRYPTED: new Set(['PUBLISHED', 'FAILED', 'EXPIRED']),
  PUBLISHED: new Set(['DELIVERED', 'FAILED', 'EXPIRED']),
  DELIVERED: new Set(['ACKNOWLEDGED', 'EXPIRED']),
  ACKNOWLEDGED: new Set(['READ', 'EXPIRED']),
  READ: new Set(['EXPIRED']),
  FAILED: new Set(['CREATED', 'ENCRYPTED', 'EXPIRED']),
  EXPIRED: new Set([]),
};

const textEncoder = new TextEncoder();

/**
 * Enforces Section 10 (RFC SOVRA-MSG v1.0) delivery semantics:
 * CREATED -> ENCRYPTED -> PUBLISHED -> DELIVERED -> ACKNOWLEDGED (-> optional READ).
 * Explicitly guarantees relay acceptance (PUBLISHED) is NEVER treated as recipient delivery.
 */
export class MessageLifecycleTracker {
  private readonly records = new Map<string, TrackedMessageEnvelope>();

  public create(params: {
    messageId: string;
    senderIdentityId: string;
    recipientIdentityId: string;
    expiresAt?: number | undefined;
    attachments?: readonly EncryptedAttachmentRef[] | undefined;
  }): TrackedMessageEnvelope {
    const rec: TrackedMessageEnvelope = {
      messageId: params.messageId,
      senderIdentityId: params.senderIdentityId,
      recipientIdentityId: params.recipientIdentityId,
      state: 'CREATED',
      createdAt: Math.floor(Date.now() / 1000),
      expiresAt: params.expiresAt,
      attachments: params.attachments ?? [],
    };
    this.records.set(rec.messageId, rec);
    return rec;
  }

  public transition(
    messageId: string,
    next: SovraMsgLifecycleState,
    meta: { relayAcceptedAt?: number | undefined; ackSigHex?: string | undefined; recipientPubKey?: Uint8Array | undefined } = {},
  ): Result<TrackedMessageEnvelope, Error> {
    const rec = this.records.get(messageId);
    if (!rec) return err(new Error(`Unknown message '${messageId}'`));

    const now = Math.floor(Date.now() / 1000);
    if (rec.expiresAt && now > rec.expiresAt && next !== 'EXPIRED') {
      rec.state = 'EXPIRED';
      return err(new Error(`Message '${messageId}' expired at ${rec.expiresAt}`));
    }
    if (!VALID_TRANSITIONS[rec.state].has(next)) {
      return err(new Error(`Illegal message transition ${rec.state} -> ${next}`));
    }

    if (next === 'ACKNOWLEDGED') {
      if (!meta.ackSigHex || !meta.recipientPubKey) {
        return err(new Error('ACKNOWLEDGED transition requires recipient Ed25519 delivery receipt signature'));
      }
      const digest = sha256(textEncoder.encode(`SOVRA-MSG-ACK-v1:${rec.messageId}:${rec.recipientIdentityId}`));
      if (!verifyEd25519(meta.recipientPubKey, digest, hexToBytes(meta.ackSigHex))) {
        return err(new Error('Invalid recipient acknowledgement signature'));
      }
      rec.acknowledgedAt = now;
      rec.acknowledgementSignatureHex = meta.ackSigHex;
    }

    if (next === 'ENCRYPTED') rec.encryptedAt = now;
    if (next === 'PUBLISHED') {
      rec.publishedAt = now;
      rec.relayAcceptedAt = meta.relayAcceptedAt ?? now;
    }
    if (next === 'DELIVERED') rec.deliveredAt = now;
    if (next === 'READ') rec.readAt = now;

    rec.state = next;
    return ok(rec);
  }

  public static signDeliveryAcknowledgement(
    messageId: string,
    recipientIdentityId: string,
    recipientSigningPrivateKey: Uint8Array,
  ): string {
    const digest = sha256(textEncoder.encode(`SOVRA-MSG-ACK-v1:${messageId}:${recipientIdentityId}`));
    return bytesToHex(signEd25519(recipientSigningPrivateKey, digest));
  }

  public purgeExpired(nowSec = Math.floor(Date.now() / 1000)): string[] {
    const expiredIds: string[] = [];
    for (const [id, rec] of this.records.entries()) {
      if (rec.expiresAt && nowSec > rec.expiresAt) {
        rec.state = 'EXPIRED';
        this.records.delete(id);
        expiredIds.push(id);
      }
    }
    return expiredIds;
  }

  public get(messageId: string): TrackedMessageEnvelope | undefined {
    return this.records.get(messageId);
  }
}
