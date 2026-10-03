import { describe, it, expect } from 'vitest';
import { SafetyScanResult, PolicyDecision } from '../src/index.js';

describe('@sovra/moderation', () => {
  it('validates safety scan result structure with protected expression flags', () => {
    const scan: SafetyScanResult = {
      contentCid: 'bafybeisafe123',
      overallScore: 0.12,
      visualScore: 0.1,
      videoFrameScores: [0.1, 0.12],
      textOcrScore: 0.05,
      metadataScore: 0.02,
      detectedCategories: [],
      isProtectedExpression: true, // Protection of orientation/identity
      hashMatches: [],
      suggestedDecision: 'ALLOW',
      evaluatedAt: 1780000000,
    };

    expect(scan.suggestedDecision).toBe('ALLOW');
    expect(scan.isProtectedExpression).toBe(true);
    expect(scan.overallScore).toBeLessThan(0.35);
  });

  it('verifies policy decision enum states', () => {
    const decisions: PolicyDecision[] = ['ALLOW', 'QUARANTINE', 'REJECT'];
    expect(decisions).toContain('QUARANTINE');
  });
});
