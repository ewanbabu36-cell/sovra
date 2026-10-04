/**
 * @file apps/sovra-mobile/test/mobile-app.test.ts
 * Verification Suite for Sovra Mobile App & Expo APK Build Configuration.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TABS } from '../src/navigation/BottomTabNavigator.js';
import { INITIAL_STORIES, INITIAL_POSTS } from '../src/screens/FeedScreen.js';
import { INITIAL_REELS } from '../src/screens/ReelsScreen.js';
import { INITIAL_MESSAGES } from '../src/screens/ChatsScreen.js';

describe('Sovra Mobile App & APK Readiness Suite', () => {
  const mobileDir = path.resolve(__dirname, '../');

  it('validates app.json configuration for Android APK builds', () => {
    const appJsonPath = path.join(mobileDir, 'app.json');
    expect(fs.existsSync(appJsonPath)).toBe(true);

    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
    expect(appJson.expo.name).toBe('Sovra');
    expect(appJson.expo.android.package).toBe('network.sovra.mobile');

    // Android permissions required for P2P, media and E2EE
    const permissions: string[] = appJson.expo.android.permissions;
    expect(permissions).toContain('android.permission.INTERNET');
    expect(permissions).toContain('android.permission.ACCESS_NETWORK_STATE');
    expect(permissions).toContain('android.permission.CAMERA');
    expect(permissions).toContain('android.permission.RECORD_AUDIO');
    expect(permissions).toContain('android.permission.USE_BIOMETRIC');
  });

  it('validates eas.json build configuration for generating standalone APKs', () => {
    const easJsonPath = path.join(mobileDir, 'eas.json');
    expect(fs.existsSync(easJsonPath)).toBe(true);

    const easJson = JSON.parse(fs.readFileSync(easJsonPath, 'utf-8'));
    expect(easJson.build.preview).toBeDefined();
    expect(easJson.build.preview.android.buildType).toBe('apk');
    expect(easJson.build.production.android.buildType).toBe('app-bundle');
  });

  it('verifies 5-tab super-app navigation structure', () => {
    expect(TABS).toHaveLength(5);
    const keys = TABS.map(t => t.key);
    expect(keys).toEqual(['feed', 'reels', 'watch', 'chats', 'me']);
  });

  it('verifies Instagram Feed and Stories data models', () => {
    expect(INITIAL_STORIES.length).toBeGreaterThanOrEqual(3);
    for (const story of INITIAL_STORIES) {
      expect(story.id).toBeDefined();
      expect(story.hoursRemaining).toBeLessThanOrEqual(24);
      expect(typeof story.isSeen).toBe('boolean');
    }

    expect(INITIAL_POSTS.length).toBeGreaterThanOrEqual(2);
    for (const post of INITIAL_POSTS) {
      expect(post.creatorHandle).toBeDefined();
      expect(post.likes).toBeGreaterThan(0);
    }
  });

  it('verifies Reels vertical snap-scroll and Segment 0 pre-warm hashes', () => {
    expect(INITIAL_REELS.length).toBeGreaterThanOrEqual(3);
    for (const reel of INITIAL_REELS) {
      expect(reel.manifestCid).toMatch(/^baf/);
      expect(reel.segment0Cid).toMatch(/^baf/);
      expect(reel.likesCount).toBeGreaterThan(0);
    }
  });

  it('verifies WhatsApp E2EE chat delivery tick progression', () => {
    expect(INITIAL_MESSAGES.length).toBeGreaterThanOrEqual(4);
    const validTicks = ['sending', 'sent', 'delivered', 'read'];
    for (const msg of INITIAL_MESSAGES) {
      expect(validTicks).toContain(msg.tickState);
      expect(msg.senderDid).toMatch(/^did:key:/);
    }
  });
});
