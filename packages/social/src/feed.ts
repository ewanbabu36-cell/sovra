import { SovraEvent, EventKind } from '@sovra/protocol';
import { LocalFeedEngine, SocialGraphState, SocialGraphEngine } from './types.js';
import { computePrivacyPreservingRankScore } from './discovery.js';

export class DefaultLocalFeedEngine implements LocalFeedEngine {
  private readonly eventsById = new Map<string, SovraEvent>();
  private readonly eventIdsByAuthor = new Map<string, Set<string>>();

  constructor(private readonly graphEngine?: SocialGraphEngine) {}

  public appendEvent(event: SovraEvent): void {
    if (this.eventsById.has(event.id)) {
      return; // Already ingested
    }

    this.eventsById.set(event.id, event);

    let authorEvents = this.eventIdsByAuthor.get(event.pubkey);
    if (!authorEvents) {
      authorEvents = new Set();
      this.eventIdsByAuthor.set(event.pubkey, authorEvents);
    }
    authorEvents.add(event.id);
  }

  public getChronologicalFeed(
    userPubkey: string,
    limit = 20,
    beforeTimestamp?: number,
  ): readonly SovraEvent[] {
    const graphState: SocialGraphState = this.graphEngine
      ? this.graphEngine.getState(userPubkey)
      : {
          pubkey: userPubkey,
          followingSet: new Set(),
          blockedSet: new Set(),
          mutedSet: new Set(),
          joinedCommunities: new Set(),
        };

    const eligibleEvents: SovraEvent[] = [];

    // Eligible authors: userPubkey itself + all followed accounts
    const followedAuthors = new Set(graphState.followingSet);
    followedAuthors.add(userPubkey);

    for (const author of followedAuthors) {
      const eventIds = this.eventIdsByAuthor.get(author);
      if (!eventIds) continue;

      for (const id of eventIds) {
        const ev = this.eventsById.get(id);
        if (!ev) continue;

        // Skip non-content events (like Follow / Block / Mute events) from display timeline
        if (ev.kind === EventKind.Follow || ev.kind === EventKind.Block || ev.kind === EventKind.Mute) {
          continue;
        }

        if (beforeTimestamp !== undefined && ev.createdAt >= beforeTimestamp) {
          continue;
        }

        eligibleEvents.push(ev);
      }
    }

    // Filter out blocked / muted accounts locally on device
    const filtered = this.filterSuppressedEvents(eligibleEvents, graphState);

    // Strictly chronological order (newest first), deterministic secondary sort on event id
    const sorted = [...filtered].sort((a, b) => {
      if (b.createdAt !== a.createdAt) {
        return b.createdAt - a.createdAt;
      }
      return b.id.localeCompare(a.id);
    });

    return sorted.slice(0, Math.max(1, limit));
  }

  public getGlobalFeed(
    userPubkey: string,
    limit = 20,
    beforeTimestamp?: number,
  ): readonly SovraEvent[] {
    const graphState: SocialGraphState = this.graphEngine
      ? this.graphEngine.getState(userPubkey)
      : {
          pubkey: userPubkey,
          followingSet: new Set(),
          blockedSet: new Set(),
          mutedSet: new Set(),
          joinedCommunities: new Set(),
        };

    const eligibleEvents: SovraEvent[] = [];
    for (const ev of this.eventsById.values()) {
      if (ev.kind === EventKind.Follow || ev.kind === EventKind.Block || ev.kind === EventKind.Mute) {
        continue;
      }
      if (beforeTimestamp !== undefined && ev.createdAt >= beforeTimestamp) {
        continue;
      }
      eligibleEvents.push(ev);
    }

    const filtered = this.filterSuppressedEvents(eligibleEvents, graphState);
    const sorted = [...filtered].sort((a, b) => {
      if (b.createdAt !== a.createdAt) {
        return b.createdAt - a.createdAt;
      }
      return b.id.localeCompare(a.id);
    });

    return sorted.slice(0, Math.max(1, limit));
  }

  public getRankedDiscoveryFeed(
    userPubkey: string,
    limit = 20,
    beforeTimestamp?: number,
    authorReputations?: Readonly<Record<string, number>>,
  ): readonly SovraEvent[] {
    const globalEvents = this.getGlobalFeed(userPubkey, limit * 3, beforeTimestamp);
    const now = Math.floor(Date.now() / 1000);

    const ranked = globalEvents.map(event => {
      const ageHours = Math.max(0, (now - event.createdAt) / 3600);
      const authorRep = authorReputations?.[event.pubkey] ?? 50;
      const isFollowed = this.graphEngine?.getState(userPubkey).followingSet.has(event.pubkey) ?? false;
      const localAffinity = isFollowed ? 1.0 : 0.5;

      const score = computePrivacyPreservingRankScore({
        authorReputation: authorRep,
        localAffinity,
        ageHours,
        isExplorationCandidate: !isFollowed,
      });

      return { event, score };
    });

    ranked.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.event.createdAt - a.event.createdAt;
    });

    return ranked.slice(0, Math.max(1, limit)).map(r => r.event);
  }

  public getAuthorTimeline(
    authorPubkey: string,
    viewerPubkey?: string,
    limit = 20,
  ): readonly SovraEvent[] {
    const graphState: SocialGraphState | undefined = viewerPubkey && this.graphEngine
      ? this.graphEngine.getState(viewerPubkey)
      : undefined;

    const eventIds = this.eventIdsByAuthor.get(authorPubkey);
    if (!eventIds) return [];

    let events: SovraEvent[] = [];
    for (const id of eventIds) {
      const ev = this.eventsById.get(id);
      if (ev) events.push(ev);
    }

    if (graphState) {
      events = [...this.filterSuppressedEvents(events, graphState)];
    }

    events.sort((a, b) => {
      if (b.createdAt !== a.createdAt) {
        return b.createdAt - a.createdAt;
      }
      return b.id.localeCompare(a.id);
    });

    return events.slice(0, Math.max(1, limit));
  }

  public filterSuppressedEvents(
    events: readonly SovraEvent[],
    graphState: SocialGraphState,
  ): readonly SovraEvent[] {
    return events.filter(ev => {
      // 1. Author is blocked by viewer
      if (graphState.blockedSet.has(ev.pubkey)) {
        return false;
      }

      // 2. Author is muted by viewer
      if (graphState.mutedSet.has(ev.pubkey)) {
        return false;
      }

      // 3. Any target referenced in 'p' tag is blocked by viewer
      for (const tag of ev.tags) {
        if (tag[0] === 'p' && tag[1] && graphState.blockedSet.has(tag[1])) {
          return false;
        }
      }

      return true;
    });
  }

  public clear(): void {
    this.eventsById.clear();
    this.eventIdsByAuthor.clear();
  }
}
