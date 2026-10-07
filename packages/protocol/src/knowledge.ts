/**
 * @file packages/protocol/src/knowledge.ts
 * Knowledge Network Epistemic Event Schemas, Canonical Validation & Operations.
 *
 * Implements:
 * 1. Structured Knowledge Objects: Question, Answer, Claim, Evidence, Counterargument, Synthesis.
 * 2. Community Governance & Democratic Role Operations.
 * 3. Multidimensional Sybil-Resistant Reputation Assertions.
 * 4. Deterministic Canonical RFC 8785 Serialization & Signature Verification.
 */

import { Result, ok, err } from '@sovra/shared';
import {
  sha256,
  bytesToHex,
  hexToBytes,
  signEd25519,
  verifyEd25519,
} from '@sovra/crypto';
import { SovraEvent, UnsignedSovraEvent } from './events.js';
import { canonicalizeJson } from './serialization.js';
import { InvalidEventError } from './errors.js';

// ==========================================
// 1. KNOWLEDGE OBJECT SCHEMAS
// ==========================================

export interface KnowledgeQuestionPayload {
  readonly title: string;
  readonly description?: string | undefined;
  readonly topics: readonly string[];
  readonly targetDomain?: string | undefined;
  readonly urgency?: 'low' | 'normal' | 'high' | undefined;
}

export interface KnowledgeAnswerPayload {
  readonly questionEventId: string;
  readonly summary: string;
  readonly body: string;
  readonly confidenceScore?: number | undefined; // 0.0 to 1.0
  readonly citedEvidenceIds?: readonly string[] | undefined;
}

export interface KnowledgeClaimPayload {
  readonly thesis: string;
  readonly domain: string;
  readonly scope?: string | undefined;
  readonly verificationMethod?: string | undefined;
}

export interface KnowledgeEvidencePayload {
  readonly targetClaimId: string;
  readonly evidenceType: 'empirical' | 'citation' | 'mathematical' | 'observational';
  readonly dataCid?: string | undefined;
  readonly sourceUrl?: string | undefined;
  readonly summary: string;
  readonly reproducibilityScore?: number | undefined; // 0.0 to 1.0
}

export interface KnowledgeCounterargumentPayload {
  readonly targetClaimOrEvidenceId: string;
  readonly rebuttalType: 'falsification' | 'methodological_flaw' | 'counter_evidence' | 'logical_fallacy';
  readonly rebuttal: string;
  readonly counterEvidenceIds?: readonly string[] | undefined;
}

export type ConsensusStatus = 'emerging' | 'strong_consensus' | 'contested' | 'falsified';

export interface KnowledgeSynthesisPayload {
  readonly questionOrClaimId: string;
  readonly consensusStatus: ConsensusStatus;
  readonly synthesisSummary: string;
  readonly supportingWeights: Readonly<Record<string, number>>;
}

export interface CommunityGovernancePayload {
  readonly communityId: string;
  readonly action: 'create_community' | 'propose_policy' | 'cast_vote' | 'grant_role' | 'revoke_role';
  readonly proposalId?: string | undefined;
  readonly voteOption?: 'yes' | 'no' | 'abstain' | undefined;
  readonly roleName?: string | undefined;
  readonly targetSubjectDid?: string | undefined;
  readonly governanceModel?: 'open' | 'invite_only' | 'moderated' | 'multi_admin' | 'community_governed' | undefined;
}

export type ReputationDimension = 'knowledge' | 'community' | 'reliability' | 'trust' | 'content';

export interface ReputationAssertionPayload {
  readonly subjectDid: string;
  readonly dimension: ReputationDimension;
  readonly scoreDelta: number; // -1.0 to +1.0
  readonly reason: string;
  readonly interactionEventId?: string | undefined;
}

// ==========================================
// 2. CANONICAL VALIDATION ENGINE
// ==========================================

export function validateKnowledgeQuestion(payload: unknown): Result<KnowledgeQuestionPayload> {
  if (!payload || typeof payload !== 'object') {
    return err(new InvalidEventError('Question payload must be a non-null object'));
  }
  const q = payload as Record<string, unknown>;
  if (typeof q.title !== 'string' || q.title.trim().length < 5 || q.title.length > 300) {
    return err(new InvalidEventError('Question title must be between 5 and 300 characters'));
  }
  if (!Array.isArray(q.topics) || q.topics.length === 0) {
    return err(new InvalidEventError('Question must have at least one topic tag'));
  }
  return ok({
    title: q.title.trim(),
    description: typeof q.description === 'string' ? q.description : undefined,
    topics: q.topics.map(t => String(t).trim().toLowerCase()),
    targetDomain: typeof q.targetDomain === 'string' ? q.targetDomain : undefined,
    urgency: q.urgency === 'high' || q.urgency === 'low' ? q.urgency : 'normal',
  });
}

