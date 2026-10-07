import { SovraEvent } from '@sovra/protocol';

export interface PersonalFeedPreferences {
  /** User-defined explicit topic affinities, key = topic (e.g. 'cryptography'), value = weight (-1.0 to 1.0) */
  readonly topicWeights: Readonly<Record<string, number>>;
  /** Preference for diverse/novel perspectives vs familiar topics (0.0 to 1.0) */
  readonly noveltyWeight: number;
  /** Preference for deep/long-form content vs brief posts (0.0 to 1.0) */
  readonly depthWeight: number;
  /** Minimum author trust threshold or Web-of-Trust hop radius (e.g. 1, 2, 3) */
  readonly trustRadius: number;
  /** Extra score weight given to claims with verified evidence (0.0 to 1.0) */
  readonly epistemicEvidenceWeight: number;
  /** Half-life for temporal recency decay in days (default e.g. 3) */
  readonly decayHalfLifeDays: number;
  /** Topics or keywords to strictly exclude / mute locally */
  readonly mutedTopics: readonly string[];
}

export type EpistemicStatus = 'UNVERIFIED' | 'SUPPORTED' | 'DISPUTED' | 'REFUTED';

export interface FeedItem {
  readonly event: SovraEvent;
  readonly topicTags: readonly string[];
  readonly epistemicStatus?: EpistemicStatus | undefined;
  readonly evidenceCount?: number | undefined;
  readonly counterargumentCount?: number | undefined;
  readonly authorReputationScore?: number | undefined;
  readonly contentLength?: number | undefined;
}

export interface ExplanationBreakdown {
  readonly topicMatch: number;
  readonly authorTrust: number;
  readonly epistemicBonus: number;
  readonly recencyScore: number;
  readonly noveltyScore: number;
  readonly depthBonus: number;
  readonly summaryText: string;
}

export interface ScoredFeedItem {
  readonly item: FeedItem;
  readonly score: number;
  readonly explanation: ExplanationBreakdown;
}

export type TwinEntryType = 'READ' | 'KNOWN' | 'TRUSTED' | 'REJECTED';

export interface KnowledgeTwinEntry {
  readonly id: string;
  readonly type: TwinEntryType;
  readonly targetId: string; // Event ID, Claim ID, or Author Pubkey/DID
  readonly topicTags: readonly string[];
  readonly epistemicConfidence: number; // 0.0 to 1.0
  readonly userNotes?: string | undefined;
  readonly recordedAt: number;
  /** Strict invariant: Private knowledge twin entries must NEVER leak to public gossip / sync */
  readonly isPrivate: true;
}

export interface SupportingEvidenceItem {
  readonly id: string;
  readonly urlOrCid?: string | undefined;
  readonly summary: string;
  readonly reliability: number; // 0.0 to 1.0
}

export interface CounterargumentItem {
  readonly id: string;
  readonly argument: string;
  readonly authorPubkey: string;
  readonly severity: number; // 0.0 to 1.0
}

export interface ClaimSynthesis {
  readonly claimId: string;
  readonly claimText: string;
  readonly supportingEvidence: readonly SupportingEvidenceItem[];
  readonly counterarguments: readonly CounterargumentItem[];
  readonly netEpistemicScore: number; // -1.0 to 1.0
  readonly consensusStatus: EpistemicStatus;
  readonly synthesisSummary: string;
}

export interface QuestionSynthesis {
  readonly questionId: string;
  readonly questionText: string;
  readonly answers: readonly {
    readonly answerId: string;
    readonly authorPubkey: string;
    readonly text: string;
    readonly evidenceScore: number;
  }[];
  readonly topAnswerId?: string | undefined;
  readonly netSynthesis: string;
}
