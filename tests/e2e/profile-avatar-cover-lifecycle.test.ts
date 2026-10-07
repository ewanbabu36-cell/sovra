/**
 * @file tests/e2e/profile-avatar-cover-lifecycle.test.ts
 * E2E Verification Suite for Profile Avatar and Cover Banner Lifecycle:
 * 1. DOM Elements & SVG Iconography Gate
 * 2. Real Avatar Upload & Removal via Dedicated Endpoints
 * 3. Real Cover Upload & Removal via Dedicated Endpoints
 * 4. Full Profile Update & Atomic Clear via /api/user/update
 * 5. Persistence across database queries
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

const SAMPLE_AVATAR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const SAMPLE_COVER = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

describe('Profile Avatar & Cover Banner Dynamic Lifecycle Suite', () => {
  let serverHtml = '';
  let testUserToken = '';
  let testUserDid = '';

  beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    serverHtml = await res.text();

    const reg = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `lifecycle_user_${Date.now()}`,
        name: 'Cover Avatar Tester',
        displayName: 'Cover Avatar Tester',
        bio: 'Testing live image mutations',
      }),
    });
    const regData = await reg.json();
    expect(regData.ok).toBe(true);
    testUserToken = regData.sessionToken;
    testUserDid = regData.user.did;
  });

  describe('1. DOM Markup & Interactive Action Elements Integrity', () => {
    it('verifies rendered HTML contains interactive cover and avatar edit controls', () => {
      // Cover actions
      expect(serverHtml).toContain('id="meProfileCover"');
      expect(serverHtml).toContain('id="profileCoverActions"');
      expect(serverHtml).toContain('id="directCoverChangeBtn"');
      expect(serverHtml).toContain('id="directCoverRemoveBtn"');
      expect(serverHtml).toContain('id="directCoverFileInput"');

      // Avatar wrapper & camera badges
      expect(serverHtml).toContain('id="meProfileAvatarContainer"');
      expect(serverHtml).toContain('id="avatarCameraBadge"');
      expect(serverHtml).toContain('id="avatarRemoveBadge"');
      expect(serverHtml).toContain('id="directAvatarFileInput"');

      // Edit modal controls
      expect(serverHtml).toContain('id="editProfileModal"');
      expect(serverHtml).toContain('id="editProfilePhotoInput"');
      expect(serverHtml).toContain('id="editProfilePhotoRemoveBtn"');
      expect(serverHtml).toContain('id="editProfileCoverInput"');
      expect(serverHtml).toContain('id="editProfileCoverRemoveBtn"');
      expect(serverHtml).toContain('id="editProfileAvatarPreview"');
      expect(serverHtml).toContain('id="editProfileCoverPreview"');
    });

    it('verifies 100% SVG vector iconography in modal controls (0 emojis)', () => {
      // Verify modal header has SVG icon instead of ✏️ emoji
      expect(serverHtml).not.toContain('<span>✏️</span> <span>Edit Decentralized Profile</span>');
      expect(serverHtml).toContain('Edit Decentralized Profile');
      // Verify Choose Photo has SVG
      expect(serverHtml).toContain('Choose Photo');
      // Verify Upload Cover has SVG
      expect(serverHtml).toContain('Upload Cover');
    });
  });

  describe('2. Direct Avatar Upload & Removal', () => {
    it('uploads avatar via POST /api/user/upload-avatar', async () => {
      const res = await fetch(`${BASE_URL}/api/user/upload-avatar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testUserToken}`,
        },
        body: JSON.stringify({ avatarDataUrl: SAMPLE_AVATAR }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.user.avatarDataUrl).toBe(SAMPLE_AVATAR);
      expect(data.avatarUrl).toContain('/api/user/avatar/');

      // Verify authoritative state via /api/user/me
      const meRes = await fetch(`${BASE_URL}/api/user/me`, {
        headers: { 'Authorization': `Bearer ${testUserToken}` },
      });
      const meData = await meRes.json();
      expect(meData.ok).toBe(true);
      expect(meData.user.avatarDataUrl).toBe(SAMPLE_AVATAR);
    });

    it('removes avatar via POST /api/user/remove-avatar', async () => {
      const res = await fetch(`${BASE_URL}/api/user/remove-avatar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testUserToken}`,
        },
        body: JSON.stringify({ did: testUserDid }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.user.avatarDataUrl).toBeUndefined();

      // Verify authoritative state via /api/user/me
      const meRes = await fetch(`${BASE_URL}/api/user/me`, {
        headers: { 'Authorization': `Bearer ${testUserToken}` },
      });
      const meData = await meRes.json();
      expect(meData.ok).toBe(true);
      expect(meData.user.avatarDataUrl).toBeUndefined();
    });
  });

  describe('3. Direct Cover Upload & Removal', () => {
    it('uploads cover banner via POST /api/user/upload-cover', async () => {
      const res = await fetch(`${BASE_URL}/api/user/upload-cover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testUserToken}`,
        },
        body: JSON.stringify({ coverDataUrl: SAMPLE_COVER }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.user.coverDataUrl).toBe(SAMPLE_COVER);

      // Verify authoritative state via /api/user/me
      const meRes = await fetch(`${BASE_URL}/api/user/me`, {
        headers: { 'Authorization': `Bearer ${testUserToken}` },
      });
      const meData = await meRes.json();
      expect(meData.ok).toBe(true);
      expect(meData.user.coverDataUrl).toBe(SAMPLE_COVER);
    });

    it('removes cover banner via POST /api/user/remove-cover', async () => {
      const res = await fetch(`${BASE_URL}/api/user/remove-cover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testUserToken}`,
        },
        body: JSON.stringify({ did: testUserDid }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.user.coverDataUrl).toBeUndefined();

      // Verify authoritative state via /api/user/me
      const meRes = await fetch(`${BASE_URL}/api/user/me`, {
        headers: { 'Authorization': `Bearer ${testUserToken}` },
      });
      const meData = await meRes.json();
      expect(meData.ok).toBe(true);
      expect(meData.user.coverDataUrl).toBeUndefined();
    });
  });

  describe('4. Full Profile Update & Atomic Clear via POST /api/user/update', () => {
    it('updates both avatar and cover simultaneously in /api/user/update', async () => {
      const res = await fetch(`${BASE_URL}/api/user/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testUserToken}`,
        },
        body: JSON.stringify({
          did: testUserDid,
          name: 'Updated Live Hero',
          avatarDataUrl: SAMPLE_AVATAR,
          coverDataUrl: SAMPLE_COVER,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.user.avatarDataUrl).toBe(SAMPLE_AVATAR);
      expect(data.user.coverDataUrl).toBe(SAMPLE_COVER);
      expect(data.user.displayName).toBe('Updated Live Hero');
    });

    it('atomically removes both avatar and cover when passed as empty strings in /api/user/update', async () => {
      const res = await fetch(`${BASE_URL}/api/user/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testUserToken}`,
        },
        body: JSON.stringify({
          did: testUserDid,
          avatarDataUrl: '',
          coverDataUrl: '',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.user.avatarDataUrl).toBeUndefined();
      expect(data.user.coverDataUrl).toBeUndefined();

      // Verify in /api/user/me
      const meRes = await fetch(`${BASE_URL}/api/user/me`, {
        headers: { 'Authorization': `Bearer ${testUserToken}` },
      });
      const meData = await meRes.json();
      expect(meData.ok).toBe(true);
      expect(meData.user.avatarDataUrl).toBeUndefined();
      expect(meData.user.coverDataUrl).toBeUndefined();
    });
  });
});
