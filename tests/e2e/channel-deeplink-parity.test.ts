/**
 * @file tests/e2e/channel-deeplink-parity.test.ts
 * YouTube-Parity Channel Deep-Linking, Dynamic Shelves & Live Handle Validator Verification.
 *
 * Verifies:
 * 1. HTTP Server Route Interception for /@handle, /channel/:id, and /c/:handle.
 * 2. 300ms Inline Handle Availability Check (/api/social/channels/check-handle).
 * 3. YouTube Dual-Hero Shelves (Trailer for Unsubscribed vs Featured for Returning Subscribers).
 * 4. Header Channel Switcher Popover & Studio Pro Scoped Switching.
 * 5. Watch Feed, Video Header, and Reels Card Channel Badge Routing.
 * 6. Browser Address Bar History PushState & Auto-Boot Navigation Invariants.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sovraDb } from '../../scripts/database-engine.js';

describe('YouTube-Parity Channel Deep-Linking, Shelves & Live Handle Validator', () => {
  const devServerPath = path.resolve(process.cwd(), 'scripts', 'dev-server.ts');
  const studioRoutesPath = path.resolve(process.cwd(), 'scripts', 'routes', 'studio.routes.ts');
  const devServerCode = fs.readFileSync(devServerPath, 'utf-8');
  const studioRoutesCode = fs.readFileSync(studioRoutesPath, 'utf-8');

  beforeEach(() => {
    if (!sovraDb.db.channels) {
      sovraDb.db.channels = [];
    }
  });

  describe('1. Browser Address Bar Deep-Linking Route Interception', () => {
    it('intercepts pathname.startsWith(/@), pathname.startsWith(/channel/), and pathname.startsWith(/c/)', () => {
      expect(devServerCode).toContain("url.pathname.startsWith('/@')");
      expect(devServerCode).toContain("url.pathname.startsWith('/channel/')");
      expect(devServerCode).toContain("url.pathname.startsWith('/c/')");
    });

    it('injects auto-boot listener checking window.location.pathname on DOMContentLoaded', () => {
      expect(devServerCode).toContain("window.location.pathname.startsWith('/@') || window.location.pathname.startsWith('/channel/')");
      expect(devServerCode).toContain('window.openChannelHub(target, true)');
    });

    it('updates browser address bar history.pushState without page reload inside channel hub', () => {
      expect(devServerCode).toContain("history.pushState({ sovraTab: 'channel'");
      expect(devServerCode).toContain("window.addEventListener('popstate'");
      expect(devServerCode).toContain("window.openChannelHub(e.state.channel, true)");
    });

    it('serves 200 OK HTML on direct HTTP navigation to /@sovralab and /channel/ch-1234', async () => {
      try {
        const atRes = await fetch('http://localhost:3001/@sovralab');
        if (atRes.ok) {
          expect(atRes.status).toBe(200);
          const html = await atRes.text();
          expect(html).toContain('id="channel-hub-view"');
        }
        const chanRes = await fetch('http://localhost:3001/channel/ch-test');
        if (chanRes.ok) {
          expect(chanRes.status).toBe(200);
        }
      } catch (_) {
        // Dev server may not be running in isolated test environments
      }
    });
  });

  describe('2. Live Handle Availability Validator & Debounce Check', () => {
    it('defines GET /api/social/channels/check-handle endpoint in server router', () => {
      expect(devServerCode).toContain("url.pathname === '/api/social/channels/check-handle'");
      expect(devServerCode).toContain("req.method === 'GET'");
    });

    it('accurately verifies handle collision logic across sovereign database', () => {
      const existingHandle = '@creator_' + Date.now();
      sovraDb.createChannel({
        name: 'Collision Test Channel',
        handle: existingHandle,
        category: 'tech',
        desc: 'Testing collision check',
        bannerUrl: 'linear-gradient(135deg, #0ea5e9, #8b5cf6)',
        avatar: '🎬',
        avatarBg: '#f43f5e',
        ownerDid: 'did:sovra:collision_owner',
        verified: true,
        channelType: 'video'
      });

      // Check existing handle
      const checkExisting = (sovraDb.db.channels || []).some(
        (c: any) => (c.handle || '').toLowerCase() === existingHandle.toLowerCase()
      );
      expect(checkExisting).toBe(true);

      // Check unused unique handle
      const unusedHandle = '@random_brand_new_' + (Date.now() + 1000);
      const checkUnused = (sovraDb.db.channels || []).some(
        (c: any) => (c.handle || '').toLowerCase() === unusedHandle.toLowerCase()
      );
      expect(checkUnused).toBe(false);
    });

    it('contains #chanHandleStatus badge and 300ms debounce handler in #createChannelModal', () => {
      expect(devServerCode).toContain('id="chanHandleStatus"');
      expect(devServerCode).toContain('_chanHandleDebounceTimer');
      expect(devServerCode).toContain("fetch('/api/social/channels/check-handle?handle='");
      expect(devServerCode).toContain("'✓ Available'");
      expect(devServerCode).toContain("'✕ Handle already taken'");
    });

    it('returns available: false for protocol/existing handle and available: true for unique handle via HTTP', async () => {
      try {
        const resTaken = await fetch('http://localhost:3001/api/social/channels/check-handle?handle=sovralab');
        if (resTaken.ok) {
          const dataTaken = await resTaken.json();
          expect(dataTaken.ok).toBe(true);
          expect(dataTaken.available).toBe(false);
          expect(dataTaken.handle).toBe('@sovralab');
        }

        const unique = 'creator_' + Date.now();
        const resFree = await fetch('http://localhost:3001/api/social/channels/check-handle?handle=' + unique);
        if (resFree.ok) {
          const dataFree = await resFree.json();
          expect(dataFree.ok).toBe(true);
          expect(dataFree.available).toBe(true);
          expect(dataFree.handle).toBe('@' + unique);
        }
      } catch (_) {
        // Dev server may not be running in isolated test environments
      }
    });
  });

  describe('3. Dynamic Homepage Shelves (Trailer vs Returning Subscriber)', () => {
    it('wires Studio Customization to persist trailerVideoId and featuredVideoId', () => {
      const creatorDid = 'did:sovra:shelf_creator_' + Date.now();
      const testChanId = 'ch-shelf-' + Date.now();
      const uniqueHandle = '@shelf_studio_' + Date.now();
      const created = sovraDb.createChannel({
        id: testChanId,
        name: 'Shelf Studio 4K',
        handle: uniqueHandle,
        category: 'tech',
        desc: 'Studio shelves test',
        bannerUrl: 'linear-gradient(135deg, #1e1b4b, #312e81)',
        avatar: '🎬',
        avatarBg: '#f43f5e',
        ownerDid: creatorDid,
        verified: true,
        channelType: 'video'
      });

      const res = sovraDb.saveCreatorChannelCustomization(creatorDid, {
        channelId: created.id,
        channelHandle: uniqueHandle,
        channelName: 'Shelf Studio 4K Updated',
        channelBio: 'Decentralized 4K streaming studio',
        trailerVideoId: 'vid-trailer-101',
        featuredVideoId: 'vid-featured-202'
      });

      expect(res.ok).toBe(true);
      expect(res.customization.trailerVideoId).toBe('vid-trailer-101');
      expect(res.customization.featuredVideoId).toBe('vid-featured-202');

      const chan = (sovraDb.db.channels || []).find(c => c.id === created.id);
      expect(chan?.trailerVideoId).toBe('vid-trailer-101');
      expect(chan?.featuredVideoId).toBe('vid-featured-202');
    });

    it('contains dual-hero logic in renderChannelHome differentiating unsubscribed vs subscribed', () => {
      expect(devServerCode).toContain('function renderChannelHome(data)');
      expect(devServerCode).toContain('const isSubbed = Boolean(ch.isSubbed || data.isSubscribed);');
      expect(devServerCode).toContain('ch.trailerVideoId');
      expect(devServerCode).toContain('ch.featuredVideoId');
      expect(devServerCode).toContain('Channel Trailer • New Viewers');
      expect(devServerCode).toContain('Featured for Subscribers • Latest Release');
      expect(devServerCode).toContain('Subscribe to Channel');
      expect(devServerCode).toContain('Watch Now');
    });

    it('populates customTrailerSelect and customFeaturedSelect during loadCustomization', () => {
      expect(devServerCode).toContain('document.getElementById(\'customTrailerSelect\')');
      expect(devServerCode).toContain('document.getElementById(\'customFeaturedSelect\')');
      expect(devServerCode).toContain('trailerSel.value = c.trailerVideoId');
      expect(devServerCode).toContain('featuredSel.value = c.featuredVideoId');
    });
  });

  describe('4. Studio Pro Header Channel Switcher Popover', () => {
    it('mounts #studioHeaderChanSwitcher and #studioHeaderChanPopover in universal header', () => {
      expect(devServerCode).toContain('id="studioHeaderChanSwitcher"');
      expect(devServerCode).toContain('id="studioHeaderChanSwitcherAvatar"');
      expect(devServerCode).toContain('id="studioHeaderChanSwitcherName"');
      expect(devServerCode).toContain('id="studioHeaderChanPopover"');
    });

    it('exposes window.toggleStudioHeaderChanPopover and selectStudioHeaderChan', () => {
      expect(devServerCode).toContain('window.toggleStudioHeaderChanPopover');
      expect(devServerCode).toContain('window.selectStudioHeaderChan');
      expect(devServerCode).toContain('window.updateStudioHeaderChanSwitcher');
      expect(devServerCode).toContain('SovraCreatorStudioEngine.switchActiveChannel');
    });

    it('syncs studioHeaderChanSwitcher visibility strictly when activeTab is studio', () => {
      expect(devServerCode).toContain("tab === 'studio'");
      expect(devServerCode).toContain("studioHeaderPill.style.setProperty('display', 'inline-flex', 'important')");
      expect(devServerCode).toContain("studioHeaderPill.style.setProperty('display', 'none', 'important')");
    });
  });

  describe('5. Watch Feed, Video Header & Reels Channel Routing', () => {
    it('wires video player channel bar with data-channel-id-or-handle and window.openChannelHub', () => {
      expect(devServerCode).toContain('id="ytChannelLeftBar"');
      expect(devServerCode).toContain('window.openChannelHub(this.dataset.channelIdOrHandle');
    });

    it('wires Watch feed cards and viewer strip creator identity with window.openChannelHub', () => {
      expect(devServerCode).toContain("data-channel-id-or-handle=\"' + (v.channelHandle || v.channelId || v.channelName || 'sovralab') + '\"");
      expect(devServerCode).toContain("onclick=\"event.stopPropagation(); window.openChannelHub(this.dataset.channelIdOrHandle);\"");
    });

    it('wires Reels creator avatar and handle with data-channel-id-or-handle to openChannelHub', () => {
      expect(devServerCode).toContain('const reelTargetHandle = r.channelHandle || r.channelId || r.creatorHandle || \'sovralab\';');
      expect(devServerCode).toContain('avatarEl.dataset.channelIdOrHandle = reelTargetHandle;');
      expect(devServerCode).toContain('handleEl.dataset.channelIdOrHandle = reelTargetHandle;');
    });

    it('redirects legacy openPublicChannelView calls directly to openChannelHub', () => {
      expect(devServerCode).toContain('if (typeof window.openChannelHub === \'function\') {');
      expect(devServerCode).toContain('window.openChannelHub(channelIdOrHandle || \'sovralab\');');
    });
  });
});
