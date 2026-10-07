import { SocialGraphEngine } from '@sovra/social';
import {
  PersonalFeedPreferences,
  FeedItem,
  ScoredFeedItem,
  ExplanationBreakdown,
} from './types.js';

export const DEFAULT_FEED_PREFERENCES: PersonalFeedPreferences = {
  topicWeights: {},
  noveltyWeight: 0.3,
  depthWeight: 0.2,
  trustRadius: 3,
  epistemicEvidenceWeight: 0.4,
  decayHalfLifeDays: 3,
  mutedTopics: [],
};

export class PersonalFeedRanker {
  private preferences: PersonalFeedPreferences;

  constructor(initialPreferences: Partial<PersonalFeedPreferences> = {}) {
    this.preferences = {
      ...DEFAULT_FEED_PREFERENCES,
      ...initialPreferences,
      topicWeights: {
        ...DEFAULT_FEED_PREFERENCES.topicWeights,
        ...(initialPreferences.topicWeights ?? {}),
      },
    };
  }

  public getPreferences(): PersonalFeedPreferences {
    return { ...this.preferences };
  }

  public updatePreferences(updates: Partial<PersonalFeedPreferences>): void {
    this.preferences = {
      ...this.preferences,
      ...updates,
      topicWeights: {
        ...this.preferences.topicWeights,
        ...(updates.topicWeights ?? {}),
      },
    };
  }

  public rankFeed(
    items: readonly FeedItem[],
    options: {
      readHistory?: ReadonlySet<string>;
      observerPubkeyHex?: string;
      graphEngine?: SocialGraphEngine;
      currentTimeSec?: number;
    } = {},
  ): ScoredFeedItem[] {
    const nowSec = options.currentTimeSec ?? Math.floor(Date.now() / 1000);
    const scored: ScoredFeedItem[] = [];

    const mutedSet = new Set(this.preferences.mutedTopics.map(t => t.toLowerCase()));

    for (const item of items) {
      // 1. Strict suppression checks
      // Check muted topics
      const isMuted = item.topicTags.some(t => mutedSet.has(t.toLowerCase()));
      if (isMuted) {
        continue;
      }

      // Check author block if graphEngine and observer provided
      if (options.graphEngine && options.observerPubkeyHex) {
        if (options.graphEngine.isBlocked(options.observerPubkeyHex, item.event.pubkey)) {
          continue;
        }
        if (options.graphEngine.isMuted(options.observerPubkeyHex, item.event.pubkey)) {
          continue;
        }
      }

      // 2. Compute individual components
      const topicMatch = this.computeTopicMatch(item);
      const authorTrust = this.computeAuthorTrust(item);
      const epistemicBonus = this.computeEpistemicBonus(item);
      const recencyScore = this.computeRecencyScore(item, nowSec);
      const noveltyScore = this.computeNoveltyScore(item, options.readHistory);
      const depthBonus = this.computeDepthBonus(item);

      // 3. Composite score formula (zero central algorithmic manipulation)
      const baseScore =
        topicMatch * 0.35 +
        authorTrust * 0.25 +
        epistemicBonus * this.preferences.epistemicEvidenceWeight +
        recencyScore * 0.20 +
        noveltyScore * this.preferences.noveltyWeight +
        depthBonus * this.preferences.depthWeight;

      const finalScore = Math.max(0, Number(baseScore.toFixed(3)));

      const explanation: ExplanationBreakdown = {
        topicMatch: Number(topicMatch.toFixed(2)),
        authorTrust: Number(authorTrust.toFixed(2)),
        epistemicBonus: Number(epistemicBonus.toFixed(2)),
        recencyScore: Number(recencyScore.toFixed(2)),
        noveltyScore: Number(noveltyScore.toFixed(2)),
        depthBonus: Number(depthBonus.toFixed(2)),
        summaryText: this.buildExplanationText({
          topicMatch,
          authorTrust,
          epistemicBonus,
          recencyScore,
          item,
        }),
      };

      scored.push({
        item,
        score: finalScore,
        explanation,
      });
    }

    // Sort descending by score; tie-break on newer createdAt
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.item.event.createdAt - a.item.event.createdAt;
    });

    return scored;
  }

  private computeTopicMatch(item: FeedItem): number {
    let match = 0.5; // neutral baseline
    let totalWeightCount = 0;

    for (const tag of item.topicTags) {
      const lower = tag.toLowerCase();
      if (lower in this.preferences.topicWeights) {
        const weight = this.preferences.topicWeights[lower]!;
        match += weight * 0.5;
        totalWeightCount++;
      }
    }

    if (totalWeightCount > 0) {
      return Math.max(0.0, Math.min(1.0, match));
    }
    return 0.5;
  }

  private computeAuthorTrust(item: FeedItem): number {
    if (typeof item.authorReputationScore === 'number') {
      return Math.max(0.0, Math.min(1.0, item.authorReputationScore / 100));
    }
    return 0.5; // Neutral baseline when reputation uncomputed
  }

  private computeEpistemicBonus(item: FeedItem): number {
    let bonus = 0.0;
    if (item.epistemicStatus === 'SUPPORTED') {
      bonus += 0.3;
    } else if (item.epistemicStatus === 'REFUTED') {
      bonus -= 0.5;
    } else if (item.epistemicStatus === 'DISPUTED') {
      bonus -= 0.1;
    }

    const evCount = item.evidenceCount ?? 0;
    const counterCount = item.counterargumentCount ?? 0;

    bonus += Math.min(0.4, evCount * 0.1);
    bonus -= Math.min(0.3, counterCount * 0.08);

    return Math.max(-0.5, Math.min(1.0, bonus));
  }

  private computeRecencyScore(item: FeedItem, nowSec: number): number {
    const ageSeconds = Math.max(0, nowSec - item.event.createdAt);
    const halfLifeSeconds = Math.max(3600, this.preferences.decayHalfLifeDays * 86400);
    // Exponential half-life decay: 2^(-age / halfLife)
    return Math.pow(2, -ageSeconds / halfLifeSeconds);
  }

  private computeNoveltyScore(item: FeedItem, readHistory?: ReadonlySet<string>): number {
    if (!readHistory || readHistory.size === 0) return 0.5;
    const isAlreadyRead = readHistory.has(item.event.id);
    if (isAlreadyRead) return 0.1; // heavily downrank already-read items for novelty
    return 0.8; // fresh unread content
  }

  private computeDepthBonus(item: FeedItem): number {
    const length = item.contentLength ?? (typeof item.event.content === 'string' ? item.event.content.length : 100);
    // Long-form content (> 1000 chars) gets up to 1.0; short snippets get lower
    return Math.min(1.0, length / 1200);
  }

  private buildExplanationText(factors: {
    topicMatch: number;
    authorTrust: number;
    epistemicBonus: number;
    recencyScore: number;
    item: FeedItem;
  }): string {
    const parts: string[] = [];
    if (factors.topicMatch > 0.6) {
      parts.push('High affinity with your subscribed topics');
    } else if (factors.topicMatch < 0.4) {
      parts.push('Deprioritized per topic preference');
    }

    if (factors.authorTrust > 0.7) {
      parts.push('Trusted author in your Web-of-Trust');
    }

    if (factors.epistemicBonus > 0.2) {
      parts.push('Backed by verified evidence and claims');
    } else if (factors.epistemicBonus < -0.2) {
      parts.push('Heavily disputed or refuted by counterarguments');
    }

    if (factors.recencyScore > 0.8) {
      parts.push('Fresh publication');
    }

    return parts.length > 0 ? parts.join('; ') : 'Balanced chronological discovery';
  }
}
