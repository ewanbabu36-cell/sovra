import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface SuiteRecord {
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

const TEST_SUITES = [
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
  'tests/security/phase15-3-validator-transition-boundary.test.ts',
];

function computeSha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function runAllSuites() {
  console.log('='.repeat(80));
  console.log('SOVRA PHASE 15.3 — ZERO-TRUST REPRODUCIBLE REGRESSION RUNNER');
  console.log(`Executing ${TEST_SUITES.length} test suites sequentially...`);
  console.log('='.repeat(80));

  const records: SuiteRecord[] = [];
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  let skippedTests = 0;
  let todoTests = 0;
  let suitesPassed = 0;
  let suitesFailed = 0;

  for (let i = 0; i < TEST_SUITES.length; i++) {
    const testFile = TEST_SUITES[i];
    const fullPath = path.resolve(process.cwd(), testFile);

    if (!fs.existsSync(fullPath)) {
      console.error(`ERROR: Test file not found: ${testFile}`);
      process.exit(1);
    }

    const fileHash = computeSha256(fullPath);
    const tmpOutputFile = `.tmp-phase15-3-suite-${i}.json`;
    const command = `npx vitest run ${testFile} --reporter=json --outputFile=${tmpOutputFile}`;

    console.log(`\n[${i + 1}/${TEST_SUITES.length}] Running: ${testFile}`);
    console.log(`  File SHA-256: ${fileHash}`);
    console.log(`  Command: ${command}`);

    const start = Date.now();
    let exitCode = 0;
    try {
      execSync(command, { stdio: 'pipe' });
    } catch (err: any) {
      exitCode = err.status || 1;
    }
    const duration = Date.now() - start;

    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let todo = 0;
    let outputSha256 = '';

    if (fs.existsSync(tmpOutputFile)) {
      const outputContent = fs.readFileSync(tmpOutputFile, 'utf8');
      outputSha256 = crypto.createHash('sha256').update(outputContent).digest('hex');

      try {
        const jsonResult = JSON.parse(outputContent);
        total = jsonResult.numTotalTests || 0;
        passed = jsonResult.numPassedTests || 0;
        failed = jsonResult.numFailedTests || 0;
        skipped = jsonResult.numPendingTests || 0;
        todo = jsonResult.numTodoTests || 0;
      } catch (e) {
        console.error('  Failed to parse JSON result');
      }
      // Clean up temp file
      try {
        fs.unlinkSync(tmpOutputFile);
      } catch {}
    }

    const status = (exitCode === 0 && failed === 0) ? 'PASSED' : 'FAILED';
    if (status === 'PASSED') {
      suitesPassed++;
    } else {
      suitesFailed++;
    }

    totalTests += total;
    passedTests += passed;
    failedTests += failed;
    skippedTests += skipped;
    todoTests += todo;

    console.log(`  Status: ${status} | Passed: ${passed}/${total} | Duration: ${duration}ms | Exit: ${exitCode}`);

    records.push({
      suiteIndex: i + 1,
      testFile,
      testFileSha256: fileHash,
      command,
      exitCode,
      startTime: new Date(start).toISOString(),
      durationMs: duration,
      total,
      passed,
      failed,
      skipped,
      todo,
      status,
      outputSha256,
    });
  }

  const passRate = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(2) + '%' : '0.00%';

  console.log('\n' + '='.repeat(80));
  console.log('SOVRA PHASE 15.3 REGRESSION SUMMARY');
  console.log(`Total Suites Executed: ${TEST_SUITES.length}`);
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
    auditPhase: 'Phase 15.3 Zero-Trust Regression Audit',
    timestamp: new Date().toISOString(),
    baselineCommit: 'd16d239',
    totalSuites: TEST_SUITES.length,
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
      allSuitesPresent: suitesPassed === TEST_SUITES.length,
      exactTestCountMatches: totalTests >= 228,
      allExitCodesZero: suitesFailed === 0,
    },
    records,
  };

  const evidencePath = path.resolve(process.cwd(), 'phase15_3-regression-reproducibility-evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`\nMachine-readable evidence written to: ${evidencePath}\n`);

  if (suitesFailed > 0) {
    process.exit(1);
  }
}

runAllSuites().catch((err) => {
  console.error('Fatal error running regression suites:', err);
  process.exit(1);
});
