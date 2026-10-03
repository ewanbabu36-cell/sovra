import { Result } from '@sovra/shared';

/**
 * Storage Privacy Classification:
 *
 * 1. PUBLIC CONTENT:
 *    - Public videos, thumbnails, avatars, post image attachments.
 *    - Distributed across IPFS / Bitswap / Public Gateways.
 *    - Content-addressed via deterministic CIDs.
 *
 * 2. PRIVATE ENCRYPTED DATA:
 *    - Chat messages, private attachments, direct messages.
 *    - STRICTLY PROHIBITED from public IPFS / public DHT storage.
 *    - Transferred end-to-end encrypted or buffered via ephemeral encrypted relays.
 */

export interface ContentId {
  readonly version: 1;
  readonly codec: 'raw' | 'dag-pb' | 'dag-cbor';
  readonly multihash: string;
  toString(): string;
}

export interface PublicMediaAsset {
  readonly cid: ContentId;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly sha256Digest: string;
}

export interface EncryptedPrivatePayload {
  readonly blobId: string;
  readonly encryptedBytes: Uint8Array;
  readonly nonce: Uint8Array;
  readonly mac: Uint8Array;
  readonly recipientDid: string;
  readonly expiresAt: number;
}

export interface PublicStorageService {
  publishMedia(data: Uint8Array, mimeType: string): Promise<Result<PublicMediaAsset>>;
  retrieveMedia(cid: ContentId): Promise<Result<Uint8Array>>;
  pinContent(cid: ContentId): Promise<Result<void>>;
  unpinContent(cid: ContentId): Promise<Result<void>>;
  verifyIntegrity(cid: ContentId, data: Uint8Array): Promise<Result<boolean>>;
}

export interface PrivateStorageService {
  storeEncryptedBlob(payload: EncryptedPrivatePayload): Promise<Result<{ blobId: string }>>;
  retrieveEncryptedBlob(
    blobId: string,
    recipientDid: string,
  ): Promise<Result<EncryptedPrivatePayload>>;
  deleteEncryptedBlob(blobId: string): Promise<Result<void>>;
}

export interface PinningStatus {
  readonly cid: ContentId;
  readonly isPinned: boolean;
  readonly replicaCount: number;
  readonly lastVerifiedAt: number;
}
