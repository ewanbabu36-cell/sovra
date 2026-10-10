/**
 * Sovra Protocol - Production Hardening, PoW Botnet Defense, i18n & Store Compliance Test
 * File: tests/e2e/production-hardening.test.ts
 */

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('Production Hardening: PoW Defense, i18n & Store Compliance', () => {
  it('generates a valid Proof-of-Work challenge and rejects fraudulent solutions', async () => {
    // 1. Fetch challenge
    const chRes = await fetch(`${BASE_URL}/api/auth/challenge`);
    expect(chRes.status).toBe(200);
    const ch = await chRes.json();
    expect(ch.ok).toBe(true);
    expect(ch.challengeId).toMatch(/^pow_/);
    expect(ch.prefix.length).toBeGreaterThan(0);
    expect(ch.difficulty).toBeGreaterThanOrEqual(1);

    // 2. Reject registration with fake nonce
    const badRes = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@fraud_bot_${Date.now()}`,
        challengeId: ch.challengeId,
        solutionNonce: 'tampered_solution_123',
      }),
    });
    expect(badRes.status).toBe(400);
    const badData = await badRes.json();
    expect(badData.error).toContain('Proof-of-Work challenge verification failed');
  });

  it('accepts registration when presenting a cryptographically valid PoW solution', async () => {
    // 1. Fetch challenge
    const chRes = await fetch(`${BASE_URL}/api/auth/challenge`);
    const ch = await chRes.json();
    expect(ch.ok).toBe(true);

    // 2. Compute solution
    const target = '0'.repeat(ch.difficulty);
    let solutionNonce: string | null = null;
    for (let nonce = 0; nonce < 100000; nonce++) {
      const hash = crypto.createHash('sha256').update(ch.prefix + nonce).digest('hex');
      if (hash.startsWith(target)) {
        solutionNonce = String(nonce);
        break;
      }
    }
    expect(solutionNonce).not.toBeNull();

    // 3. Register user with valid PoW
    const handle = `@pow_pass_${Date.now().toString().slice(-6)}`;
    const regRes = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle,
        name: 'Verified PoW Peer',
        challengeId: ch.challengeId,
        solutionNonce,
      }),
    });
    expect(regRes.status).toBe(200);
    const regData = await regRes.json();
    expect(regData.ok).toBe(true);
    expect(regData.user.handle).toBe(handle);
  });

  it('serves multi-language (i18n) locale bundles with correct regional translations', async () => {
    // 1. Locales directory list
    const listRes = await fetch(`${BASE_URL}/api/i18n`);
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.ok).toBe(true);
    expect(listData.supportedLocales.some((l: any) => l.code === 'hi')).toBe(true);
    expect(listData.supportedLocales.some((l: any) => l.code === 'ar')).toBe(true);

    // 2. Hindi regional bundle
    const hiRes = await fetch(`${BASE_URL}/api/i18n/hi`);
    expect(hiRes.status).toBe(200);
    const hiData = await hiRes.json();
    expect(hiData.strings['app.title']).toBe('सोवरा नेटवर्क');
    expect(hiData.metadata.nativeName).toBe('हिन्दी');

    // 3. Arabic bundle with RTL text direction
    const arRes = await fetch(`${BASE_URL}/api/i18n/ar`);
    expect(arRes.status).toBe(200);
    const arData = await arRes.json();
    expect(arData.metadata.direction).toBe('rtl');
    expect(arData.strings['compliance.zero_knowledge']).toBe('بنية تشفير المعرفة الصفرية');
  });

  it('serves Privacy Policy and Terms of Service for Google Play and App Store compliance', async () => {
    // 1. Privacy Policy HTML
    const privacyHtmlRes = await fetch(`${BASE_URL}/privacy`);
    expect(privacyHtmlRes.status).toBe(200);
    expect(privacyHtmlRes.headers.get('Content-Type')).toContain('text/html');
    const html = await privacyHtmlRes.text();
    expect(html).toContain('SOVRA Protocol Privacy Policy');
    expect(html).toContain('Zero-Knowledge Architecture');

    // 2. Terms of Service JSON
    const termsJsonRes = await fetch(`${BASE_URL}/api/compliance/terms`);
    expect(termsJsonRes.status).toBe(200);
    const terms = await termsJsonRes.json();
    expect(terms.ok).toBe(true);
    expect(terms.document.title).toBe('SOVRA Protocol Terms of Service');
    expect(terms.document.clauses.length).toBeGreaterThan(0);
  });

  it('batches high-frequency feed post view increments without blocking', async () => {
    const viewRes = await fetch(`${BASE_URL}/api/feed/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: 'e2e-batch-post-1' }),
    });
    expect(viewRes.status).toBe(200);
    const data = await viewRes.json();
    expect(data.ok).toBe(true);
    expect(data.batched).toBe(true);
  });
});
