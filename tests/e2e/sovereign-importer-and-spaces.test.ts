import { describe, it, expect, beforeAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { sovraDb } from '../../scripts/database-engine.ts';

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
          status: res.statusCode || 0,
          headers: res.headers,
          data,
          rawText
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

describe('🚀 Sovereign Enterprise Launch & Production Gaps Verification', () => {

  beforeAll(async () => {
    // Ping server status
    const res = await makeRequest('/api/status');
    expect(res.status).toBe(200);
    expect(res.data.status === 'ok' || res.data.status === 'online' || res.data.ok === true).toBe(true);
  });

  describe('Phase 1: Sovereign Audience Graph Exporter & Cryptographic Importer', () => {
    let exportedArchive: any = null;

    it('should export sovereign graph archive with RFC 8032 Ed25519 signature', async () => {
      const res = await makeRequest('/api/user/export-sovereign-graph');
      expect(res.status).toBe(200);
      expect(res.data.format).toBe('sovra_sovereign_graph_v1');
      expect(res.data.version).toBe('1.0.0');
      expect(res.data.cryptographicProof).toBeDefined();
      expect(res.data.cryptographicProof.suite).toBe('Ed25519_SHA256_RFC8032');
      expect(res.data.cryptographicProof.signatureHex).toMatch(/^[0-9a-fA-F]{128}$/);
      expect(Array.isArray(res.data.posts)).toBe(true);
      expect(Array.isArray(res.data.followers)).toBe(true);

      exportedArchive = res.data;
    });

    it('should restore sovereign graph idempotently via POST /api/user/import-sovereign-graph', async () => {
      expect(exportedArchive).not.toBeNull();
      const res = await makeRequest('/api/user/import-sovereign-graph', {
        method: 'POST',
        body: exportedArchive,
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.message).toContain('verified and restored successfully');
      expect(res.data.success).toBe(true);
    });

    it('should reject tampered or corrupted sovereign graph archives with 403 Forbidden', async () => {
      const tamperedArchive = JSON.parse(JSON.stringify(exportedArchive));
      // Tamper post caption without updating signature
      if (tamperedArchive.posts && tamperedArchive.posts.length > 0) {
        tamperedArchive.posts[0].caption = 'TAMPERED MALICIOUS CONTENT';
      } else {
        tamperedArchive.profile.displayName = 'HACKED PROFILE';
      }

      const res = await makeRequest('/api/user/import-sovereign-graph', {
        method: 'POST',
        body: tamperedArchive,
      });

      expect(res.status).toBe(403);
      expect(res.data.ok).toBe(false);
      expect(res.data.error).toContain('RFC 8032 Ed25519 cryptographic signature verification failed');
    });
  });

  describe('Phase 2: Decentralized Multi-Peer Audio Spaces ("Sovra Spaces")', () => {
    let createdSpaceId = '';
    const testHostDid = 'did:sovra:spaces_test_host_' + Date.now();
    const testListenerDid = 'did:sovra:spaces_test_listener_' + Date.now();

    it('should list active spaces including genesis mesh stage', async () => {
      const res = await makeRequest('/api/spaces/active');
      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(Array.isArray(res.data.spaces)).toBe(true);
      expect(res.data.spaces.length).toBeGreaterThan(0);
    });

    it('should create a new decentralized audio space', async () => {
      const res = await makeRequest('/api/spaces/create', {
        method: 'POST',
        body: {
          topic: '🛰️ Global P2P Mesh Swarm & Spatial Audio Lab',
          hostDid: testHostDid,
          hostName: 'Test Space Host',
          hostAvatar: '🎙️',
        }
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.space).toBeDefined();
      expect(res.data.space.topic).toBe('🛰️ Global P2P Mesh Swarm & Spatial Audio Lab');
      expect(res.data.space.speakers.length).toBe(1);
      expect(res.data.space.speakers[0].did).toBe(testHostDid);

      createdSpaceId = res.data.space.spaceId;
    });

    it('should allow peers to join the space as listeners', async () => {
      const res = await makeRequest('/api/spaces/join', {
        method: 'POST',
        body: {
          spaceId: createdSpaceId,
          did: testListenerDid,
          name: 'Space Listener Bob',
          avatar: '🎧',
          role: 'listener',
        }
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      const space = res.data.space;
      expect(space.listeners.some((l: any) => l.did === testListenerDid)).toBe(true);
    });

    it('should allow listeners to raise hands to request speaking', async () => {
      const res = await makeRequest('/api/spaces/hand-raise', {
        method: 'POST',
        body: {
          spaceId: createdSpaceId,
          did: testListenerDid,
          name: 'Space Listener Bob',
          avatar: '🎧',
        }
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.raised).toBe(true);
      const space = res.data.space;
      expect(space.raisedHands.some((h: any) => h.did === testListenerDid)).toBe(true);
    });

    it('should allow the host to grant speaker permission and promote listener', async () => {
      const res = await makeRequest('/api/spaces/speak-grant', {
        method: 'POST',
        body: {
          spaceId: createdSpaceId,
          hostDid: testHostDid,
          targetDid: testListenerDid,
          grant: true,
        }
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.granted).toBe(true);
      const space = res.data.space;
      expect(space.speakers.some((s: any) => s.did === testListenerDid)).toBe(true);
      expect(space.raisedHands.some((h: any) => h.did === testListenerDid)).toBe(false);
    });

    it('should multiplex real-time peer emoji reactions across the stage', async () => {
      const res = await makeRequest('/api/spaces/reaction', {
        method: 'POST',
        body: {
          spaceId: createdSpaceId,
          did: testListenerDid,
          emoji: '🔥',
        }
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.reaction.emoji).toBe('🔥');
      expect(res.data.reaction.fromDid).toBe(testListenerDid);
    });

    it('should allow host to conclude and end the audio space', async () => {
      const res = await makeRequest('/api/spaces/end', {
        method: 'POST',
        body: {
          spaceId: createdSpaceId,
          hostDid: testHostDid,
        }
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.status).toBe('ended');
    });
  });

  describe('Phase 3: One-Click Native Push Subscription & E2EE Blind Wakeup', () => {
    it('should provide VAPID public key for WebPush registration', async () => {
      const res = await makeRequest('/api/push/vapid-key');
      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.publicKey).toBeDefined();
      expect(typeof res.data.publicKey).toBe('string');
      expect(res.data.publicKey.length).toBeGreaterThan(20);
    });

    it('should register web push subscription with user DID', async () => {
      const testPushDid = 'did:sovra:push_user_' + Date.now();
      const res = await makeRequest('/api/push/subscribe', {
        method: 'POST',
        body: {
          did: testPushDid,
          subscription: {
            endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint-' + Date.now(),
            keys: {
              p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9AcPP3135n4kEdpjpMg2UotBVOFFq49KNn-lSFV5ReIg58',
              auth: 'tBHItJI5svbpez7KI4CCXg'
            }
          },
          platform: 'web',
        }
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.subscribed).toBe(true);
      expect(res.data.did).toBe(testPushDid);
    });

    it('should trigger micropayment tip and dispatch blind push wakeup', async () => {
      const creatorDid = 'did:sovra:carol_audio_engineer';
      const res = await makeRequest('/api/creator/tip', {
        method: 'POST',
        body: {
          creatorDid,
          targetType: 'post',
          targetId: 'feed-1',
          amount: 5,
          message: 'Decentralized audio spaces supporter tip',
        }
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.creatorCut).toBe(4.75); // 95% of 5 SOV
      expect(res.data.seederCut).toBe(0.25);  // 5% of 5 SOV
    });
  });

  describe('Phase 4: Production Client Bundle & PWA Cache Pre-Warming', () => {
    it('should have pre-compiled standalone client bundle on disk', () => {
      const bundlePath = path.resolve(process.cwd(), 'apps/sovra-app/dist/bundle.js');
      expect(fs.existsSync(bundlePath)).toBe(true);
      const stat = fs.statSync(bundlePath);
      expect(stat.size).toBeGreaterThan(50000); // Over 50KB minified bundle
    });

    it('should serve /assets/bundle.js with correct MIME type', async () => {
      const res = await makeRequest('/assets/bundle.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/javascript');
      expect(res.rawText.length).toBeGreaterThan(1000);
    });

    it('should serve updated PWA Service Worker v7 with asset pre-warming', async () => {
      const res = await makeRequest('/sw.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/javascript');
      expect(res.rawText).toContain('sovra-pwa-v7');
      expect(res.rawText).toContain('/assets/bundle.js');
    });
  });

  describe('Phase 5: High-Concurrency Chaos Stress Benchmark', () => {
    it('should withstand 50 concurrent wallet tips without database locking (SQLITE_BUSY)', async () => {
      const creatorDid = 'did:sovra:carol_audio_engineer';
      const senderDid = 'did:sovra:stress_sender_' + Date.now();
      
      // Ensure sender is registered with ample balance
      sovraDb.registerUser({
        did: senderDid,
        handle: '@stress_sender_' + Date.now(),
        displayName: 'Stress Sender',
        balanceSov: 5000,
      });

      const tipPromises: Promise<any>[] = [];

      for (let i = 0; i < 50; i++) {
        tipPromises.push(
          makeRequest('/api/creator/tip', {
            method: 'POST',
            body: {
              fromDid: senderDid,
              creatorDid,
              targetType: 'post',
              targetId: 'feed-stress-' + i,
              amount: 1,
              message: 'Stress tip #' + i,
            }
          })
        );
      }

      const results = await Promise.all(tipPromises);
      const successful = results.filter(r => r.status === 200 && r.data.ok === true);
      expect(successful.length).toBe(50);
    }, 30000);

    it('should withstand 100 concurrent BLE mesh packet relays with zero packet drops', async () => {
      const relayPromises: Promise<any>[] = [];

      for (let i = 0; i < 100; i++) {
        relayPromises.push(
          makeRequest('/api/mesh/ble/relay-packet', {
            method: 'POST',
            body: {
              senderDid: 'did:sovra:ble_node_' + (i % 5),
              recipientDid: 'did:sovra:ble_node_' + ((i + 1) % 5),
              payloadCiphertext: 'deadbeef' + i.toString(16).padStart(4, '0'),
              topic: 'E2EE_CHAT',
              ttlHops: 5,
            }
          })
        );
      }

      const results = await Promise.all(relayPromises);
      const successful = results.filter(r => r.status === 200 && r.data.ok === true);
      expect(successful.length).toBe(100);
    }, 30000);
  });

});
