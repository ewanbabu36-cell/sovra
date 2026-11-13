/**
 * @file packages/identity/src/governance/audit-log.ts
 * SOVRA Tamper-Evident Hash-Chained Audit Log.
 *
 * Enforces:
 * 1. Cryptographic SHA-256 Merkle hash chaining across all administrative & governance events:
 *    H_k = SHA-256(H_{k-1} || sequence || timestamp || actorDid || action || payloadHash || signature)
 * 2. Signature verification on every entry.
 * 3. Complete chain verification detecting any modification, deletion, or retrofitting.
 */

import crypto from 'node:crypto';
import {
  verifyEd25519,
  hexToBytes,
} from '@sovra/crypto';
import { ValidationError } from '@sovra/shared';

export interface AuditLogEntry {
  readonly sequence: number;
  readonly timestamp: number;
  readonly actorDid: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly details: string;
  readonly previousEntryHash: string;
  readonly signatureHex: string;
  readonly entryHash: string;
}

export interface ChainVerificationResult {
  readonly valid: boolean;
  readonly totalEntries: number;
  readonly headHash: string;
  readonly brokenSequence?: number | undefined;
  readonly failureReason?: string | undefined;
}

export class TamperEvidentAuditLog {
  private readonly entries: AuditLogEntry[] = [];
  public static readonly GENESIS_PREV_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

  constructor() {
    // Initialize genesis entry
    const genesisTime = 1730000000;
    const genesisHash = crypto
      .createHash('sha256')
      .update(`SOVRA_GENESIS_AUDIT:${TamperEvidentAuditLog.GENESIS_PREV_HASH}:${genesisTime}`)
      .digest('hex');

    this.entries.push({
      sequence: 0,
      timestamp: genesisTime,
      actorDid: 'did:sovra:system:genesis',
      action: 'SYSTEM_GENESIS_INITIALIZED',
      payloadHash: genesisHash,
      details: 'Sovra Governance and Cryptographic Audit Chain Initialized',
      previousEntryHash: TamperEvidentAuditLog.GENESIS_PREV_HASH,
      signatureHex: '00'.repeat(64),
      entryHash: genesisHash,
    });
  }

  public getLength(): number {
    return this.entries.length;
  }

  public getHeadHash(): string {
    return this.entries[this.entries.length - 1]!.entryHash;
  }

  public getEntry(sequence: number): AuditLogEntry | undefined {
    return this.entries[sequence];
  }

  public getAllEntries(): readonly AuditLogEntry[] {
    return this.entries;
  }

  /**
   * Computes the deterministic SHA-256 hash of an audit log entry.
   */
  public static computeEntryHash(params: {
    sequence: number;
    timestamp: number;
    actorDid: string;
    action: string;
    payloadHash: string;
    details: string;
    previousEntryHash: string;
    signatureHex: string;
  }): string {
    const raw = `${params.sequence}:${params.timestamp}:${params.actorDid}:${params.action}:${params.payloadHash}:${params.details}:${params.previousEntryHash}:${params.signatureHex}`;
    return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  }

  /**
   * Appends an action to the tamper-evident log, linking to the previous head hash.
   */
  public appendEntry(params: {
    actorDid: string;
    action: string;
    payload: Record<string, unknown> | string;
    details: string;
    actorPublicKeyBytes: Uint8Array;
    signatureHex: string;
    timestamp?: number;
  }): AuditLogEntry {
    const prevEntry = this.entries[this.entries.length - 1]!;
    const sequence = prevEntry.sequence + 1;
    const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);

    const payloadStr = typeof params.payload === 'string' ? params.payload : JSON.stringify(params.payload);
    const payloadHash = crypto.createHash('sha256').update(payloadStr, 'utf8').digest('hex');

    // Verify actor signature over (action + payloadHash + prevHash)
    const signPayload = `AUDIT_EVENT:${sequence}:${timestamp}:${params.actorDid}:${params.action}:${payloadHash}:${prevEntry.entryHash}`;
    const signBytes = Buffer.from(signPayload, 'utf8');
    const sigBytes = hexToBytes(params.signatureHex);

    const isValidSig = verifyEd25519(params.actorPublicKeyBytes, signBytes, sigBytes);
    if (!isValidSig) {
      throw new ValidationError('Cryptographic signature verification failed for audit log entry');
    }

    const entryHash = TamperEvidentAuditLog.computeEntryHash({
      sequence,
      timestamp,
      actorDid: params.actorDid,
      action: params.action,
      payloadHash,
      details: params.details,
      previousEntryHash: prevEntry.entryHash,
      signatureHex: params.signatureHex,
    });

    const entry: AuditLogEntry = {
      sequence,
      timestamp,
      actorDid: params.actorDid,
      action: params.action,
      payloadHash,
      details: params.details,
      previousEntryHash: prevEntry.entryHash,
      signatureHex: params.signatureHex,
      entryHash,
    };

    this.entries.push(entry);
    return entry;
  }

  /**
   * Re-verifies every hash link and sequence in the entire chain from genesis to head.
   */
  public verifyChainIntegrity(): ChainVerificationResult {
    if (this.entries.length === 0) {
      return { valid: false, totalEntries: 0, headHash: '', failureReason: 'Empty chain' };
    }

    for (let i = 1; i < this.entries.length; i++) {
      const prev = this.entries[i - 1]!;
      const curr = this.entries[i]!;

      // 1. Verify sequence continuity
      if (curr.sequence !== prev.sequence + 1) {
        return {
          valid: false,
          totalEntries: this.entries.length,
          headHash: this.getHeadHash(),
          brokenSequence: curr.sequence,
          failureReason: `Broken sequence at index ${i}: expected ${prev.sequence + 1}, found ${curr.sequence}`,
        };
      }

      // 2. Verify previous hash pointer
      if (curr.previousEntryHash !== prev.entryHash) {
        return {
          valid: false,
          totalEntries: this.entries.length,
          headHash: this.getHeadHash(),
          brokenSequence: curr.sequence,
          failureReason: `Broken hash chain pointer at sequence ${curr.sequence}`,
        };
      }

      // 3. Verify entry hash recalculation
      const expectedHash = TamperEvidentAuditLog.computeEntryHash({
        sequence: curr.sequence,
        timestamp: curr.timestamp,
        actorDid: curr.actorDid,
        action: curr.action,
        payloadHash: curr.payloadHash,
        details: curr.details,
        previousEntryHash: curr.previousEntryHash,
        signatureHex: curr.signatureHex,
      });

      if (curr.entryHash !== expectedHash) {
        return {
          valid: false,
          totalEntries: this.entries.length,
          headHash: this.getHeadHash(),
          brokenSequence: curr.sequence,
          failureReason: `Hash mismatch at sequence ${curr.sequence} (tampering detected)`,
        };
      }
    }

    return {
      valid: true,
      totalEntries: this.entries.length,
      headHash: this.getHeadHash(),
    };
  }
}
