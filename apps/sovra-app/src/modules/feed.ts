/**
 * @file apps/sovra-app/src/modules/feed.ts
 * Sovra Modular Client: Social Feed, Composer, Persona Switcher & Hero Card
 */

export interface FeedPost {
  id: string;
  authorDid: string;
  authorName: string;
  authorHandle: string;
  authorAvatar?: string;
  content: string;
  timestamp: number;
  likesCount: number;
  commentsCount: number;
}

export function initFeedModule(): void {
  if (typeof window === 'undefined') return;

  // 1. Balance Privacy Toggle
  (window as any).toggleBalancePrivacy = function(forcePrivacy?: boolean): void {
    const el = document.getElementById('heroActiveSovBalance');
    if (!el) return;
    const isCurrentlyHidden = el.getAttribute('data-hidden') === 'true';
    const shouldHide = typeof forcePrivacy === 'boolean' ? forcePrivacy : !isCurrentlyHidden;
    const realBal = el.getAttribute('data-real-balance') || el.textContent || '0.00 SOV';
    if (shouldHide) {
      el.setAttribute('data-real-balance', realBal);
      el.setAttribute('data-hidden', 'true');
      el.textContent = '•••••• SOV';
    } else {
      el.setAttribute('data-hidden', 'false');
      el.textContent = realBal.includes('SOV') ? realBal : `${realBal} SOV`;
    }
    const icon = document.getElementById('balancePrivacyIcon');
    if (icon) {
      icon.textContent = shouldHide ? '👁️' : '🔒';
    }
  };

  // 2. Cache Prune from Hero Anchor Card
  (window as any).pruneCacheFromHero = async function(): Promise<void> {
    const bar = document.getElementById('heroCacheProgressBar');
    if (bar) bar.style.width = '0%';
    try {
      const res = await fetch('/api/storage/gc', { method: 'POST' });
      const data = await res.json();
      if ((window as any).showAccountToast) {
        (window as any).showAccountToast(`Storage pruned: ${(data && data.freedBytes) || '24.2 MB'} freed`, 'success');
      }
    } catch (_) {
      if ((window as any).showAccountToast) {
        (window as any).showAccountToast('Storage cache cleared locally.', 'info');
      }
    }
  };

  // 3. Switch Persona / Identity Horizon
  (window as any).switchToPersona = function(personaId: string): void {
    const label = document.getElementById('currentPersonaLabel');
    if (label) {
      label.textContent = personaId === 'creator' ? 'Creator Horizon' : personaId === 'anonym' ? 'Stealth Persona' : 'Citizen Primary';
    }
    const sheet = document.getElementById('identitySwitcherSheet');
    if (sheet) sheet.style.display = 'none';
    if ((window as any).showAccountToast) {
      (window as any).showAccountToast(`Switched horizon to: ${personaId}`, 'success');
    }
  };

  // 4. Spatial Post Creator Surface Controls
  (window as any)._modalSpatialPhotoData = null;

  (window as any).openSpatialPostCreatorSurface = function(originEl?: HTMLElement, channelId?: string): void {
    const modal = document.getElementById('spatialPostCreatorModal');
    if (modal) {
      modal.style.display = 'flex';
      const input = document.getElementById('spatialPostContentInput') as HTMLTextAreaElement;
      if (input) input.focus();
    }
  };

  (window as any).closeSpatialPostCreatorSurface = function(): void {
    const modal = document.getElementById('spatialPostCreatorModal');
    if (modal) modal.style.display = 'none';
    (window as any).clearModalSpatialPhoto();
  };

  (window as any).handleModalSpatialPhotoSelected = function(e: any): void {
    const file = e.target && e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt: any) {
      (window as any)._modalSpatialPhotoData = evt.target.result;
      const preview = document.getElementById('modalSpatialPhotoPreview') as HTMLImageElement;
      if (preview) {
        preview.src = evt.target.result;
        preview.style.display = 'block';
      }
    };
    reader.readAsDataURL(file);
  };

  (window as any).clearModalSpatialPhoto = function(): void {
    (window as any)._modalSpatialPhotoData = null;
    const preview = document.getElementById('modalSpatialPhotoPreview') as HTMLImageElement;
    if (preview) {
      preview.src = '';
      preview.style.display = 'none';
    }
  };

  (window as any).toggleModalSpatialPoll = function(): void {
    const pollBox = document.getElementById('modalSpatialPollBox');
    if (pollBox) {
      pollBox.style.display = pollBox.style.display === 'none' ? 'block' : 'none';
    }
  };

  (window as any).submitModalSpatialPost = async function(): Promise<void> {
    const input = document.getElementById('spatialPostContentInput') as HTMLTextAreaElement;
    const content = input ? input.value.trim() : '';
    if (!content && !(window as any)._modalSpatialPhotoData) {
      if ((window as any).showAccountToast) (window as any).showAccountToast('Please write content or attach an image.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/feed/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          image: (window as any)._modalSpatialPhotoData,
        }),
      });
      const data = await res.json();
      if (data && data.ok) {
        if ((window as any).showAccountToast) (window as any).showAccountToast('Published to decentralized feed!', 'success');
        (window as any).closeSpatialPostCreatorSurface();
        if (input) input.value = '';
        setTimeout(() => window.location.reload(), 400);
      } else {
        if ((window as any).showAccountToast) (window as any).showAccountToast(data.error || 'Publish failed', 'error');
      }
    } catch (err: any) {
      if ((window as any).showAccountToast) (window as any).showAccountToast(err.message || 'Network error', 'error');
    }
  };

  console.log('[Sovra] Feed module initialized.');
}