export function validateKnowledgeAnswer(payload: unknown): Result<KnowledgeAnswerPayload> {
  if (!payload || typeof payload !== 'object') {
    return err(new InvalidEventError('Answer payload must be a non-null object'));
  }
  const a = payload as Record<string, unknown>;
  if (typeof a.questionEventId !== 'string' || !/^[0-9a-f]{64}$/i.test(a.questionEventId)) {
    return err(new InvalidEventError('Answer must reference a valid 64-character hex questionEventId'));
  }
  if (typeof a.summary !== 'string' || a.summary.trim().length < 10) {
    return err(new InvalidEventError('Answer summary must be at least 10 characters'));
  }
  if (typeof a.body !== 'string' || a.body.trim().length < 20) {
    return err(new InvalidEventError('Answer body must be at least 20 characters'));
  }

  let score = typeof a.confidenceScore === 'number' ? a.confidenceScore : undefined;
  if (score !== undefined && (score < 0 || score > 1)) {
    return err(new InvalidEventError('confidenceScore must be between 0.0 and 1.0'));
  }

  return ok({
    questionEventId: a.questionEventId,
    summary: a.summary.trim(),
    body: a.body.trim(),
    confidenceScore: score,
    citedEvidenceIds: Array.isArray(a.citedEvidenceIds) ? a.citedEvidenceIds.map(String) : undefined,
  });
}

export function validateKnowledgeClaim(payload: unknown): Result<KnowledgeClaimPayload> {
  if (!payload || typeof payload !== 'object') {
    return err(new InvalidEventError('Claim payload must be a non-null object'));
  }
  const c = payload as Record<string, unknown>;
  if (typeof c.thesis !== 'string' || c.thesis.trim().length < 10 || c.thesis.length > 500) {
    return err(new InvalidEventError('Claim thesis must be between 10 and 500 characters'));
  }
  if (typeof c.domain !== 'string' || c.domain.trim().length < 2) {
    return err(new InvalidEventError('Claim domain is required'));
  }

  return ok({
    thesis: c.thesis.trim(),
    domain: c.domain.trim().toLowerCase(),
    scope: typeof c.scope === 'string' ? c.scope : undefined,
    verificationMethod: typeof c.verificationMethod === 'string' ? c.verificationMethod : undefined,
  });
}

export function validateKnowledgeEvidence(payload: unknown): Result<KnowledgeEvidencePayload> {
  if (!payload || typeof payload !== 'object') {
    return err(new InvalidEventError('Evidence payload must be a non-null object'));
  }
  const e = payload as Record<string, unknown>;
  if (typeof e.targetClaimId !== 'string' || !/^[0-9a-f]{64}$/i.test(e.targetClaimId)) {
    return err(new InvalidEventError('Evidence must reference a valid 64-character hex targetClaimId'));
  }
  const validTypes = ['empirical', 'citation', 'mathematical', 'observational'];
  if (!validTypes.includes(String(e.evidenceType))) {
    return err(new InvalidEventError(`evidenceType must be one of: ${validTypes.join(', ')}`));
  }
  if (typeof e.summary !== 'string' || e.summary.trim().length < 10) {
    return err(new InvalidEventError('Evidence summary must be at least 10 characters'));
  }

  return ok({
    targetClaimId: e.targetClaimId,
    evidenceType: e.evidenceType as any,
    dataCid: typeof e.dataCid === 'string' ? e.dataCid : undefined,
    sourceUrl: typeof e.sourceUrl === 'string' ? e.sourceUrl : undefined,
    summary: e.summary.trim(),
    reproducibilityScore: typeof e.reproducibilityScore === 'number' ? e.reproducibilityScore : undefined,
  });
}

