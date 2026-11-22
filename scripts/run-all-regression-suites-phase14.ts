/**
 * @file scripts/run-all-regression-suites-phase14.ts
 * SOVRA PHASE 14 — COMPLETE REGRESSION TEST SUITE RUNNER & TEST COUNT RECONCILIATION
 */

import { spawn, ChildProcess, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const suites = [
  'tests/integration/phase10-consensus-operations.test.ts',
  'tests/security/adversarial-remediation-gate.test.ts',
  'tests/security/p0-phase5-verification.test.ts',
  'tests/security/phase9-security-isolation.test.ts',
  'tests/security/phase7-governance-e2ee-adversarial.test.ts',
  'tests/reliability/phase11-disaster-recovery-adversarial.test.ts',
  'tests/security/phase10-financial-testnet.test.ts',
  'packages/identity/test/governance.test.ts',
  'tests/reliability/backup-restore-production-drill.test.ts',
  'tests/integration/phase10-api-production.test.ts',
  'tests/security/phase11-hmac-replay-security.test.ts',
  'tests/integration/phase9-api-decoupling-horizontal.test.ts',
  'tests/integration/phase6-multi-node-federation.test.ts',
  'tests/security/phase10-security-monitoring.test.ts',
  'tests/integration/phase7-multi-cloud-federation.test.ts',
  'tests/integration/phase9-multi-cloud-partition.test.ts',
  'tests/security/phase9-financial-concurrency.test.ts',
  'tests/security/phase12-secret-and-auth-hardening.test.ts',
  'tests/security/phase12-cors-validation.test.ts',
  'tests/security/phase12-distributed-security-store.test.ts',
];

interface SuiteResult {
  index: number;
  file: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  durationMs: number;
  status: 'PASSED' | 'FAILED';
  error?: string;
}

const NODES = [
  { id: 0, rpcPort: 26657, home: 'chain/mytestnet/node0' },
  { id: 1, rpcPort: 26667, home: 'chain/mytestnet/node1' },
  { id: 2, rpcPort: 26677, home: 'chain/mytestnet/node2' },
  { id: 3, rpcPort: 26687, home: 'chain/mytestnet/node3' },
];

async function main() {
  console.log('========================================================================');
  console.log('   SOVRA PHASE 14: 20-SUITE AUTOMATED REGRESSION RUNNER & RECONCILIATION');
  console.log('========================================================================\n');

  console.log('[1/3] Bootstrapping Unified 4-Node Testnet Cluster...');
  const procs: ChildProcess[] = [];
  const binary = path.resolve('chain/sovrad.exe');

  for (const n of NODES) {
    const child = spawn(binary, [
      'start',
      `--home=${n.home}`,
      '--passphrase=sovra-testnet-secret',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    procs.push(child);
  }

  // Wait 4 seconds for cluster convergence
  await new Promise((r) => setTimeout(r, 4000));

  console.log('[2/3] Cluster live. Executing 20 regression test suites...\n');
  const results: SuiteResult[] = [];
  let grandTotal = 0;
  let grandPassed = 0;
  let grandFailed = 0;
  let grandSkipped = 0;
  let grandTodo = 0;

  for (let i = 0; i < suites.length; i++) {
    const file = suites[i];
    const tmpJson = `.tmp-suite-${i}.json`;
    const start = Date.now();
    try {
      execSync(`npx vitest run ${file} --reporter=json --outputFile=${tmpJson}`, {
        stdio: 'pipe',
        timeout: 90000,
      });
      const durationMs = Date.now() - start;
      const data = JSON.parse(fs.readFileSync(tmpJson, 'utf8'));
      const total = data.numTotalTests;
      const passed = data.numPassedTests;
      const failed = data.numFailedTests;
      const skipped = data.numPendingTests || 0;
      const todo = data.numTodoTests || 0;

      results.push({
        index: i + 1,
        file,
        total,
        passed,
        failed,
        skipped,
        todo,
        durationMs,
        status: failed === 0 ? 'PASSED' : 'FAILED',
      });

      grandTotal += total;
      grandPassed += passed;
      grandFailed += failed;
      grandSkipped += skipped;
      grandTodo += todo;

      console.log(`  [${String(i + 1).padStart(2, '0')}/20] ${failed === 0 ? 'PASS' : 'FAIL'} | ${file.padEnd(62)} | ${passed}/${total} passed (${(durationMs / 1000).toFixed(1)}s)`);
    } catch (err: any) {
      const durationMs = Date.now() - start;
      let total = 0, passed = 0, failed = 1, skipped = 0, todo = 0;
      if (fs.existsSync(tmpJson)) {
        try {
          const data = JSON.parse(fs.readFileSync(tmpJson, 'utf8'));
          total = data.numTotalTests;
          passed = data.numPassedTests;
          failed = data.numFailedTests;
          skipped = data.numPendingTests || 0;
          todo = data.numTodoTests || 0;
        } catch (_) {}
      }
      results.push({
        index: i + 1,
        file,
        total,
        passed,
        failed,
        skipped,
        todo,
        durationMs,
        status: 'FAILED',
        error: err.message?.slice(0, 300),
      });
      grandTotal += total;
      grandPassed += passed;
      grandFailed += failed;
      grandSkipped += skipped;
      grandTodo += todo;
      console.log(`  [${String(i + 1).padStart(2, '0')}/20] FAIL | ${file.padEnd(62)} | ${passed}/${total} passed`);
    } finally {
      if (fs.existsSync(tmpJson)) fs.unlinkSync(tmpJson);
    }
  }

  console.log('\n[3/3] Shutting down cluster processes...');
  for (const p of procs) {
    try {
      p.kill('SIGTERM');
    } catch (_) {}
  }

  console.log('\n========================================================================');
  console.log('   PHASE 14 REGRESSION EXECUTION SUMMARY                                ');
  console.log('========================================================================');
  console.log(`Total Suites:   ${suites.length}`);
  console.log(`Suites Passed:  ${results.filter((r) => r.status === 'PASSED').length}/${suites.length}`);
  console.log(`Total Tests:    ${grandTotal}`);
  console.log(`Passed Tests:   ${grandPassed}`);
  console.log(`Failed Tests:   ${grandFailed}`);
  console.log(`Skipped Tests:  ${grandSkipped}`);
  console.log(`Todo Tests:     ${grandTodo}`);
  console.log(`Pass Rate:      ${((grandPassed / (grandTotal || 1)) * 100).toFixed(2)}%`);
  console.log('========================================================================\n');

  const reconciliationData = {
    timestamp: new Date().toISOString(),
    phase: 'Phase 14 — Production-Grade BFT Consensus & Cryptographic Finality',
    summary: {
      totalSuites: suites.length,
      passedSuites: results.filter((r) => r.status === 'PASSED').length,
      failedSuites: results.filter((r) => r.status === 'FAILED').length,
      totalTestsDiscovered: grandTotal,
      passedTests: grandPassed,
      failedTests: grandFailed,
      skippedTests: grandSkipped,
      todoTests: grandTodo,
      overallPassRate: `${((grandPassed / (grandTotal || 1)) * 100).toFixed(2)}%`,
    },
    suiteDetails: results,
  };

  fs.writeFileSync('phase14-test-count-reconciliation.json', JSON.stringify(reconciliationData, null, 2));
  console.log('Reconciliation report saved to phase14-test-count-reconciliation.json');

  if (grandFailed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
