import { Result, ok, err } from '@sovra/shared';
import { sha256, bytesToHex } from '@sovra/crypto';
import { CID } from './cid.js';
import { UnixFSBuilder, UnixFSReader } from './unixfs.js';
import { Blockstore, MemoryBlockstore } from './blockstore.js';
import {
  ContentId,
  PublicMediaAsset,
  PublicStorageService,
  EncryptedPrivatePayload,
  PrivateStorageService,
} from './types.js';
import {
  StorageError,
  ContentNotFoundError,
  PrivateStoragePolicyViolationError,
  IntegrityVerificationError,
} from './errors.js';

export class SovraStorageService implements PublicStorageService, PrivateStorageService {
  private readonly privateBlobs = new Map<string, EncryptedPrivatePayload>();

  constructor(
    public readonly blockstore: Blockstore = new MemoryBlockstore(),
  ) {}

  // ==========================================================================
  // PUBLIC STORAGE SERVICE (Content-Addressed Merkle DAGs)
  // ==========================================================================

  public async publishMedia(
    data: Uint8Array,
    mimeType: string,
  ): Promise<Result<PublicMediaAsset>> {
    try {
      if (data.length === 0) {
        return err(new StorageError('Cannot publish zero-byte media payload'));
      }

      // 1. Build Merkle DAG with 256KB UnixFS chunking
      const dag = UnixFSBuilder.buildFileDag(data);

      // 2. Persist all blocks into blockstore
      for (const [cidStr, blockBytes] of dag.blocks.entries()) {
        const blockCid = CID.parse(cidStr);
        await this.blockstore.put(blockCid, blockBytes);
      }

      // 3. Pin the root DAG node
      await this.blockstore.pin(dag.rootCid);

      const asset: PublicMediaAsset = {
        cid: dag.rootCid,
        mimeType,
        byteLength: data.length,
        sha256Digest: bytesToHex(sha256(data)),
      };

      return ok(asset);
    } catch (e) {
      return err(e instanceof StorageError ? e : new StorageError(String(e)));
    }
  }

  public async retrieveMedia(cid: ContentId): Promise<Result<Uint8Array>> {
    try {
      const parsedCid = cid instanceof CID ? cid : CID.parse(cid.toString());

      const data = await UnixFSReader.reconstructFile(parsedCid, async c => {
        return this.blockstore.get(c);
      });

      return ok(data);
    } catch (e) {
      if (e instanceof ContentNotFoundError || e instanceof IntegrityVerificationError) {
        return err(e);
      }
      return err(new StorageError(`Failed to retrieve media: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  public async pinContent(cid: ContentId): Promise<Result<void>> {
    try {
      const parsedCid = cid instanceof CID ? cid : CID.parse(cid.toString());
      await this.blockstore.pin(parsedCid);
      return ok(undefined);
    } catch (e) {
      return err(e instanceof StorageError ? e : new StorageError(String(e)));
    }
  }

  public async unpinContent(cid: ContentId): Promise<Result<void>> {
    try {
      const parsedCid = cid instanceof CID ? cid : CID.parse(cid.toString());
      await this.blockstore.unpin(parsedCid);
      return ok(undefined);
    } catch (e) {
      return err(e instanceof StorageError ? e : new StorageError(String(e)));
    }
  }

  public async verifyIntegrity(cid: ContentId, data: Uint8Array): Promise<Result<boolean>> {
    try {
      const parsedCid = cid instanceof CID ? cid : CID.parse(cid.toString());
      const recomputedDag = UnixFSBuilder.buildFileDag(data, {
        hashType: parsedCid.multihashType,
      });

      return ok(recomputedDag.rootCid.equals(parsedCid));
    } catch {
      return ok(false);
    }
  }

  // ==========================================================================
  // PRIVATE STORAGE SERVICE (Strictly Isolated Off-Public-DHT)
  // ==========================================================================

  public async storeEncryptedBlob(
    payload: EncryptedPrivatePayload,
  ): Promise<Result<{ blobId: string }>> {
    try {
      // Security Enforcement: Verify payload has encryption authentication tag & nonce
      if (
        !payload.encryptedBytes ||
        payload.encryptedBytes.length === 0 ||
        !payload.nonce ||
        payload.nonce.length === 0 ||
        !payload.mac ||
        payload.mac.length === 0
      ) {
        return err(
          new PrivateStoragePolicyViolationError(
            'Refusing to store unencrypted or unauthenticated private payload: nonce, ciphertext, and MAC required',
          ),
        );
      }

      if (payload.expiresAt < Date.now()) {
        return err(new StorageError('Cannot store already-expired private blob'));
      }

      this.privateBlobs.set(payload.blobId, payload);
      return ok({ blobId: payload.blobId });
    } catch (e) {
      return err(new StorageError(String(e)));
    }
  }

  public async retrieveEncryptedBlob(
    blobId: string,
    recipientDid: string,
  ): Promise<Result<EncryptedPrivatePayload>> {
    const blob = this.privateBlobs.get(blobId);
    if (!blob) {
      return err(new StorageError(`Encrypted blob '${blobId}' not found`, 'ERR_BLOB_NOT_FOUND'));
    }

    if (blob.expiresAt < Date.now()) {
      this.privateBlobs.delete(blobId);
      return err(new StorageError(`Encrypted blob '${blobId}' has expired`, 'ERR_BLOB_EXPIRED'));
    }

    // Access control validation
    if (blob.recipientDid !== recipientDid) {
      return err(
        new StorageError(
          `Recipient DID '${recipientDid}' unauthorized for blob '${blobId}'`,
          'ERR_UNAUTHORIZED_BLOB_ACCESS',
        ),
      );
    }

    return ok(blob);
  }

  public async deleteEncryptedBlob(blobId: string): Promise<Result<void>> {
    this.privateBlobs.delete(blobId);
    return ok(undefined);
  }
}
