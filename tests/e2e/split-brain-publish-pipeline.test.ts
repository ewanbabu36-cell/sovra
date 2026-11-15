import { describe, it, expect } from 'vitest';
import { sovraDb } from '../../scripts/database-engine.ts';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('SOVRA Split-Brain Post Publishing Pipeline & SQLite Durability Gate', { timeout: 30000 }, () => {
  const ts = Date.now();
  let userToken: string;
  let userDid: string;
  const userHandle = `@publisher_${ts}`;
  let publishedPostId: string;

  it('registers a sovereign publisher identity', async () => {
    const res = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: userHandle,
        name: 'Sovereign Publisher',
        bio: 'Validating zero-loss post publishing pipeline',
        device: 'Node Workstation',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    userToken = data.sessionToken;
    userDid = data.user.did;
  });

  it('rejects empty post content with 400 Bad Request', async () => {
    const res = await fetch(`${BASE_URL}/api/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        content: '',
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it('rejects policy-violating post content via moderation scanner with 422 Unprocessable', async () => {
    const res = await fetch(`${BASE_URL}/api/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        content: 'malware.exe trojan payload click here to claim 10000 usdt',
      }),
    });
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain('Content safety policy violation');
  });

  it('publishes a valid post via POST /api/publish and persists directly to SQLite and in-memory store', async () => {
    const postContent = `Sovereign broadcast via /api/publish at ${ts} #sovra #durability`;
    const res = await fetch(`${BASE_URL}/api/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        content: postContent,
        tags: '#sovra #durability',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.post).toBeDefined();
    expect(data.post.id).toBeDefined();
    publishedPostId = data.post.id;
    expect(data.post.content).toBe(postContent);
    expect(data.post.authorDid).toBe(userDid);

    // Verify post is immediately retrievable via canonical feed discovery
    const feedRes = await fetch(`${BASE_URL}/api/feed/list`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(feedRes.status).toBe(200);
    const feedData = await feedRes.json();
    expect(feedData.ok).toBe(true);
    const foundInFeed = feedData.posts.find((p: any) => p.id === publishedPostId);
    expect(foundInFeed).toBeDefined();
    expect(foundInFeed.caption).toBe(postContent);
    expect(foundInFeed.authorDid).toBe(userDid);
    expect(foundInFeed.authorName).toBe('Sovereign Publisher');

    // Verify post is persisted in SQLite engine (survives memory restarts)
    const sqliteRecord = sovraDb.getPostById(publishedPostId);
    expect(sqliteRecord).toBeDefined();
    expect(sqliteRecord?.id).toBe(publishedPostId);
    expect(sqliteRecord?.caption).toBe(postContent);
    expect(sqliteRecord?.authorDid).toBe(userDid);
  });
});
