import { SovraEvent } from '@sovra/protocol';
import { SocialGraphState } from './types.js';

export type DiscoveryStrategyType =
  | 'chronological'
  | 'trending'
  | 'topic_affinity'
  | 'social_proximity';

export interface UserDiscoveryContext {
  readonly userPubkey: string;
  readonly interestTopics?: readonly string[] | undefined;
  readonly graphState?: SocialGraphState | undefined;
  readonly secondDegreeFollows?: ReadonlySet<string> | undefined;
}

export interface EventEngagementStats {
  reactionsCount: number;
  repostsCount: number;
  commentsCount: number;
}

export interface TopicTrendInfo {
  readonly topic: string;
  readonly count: number;
}

/**
 * Open, Neutral Recommendation & Discovery Engine.
 * Implements Cold-Start Discovery Gap 7:
 * 1. User has sovereign control over algorithm choice (no hidden corporate black-boxes).
 * 2. Inverted hashtag/topic indexing resolves cold-start for new users with 0 followers.
 * 3. Transparent, data-driven ranking strategies:
 *    - Chronological: pure time ordering
 *    - Trending: time-decayed engagement velocity
 *    - Topic Affinity: matched interest topics
 *    - Social Proximity: 1st and 2nd-degree social graph distances
 */
export class DiscoveryEngine {
  private readonly topicIndex = new Map<string, Set<string>>(); // topic -> Set<eventId>
  private readonly engagements = new Map<string, EventEngagementStats>();

