import { describe, it, expect } from 'vitest';
import { ModerationWorker, ScanJob } from '../src/index.js';

describe('@sovra/moderation-worker', () => {
  it('scans content and returns verified safety decision', async () => {
    const worker = new ModerationWorker();
    const job: ScanJob = {
      jobId: 'scan-1',
      contentCid: 'bafybeisafeimage',
      mimeType: 'image/jpeg',
    };

    const res = await worker.scanContent(job);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.suggestedDecision).toBe('ALLOW');
      expect(res.value.isProtectedExpression).toBe(true);
    }
  });
});
