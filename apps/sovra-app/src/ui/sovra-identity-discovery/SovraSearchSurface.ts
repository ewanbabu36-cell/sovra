/**
 * @file apps/sovra-app/src/ui/sovra-identity-discovery/SovraSearchSurface.ts
 * SOVRA Phase 6: Spatial Search & Discovery Surface
 *
 * Implements unified, debounced search across People, Channels, Pages,
 * Groups, Posts, Videos, and Topics with privacy boundaries.
 */

import { SearchScope, SearchResultsPayload, AutocompleteSuggestion } from './types.js';

export interface SovraSearchSurfaceOptions {
  initialQuery?: string;
  initialScope?: SearchScope;
  originEl?: HTMLElement | null;
  onOpenProfile?: (did: string) => void;
  onOpenVideo?: (videoId: string) => void;
  onOpenSpace?: (spaceId: string, spaceType: 'channel' | 'page' | 'group') => void;
  onOpenTopic?: (tag: string) => void;
}

export class SovraSearchSurface {
  private container: HTMLElement;
  private options: SovraSearchSurfaceOptions;
  private currentQuery: string = '';
  private currentScope: SearchScope = 'all';
  private results: SearchResultsPayload | null = null;
  private suggestions: AutocompleteSuggestion[] = [];
  private isLoading: boolean = false;
  private debounceTimer: any = null;
  private abortController: AbortController | null = null;

  constructor(container: HTMLElement, options: SovraSearchSurfaceOptions = {}) {
    this.container = container;
    this.options = options;
    this.currentQuery = options.initialQuery || '';
    this.currentScope = options.initialScope || 'all';
  }

  public async init(): Promise<void> {
    this.render();
    if (this.currentQuery) {
      await this.executeSearch(this.currentQuery);
    }
  }

