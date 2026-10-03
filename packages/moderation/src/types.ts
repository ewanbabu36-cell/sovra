import { Result } from '@sovra/shared';

export type PolicyDecision = 'ALLOW' | 'QUARANTINE' | 'REJECT';

export type ModerationStatus = 'PENDING' | 'APPROVED' | 'FLAGGED' | 'REMOVED';

export type ViolationCategory =
  | 'PORNOGRAPHY'
  | 'EXPLICIT_SEXUAL_ACTS'
  | 'NUDITY_FOR_SEXUAL_DISPLAY'
  | 'SEXUALIZED_POSES'
  | 'CLEAVAGE_FOCUSED_SEXUALIZED'
  | 'LINGERIE_FOCUSED_SEXUALIZED'
  | 'SEXUAL_SOLICITATION'
  | 'SUGGESTIVE_THUMBNAIL'
  | 'EXPLICIT_AI_GENERATED'
  | 'ILLEGAL_MATERIAL'
  | 'SPAM_OR_MALWARE';

export interface PerceptualHashMatch {
  readonly algorithm: 'PDQ' | 'pHash' | 'PhotoDNA';
  readonly hashHex: string;
  readonly distance: number;
  readonly threshold: number;
  readonly matchedKnownViolation: boolean;
}

export interface SafetyScanResult {
  readonly contentCid: string;
  readonly overallScore: number; // 0.0 (clean) to 1.0 (definite violation)
  readonly visualScore: number;
  readonly videoFrameScores: readonly number[];
  readonly textOcrScore: number;
  readonly metadataScore: number;
  readonly detectedCategories: readonly ViolationCategory[];
  readonly isProtectedExpression: boolean; // Sexual orientation / health discussion protection
  readonly hashMatches: readonly PerceptualHashMatch[];
  readonly suggestedDecision: PolicyDecision;
  readonly evaluatedAt: number;
}

export interface ReviewQueueItem {
  readonly queueId: string;
  readonly contentCid: string;
  readonly authorPubkey: string;
  readonly scanResult: SafetyScanResult;
  readonly submittedAt: number;
  readonly status: ModerationStatus;
}

export interface ModeratorAction {
  readonly actionId: string;
  readonly moderatorId: string;
  readonly contentCid: string;
  readonly targetAuthorPubkey: string;
  readonly decision: PolicyDecision;
  readonly justification: string;
  readonly timestamp: number;
}

export interface AppealRequest {
  readonly appealId: string;
  readonly contentCid: string;
  readonly authorPubkey: string;
  readonly rationale: string;
  readonly signature: Uint8Array;
  readonly submittedAt: number;
  readonly status: 'PENDING_REVIEW' | 'GRANTED' | 'DENIED';
}

export interface ModerationAuditRecord {
  readonly recordId: string;
  readonly moderatorPubkey: string;
  readonly action: ModeratorAction;
  readonly previousState: ModerationStatus;
  readonly newState: ModerationStatus;
  readonly timestamp: number;
  readonly signature: Uint8Array;
}

export interface ContentSafetyEngine {
  evaluateUpload(
    cid: string,
    data: Uint8Array,
    mimeType: string,
  ): Promise<Result<SafetyScanResult>>;
  isPerceptualHashKnownViolation(hashHex: string): Promise<boolean>;
}

export interface ModerationQueueService {
  enqueueForReview(item: ReviewQueueItem): Promise<Result<void>>;
  fetchPendingReviews(limit: number): Promise<Result<readonly ReviewQueueItem[]>>;
  applyAction(action: ModeratorAction): Promise<Result<ModerationAuditRecord>>;
  submitAppeal(appeal: AppealRequest): Promise<Result<void>>;
}
