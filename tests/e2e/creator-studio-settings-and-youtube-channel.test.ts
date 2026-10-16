import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('Sovra Settings Creator Studio Integration & YouTube Channel Creation Suite', () => {
  let htmlContent: string = '';
  let testUser: { did: string; handle: string; sessionToken: string };

  beforeAll(async () => {
    // 1. Fetch dashboard HTML
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    htmlContent = await res.text();

    // 2. Register a test sovereign user
    const ts = Date.now();
    const regRes = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@creator_${ts}`,
        name: 'YouTube Creator Pro',
        bio: 'Testing studio in settings and video channel creation',
      }),
    });
    expect(regRes.status).toBe(200);
    const regData = await regRes.json();
    expect(regData.ok).toBe(true);
    testUser = {
      did: regData.user.did,
      handle: regData.user.handle,
      sessionToken: regData.sessionToken,
    };
  });

  describe('Part 1: Studio in Settings & Overflow Navigation', () => {
    it('provides Creator Studio Pro in Profile Overflow Menu directly above Settings', () => {
      expect(htmlContent).toContain('id="profileStudioMenuItem"');
      expect(htmlContent).toContain("switchTab('studio'); hideProfileOverflowMenu();");
      expect(htmlContent).toContain('Creator Studio Pro');
    });

    it('embeds Sovra Creator Studio (YouTube Pro) directly in SOVRA SETTINGS Surface', () => {
      expect(htmlContent).toContain('id="spatialSettingsStudioItem"');
      expect(htmlContent).toContain('Sovra Creator Studio');
      expect(htmlContent).toContain('YouTube Pro');
      expect(htmlContent).toContain('switchTab(&quot;studio&quot;)');
    });

    it('embeds Studio and Create YouTube Video Channel in Account & Security Hub surface', () => {
      expect(htmlContent).toContain('Create YouTube Video Channel');
      expect(htmlContent).toContain('openSpatialChannelCreatorSurface(this, &quot;video&quot;)');
    });
  });

  describe('Part 2: YouTube-like Video Channel Creation Flow', () => {
    it('distinguishes YouTube Video Channel from Telegram-style Broadcast Channel in Create Action Grid', () => {
      expect(htmlContent).toContain('id="spatialCreateVideoChannelBtn"');
      expect(htmlContent).toContain('YouTube Video Channel');
      expect(htmlContent).toContain('id="spatialCreateChannelBtn"');
      expect(htmlContent).toContain('Broadcast Channel');
    });

    it('provides YouTube Video Channel option in Create Channel Modal with dynamic hints', () => {
      expect(htmlContent).toContain('id="chanTypeInput"');
      expect(htmlContent).toContain('value="video" selected');
      expect(htmlContent).toContain('YouTube Video Channel (Videos, Shorts, Playlists &amp; Studio)');
      expect(htmlContent).toContain('id="chanTypeHint"');
      expect(htmlContent).toContain('window.updateChannelModalTypeHint');
    });

    it('successfully creates a YouTube Video Channel via API with video avatar, bg, and channelType', async () => {
      const ts = Date.now();
      const channelHandle = `@tech_stream_${ts}`;
      const res = await fetch(`${BASE_URL}/api/social/channels`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testUser.sessionToken}`,
        },
        body: JSON.stringify({
          name: 'Tech Stream 4K',
          handle: channelHandle,
          category: 'tech',
          channelType: 'video',
          avatar: '🎬',
          avatarBg: '#f43f5e',
          desc: 'High-fps decentralized tech tutorials and streams',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.channel).toBeDefined();
      expect(data.channel.handle).toBe(channelHandle.toLowerCase());
      expect(data.channel.channelType).toBe('video');
      expect(data.channel.avatar).toBe('🎬');
      expect(data.channel.bg).toBe('#f43f5e');
      expect(data.channel.name).toBe('Tech Stream 4K');

      // Verify channel appears in channel list with video type preserved
      const listRes = await fetch(`${BASE_URL}/api/social/channels`);
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      expect(listData.ok).toBe(true);
      const found = listData.channels.find((c: any) => c.handle === channelHandle.toLowerCase());
      expect(found).toBeDefined();
      expect(found.channelType).toBe('video');
      expect(found.avatar).toBe('🎬');
    });

    it('defaults channelType to video with 🎬 avatar when channelType: "video" is requested', async () => {
      const ts = Date.now();
      const channelHandle = `@gaming_arena_${ts}`;
      const res = await fetch(`${BASE_URL}/api/social/channels`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testUser.sessionToken}`,
        },
        body: JSON.stringify({
          name: 'Gaming Arena Live',
          handle: channelHandle,
          category: 'gaming',
          channelType: 'video',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.channel.channelType).toBe('video');
      expect(data.channel.avatar).toBe('🎬');
      expect(data.channel.bg).toBe('#f43f5e');
    });
  });

  describe('Part 3: Industry Standard Clean Profile & On-Demand Channels / Creator Hub Trigger', () => {
    it('keeps #profileCreatorHubCard hidden by default on profile to avoid clutter', () => {
      expect(htmlContent).toContain('id="profileCreatorHubCard" style="display: none;');
      expect(htmlContent).toContain('toggleProfileCreatorHubCard(false)');
    });

    it('provides Channels & Pages button in Profile action row (#profileChannelsBtn)', () => {
      expect(htmlContent).toContain('id="profileChannelsBtn"');
      expect(htmlContent).toContain('onclick="openSpatialChannelsPagesSurface(this)"');
      expect(htmlContent).toContain('Channels &amp; Pages');
    });

    it('embeds 1-line Professional Dashboard trigger banner below bio (#creatorHubTriggerBanner)', () => {
      expect(htmlContent).toContain('id="creatorHubTriggerBanner"');
      expect(htmlContent).toContain('onclick="openSpatialChannelsPagesSurface(this)"');
      expect(htmlContent).toContain('Channels &amp; Public Pages');
      expect(htmlContent).toContain('Broadcast dispatches for subscribers');
    });

    it('embeds Channels & Public Pages entry in SOVRA SETTINGS surface (#spatialSettingsChannelsItem)', () => {
      expect(htmlContent).toContain('id="spatialSettingsChannelsItem"');
      expect(htmlContent).toContain('openSpatialChannelsPagesSurface(this)');
      expect(htmlContent).toContain('Channels &amp; Public Pages');
    });

    it('exposes openSpatialChannelsPagesSurface and toggleProfileCreatorHubCard on window', () => {
      expect(htmlContent).toContain('window.openSpatialChannelsPagesSurface = function');
      expect(htmlContent).toContain('window.toggleProfileCreatorHubCard = function');
      expect(htmlContent).toContain('window.renderCreatorHubEntities = renderCreatorHubEntities;');
    });
  });
});
