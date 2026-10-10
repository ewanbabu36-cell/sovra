/**
 * @file apps/sovra-app/src/ui/sovra-identity-discovery/SovraProfileSurface.ts
 * SOVRA Phase 6: Spatial Profile Surface
 *
 * Implements real identity rendering, real metrics, mutual connections,
 * contextual relationship actions (follow, add friend, message, block),
 * and tabbed spaces (Posts, Channels, Pages, Groups).
 */

import { FullProfileResponse } from './types.js';

export interface SovraProfileSurfaceOptions {
  targetDid?: string;
  originEl?: HTMLElement | null;
  onNavigateSpace?: (spaceId: string, spaceType: 'channel' | 'page' | 'group') => void;
  onOpenRelationships?: (did: string, tab: 'followers' | 'following' | 'friends' | 'mutual') => void;
  onOpenChat?: (peerDid: string) => void;
}

export class SovraProfileSurface {
  private container: HTMLElement;
  private options: SovraProfileSurfaceOptions;
  private profileData: FullProfileResponse | null = null;
  private activeTab: 'posts' | 'channels' | 'pages' | 'groups' = 'posts';

  constructor(container: HTMLElement, options: SovraProfileSurfaceOptions = {}) {
    this.container = container;
    this.options = options;
  }

  public async init(): Promise<void> {
    this.renderLoading();
    await this.fetchProfile();
    this.render();
  }

  private renderLoading(): void {
    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 16px; gap: 14px;">
        <div style="width: 32px; height: 32px; border: 2px solid rgba(56, 189, 248, 0.2); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <div style="color: #94a3b8; font-size: 0.84rem;">Loading sovereign identity...</div>
      </div>
    `;
  }

  public async fetchProfile(): Promise<void> {
    try {
      const url = this.options.targetDid 
        ? `/api/user/profile?did=${encodeURIComponent(this.options.targetDid)}`
        : '/api/user/profile';
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null;
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(url, { headers });
      this.profileData = await res.json();
    } catch (err) {
      this.profileData = {
        ok: false,
        error: String(err),
      };
    }
  }

  public render(): void {
    if (!this.profileData || !this.profileData.ok || !this.profileData.user) {
      if (this.profileData?.isBlocked) {
        this.container.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 24px; text-align: center; gap: 12px;">
            <div style="font-size: 2.2rem;">🚫</div>
            <div style="color: #f8fafc; font-weight: 700; font-size: 1.05rem;">User Unavailable</div>
            <div style="color: #94a3b8; font-size: 0.82rem; max-width: 300px;">This sovereign profile cannot be accessed due to peer restriction.</div>
          </div>
        `;
        return;
      }
      this.container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 24px; text-align: center; gap: 12px;">
          <div style="font-size: 2rem;">👤</div>
          <div style="color: #f8fafc; font-weight: 700; font-size: 1.05rem;">Profile Not Found</div>
          <div style="color: #94a3b8; font-size: 0.82rem;">${this.profileData?.error || 'Unable to load profile data.'}</div>
        </div>
      `;
      return;
    }

    const { user, stats, relationship, isPrivate } = this.profileData;
    const isSelf = relationship?.isSelf ?? false;
    const displayName = user.displayName || user.name || 'Sovereign Peer';
    const handle = user.handle || '@peer';
    const avatar = user.avatarDataUrl || user.avatar || '👤';
    const bio = user.bio || 'Sovereign entity on the SOVRA P2P mesh network.';

    let html = `
      <div style="display: flex; flex-direction: column; gap: 16px; padding: 4px;">
        <!-- 1. IDENTITY HEADER CARD -->
        <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(56, 189, 248, 0.22); border-radius: 16px; padding: 18px; backdrop-filter: blur(12px); box-shadow: 0 8px 32px rgba(0,0,0,0.4);">
          <div style="display: flex; align-items: flex-start; gap: 16px;">
            <!-- Avatar -->
            <div style="position: relative; flex-shrink: 0;">
              ${avatar.startsWith('data:') || avatar.startsWith('http') || avatar.startsWith('/api')
                ? `<img src="${avatar}" alt="${displayName}" style="width: 64px; height: 64px; border-radius: 50%; object-fit: cover; border: 2px solid #38bdf8; box-shadow: 0 0 16px rgba(56, 189, 248, 0.35);" />`
                : `<div style="width: 64px; height: 64px; border-radius: 50%; background: ${user.avatarBg || '#6366f1'}; display: flex; align-items: center; justify-content: center; font-size: 1.8rem; border: 2px solid #38bdf8; box-shadow: 0 0 16px rgba(56, 189, 248, 0.35);">${avatar}</div>`}
              <span style="position: absolute; bottom: 0; right: 0; width: 14px; height: 14px; border-radius: 50%; background: #10b981; border: 2px solid #0f172a;" title="Online node"></span>
            </div>

