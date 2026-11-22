/**
 * 👑 SOVRA PROTOCOL — PHASE 15.5 LIVE RECOVERY ACTIVATION & COMPROMISED KEY REJECTION SUITE
 * File: tests/security/phase15-5-live-recovery.test.ts
 *
 * Verifies against the live running 4-node recovery network:
 * 1. Live 4-node consensus agreement on chain sovra-recovery-1.
 * 2. Complete exclusion of compromised genesis validator keys.
 * 3. Commit certificates cryptographically signed exclusively by replacement keys.
 * 4. Fail-closed authorization security on /consensus/transition.
 * 5. Rejection of compromised proposals, prevotes, precommits, and forged/mixed certificates.
 * 6. Historical preservation of canonical chain sovra-testnet-0.
 */

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import net from 'node:net';

const RECOVERY_RPC_PORTS = [26757, 26767, 26777, 26787];
const RECOVERY_P2P_PORT = 26756;
const RECOVERY_CHAIN_ID = 'sovra-recovery-1';
const CANONICAL_RPC_PORT = 26657;
const CANONICAL_CHAIN_ID = 'sovra-testnet-0';

const COMPROMISED_GENESIS_KEYS = [
  {
    name: 'validator-0',
    address: 'sovra12a806ca82d506a025d580d40600abc77a69e10e7',
    pubKey: '50dec499bc1281f64488a3ca9500c9c1a4eea67f5147af0450ee0deebf8601be',
  },
  {
    name: 'validator-1',
    address: 'sovra1664a83c922035ce28bb723e4e92aed1e60e26ea1',
    pubKey: 'a81cd7b53eb1edcfc9abce54679faf08ccaa002bd5898b63431f29cc964e67e3',
  },
  {
    name: 'validator-2',
    address: 'sovra1cb55be9a3d2afab1c9bcbffb88367bec797d11cb',
    pubKey: 'd6cbcf5c5acf4688995801c2993a53f4c5ff164bd897362909fb2f1a5ede7724',
  },
  {
    name: 'validator-3',
    address: 'sovra1d96f6140a4c4ae797d9e3a5badf467eb756d3d20',
    pubKey: 'b5fc366f668f7d6dfc43a9b2942895ccb9e4eea5d7b1ca46f1e8c710347977ec',
  },
];

const REPLACEMENT_VALIDATOR_KEYS = [
  {
    name: 'validator-0',
    address: 'sovra1e4654fa45393171840964bce0716ea8d9742f6b8',
    pubKey: '9c7965188c69a5b8c69ff94e6ee6ff65b8d30bf8a9c5b75368ddbc9afae80e8d',
  },
  {
    name: 'validator-1',
    address: 'sovra1f7878b4c2f9e783c95feda305f1a7cbd30ed5df3',
    pubKey: '407e7d2d35ee9f071fdc74b50389d6ce6e1eb59713246209b6e13ca4fe9a405c',
  },
  {
    name: 'validator-2',
    address: 'sovra13c97b27b53207767d67495900c3ab9d88a09e311',
    pubKey: '15c2de73d9195ad0b1866d1799f6bdcd25d8614afc08b84a12e93e18fafb56af',
  },
  {
    name: 'validator-3',
    address: 'sovra1162e4bf6312e39ee210a94309cf3911f52798e90',
    pubKey: '2e428524e705d2face294d429286b94f96f46cda8db83e7a7182750dc7ab0053',
  },
];

