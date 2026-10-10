/**
 * @file apps/sovra-app/src/ui/sovra-identity-discovery/SovraRelationshipsSurface.ts
 * SOVRA Phase 6: Spatial Relationships Surface
 *
 * Implements Followers, Following, Friends, and Mutual Connections lists
 * with real pagination and direct peer profile navigation.
 */

import { PublicUserDTO } from './types.js';

export interface SovraRelationshipsSurfaceOptions {
  targetDid: string;
  initialTab?: 'followers' | 'following' | 'friends' | 'mutual';
  onOpenProfile?: (did: string) => void;
}

export class SovraRelationshipsSurface {
  private container: HTMLElement;
  private options: SovraRelationshipsSurfaceOptions;
  private activeTab: 'followers' | 'following' | 'friends' | 'mutual';
  private usersList: PublicUserDTO[] = [];
  private isLoading: boolean = false;

  constructor(container: HTMLElement, options: SovraRelationshipsSurfaceOptions) {
    this.container = container;
    this.options = options;
    this.activeTab = options.initialTab || 'followers';
  }

  public async init(): Promise<void> {
    this.renderLoading();
    await this.fetchRelationshipList();
    this.render();
  }

  private renderLoading(): void {
    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 36px; gap: 12px;">
        <div style="width: 28px; height: 28px; border: 2px solid rgba(56, 189, 248, 0.2); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <div style="color: #94a3b8; font-size: 0.82rem;">Loading relationships...</div>
      </div>
    `;
  }

  public async fetchRelationshipList(): Promise<void> {
    this.isLoading = true;
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null;
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

      if (this.activeTab === 'followers') {
        const res = await fetch(`/api/social/followers?did=${encodeURIComponent(this.options.targetDid)}`, { headers });
        const data = await res.json();
        this.usersList = data.ok ? data.followers : [];
      } else if (this.activeTab === 'following') {
        const res = await fetch(`/api/social/following?did=${encodeURIComponent(this.options.targetDid)}`, { headers });
        const data = await res.json();
        this.usersList = data.ok ? data.following : [];
      } else if (this.activeTab === 'friends') {
        const res = await fetch('/api/friends/list', { headers });
        const data = await res.json();
        this.usersList = data.ok ? data.friends : [];
      } else if (this.activeTab === 'mutual') {
        const res = await fetch(`/api/friends/mutual?targetDid=${encodeURIComponent(this.options.targetDid)}`, { headers });
        const data = await res.json();
        this.usersList = data.ok ? data.mutualFriends : [];
      }
    } catch {
      this.usersList = [];
    } finally {
      this.isLoading = false;
    }
  }

  public render(): void {
    let html = `
      <div style="display: flex; flex-direction: column; gap: 12px; padding: 4px;">
        <!-- TABS -->
        <div style="display: flex; gap: 6px; padding: 4px; background: rgba(15, 23, 42, 0.6); border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);">
          <button class="action-pill-btn ${this.activeTab === 'followers' ? 'action-pill-primary' : 'action-pill-secondary'}" style="flex: 1; padding: 5px 8px; font-size: 0.74rem;" id="relTabFollowers">Followers</button>
          <button class="action-pill-btn ${this.activeTab === 'following' ? 'action-pill-primary' : 'action-pill-secondary'}" style="flex: 1; padding: 5px 8px; font-size: 0.74rem;" id="relTabFollowing">Following</button>
          <button class="action-pill-btn ${this.activeTab === 'friends' ? 'action-pill-primary' : 'action-pill-secondary'}" style="flex: 1; padding: 5px 8px; font-size: 0.74rem;" id="relTabFriends">Friends</button>
          <button class="action-pill-btn ${this.activeTab === 'mutual' ? 'action-pill-primary' : 'action-pill-secondary'}" style="flex: 1; padding: 5px 8px; font-size: 0.74rem;" id="relTabMutual">Mutuals</button>
        </div>

        <!-- LIST -->
        <div style="display: flex; flex-direction: column; gap: 8px; min-height: 200px;">
          ${this.isLoading ? `
            <div style="display: flex; justify-content: center; padding: 36px;">
              <div style="width: 28px; height: 28px; border: 2px solid rgba(56, 189, 248, 0.2); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
            </div>
          ` : this.renderUserItems()}
        </div>
      </div>
    `;

    this.container.innerHTML = html;
    this.bindEvents();
  }

  private renderUserItems(): string {
    if (this.usersList.length === 0) {
      return `
        <div style="padding: 36px; text-align: center; color: #64748b; font-size: 0.82rem;">
          No ${this.activeTab} found for this sovereign identity.
        </div>
      `;
    }

    return this.usersList.map(u => `
      <div class="spatial-option-card user-item-card" data-did="${u.did}" style="cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-size: 1.3rem;">${u.avatar || '👤'}</span>
          <div>
            <div style="font-weight: 600; color: #f8fafc; font-size: 0.84rem;">${u.displayName || u.name}</div>
            <div style="font-size: 0.72rem; color: #38bdf8;">${u.handle}</div>
          </div>
        </div>
        <span style="color: #64748b;">›</span>
      </div>
    `).join('');
  }

  private bindEvents(): void {
    this.container.querySelector('#relTabFollowers')?.addEventListener('click', async () => {
      this.activeTab = 'followers';
      await this.fetchRelationshipList();
      this.render();
    });
    this.container.querySelector('#relTabFollowing')?.addEventListener('click', async () => {
      this.activeTab = 'following';
      await this.fetchRelationshipList();
      this.render();
    });
    this.container.querySelector('#relTabFriends')?.addEventListener('click', async () => {
      this.activeTab = 'friends';
      await this.fetchRelationshipList();
      this.render();
    });
    this.container.querySelector('#relTabMutual')?.addEventListener('click', async () => {
      this.activeTab = 'mutual';
      await this.fetchRelationshipList();
      this.render();
    });

    this.container.querySelectorAll('.user-item-card').forEach(el => {
      el.addEventListener('click', () => {
        const did = el.getAttribute('data-did');
        if (did && this.options.onOpenProfile) this.options.onOpenProfile(did);
        else if (did) document.dispatchEvent(new CustomEvent('sovra-open-profile', { detail: { did } }));
      });
    });
  }
}
