/**
 * @file tests/unit/sovereign-channel-page-video-pipeline.test.ts
 * SOVRA Sovereign Channels & Pages Video & Reel Publishing Pipeline
 *
 * Verifies that Sovereign Channels (1-to-many broadcast) and Sovereign Pages (brand profiles)
 * can be selected as publishing entities for short-form (Reels) and long-form (YouTube-style)
 * video content, preserving entityType, entityId, and query filtering.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import http from 'node:http';
import { sovraDb } from '../../scripts/database-engine.js';

describe('Sovereign Channels & Pages Video Publishing Pipeline', () => {
  const ts = Date.now();
  let testUserDid = `did:sovra:creator_${ts}`;
  let sessionToken = '';
  const testChannelId = `chan_${ts}`;
  const testPageId = `page_${ts}`;

  beforeAll(async () => {
    // 1. Direct DB registration
    sovraDb.registerUser({
      did: testUserDid,
      handle: `@creator_${ts}`,
      displayName: 'Sovereign Creator',
    });

    // 2. HTTP Server registration to obtain valid server-side session token
    const regPayload = JSON.stringify({
      handle: `creator_${ts}`,
      name: 'Sovereign Creator',
      securityPin: '123456',
    });

    const regResponse = await new Promise<any>((resolve, reject) => {
      const req = http.request(
        'http://127.0.0.1:3001/api/user/register',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(regPayload),
          },
        },
        res => {
          let data = '';
          res.on('data', chunk => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({});
            }
          });
        }
      );
      req.on('error', reject);
      req.write(regPayload);
      req.end();
    });

    if (regResponse?.sessionToken) {
      sessionToken = regResponse.sessionToken;
      if (regResponse.user?.did) {
        testUserDid = regResponse.user.did;
      }
    }
  });

  it('1. sovraDb correctly stores and retrieves reels associated with a Sovereign Channel', () => {
    const reel = sovraDb.createReel({
      creatorDid: testUserDid,
      creatorHandle: 'alpha_tech',
      creatorName: 'Alpha Tech Broadcast',
      caption: 'Breaking: P2P mesh live demo #mesh #channel',
      cid: `bafy_reel_chan_${ts}`,
      entityType: 'channel',
      entityId: testChannelId,
    });

    expect(reel).toBeDefined();
    expect(reel.entityType).toBe('channel');
    expect(reel.entityId).toBe(testChannelId);

    const channelReels = sovraDb.getReelsByEntity('channel', testChannelId);
    expect(channelReels.length).toBeGreaterThanOrEqual(1);
    expect(channelReels.some(r => r.id === reel.id)).toBe(true);
  });

  it('2. sovraDb correctly stores and retrieves reels associated with a Sovereign Page', () => {
    const reel = sovraDb.createReel({
      creatorDid: testUserDid,
      creatorHandle: 'corp_brand',
      creatorName: 'Official Corp Page',
      caption: 'Corporate product launch announcement #launch #page',
      cid: `bafy_reel_page_${ts}`,
      entityType: 'page',
      entityId: testPageId,
    });

    expect(reel).toBeDefined();
    expect(reel.entityType).toBe('page');
    expect(reel.entityId).toBe(testPageId);

    const pageReels = sovraDb.getReelsByEntity('page', testPageId);
    expect(pageReels.length).toBeGreaterThanOrEqual(1);
    expect(pageReels.some(r => r.id === reel.id)).toBe(true);
  });

  it('3. sovraDb correctly stores and retrieves long-form videos associated with a Sovereign Channel', () => {
    const video = sovraDb.createVideo({
      ownerDid: testUserDid,
      title: 'Full Channel Keynote 2026',
      description: 'The complete decentralized stream from Sovereign Channel',
      cid: `bafy_vid_chan_${ts}`,
      entityType: 'channel',
      entityId: testChannelId,
      channelName: 'Alpha Tech Broadcast',
      channelHandle: 'alpha_tech',
    });

    expect(video).toBeDefined();
    expect(video.entityType).toBe('channel');
    expect(video.entityId).toBe(testChannelId);

    const channelVideos = sovraDb.getVideosByEntity('channel', testChannelId);
    expect(channelVideos.length).toBeGreaterThanOrEqual(1);
    expect(channelVideos.some(v => v.id === video.id)).toBe(true);
  });

  it('4. sovraDb correctly stores and retrieves long-form videos associated with a Sovereign Page', () => {
    const video = sovraDb.createVideo({
      ownerDid: testUserDid,
      title: 'Official Page Brand Documentary',
      description: 'Official corporate video for verified sovereign business page',
      cid: `bafy_vid_page_${ts}`,
      entityType: 'page',
      entityId: testPageId,
      channelName: 'Official Corp Page',
      channelHandle: 'corp_brand',
    });

    expect(video).toBeDefined();
    expect(video.entityType).toBe('page');
    expect(video.entityId).toBe(testPageId);

    const pageVideos = sovraDb.getVideosByEntity('page', testPageId);
    expect(pageVideos.length).toBeGreaterThanOrEqual(1);
    expect(pageVideos.some(v => v.id === video.id)).toBe(true);
  });

  it('5. HTTP POST /api/reels/create accepts entityType and entityId and persists them', async () => {
    expect(sessionToken).toBeTruthy();

    const payload = JSON.stringify({
      creatorDid: testUserDid,
      creatorHandle: 'network_news',
      creatorName: 'Network News Channel',
      caption: 'API Test Channel Reel',
      cid: `bafy_api_chan_${ts}`,
      entityType: 'channel',
      entityId: `chan_api_${ts}`,
    });

    const responseData = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = http.request(
        'http://127.0.0.1:3001/api/reels/create',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'Authorization': `Bearer ${sessionToken}`,
            'x-sovra-session-token': sessionToken,
          },
        },
        res => {
          let data = '';
          res.on('data', chunk => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode || 200, body: JSON.parse(data) });
            } catch {
              resolve({ status: res.statusCode || 200, body: data });
            }
          });
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    expect(responseData.status).toBe(200);
    expect(responseData.body.ok).toBe(true);
    expect(responseData.body.reel.entityType).toBe('channel');
    expect(responseData.body.reel.entityId).toBe(`chan_api_${ts}`);
  });

  it('6. HTTP POST /api/youtube/upload accepts entityType and entityId and persists them', async () => {
    expect(sessionToken).toBeTruthy();

    const payload = JSON.stringify({
      ownerDid: testUserDid,
      title: 'API Test Page Video Upload',
      description: 'Testing long-form video upload for Sovereign Page',
      cid: `bafy_api_page_${ts}`,
      entityType: 'page',
      entityId: `page_api_${ts}`,
      channelName: 'Sovereign Brand',
      channelHandle: 'sov_brand',
    });

    const responseData = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = http.request(
        'http://127.0.0.1:3001/api/youtube/upload',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'Authorization': `Bearer ${sessionToken}`,
            'x-sovra-session-token': sessionToken,
          },
        },
        res => {
          let data = '';
          res.on('data', chunk => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode || 200, body: JSON.parse(data) });
            } catch {
              resolve({ status: res.statusCode || 200, body: data });
            }
          });
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    expect(responseData.status).toBe(200);
    expect(responseData.body.ok).toBe(true);
    expect(responseData.body.video.entityType).toBe('page');
    expect(responseData.body.video.entityId).toBe(`page_api_${ts}`);
  });
});