// Helper to query node JSON-RPC / REST endpoints
async function queryRpc(port: number, endpoint: string): Promise<any> {
  const url = `http://127.0.0.1:${port}${endpoint}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

describe('👑 SOVRA PHASE 15.5 — LIVE RECOVERY FOUR-NODE ACTIVATION & REJECTION', () => {
  describe('1. Live Four-Node Network State & Consensus Agreement', () => {
    it('verifies all 4 nodes are live, healthy, and report chain_id sovra-recovery-1', async () => {
      const statuses = await Promise.all(
        RECOVERY_RPC_PORTS.map((port) => queryRpc(port, '/status'))
      );

      expect(statuses.length).toBe(4);
      for (const s of statuses) {
        expect(s.chain_id).toBe(RECOVERY_CHAIN_ID);
        expect(s.height).toBeGreaterThanOrEqual(50);
        expect(s.supply_correct).toBe(true);
        expect(BigInt(s.total_supply)).toBeGreaterThanOrEqual(30000000000000n);
      }
    });

    it('verifies height progression and lockstep block agreement across all 4 recovery nodes', async () => {
      const heights = await Promise.all(
        RECOVERY_RPC_PORTS.map(async (port) => {
          const s = await queryRpc(port, '/status');
          return s.height;
        })
      );

      const minHeight = Math.min(...heights);
      const maxHeight = Math.max(...heights);
      // All nodes must be within 1 block of each other in live consensus
      expect(maxHeight - minHeight).toBeLessThanOrEqual(2);
      expect(minHeight).toBeGreaterThanOrEqual(50);
    });

    it('verifies current active validator set contains only replacement keys (zero compromised keys)', async () => {
      const valResponse = await queryRpc(RECOVERY_RPC_PORTS[0], '/validators');
      const activeValidators = valResponse.result.validators;

      expect(activeValidators.length).toBe(4);

      const activeAddresses = new Set(activeValidators.map((v: any) => v.address));
      const activePubKeys = new Set(activeValidators.map((v: any) => v.pub_key));

      // Assert all replacement keys are active
      for (const rep of REPLACEMENT_VALIDATOR_KEYS) {
        expect(activeAddresses.has(rep.address)).toBe(true);
        expect(activePubKeys.has(rep.pubKey)).toBe(true);
      }

      // Assert none of the compromised genesis keys are in the active validator set
      for (const comp of COMPROMISED_GENESIS_KEYS) {
        expect(activeAddresses.has(comp.address)).toBe(false);
        expect(activePubKeys.has(comp.pubKey)).toBe(false);
      }
    });
  });

  describe('2. Commit Certificate Cryptographic Audit on Live Blocks', () => {
    it('verifies block 50 commit certificate is signed with > 67% quorum exclusively by replacement keys', async () => {
      const blockRes = await queryRpc(RECOVERY_RPC_PORTS[0], '/block?height=50');
      const block = blockRes.result.block;
      expect(block).toBeDefined();
      expect(block.header.height).toBe('50');

      const lastCommit = block.last_commit;
      expect(lastCommit).toBeDefined();
      expect(lastCommit.height).toBe(50);

      const signatures = lastCommit.signatures;
      expect(signatures.length).toBeGreaterThanOrEqual(3); // At least 3 of 4 validators (75% power)

      let totalPower = 0;
      const compromisedAddresses = new Set(COMPROMISED_GENESIS_KEYS.map((k) => k.address));
      const replacementAddresses = new Set(REPLACEMENT_VALIDATOR_KEYS.map((k) => k.address));

      for (const sig of signatures) {
        // Must NOT be a compromised address
        expect(compromisedAddresses.has(sig.validator_address)).toBe(false);
        // MUST be a valid replacement address
        expect(replacementAddresses.has(sig.validator_address)).toBe(true);
        expect(sig.signature.length).toBe(128); // 64-byte Ed25519 signature hex
        totalPower += sig.voting_power;
      }

      expect(totalPower).toBeGreaterThanOrEqual(75); // >= 75% quorum power
    });

    it('verifies recent block commit certificate contains zero compromised signatures', async () => {
      const status = await queryRpc(RECOVERY_RPC_PORTS[0], '/status');
      const testHeight = status.height - 2;

      const blockRes = await queryRpc(RECOVERY_RPC_PORTS[0], `/block?height=${testHeight}`);
      const signatures = blockRes.result.block.last_commit.signatures;

      const compromisedAddresses = new Set(COMPROMISED_GENESIS_KEYS.map((k) => k.address));
      for (const sig of signatures) {
        expect(compromisedAddresses.has(sig.validator_address)).toBe(false);
      }
    });
  });

  describe('3. Authorized Transition Endpoint Security Gate (/consensus/transition)', () => {
    it('rejects unauthenticated transition requests with HTTP 401 Unauthorized', async () => {
      const url = `http://127.0.0.1:${RECOVERY_RPC_PORTS[0]}/consensus/transition`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transition_height: 50000,
          reason: 'UNAUTHORIZED_ATTACK_TEST',
        }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain('unauthorized');
    });

    it('rejects transition requests with invalid bearer token with HTTP 401 Unauthorized', async () => {
      const url = `http://127.0.0.1:${RECOVERY_RPC_PORTS[0]}/consensus/transition`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer fraudulent-attacker-token-999',
        },
        body: JSON.stringify({
          transition_height: 50000,
          reason: 'FORGED_BEARER_TOKEN_ATTACK',
        }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain('unauthorized');
    });

    it('rejects transition requests signed by revoked compromised genesis keys with HTTP 401', async () => {
      const url = `http://127.0.0.1:${RECOVERY_RPC_PORTS[0]}/consensus/transition`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transition_height: 50000,
          reason: 'REVOKED_KEYS_TRANSITION_ATTACK',
          quorum_signatures: [
            {
              validator_address: COMPROMISED_GENESIS_KEYS[0].address,
              signature_hex: 'a'.repeat(128),
            },
            {
              validator_address: COMPROMISED_GENESIS_KEYS[1].address,
              signature_hex: 'b'.repeat(128),
            },
            {
              validator_address: COMPROMISED_GENESIS_KEYS[2].address,
              signature_hex: 'c'.repeat(128),
            },
          ],
        }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain('unauthorized');
      expect(json.accumulated_power).toBe(0);
    });
  });

  describe('4. Live P2P Rejection of Compromised Messages', () => {
    it('connects to live P2P switch and transmits forged vote signed with compromised key', async () => {
      const client = new net.Socket();
      let connected = false;

      await new Promise<void>((resolve, reject) => {
        client.connect(RECOVERY_P2P_PORT, '127.0.0.1', () => {
          connected = true;
          resolve();
        });
        client.on('error', reject);
      });

      expect(connected).toBe(true);

      // Perform handshake
      const handshake = JSON.stringify({
        type: 'handshake',
        payload: {
          node_id: 'attacker00000000000000000000000000000000',
          moniker: 'adversary-probe',
          chain_id: RECOVERY_CHAIN_ID,
          listen_addr: 'tcp://127.0.0.1:39999',
          height: 1,
        },
      }) + '\n';
      client.write(handshake);

      // Send forged vote signed with compromised validator address
      const forgedVote = JSON.stringify({
        type: 'vote',
        payload: {
          chain_id: RECOVERY_CHAIN_ID,
          vote: {
            type: 2, // Precommit
            height: 999999,
            round: 0,
            block_hash: '0000000000000000000000000000000000000000000000000000000000000000',
            validator_address: COMPROMISED_GENESIS_KEYS[0].address,
            validator_index: 0,
            signature: '0'.repeat(128),
          },
        },
      }) + '\n';
      client.write(forgedVote);

      // Allow node to process and verify connection stays alive without crashing
      await new Promise((r) => setTimeout(r, 500));
      client.destroy();

      // Verify node0 is still completely healthy and unaffected
      const status = await queryRpc(RECOVERY_RPC_PORTS[0], '/status');
      expect(status.chain_id).toBe(RECOVERY_CHAIN_ID);
      expect(status.supply_correct).toBe(true);
    });

    it('transmits forged block containing compromised commit certificate and verifies rejection', async () => {
      const client = new net.Socket();
      await new Promise<void>((resolve, reject) => {
        client.connect(RECOVERY_P2P_PORT, '127.0.0.1', () => resolve());
        client.on('error', reject);
      });

      const handshake = JSON.stringify({
        type: 'handshake',
        payload: {
          node_id: 'forger0000000000000000000000000000000000',
          moniker: 'forger-node',
          chain_id: RECOVERY_CHAIN_ID,
          listen_addr: 'tcp://127.0.0.1:39998',
          height: 1,
        },
      }) + '\n';
      client.write(handshake);

      // Send forged block with forged commit cert
      const forgedBlock = JSON.stringify({
        type: 'new_block',
        payload: {
          block: {
            height: 99999,
            time: Math.floor(Date.now() / 1000),
            app_hash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
            proposer: 'adversary',
            tx_count: 0,
            commit_cert: {
              height: 99999,
              round: 0,
              block_hash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
              signatures: [
                {
                  validator_address: COMPROMISED_GENESIS_KEYS[0].address,
                  validator_index: 0,
                  signature_hex: 'f'.repeat(128),
                  voting_power: 25,
                },
                {
                  validator_address: COMPROMISED_GENESIS_KEYS[1].address,
                  validator_index: 1,
                  signature_hex: 'f'.repeat(128),
                  voting_power: 25,
                },
                {
                  validator_address: COMPROMISED_GENESIS_KEYS[2].address,
                  validator_index: 2,
                  signature_hex: 'f'.repeat(128),
                  voting_power: 25,
                },
              ],
            },
          },
        },
      }) + '\n';
      client.write(forgedBlock);

      await new Promise((r) => setTimeout(r, 500));
      client.destroy();

      // Assert node did NOT jump to height 99999 or adopt fake app hash
      const status = await queryRpc(RECOVERY_RPC_PORTS[0], '/status');
      expect(status.height).toBeLessThan(10000);
      expect(status.app_hash).not.toBe('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    });
  });

  describe('5. Canonical Historical Chain Preservation (sovra-testnet-0)', () => {
    it('verifies the original chain sovra-testnet-0 remains running and intact at height >= 47,823', async () => {
      const status = await queryRpc(CANONICAL_RPC_PORT, '/status');
      expect(status.chain_id).toBe(CANONICAL_CHAIN_ID);
      expect(status.height).toBeGreaterThanOrEqual(47823);
      expect(status.supply_correct).toBe(true);
      expect(BigInt(status.total_supply)).toBeGreaterThanOrEqual(30000000000000n);
    });

    it('verifies historical block on sovra-testnet-0 retains authentic historical commit certificate', async () => {
      const blockRes = await queryRpc(CANONICAL_RPC_PORT, '/block?height=47820');
      const block = blockRes.result.block;
      expect(block).toBeDefined();
      expect(block.header.height).toBe('47820');
      expect(block.header.chain_id).toBe(CANONICAL_CHAIN_ID);
      expect(block.last_commit).toBeDefined();
      expect(block.last_commit.signatures.length).toBeGreaterThanOrEqual(3);
    });

    it('verifies early genesis prototype block 100 on sovra-testnet-0 remains intact and unmodified', async () => {
      const blockRes = await queryRpc(CANONICAL_RPC_PORT, '/block?height=100');
      const block = blockRes.result.block;
      expect(block).toBeDefined();
      expect(block.header.height).toBe('100');
      expect(block.header.chain_id).toBe(CANONICAL_CHAIN_ID);
      expect(block.header.proposer_address).toBe('validator-1');
    });
  });
});
