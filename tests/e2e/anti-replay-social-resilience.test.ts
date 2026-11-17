import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('Anti-Replay Social Resilience & Origin Security Suite', { timeout: 30000 }, () => {
  let userAToken: string;
  let userADid: string;
  let userBDid: string;

  it('registers User A and User B for friend request testing', async () => {
    const timestamp = Date.now();
    const resA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@test_sender_${timestamp}`,
        name: 'Sender Peer',
      }),
    });
    expect(resA.status).toBe(200);
    const dataA = await resA.json();
    expect(dataA.ok).toBe(true);
    userAToken = dataA.sessionToken;
    userADid = dataA.user.did;

    const resB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@test_recv_${timestamp}`,
        name: 'Receiver Peer',
      }),
    });
    expect(resB.status).toBe(200);
    const dataB = await resB.json();
    expect(dataB.ok).toBe(true);
    userBDid = dataB.user.did;
  });

  it('allows friend request with client nonce and timestamp headers', async () => {
    const sharedNonce = 'test_nonce_' + Date.now();
    const timestamp = String(Date.now());

    const res = await fetch(`${BASE_URL}/api/friends/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAToken}`,
        'X-Sovra-Session-Token': userAToken,
        'X-Sovra-DID': userADid,
        'X-Sovra-Nonce': sharedNonce,
        'X-Sovra-Timestamp': timestamp,
        'X-Sovra-CSRF': '1',
      },
      body: JSON.stringify({
        fromDid: userADid,
        toDid: userBDid,
        sessionToken: userAToken,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('does NOT reject retried social request with the same nonce (avoids 403 replay false-positive)', async () => {
    // Replay the exact same request with the exact same nonce (as happens during 401 refresh or double click)
    const duplicateNonce = 'dup_social_nonce_' + Date.now();
    const timestamp = String(Date.now());

    // First attempt
    await fetch(`${BASE_URL}/api/friends/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAToken}`,
        'X-Sovra-Session-Token': userAToken,
        'X-Sovra-DID': userADid,
        'X-Sovra-Nonce': duplicateNonce,
        'X-Sovra-Timestamp': timestamp,
        'X-Sovra-CSRF': '1',
      },
      body: JSON.stringify({
        fromDid: userADid,
        toDid: userBDid,
        sessionToken: userAToken,
      }),
    });

    // Second attempt with exact same nonce
    const resRetry = await fetch(`${BASE_URL}/api/friends/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAToken}`,
        'X-Sovra-Session-Token': userAToken,
        'X-Sovra-DID': userADid,
        'X-Sovra-Nonce': duplicateNonce,
        'X-Sovra-Timestamp': timestamp,
        'X-Sovra-CSRF': '1',
      },
      body: JSON.stringify({
        fromDid: userADid,
        toDid: userBDid,
        sessionToken: userAToken,
      }),
    });

    // Should NOT be 403 Anti-replay error
    expect(resRetry.status).not.toBe(403);
    const dataRetry = await resRetry.json();
    expect(dataRetry.ok).toBe(true);
    expect(dataRetry.error || '').not.toMatch(/Anti-replay protection violation/);
  });

  it('allows mutating requests from mobile LAN IP or Cloudflare tunnel origins with cookie & CSRF header', async () => {
    const res = await fetch(`${BASE_URL}/api/friends/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `sovra_session=${userAToken}`,
        'Origin': 'https://10.42.22.224:3443',
        'X-Sovra-Session-Token': userAToken,
        'X-Sovra-DID': userADid,
        'X-Sovra-Nonce': 'lan_nonce_' + Date.now(),
        'X-Sovra-Timestamp': String(Date.now()),
        'X-Sovra-CSRF': '1',
      },
      body: JSON.stringify({
        fromDid: userADid,
        toDid: userBDid,
        sessionToken: userAToken,
      }),
    });

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('strictly blocks replayed nonces on financial endpoints', async () => {
    const replayNonce = 'fin_nonce_' + Date.now();
    const timestamp = String(Date.now());

    // First attempt on financial route
    await fetch(`${BASE_URL}/api/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAToken}`,
        'X-Sovra-Session-Token': userAToken,
        'X-Sovra-Nonce': replayNonce,
        'X-Sovra-Timestamp': timestamp,
      },
      body: JSON.stringify({ amount: 10, recipient: userBDid }),
    });

    // Second attempt with exact same nonce must be blocked by anti-replay
    const resReplay = await fetch(`${BASE_URL}/api/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAToken}`,
        'X-Sovra-Session-Token': userAToken,
        'X-Sovra-Nonce': replayNonce,
        'X-Sovra-Timestamp': timestamp,
      },
      body: JSON.stringify({ amount: 10, recipient: userBDid }),
    });

    expect(resReplay.status).toBe(403);
    const data = await resReplay.json();
    expect(data.error).toContain('Anti-replay protection violation');
  });
});
