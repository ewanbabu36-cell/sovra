/**
 * @file scripts/phase15_2-reproducible-regression-runner.ts
 * SOVRA PHASE 15.2 — ZERO-TRUST REGRESSION VERIFICATION RUNNER
 *
 * Re-executes all 21 regression suites from scratch, records exact CLI commands,
 * hashes source test files, records exit codes, and generates verifiable evidence.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

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
  'tests/security/phase15-2-validator-rotation-recovery.test.ts',
];

interface ExecutionRecord {
  suiteIndex: number;
  testFile: string;
  testFileSha256: string;
  command: string;
  exitCode: number;
  startTime: string;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  status: 'PASSED' | 'FAILED';
  outputSha256: string;
}

function computeSha256(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (_) {
    return 'FILE_NOT_FOUND';
  }
}

async function runAll() {
  console.log('='.repeat(80));
  console.log('SOVRA PHASE 15.2 — ZERO-TRUST REPRODUCIBLE REGRESSION RUNNER');
  console.log(`Executing ${suites.length} test suites sequentially...`);
  console.log('='.repeat(80));

  const records: ExecutionRecord[] = [];
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  let skippedTests = 0;
  let todoTests = 0;

  for (let i = 0; i < suites.length; i++) {
    const suitePath = suites[i];
    const fullPath = path.resolve(process.cwd(), suitePath);
    const fileSha = computeSha256(fullPath);
    const tmpJson = `.tmp-phase15-2-suite-${i}.json`;
    const cmd = `npx vitest run ${suitePath} --reporter=json --outputFile=${tmpJson}`;

    console.log(`\n[${i + 1}/${suites.length}] Running: ${suitePath}`);
    console.log(`  File SHA-256: ${fileSha}`);
    console.log(`  Command: ${cmd}`);

    const startTime = new Date();
    let exitCode = 0;
    let outputText = '';

    try {
      const out = execSync(cmd, {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000,
      });
      outputText = out;
      exitCode = 0;
    } catch (err: any) {
      exitCode = err.status ?? 1;
      outputText = (err.stdout ?? '') + (err.stderr ?? '');
    }

    const durationMs = Date.now() - startTime.getTime();
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let todo = 0;

    if (fs.existsSync(tmpJson)) {
      try {
        const rawJson = fs.readFileSync(tmpJson, 'utf8');
        const parsed = JSON.parse(rawJson);
        total = parsed.numTotalTests ?? 0;
        passed = parsed.numPassedTests ?? 0;
        failed = parsed.numFailedTests ?? 0;
        skipped = (parsed.numPendingTests ?? 0);
        todo = parsed.numTodoTests ?? 0;
        fs.unlinkSync(tmpJson);
      } catch (e: any) {
        console.warn(`  Warning: Could not parse json output: ${e.message}`);
      }
    }

    totalTests += total;
    passedTests += passed;
    failedTests += failed;
    skippedTests += skipped;
    todoTests += todo;

    const outputHash = crypto.createHash('sha256').update(outputText).digest('hex');
    const status = (exitCode === 0 && failed === 0) ? 'PASSED' : 'FAILED';

    console.log(`  Status: ${status} | Passed: ${passed}/${total} | Duration: ${durationMs}ms | Exit: ${exitCode}`);

    records.push({
      suiteIndex: i + 1,
      testFile: suitePath,
      testFileSha256: fileSha,
      command: cmd,
      exitCode,
      startTime: startTime.toISOString(),
      durationMs,
      total,
      passed,
      failed,
      skipped,
      todo,
      status,
      outputSha256: outputHash,
    });
  }

  const passRate = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(2) + '%' : '0%';
  const suitesPassed = records.filter(r => r.status === 'PASSED').length;
  const suitesFailed = records.filter(r => r.status === 'FAILED').length;

  console.log('\n' + '='.repeat(80));
  console.log('SOVRA PHASE 15.2 REGRESSION SUMMARY');
  console.log(`Total Suites Executed: ${suites.length}`);
  console.log(`Suites Passed:        ${suitesPassed}`);
  console.log(`Suites Failed:        ${suitesFailed}`);
  console.log(`Total Tests Run:      ${totalTests}`);
  console.log(`Passed Tests:         ${passedTests}`);
  console.log(`Failed Tests:         ${failedTests}`);
  console.log(`Skipped Tests:        ${skippedTests}`);
  console.log(`Todo Tests:           ${todoTests}`);
  console.log(`Pass Rate:            ${passRate}`);
  console.log('='.repeat(80));

  const evidence = {
    auditPhase: 'Phase 15.2 Zero-Trust Regression Audit',
    timestamp: new Date().toISOString(),
    baselineCommit: '3864380',
    totalSuites: suites.length,
    suitesPassed,
    suitesFailed,
    metrics: {
      totalTests,
      passedTests,
      failedTests,
      skippedTests,
      todoTests,
      passRate,
    },
    verificationSummary: {
      allSuitesPresent: suitesPassed === suites.length,
      exactTestCountMatches209: totalTests === 209,
      allExitCodesZero: records.every(r => r.exitCode === 0),
    },
    records,
  };

  const evidencePath = path.resolve(process.cwd(), 'phase15_2-regression-reproducibility-evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(`\nMachine-readable evidence written to: ${evidencePath}`);
}

runAll().catch(err => {
  console.error('Fatal error during regression execution:', err);
  process.exit(1);
});
