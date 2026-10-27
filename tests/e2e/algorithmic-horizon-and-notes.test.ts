import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { handleNotesRoutes } from '../../scripts/routes/notes.routes.ts';

function createMockReqRes(method: string, url: string, bodyObj?: any) {
  const req = new http.IncomingMessage(null as any);
  req.method = method;
  req.url = url;

  const res = new http.ServerResponse(req);
  let statusCode = 200;
  let body = '';

  res.writeHead = (status: number) => {
    statusCode = status;
    return res;
  };

  res.end = (chunk?: any) => {
    if (chunk) body += chunk;
    return res;
  };

  if (bodyObj !== undefined) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(bodyObj)));
      req.emit('end');
    });
  } else {
    process.nextTick(() => {
      req.emit('end');
    });
  }

  return {
    req,
    res,
    getResponse: () => ({
      statusCode,
      body,
      json: () => (body ? JSON.parse(body) : null),
    }),
  };
}

describe('Cycle 5: Algorithmic Horizon & Cryptographic Community Notes', () => {
  const testPostId = `post_viral_${Date.now()}`;

  it('POST /api/notes/submit creates a new community note citing verifiable sources', async () => {
    const { req, res, getResponse } = createMockReqRes('POST', '/api/notes/submit', {
      postId: testPostId,
      authorDid: 'did:sovra:fact_checker_1',
      summary: 'This video clip was taken out of context. The full 2024 unedited speech shows the speaker advocating for decentralization.',
      classification: 'misleading',
      sources: ['https://archive.org/details/full-speech-2024', 'ipfs://bafybeihash123'],
    });

    const handled = await handleNotesRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(201);
    const json = resp.json();
    expect(json.ok).toBe(true);
    expect(json.note.postId).toBe(testPostId);
    expect(json.note.status).toBe('needs_more_ratings');
    expect(json.note.sources.length).toBe(2);
  });

  it('POST /api/notes/rate computes cross-cluster bridging consensus', async () => {
    // 1. Submit note
    const submit = createMockReqRes('POST', '/api/notes/submit', {
      postId: testPostId,
      authorDid: 'did:sovra:fact_checker_2',
      summary: 'Verified on-chain: The transaction hash provided belongs to an alternate testnet.',
      classification: 'lacks_context',
      sources: ['https://explorer.sovra.network/tx/0xabc'],
    });
    await handleNotesRoutes(submit.req, submit.res);
    const noteId = submit.getResponse().json().note.id;

    // 2. Cluster A rater rates helpful
    const rateA = createMockReqRes('POST', '/api/notes/rate', {
      noteId,
      raterDid: 'did:sovra:rater_cluster_a',
      clusterId: 'cluster_left',
      helpful: true,
      reason: 'Clear verifiable blockchain explorer citation',
    });
    await handleNotesRoutes(rateA.req, rateA.res);
    expect(rateA.getResponse().json().status).toBe('needs_more_ratings'); // Needs opposing cluster

    // 3. Cluster B (opposing) rater also rates helpful (cross-cluster bridging!)
    const rateB = createMockReqRes('POST', '/api/notes/rate', {
      noteId,
      raterDid: 'did:sovra:rater_cluster_b',
      clusterId: 'cluster_right',
      helpful: true,
      reason: 'Checked the testnet explorer independently, accurate note.',
    });
    await handleNotesRoutes(rateB.req, rateB.res);
    const rateBJson = rateB.getResponse().json();
    expect(rateBJson.ok).toBe(true);
    expect(rateBJson.divergentClusterAgreement).toBe(1.0); // 100% divergent cluster agreement
    expect(rateBJson.status).toBe('helpful'); // Bridged consensus achieved!
  });

  it('GET /api/notes/post/:postId retrieves all community notes for a post', async () => {
    const { req, res, getResponse } = createMockReqRes('GET', `/api/notes/post/${testPostId}`);
    const handled = await handleNotesRoutes(req, res);
    expect(handled).toBe(true);

    const json = getResponse().json();
    expect(json.ok).toBe(true);
    expect(json.postId).toBe(testPostId);
    expect(json.notes.length).toBeGreaterThanOrEqual(2);
  });
});
