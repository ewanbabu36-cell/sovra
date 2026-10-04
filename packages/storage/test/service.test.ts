import { describe, it, expect } from 'vitest';
import { constantTimeEquals } from '@sovra/crypto';
import {
  SovraStorageService,
  MemoryBlockstore,
  PrivateStoragePolicyViolationError,
  EncryptedPrivatePayload,
} from '../src/index.js';

describe('SovraStorageService Suite (@sovra/storage)', () => {
  it('publishes and retrieves public media asset using Merkle DAG', async () => {
    const service = new SovraStorageService(new MemoryBlockstore());
    const videoData = new Uint8Array(600 * 1024).fill(123); // ~600KB file

    const publishRes = await service.publishMedia(videoData, 'video/mp4');
    expect(publishRes.ok).toBe(true);
    if (!publishRes.ok) return;

    const asset = publishRes.value;
    expect(asset.mimeType).toBe('video/mp4');
    expect(asset.byteLength).toBe(videoData.length);
    expect(asset.cid.toString().startsWith('bafybei')).toBe(true);

    // Retrieve via root CID
    const retrieveRes = await service.retrieveMedia(asset.cid);
    expect(retrieveRes.ok).toBe(true);
    if (!retrieveRes.ok) return;

    expect(retrieveRes.value.length).toBe(videoData.length);
    expect(constantTimeEquals(retrieveRes.value, videoData)).toBe(true);

    // Verify integrity
    const integrityRes = await service.verifyIntegrity(asset.cid, videoData);
    expect(integrityRes.ok).toBe(true);
    expect(integrityRes.value).toBe(true);
  });

  it('rejects publishing empty media data', async () => {
    const service = new SovraStorageService();
    const res = await service.publishMedia(new Uint8Array(0), 'image/jpeg');
    expect(res.ok).toBe(false);
  });

  it('stores and retrieves encrypted private payload with recipient access check', async () => {
    const service = new SovraStorageService();

    const payload: EncryptedPrivatePayload = {
      blobId: 'blob-secure-123',
      encryptedBytes: new Uint8Array([1, 2, 3, 4, 5]),
      nonce: new Uint8Array(12).fill(9),
      mac: new Uint8Array(16).fill(8),
      recipientDid: 'did:key:z6MkrpRecipientAlice',
      expiresAt: Date.now() + 3600000,
    };

    const storeRes = await service.storeEncryptedBlob(payload);
    expect(storeRes.ok).toBe(true);

    // Authorized recipient retrieves
    const getRes = await service.retrieveEncryptedBlob('blob-secure-123', 'did:key:z6MkrpRecipientAlice');
    expect(getRes.ok).toBe(true);
    if (getRes.ok) {
      expect(getRes.value.blobId).toBe('blob-secure-123');
      expect(getRes.value.encryptedBytes).toEqual(payload.encryptedBytes);
    }

    // Unauthorized recipient fails
    const badRes = await service.retrieveEncryptedBlob('blob-secure-123', 'did:key:z6MkrpEveAttacker');
    expect(badRes.ok).toBe(false);
  });

  it('enforces private storage policy: rejects unencrypted/unauthenticated private blobs', async () => {
    const service = new SovraStorageService();

    const badPayload: EncryptedPrivatePayload = {
      blobId: 'blob-bad-1',
      encryptedBytes: new Uint8Array([1, 2, 3]),
      nonce: new Uint8Array(0), // Missing nonce!
      mac: new Uint8Array(0),   // Missing MAC tag!
      recipientDid: 'did:key:z6MkrpAlice',
      expiresAt: Date.now() + 3600000,
    };

    const res = await service.storeEncryptedBlob(badPayload);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBeInstanceOf(PrivateStoragePolicyViolationError);
    }
  });
});
