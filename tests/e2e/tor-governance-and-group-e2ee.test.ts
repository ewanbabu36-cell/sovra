import { describe, it, expect, beforeAll } from 'vitest';
import http from 'node:http';
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

describe('🚀 SOVRA CENSORSHIP-RESISTANT ONION, DAO GOVERNANCE & GROUP E2EE PROTOCOL', () => {
  const ts = Date.now();
  const testVoterDid = `did:sovra:voter_dao_${ts}`;
  let createdProposalId = '';
  const testGroupId = `group_mls_test_${ts}`;

  beforeAll(() => {
    sovraDb.registerUser({
      did: testVoterDid,
      handle: `@dao_pioneer_${ts}`,
      displayName: 'DAO Pioneer',
      balanceSov: 500.0,
    });
  });

  // ==========================================================================
  // PHASE 1: TOR ONION ROUTING & EXTREME CENSORSHIP-RESISTANCE
  // ==========================================================================
  describe('Phase 1: Tor Onion Routing & Extreme Censorship-Resistance', () => {
    it('should serve /.well-known/tor-onion-service with valid Tor v3 onion address and socks5 fallback', async () => {
      const res = await makeRequest('/.well-known/tor-onion-service');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.data.ok).toBe(true);
      expect(res.data.status).toBe('active');
      expect(res.data.version).toBe(3);
      expect(res.data.onionAddress).toMatch(/\.onion$/);
      expect(res.data.socks5Fallback).toBe('socks5h://127.0.0.1:9050');
      expect(res.data.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(res.data.capabilities).toEqual(
        expect.arrayContaining(['p2p-signaling', 'gossip-mesh', 'e2ee-sync', 'zk-relay'])
      );
    });

    it('should embed Tor Onion Routing client engine and settings UI in index page', async () => {
      const res = await makeRequest('/');
      expect(res.status).toBe(200);
      expect(res.rawText).toContain('id="torRoutingToggle"');
      expect(res.rawText).toContain('id="torStatusBadge"');
      expect(res.rawText).toContain('window.SovraTorEngine');
      expect(res.rawText).toContain('enableOnionRouting');
      expect(res.rawText).toContain('disableOnionRouting');
      expect(res.rawText).toContain('isOnionActive');
    });
  });

  // ==========================================================================
  // PHASE 2: DECENTRALIZED ANONYMOUS GOVERNANCE DAO & QUADRATIC VOTING
  // ==========================================================================
  describe('Phase 2: Decentralized Anonymous Governance DAO & Quadratic Voting', () => {
    it('should create a new governance proposal via POST /api/governance/proposals/create', async () => {
      const payload = {
        title: `SIP-42: Community Mesh Bandwidth Grant ${ts}`,
        description: 'Allocate 50,000 SOV from DAO Treasury to subsidize offline relay hotspots.',
        creatorDid: testVoterDid,
        category: 'community_grant',
        options: ['YES', 'NO', 'ABSTAIN'],
        quorumThreshold: 60,
        durationDays: 14,
      };

      const res = await makeRequest('/api/governance/proposals/create', {
        method: 'POST',
        body: payload,
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.proposal).toBeDefined();
      expect(res.data.proposal.id).toMatch(/^prop_/);
      expect(res.data.proposal.title).toBe(payload.title);
      expect(res.data.proposal.category).toBe('community_grant');
      expect(res.data.proposal.status).toBe('ACTIVE');
      expect(res.data.proposal.votes).toHaveLength(0);

      createdProposalId = res.data.proposal.id;
    });

    it('should reject proposal creation when required title or creatorDid is missing', async () => {
      const res = await makeRequest('/api/governance/proposals/create', {
        method: 'POST',
        body: { description: 'Missing title' },
      });
      expect(res.status).toBe(400);
      expect(res.data.ok).toBe(false);
      expect(res.data.error).toBeDefined();
    });

    it('should cast a quadratic vote and verify weight calculation: sqrt(SOV)', async () => {
      const nullifier1 = `zk_nullifier_${ts}_alpha`;
      // Staking 100 SOV -> quadratic weight should be sqrt(100) = 10
      const voteRes = await makeRequest('/api/governance/vote', {
        method: 'POST',
        body: {
          proposalId: createdProposalId,
          option: 'YES',
          sovStaked: 100,
          nullifierHash: nullifier1,
          subjectDid: testVoterDid,
        },
      });

      expect(voteRes.status).toBe(200);
      expect(voteRes.data.ok).toBe(true);
      expect(voteRes.data.quadraticWeight).toBe(10);
      expect(voteRes.data.option).toBe('YES');
      expect(voteRes.data.totalVotes).toBe(1);

      // Staking 49 SOV -> quadratic weight should be sqrt(49) = 7
      const nullifier2 = `zk_nullifier_${ts}_beta`;
      const vote2Res = await makeRequest('/api/governance/vote', {
        method: 'POST',
        body: {
          proposalId: createdProposalId,
          option: 'NO',
          sovStaked: 49,
          nullifierHash: nullifier2,
          subjectDid: `did:sovra:counter_voter_${ts}`,
        },
      });

      expect(vote2Res.status).toBe(200);
      expect(vote2Res.data.ok).toBe(true);
      expect(vote2Res.data.quadraticWeight).toBe(7);
      expect(vote2Res.data.option).toBe('NO');
      expect(vote2Res.data.totalVotes).toBe(2);
    });

    it('should enforce Sybil-resistance: reject duplicate vote with same ZK nullifier', async () => {
      const nullifierDuplicate = `zk_nullifier_${ts}_alpha`;
      const res = await makeRequest('/api/governance/vote', {
        method: 'POST',
        body: {
          proposalId: createdProposalId,
          option: 'YES',
          sovStaked: 25,
          nullifierHash: nullifierDuplicate,
          subjectDid: testVoterDid,
        },
      });

      expect(res.status).toBe(409);
      expect(res.data.ok).toBe(false);
      expect(res.data.error).toContain('already cast');
    });

    it('should reject votes on invalid options or invalid proposals', async () => {
      const resBadOption = await makeRequest('/api/governance/vote', {
        method: 'POST',
        body: {
          proposalId: createdProposalId,
          option: 'INVALID_OPTION',
          sovStaked: 10,
        },
      });
      expect(resBadOption.status).toBe(400);
      expect(resBadOption.data.ok).toBe(false);

      const resBadProp = await makeRequest('/api/governance/vote', {
        method: 'POST',
        body: {
          proposalId: 'prop_non_existent',
          option: 'YES',
          sovStaked: 10,
        },
      });
      expect(resBadProp.status).toBe(400);
      expect(resBadProp.data.ok).toBe(false);
    });

    it('should list active proposals via GET /api/governance/proposals/active with quadratic tally metadata', async () => {
      const res = await makeRequest('/api/governance/proposals/active');
      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(Array.isArray(res.data.proposals)).toBe(true);
      const found = res.data.proposals.find((p: any) => p.id === createdProposalId);
      expect(found).toBeDefined();
      expect(found.title).toContain('SIP-42');
      expect(found.quadraticTallies).toBeDefined();
      expect(found.quadraticTallies['YES']).toBe(10);
      expect(found.quadraticTallies['NO']).toBe(7);
      expect(found.leadingOption).toBe('YES');
      expect(found.votesCount).toBe(2);
    });

    it('should embed DAO Governance Modal and action buttons in UI', async () => {
      const res = await makeRequest('/');
      expect(res.status).toBe(200);
      expect(res.rawText).toContain('id="openDaoModalBtn"');
      expect(res.rawText).toContain('id="sovraDaoModal"');
      expect(res.rawText).toContain('openDaoModal');
      expect(res.rawText).toContain('closeDaoModal');
      expect(res.rawText).toContain('castQuadraticVotePrompt');
      expect(res.rawText).toContain('data-proposal-id=');
    });
  });

  // ==========================================================================
  // PHASE 3: MULTI-CHAIN WEB3 DOMAIN RESOLVER (ENS, HANDSHAKE, SNS)
  // ==========================================================================
  describe('Phase 3: Multi-Chain Web3 Domain Resolver (ENS, Handshake, SNS)', () => {
    it('should resolve Ethereum Name Service (.eth) domains to DID and IPFS content hash', async () => {
      const res = await makeRequest('/api/resolver/resolve-domain?domain=vitalik.eth');
      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.domain).toBe('vitalik.eth');
      expect(res.data.protocol).toBe('ENS');
      expect(res.data.resolvedDid).toMatch(/^did:key:z6Mku/);
      expect(res.data.contentHash).toMatch(/^ipfs:\/\/Qm/);
      expect(res.data.records).toBeDefined();
      expect(res.data.records.email).toContain('@vitalik.eth');
    });

    it('should resolve Solana Name Service (.sol) domains with valid Solana public key', async () => {
      const res = await makeRequest('/api/resolver/resolve-domain?domain=phantom.sol');
      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.domain).toBe('phantom.sol');
      expect(res.data.protocol).toBe('Solana Name Service');
      expect(res.data.solanaPubkey).toBeDefined();
      expect(res.data.solanaPubkey.length).toBeGreaterThanOrEqual(32);
      expect(res.data.solanaPubkey.length).toBeLessThanOrEqual(44);
      expect(res.data.resolvedDid).toMatch(/^did:key:z6Mku/);
    });

    it('should resolve Handshake / Sovra native domains (.sovra) to sovereign DIDs', async () => {
      const res = await makeRequest('/api/resolver/resolve-domain?domain=alice.sovra');
      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.domain).toBe('alice.sovra');
      expect(res.data.protocol).toBe('Handshake Web3 TLD');
      expect(res.data.resolvedDid).toMatch(/^did:key:z6Mku/);
    });

    it('should return 400 when domain query parameter is missing', async () => {
      const res = await makeRequest('/api/resolver/resolve-domain');
      expect(res.status).toBe(400);
      expect(res.data.ok).toBe(false);
      expect(res.data.error).toContain('domain query parameter is required');
    });

    it('should embed Web3 Domain Resolver UI components in index page', async () => {
      const res = await makeRequest('/');
      expect(res.status).toBe(200);
      expect(res.rawText).toContain('id="web3DomainInput"');
      expect(res.rawText).toContain('id="resolveDomainBtn"');
      expect(res.rawText).toContain('id="domainResolutionPreview"');
      expect(res.rawText).toContain('resolveUserWeb3Domain');
    });
  });

  // ==========================================================================
  // PHASE 4: MULTI-PARTY GROUP E2EE (MLS / GROUP RATCHET)
  // ==========================================================================
  describe('Phase 4: Multi-Party Group E2EE (MLS / Group Ratchet)', () => {
    it('should initialize a new MLS group ratchet via POST /api/chat/groups/e2ee-key-exchange', async () => {
      const res = await makeRequest('/api/chat/groups/e2ee-key-exchange', {
        method: 'POST',
        body: {
          groupId: testGroupId,
          creatorDid: testVoterDid,
          members: [testVoterDid, `did:sovra:peer_bob_${ts}`],
        },
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.groupId).toBe(testGroupId);
      expect(res.data.epoch).toBe(1);
      expect(res.data.membersCount).toBe(2);
      expect(res.data.epochKeyHash).toBeDefined();
    });

    it('should advance ratchet epoch on subsequent key exchanges for forward secrecy', async () => {
      const res = await makeRequest('/api/chat/groups/e2ee-key-exchange', {
        method: 'POST',
        body: {
          groupId: testGroupId,
          creatorDid: testVoterDid,
          members: [`did:sovra:peer_charlie_${ts}`],
        },
      });

      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.groupId).toBe(testGroupId);
      expect(res.data.epoch).toBe(2);
      expect(res.data.status).toBe('RATCHET_ADVANCED');
      expect(res.data.membersCount).toBe(3);
    });

    it('should retrieve group E2EE cryptographic state via GET /api/chat/groups/:groupId/e2ee-state', async () => {
      const res = await makeRequest(`/api/chat/groups/${testGroupId}/e2ee-state`);
      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.groupId).toBe(testGroupId);
      expect(res.data.epoch).toBe(2);
      expect(res.data.algorithm).toBe('MLS-TreeKEM-v1');
      expect(res.data.epochKeyHash).toBeDefined();
      expect(res.data.members).toContain(testVoterDid);
    });

    it('should return ok: false for non-existent group E2EE state', async () => {
      const res = await makeRequest('/api/chat/groups/non_existent_group_xyz/e2ee-state');
      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(false);
      expect(res.data.error).toContain('Group E2EE state not found');
    });

    it('should embed Group E2EE ratchet engine and security shield in UI', async () => {
      const res = await makeRequest('/');
      expect(res.status).toBe(200);
      expect(res.rawText).toContain('id="groupE2eeShield"');
      expect(res.rawText).toContain('window.SovraGroupRatchet');
      expect(res.rawText).toContain('initGroupRatchet');
      expect(res.rawText).toContain('advanceGroupEpoch');
      expect(res.rawText).toContain('getGroupState');
    });
  });
});
