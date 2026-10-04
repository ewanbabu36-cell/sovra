import { SearchTab, SearchResultItem } from './types.js';

export interface IndexablePerson {
  readonly pubkey: string;
  readonly handle: string;
  readonly displayName: string;
  readonly bio?: string | undefined;
  readonly avatarUrl?: string | undefined;
  readonly isVerified?: boolean | undefined;
}

export interface IndexableChannel {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly avatarUrl?: string | undefined;
  readonly subscriberCount: number;
}

export interface IndexablePage {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly bio: string;
  readonly category: string;
  readonly avatarUrl?: string | undefined;
  readonly followerCount: number;
}

export interface IndexablePost {
  readonly id: string;
  readonly authorName: string;
  readonly authorHandle: string;
  readonly title?: string | undefined;
  readonly caption: string;
  readonly tags: readonly string[];
  readonly mediaType?: string | undefined;
}

export interface IndexableAudio {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly usageCount: number;
}

/**
 * High-performance, client-side Omni-Search Engine.
 * Provides instant tokenized fuzzy matching, multi-tab filtering,
 * hashtag discovery, and zero-server-trace local query caching.
 */
export class OmniSearchEngine {
  private readonly people = new Map<string, IndexablePerson>();
  private readonly channels = new Map<string, IndexableChannel>();
  private readonly pages = new Map<string, IndexablePage>();
  private readonly posts = new Map<string, IndexablePost>();
  private readonly audioTracks = new Map<string, IndexableAudio>();
  private readonly hashtagCounts = new Map<string, number>();
  private readonly recentSearches: string[] = [];

  // --- Registration / Ingestion APIs ---
  public indexPerson(person: IndexablePerson): void {
    this.people.set(person.pubkey, person);
  }

  public indexChannel(channel: IndexableChannel): void {
    this.channels.set(channel.id, channel);
  }

  public indexPage(page: IndexablePage): void {
    this.pages.set(page.id, page);
  }

  public indexPost(post: IndexablePost): void {
    this.posts.set(post.id, post);

    // Track hashtags from post tags
    for (const tag of post.tags) {
      const cleanTag = tag.startsWith('#') ? tag.toLowerCase() : `#${tag.toLowerCase()}`;
      const count = this.hashtagCounts.get(cleanTag) ?? 0;
      this.hashtagCounts.set(cleanTag, count + 1);
    }
  }

  public indexAudio(audio: IndexableAudio): void {
    this.audioTracks.set(audio.id, audio);
  }