            <!-- Names & Bio -->
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <h2 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${displayName}</h2>
                <span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 6px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 600;">VERIFIED</span>
              </div>
              <div style="font-family: monospace; font-size: 0.8rem; color: #38bdf8; margin-top: 2px;">${handle}</div>
              <div style="font-size: 0.78rem; color: #cbd5e1; margin-top: 8px; line-height: 1.4;">${bio}</div>
            </div>
          </div>

          <!-- 2. METRICS ROW -->
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 18px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.08); text-align: center;">
            <div style="cursor: pointer;" onclick="document.dispatchEvent(new CustomEvent('sovra-profile-open-rel', { detail: { did: '${user.did}', tab: 'posts' } }))">
              <div style="font-weight: 700; font-size: 1.05rem; color: #f8fafc;">${stats?.postsCount ?? 0}</div>
              <div style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">Posts</div>
            </div>
            <div style="cursor: pointer;" onclick="document.dispatchEvent(new CustomEvent('sovra-profile-open-rel', { detail: { did: '${user.did}', tab: 'followers' } }))">
              <div style="font-weight: 700; font-size: 1.05rem; color: #f8fafc;">${stats?.followersCount ?? 0}</div>
              <div style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">Followers</div>
            </div>
            <div style="cursor: pointer;" onclick="document.dispatchEvent(new CustomEvent('sovra-profile-open-rel', { detail: { did: '${user.did}', tab: 'following' } }))">
              <div style="font-weight: 700; font-size: 1.05rem; color: #f8fafc;">${stats?.followingCount ?? 0}</div>
              <div style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">Following</div>
            </div>
            <div style="cursor: pointer;" onclick="document.dispatchEvent(new CustomEvent('sovra-profile-open-rel', { detail: { did: '${user.did}', tab: 'friends' } }))">
              <div style="font-weight: 700; font-size: 1.05rem; color: #f8fafc;">${stats?.friendsCount ?? 0}</div>
              <div style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">Friends</div>
            </div>
          </div>

          ${stats?.mutualFriendsCount && stats.mutualFriendsCount > 0 ? `
            <div style="margin-top: 10px; font-size: 0.74rem; color: #38bdf8; display: flex; align-items: center; gap: 6px; cursor: pointer;" onclick="document.dispatchEvent(new CustomEvent('sovra-profile-open-rel', { detail: { did: '${user.did}', tab: 'mutual' } }))">
              <span>👥</span>
              <span>${stats.mutualFriendsCount} mutual friend${stats.mutualFriendsCount === 1 ? '' : 's'}</span>
            </div>
          ` : ''}

          <!-- 3. ACTIONS BAR -->
          <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px;">
            ${isSelf ? `
              <button class="action-pill-btn action-pill-primary" style="flex: 1; padding: 7px 14px; font-size: 0.78rem;" id="btnEditProfile">✏️ Edit Profile</button>
              <button class="action-pill-btn action-pill-secondary" style="flex: 1; padding: 7px 14px; font-size: 0.78rem;" id="btnSettingsPrivacy">⚙️ Privacy</button>
            ` : `
              <!-- Follow / Following -->
              <button class="action-pill-btn ${relationship?.isFollowing ? 'action-pill-secondary' : 'action-pill-primary'}" style="flex: 1; padding: 7px 14px; font-size: 0.78rem;" id="btnToggleFollow">
                ${relationship?.isFollowing ? '✓ Following' : '+ Follow'}
              </button>

              <!-- Add Friend / Pending / Accepted -->
              <button class="action-pill-btn action-pill-secondary" style="flex: 1; padding: 7px 14px; font-size: 0.78rem;" id="btnFriendAction">
                ${relationship?.friendshipStatus === 'accepted' ? '👥 Friends' :
                  (relationship?.friendshipStatus === 'pending_sent' ? '⏳ Request Sent' :
                  (relationship?.friendshipStatus === 'pending_received' ? '✓ Accept Friend' : '+ Add Friend'))}
              </button>

              <!-- Message -->
              ${relationship?.canMessage ? `
                <button class="action-pill-btn action-pill-secondary" style="padding: 7px 14px; font-size: 0.78rem;" id="btnSendMessage">💬 Message</button>
              ` : ''}

              <!-- Block / Unblock -->
              <button class="action-pill-btn" style="padding: 7px 12px; font-size: 0.78rem; background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.35); color: #f87171;" id="btnBlockAction">
                ${relationship?.isBlocked ? 'Unblock' : 'Block'}
              </button>
            `}
          </div>
        </div>
    `;

    // If private and not self/friend
    if (isPrivate) {
      html += `
        <div style="background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 36px 20px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px;">
          <div style="font-size: 2rem;">🔒</div>
          <div style="color: #f8fafc; font-weight: 700; font-size: 0.96rem;">This Sovereign Account is Private</div>
          <div style="color: #94a3b8; font-size: 0.8rem; max-width: 320px;">Send a friend request to view their published dispatches and spaces.</div>
        </div>
      </div>`;
      this.container.innerHTML = html;
      this.bindEvents();
      return;
    }

    // 4. SPACES & CONTENT TABS
    html += `
      <div style="display: flex; gap: 6px; padding: 4px; background: rgba(15, 23, 42, 0.6); border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);">
        <button class="action-pill-btn ${this.activeTab === 'posts' ? 'action-pill-primary' : 'action-pill-secondary'}" style="flex: 1; padding: 5px 8px; font-size: 0.74rem;" id="tabPosts">Posts (${stats?.postsCount ?? 0})</button>
        <button class="action-pill-btn ${this.activeTab === 'channels' ? 'action-pill-primary' : 'action-pill-secondary'}" style="flex: 1; padding: 5px 8px; font-size: 0.74rem;" id="tabChannels">Channels (${stats?.channelsCount ?? 0})</button>
        <button class="action-pill-btn ${this.activeTab === 'pages' ? 'action-pill-primary' : 'action-pill-secondary'}" style="flex: 1; padding: 5px 8px; font-size: 0.74rem;" id="tabPages">Pages (${stats?.pagesCount ?? 0})</button>
        <button class="action-pill-btn ${this.activeTab === 'groups' ? 'action-pill-primary' : 'action-pill-secondary'}" style="flex: 1; padding: 5px 8px; font-size: 0.74rem;" id="tabGroups">Groups (${stats?.groupsCount ?? 0})</button>
      </div>

      <!-- TAB CONTENT BODY -->
      <div id="profileTabBody" style="display: flex; flex-direction: column; gap: 10px; margin-top: 6px;">
        ${this.renderActiveTabContent()}
      </div>
    </div>`;

    this.container.innerHTML = html;
    this.bindEvents();
  }

  private renderActiveTabContent(): string {
    if (!this.profileData) return '';
    const { posts, channels, pages, groups } = this.profileData;

    if (this.activeTab === 'posts') {
      if (!posts || posts.length === 0) {
        return `<div style="padding: 24px; text-align: center; color: #64748b; font-size: 0.8rem;">No dispatches published yet.</div>`;
      }
      return posts.map(p => `
        <div class="spatial-option-card" style="cursor: pointer; display: flex; flex-direction: column; gap: 6px; padding: 12px;" onclick="window.openSpatialMediaViewerSurface ? window.openSpatialMediaViewerSurface({ cid: '${p.mediaCid}', type: '${p.postType}' }) : null">
          <div style="font-size: 0.84rem; color: #f8fafc;">${p.caption || 'Published dispatch'}</div>
          <div style="font-size: 0.72rem; color: #94a3b8; display: flex; gap: 12px;">
            <span>❤️ ${p.likesCount || 0}</span>
            <span>💬 ${p.commentsCount || 0}</span>
            <span>🔖 ${p.visibility || 'public'}</span>
          </div>
        </div>
      `).join('');
    }

    if (this.activeTab === 'channels') {
      if (!channels || channels.length === 0) {
        return `<div style="padding: 24px; text-align: center; color: #64748b; font-size: 0.8rem;">No broadcast channels managed.</div>`;
      }
      return channels.map(c => `
        <div class="spatial-option-card" style="cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding: 12px;">
          <div>
            <div style="font-weight: 600; color: #f8fafc; font-size: 0.86rem;">📢 ${c.name}</div>
            <div style="font-size: 0.74rem; color: #38bdf8;">${c.handle} • ${c.count || 0} subscribers</div>
          </div>
          <span style="color: #64748b;">›</span>
        </div>
      `).join('');
    }

    if (this.activeTab === 'pages') {
      if (!pages || pages.length === 0) {
        return `<div style="padding: 24px; text-align: center; color: #64748b; font-size: 0.8rem;">No sovereign pages created.</div>`;
      }
      return pages.map(pg => `
        <div class="spatial-option-card" style="cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding: 12px;">
          <div>
            <div style="font-weight: 600; color: #f8fafc; font-size: 0.86rem;">📄 ${pg.name}</div>
            <div style="font-size: 0.74rem; color: #10b981;">${pg.handle} • ${pg.count || 0} followers</div>
          </div>
          <span style="color: #64748b;">›</span>
        </div>
      `).join('');
    }

    if (this.activeTab === 'groups') {
      if (!groups || groups.length === 0) {
        return `<div style="padding: 24px; text-align: center; color: #64748b; font-size: 0.8rem;">No mesh groups joined.</div>`;
      }
      return groups.map(g => `
        <div class="spatial-option-card" style="cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding: 12px;">
          <div>
            <div style="font-weight: 600; color: #f8fafc; font-size: 0.86rem;">👥 ${g.name}</div>
            <div style="font-size: 0.74rem; color: #c084fc;">${g.privacy === 'private' ? '🔒 Private' : '🌐 Public'} • ${g.memberCount || 0} members</div>
          </div>
          <span style="color: #64748b;">›</span>
        </div>
      `).join('');
    }

    return '';
  }

  private bindEvents(): void {
    const user = this.profileData?.user;
    if (!user) return;

    // Tabs
    this.container.querySelector('#tabPosts')?.addEventListener('click', () => { this.activeTab = 'posts'; this.render(); });
    this.container.querySelector('#tabChannels')?.addEventListener('click', () => { this.activeTab = 'channels'; this.render(); });
    this.container.querySelector('#tabPages')?.addEventListener('click', () => { this.activeTab = 'pages'; this.render(); });
    this.container.querySelector('#tabGroups')?.addEventListener('click', () => { this.activeTab = 'groups'; this.render(); });

    // Self Actions
    this.container.querySelector('#btnEditProfile')?.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('sovra-open-edit-profile'));
    });
    this.container.querySelector('#btnSettingsPrivacy')?.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('sovra-open-privacy-settings'));
    });

    // Follow Toggle
    this.container.querySelector('#btnToggleFollow')?.addEventListener('click', async () => {
      const isFollowing = this.profileData?.relationship?.isFollowing;
      const endpoint = isFollowing ? '/api/social/unfollow' : '/api/social/follow';
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null;
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ targetDid: user.did }),
      });
      await this.fetchProfile();
      this.render();
    });

    // Friend Action
    this.container.querySelector('#btnFriendAction')?.addEventListener('click', async () => {
      const status = this.profileData?.relationship?.friendshipStatus;
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null;

      if (status === 'none') {
        // Send request
        await fetch('/api/friends/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ toDid: user.did }),
        });
      } else if (status === 'pending_received') {
        // Accept request
        await fetch('/api/friends/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ fromDid: user.did, status: 'accept' }),
        });
      } else if (status === 'accepted') {
        // Remove friendship
        await fetch('/api/friends/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ targetDid: user.did }),
        });
      }
      await this.fetchProfile();
      this.render();
    });

    // Message Action
    this.container.querySelector('#btnSendMessage')?.addEventListener('click', () => {
      if (this.options.onOpenChat) {
        this.options.onOpenChat(user.did);
      } else {
        document.dispatchEvent(new CustomEvent('sovra-open-chat', { detail: { peerDid: user.did } }));
      }
    });

    // Block Action
    this.container.querySelector('#btnBlockAction')?.addEventListener('click', async () => {
      const isBlocked = this.profileData?.relationship?.isBlocked;
      const endpoint = isBlocked ? '/api/social/unblock' : '/api/social/block';
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null;
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ targetDid: user.did, isUnblock: isBlocked }),
      });
      await this.fetchProfile();
      this.render();
    });
  }
}
