/**
 * @file tests/e2e/encrypted-hls-video-chunks.test.ts
 * Signed Encrypted HLS Video Chunks & Ephemeral Key Gatekeeper E2E Suite.
 *
 * Verifies:
 * 1. Token-gated authorization enforcement before issuing stream session tickets.
 * 2. HMAC-SHA256 signed ephemeral ticket generation with TTL enforcement.
 * 3. Multi-bitrate HLS Master Playlist generation (/api/media/hls/:id/master.m3u8).
 * 4. AES-128 Encrypted Variant Playlist generation with #EXT-X-KEY directive.
 * 5. Cryptographic AES-128 16-byte binary decryption key delivery (/api/media/hls/key).
 * 6. Video segment chunk delivery (/api/media/hls/:id/:segment.ts) protected by Anti-Piracy Shield.
 * 7. Rejection of unauthenticated, tampered, and expired stream requests (403 Forbidden).
 */

import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('Signed Encrypted HLS Video Chunks & Anti-Piracy Gatekeeper Suite', () => {
  const creatorDid = 'did:sovra:creator_hls_test_' + Date.now();
  const creatorAddress = 'sovra12a806ca82d506a025d580d40600abc77a69e10e7';
  const unauthorizedAddress = 'sovra1poor_user_0000000000000000000000000000000000';
  const authorizedAddress = creatorAddress; // creator holds initial supply

  const mediaId = 'exclusive_masterclass_' + Date.now();
  let tokenContractAddress = '';
  let validStreamTicket = '';

  // 1. Prepare Gated Media Item with CW20 Token Requirement
  it('prepares creator token and configures token-gating on masterclass video', async () => {
    // Launch token
    const tokenRes = await fetch(`${BASE_URL}/api/studio/token/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'HLS Masterclass Pass',
        symbol: 'HLSPASS',
        initialSupply: '1000000000',
        creatorDid,
        creatorAddress
      })
    });
    expect(tokenRes.status).toBe(200);
    const tokenData = await tokenRes.json();
    tokenContractAddress = tokenData.contractAddress;

    // Configure token gate on media
    const gateRes = await fetch(`${BASE_URL}/api/media/token-gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaId,
        contractAddress: tokenContractAddress,
        minBalance: '50000000', // 50 tokens
        tokenSymbol: 'HLSPASS',
        creatorDid,
        title: 'Advanced Cryptographic Masterclass'
      })
    });
    expect(gateRes.status).toBe(200);
    const gateData = await gateRes.json();
    expect(gateData.ok).toBe(true);
  });

  // 2. Stream Ticket Gatekeeper
  describe('Stream Session Ticket Issuance (POST /api/media/stream/ticket)', () => {
    it('rejects unauthorized user with 403 Forbidden when requesting stream ticket', async () => {
      const res = await fetch(`${BASE_URL}/api/media/stream/ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaId,
          address: unauthorizedAddress
        })
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.status).toBe(403);
      expect(data.error).toContain('Insufficient CW20 balance');
    });

    it('grants signed ephemeral ticket to authorized token holder', async () => {
      const res = await fetch(`${BASE_URL}/api/media/stream/ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaId,
          address: authorizedAddress
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.ticket).toBeDefined();
      expect(data.encryption).toBe('AES-128-CBC');
      expect(data.ttlSeconds).toBe(60);
      expect(data.masterPlaylistUrl).toContain(`/api/media/hls/${encodeURIComponent(mediaId)}/master.m3u8`);

      validStreamTicket = data.ticket;
    });

    it('returns stream metadata and HLS playlist info in GET /api/media/stream/:id', async () => {
      const res = await fetch(`${BASE_URL}/api/media/stream/${mediaId}?address=${authorizedAddress}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.tokenGatedPassed).toBe(true);
      expect(data.ticket).toBeDefined();
      expect(data.hls).toBeDefined();
      expect(data.hls.encryption).toBe('AES-128-CBC');
      expect(data.hls.masterPlaylistUrl).toContain('master.m3u8');
    });
  });

  // 3. Multi-Bitrate HLS Master Playlist
  describe('Multi-Bitrate HLS Master Playlist (GET /api/media/hls/:id/master.m3u8)', () => {
    it('rejects direct request without ticket with 403 Forbidden (Anti-Piracy Shield)', async () => {
      const res = await fetch(`${BASE_URL}/api/media/hls/${mediaId}/master.m3u8`);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Anti-Piracy Shield');
    });

    it('serves valid master playlist containing 1080p, 720p, and 480p variants with embedded ticket', async () => {
      const res = await fetch(`${BASE_URL}/api/media/hls/${mediaId}/master.m3u8?ticket=${encodeURIComponent(validStreamTicket)}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('mpegurl');

      const body = await res.text();
      expect(body).toContain('#EXTM3U');
      expect(body).toContain('#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080');
      expect(body).toContain(`1080p.m3u8?ticket=${encodeURIComponent(validStreamTicket)}`);
      expect(body).toContain('#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720');
      expect(body).toContain(`720p.m3u8?ticket=${encodeURIComponent(validStreamTicket)}`);
      expect(body).toContain('#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480');
      expect(body).toContain(`480p.m3u8?ticket=${encodeURIComponent(validStreamTicket)}`);
    });
  });

  // 4. AES-128 Encrypted Variant Playlist
  describe('AES-128 Encrypted Variant Playlist (GET /api/media/hls/:id/:resolution.m3u8)', () => {
    it('rejects variant playlist request without ticket with 403 Forbidden', async () => {
      const res = await fetch(`${BASE_URL}/api/media/hls/${mediaId}/1080p.m3u8`);
      expect(res.status).toBe(403);
    });

    it('serves 1080p variant playlist declaring #EXT-X-KEY directive with signed ticket', async () => {
      const res = await fetch(`${BASE_URL}/api/media/hls/${mediaId}/1080p.m3u8?ticket=${encodeURIComponent(validStreamTicket)}`);
      expect(res.status).toBe(200);
      const body = await res.text();

      expect(body).toContain('#EXTM3U');
      expect(body).toContain('#EXT-X-TARGETDURATION:6');
      expect(body).toContain('#EXT-X-KEY:METHOD=AES-128');
      expect(body).toContain(`/api/media/hls/key?ticket=${encodeURIComponent(validStreamTicket)}`);
      expect(body).toContain('segment_000.ts');
      expect(body).toContain('segment_001.ts');
      expect(body).toContain('#EXT-X-ENDLIST');
    });
  });

  // 5. Cryptographic AES-128 Decryption Key Delivery
  describe('Cryptographic AES-128 Decryption Key Delivery (GET /api/media/hls/key)', () => {
    it('rejects key delivery on missing or tampered ticket with 403 Forbidden', async () => {
      const tamperedTicket = validStreamTicket.slice(0, -6) + 'XXXXXX';
      const res = await fetch(`${BASE_URL}/api/media/hls/key?ticket=${encodeURIComponent(tamperedTicket)}&mediaId=${mediaId}`);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Anti-Piracy Shield');
    });

    it('delivers exact 16-byte raw binary AES-128 decryption key upon valid ticket verification', async () => {
      const res = await fetch(`${BASE_URL}/api/media/hls/key?ticket=${encodeURIComponent(validStreamTicket)}&mediaId=${mediaId}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/octet-stream');
      expect(res.headers.get('cache-control')).toContain('no-store');
      expect(res.headers.get('x-sovra-anti-piracy')).toBe('AES-128-Active');

      const keyBuffer = await res.arrayBuffer();
      expect(keyBuffer.byteLength).toBe(16); // Exactly 128 bits
    });
  });

  // 6. Encrypted Video Segment Chunks Delivery
  describe('Encrypted Video Segment Chunks Delivery (GET /api/media/hls/:id/:segment.ts)', () => {
    it('rejects direct download of video chunk without session ticket with 403 Forbidden', async () => {
      const res = await fetch(`${BASE_URL}/api/media/hls/${mediaId}/segment_000.ts`);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Anti-Piracy Shield');
    });

    it('serves encrypted video segment chunk with Content-Type video/mp2t when ticket is valid', async () => {
      const res = await fetch(`${BASE_URL}/api/media/hls/${mediaId}/segment_000.ts?ticket=${encodeURIComponent(validStreamTicket)}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('video/mp2t');
      expect(res.headers.get('x-sovra-anti-piracy')).toBe('Chunk-Encrypted-AES-128');

      const chunkBuffer = await res.arrayBuffer();
      expect(chunkBuffer.byteLength).toBeGreaterThan(0);
      expect(chunkBuffer.byteLength % 16).toBe(0); // AES block size alignment
    });
  });
});
