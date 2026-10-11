/**
 * @file tests/integration/community-jury-http.test.ts
 * Integration test verifying all Community Jury HTTP endpoints against live dev-server
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://127.0.0.1:3001';

describe('Community Jury & Democratic Moderation HTTP API Integration', () => {
  const ts = Date.now();
  let authorToken = '';
  let authorDid = '';
  let reporterToken = '';
  let reporterDid = '';
  let jurorTokens: string[] = [];
  let postId = '';

  beforeAll(async () => {
    // 1. Verify server is reachable
    const statusRes = await fetch(`${BASE_URL}/api/status`);
    expect(statusRes.ok).toBe(true);

    // 2. Register author
    const regAuthor = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@author_http_${ts}`,
        displayName: 'Author HTTP',
      }),
    });
    expect(regAuthor.status).toBe(200);
    const authData = await regAuthor.json();
    authorToken = authData.sessionToken || authData.user?.sessionToken;
    authorDid = authData.user.did;

    // 3. Register reporter
    const regReporter = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@reporter_http_${ts}`,
        displayName: 'Reporter HTTP',
      }),
    });
    expect(regReporter.status).toBe(200);
    const repData = await regReporter.json();
    reporterToken = repData.sessionToken || repData.user?.sessionToken;
    reporterDid = repData.user.did;

    // 4. Register 3 jurors
    for (let i = 0; i < 3; i++) {
      const regJ = await fetch(`${BASE_URL}/api/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: `@juror_http_${ts}_${i}`,
          displayName: `Juror ${i}`,
        }),
      });
      expect(regJ.status).toBe(200);
      const jData = await regJ.json();
      jurorTokens.push(jData.sessionToken || jData.user?.sessionToken);
    }

    // 5. Create a post
    const createPostRes = await fetch(`${BASE_URL}/api/feed/post`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authorToken}`,
      },
      body: JSON.stringify({
        caption: 'Post submitted for jury testing over HTTP',
        visibility: 'public',
      }),
    });
    expect(createPostRes.status).toBe(200);
    const postData = await createPostRes.json();
    postId = postData.post?.id || postData.id;
  });

  let activeCaseId = '';

  it('1. POST /api/moderation/reports creates or consolidates a jury case', async () => {
    const res = await fetch(`${BASE_URL}/api/moderation/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${reporterToken}`,
      },
      body: JSON.stringify({
        targetType: 'post',
        targetId: postId,
        violationCategory: 'HATE_SPEECH_DEHUMANIZATION',
        evidenceText: 'Suspected hate speech content for test',
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.case).toBeDefined();
    expect(data.case.categories).toContain('hate_speech');
    activeCaseId = data.case.id;
  });

  it('2. GET /api/moderation/cases lists active jury cases', async () => {
    const res = await fetch(`${BASE_URL}/api/moderation/cases`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.cases)).toBe(true);
    expect(data.cases.some((c: any) => c.id === activeCaseId)).toBe(true);
  });

  it('3. GET /api/moderation/cases/:id returns case details', async () => {
    const res = await fetch(`${BASE_URL}/api/moderation/cases/${encodeURIComponent(activeCaseId)}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.case.id).toBe(activeCaseId);
    expect(data.case.authorDid).toBe(authorDid);
  });

  it('4. POST /api/moderation/cases/:id/defense accepts author defense statement', async () => {
    const res = await fetch(`${BASE_URL}/api/moderation/cases/${encodeURIComponent(activeCaseId)}/defense`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authorToken}`,
      },
      body: JSON.stringify({
        defenseNote: 'This statement is political discourse and not hate speech.',
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.case.authorDefenseNote).toContain('political discourse');
  });

  it('5. POST /api/moderation/cases/:id/vote records valid juror vote', async () => {
    const res = await fetch(`${BASE_URL}/api/moderation/cases/${encodeURIComponent(activeCaseId)}/vote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jurorTokens[0]}`,
      },
      body: JSON.stringify({
        choice: 'VIOLATION_NOT_PROVEN',
        rationale: 'Legitimate expression protected under due process',
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.case.votes.violationNotProven).toBe(1);
  });

  it('6. POST /api/moderation/cases/:id/finalize computes consensus verdict', async () => {
    const res = await fetch(`${BASE_URL}/api/moderation/cases/${encodeURIComponent(activeCaseId)}/finalize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        force: true,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.case.verdict).toBeDefined();
    expect(data.case.enforcement.applied).toBe(true);
  });

  it('7. POST /api/moderation/cases/:id/appeal allows author to submit appeal', async () => {
    const res = await fetch(`${BASE_URL}/api/moderation/cases/${encodeURIComponent(activeCaseId)}/appeal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authorToken}`,
      },
      body: JSON.stringify({
        appealReason: 'Requesting review on procedural grounds',
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.appeal.status).toBe('PENDING');
  });

  it('8. GET /api/moderation/transparency returns public metrics', async () => {
    const res = await fetch(`${BASE_URL}/api/moderation/transparency`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.metrics.totalCases).toBeGreaterThanOrEqual(1);
  });

  it('9. GET /api/moderation/policies returns system policy configuration', async () => {
    const res = await fetch(`${BASE_URL}/api/moderation/policies`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.policies.votingDurationMs).toBe(86400000);
    expect(data.policies.minQuorum).toBe(21);
    expect(data.policies.removalThresholdRatio).toBeCloseTo(0.6667, 3);
  });
});
