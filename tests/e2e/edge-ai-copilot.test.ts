import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { handleAiRoutes, inferSemanticIntent } from '../../scripts/routes/ai.routes.ts';

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

  it('inferSemanticIntent computes normalized dense vector embeddings and classifies intents', () => {
    const walletRes = inferSemanticIntent('How do I transfer tokens to peer or check my wallet balance?');
    expect(walletRes.intent.id).toBe('WALLET_FUNDS');
    expect(walletRes.confidence).toBeGreaterThanOrEqual(0.3);
    expect(walletRes.cosineSim).toBeGreaterThan(0);
    expect(walletRes.tokensCount).toBeGreaterThan(0);

    const meshRes = inferSemanticIntent('Show connected p2p mesh nodes and bitswap blockstore routing');
    expect(meshRes.intent.id).toBe('MESH_NETWORK');
    expect(meshRes.confidence).toBeGreaterThanOrEqual(0.3);

    const cryptoRes = inferSemanticIntent('Explain double ratchet e2ee cipher and ed25519 identity keys');
    expect(cryptoRes.intent.id).toBe('SECURITY_CRYPTO');
    expect(cryptoRes.confidence).toBeGreaterThanOrEqual(0.3);
  });

  it('POST /api/ai/copilot/chat executes edge neural intent inference with dynamic state and actions', async () => {
    // 1. Empty query returns capability overview
    const emptyChat = createMockReqRes('POST', '/api/ai/copilot/chat', {});
    await handleAiRoutes(emptyChat.req, emptyChat.res);
    const emptyJson = emptyChat.getResponse().json();
    expect(emptyJson.ok).toBe(true);
    expect(emptyJson.reply).toContain('Spatial CoPilot');
    expect(emptyJson.model).toBe('sovra-neural-intent-quantized-v2');
    expect(emptyJson.runtime).toBe('embedded-quantized-neural-engine');

    // 2. Wallet query returns dynamic balance & action
    const mockCtx = {
      resolvePrincipal: () => ({ did: 'did:sovra:alice_test_mock', handle: 'alice' }),
      node: { getConnectedPeers: () => ['peer1', 'peer2'] },
      storageDaemon: { getStats: () => ({ storedBytes: 52428800 }) },
    };

    const walletChat = createMockReqRes('POST', '/api/ai/copilot/chat', {
      message: 'What is my wallet balance and how do I send funds?',
      did: 'did:sovra:alice_test_mock',
    });
    await handleAiRoutes(walletChat.req, walletChat.res, mockCtx);
    const walletJson = walletChat.getResponse().json();
    expect(walletJson.ok).toBe(true);
    expect(walletJson.intent).toBe('WALLET_FUNDS');
    expect(walletJson.confidence).toBeGreaterThanOrEqual(0.4);
    expect(walletJson.reply).toContain('SOV');
    expect(walletJson.action.type).toBe('SHOW_TRANSFER_MODAL');
    expect(walletJson.zeroCloud).toBe(true);
    expect(walletJson.latencyMs).toBeDefined();

    // 3. Mesh query returns live connected peer telemetry
    const meshChat = createMockReqRes('POST', '/api/ai/copilot/chat', {
      message: 'Check mesh network peer connections and bandwidth',
    });
    await handleAiRoutes(meshChat.req, meshChat.res, mockCtx);
    const meshJson = meshChat.getResponse().json();
    expect(meshJson.ok).toBe(true);
    expect(meshJson.intent).toBe('MESH_NETWORK');
    expect(meshJson.reply).toContain('2 connected peer(s)');
    expect(meshJson.action.type).toBe('NAVIGATE_TAB');
    expect(meshJson.action.target).toBe('mesh');
  });
});
