/**
 * @file tests/e2e/media-lifecycle-streaming.test.ts
 * SOVRA REAL-WORLD MEDIA UPLOAD & BYTE-RANGE STREAMING VERIFICATION SUITE
 *
 * Verifies real HTTP media uploads, CID hashing, and HTTP 206 Partial Content
 * byte-range streaming for seamless video scrub and playback.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';

const BASE_URL = 'http://localhost:3001';

describe('Sovra Media Lifecycle & Byte-Range Video Streaming Suite', () => {
  let sessionToken: string;
  let userDid: string;
  const timestamp = Date.now();

  beforeAll(async () => {
    // Register user for media upload tests
    const res = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@media_tester_${timestamp}`,
        name: 'Media Stream Tester',
        bio: 'Streaming test verification user',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    sessionToken = data.sessionToken;
    userDid = data.user.did;
  });

  it('rejects media upload without authentication with 401', async () => {
    const res = await fetch(`${BASE_URL}/api/media/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaBase64: 'dGVzdA==',
        mimeType: 'image/png',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects unsupported media MIME types with 415 Unsupported Media Type', async () => {
    const res = await fetch(`${BASE_URL}/api/media/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        mediaBase64: Buffer.from('#!/bin/bash\necho bad').toString('base64'),
        mimeType: 'application/x-sh',
      }),
    });
    expect(res.status).toBe(415);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain('Unsupported media type');
  });

  let uploadedImageCid: string;
  const samplePngBuffer = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    crypto.randomBytes(64),
  ]);

  it('successfully uploads an image, returns deterministic CID and serves it', async () => {
    const res = await fetch(`${BASE_URL}/api/media/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        mediaBase64: samplePngBuffer.toString('base64'),
        mimeType: 'image/png',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.cid).toBeDefined();
    expect(data.mimeType).toBe('image/png');
    expect(data.sizeBytes).toBe(samplePngBuffer.length);
    uploadedImageCid = data.cid;

    // Fetch uploaded image
    const getRes = await fetch(`${BASE_URL}/api/feed/image/${uploadedImageCid}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('image/png');
    const imageBytes = Buffer.from(await getRes.arrayBuffer());
    expect(imageBytes.length).toBe(samplePngBuffer.length);
    expect(imageBytes.equals(samplePngBuffer)).toBe(true);
  });

  let uploadedVideoCid: string;
  const videoPayloadSize = 8192; // 8 KB payload
  const sampleVideoBuffer = crypto.randomBytes(videoPayloadSize);

  it('successfully uploads a video and returns video URL with CID', async () => {
    const res = await fetch(`${BASE_URL}/api/media/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        mediaBase64: sampleVideoBuffer.toString('base64'),
        mimeType: 'video/mp4',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.cid).toBeDefined();
    expect(data.url).toBe(`/api/feed/video/${data.cid}`);
    expect(data.sizeBytes).toBe(videoPayloadSize);
    uploadedVideoCid = data.cid;
  });

  it('serves full video with HTTP 200 and Accept-Ranges: bytes when no Range header is sent', async () => {
    const res = await fetch(`${BASE_URL}/api/feed/video/${uploadedVideoCid}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Content-Length')).toBe(String(videoPayloadSize));
    const receivedBuffer = Buffer.from(await res.arrayBuffer());
    expect(receivedBuffer.length).toBe(videoPayloadSize);
    expect(receivedBuffer.equals(sampleVideoBuffer)).toBe(true);
  });

  it('serves first byte chunk (0-1023) with HTTP 206 Partial Content', async () => {
    const res = await fetch(`${BASE_URL}/api/feed/video/${uploadedVideoCid}`, {
      headers: {
        Range: 'bytes=0-1023',
      },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-1023/${videoPayloadSize}`);
    expect(res.headers.get('Content-Length')).toBe('1024');
    const chunk = Buffer.from(await res.arrayBuffer());
    expect(chunk.length).toBe(1024);
    expect(chunk.equals(sampleVideoBuffer.subarray(0, 1024))).toBe(true);
  });

  it('serves middle byte chunk (2048-4095) with HTTP 206 Partial Content', async () => {
    const res = await fetch(`${BASE_URL}/api/feed/video/${uploadedVideoCid}`, {
      headers: {
        Range: 'bytes=2048-4095',
      },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Range')).toBe(`bytes 2048-4095/${videoPayloadSize}`);
    expect(res.headers.get('Content-Length')).toBe('2048');
    const chunk = Buffer.from(await res.arrayBuffer());
    expect(chunk.length).toBe(2048);
    expect(chunk.equals(sampleVideoBuffer.subarray(2048, 4096))).toBe(true);
  });

  it('serves suffix byte range (6000-) with HTTP 206 Partial Content to EOF', async () => {
    const res = await fetch(`${BASE_URL}/api/feed/video/${uploadedVideoCid}`, {
      headers: {
        Range: 'bytes=6000-',
      },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 6000-${videoPayloadSize - 1}/${videoPayloadSize}`);
    const expectedLength = videoPayloadSize - 6000;
    expect(res.headers.get('Content-Length')).toBe(String(expectedLength));
    const chunk = Buffer.from(await res.arrayBuffer());
    expect(chunk.length).toBe(expectedLength);
    expect(chunk.equals(sampleVideoBuffer.subarray(6000))).toBe(true);
  });

  it('returns HTTP 416 Range Not Satisfiable when requested range is out of bounds', async () => {
    const res = await fetch(`${BASE_URL}/api/feed/video/${uploadedVideoCid}`, {
      headers: {
        Range: 'bytes=100000-200000',
      },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe(`bytes */${videoPayloadSize}`);
  });

  it('returns 404 for non-existent image or video CIDs', async () => {
    const imgRes = await fetch(`${BASE_URL}/api/feed/image/bafy_non_existent_cid_here`);
    expect(imgRes.status).toBe(404);

    const vidRes = await fetch(`${BASE_URL}/api/feed/video/bafy_non_existent_cid_here`);
    expect(vidRes.status).toBe(404);
  });
});
