/**
 * @file tests/security/p0-phase5-verification.test.ts
 * SOVRA PHASE 5: P0 FINANCIAL INTEGRITY, L1 AUTHORITATIVE LEDGER,
 * CLIENT-SIDE E2EE DOUBLE RATCHET, AND M-OF-N GOVERNANCE VERIFICATION GATE
 *
 * Grounded in SOVRA_INDUSTRY_STANDARD_MASTER_GOAL_AND_ACCEPTANCE.md
 * Verifies GAP-P0-01, GAP-P0-02, GAP-P0-03, and GAP-P0-04 with zero mocks.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { DoubleRatchetChatEngine } from '../../packages/messaging/dist/chat-engine.js';
import { sovereignAdminSecurity } from '../../scripts/admin-security.ts';
import { sovraDb } from '../../scripts/database-engine.ts';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';
const L1_RPC = process.env.SOVRA_L1_RPC || 'http://127.0.0.1:26657';

describe('SOVRA Phase 5: P0 Financial Integrity & E2EE Verification Gate', () => {

  // =========================================================================
  // WORKSTREAM 1: GAP-P0-02 — 100M SOV SUPPLY CAP & REGISTRATION GRANT AUDIT
  // =========================================================================
  describe('GAP-P0-02: 100M Hard Supply Cap & Registration Grant Enforcement', () => {
    it('verifies that new user registration creates a default wallet balance of 0.0 SOV', async () => {
      const regDid = 'did:sovra:p5_reg_user_' + Date.now();
      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          did: regDid,
          handle: 'p5_user_' + Date.now().toString().slice(-4),
          displayName: 'P5 User',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      // Verify that no unbacked 500.0 SOV was minted
      const sqlite = sovraDb.getSqliteEngine()?.getRawDb();
      if (sqlite) {
        const row = sqlite.prepare('SELECT balance_sov FROM users WHERE did = ?').get(regDid) as any;
        expect(row).toBeDefined();
        // In strict financial invariant mode, balance is strictly 0.0 unless funded from Genesis
        expect(Number(row.balance_sov || 0)).toBe(0.0);
      }
    });

    it('rejects unauthenticated faucet claim attempts with HTTP 401 Unauthorized', async () => {
      const res = await fetch(`${BASE_URL}/api/wallet/faucet/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 50,
          did: 'did:sovra:victim_' + Date.now(),
        }),
      });

      // Must fail closed with 401: no spoofing via request body or x-sovra-did header
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toMatch(/Unauthorized/i);
    });

    it('enforces total supply invariant <= 100,000,000 SOV across all user balances', () => {
      const sqliteEngine = sovraDb.getSqliteEngine();
      if (sqliteEngine) {
        const supplyReport = sqliteEngine.getTotalSovSupply();
        expect(supplyReport.isWithinCap).toBe(true);
        expect(supplyReport.totalSystemAccountingSov).toBeLessThanOrEqual(100_000_000);
        expect(supplyReport.maxLifetimeCapSov).toBe(100_000_000);
      }
    });
  });

  // =========================================================================
  // WORKSTREAM 2: GAP-P0-01 — AUTHORITATIVE LAYER-1 INTEGRATION & DUAL-LEDGER SYNC
  // =========================================================================
  describe('GAP-P0-01: Authoritative Layer-1 Integration & Dual-Ledger Sync', () => {
    it('verifies that CometBFT Layer-1 consensus RPC is online and tracking total supply', async () => {
      const statusRes = await fetch(`${L1_RPC}/status`);
      expect(statusRes.status).toBe(200);
      const statusData = await statusRes.json();

      expect(statusData.chain_id).toBe('sovra-testnet-0');
      expect(statusData.height).toBeGreaterThan(0);
      expect(statusData.supply_correct).toBe(true);
      expect(BigInt(statusData.total_supply)).toBeLessThanOrEqual(100_000_000_000_000n);
    });

    it('queries authoritative L1 balance via /query/balance in micro-denominations (usov)', async () => {
      const valAddress = 'sovra12a806ca82d506a025d580d40600abc77a69e10e7';
      const balRes = await fetch(`${L1_RPC}/query/balance?address=${encodeURIComponent(valAddress)}`);
      expect(balRes.status).toBe(200);
      const balData = await balRes.json();

      expect(balData.address).toBe(valAddress);
      expect(balData.denom).toBe('usov');
      expect(BigInt(balData.balance)).toBeGreaterThan(0n);
    });

    it('rejects unauthenticated transfer requests without principal with HTTP 401', async () => {
      const res = await fetch(`${BASE_URL}/api/wallet/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sovra-DID': 'did:sovra:spoofed_sender',
        },
        body: JSON.stringify({
          recipientDid: 'did:sovra:recipient_' + Date.now(),
          amount: 10,
        }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toMatch(/Unauthorized/i);
    });
  });

  // =========================================================================
  // WORKSTREAM 3: GAP-P0-03 — GENUINE CLIENT-SIDE DOUBLE RATCHET E2EE RELAY
  // =========================================================================
  describe('GAP-P0-03: Genuine Client-Side Double Ratchet E2EE (Zero Server Plaintext)', () => {
    let aliceDid: string;
    let bobDid: string;
    let aliceToken: string;
    let bobToken: string;
    let aliceChat: DoubleRatchetChatEngine;
    let bobChat: DoubleRatchetChatEngine;

    beforeAll(async () => {
      aliceDid = 'did:sovra:alice_e2ee_' + Date.now();
      bobDid = 'did:sovra:bob_e2ee_' + Date.now();

      const regAlice = await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: aliceDid, handle: 'alice_e2ee_' + Date.now().toString().slice(-4), displayName: 'Alice' }),
      });
      const dataAlice = await regAlice.json();
      aliceToken = dataAlice.sessionToken;

      const regBob = await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: bobDid, handle: 'bob_e2ee_' + Date.now().toString().slice(-4), displayName: 'Bob' }),
      });
      const dataBob = await regBob.json();
      bobToken = dataBob.sessionToken;

      aliceChat = new DoubleRatchetChatEngine(aliceDid);
      bobChat = new DoubleRatchetChatEngine(bobDid);
    });

    it('encrypts message client-side using Double Ratchet ChaCha20-Poly1305 and dispatches opaque ciphertext', async () => {
      const secretPlaintext = 'Top secret sovereign conversation payload #42';
      const encrypted = aliceChat.encryptPayload(bobDid, secretPlaintext);

      expect(encrypted.ciphertextHex).toBeDefined();
      expect(encrypted.nonceHex).toBeDefined();
      expect(encrypted.sequenceNumber).toBe(1);

      // Alice sends only the opaque ciphertext to the server
      const msgId = 'msg_e2ee_' + Date.now();
      const sendRes = await fetch(`${BASE_URL}/api/chat/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
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

      expect(sendRes.status).toBe(200);
      const sendData = await sendRes.json();
      expect(sendData.ok).toBe(true);

      // Verify server database state: server must NOT store plaintext!
      const rawDb = sovraDb.getSqliteEngine()?.getRawDb();
      if (rawDb) {
        const row = rawDb.prepare('SELECT text, ciphertext_hex, iv_hex FROM direct_messages WHERE id = ?').get(msgId) as any;
        expect(row).toBeDefined();
        // Server text must be the encrypted placeholder, NOT secretPlaintext
        expect(row.text).toMatch(/^🔒 \[End-to-End Encrypted: (?:Client-Side|Double Ratchet)\]/);
        expect(row.text).not.toContain(secretPlaintext);
        expect(row.ciphertext_hex).toBe(encrypted.ciphertextHex);
      }
    });

    it('allows Bob to fetch opaque ciphertext from server and decrypt purely on client side', async () => {
      const res = await fetch(`${BASE_URL}/api/chat/messages?contactDid=${encodeURIComponent(aliceDid)}`, {
        headers: { Authorization: `Bearer ${bobToken}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.messages)).toBe(true);
      expect(data.messages.length).toBeGreaterThan(0);

      const latestMsg = data.messages[data.messages.length - 1];
      expect(latestMsg.isE2EE).toBe(true);
      expect(latestMsg.text).toMatch(/^🔒 \[End-to-End Encrypted: (?:Client-Side|Double Ratchet)\]/);
      expect(latestMsg.ciphertextHex).toBeDefined();

      // Bob decrypts locally on his device using DoubleRatchetChatEngine
      const decrypted = bobChat.decryptPayload(aliceDid, latestMsg.ciphertextHex, latestMsg.ivHex);
      expect(decrypted).toBe('Top secret sovereign conversation payload #42');
    });
  });

  // =========================================================================
  // WORKSTREAM 4: GAP-P0-04 — M-OF-N GOVERNANCE & 72-HOUR TIMELOCK
  // =========================================================================
  describe('GAP-P0-04: M-of-N Multi-Sig Governance & 72-Hour Timelock', () => {
    it('creates a multi-sig proposal with PENDING status requiring threshold signatures', () => {
      const proposer = {
        did: 'did:sovra:super_admin_proposer',
        role: 'SUPER_ADMIN' as const,
      };

      const result = sovereignAdminSecurity.createProposal(
        proposer,
        'CIRCUIT_BREAKER_GLOBAL',
        { scope: 'ALL', reason: 'Zero-day security pause' },
        'sig_passkey_proposer_test'
      );

      expect(result.ok).toBe(true);
      expect(result.proposal).toBeDefined();
      expect(result.proposal?.status).toBe('PENDING');
      expect(result.proposal?.requiredSignatures).toBe(3);
      expect(result.proposal?.signatures.length).toBe(1);
    });

    it('requires M-of-N threshold signatures before proposal transitions to EXECUTED', () => {
      const proposer = {
        did: 'did:sovra:admin_signer_1',
        role: 'SUPER_ADMIN' as const,
      };
      const result = sovereignAdminSecurity.createProposal(
        proposer,
        'CIRCUIT_BREAKER_GLOBAL',
        { scope: 'ALL', reason: 'Emergency threshold test' },
        'sig_1'
      );
      const proposalId = result.proposal!.id;

      // Second signer (Treasury Officer) co-signs (2/3 signatures - still pending)
      const signer2 = {
        did: 'did:sovra:treasury_signer_2',
        role: 'TREASURY_OFFICER' as const,
      };
      const signRes2 = sovereignAdminSecurity.signProposal(proposalId, signer2, 'sig_2');

      expect(signRes2.ok).toBe(true);
      expect(signRes2.executed).toBe(false);
      expect(signRes2.proposal?.status).toBe('PENDING');
      expect(signRes2.proposal?.signatures.length).toBe(2);

      // Third signer (Security Council Member) co-signs (3/3 signatures - quorum reached!)
      const signer3 = {
        did: 'did:sovra:council_signer_3',
        role: 'SUPER_ADMIN' as const,
      };
      const signRes3 = sovereignAdminSecurity.signProposal(proposalId, signer3, 'sig_3');

      expect(signRes3.ok).toBe(true);
      expect(signRes3.executed).toBe(true);
      expect(signRes3.proposal?.status).toBe('EXECUTED');
      expect(signRes3.proposal?.signatures.length).toBe(3);
    });

    it('enforces constitutional 72-hour timelock on emergency circuit breakers', () => {
      const admin = {
        did: 'did:sovra:emergency_operator',
        role: 'SUPER_ADMIN' as const,
      };

      const cb = sovereignAdminSecurity.toggleCircuitBreaker(true, ['ALL'], admin, 'Test emergency pause');
      expect(cb.active).toBe(true);
      expect(cb.expiresAt).toBeDefined();
      // Must expire within approximately 72 hours (72 * 3600 * 1000 ms)
      const diffHours = (cb.expiresAt! - cb.timestamp) / 3600000;
      expect(Math.round(diffHours)).toBe(72);
      expect(sovereignAdminSecurity.isScopePaused('TIPPING')).toBe(true);

      // Clean up circuit breaker
      sovereignAdminSecurity.toggleCircuitBreaker(false, [], admin, 'Resumed');
      expect(sovereignAdminSecurity.isScopePaused('TIPPING')).toBe(false);
    });
  });
});
