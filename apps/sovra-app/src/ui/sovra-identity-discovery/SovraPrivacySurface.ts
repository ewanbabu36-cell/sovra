/**
 * @file apps/sovra-app/src/ui/sovra-identity-discovery/SovraPrivacySurface.ts
 * SOVRA Phase 6: Spatial Privacy & Blocked Peers Settings Surface
 *
 * Exposes real server-side privacy controls (profileVisibility, postVisibility,
 * canMessageMe, canSendFriendRequests) and blocked peers list with unblock controls.
 */

import { UserPrivacySettings, PublicUserDTO } from './types.js';

export interface SovraPrivacySurfaceOptions {
  onSaved?: (settings: UserPrivacySettings) => void;
}

export class SovraPrivacySurface {
  private container: HTMLElement;
  private options: SovraPrivacySurfaceOptions;
  private settings: UserPrivacySettings | null = null;
  private blockedUsers: PublicUserDTO[] = [];

  constructor(container: HTMLElement, options: SovraPrivacySurfaceOptions = {}) {
    this.container = container;
    this.options = options;
  }

  public async init(): Promise<void> {
    this.renderLoading();
    await Promise.all([this.fetchPrivacy(), this.fetchBlocked()]);
    this.render();
  }

  private renderLoading(): void {
    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 36px; gap: 12px;">
        <div style="width: 28px; height: 28px; border: 2px solid rgba(56, 189, 248, 0.2); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <div style="color: #94a3b8; font-size: 0.82rem;">Loading privacy configuration...</div>
      </div>
    `;
  }

  public async fetchPrivacy(): Promise<void> {
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null;
      const res = await fetch('/api/user/privacy', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data.ok && data.privacySettings) {
        this.settings = data.privacySettings;
      }
    } catch {}
  }

  public async fetchBlocked(): Promise<void> {
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null;
      const res = await fetch('/api/social/blocked', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.blockedUsers)) {
        this.blockedUsers = data.blockedUsers;
      }
    } catch {}
  }

  public render(): void {
    const s = this.settings || {
      profileVisibility: 'public',
      postVisibility: 'public',
      canMessageMe: 'public',
      canSendFriendRequests: 'public',
      showFollowers: true,
      showOnlineStatus: true,
    };

    let html = `
      <div style="display: flex; flex-direction: column; gap: 14px; padding: 4px;">
        <!-- 1. Profile Visibility -->
        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 14px;">
          <label style="display: block; font-size: 0.84rem; font-weight: 600; color: #f8fafc; margin-bottom: 2px;">Profile Visibility</label>
          <div style="font-size: 0.74rem; color: #94a3b8; margin-bottom: 8px;">Control who can discover and view your profile card.</div>
          <select id="selProfileVisibility" style="width: 100%; background: #0f172a; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px; color: #f8fafc; padding: 6px 10px; font-size: 0.8rem;">
            <option value="public" ${s.profileVisibility === 'public' ? 'selected' : ''}>🌐 Public (Discoverable by mesh peers)</option>
            <option value="friends" ${s.profileVisibility === 'friends' ? 'selected' : ''}>👥 Friends Only (Hidden from strangers)</option>
            <option value="only_me" ${s.profileVisibility === 'only_me' || s.profileVisibility === 'private' ? 'selected' : ''}>🔒 Private (Only me)</option>
          </select>
        </div>

        <!-- 2. Message Permissions -->
        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 14px;">
          <label style="display: block; font-size: 0.84rem; font-weight: 600; color: #f8fafc; margin-bottom: 2px;">Direct Encrypted Messages</label>
          <div style="font-size: 0.74rem; color: #94a3b8; margin-bottom: 8px;">Who can initiate Double Ratchet direct chats with you.</div>
          <select id="selCanMessage" style="width: 100%; background: #0f172a; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px; color: #f8fafc; padding: 6px 10px; font-size: 0.8rem;">
            <option value="public" ${s.canMessageMe === 'public' ? 'selected' : ''}>🌐 Everyone</option>
            <option value="friends" ${s.canMessageMe === 'friends' ? 'selected' : ''}>👥 Friends Only</option>
            <option value="none" ${s.canMessageMe === 'none' ? 'selected' : ''}>🚫 Nobody</option>
          </select>
        </div>

        <!-- 3. Friend Request Permissions -->
        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 14px;">
          <label style="display: block; font-size: 0.84rem; font-weight: 600; color: #f8fafc; margin-bottom: 2px;">Friend Handshakes</label>
          <div style="font-size: 0.74rem; color: #94a3b8; margin-bottom: 8px;">Who can send you friend connection requests.</div>
          <select id="selCanFriend" style="width: 100%; background: #0f172a; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px; color: #f8fafc; padding: 6px 10px; font-size: 0.8rem;">
            <option value="public" ${s.canSendFriendRequests === 'public' ? 'selected' : ''}>🌐 Everyone</option>
            <option value="friends_of_friends" ${s.canSendFriendRequests === 'friends_of_friends' ? 'selected' : ''}>👥 Friends of Friends</option>
            <option value="none" ${s.canSendFriendRequests === 'none' ? 'selected' : ''}>🚫 Nobody</option>
          </select>
        </div>

        <!-- 4. Blocked Peers List -->
        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-size: 0.84rem; font-weight: 600; color: #f8fafc;">🚫 Blocked Peers (${this.blockedUsers.length})</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px; max-height: 160px; overflow-y: auto;">
            ${this.blockedUsers.length === 0 ? `
              <div style="color: #64748b; font-size: 0.78rem; text-align: center; padding: 8px;">No peers currently blocked.</div>
            ` : this.blockedUsers.map(u => `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: rgba(0,0,0,0.3); border-radius: 8px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 1rem;">${u.avatar || '👤'}</span>
                  <div>
                    <div style="font-size: 0.78rem; font-weight: 600; color: #f8fafc;">${u.displayName || u.name}</div>
                    <div style="font-size: 0.7rem; color: #94a3b8;">${u.handle}</div>
                  </div>
                </div>
                <button class="action-pill-btn action-pill-secondary btn-unblock-peer" data-did="${u.did}" style="padding: 4px 10px; font-size: 0.7rem;">Unblock</button>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Save Button -->
        <button class="action-pill-btn action-pill-primary" style="padding: 9px; font-size: 0.82rem; margin-top: 4px;" id="btnSavePrivacy">✓ Save Privacy Settings</button>
      </div>
    `;

    this.container.innerHTML = html;
    this.bindEvents();
  }

  private bindEvents(): void {
    // Unblock buttons
    this.container.querySelectorAll('.btn-unblock-peer').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const targetDid = (e.currentTarget as HTMLElement).getAttribute('data-did');
        if (!targetDid) return;
        const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null;
        await fetch('/api/social/unblock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ targetDid }),
        });
        await this.fetchBlocked();
        this.render();
      });
    });

    // Save Privacy Settings
    this.container.querySelector('#btnSavePrivacy')?.addEventListener('click', async () => {
      const selProf = (this.container.querySelector('#selProfileVisibility') as HTMLSelectElement)?.value as any;
      const selMsg = (this.container.querySelector('#selCanMessage') as HTMLSelectElement)?.value as any;
      const selFriend = (this.container.querySelector('#selCanFriend') as HTMLSelectElement)?.value as any;

      const payload: UserPrivacySettings = {
        profileVisibility: selProf,
        canMessageMe: selMsg,
        canSendFriendRequests: selFriend,
        showFollowers: true,
        showOnlineStatus: true,
      };

      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null;
      await fetch('/api/user/privacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });

      this.settings = payload;
      if (this.options.onSaved) this.options.onSaved(payload);
      this.render();
    });
  }
}
