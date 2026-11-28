/**
 * @file tests/security/stage9-p2-security-regression.test.ts
 * Targeted Stage 9 Phase 2 Security Remediation Regression Tests:
 * 1. ConsensusMonitor fail-closed behavior on empty rpcUrls & unreachable validators (no fabricated supply/healthy status).
 * 2. ConsensusMonitor Prometheus help line non-collision with metric gauge assertions.
 * 3. Live ephemeral HTTP /status + /net_info + /query/supply consensus health verification without external daemon dependency.
 * 4. SovraDatabaseEngine.appendMessage fail-closed rejection when isE2EE=true lacks client ciphertext metadata.
 */

import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConsensusMonitor } from '../../services/api/src/index.ts';
import { SovraDatabaseEngine } from '../../scripts/database-engine.ts';

function startMockValidatorRpc(opts: { moniker: string; height: number; supplyUsov: string }): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/status') {
        res.end(JSON.stringify({
          moniker: opts.moniker,
          chain_id: 'sovra-testnet-0',
          height: opts.height,
          total_supply: opts.supplyUsov,
          supply_correct: true,
        }));
        return;
      }
      if (req.url === '/net_info') {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: -1, result: { n_peers: 3 } }));
        return;
      }
      if (req.url === '/query/supply') {
        res.end(JSON.stringify({
          bank_supply: opts.supplyUsov,
          master_invariant_holds: true,
        }));
        return;
      }
      res.end(JSON.stringify({ ok: true }));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe('Stage 9 Phase 2 — Security Remediation Regression Suite', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!();
    }
  });

  it('ConsensusMonitor fails closed when rpcUrls list is empty', async () => {
    const monitor = new ConsensusMonitor({ rpcUrls: [] });
    const summary = await monitor.evaluateHealth();

    expect(summary.totalValidators).toBe(0);
    expect(summary.activeValidators).toBe(0);
    expect(summary.consensusHalted).toBe(true);
    expect(summary.healthy).toBe(false);
    expect(summary.totalSupplyUsov).toBe('0');
    expect(summary.masterInvariantHolds).toBe(false);

    const metrics = monitor.generatePrometheusMetrics(summary);
    expect(metrics).not.toContain('sovra_consensus_healthy 1');
    expect(metrics).toMatch(/^sovra_consensus_healthy 0$/m);
  });

  it('ConsensusMonitor fails closed and never fabricates supply or matches # HELP when validators are unreachable', async () => {
    // Allocate ephemeral closed port
    const closedPort = await new Promise<number>((resolve) => {
      const srv = http.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const port = (srv.address() as { port: number }).port;
        srv.close(() => resolve(port));
      });
    });

    const monitor = new ConsensusMonitor({
      rpcUrls: [`http://127.0.0.1:${closedPort}`],
      lagThresholdBlocks: 5,
    });

    const summary = await monitor.evaluateHealth();
    expect(summary.activeValidators).toBe(0);
    expect(summary.consensusHalted).toBe(true);
    expect(summary.healthy).toBe(false);
    expect(summary.totalSupplyUsov).toBe('0');
    expect(summary.masterInvariantHolds).toBe(false);

    const metrics = monitor.generatePrometheusMetrics(summary);
    expect(metrics).not.toContain('30139348240070');
    expect(metrics).not.toContain('sovra_consensus_healthy 1');
    expect(metrics).toMatch(/^sovra_consensus_healthy 0$/m);
  });

  it('ConsensusMonitor reports healthy=true and real supply when 2 ephemeral validators respond', async () => {
    const val0 = await startMockValidatorRpc({ moniker: 'ephemeral-v0', height: 6120, supplyUsov: '42000000' });
    const val1 = await startMockValidatorRpc({ moniker: 'ephemeral-v1', height: 6121, supplyUsov: '42000000' });
    cleanups.push(val0.close, val1.close);

    const monitor = new ConsensusMonitor({
      rpcUrls: [val0.url, val1.url],
      lagThresholdBlocks: 5,
    });

    const summary = await monitor.evaluateHealth();
    expect(summary.activeValidators).toBe(2);
    expect(summary.consensusHalted).toBe(false);
    expect(summary.healthy).toBe(true);
    expect(summary.networkHeight).toBe(6121);
    expect(summary.maxLagBlocks).toBe(1);
    expect(summary.totalSupplyUsov).toBe('42000000');
    expect(summary.masterInvariantHolds).toBe(true);

    const metrics = monitor.generatePrometheusMetrics(summary);
    expect(metrics).toMatch(/^sovra_consensus_healthy 1$/m);
    expect(metrics).toMatch(/^sovra_total_supply_usov 42000000$/m);
  });

  it('SovraDatabaseEngine.appendMessage fails closed if isE2EE=true lacks client ciphertext metadata and isolates plaintext channels', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-s9-p2-db-'));
    const db = new SovraDatabaseEngine(tmpDir);
    cleanups.push(() => {
      db.getSqliteEngine()?.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // 1. Forged/buggy E2EE claim without ciphertext must throw fail-closed
    expect(() => {
      db.appendMessage({
        senderDid: 'did:sovra:alice',
        recipientDid: 'did:sovra:bob',
        senderName: 'Alice',
        text: 'SHOULD_NEVER_HIT_PLAINTEXT',
        isE2EE: true,
      });
    }).toThrow(/ERR_CLIENT_E2EE_REQUIRED/);

    // 2. Genuine client E2EE stores Client-Side badge and drops rawText
    const e2eeMsg = db.appendMessage({
      senderDid: 'did:sovra:alice',
      recipientDid: 'did:sovra:bob',
      senderName: 'Alice',
      isE2EE: true,
      ciphertextHex: 'aa'.repeat(32),
      ivHex: 'bb'.repeat(12),
      tagHex: 'cc'.repeat(16),
    });
    expect(e2eeMsg.isE2EE).toBe(true);
    expect(e2eeMsg.text).toBe('🔒 [End-to-End Encrypted: Client-Side]');
    expect(e2eeMsg.rawText).toBeUndefined();

    // 3. Explicit non-E2EE channel broadcast preserves backward compatibility with isE2EE=false
    const chanMsg = db.appendMessage({
      senderDid: 'did:sovra:alice',
      recipientDid: 'channel:public_townsquare',
      senderName: 'Alice',
      text: 'Public announcement',
      isE2EE: false,
    });
    expect(chanMsg.isE2EE).toBe(false);
    expect(chanMsg.text).toBe('Public announcement');
  });
});
