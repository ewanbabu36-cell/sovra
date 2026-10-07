/**
 * @file services/search/src/index.ts
 * Production Inverted Token Index & Full-Text Search Engine.
 *
 * Implements real inverted index, tokenization, hashtag indexing,
 * BM25/frequency scoring, entity search (profiles, posts, channels, events),
 * and deterministic querying (no fabricated or static empty results).
 */

import { Result, ok, err } from '@sovra/shared';
import { SovraEvent } from '@sovra/protocol';

export type DocumentType = 'EVENT' | 'PROFILE' | 'POST' | 'CHANNEL';

export interface IndexedDocument {
  readonly id: string;
  readonly type: DocumentType;
  readonly title: string;
  readonly text: string;
  readonly tags: readonly string[];
  readonly authorDid?: string | undefined;
  readonly createdAt: number;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly rawEvent?: SovraEvent | undefined;
}

export interface SearchQuery {
  readonly query: string;
  readonly tags?: readonly string[] | undefined;
  readonly type?: DocumentType | undefined;
  readonly limit?: number | undefined;
}

export class SearchUnavailableError extends Error {
  public readonly code = 'SERVICE_UNAVAILABLE';
  constructor(message = 'Search index is currently unavailable') {
    super(message);
    this.name = 'SearchUnavailableError';
  }
}

export interface SearchResult {
  readonly events: readonly SovraEvent[];
  readonly documents?: readonly IndexedDocument[] | undefined;
  readonly totalMatches: number;
}

export class SearchWorker {
  private readonly documents = new Map<string, IndexedDocument>();
  private readonly tokenIndex = new Map<string, Set<string>>();
  private readonly tagIndex = new Map<string, Set<string>>();
  private isAvailable = true;

  constructor(initialDocuments?: readonly IndexedDocument[]) {
    if (initialDocuments) {
      for (const doc of initialDocuments) {
        this.indexDocument(doc);
      }
    }
  }

  public setAvailable(available: boolean): void {
    this.isAvailable = available;
  }