  // --- Search Execution ---
  public search(query: string, tab: SearchTab = 'all', limit = 20): readonly SearchResultItem[] {
    const rawQuery = query.trim().toLowerCase();
    if (!rawQuery) {
      return this.getTrendingSuggestions(tab, limit);
    }

    const tokens = rawQuery.split(/\s+/).filter(t => t.length > 0);
    const results: SearchResultItem[] = [];

    // 1. Search People
    if (tab === 'all' || tab === 'people') {
      for (const p of this.people.values()) {
        const text = `${p.handle} ${p.displayName} ${p.bio ?? ''}`.toLowerCase();
        if (tokens.every(t => text.includes(t))) {
          results.push({
            id: p.pubkey,
            type: 'person',
            title: p.displayName,
            subtitle: p.bio,
            handle: p.handle,
            avatarUrl: p.avatarUrl,
            metadata: { isVerified: p.isVerified },
          });
        }
      }
    }

    // 2. Search Channels
    if (tab === 'all' || tab === 'channels') {
      for (const ch of this.channels.values()) {
        const text = `${ch.handle} ${ch.name} ${ch.description} ${ch.category}`.toLowerCase();
        if (tokens.every(t => text.includes(t))) {
          results.push({
            id: ch.id,
            type: 'channel',
            title: ch.name,
            subtitle: ch.description,
            handle: ch.handle,
            category: ch.category,
            count: ch.subscriberCount,
            avatarUrl: ch.avatarUrl,
          });
        }
      }
    }

    // 3. Search Pages
    if (tab === 'all' || tab === 'pages') {
      for (const pg of this.pages.values()) {
        const text = `${pg.handle} ${pg.name} ${pg.bio} ${pg.category}`.toLowerCase();
        if (tokens.every(t => text.includes(t))) {
          results.push({
            id: pg.id,
            type: 'page',
            title: pg.name,
            subtitle: pg.bio,
            handle: pg.handle,
            category: pg.category,
            count: pg.followerCount,
            avatarUrl: pg.avatarUrl,
          });
        }
      }
    }

    // 4. Search Media / Posts
    if (tab === 'all' || tab === 'media') {
      for (const post of this.posts.values()) {
        const tagText = post.tags.join(' ');
        const text = `${post.title ?? ''} ${post.caption} ${post.authorName} ${tagText}`.toLowerCase();
        if (tokens.every(t => text.includes(t))) {
          results.push({
            id: post.id,
            type: 'post',
            title: post.title || post.caption.slice(0, 40),
            subtitle: `By ${post.authorName} • ${post.caption}`,
            handle: post.authorHandle,
            metadata: { tags: post.tags, mediaType: post.mediaType },
          });
        }
      }
    }

    // 5. Search Hashtags
    if (tab === 'all' || tab === 'hashtags') {
      for (const [tag, count] of this.hashtagCounts.entries()) {
        if (tokens.every(t => tag.includes(t))) {
          results.push({
            id: tag,
            type: 'hashtag',
            title: tag,
            subtitle: `${count.toLocaleString()} posts`,
            count,
          });
        }
      }
    }

    // 6. Search Audio Tracks
    if (tab === 'all' || tab === 'audio') {
      for (const audio of this.audioTracks.values()) {
        const text = `${audio.title} ${audio.artist}`.toLowerCase();
        if (tokens.every(t => text.includes(t))) {
          results.push({
            id: audio.id,
            type: 'audio',
            title: audio.title,
            subtitle: `Original Audio • ${audio.artist}`,
            count: audio.usageCount,
          });
        }
      }
    }

    return results.slice(0, limit);
  }

  /**
   * Returns default recommendations and trending items when query is empty.
   */
  public getTrendingSuggestions(tab: SearchTab = 'all', limit = 10): readonly SearchResultItem[] {
    const list: SearchResultItem[] = [];

    if (tab === 'all' || tab === 'hashtags') {
      const sortedTags = Array.from(this.hashtagCounts.entries()).sort((a, b) => b[1] - a[1]);
      for (const [tag, count] of sortedTags.slice(0, 5)) {
        list.push({
          id: tag,
          type: 'hashtag',
          title: tag,
          subtitle: `Trending • ${count} posts`,
          count,
        });
      }
    }

    if (tab === 'all' || tab === 'channels') {
      const topChannels = Array.from(this.channels.values()).sort((a, b) => b.subscriberCount - a.subscriberCount);
      for (const ch of topChannels.slice(0, 5)) {
        list.push({
          id: ch.id,
          type: 'channel',
          title: ch.name,
          subtitle: `${ch.subscriberCount.toLocaleString()} subscribers`,
          handle: ch.handle,
          category: ch.category,
        });
      }
    }

    if (tab === 'all' || tab === 'audio') {
      const topAudio = Array.from(this.audioTracks.values()).sort((a, b) => b.usageCount - a.usageCount);
      for (const a of topAudio.slice(0, 5)) {
        list.push({
          id: a.id,
          type: 'audio',
          title: a.title,
          subtitle: `${a.artist} • ${a.usageCount.toLocaleString()} reels`,
          count: a.usageCount,
        });
      }
    }

    return list.slice(0, limit);
  }

  // --- Local Search History Management ---
  public addRecentSearch(query: string): void {
    const clean = query.trim();
    if (!clean) return;

    const existingIdx = this.recentSearches.indexOf(clean);
    if (existingIdx !== -1) {
      this.recentSearches.splice(existingIdx, 1);
    }
    this.recentSearches.unshift(clean);
    if (this.recentSearches.length > 10) {
      this.recentSearches.pop();
    }
  }

  public getRecentSearches(): readonly string[] {
    return [...this.recentSearches];
  }

  public clearRecentSearches(): void {
    this.recentSearches.length = 0;
  }
}
