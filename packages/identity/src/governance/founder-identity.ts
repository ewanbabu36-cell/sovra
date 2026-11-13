/**
 * @file packages/identity/src/governance/founder-identity.ts
 * SOVRA Founder Identity Registry, Pseudonymity Guarantees & Voluntary Milestone Reveal.
 *
 * Enforces:
 * 1. Pseudonymous identity by default.
 * 2. Three-tier identity separation: Public Pseudonym, Cryptographic DID, Legal Compliance.
 * 3. Cryptographic attribution (Ed25519) distinct from ordinary admins.
 * 4. Milestone-based voluntary reveal state machine (Milestones 1 to 5).
 * 5. Constitutional bar on forced de-anonymization.
 */

import {
  verifyEd25519,
  hexToBytes,
  bytesToHex,
} from '@sovra/crypto';
import { ValidationError } from '@sovra/shared';
import { encodeEd25519DidKey } from '../did.js';

export type FounderMilestone = 1 | 2 | 3 | 4 | 5;

export type FounderRevealStatus =
  | 'PSEUDONYMOUS'
  | 'VOLUNTARY_REVEALED'
  | 'PARTIAL_ATTESTATION';

export interface FounderIdentityRecord {
  readonly founderDid: string;
  readonly pseudonym: string;
  readonly publicKeyHex: string;
  readonly registeredAt: number;
  readonly currentMilestone: FounderMilestone;
  readonly revealStatus: FounderRevealStatus;
  readonly publicDisclosureStatement?: string | undefined;
  readonly statutoryComplianceRegistered: boolean;
  readonly complianceJurisdiction?: string | undefined;
}

export interface PublicFounderProfile {
  readonly founderDid: string;
  readonly pseudonym: string;
  readonly publicKeyHex: string;
  readonly currentMilestone: FounderMilestone;
  readonly revealStatus: FounderRevealStatus;
  readonly publicDisclosureStatement?: string | undefined;
  readonly registeredAt: number;
}

export interface MilestoneAdvanceRequest {
  readonly milestone: FounderMilestone;
  readonly choice: FounderRevealStatus;
  readonly statement?: string | undefined;
  readonly signatureHex: string;
}

export class FounderIdentityRegistry {
  private record: FounderIdentityRecord | null = null;

  /**
   * Registers the canonical founder with a pseudonymous handle and Ed25519 public key.
   */
  public registerFounder(params: {
    pseudonym: string;
    publicKeyBytes: Uint8Array;
    statutoryComplianceRegistered?: boolean;
    complianceJurisdiction?: string;
    registeredAt?: number;
  }): FounderIdentityRecord {
    if (this.record) {
      throw new ValidationError('Founder identity is already registered and immutable');
    }

    if (!params.pseudonym || params.pseudonym.trim().length < 3) {
      throw new ValidationError('Pseudonym must be at least 3 characters');
    }

    if (params.publicKeyBytes.length !== 32) {
      throw new ValidationError('Public key must be exactly 32 bytes (Ed25519)');
    }

    const publicKeyHex = bytesToHex(params.publicKeyBytes);
    const founderDid = `did:sovra:founder:${encodeEd25519DidKey(params.publicKeyBytes).slice(13)}`;

    this.record = {
      founderDid,
      pseudonym: params.pseudonym.trim(),
      publicKeyHex,
      registeredAt: params.registeredAt ?? Math.floor(Date.now() / 1000),
      currentMilestone: 1,
      revealStatus: 'PSEUDONYMOUS',
      statutoryComplianceRegistered: params.statutoryComplianceRegistered ?? true,
      complianceJurisdiction: params.complianceJurisdiction ?? 'Sovereign / Multi-Jurisdictional Trust',
    };

    return this.record;
  }

  public getFounderRecord(): FounderIdentityRecord {
    if (!this.record) {
      throw new ValidationError('Founder identity has not been registered');
    }
    return this.record;
  }

  /**
   * Returns the safe public profile omitting internal compliance details.
   */
  public getPublicProfile(): PublicFounderProfile {
    const rec = this.getFounderRecord();
    return {
      founderDid: rec.founderDid,
      pseudonym: rec.pseudonym,
      publicKeyHex: rec.publicKeyHex,
      currentMilestone: rec.currentMilestone,
      revealStatus: rec.revealStatus,
      publicDisclosureStatement: rec.publicDisclosureStatement,
      registeredAt: rec.registeredAt,
    };
  }

  /**
   * Verifies an Ed25519 signature from the founder over arbitrary canonical bytes.
   */
  public verifyFounderSignature(messageBytes: Uint8Array, signatureHex: string): boolean {
    const rec = this.getFounderRecord();
    const pubKeyBytes = hexToBytes(rec.publicKeyHex);
    const sigBytes = hexToBytes(signatureHex);
    return verifyEd25519(pubKeyBytes, messageBytes, sigBytes);
  }

  /**
   * Advances the project milestone and updates voluntary reveal status.
   * Mandates an authenticated cryptographic signature from the founder's key.
   */
  public advanceMilestone(req: MilestoneAdvanceRequest): FounderIdentityRecord {
    const rec = this.getFounderRecord();

    if (req.milestone <= rec.currentMilestone) {
      throw new ValidationError('Milestone must advance monotonically', {
        current: rec.currentMilestone,
        target: req.milestone,
      });
    }

    // Verify cryptographic signature over transition intent
    const payload = `SOVRA_MILESTONE_ADVANCE:${req.milestone}:${req.choice}:${req.statement ?? ''}`;
    const payloadBytes = Buffer.from(payload, 'utf8');

    if (!this.verifyFounderSignature(payloadBytes, req.signatureHex)) {
      throw new ValidationError('Invalid cryptographic signature for milestone transition');
    }

    this.record = {
      ...rec,
      currentMilestone: req.milestone,
      revealStatus: req.choice,
      publicDisclosureStatement: req.statement ?? rec.publicDisclosureStatement,
    };

    return this.record;
  }

  /**
   * Constitutional Guardrail: Rejects any proposal or motion attempting to force
   * personal identification of the pseudonymous founder or contributor.
   */
  public checkForcedRevealImmunity(proposalText: string): { permitted: boolean; reason?: string } {
    const lower = proposalText.toLowerCase();
    const forcedRevealKeywords = [
      'force reveal',
      'compel identity',
      'doxx founder',
      'unmask founder',
      'mandatory kyc founder',
      'disclose legal name',
      'compulsory identity disclosure',
    ];

    for (const kw of forcedRevealKeywords) {
      if (lower.includes(kw)) {
        return {
          permitted: false,
          reason: `CONSTITUTIONAL VIOLATION: Proposal contains prohibited forced reveal demand ("${kw}"). Protected by SOVRA Constitution Invariant 5 and GOV-POL-001.`,
        };
      }
    }

    return { permitted: true };
  }
}