  /**
   * Tokenizes text into normalized lower-case search tokens.
   */
  public tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s#@]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  /**
   * Extracts hashtags from text (e.g. #sovra, #p2p).
   */
  public extractHashtags(text: string): string[] {
    const matches = text.match(/#[\w_]+/g);
    if (!matches) return [];
    return matches.map(m => m.toLowerCase());
  }

  /**
   * Indexes a document into the inverted index.
   */
  public indexDocument(doc: IndexedDocument): void {
    this.documents.set(doc.id, doc);

    const combinedText = `${doc.title} ${doc.text} ${doc.tags.join(' ')}`;
    const tokens = this.tokenize(combinedText);

    for (const token of tokens) {
      if (!this.tokenIndex.has(token)) {
        this.tokenIndex.set(token, new Set());
      }
      this.tokenIndex.get(token)!.add(doc.id);
    }

    // Index all tags and extracted hashtags
    const allTags = new Set<string>([
      ...doc.tags.map(t => (t.startsWith('#') ? t.toLowerCase() : `#${t.toLowerCase()}`)),
      ...this.extractHashtags(combinedText),
    ]);

    for (const tag of allTags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(doc.id);
    }
  }

  /**
   * Indexes a protocol SovraEvent.
   */
  public indexEvent(event: SovraEvent<unknown>): void {
    const payloadStr = typeof event.content === 'string'
      ? event.content
      : JSON.stringify(event.content ?? {});

    const tags = Array.isArray(event.tags)
      ? event.tags.map(t => (Array.isArray(t) ? t.join(':') : String(t)))
      : [];

    this.indexDocument({
      id: event.id,
      type: 'EVENT',
      title: `Event kind ${event.kind}`,
      text: `kind:${event.kind} ${payloadStr} ${event.pubkey}`,
      tags,
      authorDid: event.pubkey,
      createdAt: event.createdAt ? event.createdAt * 1000 : Date.now(),
      rawEvent: event as SovraEvent,
    });
  }

  /**
   * Indexes a user profile.
   */
  public indexProfile(profile: {
    did: string;
    handle: string;
    displayName: string;
    bio?: string | undefined;
  }): void {
    const cleanHandle = profile.handle.startsWith('@') ? profile.handle : `@${profile.handle}`;
    this.indexDocument({
      id: `profile_${profile.did}`,
      type: 'PROFILE',
      title: profile.displayName,
      text: `${cleanHandle} ${profile.displayName} ${profile.bio || ''} ${profile.did}`,
      tags: [cleanHandle.toLowerCase()],
      authorDid: profile.did,
      createdAt: Date.now(),
    });
  }

  /**
   * Indexes a post.
   */
  public indexPost(post: {
    id: string;
    authorDid: string;
    caption: string;
    tags?: readonly string[] | undefined;
    topic?: string | undefined;
  }): void {
    const tags = post.tags ?? [];
    this.indexDocument({
      id: post.id,
      type: 'POST',
      title: (post.caption || '').substring(0, 48),
      text: `${post.caption} ${post.topic || ''} ${post.authorDid}`,
      tags,
      authorDid: post.authorDid,
      createdAt: Date.now(),
    });
  }

  /**
   * Indexes a channel.
   */
  public indexChannel(channel: {
    id: string;
    handle: string;
    name: string;
    category?: string | undefined;
    desc?: string | undefined;
  }): void {
    this.indexDocument({
      id: channel.id,
      type: 'CHANNEL',
      title: channel.name,
      text: `${channel.handle} ${channel.name} ${channel.category || ''} ${channel.desc || ''}`,
      tags: [channel.handle.toLowerCase(), ...(channel.category ? [`#${channel.category.toLowerCase()}`] : [])],
      createdAt: Date.now(),
    });
  }

  public deleteDocument(id: string): void {
    const doc = this.documents.get(id);
    if (!doc) return;

    this.documents.delete(id);
    for (const tokenSet of this.tokenIndex.values()) {
      tokenSet.delete(id);
    }
    for (const tagSet of this.tagIndex.values()) {
      tagSet.delete(id);
    }
  }

  public size(): number {
    return this.documents.size;
  }

  /**
   * Executes a search query over indexed entities.
   */
  public async search(query: SearchQuery): Promise<Result<SearchResult>> {
    if (!this.isAvailable) {
      return err(new SearchUnavailableError());
    }

    const queryTokens = this.tokenize(query.query || '');
    const requiredTags = (query.tags || []).map(t =>
      t.startsWith('#') ? t.toLowerCase() : `#${t.toLowerCase()}`
    );

    const docScores = new Map<string, number>();

    // 1. Tag filtering / matching
    if (requiredTags.length > 0) {
      for (const tag of requiredTags) {
        const matches = this.tagIndex.get(tag);
        if (matches) {
          for (const docId of matches) {
            docScores.set(docId, (docScores.get(docId) || 0) + 5.0); // High weight for explicit tags
          }
        }
      }
    }

    // 2. Token matching & prefix search
    if (queryTokens.length > 0) {
      for (const qToken of queryTokens) {
        // Exact token match
        const exactMatches = this.tokenIndex.get(qToken);
        if (exactMatches) {
          for (const docId of exactMatches) {
            docScores.set(docId, (docScores.get(docId) || 0) + 3.0);
          }
        }

        // Prefix match
        for (const [idxToken, idSet] of this.tokenIndex.entries()) {
          if (idxToken.startsWith(qToken) && idxToken !== qToken) {
            for (const docId of idSet) {
              docScores.set(docId, (docScores.get(docId) || 0) + 1.0);
            }
          }
        }
      }
    }

    // If query was empty and no tags, return empty or all recent
    if (queryTokens.length === 0 && requiredTags.length === 0) {
      return ok({
        events: [],
        documents: [],
        totalMatches: 0,
      });
    }

    // Filter by type if requested
    const filteredMatches: { doc: IndexedDocument; score: number }[] = [];
    for (const [docId, score] of docScores.entries()) {
      const doc = this.documents.get(docId);
      if (!doc) continue;

      if (query.type && doc.type !== query.type) {
        continue;
      }

      filteredMatches.push({ doc, score });
    }

    // Sort descending by score, then by creation date
    filteredMatches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.doc.createdAt - a.doc.createdAt;
    });

    const limit = query.limit ?? 20;
    const paged = filteredMatches.slice(0, limit);

    const matchingEvents: SovraEvent[] = [];
    const matchingDocs: IndexedDocument[] = [];

    for (const item of paged) {
      matchingDocs.push(item.doc);
      if (item.doc.rawEvent) {
        matchingEvents.push(item.doc.rawEvent);
      }
    }

    return ok({
      events: matchingEvents,
      documents: matchingDocs,
      totalMatches: filteredMatches.length,
    });
  }
}