  /**
   * Indexes an event by extracted topics/hashtags and initializes engagement metrics.
   */
  public indexEvent(event: SovraEvent): void {
    if (!this.engagements.has(event.id)) {
      this.engagements.set(event.id, {
        reactionsCount: 0,
        repostsCount: 0,
        commentsCount: 0,
      });
    }

    // 1. Extract topics from protocol tags (e.g. ["t", "crypto"])
    for (const tag of event.tags) {
      if (tag[0] === 't' && tag[1]) {
        this.addEventToTopic(tag[1].toLowerCase(), event.id);
      }
    }

    // 2. Extract #hashtags from text content if ShortPost
    if (typeof event.content === 'string') {
      const hashMatches = event.content.match(/#(\w+)/g);
      if (hashMatches) {
        for (const rawTag of hashMatches) {
          const cleanTag = rawTag.substring(1).toLowerCase();
          this.addEventToTopic(cleanTag, event.id);
        }
      }
    }
  }

  private addEventToTopic(topic: string, eventId: string): void {
    let set = this.topicIndex.get(topic);
    if (!set) {
      set = new Set<string>();
      this.topicIndex.set(topic, set);
    }
    set.add(eventId);
  }

  public recordEngagement(
    eventId: string,
    type: 'reaction' | 'repost' | 'comment',
  ): void {
    let stat = this.engagements.get(eventId);
    if (!stat) {
      stat = { reactionsCount: 0, repostsCount: 0, commentsCount: 0 };
      this.engagements.set(eventId, stat);
    }

    if (type === 'reaction') stat.reactionsCount++;
    else if (type === 'repost') stat.repostsCount++;
    else if (type === 'comment') stat.commentsCount++;
  }

  public getEngagement(eventId: string): EventEngagementStats {
    return (
      this.engagements.get(eventId) ?? {
        reactionsCount: 0,
        repostsCount: 0,
        commentsCount: 0,
      }
    );
  }

  public getTopTopics(limit = 10): readonly TopicTrendInfo[] {
    const list: TopicTrendInfo[] = [];
    for (const [topic, set] of this.topicIndex.entries()) {
      list.push({ topic, count: set.size });
    }
    list.sort((a, b) => b.count - a.count);
    return list.slice(0, limit);
  }

  public getEventsForTopic(topic: string): readonly string[] {
    const set = this.topicIndex.get(topic.toLowerCase());
    return set ? Array.from(set) : [];
  }

  /**
   * Ranks feed events according to user-selected open algorithm strategy.
   */
  public rankFeed(
    events: readonly SovraEvent[],
    strategy: DiscoveryStrategyType,
    context: UserDiscoveryContext,
    options?: { limit?: number; nowTimestamp?: number },
  ): SovraEvent[] {
    const now = options?.nowTimestamp ?? Math.floor(Date.now() / 1000);
    const limit = options?.limit ?? 50;

    // Filter out blocked or muted authors if graph state is provided
    let candidateEvents = events;
    if (context.graphState) {
      const blocked = context.graphState.blockedSet;
      const muted = context.graphState.mutedSet;
      candidateEvents = events.filter(
        ev => !blocked.has(ev.pubkey) && !muted.has(ev.pubkey),
      );
    }

    const scored = candidateEvents.map(event => {
      const score = this.calculateEventScore(event, strategy, context, now);
      return { event, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.event);
  }

  private calculateEventScore(
    event: SovraEvent,
    strategy: DiscoveryStrategyType,
    context: UserDiscoveryContext,
    now: number,
  ): number {
    const ageHours = Math.max(0.1, (now - event.createdAt) / 3600);
    const eng = this.getEngagement(event.id);
    const rawEngagement = eng.reactionsCount * 1.0 + eng.repostsCount * 2.5 + eng.commentsCount * 1.5;

    switch (strategy) {
      case 'chronological':
        return event.createdAt;

      case 'trending': {
        // HackerNews style gravity decay: Engagement / (Age + 2)^1.5
        const gravity = Math.pow(ageHours + 2, 1.5);
        return (rawEngagement + 1.0) / gravity;
      }

      case 'topic_affinity': {
        const userTopics = context.interestTopics ?? [];
        let topicMatches = 0;

        for (const userTopic of userTopics) {
          const lower = userTopic.toLowerCase();
          const topicEvents = this.topicIndex.get(lower);
          if (topicEvents && topicEvents.has(event.id)) {
            topicMatches++;
          }
        }

        const affinityMultiplier = topicMatches > 0 ? 1.0 + topicMatches * 2.0 : 0.2;
        const trendBase = (rawEngagement + 1.0) / Math.pow(ageHours + 2, 1.2);
        return trendBase * affinityMultiplier;
      }

      case 'social_proximity': {
        let distanceMultiplier = 0.2; // default stranger
        if (context.graphState?.followingSet.has(event.pubkey)) {
          distanceMultiplier = 3.0; // 1st degree follow
        } else if (context.secondDegreeFollows?.has(event.pubkey)) {
          distanceMultiplier = 1.2; // 2nd degree mutual
        }

        const trendBase = (rawEngagement + 1.0) / Math.pow(ageHours + 2, 1.3);
        return trendBase * distanceMultiplier;
      }

      default:
        return event.createdAt;
    }
  }
}

export interface PrivacyRankingInputs {
  readonly authorReputation: number; // 0 to 100
  readonly localAffinity: number; // 0.0 to 1.0 (on-device cosine similarity)
  readonly ageHours: number;
  readonly isExplorationCandidate?: boolean | undefined;
}

/**
 * Pillar 7: Privacy-Preserving On-Device Feed Ranking Equation:
 * RankScore = (AuthorRep / 100) * LocalAffinity * (1 / (1 + AgeHours)^1.4) + ExplorationBoost
 */
export function computePrivacyPreservingRankScore(inputs: PrivacyRankingInputs): number {
  const repNormalized = Math.max(0, Math.min(1.0, inputs.authorReputation / 100));
  const affinity = Math.max(0, Math.min(1.0, inputs.localAffinity));
  const ageDecay = 1 / Math.pow(1 + Math.max(0, inputs.ageHours), 1.4);
  const explorationBoost = inputs.isExplorationCandidate ? 0.15 : 0.0;

  const score = repNormalized * affinity * ageDecay + explorationBoost;
  return Math.round(score * 10000) / 10000;
}

/**
 * Pillar 7: Cold-Start Inverted Discovery Tree.
 * Lightweight Bloom Filter summary for propagation over gossip mesh without corporate tracking.
 */
export class ColdStartBloomTree {
  private readonly filter = new Set<string>();

  public addTopic(topic: string): void {
    this.filter.add(topic.toLowerCase().trim());
  }

  public hasTopic(topic: string): boolean {
    return this.filter.has(topic.toLowerCase().trim());
  }

  public getSummary(): readonly string[] {
    return Array.from(this.filter);
  }

  /**
   * Merges incoming gossip Bloom filter summary from peer node without centralized tracking.
   */
  public mergeGossipSummary(peerTopics: readonly string[]): void {
    for (const t of peerTopics) {
      this.addTopic(t);
    }
  }

  /**
   * Lightweight payload representation for gossip transmission.
   */
  public toGossipPayload(): { topicsCount: number; topics: readonly string[] } {
    return {
      topicsCount: this.filter.size,
      topics: this.getSummary(),
    };
  }
}

