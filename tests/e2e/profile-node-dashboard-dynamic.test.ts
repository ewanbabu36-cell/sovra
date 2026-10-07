/**
 * @file tests/e2e/profile-node-dashboard-dynamic.test.ts
 * Comprehensive E2E Verification Suite for Sovra Profile & Node Dashboard:
 * 1. Zero Hardcoded Runtime Data Gate
 * 2. Real Cryptographic Ed25519 Verification (/api/identity/verify)
 * 3. Dynamic User Profile Switching & Authoritative State Binding
 * 4. Dynamic Social Graph Counters (Posts, Followers, Following, Friends)
 * 5. Real Node Storage & P2P Telemetry
 * 6. Dynamic Wallet Balance & Off-Chain Vouchers
 * 7. Connected Devices & Remote Session Revocation
 * 8. Responsive Mobile/Desktop CSS Structural Integrity
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { generateEd25519KeyPair, signEd25519, bytesToHex } from '../../packages/crypto/dist/index.js';
import { SovraIdentityKey, decodeEd25519DidKey } from '../../packages/identity/dist/index.js';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('SOVRA Profile & Node Dashboard Dynamicization & Production Suite', () => {
  let serverHtml = '';
  let aliceToken = '';
  let aliceUser: any = null;
  let bobToken = '';
  let bobUser: any = null;

  beforeAll(async () => {
    // 1. Fetch rendered root HTML
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    serverHtml = await res.text();

    // 2. Register User Alice
    const regAlice = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `alice_mesh_${Date.now()}`,
        name: 'Alice Pioneer',
        displayName: 'Alice Pioneer',
        bio: 'Decentralized P2P Mesh Architect',
      }),
    });
    const aliceData = await regAlice.json();
    expect(aliceData.ok).toBe(true);
    aliceToken = aliceData.sessionToken;
    aliceUser = aliceData.user;

    // 3. Register User Bob
    const regBob = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `bob_seeder_${Date.now()}`,
        name: 'Bob Seeder',
        displayName: 'Bob Seeder',
        bio: 'High-bandwidth BitSwap Swarm Node',
      }),
    });
    const bobData = await regBob.json();
    expect(bobData.ok).toBe(true);
    bobToken = bobData.sessionToken;
    bobUser = bobData.user;
  });

  describe('1. Zero Hardcoded Runtime Data Gate', () => {
    it('verifies rendered HTML contains zero hardcoded peer counters or fake dimensions', () => {
      // Must not contain fake "524" peers or static stats
      expect(serverHtml).not.toContain('524 Peers Active');
      expect(serverHtml).not.toContain('>9.2 MB<');
      expect(serverHtml).not.toContain('420.50 SOV');
      expect(serverHtml).not.toContain('+142.80 SOV');
      expect(serverHtml).not.toContain('+277.70 SOV');
    });

    it('verifies dynamic DOM IDs exist in rendered Profile card', () => {
      expect(serverHtml).toContain('id="meProfileName"');
      expect(serverHtml).toContain('id="meProfileHandle"');
      expect(serverHtml).toContain('id="meProfileDid"');
      expect(serverHtml).toContain('id="meEd25519Badge"');
      expect(serverHtml).toContain('id="meMeshStatusBadge"');
      expect(serverHtml).toContain('id="meCardDid"');
      expect(serverHtml).toContain('id="meCardPeerId"');
      expect(serverHtml).toContain('id="meCardDeviceKey"');
      expect(serverHtml).toContain('id="meFeedPostsCount"');
      expect(serverHtml).toContain('id="meFriendsCount"');
      expect(serverHtml).toContain('id="meFollowersCount"');
      expect(serverHtml).toContain('id="meFollowingCount"');
      expect(serverHtml).toContain('id="meSeededBytes"');
      expect(serverHtml).toContain('id="copyProfileDidBtn"');
      expect(serverHtml).toContain('id="walletBalanceSovDisplay"');
      expect(serverHtml).toContain('id="walletBalanceFiatDisplay"');
    });

    it('verifies MeScreen.tsx mobile component has zero hardcoded persona fallback', () => {
      const meScreenPath = path.resolve(__dirname, '../../apps/sovra-mobile/src/screens/MeScreen.tsx');
      const meScreenContent = fs.readFileSync(meScreenPath, 'utf8');
      expect(meScreenContent).not.toContain('@meraj_sharif');
      expect(meScreenContent).not.toContain('Meraj Sharif');
      expect(meScreenContent).not.toContain('did:key:z6MksMerajCryptographicIdentitySovraPlanetaryMesh');
    });
  });

  describe('2. Cryptographic Identity Verification Engine (/api/identity/verify)', () => {
    it('verifies valid Ed25519 DID successfully with real multicodec 0xed01 decoding', async () => {
      const identity = SovraIdentityKey.generate();
      const res = await fetch(`${BASE_URL}/api/identity/verify?did=${encodeURIComponent(identity.did)}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.verified).toBe(true);
      expect(data.status).toBe('VERIFIED');
      expect(data.algorithm).toBe('Ed25519');
      expect(data.multicodec).toBe('0xed01');
      expect(typeof data.publicKeyHex).toBe('string');
      expect(data.publicKeyHex.length).toBe(64); // 32 bytes in hex

      // Also verify registered user DID
      const userRes = await fetch(`${BASE_URL}/api/identity/verify?did=${encodeURIComponent(aliceUser.did)}`);
      expect(userRes.status).toBe(200);
      const userData = await userRes.json();
      expect(userData.ok).toBe(true);
      expect(userData.verified).toBe(true);
    });

    it('verifies Ed25519 digital signature proof over wire', async () => {
      const identity = SovraIdentityKey.generate();
      const did = identity.did;

      const messageText = `sovra-auth-challenge-${Date.now()}`;
      const msgBytes = new TextEncoder().encode(messageText);
      const signatureBytes = identity.sign(msgBytes);
      const signatureHex = bytesToHex(signatureBytes);

      const res = await fetch(`${BASE_URL}/api/identity/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          did,
          message: messageText,
          signature: signatureHex,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.verified).toBe(true);
      expect(data.signatureVerified).toBe(true);
      expect(data.did).toBe(did);
    });

    it('rejects forged / invalid DID format with HTTP 400', async () => {
      const res = await fetch(`${BASE_URL}/api/identity/verify?did=did:key:zInvalidForgedSignatureBogus`);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.verified).toBe(false);
      expect(data.status).toBe('FAILED');
    });
  });

  describe('3. Dynamic User Profile & Authoritative Identity Switching', () => {
    it('returns authoritative profile data for Alice through /api/user/me', async () => {
      const res = await fetch(`${BASE_URL}/api/user/me`, {
        headers: { 'Authorization': `Bearer ${aliceToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.user.did).toBe(aliceUser.did);
      expect(data.user.handle).toBe(aliceUser.handle);
      expect(data.user.name).toBe('Alice Pioneer');
      expect(data.user.bio).toBe('Decentralized P2P Mesh Architect');
    });

    it('returns authoritative profile data for Bob through /api/user/me', async () => {
      const res = await fetch(`${BASE_URL}/api/user/me`, {
        headers: { 'Authorization': `Bearer ${bobToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.user.did).toBe(bobUser.did);
      expect(data.user.handle).toBe(bobUser.handle);
      expect(data.user.name).toBe('Bob Seeder');
      expect(data.user.did).not.toBe(aliceUser.did);
    });

    it('supports profile round-trip update via /api/user/update', async () => {
      const updateRes = await fetch(`${BASE_URL}/api/user/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          did: aliceUser.did,
          bio: 'Updated bio: Mesh Relay Operator 🚀',
          website: 'https://alice.sovra.mesh',
        }),
      });

      expect(updateRes.status).toBe(200);
      const updateData = await updateRes.json();
      expect(updateData.ok).toBe(true);
      expect(updateData.user.bio).toBe('Updated bio: Mesh Relay Operator 🚀');
      expect(updateData.user.website).toBe('https://alice.sovra.mesh');
    });
  });

  describe('4. Dynamic Social Graph Counters', () => {
    it('verifies follower and following count transitions between Alice and Bob', async () => {
      // Alice follows Bob
      const followRes = await fetch(`${BASE_URL}/api/social/follow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ targetDid: bobUser.did }),
      });
      expect(followRes.status).toBe(200);

      // Check Bob's followers
      const bobFollowersRes = await fetch(`${BASE_URL}/api/social/followers?did=${encodeURIComponent(bobUser.did)}`);
      expect(bobFollowersRes.status).toBe(200);
      const bobFollowers = await bobFollowersRes.json();
      expect(bobFollowers.ok).toBe(true);
      expect(bobFollowers.followers.some((u: any) => u.did === aliceUser.did)).toBe(true);

      // Check Alice's following
      const aliceFollowingRes = await fetch(`${BASE_URL}/api/social/following?did=${encodeURIComponent(aliceUser.did)}`);
      expect(aliceFollowingRes.status).toBe(200);
      const aliceFollowing = await aliceFollowingRes.json();
      expect(aliceFollowing.ok).toBe(true);
      expect(aliceFollowing.following.some((u: any) => u.did === bobUser.did)).toBe(true);
    });

    it('creates a post and verifies feed author post counter increment', async () => {
      const postRes = await fetch(`${BASE_URL}/api/feed/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          caption: 'Live decentralized post from Alice #SovraP2P',
          postType: 'standard',
        }),
      });
      expect(postRes.status).toBe(200);

      const feedRes = await fetch(`${BASE_URL}/api/feed/list`);
      expect(feedRes.status).toBe(200);
      const feedData = await feedRes.json();
      expect(feedData.ok).toBe(true);
      const alicePosts = feedData.posts.filter((p: any) => p.authorDid === aliceUser.did);
      expect(alicePosts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('5. Real Node Storage & P2P Telemetry', () => {
    it('fetches real storage stats from /api/node/storage-stats', async () => {
      const res = await fetch(`${BASE_URL}/api/node/storage-stats`);
      expect(res.status).toBe(200);
      const stats = await res.json();
      expect(stats.ok).toBe(true);
      expect(typeof stats.diskStorageBytes).toBe('number');
      expect(stats.diskStorageBytes).toBeGreaterThan(0);
      expect(typeof stats.diskStorageMb).toBe('number');
      expect(typeof stats.uptimeSeconds).toBe('number');
      expect(stats.uptimeSeconds).toBeGreaterThan(0);
    });

    it('fetches node status and peer identity from /api/status', async () => {
      const res = await fetch(`${BASE_URL}/api/status`);
      expect(res.status).toBe(200);
      const st = await res.json();
      expect(st.ok).toBe(true);
      expect(typeof st.peerId).toBe('string');
      expect(st.peerId.length).toBeGreaterThan(20);
      expect(typeof st.nodeUptimeSeconds).toBe('number');
    });
  });

  describe('6. Dynamic Sovereign Wallet & Off-Chain Vouchers', () => {
    it('queries dynamic wallet statistics for Alice', async () => {
      const res = await fetch(`${BASE_URL}/api/wallet/stats?did=${encodeURIComponent(aliceUser.did)}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.did).toBe(aliceUser.did);
      expect(typeof data.balanceSov).toBe('number');
      expect(typeof data.balanceFiat).toBe('number');
      expect(data.balanceFiat).toBe(Number((data.balanceSov * 3.0).toFixed(2)));
      expect(typeof data.stakedBond).toBe('number');
      expect(typeof data.relayGas).toBe('number');
    });

    it('executes off-chain tip and verifies dynamic balance and voucher updates', async () => {
      const initialWallet = await (await fetch(`${BASE_URL}/api/wallet/stats?did=${encodeURIComponent(aliceUser.did)}`)).json();
      const initialBalance = initialWallet.balanceSov;

      const tipRes = await fetch(`${BASE_URL}/api/watch/tip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          amount: 20,
          recipientDid: bobUser.did,
          creatorDid: bobUser.did,
          message: 'Great decentralized swarming Bob!',
        }),
      });

      expect(tipRes.status).toBe(200);
      const tipData = await tipRes.json();
      expect(tipData.ok).toBe(true);
      expect(tipData.newBalance).toBe(initialBalance - 20);

      // Verify Alice wallet stats reflects new balance
      const updatedWallet = await (await fetch(`${BASE_URL}/api/wallet/stats?did=${encodeURIComponent(aliceUser.did)}`)).json();
      expect(updatedWallet.balanceSov).toBe(initialBalance - 20);

      // Verify Bob wallet stats reflects received tips
      const bobWallet = await (await fetch(`${BASE_URL}/api/wallet/stats?did=${encodeURIComponent(bobUser.did)}`)).json();
      expect(bobWallet.tipsEarned).toBeGreaterThan(0);
      expect(bobWallet.receivedVouchersCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('7. Connected Devices & Remote Session Revocation', () => {
    it('lists active hardware sessions for Alice', async () => {
      const res = await fetch(`${BASE_URL}/api/user/sessions`, {
        headers: { 'Authorization': `Bearer ${aliceToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.sessions)).toBe(true);
      expect(data.sessions.length).toBeGreaterThanOrEqual(1);

      const current = data.sessions.find((s: any) => s.isCurrent);
      expect(current).toBeDefined();
      expect(current.status).toBe('active');
    });

    it('authorizes and revokes remote session', async () => {
      // Create second device session for Alice
      const loginRes = await fetch(`${BASE_URL}/api/user/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: aliceUser.handle,
          deviceName: 'iPad Pro Test Device',
          deviceType: 'Tablet',
        }),
      });
      expect(loginRes.status).toBe(200);
      const loginData = await loginRes.json();
      expect(loginData.ok).toBe(true);
      const secondSessionToken = loginData.sessionToken;

      // Alice lists sessions from primary device
      const sessionsRes = await fetch(`${BASE_URL}/api/user/sessions`, {
        headers: { 'Authorization': `Bearer ${aliceToken}` },
      });
      const sessions = (await sessionsRes.json()).sessions;
      const remoteSession = sessions.find((s: any) => s.deviceName === 'iPad Pro Test Device');
      expect(remoteSession).toBeDefined();

      // Alice revokes remote session
      const revokeRes = await fetch(`${BASE_URL}/api/user/sessions/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ sessionId: remoteSession.sessionId }),
      });
      expect(revokeRes.status).toBe(200);
      const revokeData = await revokeRes.json();
      expect(revokeData.ok).toBe(true);

      // Verify revoked session cannot access authenticated endpoints
      const testRevokedRes = await fetch(`${BASE_URL}/api/user/sessions`, {
        headers: { 'Authorization': `Bearer ${secondSessionToken}` },
      });
      expect(testRevokedRes.status).toBe(401);
    });
  });

  describe('8. Responsive CSS Rules & Layout Integrity', () => {
    it('verifies responsive CSS breakpoints and zero fixed-width overflows', () => {
      // Check mobile media queries
      expect(serverHtml).toContain('@media (max-width: 640px)');
      expect(serverHtml).toContain('@media (max-width: 380px)');

      // Check responsive flex & wrap classes
      expect(serverHtml).toContain('.profile-actions-wrap');
      expect(serverHtml).toContain('.profile-avatar-row');
      expect(serverHtml).toContain('.profile-stat-box');
      expect(serverHtml).toContain('overflow-wrap: anywhere');
      expect(serverHtml).toContain('word-break: break-all');

      // Check max-width container constraints
      expect(serverHtml).toContain('max-width: 900px');
      expect(serverHtml).toContain('box-sizing: border-box');
    });
  });
});
