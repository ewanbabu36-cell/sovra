import { describe, it, expect } from 'vitest';
import { CommunityNodeDaemon, CommunityNodeConfig } from '../src/index.js';

describe('@sovra/community-node', () => {
  it('instantiates community topic daemon', async () => {
    const config: CommunityNodeConfig = {
      communityId: 'tech-innovators',
      pinMediaAssets: true,
      enableMemberDirectory: true,
    };
    const daemon = new CommunityNodeDaemon(config);
    expect(daemon.getConfig().communityId).toBe('tech-innovators');

    const res = await daemon.start();
    expect(res.ok).toBe(true);
  });
});
