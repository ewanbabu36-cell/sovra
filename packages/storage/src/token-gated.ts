import {
  encryptChaCha20Poly1305,
  decryptChaCha20Poly1305,
  secureRandomBytes,
  bytesToHex,
  hexToBytes,
} from '@sovra/crypto';
import {
  MicropaymentVoucher,
  verifyMicropaymentVoucher,
  calculateSettlementSplit,
  SettlementSplit,
} from '@sovra/protocol';
import { CID } from './cid.js';
import { Blockstore } from './blockstore.js';
import { ContentNotFoundError, StorageError } from './errors.js';

export interface TokenGatedMetadata {
  readonly contentCid: string;
  readonly envelopeCid: string;
  readonly creatorDid: string;
  readonly minVoucherAmount: bigint;
  readonly nonceHex: string;
  readonly byteLength: number;
}

export interface UnlockResult {
  readonly plaintext: Uint8Array;
  readonly settlement: SettlementSplit;
  readonly voucherId: string;
}

/**
 * Token-Gated Storage Engine.
 * Implements Creator Monetization Gap 5:
 * 1. Content is stored client-side encrypted via ChaCha20-Poly1305.
 * 2. Decryption and retrieval are strictly gated behind verified off-chain micropayment vouchers.
 * 3. Enforces automated settlement distribution (95% creator, 5% bandwidth seeder).
 */
export class TokenGatedStorageEngine {
  private readonly metadataStore = new Map<string, TokenGatedMetadata>();
  private readonly processedVouchers = new Set<string>();

  constructor(public readonly blockstore: Blockstore) {}

  /**
   * Encrypts plaintext media chunk with symmetric key, stores encrypted envelope
   * into blockstore, and records monetization metadata.
   */
  public async encryptAndStore(
    plaintext: Uint8Array,
    creatorDid: string,
    minVoucherAmount: bigint,
    customKey?: Uint8Array,
  ): Promise<{
    contentCid: CID;
    envelopeCid: CID;
    key: Uint8Array;
  }> {
    const key = customKey ?? secureRandomBytes(32);
    const nonce = secureRandomBytes(12);

    const ciphertext = encryptChaCha20Poly1305(key, nonce, plaintext);

    // Generate deterministic CIDs for plaintext reference and encrypted envelope
    const contentCid = CID.create('raw', plaintext);
    const envelopeCid = CID.create('raw', ciphertext);

    // Save ciphertext into blockstore
    await this.blockstore.put(envelopeCid, ciphertext);

    const meta: TokenGatedMetadata = {
      contentCid: contentCid.toString(),
      envelopeCid: envelopeCid.toString(),
      creatorDid,
      minVoucherAmount,
      nonceHex: bytesToHex(nonce),
      byteLength: plaintext.length,
    };

    this.metadataStore.set(contentCid.toString(), meta);

    return {
      contentCid,
      envelopeCid,
      key,
    };
  }

  /**
   * Unlocks and decrypts content envelope upon verification of a valid micropayment voucher.
   */
  public async unlockAndRetrieve(
    contentCidOrStr: CID | string,
    voucher: MicropaymentVoucher,
    senderPublicKey: Uint8Array,
    contentKey: Uint8Array,
    envelopeCidOverride?: CID,
  ): Promise<UnlockResult> {
    const cidStr = contentCidOrStr.toString();
    const meta = this.metadataStore.get(cidStr);
    if (!meta) {
      throw new ContentNotFoundError(cidStr, {
        reason: 'Token-gated metadata not found for content CID',
      });
    }

    // 1. Prevent voucher double-spend replay
    if (this.processedVouchers.has(voucher.voucherId)) {
      throw new StorageError(
        `Voucher ${voucher.voucherId} has already been settled`,
        'ERR_VOUCHER_ALREADY_USED',
      );
    }

    // 2. Cryptographic signature verification against sender's public key
    const isSigValid = verifyMicropaymentVoucher(voucher, senderPublicKey);
    if (!isSigValid) {
      throw new StorageError(
        'Invalid micropayment voucher signature',
        'ERR_INVALID_VOUCHER_SIGNATURE',
      );
    }

    // 3. Creator recipient validation
    if (voucher.creatorDid !== meta.creatorDid) {
      throw new StorageError(
        `Voucher recipient ${voucher.creatorDid} does not match content creator ${meta.creatorDid}`,
        'ERR_CREATOR_MISMATCH',
      );
    }

    // 4. Amount validation
    if (voucher.cumulativeAmount < meta.minVoucherAmount) {
      throw new StorageError(
        `Voucher amount ${voucher.cumulativeAmount} is below required threshold ${meta.minVoucherAmount}`,
        'ERR_INSUFFICIENT_PAYMENT',
      );
    }

    // 5. Retrieve encrypted ciphertext from blockstore
    const targetEnvelopeCid = envelopeCidOverride ?? CID.parse(meta.envelopeCid);
    const ciphertext = await this.blockstore.get(targetEnvelopeCid);

    if (!ciphertext) {
      throw new ContentNotFoundError(cidStr, {
        reason: 'Encrypted ciphertext envelope not found in blockstore',
      });
    }

    // 6. Decrypt plaintext
    const nonce = hexToBytes(meta.nonceHex);
    const plaintext = decryptChaCha20Poly1305(contentKey, nonce, ciphertext);

    // 7. Mark voucher settled and compute revenue distribution
    this.processedVouchers.add(voucher.voucherId);
    const settlement = calculateSettlementSplit(voucher.deltaAmount);

    return {
      plaintext,
      settlement,
      voucherId: voucher.voucherId,
    };
  }

  public getMetadata(contentCid: string): TokenGatedMetadata | undefined {
    return this.metadataStore.get(contentCid);
  }
}
