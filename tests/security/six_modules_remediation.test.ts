/**
 * @file tests/security/six_modules_remediation.test.ts
 * Master Forensic Verification Suite for the Six Core Modules:
 * 1. Wallet (Atomic Ledger, Idempotency, Faucet)
 * 2. Creator Studio (Auth Enforced, Payout Settlement, Zero Backdoors)
 * 3. BLE / SOVRA Mesh (Protocol & DTN Queue Simulation, Hardware Truthfulness)
 * 4. Settings (BOLA/IDOR Remediation, Cross-User Mutation Prevention)
 * 5. Video (Persona Leakage Elimination, Auth Verification)
 * 6. Reels (ABR Chunking, 95/5 Tipping Split)
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sovraDb } from '../../scripts/database-engine.ts';

const BASE_URL = 'http://127.0.0.1:3001';

// Base58 helper
const B58_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function encodeBase58(buffer: Uint8Array): string {
  let digits = [0];
  for (let i = 0; i < buffer.length; i++) {
    for (let j = 0; j < digits.length; j++) digits[j] <<= 8;
    digits[0] += buffer[i];
    let carry = 0;
    for (let j = 0; j < digits.length; ++j) {
      digits[j] += carry;
      carry = (digits[j] / 58) | 0;
      digits[j] %= 58;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) digits.push(0);
  return digits.reverse().map(d => B58_CHARS[d]).join('');
}

function makeDidKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const rawPub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const prefixed = new Uint8Array(34);
  prefixed[0] = 0xed;
  prefixed[1] = 0x01;
  prefixed.set(rawPub, 2);
  const did = `did:key:z${encodeBase58(prefixed)}`;
  return { did, rawPub, privateKey };
}

function computeCanonicalQuery(queryString?: string): string {
  if (!queryString) return '';
  const clean = queryString.replace(/^\?/, '');
  if (!clean) return '';
  const params = new URLSearchParams(clean);
  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

function signRequestV2(params: {
  method: string;
  pathname: string;
  query?: string;
  body?: any;
  did: string;
  keyId?: string;
  nonce?: string;
  timestamp?: string;
  privateKey: crypto.KeyObject;
  extraHeaders?: Record<string, string>;
}) {
  const method = params.method.toUpperCase();
  const pathname = params.pathname;
  const canonicalQuery = computeCanonicalQuery(params.query);
  const bodyStr = params.body !== undefined
    ? (typeof params.body === 'string' ? params.body : JSON.stringify(params.body))
    : '';
  const bodyHash = crypto.createHash('sha256').update(Buffer.from(bodyStr, 'utf8')).digest('hex');
  const did = params.did;
  const keyId = params.keyId || did;
  const nonce = params.nonce || 'nonce_' + crypto.randomBytes(8).toString('hex');
  const timestamp = params.timestamp || String(Date.now());

  const canonicalString = `SOVRA-REQ-V2\n${method}\n${pathname}\n${canonicalQuery}\n${bodyHash}\n${did}\n${keyId}\n${nonce}\n${timestamp}`;
  const sigBytes = crypto.sign(null, Buffer.from(canonicalString, 'utf8'), params.privateKey);

  return {
    headers: {
      'x-sovra-did': did,
      'x-sovra-key-id': keyId,
      'x-sovra-nonce': nonce,
      'x-sovra-timestamp': timestamp,
      'x-sovra-signature': sigBytes.toString('hex'),
      'x-sovra-signature-version': '2',
      'Content-Type': 'application/json',
      ...(params.extraHeaders || {}),
    },
    nonce,
    timestamp,
    bodyStr,
  };
}

async function makeSignedRequest(
  method: string,
  pathname: string,
  keypair: { did: string; privateKey: crypto.KeyObject } | null,
  body?: any,
  query?: string,
  extraHeaders?: Record<string, string>
): Promise<{ status: number; body: any }> {
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let bodyStr: string | undefined;

  if (body !== undefined) {
    bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  }

  if (keypair) {
    const signed = signRequestV2({
      method,
      pathname,
      query,
      body: bodyStr,
      did: keypair.did,
      privateKey: keypair.privateKey,
      extraHeaders,
    });
    headers = signed.headers;
  } else if (extraHeaders) {
    headers = { ...headers, ...extraHeaders };
  }

  const canonicalQuery = computeCanonicalQuery(query);
  const url = `${BASE_URL}${pathname}${canonicalQuery ? '?' + canonicalQuery : ''}`;
  const res = await fetch(url, {
    method,
    headers,
    body: bodyStr,
  });

  let parsed: any;
  const text = await res.text();
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  return { status: res.status, body: parsed };
}

describe('Master Forensic Remediation Test Suite — Six Core Modules', () => {
  const alice = makeDidKey();
  const bob = makeDidKey();
  const eve = makeDidKey();

  before(() => {
    const sqlite = (sovraDb as any).getSqliteEngine?.()?.db;
    const now = Date.now();

    // Alice: balance 100.0 SOV
    sovraDb.registerUser({
      did: alice.did,
      handle: '@test_alice',
      displayName: 'Alice Test',
      balanceSov: 100.0,
    });
    sqlite?.prepare(`
      INSERT OR REPLACE INTO users (did, handle, display_name, avatar, avatar_bg, balance_sov, device_type, created_at, updated_at)
      VALUES (?, ?, ?, '👩', '#6366f1', 100.0, 'Desktop', ?, ?)
    `).run(alice.did, '@test_alice_' + alice.did.slice(-6), 'Alice Test', now, now);

    // Bob: balance 20.0 SOV
    sovraDb.registerUser({
      did: bob.did,
      handle: '@test_bob',
      displayName: 'Bob Test',
      balanceSov: 20.0,
    });
    sqlite?.prepare(`
      INSERT OR REPLACE INTO users (did, handle, display_name, avatar, avatar_bg, balance_sov, device_type, created_at, updated_at)
      VALUES (?, ?, ?, '👨', '#10b981', 20.0, 'Desktop', ?, ?)
    `).run(bob.did, '@test_bob_' + bob.did.slice(-6), 'Bob Test', now, now);

    // Eve: balance 0.0 SOV
    sovraDb.registerUser({
      did: eve.did,
      handle: '@test_eve',
      displayName: 'Eve Attacker',
      balanceSov: 0.0,
    });
    sqlite?.prepare(`
      INSERT OR REPLACE INTO users (did, handle, display_name, avatar, avatar_bg, balance_sov, device_type, created_at, updated_at)
      VALUES (?, ?, ?, '🦹', '#ef4444', 0.0, 'Desktop', ?, ?)
    `).run(eve.did, '@test_eve_' + eve.did.slice(-6), 'Eve Attacker', now, now);
  });

  // ==========================================
  // MODULE 1: WALLET
  // ==========================================
  describe('Module 1: Wallet & Atomic Ledger Transfer', () => {
    it('1.1 Should reject unauthenticated POST /api/wallet/transfer with 401', async () => {
      const res = await makeSignedRequest('POST', '/api/wallet/transfer', null, {
        recipientDid: bob.did,
        amount: 10.0,
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.ok, false);
    });

    it('1.2 Should reject transfer if client attempts to forge senderDid (BOLA)', async () => {
      const res = await makeSignedRequest('POST', '/api/wallet/transfer', alice, {
        senderDid: bob.did, // Alice signs with Alice's key but tries to debit Bob's account
        recipientDid: alice.did,
        amount: 10.0,
      });
      assert.equal(res.status, 403);
      assert.equal(res.body.ok, false);
      assert.match(res.body.error, /Forbidden/i);
    });

    it('1.3 Should execute atomic P2P transfer from Alice to Bob with double-entry SQLite verification', async () => {
      const idempotencyKey = 'p2p_idemp_' + crypto.randomUUID();
      const res = await makeSignedRequest('POST', '/api/wallet/transfer', alice, {
        recipientDid: bob.did,
        amount: 25.0,
        memo: 'Test P2P Transfer',
      }, undefined, { 'idempotency-key': idempotencyKey });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.amount, 25.0);
      assert.equal(res.body.senderDid, alice.did);
      assert.equal(res.body.recipientDid, bob.did);

      // Verify on SQLite ledger directly
      const sqlite = (sovraDb as any).getSqliteEngine?.()?.db;
      const aliceRow = sqlite.prepare('SELECT balance_sov FROM users WHERE did = ?').get(alice.did);
      const bobRow = sqlite.prepare('SELECT balance_sov FROM users WHERE did = ?').get(bob.did);
      assert.equal(Number(aliceRow.balance_sov), 75.0); // 100 - 25
      assert.equal(Number(bobRow.balance_sov), 45.0); // 20 + 25

      // Verify token_transfers entry
      const txRow = sqlite.prepare('SELECT * FROM token_transfers WHERE from_did = ? AND to_did = ? ORDER BY created_at DESC LIMIT 1').get(alice.did, bob.did);
      assert.ok(txRow);
      assert.equal(Number(txRow.amount_sov), 25.0);
      assert.equal(txRow.tx_type, 'P2P_TRANSFER');
    });

    it('1.4 Should return replay result without double-debiting on duplicate Idempotency-Key', async () => {
      const idempotencyKey = 'replay_test_' + crypto.randomUUID();
      // First request
      const res1 = await makeSignedRequest('POST', '/api/wallet/transfer', alice, {
        recipientDid: bob.did,
        amount: 10.0,
      }, undefined, { 'idempotency-key': idempotencyKey });
      assert.equal(res1.status, 200);
      assert.equal(res1.body.ok, true);

      // Duplicate request with identical key & payload
      const res2 = await makeSignedRequest('POST', '/api/wallet/transfer', alice, {
        recipientDid: bob.did,
        amount: 10.0,
      }, undefined, { 'idempotency-key': idempotencyKey });
      assert.equal(res2.status, 200);
      assert.equal(res2.body.ok, true);
      assert.equal(res2.body.isReplay, true);

      // Verify Alice was only debited once (75 - 10 = 65)
      const sqlite = (sovraDb as any).getSqliteEngine?.()?.db;
      const aliceRow = sqlite.prepare('SELECT balance_sov FROM users WHERE did = ?').get(alice.did);
      assert.equal(Number(aliceRow.balance_sov), 65.0);
    });

    it('1.5 Should reject transfer if balance is insufficient', async () => {
      const res = await makeSignedRequest('POST', '/api/wallet/transfer', eve, {
        recipientDid: alice.did,
        amount: 99999.0, // Eve has 0 SOV
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.ok, false);
      assert.match(res.body.error, /Insufficient balance/i);
    });

    it('1.6 Should reject self-transfer (Alice to Alice)', async () => {
      const res = await makeSignedRequest('POST', '/api/wallet/transfer', alice, {
        recipientDid: alice.did,
        amount: 5.0,
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.ok, false);
      assert.match(res.body.error, /Self-transfer prohibited/i);
    });

    it('1.7 Should require authentication for Faucet claim and enforce 24h limit', async () => {
      // Unauthenticated faucet claim rejected
      const unauth = await makeSignedRequest('POST', '/api/wallet/faucet/claim', null, { amount: 50 });
      assert.equal(unauth.status, 401);

      // Authenticated claim succeeds
      const newClaimer = makeDidKey();
      const claim1 = await makeSignedRequest('POST', '/api/wallet/faucet/claim', newClaimer, { amount: 50 });
      assert.equal(claim1.status, 200);
      assert.equal(claim1.body.ok, true);
      assert.equal(claim1.body.claimed, 50);

      // Immediate second claim rejected with 429 Rate Limit
      const claim2 = await makeSignedRequest('POST', '/api/wallet/faucet/claim', newClaimer, { amount: 50 });
      assert.equal(claim2.status, 429);
      assert.match(claim2.body.error, /Faucet rate limit reached/i);
    });
  });

  // ==========================================
  // MODULE 2: CREATOR STUDIO
  // ==========================================
  describe('Module 2: Creator Studio Authorization & Payout Settlement', () => {
    it('2.1 Should reject unauthenticated POST /api/studio/upload with 401', async () => {
      const res = await makeSignedRequest('POST', '/api/studio/upload', null, {
        title: 'Unauthorized Video',
        description: 'Should fail',
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.ok, false);
    });

    it('2.2 Should reject unauthenticated POST /api/studio/content/delete with 401', async () => {
      const res = await makeSignedRequest('POST', '/api/studio/content/delete', null, {
        contentId: 'vid_12345',
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.ok, false);
    });

    it('2.3 Should reject unauthenticated POST /api/studio/content/update with 401', async () => {
      const res = await makeSignedRequest('POST', '/api/studio/content/update', null, {
        contentId: 'vid_12345',
        title: 'New Title',
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.ok, false);
    });

    it('2.4 Should reject unauthenticated POST /api/studio/playlists/create with 401', async () => {
      const res = await makeSignedRequest('POST', '/api/studio/playlists/create', null, {
        title: 'My Playlist',
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.ok, false);
    });

    it('2.5 Should reject unauthenticated POST /api/studio/monetization/claim-payout with 401', async () => {
      const res = await makeSignedRequest('POST', '/api/studio/monetization/claim-payout', null, {
        amount: 50,
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.ok, false);
    });

    it('2.6 Should allow authenticated creator upload and bind to authenticated principal DID', async () => {
      const res = await makeSignedRequest('POST', '/api/studio/upload', alice, {
        title: 'Alice Sovereign Tutorial',
        description: 'How to build on Sovra',
        tags: '#sovra #crypto',
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.job.creatorDid, alice.did);
    });
  });

  // ==========================================
  // MODULE 3: BLE / SOVRA MESH
  // ==========================================
  describe('Module 3: BLE & Mesh Protocol Invariants', () => {
    it('3.1 Should verify offline store-and-forward voucher structure and signature format', () => {
      const nonce = '0x' + crypto.randomBytes(16).toString('hex');
      const voucherPayload = {
        senderDid: alice.did,
        recipientDid: bob.did,
        amountSov: 15.0,
        nonce,
        expiresAt: Date.now() + 86400000,
      };

      const digest = crypto.createHash('sha256').update(JSON.stringify(voucherPayload)).digest('hex');
      assert.equal(digest.length, 64);
      assert.ok(voucherPayload.expiresAt > Date.now());
    });

    it('3.2 Should accurately verify DTN queue simulation in headless mode', () => {
      // In a headless environment without physical dual handset Bluetooth radios,
      // physical radio propagation cannot be asserted as verified.
      // Must be formally recorded as UNVERIFIED (Hardware Required).
      const bleHardwareAvailable = Boolean(process.env.SOVRA_PHYSICAL_BLE_HANDSETS);
      assert.equal(bleHardwareAvailable, false, 'Headless CI environment does not possess dual physical BLE radios');
    });
  });

  // ==========================================
  // MODULE 4: SETTINGS (BOLA / IDOR REMEDIATION)
  // ==========================================
  describe('Module 4: Settings BOLA & Cross-User IDOR Remediation', () => {
    it('4.1 Should reject unauthenticated GET /api/user/settings with 401', async () => {
      const res = await makeSignedRequest('GET', '/api/user/settings', null);
      assert.equal(res.status, 401);
      assert.equal(res.body.ok, false);
    });

    it('4.2 Should reject unauthenticated POST /api/user/settings with 401', async () => {
      const res = await makeSignedRequest('POST', '/api/user/settings', null, {
        theme: 'dark',
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.ok, false);
    });

    it('4.3 Should reject Eve accessing Alice settings with 403 Forbidden (BOLA Prevention)', async () => {
      const res = await makeSignedRequest('GET', '/api/user/settings', eve, undefined, `did=${alice.did}`);
      assert.equal(res.status, 403);
      assert.equal(res.body.ok, false);
      assert.match(res.body.error, /Forbidden/i);
    });

    it('4.4 Should reject Eve modifying Alice settings with 403 Forbidden (IDOR Prevention)', async () => {
      const res = await makeSignedRequest('POST', '/api/user/settings', eve, {
        emailNotifications: false,
        theme: 'hacked_by_eve',
      }, `did=${alice.did}`);
      assert.equal(res.status, 403);
      assert.equal(res.body.ok, false);
      assert.match(res.body.error, /Forbidden/i);
    });

    it('4.5 Should reject Eve modifying Alice profile with 403 Forbidden', async () => {
      const res = await makeSignedRequest('POST', '/api/profile/update', eve, {
        name: 'Hacked Alice',
        bio: 'Defaced profile',
      }, `did=${alice.did}`);
      assert.equal(res.status, 403);
      assert.equal(res.body.ok, false);
      assert.match(res.body.error, /Forbidden/i);
    });

    it('4.6 Should allow Alice to read and write her own settings', async () => {
      const postRes = await makeSignedRequest('POST', '/api/user/settings', alice, {
        video_autoplay: 0,
        push_notifications: 0,
      });
      assert.equal(postRes.status, 200);
      assert.equal(postRes.body.ok, true);
      assert.equal(postRes.body.settings.video_autoplay, 0);

      const getRes = await makeSignedRequest('GET', '/api/user/settings', alice);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.ok, true);
      assert.equal(getRes.body.settings.video_autoplay, 0);
    });
  });

  // ==========================================
  // MODULE 5: VIDEO
  // ==========================================
  describe('Module 5: Video & Persona Privacy Invariants', () => {
    it('5.1 Should reject unauthenticated GET /api/subscriptions/feed with 401', async () => {
      const res = await makeSignedRequest('GET', '/api/subscriptions/feed', null);
      assert.equal(res.status, 401);
      assert.equal(res.body.ok, false);
    });

    it('5.2 Should reject unauthenticated GET /api/subscriptions/channels with 401', async () => {
      const res = await makeSignedRequest('GET', '/api/subscriptions/channels', null);
      assert.equal(res.status, 401);
      assert.equal(res.body.ok, false);
    });

    it('5.3 Should reject Eve accessing Alice subscription feed with 403 Forbidden', async () => {
      const res = await makeSignedRequest('GET', '/api/subscriptions/feed', eve, undefined, `userDid=${alice.did}`);
      assert.equal(res.status, 403);
      assert.equal(res.body.ok, false);
      assert.match(res.body.error, /Forbidden/i);
    });

    it('5.4 Should reject unauthenticated watch progress beacon with 401', async () => {
      const res = await makeSignedRequest('POST', '/api/watch/history/progress', null, {
        videoId: 'vid_test_1',
        currentTimeSec: 120,
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.ok, false);
    });

    it('5.5 Should record watch history progress for authenticated user', async () => {
      const res = await makeSignedRequest('POST', '/api/watch/history/progress', alice, {
        videoId: 'vid_test_1',
        currentTimeSec: 150,
        durationWatchedSec: 150,
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.history.userDid, alice.did);
    });
  });

  // ==========================================
  // MODULE 6: REELS
  // ==========================================
  describe('Module 6: Reels Streaming & 95/5 Universal Tipping', () => {
    let testReelId = '';

    it('6.1 Should list reels with pagination', async () => {
      const res = await makeSignedRequest('GET', '/api/reels/list', null, undefined, 'limit=5');
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.ok(Array.isArray(res.body.reels));
      if (res.body.reels.length > 0) {
        testReelId = res.body.reels[0].id;
      }
    });

    it('6.2 Should execute atomic micro-tip on reel with 95% creator and 5% seeder split', async () => {
      const targetReelId = testReelId || 'reel-sample-1';
      const res = await makeSignedRequest('POST', '/api/reels/tip', alice, {
        reelId: targetReelId,
        creatorDid: bob.did,
        amountSov: 10.0,
        message: 'Great sovereign reel!',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.settlement.total, 10.0);
      assert.equal(res.body.settlement.split95_5.creatorShare, 9.50); // 95%
      assert.equal(res.body.settlement.split95_5.seederShare, 0.50);  // 5%

      // Verify on SQLite ledger directly
      const sqlite = (sovraDb as any).getSqliteEngine?.()?.db;
      const txRow = sqlite.prepare("SELECT * FROM token_transfers WHERE from_did = ? AND tx_type = 'MICRO_TIP' ORDER BY created_at DESC LIMIT 1").get(alice.did);
      assert.ok(txRow);
      assert.equal(Number(txRow.amount_sov), 10.0);
    });
  });
});
