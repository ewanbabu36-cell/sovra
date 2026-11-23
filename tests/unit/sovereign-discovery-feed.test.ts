import { describe, it, expect } from 'vitest';
import { sovraDb } from '../../scripts/database-engine.js';

describe('Sovereign Cold-Start Discovery Feed Engine', () => {
  it('guarantees non-empty feed for brand-new users with zero friends', () => {
    const brandNewUserDid = 'did:sovra:brand_new_onboarded_user_' + Date.now();
    const feed = sovraDb.getFeedPosts(brandNewUserDid);

    expect(feed).toBeDefined();
    expect(feed.length).toBeGreaterThanOrEqual(1);

    const firstPost = feed[0];
    expect(firstPost.id).toBeDefined();
    expect(firstPost.caption).toBeDefined();
    expect(firstPost.visibility).toBe('public');
  });

  it('provides rich seed posts with interactive polls and sovereign themes', () => {
    const seeds = sovraDb.getSeedPosts();
    expect(seeds.length).toBeGreaterThanOrEqual(1);

    const pollPost = seeds.find(p => p.postType === 'poll');
    expect(pollPost).toBeDefined();
    expect(pollPost?.pollData).toBeDefined();
    expect(pollPost?.pollData?.options.length).toBeGreaterThanOrEqual(2);
  });

  it('excludes blocked users from cold-start feed', () => {
    const viewerDid = 'did:sovra:viewer_with_blocks_' + Date.now();
    const blockedAuthorDid = 'did:key:z6MksAliceCreatorP2P';

    // Mock viewer with blocked author
    sovraDb.saveUser({
      did: viewerDid,
      handle: '@test_viewer',
      name: 'Test Viewer',
      avatar: '👤',
      createdAt: Date.now(),
      privacySettings: {
        blockedDids: [blockedAuthorDid],
      },
    } as any);

    const feed = sovraDb.getFeedPosts(viewerDid);
    const hasBlockedPost = feed.some(p => p.authorDid === blockedAuthorDid);
    expect(hasBlockedPost).toBe(false);
  });
});