  public render(): void {
    const scopes: { key: SearchScope; label: string }[] = [
      { key: 'all', label: 'All' },
      { key: 'people', label: 'People' },
      { key: 'channels', label: 'Channels' },
      { key: 'pages', label: 'Pages' },
      { key: 'groups', label: 'Groups' },
      { key: 'posts', label: 'Posts' },
      { key: 'videos', label: 'Videos' },
      { key: 'topics', label: 'Topics' },
    ];

    let html = `
      <div style="display: flex; flex-direction: column; gap: 12px; padding: 4px;">
        <!-- 1. SEARCH INPUT BAR -->
        <div style="position: relative;">
          <input
            type="text"
            id="spatialSearchInput"
            value="${this.currentQuery}"
            placeholder="Search SOVRA..."
            style="width: 100%; box-sizing: border-box; background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 12px; padding: 10px 38px 10px 14px; font-size: 0.9rem; color: #f8fafc; outline: none; box-shadow: 0 4px 20px rgba(0,0,0,0.3);"
            autocomplete="off"
          />
          <button id="spatialSearchClear" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #94a3b8; cursor: pointer; display: ${this.currentQuery ? 'block' : 'none'};">✕</button>
        </div>

        <!-- 2. SCOPE CATEGORY PILLS -->
        <div style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none;">
          ${scopes.map(s => `
            <button
              class="action-pill-btn ${this.currentScope === s.key ? 'action-pill-primary' : 'action-pill-secondary'} scope-filter-btn"
              data-scope="${s.key}"
              style="padding: 4px 12px; font-size: 0.74rem; white-space: nowrap;"
            >
              ${s.label}
            </button>
          `).join('')}
        </div>

        <!-- 3. SUGGESTIONS DROPDOWN (if any) -->
        <div id="spatialSearchSuggestions" style="display: ${this.suggestions.length > 0 ? 'flex' : 'none'}; flex-direction: column; gap: 6px; background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 10px; padding: 8px;">
          ${this.suggestions.map(sg => `
            <div class="spatial-option-card suggestion-item" data-id="${sg.id}" data-type="${sg.type}" style="cursor: pointer; padding: 8px 12px; display: flex; align-items: center; gap: 10px;">
              <span>${sg.avatar || (sg.type === 'topic' ? '🏷️' : (sg.type === 'channel' ? '📢' : '👤'))}</span>
              <div>
                <div style="font-size: 0.8rem; font-weight: 600; color: #f8fafc;">${sg.title}</div>
                ${sg.subtitle ? `<div style="font-size: 0.7rem; color: #94a3b8;">${sg.subtitle}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>

        <!-- 4. SEARCH RESULTS CONTAINER -->
        <div id="spatialSearchResults" style="display: flex; flex-direction: column; gap: 10px; margin-top: 4px;">
          ${this.isLoading ? `
            <div style="display: flex; justify-content: center; padding: 36px;">
              <div style="width: 28px; height: 28px; border: 2px solid rgba(56, 189, 248, 0.2); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
            </div>
          ` : this.renderResults()}
        </div>
      </div>
    `;

    this.container.innerHTML = html;
    this.bindEvents();
  }

  private renderResults(): string {
    if (!this.results) {
      return `
        <div style="text-align: center; padding: 48px 16px; color: #64748b; font-size: 0.82rem;">
          Type a query above to search sovereign entities, media, and dispatches.
        </div>
      `;
    }

    const { users, channels, pages, groups, posts, videos, topics } = this.results;
    const hasAny = (users.length + channels.length + pages.length + groups.length + posts.length + videos.length + topics.length) > 0;

    if (!hasAny) {
      return `
        <div style="text-align: center; padding: 48px 16px; color: #64748b; font-size: 0.84rem;">
          No matching sovereign entities or dispatches found.
        </div>
      `;
    }

    let out = '';

    // People
    if ((this.currentScope === 'all' || this.currentScope === 'people') && users.length > 0) {
      out += `
        <div style="font-size: 0.76rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-top: 6px;">People (${users.length})</div>
        ${users.map(u => `
          <div class="spatial-option-card result-user" data-did="${u.did}" style="cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <span style="font-size: 1.3rem;">${u.avatar || '👤'}</span>
              <div>
                <div style="font-weight: 600; color: #f8fafc; font-size: 0.85rem;">${u.displayName || u.name}</div>
                <div style="font-size: 0.72rem; color: #38bdf8;">${u.handle}</div>
              </div>
            </div>
            <span style="color: #64748b;">›</span>
          </div>
        `).join('')}
      `;
    }

    // Channels
    if ((this.currentScope === 'all' || this.currentScope === 'channels') && channels.length > 0) {
      out += `
        <div style="font-size: 0.76rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-top: 8px;">Channels (${channels.length})</div>
        ${channels.map(c => `
          <div class="spatial-option-card result-channel" data-id="${c.id}" style="cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;">
            <div>
              <div style="font-weight: 600; color: #f8fafc; font-size: 0.85rem;">📢 ${c.name}</div>
              <div style="font-size: 0.72rem; color: #38bdf8;">${c.handle} • ${c.count || 0} subscribers</div>
            </div>
            <span style="color: #64748b;">›</span>
          </div>
        `).join('')}
      `;
    }

    // Pages
    if ((this.currentScope === 'all' || this.currentScope === 'pages') && pages.length > 0) {
      out += `
        <div style="font-size: 0.76rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-top: 8px;">Pages (${pages.length})</div>
        ${pages.map(p => `
          <div class="spatial-option-card result-page" data-id="${p.id}" style="cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;">
            <div>
              <div style="font-weight: 600; color: #f8fafc; font-size: 0.85rem;">📄 ${p.name}</div>
              <div style="font-size: 0.72rem; color: #10b981;">${p.handle} • ${p.count || 0} followers</div>
            </div>
            <span style="color: #64748b;">›</span>
          </div>
        `).join('')}
      `;
    }

    // Groups
    if ((this.currentScope === 'all' || this.currentScope === 'groups') && groups.length > 0) {
      out += `
        <div style="font-size: 0.76rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-top: 8px;">Groups (${groups.length})</div>
        ${groups.map(g => `
          <div class="spatial-option-card result-group" data-id="${g.id}" style="cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;">
            <div>
              <div style="font-weight: 600; color: #f8fafc; font-size: 0.85rem;">👥 ${g.name}</div>
              <div style="font-size: 0.72rem; color: #c084fc;">${g.privacy === 'private' ? '🔒 Private' : '🌐 Public'} • ${g.memberCount || 0} members</div>
            </div>
            <span style="color: #64748b;">›</span>
          </div>
        `).join('')}
      `;
    }

    // Videos
    if ((this.currentScope === 'all' || this.currentScope === 'videos') && videos.length > 0) {
      out += `
        <div style="font-size: 0.76rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-top: 8px;">Videos (${videos.length})</div>
        ${videos.map(v => `
          <div class="spatial-option-card result-video" data-id="${v.id}" style="cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;">
            <div>
              <div style="font-weight: 600; color: #f8fafc; font-size: 0.85rem;">▶ ${v.title}</div>
              <div style="font-size: 0.72rem; color: #94a3b8;">${v.channelName} • ${v.duration} • ${v.views} views</div>
            </div>
            <span style="color: #64748b;">›</span>
          </div>
        `).join('')}
      `;
    }

    // Topics
    if ((this.currentScope === 'all' || this.currentScope === 'topics') && topics.length > 0) {
      out += `
        <div style="font-size: 0.76rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-top: 8px;">Topics (${topics.length})</div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${topics.map(t => `
            <div class="spatial-option-card result-topic" data-tag="${t.tag}" style="cursor: pointer; padding: 6px 14px; font-size: 0.78rem; font-weight: 600; color: #38bdf8;">
              ${t.tag} <span style="font-size: 0.7rem; color: #94a3b8; margin-left: 4px;">(${t.count})</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Posts
    if ((this.currentScope === 'all' || this.currentScope === 'posts') && posts.length > 0) {
      out += `
        <div style="font-size: 0.76rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-top: 8px;">Dispatches (${posts.length})</div>
        ${posts.map(p => `
          <div class="spatial-option-card result-post" data-id="${p.id}" style="cursor: pointer; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
            <div style="font-size: 0.82rem; color: #f8fafc;">${p.caption}</div>
            <div style="font-size: 0.7rem; color: #94a3b8;">by ${p.authorName} • ❤️ ${p.likesCount || 0}</div>
          </div>
        `).join('')}
      `;
    }

    return out;
  }

  public async executeSearch(query: string): Promise<void> {
    if (!query.trim()) {
      this.results = null;
      this.isLoading = false;
      this.render();
      return;
    }

    this.isLoading = true;
    this.render();

    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null;
      const url = `/api/search?q=${encodeURIComponent(query)}&scope=${encodeURIComponent(this.currentScope)}`;
      const res = await fetch(url, {
        signal: this.abortController.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data.ok) {
        this.results = data;
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        this.results = null;
      }
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  private async fetchAutocomplete(query: string): Promise<void> {
    if (!query || query.length < 2) {
      this.suggestions = [];
      return;
    }
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null;
      const res = await fetch(`/api/search/autocomplete?q=${encodeURIComponent(query)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.suggestions)) {
        this.suggestions = data.suggestions;
        const suggEl = this.container.querySelector('#spatialSearchSuggestions') as HTMLElement;
        if (suggEl) {
          suggEl.style.display = this.suggestions.length > 0 ? 'flex' : 'none';
        }
      }
    } catch {}
  }

  private bindEvents(): void {
    const input = this.container.querySelector('#spatialSearchInput') as HTMLInputElement;
    const clearBtn = this.container.querySelector('#spatialSearchClear') as HTMLButtonElement;

    input?.focus();
    input?.addEventListener('input', () => {
      this.currentQuery = input.value;
      if (clearBtn) clearBtn.style.display = this.currentQuery ? 'block' : 'none';

      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(async () => {
        await Promise.all([
          this.executeSearch(this.currentQuery),
          this.fetchAutocomplete(this.currentQuery),
        ]);
      }, 350);
    });

    clearBtn?.addEventListener('click', () => {
      this.currentQuery = '';
      input.value = '';
      clearBtn.style.display = 'none';
      this.suggestions = [];
      this.executeSearch('');
    });

    // Scope filter buttons
    this.container.querySelectorAll('.scope-filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.currentScope = (e.currentTarget as HTMLElement).getAttribute('data-scope') as SearchScope;
        this.executeSearch(this.currentQuery);
      });
    });

    // Result clicks
    this.container.querySelectorAll('.result-user').forEach(el => {
      el.addEventListener('click', () => {
        const did = el.getAttribute('data-did');
        if (did && this.options.onOpenProfile) this.options.onOpenProfile(did);
        else if (did) document.dispatchEvent(new CustomEvent('sovra-open-profile', { detail: { did } }));
      });
    });

    this.container.querySelectorAll('.result-video').forEach(el => {
      el.addEventListener('click', () => {
        const vidId = el.getAttribute('data-id');
        if (vidId && this.options.onOpenVideo) this.options.onOpenVideo(vidId);
        else if (vidId) document.dispatchEvent(new CustomEvent('sovra-open-video', { detail: { videoId: vidId } }));
      });
    });

    this.container.querySelectorAll('.result-channel').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        if (id) document.dispatchEvent(new CustomEvent('sovra-open-space', { detail: { spaceId: id, spaceType: 'channel' } }));
      });
    });

    this.container.querySelectorAll('.result-page').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        if (id) document.dispatchEvent(new CustomEvent('sovra-open-space', { detail: { spaceId: id, spaceType: 'page' } }));
      });
    });

    this.container.querySelectorAll('.result-group').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        if (id) document.dispatchEvent(new CustomEvent('sovra-open-space', { detail: { spaceId: id, spaceType: 'group' } }));
      });
    });

    this.container.querySelectorAll('.result-topic').forEach(el => {
      el.addEventListener('click', () => {
        const tag = el.getAttribute('data-tag');
        if (tag) document.dispatchEvent(new CustomEvent('sovra-open-topic', { detail: { tag } }));
      });
    });
  }
}
