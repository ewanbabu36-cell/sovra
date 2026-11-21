import { execSync } from 'node:child_process';
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
  'tests/security/phase12-distributed-security-store.test.ts'
];

interface SuiteResult {
  index: number;
  file: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  status: 'PASSED' | 'FAILED';
  error?: string;
}

const results: SuiteResult[] = [];
let grandTotal = 0;
let grandPassed = 0;
let grandFailed = 0;
let grandSkipped = 0;

console.log('========================================================================');
console.log('  SOVRA PROTOCOL PHASE 12: TEST COUNT RECONCILIATION & ISOLATION RUNNER  ');
console.log('========================================================================\n');

for (let i = 0; i < suites.length; i++) {
  const file = suites[i];
  const tmpJson = `.tmp-suite-${i}.json`;
  const start = Date.now();
  try {
    execSync(`npx vitest run ${file} --reporter=json --outputFile=${tmpJson}`, {
      stdio: 'pipe',
      timeout: 60000,
    });
    const durationMs = Date.now() - start;
    const data = JSON.parse(fs.readFileSync(tmpJson, 'utf8'));
    const total = data.numTotalTests;
    const passed = data.numPassedTests;
    const failed = data.numFailedTests;
    const skipped = data.numPendingTests + data.numTodoTests;

    results.push({
      index: i + 1,
      file,
      total,
      passed,
      failed,
      skipped,
      durationMs,
      status: failed === 0 ? 'PASSED' : 'FAILED',
    });

    grandTotal += total;
    grandPassed += passed;
    grandFailed += failed;
    grandSkipped += skipped;

    console.log(`[${i + 1}/20] ✅ ${file} -> ${passed}/${total} passed (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    let total = 0;
    let passed = 0;
    let failed = 1;
    let skipped = 0;
    let errorMessage = err.message;

    if (fs.existsSync(tmpJson)) {
      try {
        const data = JSON.parse(fs.readFileSync(tmpJson, 'utf8'));
        total = data.numTotalTests;
        passed = data.numPassedTests;
        failed = data.numFailedTests;
        skipped = data.numPendingTests + data.numTodoTests;
      } catch (_) {}
    }

    results.push({
      index: i + 1,
      file,
      total,
      passed,
      failed,
      skipped,
      durationMs,
      status: 'FAILED',
      error: errorMessage,
    });

    grandTotal += total;
    grandPassed += passed;
    grandFailed += failed;
    grandSkipped += skipped;

    console.log(`[${i + 1}/20] ❌ ${file} -> ${passed}/${total} passed, ${failed} failed (${durationMs}ms)`);
  } finally {
    if (fs.existsSync(tmpJson)) {
      try { fs.unlinkSync(tmpJson); } catch (_) {}
    }
  }
}

console.log('\n========================================================================');
console.log('                          RECONCILIATION SUMMARY                         ');
console.log('========================================================================');
console.log(`Total Test Files Audited:   ${suites.length}`);
console.log(`Total Individual Tests:     ${grandTotal}`);
console.log(`Total Passed Tests:         ${grandPassed}`);
console.log(`Total Failed Tests:         ${grandFailed}`);
console.log(`Total Skipped / Todo Tests: ${grandSkipped}`);
console.log(`Success Rate:               ${((grandPassed / grandTotal) * 100).toFixed(2)}%`);
console.log('========================================================================\n');

// Write machine-readable audit report
fs.writeFileSync('test-count-reconciliation.json', JSON.stringify({
  timestamp: new Date().toISOString(),
  suitesCount: suites.length,
  grandTotal,
  grandPassed,
  grandFailed,
  grandSkipped,
  results,
}, null, 2));

console.log('Wrote machine-generated reconciliation artifact: test-count-reconciliation.json');
