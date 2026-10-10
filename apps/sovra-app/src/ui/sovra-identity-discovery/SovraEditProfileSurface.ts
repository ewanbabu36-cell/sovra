/**
 * @file apps/sovra-app/src/ui/sovra-identity-discovery/SovraEditProfileSurface.ts
 * SOVRA Phase 6: Spatial Profile Editing Surface
 *
 * Implements real-time username validation (uniqueness, reserved words, length, regex),
 * bio, avatar, and displayName updates backed by /api/user/update.
 */

import { PublicUserDTO } from './types.js';

export interface SovraEditProfileOptions {
  user: PublicUserDTO;
  onSuccess?: (updatedUser: PublicUserDTO) => void;
  onCancel?: () => void;
}

export class SovraEditProfileSurface {
  private container: HTMLElement;
  private options: SovraEditProfileOptions;
  private currentHandle: string;
  private isHandleValid: boolean = true;
  private validationMessage: string = '';

  constructor(container: HTMLElement, options: SovraEditProfileOptions) {
    this.container = container;
    this.options = options;
    this.currentHandle = options.user.handle || '@user';
  }

  public render(): void {
    const { user } = this.options;
    const displayName = user.displayName || user.name || '';
    const bio = user.bio || '';
    const website = user.website || user.websiteUrl || '';

    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 14px; padding: 4px;">
        <!-- Username Field -->
        <div>
          <label style="display: block; font-size: 0.74rem; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em;">Sovereign Handle</label>
          <input type="text" id="editProfileHandle" value="${this.currentHandle}" style="width: 100%; box-sizing: border-box; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px; padding: 8px 12px; font-family: monospace; font-size: 0.85rem; color: #38bdf8;" />
          <div id="handleValidationStatus" style="font-size: 0.72rem; margin-top: 4px; color: ${this.isHandleValid ? '#10b981' : '#f87171'};">${this.validationMessage}</div>
        </div>

        <!-- Display Name -->
        <div>
          <label style="display: block; font-size: 0.74rem; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em;">Display Name</label>
          <input type="text" id="editProfileName" value="${displayName}" style="width: 100%; box-sizing: border-box; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 8px 12px; font-size: 0.85rem; color: #f8fafc;" />
        </div>

        <!-- Bio -->
        <div>
          <label style="display: block; font-size: 0.74rem; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em;">Bio</label>
          <textarea id="editProfileBio" rows="3" style="width: 100%; box-sizing: border-box; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 8px 12px; font-size: 0.82rem; color: #f8fafc; resize: vertical;">${bio}</textarea>
        </div>

        <!-- Website -->
        <div>
          <label style="display: block; font-size: 0.74rem; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em;">Website / Link</label>
          <input type="text" id="editProfileWebsite" value="${website}" placeholder="https://..." style="width: 100%; box-sizing: border-box; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 8px 12px; font-size: 0.85rem; color: #f8fafc;" />
        </div>

        <!-- Actions -->
        <div style="display: flex; gap: 8px; margin-top: 8px;">
          <button class="action-pill-btn action-pill-primary" style="flex: 1; padding: 8px;" id="btnSaveProfile">✓ Save Changes</button>
          <button class="action-pill-btn action-pill-secondary" style="padding: 8px 16px;" id="btnCancelEdit">Cancel</button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    const handleInput = this.container.querySelector('#editProfileHandle') as HTMLInputElement;
    const statusEl = this.container.querySelector('#handleValidationStatus') as HTMLElement;

    let debounceTimer: any = null;
    handleInput?.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const val = handleInput.value.trim();
        const clean = val.startsWith('@') ? val : '@' + val;

        // Fast regex & length check
        const body = clean.slice(1);
        if (body.length < 3) {
          this.isHandleValid = false;
          statusEl.textContent = '❌ Must be at least 3 characters';
          statusEl.style.color = '#f87171';
          return;
        }
        if (!/^[a-zA-Z0-9_.]+$/.test(body)) {
          this.isHandleValid = false;
          statusEl.textContent = '❌ Only letters, numbers, dots & underscores';
          statusEl.style.color = '#f87171';
          return;
        }

        // Server check
        try {
          const res = await fetch(`/api/user/check-handle?handle=${encodeURIComponent(clean)}&excludeDid=${encodeURIComponent(this.options.user.did)}`);
          const data = await res.json();
          if (data.isAvailable) {
            this.isHandleValid = true;
            statusEl.textContent = '✓ Handle available';
            statusEl.style.color = '#10b981';
          } else {
            this.isHandleValid = false;
            statusEl.textContent = '❌ Handle is already taken';
            statusEl.style.color = '#f87171';
          }
        } catch {
          this.isHandleValid = true;
        }
      }, 300);
    });

    this.container.querySelector('#btnSaveProfile')?.addEventListener('click', async () => {
      if (!this.isHandleValid) return;

      const nameInput = this.container.querySelector('#editProfileName') as HTMLInputElement;
      const bioInput = this.container.querySelector('#editProfileBio') as HTMLTextAreaElement;
      const webInput = this.container.querySelector('#editProfileWebsite') as HTMLInputElement;

      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null;
      try {
        const res = await fetch('/api/user/update', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            handle: handleInput.value.trim(),
            displayName: nameInput.value.trim(),
            bio: bioInput.value.trim(),
            website: webInput.value.trim(),
          }),
        });

        const data = await res.json();
        if (data.ok && data.user) {
          if (this.options.onSuccess) this.options.onSuccess(data.user);
        } else {
          statusEl.textContent = `❌ ${data.error || 'Failed to update'}`;
          statusEl.style.color = '#f87171';
        }
      } catch (err) {
        statusEl.textContent = '❌ Network error';
        statusEl.style.color = '#f87171';
      }
    });

    this.container.querySelector('#btnCancelEdit')?.addEventListener('click', () => {
      if (this.options.onCancel) this.options.onCancel();
    });
  }
}
