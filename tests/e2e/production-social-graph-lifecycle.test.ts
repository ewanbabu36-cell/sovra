import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('Production Social Graph & Multi-Device Session Lifecycle', () => {
  let aliceToken: string;
  let aliceDid: string;
  let aliceHandle: string;

  let bobToken: string;
  let bobDid: string;
  let bobHandle: string;

  let aliceDevice2Token: string;
  let aliceDevice2Id: string;

  it('registers User Alice and User Bob with cryptographic sovereign identities', async () => {
    aliceHandle = `@alice_${Date.now()}`;
    const resA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: aliceHandle,
        name: 'Alice Sovereign',
        bio: 'Decentralized identity pioneer',
        device: 'Laptop Core X',
      }),
    });
    expect(resA.status).toBe(200);
    const dataA = await resA.json();
    expect(dataA.ok).toBe(true);
    expect(dataA.sessionToken).toBeDefined();
    aliceToken = dataA.sessionToken;
    aliceDid = dataA.user.did;

    bobHandle = `@bob_${Date.now()}`;
    const resB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: bobHandle,
        name: 'Bob Mesh Node',
        bio: 'libp2p enthusiast',
        device: 'Mobile Node',
      }),
    });
    expect(resB.status).toBe(200);
    const dataB = await resB.json();
    expect(dataB.ok).toBe(true);
    expect(dataB.sessionToken).toBeDefined();
    bobToken = dataB.sessionToken;
    bobDid = dataB.user.did;

    expect(aliceDid).toMatch(/^did:(key|sovra):/);
    expect(bobDid).toMatch(/^did:(key|sovra):/);
  });

  it('Alice follows Bob via POST /api/social/follow (Real Asymmetric Graph)', async () => {
    const followRes = await fetch(`${BASE_URL}/api/social/follow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        targetDid: bobDid,
      }),
    });

    expect(followRes.status).toBe(200);
    const followData = await followRes.json();
    expect(followData.ok).toBe(true);
    expect(followData.isFollowing).toBe(true);
    expect(followData.followerCount).toBeGreaterThanOrEqual(1);
  });

  it('verifies Bob has Alice in followers list via GET /api/social/followers', async () => {
    const res = await fetch(`${BASE_URL}/api/social/followers?did=${encodeURIComponent(bobDid)}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.followers)).toBe(true);
    const aliceInBobFollowers = data.followers.find((u: any) => u.did === aliceDid);
    expect(aliceInBobFollowers).toBeDefined();
    expect(aliceInBobFollowers.handle).toBe(aliceHandle);
  });

  it('verifies Alice has Bob in following list via GET /api/social/following', async () => {
    const res = await fetch(`${BASE_URL}/api/social/following?did=${encodeURIComponent(aliceDid)}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.following)).toBe(true);
    const bobInAliceFollowing = data.following.find((u: any) => u.did === bobDid);
    expect(bobInAliceFollowing).toBeDefined();
    expect(bobInAliceFollowing.handle).toBe(bobHandle);
  });

  it('verifies asymmetric relationship via GET /api/social/relationship', async () => {
    // From Alice's perspective about Bob
    const res = await fetch(`${BASE_URL}/api/social/relationship?targetDid=${encodeURIComponent(bobDid)}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.isFollowing).toBe(true);
    expect(data.isFollowedBy).toBe(false); // Bob hasn't followed Alice yet
  });

  it('Alice updates profile with cover photo banner and website URL via POST /api/user/update', async () => {
    const sampleCover = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect fill="%234338ca" width="600" height="200"/></svg>';
    const websiteUrl = 'https://sovra.freedom.mesh';

    const updateRes = await fetch(`${BASE_URL}/api/user/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        coverDataUrl: sampleCover,
        websiteUrl: websiteUrl,
        bio: 'Updated bio with sovereign metadata',
      }),
    });

    expect(updateRes.status).toBe(200);
    const updateData = await updateRes.json();
    expect(updateData.ok).toBe(true);
    expect(updateData.user.coverDataUrl).toBe(sampleCover);
    expect(updateData.user.websiteUrl).toBe(websiteUrl);
    expect(updateData.user.bio).toBe('Updated bio with sovereign metadata');
  });

  it('fetches unprivileged node storage telemetry via GET /api/node/storage-stats', async () => {
    const statsRes = await fetch(`${BASE_URL}/api/node/storage-stats`);
    expect(statsRes.status).toBe(200);
    const stats = await statsRes.json();
    expect(stats.ok).toBe(true);
    expect(typeof stats.diskBytes).toBe('number');
    expect(typeof stats.diskMB).toBe('string');
    expect(typeof stats.blocksCount).toBe('number');
    expect(typeof stats.postsCount).toBe('number');
    expect(typeof stats.usersCount).toBe('number');
    expect(typeof stats.uptimeSec).toBe('number');
    expect(stats.diskBytes).toBeGreaterThanOrEqual(0);
  });

  it('registers a second device session for Alice and verifies in GET /api/user/sessions', async () => {
    // Login with device "Alice Tablet Node"
    const loginRes = await fetch(`${BASE_URL}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: aliceHandle,
        device: 'Alice Tablet Node',
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginData = await loginRes.json();
    expect(loginData.ok).toBe(true);
    aliceDevice2Token = loginData.sessionToken;

    // Get active sessions using primary device token
    const sessRes = await fetch(`${BASE_URL}/api/user/sessions`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(sessRes.status).toBe(200);
    const sessData = await sessRes.json();
    expect(sessData.ok).toBe(true);
    expect(Array.isArray(sessData.sessions)).toBe(true);
    expect(sessData.sessions.length).toBeGreaterThanOrEqual(2);

    const dev2Session = sessData.sessions.find((s: any) => s.deviceName === 'Alice Tablet Node');
    expect(dev2Session).toBeDefined();
    expect(dev2Session.status).toBe('active');
    aliceDevice2Id = dev2Session.id;
  });

  it('revokes Alice Tablet Node remotely and verifies 401 Unauthorized rejection on revoked token', async () => {
    // Revoke device 2 using primary device token
    const revokeRes = await fetch(`${BASE_URL}/api/user/sessions/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        sessionId: aliceDevice2Id,
      }),
    });
    expect(revokeRes.status).toBe(200);
    const revokeData = await revokeRes.json();
    expect(revokeData.ok).toBe(true);

    // Attempting an authorized action with device 2's revoked token MUST fail with 401
    const failRes = await fetch(`${BASE_URL}/api/user/sessions`, {
      headers: { Authorization: `Bearer ${aliceDevice2Token}` },
    });
    expect(failRes.status).toBe(401);
    const failData = await failRes.json();
    expect(failData.error).toMatch(/(revoked|authentication required|unauthorized)/i);

    // Primary device token MUST remain fully authorized
    const okRes = await fetch(`${BASE_URL}/api/user/sessions`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(okRes.status).toBe(200);
  });

  it('Alice unfollows Bob via POST /api/social/unfollow and updates stats', async () => {
    const unfollowRes = await fetch(`${BASE_URL}/api/social/unfollow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        targetDid: bobDid,
      }),
    });
    expect(unfollowRes.status).toBe(200);
    const unfollowData = await unfollowRes.json();
    expect(unfollowData.ok).toBe(true);
    expect(unfollowData.isFollowing).toBe(false);

    // Verify Bob's followers list no longer contains Alice
    const res = await fetch(`${BASE_URL}/api/social/followers?did=${encodeURIComponent(bobDid)}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    const aliceInBobFollowers = data.followers.find((u: any) => u.did === aliceDid);
    expect(aliceInBobFollowers).toBeUndefined();
  });
});
