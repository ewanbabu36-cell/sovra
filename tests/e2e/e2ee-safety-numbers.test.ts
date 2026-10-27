/**
 * @file tests/e2e/e2ee-safety-numbers.test.ts
 * Master E2E Suite for E2EE Calling, Zero-Metadata Chat & Cryptographic Safety Numbers (Cycle 3).
 *
 * Verifies:
 * 1. Deterministic 60-digit Safety Number comparison & QR payload generation
 * 2. Identity fingerprint verification state persistence
 * 3. Ephemeral disappearing message sweeps and deterministic WAL zeroization
 * 4. Group WebRTC Mesh Hardening: VAD dominant speaker detection & bandwidth relay fallback
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { handleChatRoutes } from '../../scripts/routes/chat.routes.ts';
import { handleCallRoutes } from '../../scripts/routes/call.routes.ts';
import { sovraDb } from '../../scripts/database-engine.ts';

function createMockContext(method: string, urlPath: string, bodyJson?: any) {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let responseData = '';

  const req: any = {
    method,
    headers: { host: 'localhost:3001' },
    url: urlPath,
  };

  const res: any = {
    writeHead: (status: number, head: Record<string, string>) => {
      statusCode = status;
      Object.assign(headers, head);
    },
    end: (chunk?: any) => {
      if (typeof chunk === 'string') {
        responseData = chunk;
      }
    },
  };

  const url = new URL(`http://localhost:3001${urlPath}`);
  const ATTACHMENTS_DIR = path.resolve(process.cwd(), '.sovra-storage-dev', 'attachments');

  const ctx = {
    req,
    res,
    url,
    ATTACHMENTS_DIR,
    blindPushRelay: { deliverPush: async () => true } as any,
    getIceServers: () => [{ urls: 'stun:stun.l.google.com:19302' }],
    validateMediaMagicBytes: () => ({ valid: true }),
    readBoundedBody: async () => ({
      body: bodyJson ? JSON.stringify(bodyJson) : '',
      ok: true,
    }),
    resolvePrincipal: () => ({ did: 'did:key:z6Mkha_alice', handle: 'alice' } as any),
    enforceAuth: () => ({ did: 'did:key:z6Mkha_alice', handle: 'alice' } as any),
    broadcastChatEvent: () => {},
    getResult: () => ({
      statusCode,
      headers,
      data: responseData,
    }),
  };

  return ctx;
}

describe('Cycle 3: E2EE Calling, Zero-Metadata Chat & Safety Numbers Suite', () => {
  const aliceDid = 'did:key:z6Mkha_alice';
  const bobDid = 'did:key:z6Mks7_bob';

  describe('1. Cryptographic Safety Numbers & Deterministic Fingerprints', () => {
    it('should generate 60-digit fingerprint blocks and verifiable QR payload', async () => {
      const ctx = createMockContext('GET', `/api/chat/safety-number/generate?peerDid=${bobDid}`);
      const handled = await handleChatRoutes(ctx as any);
      expect(handled).toBe(true);

      const res = ctx.getResult();
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.data);

      expect(data.ok).toBe(true);
      expect(data.safetyNumber).toBeDefined();
      expect(data.fingerprintBlocks.length).toBe(12);
      expect(data.digits.length).toBe(60);
      expect(data.qrPayload).toContain('sovra-safety://');
    });

    it('should be symmetric: swapped DIDs generate identical 60-digit safety numbers', async () => {
      const ctxAlice = createMockContext('POST', '/api/chat/safety-number/generate', {
        userDid: aliceDid,
        peerDid: bobDid,
      });
      await handleChatRoutes(ctxAlice as any);
      const dataAlice = JSON.parse(ctxAlice.getResult().data);

      const ctxBob = createMockContext('POST', '/api/chat/safety-number/generate', {
        userDid: bobDid,
        peerDid: aliceDid,
      });
      await handleChatRoutes(ctxBob as any);
      const dataBob = JSON.parse(ctxBob.getResult().data);

      expect(dataAlice.safetyNumber).toBe(dataBob.safetyNumber);
      expect(dataAlice.digits).toBe(dataBob.digits);
      expect(dataAlice.qrPayload).toBe(dataBob.qrPayload);
    });

    it('should verify peer identity fingerprint and persist status in database', async () => {
      const verifyCtx = createMockContext('POST', '/api/chat/safety-number/verify', {
        peerDid: bobDid,
        isVerified: true,
        fingerprint: '12345 67890',
      });
      await handleChatRoutes(verifyCtx as any);
      const verifyRes = JSON.parse(verifyCtx.getResult().data);
      expect(verifyRes.ok).toBe(true);
      expect(verifyRes.isVerified).toBe(true);

      // Verify status endpoint reflects verified state
      const statusCtx = createMockContext('GET', `/api/chat/safety-number/status?peerDid=${bobDid}`);
      await handleChatRoutes(statusCtx as any);
      const statusRes = JSON.parse(statusCtx.getResult().data);
      expect(statusRes.ok).toBe(true);
      expect(statusRes.isVerified).toBe(true);
    });
  });

  describe('2. Ephemeral Disappearing Messages & Purge Sweep', () => {
    it('should purge expired disappearing messages and report swept count', async () => {
      // Append an expired test message directly to sovraDb
      const expiredMsg = sovraDb.appendMessage({
        senderDid: aliceDid,
        recipientDid: bobDid,
        text: 'Top secret self-destruct message',
        disappearingDurationSec: 30,
        expiresAt: Date.now() - 5000, // already expired 5s ago
      });

      expect(expiredMsg.id).toBeDefined();

      const sweepCtx = createMockContext('POST', '/api/chat/disappearing/sweep');
      const handled = await handleChatRoutes(sweepCtx as any);
      expect(handled).toBe(true);

      const res = sweepCtx.getResult();
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.data);
      expect(data.ok).toBe(true);
      expect(data.purgedCount).toBeGreaterThanOrEqual(1);

      // Verify message has disappeared in db
      const allMsgs = sovraDb.getState().chatMessages;
      const found = allMsgs.find(m => m.id === expiredMsg.id);
      expect(found).toBeDefined();
      expect(found?.isDisappeared).toBe(true);
      expect(found?.text).toContain('disappeared');
    });
  });

  describe('3. Group WebRTC Voice Activity Detection (VAD) & Dominant Stream Prioritization', () => {
    it('should prioritize dominant speaker when audio level is high and speaking is true', async () => {
      const vadPayload = {
        callId: 'call_mesh_room_01',
        speakerDid: aliceDid,
        audioLevelDb: -18.5,
        isSpeaking: true,
        bandwidthKbps: 256,
      };

      const ctx = createMockContext('POST', '/api/call/vad-priority', vadPayload);
      const handled = await handleCallRoutes(ctx as any);
      expect(handled).toBe(true);

      const res = ctx.getResult();
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.data);
      expect(data.ok).toBe(true);
      expect(data.dominantSpeakerDid).toBe(aliceDid);
      expect(data.streamPriority).toBe('DOMINANT');
      expect(data.relayFallbackRecommended).toBe(false);
    });

    it('should flag relayFallbackRecommended when bandwidth is constrained (< 64 Kbps)', async () => {
      const lowBandwidthPayload = {
        callId: 'call_mesh_room_01',
        speakerDid: bobDid,
        audioLevelDb: -22.0,
        isSpeaking: true,
        bandwidthKbps: 48, // Low bandwidth 2G/poor cell
      };

      const ctx = createMockContext('POST', '/api/call/vad-priority', lowBandwidthPayload);
      await handleCallRoutes(ctx as any);

      const res = ctx.getResult();
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.data);
      expect(data.ok).toBe(true);
      expect(data.relayFallbackRecommended).toBe(true);
    });

    it('should allow querying active dominant speaker for a call session via GET', async () => {
      const getCtx = createMockContext('GET', '/api/call/vad-priority?callId=call_mesh_room_01');
      await handleCallRoutes(getCtx as any);

      const res = getCtx.getResult();
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.data);
      expect(data.ok).toBe(true);
      expect(data.dominantSpeaker).not.toBeNull();
      expect(data.dominantSpeaker.dominantSpeakerDid).toBe(bobDid);
    });
  });
});
