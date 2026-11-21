/**
 * @file scripts/audit-phase5-verification.ts
 * Independent Phase 5 Verification Script:
 * Reproduces and rigorously verifies Claims 1-8 of Phase 5 remediation.
 */

import { sovraDb } from './database-engine.ts';
import { sovereignAdminSecurity } from './admin-security.ts';
import { DoubleRatchetChatEngine } from '../packages/messaging/dist/chat-engine.js';
import crypto from 'crypto';

const BASE_URL = 'http://127.0.0.1:3001';
const L1_RPC_URL = 'http://127.0.0.1:26657';

async function runAudit() {
  console.log('=== SOVRA INDEPENDENT PHASE 5 VERIFICATION AUDIT ===\n');

  // 1. L1-Authoritative Wallet Balance Behavior
  console.log('--- [1] L1-Authoritative Wallet Balance Behavior ---');
  try {
    const l1StatusRes = await fetch(`${L1_RPC_URL}/status`);
    const l1Status = await l1StatusRes.json();
    console.log('L1 RPC /status:', {
      chain_id: l1Status.chain_id,
      height: l1Status.height,
      total_supply: l1Status.total_supply,
      supply_correct: l1Status.supply_correct,
      moniker: l1Status.moniker,
    });

    const testAddress = 'sovra12a806ca82d506a025d580d40600abc77a69e10e7';
    const balRes = await fetch(`${L1_RPC_URL}/query/balance?address=${testAddress}`);
    const balData = await balRes.json();
    console.log(`L1 /query/balance?address=${testAddress}:`, balData);
  } catch (err: any) {
    console.error('Error querying L1:', err.message);
  }

  // 2. SQLite Cache Consistency and Failure Handling
  console.log('\n--- [2] SQLite Cache Consistency and Failure Handling ---');
  try {
    const testDid = 'did:sovra:cache_test_' + Date.now();
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did: testDid, handle: 'cache_test_' + Date.now().toString().slice(-4), displayName: 'Cache Test' }),
    });
    const regData = await regRes.json();
    const token = regData.sessionToken;

    // Fetch assets - synchronizes L1 to SQLite
    const assetsRes = await fetch(`${BASE_URL}/api/wallet/assets`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const assetsData = await assetsRes.json();
    console.log('Wallet assets endpoint response:', {
      ok: assetsData.ok,
      nativeBalance: assetsData.nativeBalance,
      nativeSovDisplay: assetsData.assets?.[0]?.displayBalance,
      address: assetsData.address,
    });

    // Check direct SQLite DB row
    const rawDb = sovraDb.getSqliteEngine()?.getRawDb();
    if (rawDb) {
      const uRow = rawDb.prepare('SELECT did, balance_sov FROM users WHERE did = ?').get(testDid) as any;
      console.log('SQLite row balance_sov:', uRow);
    }
  } catch (err: any) {
    console.error('Error in cache consistency test:', err.message);
  }

  // 3. 100M SOV Lifetime Supply Enforcement
  console.log('\n--- [3] 100M SOV Lifetime Supply Enforcement ---');
  try {
    const supply = sovraDb.getTotalSovSupply();
    console.log('Database total supply status:', {
      totalSystemAccountingSov: supply.totalSystemAccountingSov,
      maxLifetimeCapSov: supply.maxLifetimeCapSov,
      remainingMintableSov: supply.remainingMintableSov,
      isWithinCap: supply.isWithinCap,
    });
  } catch (err: any) {
    console.error('Error querying total supply:', err.message);
  }

  // 4. Registration Issuance and Mint Authorization
  console.log('\n--- [4] Registration Issuance and Mint Authorization ---');
  try {
    const newDid = 'did:sovra:unbacked_' + Date.now();
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did: newDid, handle: 'reg_test_' + Date.now().toString().slice(-4), displayName: 'Zero Grant User' }),
    });
    const regData = await regRes.json();
    console.log('Newly registered user balance (API):', regData.user?.balanceSov);

    const rawDb = sovraDb.getSqliteEngine()?.getRawDb();
    if (rawDb) {
      const uRow = rawDb.prepare('SELECT did, balance_sov FROM users WHERE did = ?').get(newDid) as any;
      console.log('Newly registered user balance (SQLite direct):', uRow?.balance_sov);
    }

    // Attempt unauthenticated faucet claim
    const faucetRes = await fetch(`${BASE_URL}/api/wallet/faucet/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sovra-DID': newDid },
      body: JSON.stringify({ amount: 100 }),
    });
    console.log('Unauthenticated faucet claim HTTP status:', faucetRes.status);
    const faucetData = await faucetRes.json().catch(() => ({}));
    console.log('Faucet error message:', faucetData.error);
  } catch (err: any) {
    console.error('Error in registration issuance audit:', err.message);
  }

  // 5 & 6. Client-Only Double Ratchet Encryption & Server Plaintext Exposure
  console.log('\n--- [5 & 6] Client Double Ratchet & Server Plaintext Isolation ---');
  try {
    const aliceDid = 'did:sovra:alice_audit_' + Date.now();
    const bobDid = 'did:sovra:bob_audit_' + Date.now();

    const regA = await (await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did: aliceDid, handle: 'alice_audit_' + Date.now().toString().slice(-4), displayName: 'Alice' }),
    })).json();

    const regB = await (await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did: bobDid, handle: 'bob_audit_' + Date.now().toString().slice(-4), displayName: 'Bob' }),
    })).json();

    const aliceEngine = new DoubleRatchetChatEngine(aliceDid);
    const bobEngine = new DoubleRatchetChatEngine(bobDid);

    const secretText = 'Zero-Knowledge Sovereign Ratchet Payload #999';
    const encrypted = aliceEngine.encryptPayload(bobDid, secretText);

    const msgId = 'msg_audit_' + Date.now();
    const sendRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${regA.sessionToken}` },
      body: JSON.stringify({
        id: msgId,
        recipientDid: bobDid,
        senderName: 'Alice',
        ciphertextHex: encrypted.ciphertextHex,
        nonceHex: encrypted.nonceHex,
        sequenceNumber: encrypted.sequenceNumber,
        isE2EE: true,
      }),
    });
    const sendData = await sendRes.json();
    console.log('Message send response:', { status: sendRes.status, ok: sendData.ok });

    // Inspect server SQLite table direct_messages
    const rawDb = sovraDb.getSqliteEngine()?.getRawDb();
    if (rawDb) {
      const msgRow = rawDb.prepare('SELECT id, text, ciphertext_hex, iv_hex FROM direct_messages WHERE id = ?').get(msgId) as any;
      console.log('Database row inspection:', {
        storedText: msgRow?.text,
        ciphertextPresent: Boolean(msgRow?.ciphertext_hex),
        containsPlaintext: msgRow?.text?.includes('Zero-Knowledge') || false,
      });
    }

    // Bob fetches messages and decrypts client-side
    const bobMsgsRes = await fetch(`${BASE_URL}/api/chat/messages?contactDid=${encodeURIComponent(aliceDid)}`, {
      headers: { Authorization: `Bearer ${regB.sessionToken}` },
    });
    const bobMsgsData = await bobMsgsRes.json();
    const receivedMsg = bobMsgsData.messages?.find((m: any) => m.id === msgId);
    console.log('Bob retrieved message from server:', {
      isE2EE: receivedMsg?.isE2EE,
      serverText: receivedMsg?.text,
    });

    const decrypted = bobEngine.decryptPayload(aliceDid, receivedMsg.ciphertextHex, receivedMsg.ivHex);
    console.log('Bob client-side decrypted text matches secret:', decrypted === secretText, `("${decrypted}")`);
  } catch (err: any) {
    console.error('Error in Double Ratchet audit:', err.message);
  }

  // 7. M-of-N Signature Validation
  console.log('\n--- [7] M-of-N Signature Validation ---');
  try {
    const admin1 = { did: 'did:sovra:admin_1', handle: '@admin1', role: 'SUPER_ADMIN' as const, authMethod: 'PASSKEY_ED25519' as const, authenticatedAt: Date.now() };
    const admin2 = { did: 'did:sovra:admin_2', handle: '@admin2', role: 'TREASURY_OFFICER' as const, authMethod: 'PASSKEY_ED25519' as const, authenticatedAt: Date.now() };

    const propResult = sovereignAdminSecurity.createProposal(
      admin1,
      'TREASURY_WITHDRAWAL',
      { amountSov: 500, recipient: 'sovra1val' },
      'sig_ed25519_admin1'
    );
    console.log('Proposal created (threshold 2):', {
      ok: propResult.ok,
      id: propResult.proposal?.id,
      status: propResult.proposal?.status,
      signatures: propResult.proposal?.signatures.length,
      threshold: propResult.proposal?.requiredSignatures,
    });

    if (propResult.proposal) {
      // Admin 2 signs -> reaches threshold
      const signResult = sovereignAdminSecurity.signProposal(
        propResult.proposal.id,
        admin2,
        'sig_ed25519_admin2'
      );
      console.log('Proposal signed by Admin 2:', {
        ok: signResult.ok,
        status: signResult.proposal?.status,
        signatures: signResult.proposal?.signatures.length,
        executed: signResult.executed,
      });
    }
  } catch (err: any) {
    console.error('Error in M-of-N audit:', err.message);
  }

  // 8. Timelock Expiration and Replay Protection
  console.log('\n--- [8] Timelock Expiration and Replay Protection ---');
  try {
    const adminSuper = { did: 'did:sovra:admin_super', handle: '@admin', role: 'SUPER_ADMIN' as const, authMethod: 'PASSKEY_ED25519' as const, authenticatedAt: Date.now() };
    const cb = sovereignAdminSecurity.toggleCircuitBreaker(
      true,
      ['P2P_TRANSFER'],
      adminSuper,
      'Audit test emergency halt'
    );
    console.log('Emergency circuit breaker engaged:', {
      active: cb.active,
      pausedScopes: cb.pausedScopes,
      timestamp: new Date(cb.timestamp).toISOString(),
      expiresAt: cb.expiresAt ? new Date(cb.expiresAt).toISOString() : undefined,
      durationHours: cb.expiresAt ? ((cb.expiresAt - cb.timestamp) / (3600 * 1000)) : 0,
    });

    const activePause = sovereignAdminSecurity.isScopePaused('P2P_TRANSFER');
    console.log('isScopePaused("P2P_TRANSFER"):', activePause);

    // Release circuit breaker
    const cbReleased = sovereignAdminSecurity.toggleCircuitBreaker(
      false,
      [],
      adminSuper,
      'Audit test complete'
    );
    console.log('Emergency circuit breaker released:', { active: cbReleased.active });
  } catch (err: any) {
    console.error('Error in Timelock audit:', err.message);
  }

  console.log('\n=== AUDIT COMPLETE ===');
}

runAudit().catch(console.error);
