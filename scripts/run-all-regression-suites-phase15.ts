/**
 * @file scripts/run-all-regression-suites-phase15.ts
 * SOVRA PHASE 15 — COMPLETE 20-SUITE REGRESSION RUNNER & RECONCILIATION
 */

import { execSync } from 'node:child_process';
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

async function checkPort(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok || res.status === 404 || res.status === 401;
  } catch (_) {
    return false;
  }
}

async function main() {
  console.log('========================================================================');
  console.log('   SOVRA PHASE 15: 20-SUITE AUTOMATED REGRESSION RUNNER & RECONCILIATION');
  console.log('========================================================================\n');

  console.log('[1/3] Verifying cluster and dev-server health...');
  const devServerHealthy = await checkPort('http://127.0.0.1:3001/');
  const n0Healthy = await checkPort('http://127.0.0.1:26657/status');
  const n1Healthy = await checkPort('http://127.0.0.1:26667/status');
  const n2Healthy = await checkPort('http://127.0.0.1:26677/status');
  const n3Healthy = await checkPort('http://127.0.0.1:26687/status');

  console.log(`  -> Dev Server (port 3001): ${devServerHealthy ? 'ONLINE' : 'OFFLINE'}`);
  console.log(`  -> Validator 0 (port 26657): ${n0Healthy ? 'ONLINE' : 'OFFLINE'}`);
  console.log(`  -> Validator 1 (port 26667): ${n1Healthy ? 'ONLINE' : 'OFFLINE'}`);
  console.log(`  -> Validator 2 (port 26677): ${n2Healthy ? 'ONLINE' : 'OFFLINE'}`);
  console.log(`  -> Validator 3 (port 26687): ${n3Healthy ? 'ONLINE' : 'OFFLINE'}\n`);

  if (!devServerHealthy || !n0Healthy || !n1Healthy || !n2Healthy || !n3Healthy) {
    console.warn('[WARN] Some services are offline. Tests that depend on them may fail.');
  }

  console.log('[2/3] Executing 20 regression test suites sequentially...\n');
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
      console.log(`  [${String(i + 1).padStart(2, '0')}/20] FAIL | ${file.padEnd(62)} | ${passed}/${total} passed (${(durationMs / 1000).toFixed(1)}s)`);
    } finally {
      if (fs.existsSync(tmpJson)) fs.unlinkSync(tmpJson);
    }
  }

  console.log('\n[3/3] Generating machine-readable regression reconciliation evidence...');
  const reconciliation = {
    phase: 'Phase 15',
    baselineCommit: '2f3e017',
    timestamp: new Date().toISOString(),
    totalSuites: suites.length,
    suitesPassed: results.filter(r => r.status === 'PASSED').length,
    suitesFailed: results.filter(r => r.status === 'FAILED').length,
    testsSummary: {
      total: grandTotal,
      passed: grandPassed,
      failed: grandFailed,
      skipped: grandSkipped,
      todo: grandTodo,
      passRatePercent: grandTotal > 0 ? ((grandPassed / grandTotal) * 100).toFixed(2) : '0.00',
    },
    suiteResults: results,
    comparisonWithPhase14: {
      phase14Suites: 20,
      phase14TotalTests: 197,
      phase14PassRate: '100.00%',
      phase15Suites: suites.length,
      phase15TotalTests: grandTotal,
      phase15PassRate: grandTotal > 0 ? `${((grandPassed / grandTotal) * 100).toFixed(2)}%` : '0.00%',
      parityMaintained: grandPassed === grandTotal && grandTotal >= 197,
    },
  };

  fs.writeFileSync('phase15-regression-reconciliation.json', JSON.stringify(reconciliation, null, 2));
  console.log('  -> Wrote phase15-regression-reconciliation.json\n');

  console.log('========================================================================');
  console.log(`   REGRESSION RECONCILIATION SUMMARY: ${reconciliation.suitesPassed}/20 SUITES PASSED`);
  console.log(`   TOTAL TESTS: ${grandPassed}/${grandTotal} PASSED (${reconciliation.testsSummary.passRatePercent}%)`);
  console.log('========================================================================');
}

main().catch(err => {
  console.error('[FATAL ERROR]', err);
  process.exit(1);
});