export function validateKnowledgeCounterargument(payload: unknown): Result<KnowledgeCounterargumentPayload> {
  if (!payload || typeof payload !== 'object') {
    return err(new InvalidEventError('Counterargument payload must be a non-null object'));
  }
  const ca = payload as Record<string, unknown>;
  if (typeof ca.targetClaimOrEvidenceId !== 'string' || !/^[0-9a-f]{64}$/i.test(ca.targetClaimOrEvidenceId)) {
    return err(new InvalidEventError('Counterargument must target a valid 64-character hex event ID'));
  }
  const validRebuttals = ['falsification', 'methodological_flaw', 'counter_evidence', 'logical_fallacy'];
  if (!validRebuttals.includes(String(ca.rebuttalType))) {
    return err(new InvalidEventError(`rebuttalType must be one of: ${validRebuttals.join(', ')}`));
  }
  if (typeof ca.rebuttal !== 'string' || ca.rebuttal.trim().length < 15) {
    return err(new InvalidEventError('Rebuttal must be at least 15 characters'));
  }

  return ok({
    targetClaimOrEvidenceId: ca.targetClaimOrEvidenceId,
    rebuttalType: ca.rebuttalType as any,
    rebuttal: ca.rebuttal.trim(),
    counterEvidenceIds: Array.isArray(ca.counterEvidenceIds) ? ca.counterEvidenceIds.map(String) : undefined,
  });
}

export function validateReputationAssertion(payload: unknown): Result<ReputationAssertionPayload> {
  if (!payload || typeof payload !== 'object') {
    return err(new InvalidEventError('Reputation assertion payload must be a non-null object'));
  }
  const r = payload as Record<string, unknown>;
  if (typeof r.subjectDid !== 'string' || !r.subjectDid.startsWith('did:')) {
    return err(new InvalidEventError('subjectDid must be a valid W3C DID string'));
  }
  const validDims = ['knowledge', 'community', 'reliability', 'trust', 'content'];
  if (!validDims.includes(String(r.dimension))) {
    return err(new InvalidEventError(`dimension must be one of: ${validDims.join(', ')}`));
  }
  if (typeof r.scoreDelta !== 'number' || r.scoreDelta < -1.0 || r.scoreDelta > 1.0) {
    return err(new InvalidEventError('scoreDelta must be a float between -1.0 and +1.0'));
  }
  if (typeof r.reason !== 'string' || r.reason.trim().length < 5) {
    return err(new InvalidEventError('Reputation assertion reason is required'));
  }

  return ok({
    subjectDid: r.subjectDid,
    dimension: r.dimension as any,
    scoreDelta: r.scoreDelta,
    reason: r.reason.trim(),
    interactionEventId: typeof r.interactionEventId === 'string' ? r.interactionEventId : undefined,
  });
}

// ==========================================
// 3. DETERMINISTIC EVENT CREATION & SIGNING
// ==========================================

export function createCanonicalKnowledgeEvent<T>(
  unsigned: UnsignedSovraEvent<T>,
  privateKey: Uint8Array,
): SovraEvent<T> {
  const canonical = canonicalizeJson({
    content: unsigned.content,
    createdAt: unsigned.createdAt,
    kind: unsigned.kind,
    media: unsigned.media ?? [],
    pubkey: unsigned.pubkey,
    tags: unsigned.tags,
  });

  const eventId = bytesToHex(sha256(new TextEncoder().encode(canonical)));
  const sig = bytesToHex(signEd25519(privateKey, hexToBytes(eventId)));

  return {
    id: eventId,
    pubkey: unsigned.pubkey,
    createdAt: unsigned.createdAt,
    kind: unsigned.kind,
    tags: unsigned.tags,
    content: unsigned.content,
    media: unsigned.media,
    sig,
    powNonce: unsigned.powNonce,
    powDifficulty: unsigned.powDifficulty,
  };
}

export function verifyCanonicalKnowledgeEvent<T>(event: SovraEvent<T>): boolean {
  try {
    const canonical = canonicalizeJson({
      content: event.content,
      createdAt: event.createdAt,
      kind: event.kind,
      media: event.media ?? [],
      pubkey: event.pubkey,
      tags: event.tags,
    });

    const expectedId = bytesToHex(sha256(new TextEncoder().encode(canonical)));
    if (expectedId !== event.id) {
      return false;
    }

    const pubkeyBytes = hexToBytes(event.pubkey);
    return verifyEd25519(pubkeyBytes, hexToBytes(event.id), hexToBytes(event.sig));
  } catch {
    return false;
  }
}
