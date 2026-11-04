import { describe, it, expect } from 'vitest';
import { sovraDb } from '../../scripts/database-engine.ts';
import fs from 'node:fs';
import path from 'node:path';

describe('SEC-03-B: SQLite WAL Plaintext Retention & Forensic Truncation', () => {
  it('physically purges expired disappearing messages and truncates WAL log without residual plaintext', () => {
    const canaryText = `CANARY_FORENSIC_CHECK_${Date.now()}_998877`;
    const storageDir = path.resolve('.sovra-storage-dev');
    const walPath = path.join(storageDir, 'sovra-social.sqlite-wal');

    sovraDb.load();

    const now = Date.now();
    const testMsgId = `msg_forensic_${now}`;

    // 1. Insert expired message
    const dbAny = (sovraDb as any).db;
    if (!dbAny.chatMessages) dbAny.chatMessages = [];
    dbAny.chatMessages.push({
      id: testMsgId,
      senderDid: 'did:sovra:alice',
      recipientDid: 'did:sovra:bob',
      text: canaryText,
      timestamp: now - 60000,
      disappearingDurationSec: 10,
      expiresAt: now - 50000,
    });
    sovraDb.save();

    const sqlite = (sovraDb as any).sqliteEngine;
    if (sqlite) {
      try {
        sqlite.saveChatMessage({
          id: testMsgId,
          senderDid: 'did:sovra:alice',
          recipientDid: 'did:sovra:bob',
          text: canaryText,
          timestamp: now - 60000,
          disappearingDurationSec: 10,
        });
      } catch (_) {}
    }

    // 2. Trigger physical purge
    const result = sovraDb.purgeExpiredDisappearingMessages();
    expect(result.purgedCount).toBeGreaterThanOrEqual(1);

    // 3. Verify message is absent from in-memory state
    const inMemory = ((sovraDb as any).db.chatMessages || []).some((m: any) => m.id === testMsgId);
    expect(inMemory).toBe(false);

    // 4. Verify message is absent from SQLite relational table
    if (sqlite) {
      const row = sqlite
        .prepareCached('SELECT id, text FROM direct_messages WHERE id = ?')
        .get(testMsgId);
      expect(row).toBeUndefined();
    }

    // 5. Verify canary string is completely absent from raw WAL binary on disk
    if (fs.existsSync(walPath)) {
      const walBytes = fs.readFileSync(walPath);
      const canaryBuffer = Buffer.from(canaryText);
      expect(walBytes.includes(canaryBuffer)).toBe(false);
    }
  });
});
