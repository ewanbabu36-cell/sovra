import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { handleAiRoutes } from '../../scripts/routes/ai.routes.ts';

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

describe('Cycle 2: Local Edge AI Co-Pilot & Real-Time Call Translation', () => {
  it('POST /api/ai/studio/summarize generates zero-cloud chapters, summary, and tags', async () => {
    const { req, res, getResponse } = createMockReqRes('POST', '/api/ai/studio/summarize', {
      title: 'Architecting Sovereign Mesh Distribution',
      transcript: 'In this video we break down libp2p GossipSub v1.2. We analyze how peers relay video chunks without centralized servers. Finally we verify double-entry economic solvency.',
    });

    const handled = await handleAiRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(200);
    const json = resp.json();
    expect(json.ok).toBe(true);
    expect(json.zeroCloudVerified).toBe(true);
    expect(json.summary).toBeDefined();
    expect(json.chapters.length).toBeGreaterThanOrEqual(3);
    expect(json.tags).toContain('#Sovra');
    expect(json.inferenceLatencyMs).toBeLessThanOrEqual(50);
  });

  it('POST /api/ai/speech/translate-chunk translates audio speech text offline', async () => {
    const { req, res, getResponse } = createMockReqRes('POST', '/api/ai/speech/translate-chunk', {
      textChunk: 'hello',
      sourceLang: 'en',
      targetLang: 'hi',
    });

    const handled = await handleAiRoutes(req, res);
    expect(handled).toBe(true);

    const json = getResponse().json();
    expect(json.ok).toBe(true);
    expect(json.translatedText).toBe('नमस्ते');
    expect(json.targetLang).toBe('hi');
    expect(json.engine).toContain('whisper');
  });

  it('POST /api/ai/speech/translate-chunk supports Spanish, French, and German offline fallbacks', async () => {
    const es = createMockReqRes('POST', '/api/ai/speech/translate-chunk', {
      textChunk: 'welcome to sovra',
      sourceLang: 'en',
      targetLang: 'es',
    });
    await handleAiRoutes(es.req, es.res);
    expect(es.getResponse().json().translatedText).toBe('bienvenido a sovra');

    const fr = createMockReqRes('POST', '/api/ai/speech/translate-chunk', {
      textChunk: 'thank you',
      sourceLang: 'en',
      targetLang: 'fr',
    });
    await handleAiRoutes(fr.req, fr.res);
    expect(fr.getResponse().json().translatedText).toBe('merci');

    const de = createMockReqRes('POST', '/api/ai/speech/translate-chunk', {
      textChunk: 'good morning',
      sourceLang: 'en',
      targetLang: 'de',
    });
    await handleAiRoutes(de.req, de.res);
    expect(de.getResponse().json().translatedText).toBe('guten morgen');
  });
});
