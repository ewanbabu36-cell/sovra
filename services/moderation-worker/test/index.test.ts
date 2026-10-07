import { describe, it, expect } from 'vitest';
import { ModerationWorker, ScanJob, computePerceptualHash } from '../src/index.js';

describe('@sovra/moderation-worker', () => {
  it('scans clean content and returns ALLOW decision', async () => {
    const worker = new ModerationWorker();
    const job: ScanJob = {
      jobId: 'scan-clean',
      contentCid: 'bafybeisafeimage',
      mimeType: 'image/jpeg',
      textContent: 'Decentralized identity photo for sovereign mesh node',
      data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]), // JPEG magic bytes
    };

    const res = await worker.scanContent(job);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.suggestedDecision).toBe('ALLOW');
      expect(res.value.overallScore).toBeLessThan(0.35);
      expect(res.value.detectedCategories).toHaveLength(0);
      expect(res.value.isProtectedExpression).toBe(true);
    }
  });

  it('detects malware and disguised executable payload with REJECT decision', async () => {
    const worker = new ModerationWorker();
    const job: ScanJob = {
      jobId: 'scan-malware',
      contentCid: 'bafybeibadpayload',
      mimeType: 'image/jpeg',
      // Disguised Windows MZ executable header
      data: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]),
      textContent: 'Free crypto giveaway claim now click here',
    };

    const res = await worker.scanContent(job);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.suggestedDecision).toBe('REJECT');
      expect(res.value.overallScore).toBeGreaterThanOrEqual(0.75);
      expect(res.value.detectedCategories).toContain('SPAM_OR_MALWARE');
    }
  });

  it('matches known perceptual violation hash and enforces REJECT', async () => {
    const worker = new ModerationWorker();
    const badData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const badHash = computePerceptualHash(badData);
    worker.registerViolationHash(badHash);

    const job: ScanJob = {
      jobId: 'scan-pHash-match',
      contentCid: 'bafybeihashmatch',
      mimeType: 'image/png',
      data: badData,
    };

    const res = await worker.scanContent(job);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.suggestedDecision).toBe('REJECT');
      expect(res.value.hashMatches.length).toBeGreaterThan(0);
      expect(res.value.hashMatches[0]?.matchedKnownViolation).toBe(true);
    }
  });

  it('enforces strict zero-tolerance policy against NSFW / sexual content', async () => {
    const worker = new ModerationWorker();
    const job: ScanJob = {
      jobId: 'scan-nsfw-violation',
      contentCid: 'bafybeinsfwcontent',
      mimeType: 'image/jpeg',
      textContent: 'Exclusive explicit sexual act full video upload',
      data: new Uint8Array([0x01, 0x02, 0x03, 0x04]),
    };

    const res = await worker.scanContent(job);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.suggestedDecision).toBe('REJECT');
      expect(res.value.overallScore).toBeGreaterThanOrEqual(0.9);
      expect(res.value.detectedCategories).toContain('PORNOGRAPHY');
    }
  });

  it('enforces zero-tolerance against commercial sexual solicitation', async () => {
    const worker = new ModerationWorker();
    const job: ScanJob = {
      jobId: 'scan-solicitation',
      contentCid: 'bafybeiescortad',
      mimeType: 'text/plain',
      textContent: 'VIP commercial sexual solicitation escort service call now',
    };

    const res = await worker.scanContent(job);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.suggestedDecision).toBe('REJECT');
      expect(res.value.detectedCategories).toContain('SEXUAL_SOLICITATION');
    }
  });
});
