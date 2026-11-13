/**
 * @file tests/security/did_spoofing.test.ts
 * 🛡️ PHASE 1: IDENTITY & ADMIN SECURITY REMEDIATION ADVERSARIAL SUITE (TSK-P0-01)
 *
 * Verifies:
 * 1. Spoofed DID header without credentials → HTTP 401 Unauthorized
 * 2. Invalid or expired session token → HTTP 401 Unauthorized
 * 3. Invalid Ed25519 signature → HTTP 401 Unauthorized
 * 4. Replayed signed request → rejected (HTTP 401 Unauthorized)
 * 5. Authenticated regular user attempting admin operations → HTTP 403 Forbidden
 * 6. Unauthenticated balance adjustment → HTTP 401 Unauthorized
 * 7. Unauthenticated role assignment → HTTP 401 Unauthorized
 * 8. Legitimate authenticated user operations → accepted (HTTP 200 OK)
 * 9. Legitimate authorized administrator operations → accepted (HTTP 200 OK)
 * 10. Existing legitimate login, session, and profile flows continue working
 */

import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import {
  generateEd25519KeyPair,
  signEd25519,
  bytesToHex,
} from '../../packages/crypto/dist/index.js';
import {
  encodeEd25519DidKey,
} from '../../packages/identity/dist/index.js';

const BASE_URL = 'http://localhost:3001';
const TEST_ADMIN_KEY = 'sovra-test-admin-secret-key-32-chars-ok!';

