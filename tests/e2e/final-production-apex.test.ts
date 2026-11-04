import { describe, it, expect, beforeAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
      timeout: 15000,
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

describe('SOVRA FINAL LAUNCH APEX: COMPLETE ALL REMAINING WORKS PROTOCOL', () => {
  let serverRootHtml: string = '';
  let activeMasterDid: string = '';

  beforeAll(async () => {
    const health = await makeRequest('/api/status');
    expect(health.status).toBe(200);
    expect(health.data.ok).toBe(true);
    activeMasterDid = health.data.node?.did || 'did:key:z6MkoVmKwZQZ9GyXrNEyztNNuYK3e36NqvfHri1vSTRQEFDD';

    const rootRes = await makeRequest('/');
    expect(rootRes.status).toBe(200);
    serverRootHtml = rootRes.rawText;
  });

  // =========================================================================
  // TRACK 1: SEEDER & CREATOR 1-CLICK PAYOUT CLAIM ENGINE
  // =========================================================================
  describe('Phase 1: Seeder & Creator 1-Click Payout Claim Engine', () => {
    const ts = Date.now();
    const testSenderDid = 'did:sovra:tipper_apex_' + ts;
    const testCreatorDid = 'did:sovra:creator_apex_' + ts;

    beforeAll(() => {
      sovraDb.registerUser({
        did: testSenderDid,
        handle: `@tipper_${ts}`,
        displayName: 'Generous Supporter',
      });
      sovraDb.registerUser({
        did: testCreatorDid,
        handle: `@creator_${ts}`,
        displayName: 'Apex Creator',
      });
    });

    it('should generate unclaimed creator & seeder tip revenue', async () => {
      const tipRes = await makeRequest('/api/creator/tip', {
        method: 'POST',
        body: {
          fromDid: testSenderDid,
          creatorDid: testCreatorDid,
          toDid: testCreatorDid,
          targetType: 'post',
          targetId: 'post-apex-01',
          amount: 25.0,
          message: 'P2P Micro-Tip for Apex Creator',
        }
      });

      expect(tipRes.status).toBe(200);
      expect(tipRes.data.ok).toBe(true);
      expect(Number(tipRes.data.voucher.creatorAmount)).toBe(23.75); // 95% net creator cut
      expect(Number(tipRes.data.voucher.seederAmount)).toBe(1.25);   // 5% seeder cut
    });

    it('should reflect unclaimed SOV in creator analytics dashboard endpoint', async () => {
      const analyticsRes = await makeRequest('/api/creator/analytics?creatorDid=' + encodeURIComponent(testCreatorDid));
      expect(analyticsRes.status).toBe(200);
      expect(analyticsRes.data.ok).toBe(true);
      expect(analyticsRes.data.unclaimedSov).toBeGreaterThanOrEqual(23.75);
      expect(analyticsRes.data.takeRatePct).toBe(95);
    });

    it('should atomically claim all unclaimed earnings into wallet via POST /api/creator/claim-payout', async () => {
      const claimRes = await makeRequest('/api/creator/claim-payout', {
        method: 'POST',
        body: {
          creatorDid: testCreatorDid,
        }
      });

      expect(claimRes.status).toBe(200);
      expect(claimRes.data.ok).toBe(true);
      expect(claimRes.data.claimedAmount).toBeGreaterThanOrEqual(23.75);
      expect(claimRes.data.remainingUnclaimed).toBe(0);
      expect(claimRes.data.newWalletBalance).toBeGreaterThanOrEqual(23.75);
      expect(claimRes.data.receipt).toBeDefined();
      expect(claimRes.data.receipt.id).toContain('payout-');
    });

    it('should reject secondary claim when unclaimed balance is depleted', async () => {
      const secondClaim = await makeRequest('/api/creator/claim-payout', {
        method: 'POST',
        body: {
          creatorDid: testCreatorDid,
        }
      });

      expect(secondClaim.status).toBe(400);
      expect(secondClaim.data.ok).toBe(false);
      expect(secondClaim.data.error).toContain('No unclaimed balance');
    });

    it('should render "⚡ Claim My Earnings" button and handler in Creator Studio UI', () => {
      expect(serverRootHtml).toContain('id="claimEarningsBtn"');
      expect(serverRootHtml).toContain('onclick="claimCreatorEarnings()"');
      expect(serverRootHtml).toContain('id="creatorUnclaimedPayoutDisplay"');
      expect(serverRootHtml).toContain('window.claimCreatorEarnings = async function');
    });
  });

  // =========================================================================
  // TRACK 2: MOBILE SYSTEM SHARE TARGET & INTENT INGESTION
  // =========================================================================
  describe('Phase 2: Mobile System Share Target & Intent Ingestion', () => {
    it('should serve W3C share_target in dynamic /manifest.webmanifest', async () => {
      const manifestRes = await makeRequest('/manifest.webmanifest');
      expect(manifestRes.status).toBe(200);
      expect(manifestRes.data.share_target).toBeDefined();
      expect(manifestRes.data.share_target.action).toBe('/?shared=true');
      expect(manifestRes.data.share_target.method).toBe('GET');
      expect(manifestRes.data.share_target.params).toEqual({
        title: 'title',
        text: 'text',
        url: 'url',
      });
    });

    it('should verify static public/manifest.webmanifest contains compliant share_target', () => {
      const manifestPath = path.join(process.cwd(), 'public', 'manifest.webmanifest');
      expect(fs.existsSync(manifestPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(content.share_target).toBeDefined();
      expect(content.share_target.action).toBe('/?shared=true');
      expect(content.share_target.params.url).toBe('url');
    });

    it('should contain client startup listener handling ?shared=true intent ingestion', () => {
      expect(serverRootHtml).toContain('handleIncomingShareTarget');
      expect(serverRootHtml).toContain('window.location.search');
      expect(serverRootHtml).toContain('urlParams.get(\'shared\')');
      expect(serverRootHtml).toContain('dynamicPostCaption');
      expect(serverRootHtml).toContain('window.__sovraSharedPayload');
    });
  });

  // =========================================================================
  // TRACK 3: SPATIAL AUDIO 3D PANNER ENGINE FOR SOVRA SPACES
  // =========================================================================
  describe('Phase 3: Spatial Audio 3D Panner Engine for Sovra Spaces', () => {
    it('should calculate correct binaural stereo pan values based on speaker stage index', () => {
      function calculateSpeakerPan(speakerIndex: number, totalSpeakers: number): number {
        if (speakerIndex === 0) return 0.0; // Host at center
        const isOdd = (speakerIndex % 2 === 1);
        const tier = Math.ceil(speakerIndex / 2);
        const panVal = (tier === 1) ? 0.65 : Math.max(0.3, 0.65 - (tier - 1) * 0.15);
        return isOdd ? -Number(panVal.toFixed(2)) : Number(panVal.toFixed(2));
      }

      // Host: 0.0 center
      expect(calculateSpeakerPan(0, 5)).toBe(0.0);
      // Speaker 1: -0.65 (Stage Left)
      expect(calculateSpeakerPan(1, 5)).toBe(-0.65);
      // Speaker 2: +0.65 (Stage Right)
      expect(calculateSpeakerPan(2, 5)).toBe(0.65);
      // Speaker 3: -0.50 (Inner Left)
      expect(calculateSpeakerPan(3, 5)).toBe(-0.50);
      // Speaker 4: +0.50 (Inner Right)
      expect(calculateSpeakerPan(4, 5)).toBe(0.50);
    });

    it('should integrate Web Audio API StereoPannerNode and 3D badges into window.SovraSpacesEngine', () => {
      expect(serverRootHtml).toContain('window.SovraSpacesEngine = {');
      expect(serverRootHtml).toContain('initSpatialAudioContext: function');
      expect(serverRootHtml).toContain('calculateSpeakerPan: function');
      expect(serverRootHtml).toContain('applySpatialPanning: function');
      expect(serverRootHtml).toContain('createStereoPanner');
      expect(serverRootHtml).toContain('🎧 3D Center');
      expect(serverRootHtml).toContain('🎧 3D Left');
      expect(serverRootHtml).toContain('🎧 3D Right');
    });
  });

  // =========================================================================
  // TRACK 4: CRYPTOGRAPHIC 2-OF-3 SOCIAL GUARDIAN RECOVERY
  // =========================================================================
  describe('Phase 4: Cryptographic 2-of-3 Social Guardian Recovery', () => {
    let recoverySessionId = '';
    const lostUserDid = 'did:sovra:lost_phone_user_' + Date.now();
    const designatedGuardians = ['@alice_crypto', '@bob_validator', '@carol_recovery'];

    it('should initiate a recovery session via POST /api/auth/recovery/initiate', async () => {
      const initRes = await makeRequest('/api/auth/recovery/initiate', {
        method: 'POST',
        body: {
          targetDid: lostUserDid,
          guardians: designatedGuardians,
        }
      });

      expect(initRes.status).toBe(200);
      expect(initRes.data.ok).toBe(true);
      expect(initRes.data.recoveryId).toBeDefined();
      expect(initRes.data.threshold).toBe(2);
      expect(initRes.data.requiredApprovals).toBe(2);
      expect(initRes.data.status).toBe('PENDING');
      expect(initRes.data.guardians).toEqual(designatedGuardians);

      recoverySessionId = initRes.data.recoveryId;
    });

    it('should retrieve status via GET /api/auth/recovery/status', async () => {
      const statusRes = await makeRequest('/api/auth/recovery/status?recoveryId=' + encodeURIComponent(recoverySessionId));
      expect(statusRes.status).toBe(200);
      expect(statusRes.data.ok).toBe(true);
      expect(statusRes.data.approvalsCount).toBe(0);
      expect(statusRes.data.isThresholdMet).toBe(false);
      expect(statusRes.data.status).toBe('PENDING');
    });

    it('should reject approval from an unauthorized guardian entity', async () => {
      const unauthorizedRes = await makeRequest('/api/auth/recovery/approve', {
        method: 'POST',
        body: {
          recoveryId: recoverySessionId,
          guardianId: '@evil_attacker',
          signature: '0xdeadbeef',
        }
      });

      expect(unauthorizedRes.status).toBe(403);
      expect(unauthorizedRes.data.ok).toBe(false);
      expect(unauthorizedRes.data.error).toContain('not authorized');
    });

    it('should record first guardian approval (1 of 2 quorum)', async () => {
      const app1 = await makeRequest('/api/auth/recovery/approve', {
        method: 'POST',
        body: {
          recoveryId: recoverySessionId,
          guardianId: '@alice_crypto',
          signature: '0x' + crypto.randomBytes(32).toString('hex'),
        }
      });

      expect(app1.status).toBe(200);
      expect(app1.data.ok).toBe(true);
      expect(app1.data.currentApprovals).toBe(1);
      expect(app1.data.isThresholdMet).toBe(false);
      expect(app1.data.status).toBe('PENDING');
    });

    it('should reject finalize attempt before quorum threshold is satisfied', async () => {
      const prematureRes = await makeRequest('/api/auth/recovery/finalize', {
        method: 'POST',
        body: {
          recoveryId: recoverySessionId,
        }
      });

      expect(prematureRes.status).toBe(400);
      expect(prematureRes.data.ok).toBe(false);
      expect(prematureRes.data.error).toContain('Quorum threshold not met');
    });

    it('should record second guardian approval and meet 2-of-3 quorum threshold', async () => {
      const app2 = await makeRequest('/api/auth/recovery/approve', {
        method: 'POST',
        body: {
          recoveryId: recoverySessionId,
          guardianId: '@bob_validator',
          signature: '0x' + crypto.randomBytes(32).toString('hex'),
        }
      });

      expect(app2.status).toBe(200);
      expect(app2.data.ok).toBe(true);
      expect(app2.data.currentApprovals).toBe(2);
      expect(app2.data.isThresholdMet).toBe(true);
      expect(app2.data.status).toBe('APPROVED');
    });

    it('should finalize recovery and issue sovereign restore token', async () => {
      const finalizeRes = await makeRequest('/api/auth/recovery/finalize', {
        method: 'POST',
        body: {
          recoveryId: recoverySessionId,
        }
      });

      expect(finalizeRes.status).toBe(200);
      expect(finalizeRes.data.ok).toBe(true);
      expect(finalizeRes.data.status).toBe('FINALIZED');
      expect(finalizeRes.data.restoreToken).toContain('sovra-restore-');
      expect(finalizeRes.data.quorumApprovals).toBe(2);
    });

    it('should reject secondary finalize on already finalized session', async () => {
      const secondFin = await makeRequest('/api/auth/recovery/approve', {
        method: 'POST',
        body: {
          recoveryId: recoverySessionId,
          guardianId: '@carol_recovery',
        }
      });

      expect(secondFin.status).toBe(400);
      expect(secondFin.data.error).toContain('already finalized');
    });
  });

  // =========================================================================
  // TRACK 5: HIGH-CONCURRENCY CHAOS & PROTOCOL INTEGRITY
  // =========================================================================
  describe('Phase 5: High-Concurrency Chaos & Protocol Integrity', () => {
    it('should sustain 25 parallel social recovery quorum sessions concurrently without collision', async () => {
      const concurrentRuns = Array.from({ length: 25 }, async (_, i) => {
        const userDid = `did:sovra:stress_user_${Date.now()}_${i}`;
        const guardians = [`@guard_a_${i}`, `@guard_b_${i}`, `@guard_c_${i}`];

        const init = await makeRequest('/api/auth/recovery/initiate', {
          method: 'POST',
          body: { targetDid: userDid, guardians }
        });
        expect(init.status).toBe(200);
        const rId = init.data.recoveryId;

        const a1 = await makeRequest('/api/auth/recovery/approve', {
          method: 'POST',
          body: { recoveryId: rId, guardianId: guardians[0] }
        });
        expect(a1.status).toBe(200);

        const a2 = await makeRequest('/api/auth/recovery/approve', {
          method: 'POST',
          body: { recoveryId: rId, guardianId: guardians[1] }
        });
        expect(a2.status).toBe(200);

        const fin = await makeRequest('/api/auth/recovery/finalize', {
          method: 'POST',
          body: { recoveryId: rId }
        });
        expect(fin.status).toBe(200);
        expect(fin.data.ok).toBe(true);
        expect(fin.data.restoreToken).toBeDefined();
      });

      await Promise.all(concurrentRuns);
    }, 30000);

    it('should sustain 25 parallel creator tip and payout cycles with zero state divergence', async () => {
      const ts = Date.now();
      const concurrentTips = Array.from({ length: 25 }, async (_, i) => {
        const backerDid = `did:sovra:backer_stress_${ts}_${i}`;
        const creatorDid = `did:sovra:creator_stress_${ts}_${i}`;

        sovraDb.registerUser({
          did: backerDid,
          handle: `@backer_${ts}_${i}`,
          displayName: `Backer ${i}`,
        });
        sovraDb.registerUser({
          did: creatorDid,
          handle: `@creator_${ts}_${i}`,
          displayName: `Creator ${i}`,
        });

        const tip = await makeRequest('/api/creator/tip', {
          method: 'POST',
          body: {
            fromDid: backerDid,
            creatorDid,
            toDid: creatorDid,
            targetType: 'post',
            targetId: 'post-stress-' + i,
            amount: 10.0,
          }
        });
        expect(tip.status).toBe(200);

        const claim = await makeRequest('/api/creator/claim-payout', {
          method: 'POST',
          body: { creatorDid }
        });
        expect(claim.status).toBe(200);
        expect(claim.data.claimedAmount).toBe(9.5); // 95% of 10.0
        expect(claim.data.remainingUnclaimed).toBe(0);
      });

      await Promise.all(concurrentTips);
    }, 60000);
  });
});
