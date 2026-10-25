/**
 * @file tests/e2e/production-hardening-cycle-2.test.ts
 * Comprehensive Verification Suite for Master Production Hardening Cycle 2.
 *
 * Verifies all 8 Architectural Dimensions:
 * 1. Disappearing messages TTL automatic cryptographic purging in SovraLocalDatabase.
 * 2. Multi-asset wallet ledger persistence and retrieval in SovraLocalDatabase.
 * 3. Client-side Double Ratchet ChaCha20-Poly1305 payload encryption and decryption.
 * 4. WhatsApp/Signal-grade 60-digit safety numbers format & commutativity.
 * 5. Multi-asset wallet portfolio endpoint (/api/wallet/assets).
 * 6. 1-Click AMM token swap endpoint (/api/wallet/swap).
 * 7. Fast 1.5s non-blocking concurrent relay health probing in MultiRelayManager.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  SovraLocalDatabase,
  MemoryStorageDriver,
  type CachedMessage,
  type CachedWalletTransaction,
} from '../../apps/sovra-mobile/src/services/local-database.js';
import {
  DoubleRatchetChatEngine,
  computeSafetyNumbers,
} from '../../packages/messaging/src/chat-engine.js';
import { MultiRelayManager } from '../../apps/sovra-mobile/src/services/multi-relay-manager.js';

const DEV_SERVER_HTTP = 'http://localhost:3001';

describe('Production Hardening Cycle 2 Verification Suite', () => {
  let sessionToken: string;
  let testUserDid: string;

  beforeAll(async () => {
    // Register test user on running dev server
    try {
      const regRes = await fetch(`${DEV_SERVER_HTTP}/api/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: `harden2_${Date.now().toString(36)}`,
          displayName: 'Hardening Cycle 2 User',
        }),
      });
      if (regRes.ok) {
        const data = await regRes.json();
        sessionToken = data.sessionToken;
        testUserDid = data.user?.did || data.did || 'did:sovra:testuser';
      }
    } catch {
      // Dev server may run without registration requirement in mock mode
    }
  });

  // ============================================================
  // 1. DISAPPEARING MESSAGES TTL PURGER (LOCAL DATABASE)
  // ============================================================
  describe('Dimension 1 & 8: Disappearing Messages TTL Purger', () => {
    it('automatically purges expired messages while preserving active ones', async () => {
      const driver = new MemoryStorageDriver();
      const db = SovraLocalDatabase.getInstance(driver);

      const now = Date.now();
      const activeMsg: CachedMessage = {
        id: 'msg_active_1',
        threadId: 'peer_bob',
        senderDid: 'peer_alice',
        recipientDid: 'peer_bob',
        senderName: 'Alice',
        text: 'This message is permanent or not yet expired',
        timestamp: now,
        status: 'sent',
        syncStatus: 'LOCAL',
        disappearingDurationSec: 3600, // 1 hour
        expiresAt: now + 3600000,
      };

      const expiredMsg: CachedMessage = {
        id: 'msg_expired_1',
        threadId: 'peer_bob',
        senderDid: 'peer_alice',
        recipientDid: 'peer_bob',
        senderName: 'Alice',
        text: 'This message has expired and should disappear',
        timestamp: now - 10000,
        status: 'delivered',
        syncStatus: 'SYNCED',
        disappearingDurationSec: 5,
        expiresAt: now - 5000, // Expired 5 seconds ago
      };

      await db.saveMessage(activeMsg);
      await db.saveMessage(expiredMsg);

      // Verify both messages initially saved
      const allBefore = db.getThreadMessages('peer_bob');
      // getThreadMessages immediately triggers purgeExpiredDisappearingMessages()!
      expect(allBefore.some(m => m.id === 'msg_active_1')).toBe(true);
      expect(allBefore.some(m => m.id === 'msg_expired_1')).toBe(false);

      // Verify purgeExpiredDisappearingMessages returns count of purged items
      const purgedCount = db.purgeExpiredDisappearingMessages(now);
      expect(purgedCount).toBe(0); // Already purged during getThreadMessages
    });

    it('computes expiresAt automatically when saving message with disappearingDurationSec', async () => {
      const driver = new MemoryStorageDriver();
      const db = SovraLocalDatabase.getInstance(driver);

      const now = Date.now();
      await db.saveMessage({
        id: 'msg_auto_ttl',
        threadId: 'peer_carol',
        senderDid: 'peer_alice',
        recipientDid: 'peer_carol',
        senderName: 'Alice',
        text: '24-hour ephemeral secret',
        timestamp: now,
        status: 'sent',
        syncStatus: 'LOCAL',
        disappearingDurationSec: 86400,
      });

      const msgs = db.getThreadMessages('peer_carol');
      expect(msgs.length).toBe(1);
      const saved = msgs[0]!;
      expect(saved.expiresAt).toBeDefined();
      expect(saved.expiresAt).toBeGreaterThanOrEqual(now + 86400000 - 1000);
    });
  });

  // ============================================================
  // 2. WALLET LEDGER SCHEMA PERSISTENCE (LOCAL DATABASE)
  // ============================================================
  describe('Dimension 1 & 8: Wallet Ledger Schema & Operations', () => {
    it('records and retrieves multi-asset wallet transactions with status', async () => {
      const driver = new MemoryStorageDriver();
      const db = SovraLocalDatabase.getInstance(driver);

      const tx1: CachedWalletTransaction = {
        txHash: '0xtx_tip_001',
        type: 'tip_sent',
        amount: '15.5',
        tokenSymbol: 'SOV',
        timestamp: Date.now() - 5000,
        peerDid: 'did:key:creator_alice',
        status: 'confirmed',
      };

      const tx2: CachedWalletTransaction = {
        txHash: '0xtx_swap_002',
        type: 'swap',
        amount: '100',
        tokenSymbol: 'CREATOR_CW20',
        timestamp: Date.now(),
        status: 'confirmed',
        fee: '1',
      };

      await db.recordWalletTransaction(tx1);
      await db.recordWalletTransaction(tx2);

      const txList = db.getWalletTransactions();
      expect(txList.length).toBe(2);
      // Sorted descending by timestamp
      expect(txList[0]?.txHash).toBe('0xtx_swap_002');
      expect(txList[1]?.txHash).toBe('0xtx_tip_001');

      const found = db.getWalletTransaction('0xtx_tip_001');
      expect(found).toBeDefined();
      expect(found?.amount).toBe('15.5');
      expect(found?.type).toBe('tip_sent');
    });
  });

  // ============================================================
  // 3. CLIENT-SIDE DOUBLE RATCHET WIRE ENCRYPTION (CHACHA20-POLY1305)
  // ============================================================
  describe('Dimension 1 & 5: Double Ratchet Wire Encryption', () => {
    it('encrypts and decrypts payloads symmetrically with advancing ratchet chains', () => {
      const aliceDid = 'did:sovra:alice_device_1';
      const bobDid = 'did:sovra:bob_device_2';

      const aliceEngine = new DoubleRatchetChatEngine(aliceDid);
      const bobEngine = new DoubleRatchetChatEngine(bobDid);

      const plaintext1 = 'Secret message: meet at 0200 UTC at the mesh gateway.';

      // Alice encrypts for Bob
      const enc1 = aliceEngine.encryptPayload(bobDid, plaintext1);
      expect(enc1.ciphertextHex).toBeDefined();
      expect(enc1.nonceHex).toBeDefined();
      expect(enc1.nonceHex.length).toBe(24); // 12 bytes = 24 hex chars
      expect(enc1.ciphertextHex).not.toBe(plaintext1);
      expect(enc1.sequenceNumber).toBe(1);

      // Bob decrypts from Alice
      const dec1 = bobEngine.decryptPayload(aliceDid, enc1.ciphertextHex, enc1.nonceHex);
      expect(dec1).toBe(plaintext1);

      // Alice sends a second message (advances symmetric ratchet)
      const plaintext2 = 'Second message: root key ratchet advanced.';
      const enc2 = aliceEngine.encryptPayload(bobDid, plaintext2);
      expect(enc2.sequenceNumber).toBe(2);
      expect(enc2.ciphertextHex).not.toBe(enc1.ciphertextHex);

      const dec2 = bobEngine.decryptPayload(aliceDid, enc2.ciphertextHex, enc2.nonceHex);
      expect(dec2).toBe(plaintext2);

      // Bob replies to Alice (Bob sender chain -> Alice receiver chain)
      const bobReply = 'Understood Alice, channel confirmed.';
      const bobEnc = bobEngine.encryptPayload(aliceDid, bobReply);
      expect(bobEnc.sequenceNumber).toBe(1);

      const aliceDec = aliceEngine.decryptPayload(bobDid, bobEnc.ciphertextHex, bobEnc.nonceHex);
      expect(aliceDec).toBe(bobReply);
    });

    it('fails decryption with authentication error if ciphertext is tampered', () => {
      const aliceDid = 'did:sovra:alice_device_1';
      const bobDid = 'did:sovra:bob_device_2';

      const aliceEngine = new DoubleRatchetChatEngine(aliceDid);
      const bobEngine = new DoubleRatchetChatEngine(bobDid);

      const enc = aliceEngine.encryptPayload(bobDid, 'Integrity verification payload');

      // Tamper with last 2 hex chars of ciphertext
      const tamperedHex = enc.ciphertextHex.slice(0, -2) + (enc.ciphertextHex.endsWith('ff') ? '00' : 'ff');

      expect(() => {
        bobEngine.decryptPayload(aliceDid, tamperedHex, enc.nonceHex);
      }).toThrow();
    });
  });

  // ============================================================
  // 4. WHATSAPP / SIGNAL-GRADE 60-DIGIT SAFETY NUMBERS
  // ============================================================
  describe('Dimension 5 & 7: 60-Digit Safety Numbers Verification', () => {
    it('formats safety numbers as exactly 12 blocks of 5 digits (60 total)', () => {
      const aliceDid = 'did:sovra:alice_e2ee';
      const bobDid = 'did:sovra:bob_e2ee';
      const rootKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      const sn = computeSafetyNumbers(aliceDid, bobDid, rootKeyHex);
      expect(sn.formattedNumbers).toBeDefined();

      const blocks = sn.formattedNumbers.split(' ');
      expect(blocks.length).toBe(12);
      for (const block of blocks) {
        expect(block.length).toBe(5);
        expect(/^\d{5}$/.test(block)).toBe(true);
      }

      // 12 blocks * 5 digits = 60 digits total
      const allDigits = blocks.join('');
      expect(allDigits.length).toBe(60);

      // QR Code payload format
      expect(sn.qrPayload).toMatch(/^sovra:safety:/);
      expect(sn.qrPayload).toContain(allDigits);
    });

    it('is commutative: produces identical safety numbers regardless of caller order', () => {
      const aliceDid = 'did:sovra:alice_peer';
      const bobDid = 'did:sovra:bob_peer';
      const rootKeyHex = 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd';

      const sn1 = computeSafetyNumbers(aliceDid, bobDid, rootKeyHex);
      const sn2 = computeSafetyNumbers(bobDid, aliceDid, rootKeyHex);

      expect(sn1.formattedNumbers).toBe(sn2.formattedNumbers);
      expect(sn1.qrPayload).toBe(sn2.qrPayload);
    });
  });

  // ============================================================
  // 5. MULTI-ASSET PORTFOLIO API ENDPOINT (/api/wallet/assets)
  // ============================================================
  describe('Dimension 3 & 8: Multi-Asset Wallet Portfolio API', () => {
    it('fetches multi-asset portfolio with native SOV and token items', async () => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;

      const res = await fetch(`${DEV_SERVER_HTTP}/api/wallet/assets?did=${encodeURIComponent(testUserDid || 'did:test')}`, {
        method: 'GET',
        headers,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.assets)).toBe(true);

      // Must include native SOV asset
      const sovAsset = data.assets.find((a: any) => a.symbol === 'SOV' || a.type === 'native');
      expect(sovAsset).toBeDefined();
      expect(sovAsset.name).toBe('Sovra Native');
      expect(sovAsset.decimals).toBe(6);
    });
  });

  // ============================================================
  // 6. 1-CLICK AMM TOKEN SWAP ENDPOINT (/api/wallet/swap)
  // ============================================================
  describe('Dimension 1 & 8: 1-Click AMM Swap Route', () => {
    it('executes AMM swap between native SOV and creator CW20 token', async () => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;

      const swapPayload = {
        tokenAddress: 'sovra1wasm_test_creator_token_alice',
        direction: 'buy',
        amount: '10000000', // 10 SOV
        minOutput: '1000',
      };

      const res = await fetch(`${DEV_SERVER_HTTP}/api/wallet/swap`, {
        method: 'POST',
        headers,
        body: JSON.stringify(swapPayload),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.direction).toBe('buy');
      expect(data.inputAmount).toBe('10000000');
      expect(data.outputAmount).toBeDefined();
      expect(BigInt(data.outputAmount)).toBeGreaterThan(0n);
      expect(data.royaltyFee).toBeDefined();
      expect(data.poolReserves).toBeDefined();
    });
  });

  // ============================================================
  // 7. FAST MULTI-RELAY PROBING & CONCURRENT FALLBACK RACE
  // ============================================================
  describe('Dimension 1 & 6: Fast Multi-Relay Probing & Failover', () => {
    it('defines FAST_TIMEOUT_MS as 1500ms for mobile network responsiveness', () => {
      expect(MultiRelayManager.FAST_TIMEOUT_MS).toBe(1500);
    });

    it('resolves fast fallback successfully through running dev server', async () => {
      const manager = MultiRelayManager.getInstance();
      // Ensure local server is active in relays list
      const res = await manager.fetchWithFallback('/api/status');
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });
  });
});
