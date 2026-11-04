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

describe('🚀 SOVRA FEDIVERSE, REPUTATION & PRODUCTION OBSERVABILITY PROTOCOL', () => {
  const ts = Date.now();
  const testFediverseDid = `did:sovra:fediverse_creator_${ts}`;
  const testHandle = `fediverse_artist_${ts}`;

  beforeAll(() => {
    sovraDb.registerUser({
      did: testFediverseDid,
      handle: `@${testHandle}`,
      displayName: 'Fediverse Creator',
      balanceSov: 350.0,
    });

    sovraDb.createPost({
      authorDid: testFediverseDid,
      authorName: 'Fediverse Creator',
      authorHandle: `@${testHandle}`,
      caption: 'Decentralized Sovereign Post on Sovra & Fediverse Mesh',
    });
  });

  // ==========================================================================
  // PHASE 1: W3C ACTIVITYPUB & FEDIVERSE GATEWAY BRIDGE
  // ==========================================================================
  describe('Phase 1: W3C ActivityPub & Fediverse Gateway Bridge', () => {
    it('should resolve W3C WebFinger queries for @handle@sovra.network', async () => {
      const res = await makeRequest(`/.well-known/webfinger?resource=acct:${testHandle}@sovra.network`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/jrd+json');
      expect(res.data.subject).toBe(`acct:${testHandle}@sovra.network`);
      expect(res.data.aliases).toContain(testFediverseDid);
      expect(res.data.links.some((l: any) => l.rel === 'self' && l.type === 'application/activity+json')).toBe(true);
    });

    it('should resolve WebFinger queries by raw DID resource', async () => {
      const res = await makeRequest(`/.well-known/webfinger?resource=${encodeURIComponent(testFediverseDid)}`);
      expect(res.status).toBe(200);
      expect(res.data.subject).toContain('@sovra.network');
      expect(res.data.aliases).toContain(testFediverseDid);
    });

    it('should return 400 when resource query parameter is missing in WebFinger', async () => {
      const res = await makeRequest('/.well-known/webfinger');
      expect(res.status).toBe(400);
      expect(res.data.ok).toBe(false);
    });

    it('should serve an ActivityStreams 2.0 OrderedCollection outbox for creator DID', async () => {
      const res = await makeRequest(`/users/${encodeURIComponent(testFediverseDid)}/outbox`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/activity+json');
      expect(res.data['@context']).toBe('https://www.w3.org/ns/activitystreams');
      expect(res.data.type).toBe('OrderedCollection');
      expect(res.data.totalItems).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.data.orderedItems)).toBe(true);
      expect(res.data.orderedItems[0].type).toBe('Create');
      expect(res.data.orderedItems[0].object.type).toBe('Note');
    });

    it('should serve ActivityPub Actor object for DID profile discovery', async () => {
      const res = await makeRequest(`/users/${encodeURIComponent(testFediverseDid)}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/activity+json');
      expect(res.data.type).toBe('Person');
      expect(res.data.preferredUsername).toBe(testHandle);
      expect(res.data.inbox).toContain(`/users/${encodeURIComponent(testFediverseDid)}/inbox`);
      expect(res.data.outbox).toContain(`/users/${encodeURIComponent(testFediverseDid)}/outbox`);
      expect(res.data.publicKey).toBeDefined();
    });

    it('should accept federated interactions in ActivityPub inbox with 202 Accepted', async () => {
      const payload = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `https://mastodon.social/activities/follow_${ts}`,
        type: 'Follow',
        actor: 'https://mastodon.social/users/fediverse_user',
        object: `https://sovra.network/users/${encodeURIComponent(testFediverseDid)}`,
      };
      const res = await makeRequest(`/users/${encodeURIComponent(testFediverseDid)}/inbox`, {
        method: 'POST',
        body: payload,
      });

      expect(res.status).toBe(202);
      expect(res.data.ok).toBe(true);
      expect(res.data.status).toBe('accepted');
      expect(res.data.activityType).toBe('Follow');
      expect(res.data.recipientDid).toBe(testFediverseDid);
    });
  });

  // ==========================================================================
  // PHASE 2: EIGENTRUST SOVEREIGNRANK & DECENTRALIZED TRUST ENGINE
  // ==========================================================================
  describe('Phase 2: EigenTrust SovereignRank & Decentralized Trust Engine', () => {
    it('should calculate accurate multi-factor SovereignRank for a DID', () => {
      const rank = sovraDb.calculateSovereignRank(testFediverseDid);
      expect(rank.did).toBe(testFediverseDid);
      expect(rank.rankScore).toBeGreaterThanOrEqual(100);
      expect(rank.rankScore).toBeLessThanOrEqual(1000);
      expect(['Novice', 'Sovereign Citizen', 'Sovereign Guardian', 'Apex Sovereign']).toContain(rank.tier);
      expect(rank.breakdown).toBeDefined();
      expect(rank.breakdown.base).toBe(100);
      expect(rank.breakdown.creatorTips).toBeGreaterThan(0);
    });

    it('should return SovereignRank via GET /api/user/:did/sovereign-rank', async () => {
      const res = await makeRequest(`/api/user/${encodeURIComponent(testFediverseDid)}/sovereign-rank`);
      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.rankScore).toBeGreaterThanOrEqual(100);
      expect(res.data.tier).toBeDefined();
    });

    it('should serve algorithmic ranked feed via GET /api/feed/ranked with author SovereignRank', async () => {
      const res = await makeRequest('/api/feed/ranked?limit=10');
      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.algorithm).toBe('EigenTrust-SovereignRank-v1');
      expect(Array.isArray(res.data.posts)).toBe(true);
      if (res.data.posts.length > 0) {
        const topPost = res.data.posts[0];
        expect(topPost.authorSovereignRank).toBeDefined();
        expect(topPost.compositeScore).toBeDefined();
        // Posts should be sorted descending by compositeScore
        for (let i = 1; i < res.data.posts.length; i++) {
          expect(res.data.posts[i - 1].compositeScore).toBeGreaterThanOrEqual(res.data.posts[i].compositeScore);
        }
      }
    });
  });

  // ==========================================================================
  // PHASE 3: ENTERPRISE PROMETHEUS METRICS & FULL HEALTH OBSERVABILITY
  // ==========================================================================
  describe('Phase 3: Prometheus Metrics & Full Health Observability', () => {
    it('should export valid Prometheus metrics format via GET /api/metrics', async () => {
      const res = await makeRequest('/api/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      const text = res.rawText;
      expect(text).toContain('# HELP sovra_p2p_active_peers_total');
      expect(text).toContain('# TYPE sovra_p2p_active_peers_total gauge');
      expect(text).toContain('sovra_p2p_active_peers_total');
      expect(text).toContain('sovra_pqc_signatures_verified_total');
      expect(text).toContain('sovra_zk_nullifiers_total');
      expect(text).toContain('sovra_spaces_active_total');
      expect(text).toContain('sovra_creator_tips_settled_sov');
      expect(text).toContain('sovra_db_records_total');
    });

    it('should report comprehensive diagnostic health metrics via GET /api/health/full', async () => {
      const res = await makeRequest('/api/health/full');
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('healthy');
      expect(res.data.healthScore).toBe(100);
      expect(res.data.version).toBe('0.1.0');
      expect(res.data.memory).toBeDefined();
      expect(res.data.memory.rssMb).toBeGreaterThan(0);
      expect(res.data.memory.heapUsedMb).toBeGreaterThan(0);
      expect(res.data.database.status).toBe('connected');
      expect(res.data.database.latencyMs).toBeGreaterThanOrEqual(1);
      expect(res.data.pqcEnclave.fips203Kyber).toBe('active');
      expect(res.data.pqcEnclave.fips204Dilithium).toBe('active');
    });
  });

  // ==========================================================================
  // PHASE 4: DISASTER-RESILIENT LOCAL P2P MESH SYNC (MERKLE DAG)
  // ==========================================================================
  describe('Phase 4: Disaster-Resilient Local P2P Mesh Sync (Merkle DAG)', () => {
    it('should generate a Merkle DAG summary of local post state', async () => {
      const res = await makeRequest('/api/mesh/gossip-summary', {
        method: 'POST',
        body: {},
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.localRoot).toMatch(/^[0-9a-f]{64}$/);
      expect(res.data.totalItems).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.data.digests)).toBe(true);
    });

    it('should compare Merkle summaries and detect missing posts from peer', async () => {
      const simulatedPeerSummary = {
        peerRoot: '0000000000000000000000000000000000000000000000000000000000000000',
        digests: [
          { id: 'post_peer_unique_1', contentHash: 'aabbccdd11223344', timestamp: Date.now() }
        ],
      };

      const res = await makeRequest('/api/mesh/gossip-summary', {
        method: 'POST',
        body: simulatedPeerSummary,
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.syncNeeded).toBe(true);
      expect(res.data.missingLocally).toContain('post_peer_unique_1');
    });

    it('should reconcile and idempotently merge peer posts via POST /api/mesh/sync-payload', async () => {
      const syncPostId = `mesh_sync_post_${ts}`;
      const payload = {
        posts: [
          {
            id: syncPostId,
            authorDid: `did:sovra:mesh_peer_${ts}`,
            authorName: 'Mesh Offline Peer',
            caption: 'Synced offline peer-to-peer via local WebRTC Merkle DAG',
            timestamp: Date.now(),
            likesCount: 5,
          }
        ]
      };

      const res = await makeRequest('/api/mesh/sync-payload', {
        method: 'POST',
        body: payload,
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.mergedCount).toBe(1);
      expect(res.data.addedPostIds).toContain(syncPostId);

      // Verify second sync of same post is skipped (idempotent)
      const res2 = await makeRequest('/api/mesh/sync-payload', {
        method: 'POST',
        body: payload,
      });
      expect(res2.status).toBe(200);
      expect(res2.data.mergedCount).toBe(0);
      expect(res2.data.skippedCount).toBe(1);
    });
  });

  // ==========================================================================
  // PHASE 5: UI BADGES & PRODUCTION RUNTIME VERIFICATION
  // ==========================================================================
  describe('Phase 5: UI Elements & Production Container Configuration', () => {
    it('should render UI indicators and client helpers in served HTML', async () => {
      const res = await makeRequest('/');
      expect(res.status).toBe(200);
      expect(res.rawText).toContain('id="systemHealthIndicator"');
      expect(res.rawText).toContain('id="localMeshSyncPill"');
      expect(res.rawText).toContain('id="spacesRankBadge"');
      expect(res.rawText).toContain('id="sovereignScoreBadge"');
      expect(res.rawText).toContain('id="fediversePill"');
      expect(res.rawText).toContain('window.copyFediverseHandle');
      expect(res.rawText).toContain('window.SovraMeshSync');
    });

    it('should verify Dockerfile and docker-compose.prod.yml exist and specify correct production ports', () => {
      const dockerfilePath = path.join(process.cwd(), 'Dockerfile');
      const composePath = path.join(process.cwd(), 'docker-compose.prod.yml');

      expect(fs.existsSync(dockerfilePath)).toBe(true);
      expect(fs.existsSync(composePath)).toBe(true);

      const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf-8');
      const composeContent = fs.readFileSync(composePath, 'utf-8');

      expect(dockerfileContent).toContain('node:22-alpine');
      expect(dockerfileContent).toContain('EXPOSE 3001 3443 4001');
      expect(composeContent).toContain('3001:3001');
      expect(composeContent).toContain('4001:4001');
    });
  });
});
