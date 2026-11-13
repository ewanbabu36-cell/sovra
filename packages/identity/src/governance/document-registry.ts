/**
 * @file packages/identity/src/governance/document-registry.ts
 * SOVRA Governance Document Registry.
 *
 * Enforces:
 * 1. Content-addressed registration of foundational governance documents via SHA-256 digests.
 * 2. Immutability verification of ratified policies and constitutional frameworks.
 * 3. Public cataloging and retrieval of canonical governance documentation.
 */

import crypto from 'node:crypto';

export interface GovernanceDocumentRecord {
  readonly id: string;
  readonly title: string;
  readonly identifier: string; // e.g. GOV-POL-001, GOV-CONST-001
  readonly version: string;
  readonly sha256Digest: string;
  readonly contentSizeBytes: number;
  readonly ratifiedAt: number;
  readonly ratifyingAuthority: string;
}

export class GovernanceDocumentRegistry {
  private readonly documents = new Map<string, GovernanceDocumentRecord>();

  /**
   * Registers a canonical governance document with its SHA-256 hash digest.
   */
  public registerDocument(params: {
    id: string;
    title: string;
    identifier: string;
    version: string;
    content: string;
    ratifiedAt?: number;
    ratifyingAuthority?: string;
  }): GovernanceDocumentRecord {
    const contentBytes = Buffer.from(params.content, 'utf8');
    const sha256Digest = crypto.createHash('sha256').update(contentBytes).digest('hex');

    const record: GovernanceDocumentRecord = {
      id: params.id,
      title: params.title,
      identifier: params.identifier,
      version: params.version,
      sha256Digest,
      contentSizeBytes: contentBytes.length,
      ratifiedAt: params.ratifiedAt ?? Math.floor(Date.now() / 1000),
      ratifyingAuthority: params.ratifyingAuthority ?? 'Community Assembly & Genesis Ratification',
    };

    this.documents.set(params.id, record);
    return record;
  }

  public getDocument(id: string): GovernanceDocumentRecord | undefined {
    return this.documents.get(id);
  }

  /**
   * Verifies that candidate document content matches the registered immutable SHA-256 digest.
   */
  public verifyDocumentIntegrity(id: string, candidateContent: string): boolean {
    const doc = this.documents.get(id);
    if (!doc) return false;

    const candidateDigest = crypto.createHash('sha256').update(candidateContent, 'utf8').digest('hex');
    return candidateDigest === doc.sha256Digest;
  }

  public listDocuments(): readonly GovernanceDocumentRecord[] {
    return Array.from(this.documents.values());
  }
}
