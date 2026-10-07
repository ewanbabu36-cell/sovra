import { describe, it, expect } from 'vitest';
import { CID } from '@sovra/storage';
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

    // Test member directory
    const addRes = daemon.addMember('did:sovra:member_1', 'admin');
    expect(addRes.ok).toBe(true);
    expect(daemon.listMembers().length).toBe(1);
    expect(daemon.getMember('did:sovra:member_1')?.role).toBe('admin');

    // Test media pinning
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const cid = CID.create('raw', data);
    const pinRes = await daemon.pinAsset(cid.toString(), data);
    expect(pinRes.ok).toBe(true);
    expect(daemon.isAssetPinned(cid.toString())).toBe(true);

    await daemon.stop();
    expect(daemon.isRunning).toBe(false);
  });
});