describe('PHASE 1: Identity & Admin Security Remediation (TSK-P0-01)', () => {
  let aliceSessionToken: string;
  let aliceDid: string;
  let aliceHandle: string;
  let bobSessionToken: string;
  let bobDid: string;
  let adminSessionToken: string;

  // Ed25519 keypair for cryptographic request signing tests
  const cryptoPair = generateEd25519KeyPair();
  const cryptoDidKey = encodeEd25519DidKey(cryptoPair.publicKey);

  beforeAll(async () => {
    // 1. Register test user Alice
    aliceHandle = `@alice_sec_${Date.now()}`;
    const aliceReg = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: aliceHandle,
        name: 'Alice Security Tester',
        securityPin: '123456',
      }),
    });
    expect(aliceReg.status).toBe(200);
    const aliceData = await aliceReg.json();
    expect(aliceData.ok).toBe(true);
    aliceSessionToken = aliceData.sessionToken;
    aliceDid = aliceData.user.did;

    // 2. Register test user Bob
    const bobHandle = `@bob_sec_${Date.now()}`;
    const bobReg = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: bobHandle,
        name: 'Bob Security Tester',
        securityPin: '654321',
      }),
    });
    expect(bobReg.status).toBe(200);
    const bobData = await bobReg.json();
    bobSessionToken = bobData.sessionToken;
    bobDid = bobData.user.did;

    // 3. Authenticate legitimate administrator session
    const adminLogin = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: 'did:sov:admin_root',
        role: 'SUPER_ADMIN',
        adminKey: TEST_ADMIN_KEY,
      }),
    });
    expect(adminLogin.status).toBe(200);
    const adminData = await adminLogin.json();
    expect(adminData.ok).toBe(true);
    adminSessionToken = adminData.sessionToken;
  });

  // =========================================================================
  // TEST 1: Spoofed DID Header Without Credentials → HTTP 401
  // =========================================================================
  it('1. rejects request presenting spoofed X-Sovra-DID header without credentials (HTTP 401)', async () => {
    const res = await fetch(`${BASE_URL}/api/notifications`, {
      method: 'GET',
      headers: {
        'X-Sovra-DID': aliceDid,
      },
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/Unauthorized/i);
  });

  it('1b. rejects mutating operation presenting spoofed X-Sovra-DID header without token (HTTP 401)', async () => {
    const res = await fetch(`${BASE_URL}/api/social/channels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sovra-DID': aliceDid,
      },
      body: JSON.stringify({
        name: 'Spoofed Channel',
        handle: `@spoofed_${Date.now()}`,
        category: 'tech',
      }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/Unauthorized/i);
  });

  // =========================================================================
  // TEST 2: Invalid or Expired Session → HTTP 401
  // =========================================================================
  it('2. rejects request with invalid or forged Bearer session token (HTTP 401)', async () => {
    const res = await fetch(`${BASE_URL}/api/notifications`, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer stk_invalid_forged_session_token_999999',
      },
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/Unauthorized/i);
  });

  // =========================================================================
  // TEST 3: Invalid Ed25519 Signature → HTTP 401
  // =========================================================================
  it('3. rejects request with forged or invalid Ed25519 signature (HTTP 401)', async () => {
    const ts = Date.now().toString();
    const nonce = 'nonce_' + crypto.randomUUID();
    const forgedSig = '00'.repeat(64); // 64-byte null signature

    const res = await fetch(`${BASE_URL}/api/notifications`, {
      method: 'GET',
      headers: {
        'X-Sovra-DID': cryptoDidKey,
        'X-Sovra-Timestamp': ts,
        'X-Sovra-Nonce': nonce,
        'X-Sovra-Signature': forgedSig,
      },
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/Unauthorized/i);
  });

  it('3b. rejects signed request with expired timestamp (> 5 minutes skew) (HTTP 401)', async () => {
    const expiredTs = (Date.now() - 400_000).toString(); // ~6.6 minutes in past
    const nonce = 'nonce_' + crypto.randomUUID();
    const canonical = `GET:/api/notifications:${nonce}:${expiredTs}`;
    const sig = signEd25519(cryptoPair.privateKey, new TextEncoder().encode(canonical));

    const res = await fetch(`${BASE_URL}/api/notifications`, {
      method: 'GET',
      headers: {
        'X-Sovra-DID': cryptoDidKey,
        'X-Sovra-Timestamp': expiredTs,
        'X-Sovra-Nonce': nonce,
        'X-Sovra-Signature': bytesToHex(sig),
      },
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  // =========================================================================
  // TEST 4: Replayed Signed Request → Rejected (Anti-Replay Protection)
  // =========================================================================
  it('4. accepts authentic Ed25519 signed request, then strictly rejects identical replayed request', async () => {
    const ts = Date.now().toString();
    const nonce = 'nonce_' + crypto.randomUUID();
    const canonical = `GET:/api/notifications:${nonce}:${ts}`;
    const sig = signEd25519(cryptoPair.privateKey, new TextEncoder().encode(canonical));
    const sigHex = bytesToHex(sig);

    // First request: genuine and fresh -> 200 OK
    const firstRes = await fetch(`${BASE_URL}/api/notifications`, {
      method: 'GET',
      headers: {
        'X-Sovra-DID': cryptoDidKey,
        'X-Sovra-Timestamp': ts,
        'X-Sovra-Nonce': nonce,
        'X-Sovra-Signature': sigHex,
      },
    });
    expect(firstRes.status).toBe(200);
    const firstData = await firstRes.json();
    expect(firstData.ok).toBe(true);

    // Second request: exact replay attack with same nonce and timestamp -> 401 Unauthorized
    const replayRes = await fetch(`${BASE_URL}/api/notifications`, {
      method: 'GET',
      headers: {
        'X-Sovra-DID': cryptoDidKey,
        'X-Sovra-Timestamp': ts,
        'X-Sovra-Nonce': nonce,
        'X-Sovra-Signature': sigHex,
      },
    });
    expect([401, 403]).toContain(replayRes.status);
    const replayData = await replayRes.json();
    expect(replayData.ok).toBe(false);
  });

  // =========================================================================
  // TEST 5: Authenticated Regular User Attempting Admin Operation → HTTP 403
  // =========================================================================
  it('5. rejects authenticated regular user attempting role update (HTTP 403)', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/user/update-role`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceSessionToken}`,
      },
      body: JSON.stringify({
        did: aliceDid,
        role: 'SUPER_ADMIN',
      }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/RBAC_PERMISSION_DENIED|Forbidden/i);
  });

  it('5b. rejects authenticated regular user attempting manual balance adjustment (HTTP 403)', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/user/adjust-balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceSessionToken}`,
      },
      body: JSON.stringify({
        did: aliceDid,
        amount: 500,
        reason: 'Unauthorized self-grant',
      }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/RBAC_PERMISSION_DENIED|Forbidden/i);
  });

  it('5c. rejects regular user spoofing x-admin-did header to gain admin access (HTTP 403)', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/user/adjust-balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceSessionToken}`,
        'x-admin-did': 'did:sov:admin_root', // Attempting to override identity
      },
      body: JSON.stringify({
        did: aliceDid,
        amount: 500,
        reason: 'Spoofed admin_root override',
      }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  // =========================================================================
  // TEST 6: Unauthenticated Balance Adjustment → HTTP 401
  // =========================================================================
  it('6. rejects unauthenticated balance adjustment attempt (HTTP 401)', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/user/adjust-balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        did: bobDid,
        amount: 250,
        reason: 'Unauthenticated adjustment attack',
      }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/UNAUTHORIZED|Admin authorization/i);
  });

  // =========================================================================
  // TEST 7: Unauthenticated Role Assignment → HTTP 401
  // =========================================================================
  it('7. rejects unauthenticated role assignment attempt (HTTP 401)', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/user/update-role`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        did: bobDid,
        role: 'SUPER_ADMIN',
      }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/UNAUTHORIZED|Admin authorization/i);
  });

  it('7b. rejects unauthenticated request presenting spoofed x-admin-did: did:sov:admin_root header without credentials (HTTP 401)', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/nuclear/switch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-did': 'did:sov:admin_root',
      },
      body: JSON.stringify({
        switchId: 'emergency_freeze_all_withdrawals',
        active: false,
        reason: 'Spoofed root attempt',
      }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/UNAUTHORIZED/i);
  });

  // =========================================================================
  // TEST 8: Legitimate Authenticated User → Accepted (HTTP 200 OK)
  // =========================================================================
  it('8. permits legitimate authenticated user to access own notifications (HTTP 200)', async () => {
    const res = await fetch(`${BASE_URL}/api/notifications`, {
      headers: {
        Authorization: `Bearer ${aliceSessionToken}`,
      },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.notifications)).toBe(true);
  });

  it('8b. permits legitimate authenticated user to create a Channel (HTTP 200)', async () => {
    const chHandle = `@chan_${Date.now()}`;
    const res = await fetch(`${BASE_URL}/api/social/channels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceSessionToken}`,
      },
      body: JSON.stringify({
        name: 'Alice Sovereign Channel',
        handle: chHandle,
        category: 'tech',
        desc: 'Testing verified identity',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.channel).toBeDefined();
    expect(data.channel.ownerDid).toBe(aliceDid);
  });

  // =========================================================================
  // TEST 9: Legitimate Authorized Administrator → Accepted (HTTP 200 OK)
  // =========================================================================
  it('9. permits authorized administrator to adjust user balance with audit logging (HTTP 200)', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/user/adjust-balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({
        did: bobDid,
        amount: 25.0,
        reason: 'Authorized security remediation test grant',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.did).toBe(bobDid);
    expect(data.delta).toBe(25.0);
  });

  it('9b. permits authorized administrator to update user role with audit logging (HTTP 200)', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/user/update-role`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({
        did: bobDid,
        role: 'CREATOR',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.role).toBe('CREATOR');
  });

  // =========================================================================
  // TEST 10: Existing Legitimate Authentication Flows Continue Working
  // =========================================================================
  it('10. verifies legitimate PIN login and /api/user/me session flow operates smoothly', async () => {
    const loginRes = await fetch(`${BASE_URL}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: aliceHandle,
        pin: '123456',
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginData = await loginRes.json();
    expect(loginData.ok).toBe(true);
    expect(loginData.sessionToken).toBeDefined();

    const meRes = await fetch(`${BASE_URL}/api/user/me`, {
      headers: {
        Authorization: `Bearer ${loginData.sessionToken}`,
      },
    });
    expect(meRes.status).toBe(200);
    const meData = await meRes.json();
    expect(meData.ok).toBe(true);
    expect(meData.user.did).toBe(aliceDid);
  });
});
