import { describe, it, expect, beforeAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sovraDb } from '../../scripts/database-engine.ts';
import { splitSecretMpc, reconstructSecretMpc } from '../../packages/crypto/src/mpc.ts';

const BASE_URL = 'http://127.0.0.1:3001';

function makeRequest(
  urlPath: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
  } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; data: any; rawText: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const postData = options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : null;
    const reqHeaders: Record<string, string> = {
      'x-sovra-benchmark': 'true',
      ...(options.headers || {}),
    };
    if (postData && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }
    if (postData && !reqHeaders['Content-Length']) {
      reqHeaders['Content-Length'] = String(Buffer.byteLength(postData));
    }

    const req = http.request(url, {
      method: options.method || 'GET',
      headers: reqHeaders,
      timeout: 25000,
    }, (res) => {
      let chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const rawText = Buffer.concat(chunks).toString('utf-8');
        let data: any = null;
        try {
          data = JSON.parse(rawText);
        } catch (_) {
          data = rawText;
        }
        resolve({
          status: res.statusCode || 500,
          headers: res.headers,
          data,
          rawText,
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout: ' + urlPath));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

describe('🚀 SOVRA GLOBAL COMMERCIAL EXPANSION: IOS APP STORE, MPC KEY RECOVERY, ON-DEVICE AI & EDGE CDN PROTOCOL', () => {
  const ts = Date.now();
  const testUserDid = `did:sovra:commercial_user_${ts}`;
  const testGuardianDid = `did:sovra:trusted_guardian_${ts}`;

  beforeAll(() => {
    sovraDb.registerUser({
      did: testUserDid,
      handle: `@commercial_lead_${ts}`,
      displayName: 'Commercial Lead',
      balanceSov: 1000.0,
    });
  });

  // ==========================================================================
  // PHASE 1: APPLE IOS APP STORE PACKAGING, UNIVERSAL LINKS & APNS BRIDGE
  // ==========================================================================
  describe('Phase 1: Apple iOS App Store Packaging, Universal Links & APNs Bridge', () => {
    it('should serve /.well-known/apple-app-site-association with valid universal link routes and appId', async () => {
      const res = await makeRequest('/.well-known/apple-app-site-association');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.data.applinks).toBeDefined();
      expect(Array.isArray(res.data.applinks.details)).toBe(true);

      const applinkDetail = res.data.applinks.details[0];
      expect(applinkDetail.appID).toContain('app.sovra.network');
      expect(applinkDetail.paths).toContain('/spaces/*');
      expect(applinkDetail.paths).toContain('/profile/*');
      expect(applinkDetail.paths).toContain('/chat/*');
    });

    it('should register iOS APNs device push token via POST /api/push/apns/register', async () => {
      const token = `apns_mock_token_${ts}_xyz789`;
      const res = await makeRequest('/api/push/apns/register', {
        method: 'POST',
        body: {
          did: testUserDid,
          deviceToken: token,
          platform: 'ios',
        },
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.registered).toBe(true);
      expect(res.data.deviceToken).toBe(token);
      expect(res.data.platform).toBe('ios');
    });

    it('should translate and dispatch blind wakeup to Apple APNs HTTP/2 format', async () => {
      const token = `apns_mock_token_${ts}_xyz789`;
      const res = await makeRequest('/api/push/apns/dispatch-wakeup', {
        method: 'POST',
        body: {
          deviceToken: token,
          payload: {
            aps: {
              alert: { title: 'Incoming Sovereign Call', body: 'Alice is calling via E2EE Mesh' },
              sound: 'ringtone.aiff',
              'content-available': 1,
            },
          },
          priority: 10,
        },
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.dispatched).toBe(true);
      expect(res.data.apnsId).toMatch(/^apns-uuid-/);
      expect(res.data.apnsHeaders['apns-topic']).toBe('app.sovra.network');
      expect(res.data.apnsHeaders['apns-priority']).toBe('10');
      expect(res.data.deviceToken).toBe(token);
    });

    it('should verify Capacitor iOS config metadata exists and matches package standards', () => {
      const configPath = path.join(process.cwd(), 'apps', 'ios', 'App', 'App', 'capacitor.config.json');
      expect(fs.existsSync(configPath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(parsed.appId).toBe('app.sovra.network');
      expect(parsed.appName).toBe('Sovra');
      expect(parsed.server.url).toContain('sovra.network');
    });
  });

  // ==========================================================================
  // PHASE 2: SEEDLESS 2-OF-3 MPC (THRESHOLD SECRET SHARING) SOCIAL RECOVERY
  // ==========================================================================
  describe('Phase 2: Seedless 2-of-3 MPC Social Key Recovery', () => {
    let generatedShares: any[] = [];
    const originalPrivateKey = crypto.randomBytes(32).toString('hex');

    beforeAll(() => {
      // Split the 32-byte sovereign private key into 3 shares
      const splitResult = splitSecretMpc(originalPrivateKey, 2, 3);
      generatedShares = splitResult.shares;
    });

    it('should nominate a trusted guardian and store encrypted recovery share', async () => {
      const guardianShare = generatedShares[2]; // Share 3 allocated to Guardian
      const res = await makeRequest('/api/auth/mpc/guardians/nominate', {
        method: 'POST',
        body: {
          did: testUserDid,
          guardianDid: testGuardianDid,
          guardianName: 'Bob the Guardian',
          encryptedShareHex: guardianShare.shareHex,
          shareId: 3,
        },
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.vault).toBeDefined();
      expect(res.data.vault.recoveryHealth).toBe('HEALTHY');
      expect(res.data.vault.threshold).toBe(2);
      expect(res.data.guardian.guardianDid).toBe(testGuardianDid);
    });

    it('should request guardian recovery share via POST /api/auth/mpc/guardians/request-recovery-share', async () => {
      const res = await makeRequest('/api/auth/mpc/guardians/request-recovery-share', {
        method: 'POST',
        body: {
          did: testUserDid,
          guardianDid: testGuardianDid,
        },
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.requested).toBe(true);
      expect(res.data.guardianDid).toBe(testGuardianDid);
      expect(res.data.shareId).toBe(3);
      expect(res.data.encryptedShareHex).toBe(generatedShares[2].shareHex);
    });

    it('should reconstruct master sovereign key from any 2 of 3 shares via POST /api/auth/mpc/reconstruct', async () => {
      // Reconstruct using Share 1 (Enclave) and Share 3 (Guardian)
      const res = await makeRequest('/api/auth/mpc/reconstruct', {
        method: 'POST',
        body: {
          shares: [generatedShares[0], generatedShares[2]],
        },
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.recoveredSecretHex).toBe(originalPrivateKey);
      expect(res.data.sharesUsed).toBe(2);
      expect(res.data.algorithm).toBe('Shamir-2-of-3-GF256');

      // Also verify pure crypto library reconstruct function matches
      const localRec = reconstructSecretMpc([generatedShares[1], generatedShares[2]]);
      expect(localRec).toBe(originalPrivateKey);
    });

    it('should reject reconstruction with fewer than 2 shares', async () => {
      const res = await makeRequest('/api/auth/mpc/reconstruct', {
        method: 'POST',
        body: {
          shares: [generatedShares[0]],
        },
      });

      expect(res.status).toBe(400);
      expect(res.data.ok).toBe(false);
      expect(res.data.error).toContain('At least 2 shares are required');
    });

    it('should embed Seedless MPC Recovery UI card in served HTML', async () => {
      const res = await makeRequest('/');
      expect(res.status).toBe(200);
      expect(res.rawText).toContain('id="mpcRecoveryCard"');
      expect(res.rawText).toContain('id="mpcHealthBadge"');
      expect(res.rawText).toContain('id="nominateGuardianBtn"');
      expect(res.rawText).toContain('id="testMpcRecoverBtn"');
    });
  });

  // ==========================================================================
  // PHASE 3: ON-DEVICE WEBGPU AI COPILOT & AGENT MONETIZATION MARKETPLACE
  // ==========================================================================
  describe('Phase 3: On-Device WebGPU AI Copilot & Agent Marketplace', () => {
    it('should serve verified on-device quantized models catalog via GET /api/ai/marketplace/models', async () => {
      const res = await makeRequest('/api/ai/marketplace/models');
      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(Array.isArray(res.data.models)).toBe(true);
      expect(res.data.models.length).toBeGreaterThanOrEqual(3);
      expect(res.data.webGpuRecommended).toBe(true);

      const whisper = res.data.models.find((m: any) => m.modelId === 'sovra-whisper-tiny-q4');
      expect(whisper).toBeDefined();
      expect(whisper.task).toBe('voice_transcription');

      const llama = res.data.models.find((m: any) => m.modelId === 'sovra-llama3-guard-q4');
      expect(llama).toBeDefined();
      expect(llama.task).toBe('content_moderation');
    });

    it('should hire autonomous AI agent with escrow budget via POST /api/ai/agents/hire', async () => {
      const res = await makeRequest('/api/ai/agents/hire', {
        method: 'POST',
        body: {
          agentId: 'agent_moderator_auto_v1',
          employerDid: testUserDid,
          role: 'COMMUNITY_MODERATOR',
          escrowBudgetSov: 50,
          durationDays: 14,
        },
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.contract).toBeDefined();
      expect(res.data.contract.contractId).toMatch(/^hire_/);
      expect(res.data.contract.employerDid).toBe(testUserDid);
      expect(res.data.contract.status).toBe('HIRED_ACTIVE');
      expect(res.data.contract.escrowBudgetSov).toBe(50);
    });

    it('should reject agent hire when required agentId or employerDid is missing', async () => {
      const res = await makeRequest('/api/ai/agents/hire', {
        method: 'POST',
        body: { role: 'CURATOR' },
      });
      expect(res.status).toBe(400);
      expect(res.data.ok).toBe(false);
    });

    it('should embed On-Device AI Copilot badge and client-side runtime in served HTML', async () => {
      const res = await makeRequest('/');
      expect(res.status).toBe(200);
      expect(res.rawText).toContain('id="onDeviceAiCard"');
      expect(res.rawText).toContain('id="onDeviceAiBadge"');
      expect(res.rawText).toContain('id="onDeviceAiToggle"');
      expect(res.rawText).toContain('window.SovraLocalAI');
      expect(res.rawText).toContain('moderateContentLocally');
      expect(res.rawText).toContain('summarizeTranscriptLocally');
      expect(res.rawText).toContain('toggleOnDeviceAi');
    });
  });

  // ==========================================================================
  // PHASE 4: ANYCAST GEO-DISTRIBUTED EDGE CDN & LATENCY DISCOVERY
  // ==========================================================================
  describe('Phase 4: Anycast Geo-Distributed Edge CDN & Latency Discovery', () => {
    it('should return nearest active edge relays via GET /api/edge/nodes/nearest', async () => {
      const res = await makeRequest('/api/edge/nodes/nearest');
      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(Array.isArray(res.data.nearestNodes)).toBe(true);
      expect(res.data.nearestNodes.length).toBeGreaterThanOrEqual(3);

      const primary = res.data.nearestNodes[0];
      expect(primary.tier).toBe('PRIMARY');
      expect(primary.estimatedLatencyMs).toBeLessThan(50);
      expect(primary.protocols).toContain('noise_xx');
      expect(res.data.recommendedRelay).toBe(primary.host);
    });

    it('should verify Cloudflare / Fastly edge worker script exists and handles caching & WebSocket bypass', () => {
      const workerPath = path.join(process.cwd(), 'scripts', 'edge-worker.js');
      expect(fs.existsSync(workerPath)).toBe(true);
      const content = fs.readFileSync(workerPath, 'utf8');
      expect(content).toContain('websocket');
      expect(content).toContain('X-Sovra-Edge-Region');
      expect(content).toContain('X-Sovra-Edge-Cache');
      expect(content).toContain('caches.default');
    });

    it('should embed Edge Relay status indicator pill in served HTML', async () => {
      const res = await makeRequest('/');
      expect(res.status).toBe(200);
      expect(res.rawText).toContain('id="edgeRelayPill"');
      expect(res.rawText).toContain('Edge Relay:');
    });
  });

  // ==========================================================================
  // PHASE 5: AUTOMATED CI/CD RELEASE WORKFLOW & INTEGRITY
  // ==========================================================================
  describe('Phase 5: Automated CI/CD Release Workflow & Integrity', () => {
    it('should verify .github/workflows/production-release.yml exists and declares complete test & build pipeline', () => {
      const ciPath = path.join(process.cwd(), '.github', 'workflows', 'production-release.yml');
      expect(fs.existsSync(ciPath)).toBe(true);
      const content = fs.readFileSync(ciPath, 'utf8');
      expect(content).toContain('validate:integrity');
      expect(content).toContain('global-commercial-expansion.test.ts');
      expect(content).toContain('apple-app-site-association');
      expect(content).toContain('capacitor.config.json');
    });
  });
});
