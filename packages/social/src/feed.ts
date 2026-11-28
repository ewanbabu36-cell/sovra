import { Result, ok, err } from '@sovra/shared';
import { SovraEvent, EventKind, verifySignedSovraEvent } from '@sovra/protocol';
import { LocalFeedEngine, SocialGraphState, SocialGraphEngine } from './types.js';
import { computePrivacyPreservingRankScore } from './discovery.js';

export interface LocalFeedEngineOptions {
  readonly dbPath?: string | undefined;
  readonly strictSignatureVerification?: boolean | undefined;
}

export class DefaultLocalFeedEngine implements LocalFeedEngine {
  private readonly eventsById = new Map<string, SovraEvent>();
  private readonly eventIdsByAuthor = new Map<string, Set<string>>();
  private sqliteDb: any = null;
  private readonly strictSignatures: boolean;

  constructor(
    private readonly graphEngine?: SocialGraphEngine,
    options: LocalFeedEngineOptions = {},
  ) {
    this.strictSignatures = options.strictSignatureVerification ?? false;
    if (options.dbPath) {
      this.initSqlite(options.dbPath);
    }
  }

  private initSqlite(dbPath: string): void {
    try {
      const { DatabaseSync } = require('node:sqlite');
      this.sqliteDb = new DatabaseSync(dbPath);
      this.sqliteDb.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS feed_events (
          id TEXT PRIMARY KEY,
          pubkey TEXT NOT NULL,
          kind INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          raw_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_feed_events_author ON feed_events (pubkey, created_at DESC);
      `);
      const rows = this.sqliteDb.prepare('SELECT raw_json FROM feed_events ORDER BY created_at ASC').all();
      for (const row of rows) {
        try {
          const ev = JSON.parse(String(row.raw_json)) as SovraEvent;
          if (ev && ev.id) {
            this.indexEventInMemory(ev);
          }
        } catch {}
      }
    } catch {
      this.sqliteDb = null;
    }
  }

  private indexEventInMemory(event: SovraEvent): void {
    this.eventsById.set(event.id, event);
    let authorEvents = this.eventIdsByAuthor.get(event.pubkey);
    if (!authorEvents) {
      authorEvents = new Set();
      this.eventIdsByAuthor.set(event.pubkey, authorEvents);
    }
    authorEvents.add(event.id);
  }

  public appendEvent(event: SovraEvent): void {
    if (this.eventsById.has(event.id)) {
      return; // Already ingested (dedup / replay protection)
    }
    if (this.strictSignatures && !verifySignedSovraEvent(event)) {
      return;
    }

    this.indexEventInMemory(event);
    if (this.sqliteDb) {
      try {
        this.sqliteDb
          .prepare('INSERT OR IGNORE INTO feed_events (id, pubkey, kind, created_at, raw_json) VALUES (?, ?, ?, ?, ?)')
          .run(event.id, event.pubkey, event.kind, event.createdAt, JSON.stringify(event));
      } catch {}
    }
  }

  /**
   * Cryptographically verifies, deduplicates, persists, and indexes a signed SovraEvent.
   */
  public async ingestSignedEvent(event: SovraEvent): Promise<Result<boolean>> {
    if (!event || !event.id || !event.pubkey || !event.sig) {
      return err(new Error('Malformed SovraEvent payload'));
    }
    if (!verifySignedSovraEvent(event)) {
      return err(new Error(`Invalid cryptographic signature for event ${event.id}`));
    }
    if (this.eventsById.has(event.id)) {
      return ok(false); // Duplicate / already seen
    }

    this.indexEventInMemory(event);
    if (this.sqliteDb) {
      try {
        this.sqliteDb
          .prepare('INSERT OR IGNORE INTO feed_events (id, pubkey, kind, created_at, raw_json) VALUES (?, ?, ?, ?, ?)')
          .run(event.id, event.pubkey, event.kind, event.createdAt, JSON.stringify(event));
      } catch {}
    }

    if (
      this.graphEngine &&
      (event.kind === EventKind.Follow ||
        event.kind === EventKind.Block ||
        event.kind === EventKind.Mute ||
        event.kind === EventKind.Reaction ||
        event.kind === EventKind.FriendRequest ||
        event.kind === EventKind.ModerationAssertion)
    ) {
      await this.graphEngine.processEvent(event);
    }

    return ok(true);
  }

  public getKnownEventIds(): string[] {
    return Array.from(this.eventsById.keys());
  }

  public getMissingEventsForPeer(peerKnownIds: readonly string[], limit = 200): SovraEvent[] {
    const known = new Set(peerKnownIds);
    const missing: SovraEvent[] = [];
    for (const ev of this.eventsById.values()) {
      if (!known.has(ev.id)) {
        missing.push(ev);
      }
    }
    missing.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    return missing.slice(0, Math.max(1, limit));
  }

  public async reconcileRemoteEvents(
    events: readonly SovraEvent[],
  ): Promise<{ accepted: number; rejected: number; duplicate: number }> {
    let accepted = 0;
    let rejected = 0;
    let duplicate = 0;
    for (const ev of events) {
      const res = await this.ingestSignedEvent(ev);
      if (!res.ok) {
        rejected++;
      } else if (res.value) {
        accepted++;
      } else {
        duplicate++;
      }
    }
    return { accepted, rejected, duplicate };
  }

  public getLatestProfileMetadata(authorPubkey: string): { profile: Record<string, any>; event: SovraEvent } | null {
    const eventIds = this.eventIdsByAuthor.get(authorPubkey);
    if (!eventIds) return null;
    let latest: SovraEvent | null = null;
    for (const id of eventIds) {
      const ev = this.eventsById.get(id);
      if (!ev || ev.kind !== EventKind.Metadata) continue;
      if (!latest || ev.createdAt > latest.createdAt || (ev.createdAt === latest.createdAt && ev.id > latest.id)) {
        latest = ev;
      }
    }
    if (!latest) return null;
    try {
      return { profile: JSON.parse(latest.content), event: latest };
    } catch {
      return null;
    }
  }

  public getCommentsForEvent(targetEventId: string): readonly SovraEvent[] {
    const comments: SovraEvent[] = [];
    for (const ev of this.eventsById.values()) {
      if (ev.kind !== EventKind.ShortPost) continue;
      if (ev.tags.some(t => t[0] === 'e' && t[1] === targetEventId)) {
        comments.push(ev);
      }
    }
    return comments.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  public close(): void {
    if (this.sqliteDb) {
      try {
        this.sqliteDb.close();
      } catch {}
      this.sqliteDb = null;
    }
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
          friendsSet: new Set(),
          pendingFriendRequests: new Set(),
          sentFriendRequests: new Set(),
          blockedSet: new Set(),
          restrictedSet: new Set(),
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
          friendsSet: new Set(),
          pendingFriendRequests: new Set(),
          sentFriendRequests: new Set(),
          blockedSet: new Set(),
          restrictedSet: new Set(),
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
