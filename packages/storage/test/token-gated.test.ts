import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateEd25519KeyPair,
} from '@sovra/crypto';
import {
  signMicropaymentVoucher,
  calculateSettlementSplit,
  MicropaymentVoucher,
} from '@sovra/protocol';
import { MemoryBlockstore } from '../src/blockstore.js';
import { TokenGatedStorageEngine } from '../src/token-gated.js';

describe('Milestone 4: Creator Economics & Token-Gated Encrypted DAGs', () => {
  let blockstore: MemoryBlockstore;
  let engine: TokenGatedStorageEngine;

  const userKeypair = generateEd25519KeyPair();
  const creatorKeypair = generateEd25519KeyPair();
  const userDid = 'did:sovra:user-alice';
  const creatorDid = 'did:sovra:creator-bob';
  const seederDid = 'did:sovra:node-charlie';

  beforeEach(() => {
    blockstore = new MemoryBlockstore();
    engine = new TokenGatedStorageEngine(blockstore);
  });

  it('calculates dynamic settlement split (95% creator, 5% seeder, 0% platform)', () => {
    const split = calculateSettlementSplit(1000n, 5);
    expect(split.totalAmount).toBe(1000n);
    expect(split.creatorAmount).toBe(950n);
    expect(split.seederAmount).toBe(50n);
    expect(split.platformAmount).toBe(0n);
  });

  it('encrypts content, stores envelope, and unlocks upon valid signed voucher', async () => {
    const secretVideoData = new TextEncoder().encode('Exclusive 4K Creator Video Stream Chunks');

    // 1. Creator encrypts and stores in blockstore
    const { contentCid, envelopeCid, key } = await engine.encryptAndStore(
      secretVideoData,
      creatorDid,
      100n, // minimum required voucher amount: 100 sats/micro-cents
    );

    expect(contentCid).toBeDefined();
    expect(envelopeCid).toBeDefined();

    // 2. User creates signed micropayment voucher
    const voucherWithoutSig: Omit<MicropaymentVoucher, 'signatureHex'> = {
      voucherId: 'vouch-1234',
      channelId: 'chan-alice-bob',
      senderDid: userDid,
      creatorDid,
      seederDid,
      contentCid: contentCid.toString(),
      cumulativeAmount: 100n,
      deltaAmount: 100n,
      nonce: 1,
      timestamp: Math.floor(Date.now() / 1000),
    };

    const signedVoucher = signMicropaymentVoucher(voucherWithoutSig, userKeypair.privateKey);
    expect(signedVoucher.signatureHex).toBeDefined();

    // 3. Unlock and retrieve content
    const result = await engine.unlockAndRetrieve(
      contentCid,
      signedVoucher,
      userKeypair.publicKey,
      key,
    );

    expect(new TextDecoder().decode(result.plaintext)).toBe('Exclusive 4K Creator Video Stream Chunks');
    expect(result.settlement.creatorAmount).toBe(95n);
    expect(result.settlement.seederAmount).toBe(5n);

    // 4. Double-spend replay should be rejected
    await expect(
      engine.unlockAndRetrieve(contentCid, signedVoucher, userKeypair.publicKey, key),
    ).rejects.toThrow('already been settled');
  });

  it('rejects voucher with invalid signature or insufficient payment', async () => {
    const secretData = new TextEncoder().encode('Special Bonus Track');
    const { contentCid, key } = await engine.encryptAndStore(secretData, creatorDid, 500n);

    // Bad signature
    const fakeVoucher: MicropaymentVoucher = {
      voucherId: 'vouch-fake',
      channelId: 'chan-alice-bob',
      senderDid: userDid,
      creatorDid,
      contentCid: contentCid.toString(),
      cumulativeAmount: 500n,
      deltaAmount: 500n,
      nonce: 1,
      timestamp: Math.floor(Date.now() / 1000),
      signatureHex: '00'.repeat(64),
    };

    await expect(
      engine.unlockAndRetrieve(contentCid, fakeVoucher, userKeypair.publicKey, key),
    ).rejects.toThrow('Invalid micropayment voucher signature');

    // Insufficient payment
    const underpaidVoucher = signMicropaymentVoucher(
      {
        voucherId: 'vouch-cheap',
        channelId: 'chan-alice-bob',
        senderDid: userDid,
        creatorDid,
        contentCid: contentCid.toString(),
        cumulativeAmount: 10n, // Needs 500
        deltaAmount: 10n,
        nonce: 2,
        timestamp: Math.floor(Date.now() / 1000),
      },
      userKeypair.privateKey,
    );

    await expect(
      engine.unlockAndRetrieve(contentCid, underpaidVoucher, userKeypair.publicKey, key),
    ).rejects.toThrow('below required threshold');
  });
});
