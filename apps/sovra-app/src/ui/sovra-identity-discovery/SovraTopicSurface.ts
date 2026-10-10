/**
 * @file apps/sovra-app/src/ui/sovra-identity-discovery/SovraTopicSurface.ts
 * SOVRA Phase 6: Spatial Topic / Hashtag Discovery Surface
 *
 * Implements real hashtag / topic dispatches discovery with Latest and Popular sorting.
 */

export interface SovraTopicSurfaceOptions {
  tag: string;
  initialSort?: 'latest' | 'popular';
  onOpenPost?: (postId: string) => void;
}

export class SovraTopicSurface {
  private container: HTMLElement;
  private options: SovraTopicSurfaceOptions;
  private sort: 'latest' | 'popular';
  private posts: any[] = [];
  private isLoading: boolean = false;

  constructor(container: HTMLElement, options: SovraTopicSurfaceOptions) {
    this.container = container;
    this.options = options;
    this.sort = options.initialSort || 'latest';
  }

  public async init(): Promise<void> {
    this.renderLoading();
    await this.fetchTopicPosts();
    this.render();
  }

  private renderLoading(): void {
    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 36px; gap: 12px;">
        <div style="width: 28px; height: 28px; border: 2px solid rgba(56, 189, 248, 0.2); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <div style="color: #94a3b8; font-size: 0.82rem;">Loading topic dispatches...</div>
      </div>
    `;
  }

  public async fetchTopicPosts(): Promise<void> {
    this.isLoading = true;
    try {
      const cleanTag = this.options.tag.replace(/^#/, '');
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null;
      const res = await fetch(`/api/topics/posts?tag=${encodeURIComponent(cleanTag)}&sort=${this.sort}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      this.posts = data.ok ? data.posts : [];
    } catch {
      this.posts = [];
    } finally {
      this.isLoading = false;
    }
  }

  public render(): void {
    const cleanTag = this.options.tag.startsWith('#') ? this.options.tag : '#' + this.options.tag;

    let html = `
      <div style="display: flex; flex-direction: column; gap: 12px; padding: 4px;">
        <!-- Header -->
        <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 14px; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-size: 1.1rem; font-weight: 700; color: #38bdf8;">${cleanTag}</div>
            <div style="font-size: 0.74rem; color: #94a3b8;">${this.posts.length} published dispatch${this.posts.length === 1 ? '' : 'es'}</div>
          </div>
          <div style="display: flex; gap: 4px;">
            <button class="action-pill-btn ${this.sort === 'latest' ? 'action-pill-primary' : 'action-pill-secondary'}" style="padding: 4px 10px; font-size: 0.72rem;" id="sortTopicLatest">Latest</button>
            <button class="action-pill-btn ${this.sort === 'popular' ? 'action-pill-primary' : 'action-pill-secondary'}" style="padding: 4px 10px; font-size: 0.72rem;" id="sortTopicPopular">Popular</button>
          </div>
        </div>

        <!-- Posts List -->
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${this.isLoading ? `
            <div style="display: flex; justify-content: center; padding: 36px;">
              <div style="width: 28px; height: 28px; border: 2px solid rgba(56, 189, 248, 0.2); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
            </div>
          ` : (this.posts.length === 0 ? `
            <div style="padding: 36px; text-align: center; color: #64748b; font-size: 0.82rem;">
              No dispatches currently tagged with ${cleanTag}.
            </div>
          ` : this.posts.map(p => `
            <div class="spatial-option-card topic-post-card" data-id="${p.id}" style="cursor: pointer; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
              <div style="font-size: 0.84rem; color: #f8fafc;">${p.caption}</div>
              <div style="font-size: 0.72rem; color: #94a3b8; display: flex; gap: 12px;">
                <span>by @${p.authorName}</span>
                <span>❤️ ${p.likesCount || 0}</span>
                <span>💬 ${p.commentsCount || 0}</span>
              </div>
            </div>
          `).join(''))}
        </div>
      </div>
    `;

    this.container.innerHTML = html;
    this.bindEvents();
  }

  private bindEvents(): void {
    this.container.querySelector('#sortTopicLatest')?.addEventListener('click', async () => {
      this.sort = 'latest';
      await this.fetchTopicPosts();
      this.render();
    });

    this.container.querySelector('#sortTopicPopular')?.addEventListener('click', async () => {
      this.sort = 'popular';
      await this.fetchTopicPosts();
      this.render();
    });

    this.container.querySelectorAll('.topic-post-card').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        if (id && this.options.onOpenPost) this.options.onOpenPost(id);
      });
    });
  }
}
